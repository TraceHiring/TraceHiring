// Test harness for the candidate routes: the real app over a fake `API` (CandidateRpc, records every call), a fake
// `OTP` namespace whose objects are the real OtpCore on a Map-backed KV, a Map-backed R2 bucket for `EVIDENCE`, a
// movable clock and a captured log sink. Keys are made at run time; ids and labels are synthetic.
import { createApp } from './app.js';
import { OtpCore, type SyncKvLike } from './otp-core.js';
import type { CandidateMethod } from './rpc.js';
import {
  CANDIDATE,
  INVITATION,
  KID,
  makeKey,
  ORG,
  publicVar,
  SESSION,
  signToken,
  type TestKey,
} from './token.test-helpers.js';

export const ORIGIN = 'https://candidate.example.test';
export const NOTICE_ID = '66666666-6666-4666-8666-666666666666';
export const NOTICE_SHA = 'a'.repeat(64);
/** The raw link token of the test invitation (43 base64url chars), built at run time. */
export const LINK = (): string => `${'L'.repeat(21)}${'k'.repeat(22)}`;

/** A minimal JPEG header: SOI, an APP0 segment, a SOF0 frame of the given size, SOS, then padding and EOI. */
export const testJpeg = (width: number, height: number, pad = 64, sof = 0xc0): Uint8Array => {
  const app0 = [
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0, 0, 1, 0, 1, 0, 0,
  ];
  const frame = [
    0xff, sof, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]; // prettier-ignore
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00];
  const body = Array.from({ length: pad }, (_, i) => (i * 37) & 0x7f);
  return new Uint8Array([0xff, 0xd8, ...app0, ...frame, ...sos, ...body, 0xff, 0xd9]);
};

export class MapKv implements SyncKvLike {
  readonly map = new Map<string, unknown>();
  get<T = unknown>(key: string): T | undefined {
    const value = this.map.get(key);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }
  put<T>(key: string, value: T): void {
    this.map.set(key, structuredClone(value));
  }
  delete(key: string): boolean {
    return this.map.delete(key);
  }
}

export interface Clock {
  ms: number;
}

/** A fake DurableObjectNamespace: one OtpCore per name, on the shared clock. `names` records every id asked for. */
export const fakeOtpNamespace = (clock: Clock) => {
  const cores = new Map<string, OtpCore>();
  const names: string[] = [];
  const ns = {
    idFromName(name: string) {
      names.push(name);
      return { name, toString: () => name };
    },
    get(id: { name: string }) {
      let core = cores.get(id.name);
      if (core === undefined) {
        core = new OtpCore(new MapKv(), { now: () => clock.ms });
        cores.set(id.name, core);
      }
      return core;
    },
  };
  return { ns, cores, names };
};

export interface StoredObject {
  body: Uint8Array;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

/** A Map-backed R2 bucket with the calls the edge makes. */
export const fakeBucket = () => {
  const objects = new Map<string, StoredObject>();
  const bucket = {
    async put(
      key: string,
      value: ArrayBuffer | Uint8Array,
      options: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      } = {},
    ) {
      const body = new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value));
      objects.set(key, { body, ...options });
      return { key, size: body.length };
    },
    async head(key: string) {
      const o = objects.get(key);
      return o === undefined
        ? null
        : { key, size: o.body.length, customMetadata: o.customMetadata };
    },
  };
  return { bucket, objects };
};

export type ApiCall = { method: CandidateMethod; input: Record<string, unknown> };
type ApiImpl = Partial<
  Record<CandidateMethod, (input: Record<string, unknown>) => Promise<unknown>>
>;

export interface Harness {
  key: TestKey;
  clock: Clock;
  env: Env;
  calls: ApiCall[];
  lines: string[];
  otp: ReturnType<typeof fakeOtpNamespace>;
  evidence: ReturnType<typeof fakeBucket>;
  /** The codes api was asked to send, in order. */
  codes: () => string[];
  request: (
    method: string,
    path: string,
    init?: { json?: unknown; body?: BodyInit; headers?: Record<string, string>; token?: string },
  ) => Promise<Response>;
  /** OTP request + verify; returns the lobby token. */
  login: () => Promise<string>;
}

export const NOW_MS = Date.UTC(2026, 9, 18, 9, 0, 0);

export const createHarness = async (overrides: ApiImpl = {}): Promise<Harness> => {
  const key = await makeKey(KID);
  const clock: Clock = { ms: NOW_MS };
  const calls: ApiCall[] = [];
  const lines: string[] = [];
  const otp = fakeOtpNamespace(clock);
  const evidence = fakeBucket();
  const nowSec = () => Math.floor(clock.ms / 1000);

  const defaults: Record<CandidateMethod, (input: Record<string, unknown>) => Promise<unknown>> = {
    inviteResolve: async () => ({
      invitationId: INVITATION,
      orgId: ORG,
      candidateId: CANDIDATE,
      state: 'sent',
      title: 'Demo assessment',
      durationMinutes: 20,
    }),
    messagingSend: async () => ({ ok: true }),
    lobbyMint: async (input) => {
      const iat = nowSec();
      const lobbyToken = await signToken(key, {
        sub: CANDIDATE,
        candidate_id: CANDIDATE,
        invitation_id: input.invitationId,
        org_id: input.orgId,
        typ: 'lobby',
        nonce: input.nonce,
        iat,
        exp: iat + 1800,
      });
      return { lobbyToken, expiresAt: new Date((iat + 1800) * 1000).toISOString(), next: 'age' };
    },
    ageDeclare: async (input) => ({ blocked: input.adult !== true }),
    noticeGet: async () => ({
      noticeVersionId: NOTICE_ID,
      language: 'en',
      bodyText: 'Synthetic notice text.',
      renderedSha256: NOTICE_SHA,
    }),
    consentRecord: async () => ({ ok: true }),
    photoPermit: async () => ({ orgId: ORG, sessionId: SESSION, locked: false }),
    sessionGrant: async () => {
      throw new Error('unavailable');
    },
    sessionStarted: async () => {
      throw new Error('unavailable');
    },
  };
  const api = Object.fromEntries(
    (Object.keys(defaults) as CandidateMethod[]).map((method) => [
      method,
      async (input: Record<string, unknown>) => {
        calls.push({ method, input });
        return (overrides[method] ?? defaults[method])(input);
      },
    ]),
  );

  const env = {
    VERSION: 'dev',
    CANDIDATE_APP_ORIGIN: ORIGIN,
    CANDIDATE_TOKEN_PUBLIC_JWK: publicVar(key),
    MIRROR_TRANSPORT: 'queue',
    API: api,
    OTP: otp.ns,
    EVIDENCE: evidence.bucket,
  } as unknown as Env;

  const app = createApp({ now: () => new Date(clock.ms), sink: (line) => lines.push(line) });

  const request: Harness['request'] = (method, path, init = {}) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
    let body = init.body;
    if (init.json !== undefined) {
      headers['content-type'] ??= 'application/json';
      body = JSON.stringify(init.json);
    }
    return Promise.resolve(
      app.request(
        `https://edge.test${path}`,
        { method, headers, ...(body === undefined ? {} : { body }) },
        env,
      ),
    );
  };

  const codes = () =>
    calls.filter((c) => c.method === 'messagingSend').map((c) => String(c.input.code));

  const login = async () => {
    const sent = await request('POST', '/v1/otp/request', { json: { token: LINK() } });
    if (sent.status !== 200) throw new Error(`otp request ${sent.status}`);
    const code = codes().at(-1) ?? '';
    const verified = await request('POST', '/v1/otp/verify', { json: { token: LINK(), code } });
    if (verified.status !== 200) throw new Error(`otp verify ${verified.status}`);
    return ((await verified.json()) as { lobbyToken: string }).lobbyToken;
  };

  return { key, clock, env, calls, lines, otp, evidence, codes, request, login };
};
