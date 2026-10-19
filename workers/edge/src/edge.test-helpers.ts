// Test harness for the candidate routes: the real app over a fake `API` (CandidateRpc, records every call), a fake
// `OTP` namespace whose objects are the real OtpCore on a Map-backed KV, a Map-backed R2 bucket for `EVIDENCE`, a
// movable clock and a captured log sink; for the session routes a fake `SESSION` namespace (the real SessionCore on a
// Map-backed KV and a recorded alarm slot), a Map-backed packages bucket and a fake mirror queue; and a fake
// `LINK_LIMITER` (the Workers Rate Limiting binding, OPEN-13) that allows by default and records every call. Keys are
// made at run time; ids and labels are synthetic.
import type { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { createLogger } from '@trace/shared/log';
import { createApp } from './app.js';
import { OtpCore } from './otp-core.js';
import { SessionCore, type SessionKv } from './session-core.js';
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

export class MapKv implements SessionKv {
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
  /** Entries whose key starts with `prefix`, in key order (as the SQLite-backed KV lists them). */
  list<T = unknown>(options: { prefix: string }): Iterable<[string, T]> {
    return [...this.map.keys()]
      .filter((key) => key.startsWith(options.prefix))
      .sort()
      .map((key): [string, T] => [key, structuredClone(this.map.get(key)) as T]);
  }
}

/** `transactionSync` on the fake KV: the closure runs alone; a throw restores every key it wrote. */
export const mapTransaction =
  (kv: MapKv) =>
  <T>(fn: () => T): T => {
    const before = new Map(kv.map);
    try {
      return fn();
    } catch (err) {
      kv.map.clear();
      for (const [key, value] of before) kv.map.set(key, value);
      throw err;
    }
  };

export interface Clock {
  ms: number;
}

/**
 * A fake DurableObjectNamespace: one OtpCore per name, on the shared clock. `names` records every id asked for;
 * `kvs` holds each object's storage so a test can check what was (not) written.
 */
export const fakeOtpNamespace = (clock: Clock) => {
  const cores = new Map<string, OtpCore>();
  const kvs = new Map<string, MapKv>();
  const names: string[] = [];
  const ns = {
    idFromName(name: string) {
      names.push(name);
      return { name, toString: () => name };
    },
    get(id: { name: string }) {
      let core = cores.get(id.name);
      if (core === undefined) {
        const kv = new MapKv();
        core = new OtpCore(kv, { now: () => clock.ms });
        cores.set(id.name, core);
        kvs.set(id.name, kv);
      }
      return core;
    },
  };
  return { ns, cores, kvs, names };
};

export interface StoredObject {
  body: Uint8Array;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

/**
 * A Map-backed R2 bucket with the calls the edge makes. `ops` records every put (`put:<key>`) and delete
 * (`delete:<key>`) in order; `failPuts`
 * makes the next puts throw; `calls` records every method name used (the packages bucket is read only).
 */
export const fakeBucket = (ops: string[] = []) => {
  const objects = new Map<string, StoredObject>();
  const calls: string[] = [];
  const state = { failPuts: 0, failGets: 0 };
  const bucket = {
    async put(
      key: string,
      value: ArrayBuffer | Uint8Array | string,
      options: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      } = {},
    ) {
      calls.push('put');
      if (state.failPuts > 0) {
        state.failPuts -= 1;
        throw new Error('r2 unavailable');
      }
      const body =
        typeof value === 'string'
          ? new TextEncoder().encode(value)
          : new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value));
      objects.set(key, { body, ...options });
      ops.push(`put:${key}`);
      return { key, size: body.length };
    },
    async head(key: string) {
      calls.push('head');
      const o = objects.get(key);
      return o === undefined
        ? null
        : { key, size: o.body.length, customMetadata: o.customMetadata };
    },
    async get(key: string) {
      calls.push('get');
      if (state.failGets > 0) {
        state.failGets -= 1;
        throw new Error('r2 unavailable');
      }
      const o = objects.get(key);
      if (o === undefined) return null;
      const copy = new Uint8Array(o.body);
      return {
        key,
        size: copy.length,
        httpMetadata: o.httpMetadata,
        customMetadata: o.customMetadata,
        arrayBuffer: async () => copy.buffer,
      };
    },
    async delete(key: string) {
      calls.push('delete');
      objects.delete(key);
      ops.push(`delete:${key}`);
    },
  };
  return { bucket, objects, calls, state };
};

/** The text of a stored object. */
export const objectText = (bucket: ReturnType<typeof fakeBucket>, key: string): string => {
  const o = bucket.objects.get(key);
  if (o === undefined) throw new Error(`no object ${key}`);
  return new TextDecoder().decode(o.body);
};

/** A fake mirror queue: records every accepted message; `fail` makes the next sends throw. */
export const fakeQueue = (ops: string[] = []) => {
  const sent: SessionMirrorMessage[] = [];
  const state = { fail: 0 };
  const queue = {
    async send(message: SessionMirrorMessage) {
      if (state.fail > 0) {
        state.fail -= 1;
        ops.push('send:fail');
        throw new Error('queue unavailable');
      }
      sent.push(structuredClone(message));
      ops.push('send');
    },
  };
  return { queue, sent, state };
};

/** A deterministic v4-shaped uuid for stream ids. */
export const counterIds = () => {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
};

export interface SessionParts {
  clock: Clock;
  evidence: ReturnType<typeof fakeBucket>;
  packages: ReturnType<typeof fakeBucket>;
  queue: ReturnType<typeof fakeQueue>;
  sink: (line: string) => void;
}

export interface FakeSession {
  core: SessionCore;
  kv: MapKv;
  alarm: { at: number | null };
}

/** One SessionCore on a Map-backed KV with the shared clock, buckets and queue. */
export const fakeSession = (parts: SessionParts): FakeSession => {
  const kv = new MapKv();
  const alarm = { at: null as number | null };
  const core = new SessionCore({
    kv,
    transaction: mapTransaction(kv),
    alarm: {
      set: (atMs) => {
        alarm.at = atMs;
      },
      clear: () => {
        alarm.at = null;
      },
    },
    packages: {
      get: async (key) => {
        const found = await parts.packages.bucket.get(key);
        if (found === null) return null;
        return {
          size: found.size,
          bytes: async () => new Uint8Array(await found.arrayBuffer()),
        };
      },
    },
    evidence: {
      put: async (key, body, contentType) => {
        await parts.evidence.bucket.put(key, body, { httpMetadata: { contentType } });
      },
    },
    mirror: { send: (message) => parts.queue.queue.send(message) },
    log: createLogger({ service: 'edge', version: 'dev', sink: parts.sink }),
    now: () => parts.clock.ms,
    newId: counterIds(),
  });
  return { core, kv, alarm };
};

/** A fake SESSION namespace: one fake session per name. `names` records every id asked for. */
export const fakeSessionNamespace = (parts: SessionParts) => {
  const sessions = new Map<string, FakeSession>();
  const names: string[] = [];
  const ns = {
    idFromName(name: string) {
      names.push(name);
      return { name, toString: () => name };
    },
    get(id: { name: string }) {
      let session = sessions.get(id.name);
      if (session === undefined) {
        session = fakeSession(parts);
        sessions.set(id.name, session);
      }
      return session.core;
    },
  };
  return { ns, sessions, names };
};

/** How the fake rate limiter answers its next calls. */
export type LimiterMode = 'allow' | 'deny' | 'throw' | 'reject' | 'malformed';

export interface LimiterCall {
  /** The exact options object the edge passed to `limit`. */
  options: unknown;
  /** How many CandidateRpc calls had been made when `limit` ran (so a test can check the order). */
  apiCallsBefore: number;
}

/**
 * A fake `RateLimit` binding: records every call, then answers by `state.mode` (`allow` → `{ success: true }`, `deny`
 * → `{ success: false }`, `throw` throws synchronously, `reject` rejects, `malformed` answers a non-boolean).
 */
export const fakeLimiter = (apiCalls: () => number) => {
  const calls: LimiterCall[] = [];
  const state: { mode: LimiterMode } = { mode: 'allow' };
  const limiter = {
    limit(options: unknown): Promise<unknown> {
      calls.push({ options: structuredClone(options), apiCallsBefore: apiCalls() });
      switch (state.mode) {
        case 'allow':
          return Promise.resolve({ success: true });
        case 'deny':
          return Promise.resolve({ success: false });
        case 'throw':
          throw new Error('limiter unavailable');
        case 'reject':
          return Promise.reject(new Error('limiter unavailable'));
        case 'malformed':
          return Promise.resolve({ success: 'yes' });
      }
    },
  };
  /** The keys passed so far, in order. */
  const keys = () => calls.map((c) => (c.options as { key?: unknown }).key);
  return { limiter, calls, state, keys };
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
  packages: ReturnType<typeof fakeBucket>;
  queue: ReturnType<typeof fakeQueue>;
  session: ReturnType<typeof fakeSessionNamespace>;
  limiter: ReturnType<typeof fakeLimiter>;
  /** Evidence puts and queue sends, in order. */
  ops: string[];
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
  const ops: string[] = [];
  const evidence = fakeBucket(ops);
  const packages = fakeBucket();
  const queue = fakeQueue(ops);
  const session = fakeSessionNamespace({
    clock,
    evidence,
    packages,
    queue,
    sink: (line) => lines.push(line),
  });
  const nowSec = () => Math.floor(clock.ms / 1000);
  const limiter = fakeLimiter(() => calls.length);

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
    SESSION: session.ns,
    PACKAGES: packages.bucket,
    MIRROR_QUEUE: queue.queue,
    LINK_LIMITER: limiter.limiter,
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

  return {
    key,
    clock,
    env,
    calls,
    lines,
    otp,
    evidence,
    packages,
    queue,
    session,
    limiter,
    ops,
    codes,
    request,
    login,
  };
};
