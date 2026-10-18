// AT-D32, edge half (specs/d1-demo-slice.md §9, L-23; CLAUDE.md "no PII in logs"): no link token, OTP code, lobby
// token, photo hash, event payload, label or contact reaches an edge log line. Two kinds of check:
//  - static, on the real production sources: nothing calls `console` directly, only route-support.ts builds a logger,
//    and every log call names a literal event from LOG_EVENTS with fields from LOG_FIELDS only, so a new log line is a
//    reviewed change to this file;
//  - dynamic: synthetic PII, link tokens, codes and tokens are planted in the request (body, query string, headers,
//    Bearer) and in the failures (the thrown error's message from api and from the OTP object), every logging path is
//    driven (rpc unavailable, otp lock, the shared 500 path), and none of the planted values appears in a line.
// Synthetic values are built at run time (no literal PII-shaped fixture sits in the repo).
import { describe, expect, it } from 'vitest';
import { sha256HexBytes, utf8 } from './encoding.js';
import {
  createHarness,
  NOTICE_ID,
  NOTICE_SHA,
  testJpeg,
  type Harness,
} from './edge.test-helpers.js';
import type { CandidateMethod } from './rpc.js';

declare global {
  interface ImportMeta {
    glob(
      patterns: string[],
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>;
  }
}

/** Every event a production log call may use (first argument of `debug|info|warn|error`). */
const LOG_EVENTS = ['candidate_rpc.unavailable', 'otp.locked'];
/** Every field a production log call may pass: ids and names only. */
const LOG_FIELDS = ['method', 'invitationId'];
/** The shared error path of @trace/workers-http (its message is dropped by serialize-error). */
const SHARED_EVENTS = ['request.failed'];

const allSources = import.meta.glob(['./**/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const production = Object.entries(allSources).filter(
  ([path]) => !/\.test(?:-helpers)?\.ts$/.test(path) && !path.endsWith('.d.ts'),
);

const LOG_CALL = /\.\s*(?:debug|info|warn|error)\s*\(\s*([^,)]*)(?:,\s*\{([^}]*)\})?/g;

/** The events and field names of every log call in a source. */
const logCalls = (text: string) =>
  [...text.matchAll(LOG_CALL)].map((m) => ({
    event: (m[1] ?? '').trim(),
    fields: (m[2] ?? '')
      .split(',')
      .map((f) => f.split(':')[0]?.trim() ?? '')
      .filter((f) => f !== ''),
  }));

// ---- synthetic values ---------------------------------------------------------------------------------------------
const letters = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => String.fromCharCode(97 + ((seed * 7 + i * 5) % 26))).join('');
const digits = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => String((seed * 3 + i * 7) % 10)).join('');
const SECRETS = {
  email: `${letters(7, 1)}.${letters(5, 2)}@${letters(6, 3)}.example`,
  mobile: `9${digits(9, 4)}`,
  label: `Candidate ${letters(6, 5)}`,
  link: `${letters(20, 6)}_${letters(22, 7)}`,
  jwt: ['eyJ' + letters(18, 8), 'eyJ' + letters(22, 9), letters(30, 10)].join('.'),
  sessionToken: ['eyJ' + letters(16, 11), 'eyJ' + letters(20, 12), letters(28, 13)].join('.'),
  wrongCode: digits(6, 14),
  answer: `answer text ${letters(12, 15)}`,
};

const query = () => `?t=${SECRETS.link}&e=${encodeURIComponent(SECRETS.email)}&s=${SECRETS.jwt}`;
const noisyHeaders = () => ({ 'x-contact': SECRETS.email, 'x-mobile': SECRETS.mobile });
const boom = () => new Error(`failed for ${Object.values(SECRETS).join(' ')}`);

/** Every CandidateRpc method failing with a message full of planted values. */
const failing = (methods: CandidateMethod[]) =>
  Object.fromEntries(methods.map((m) => [m, () => Promise.reject(boom())]));

const events = (lines: readonly string[]) =>
  lines.map((l) => (JSON.parse(l) as { event: string }).event);

const expectClean = (lines: readonly string[], extra: readonly string[] = []) => {
  const all = lines.join('\n');
  for (const value of [...Object.values(SECRETS), ...extra]) {
    expect(value.length).toBeGreaterThanOrEqual(6);
    expect(all).not.toContain(value);
  }
};

/** The lobby token and its three parts: none may appear in a line. */
const tokenParts = (token: string) => [token, ...token.split('.')];

describe('edge log lines carry no payload, token or code (AT-D32, edge half)', () => {
  it('finds a bad log call in a synthetic source, so the static scan can fail', () => {
    expect(logCalls("log.warn('otp.locked', { invitationId: id });")).toEqual([
      { event: "'otp.locked'", fields: ['invitationId'] },
    ]);
    expect(logCalls('logger.error(`x ${code}`, { code });')).toEqual([
      { event: '`x ${code}`', fields: ['code'] },
    ]);
  });

  it('production sources never call console, build a logger only in route-support, and log listed events only', () => {
    expect(production.map(([p]) => p)).toEqual(
      expect.arrayContaining(['./route-support.ts', './routes-invite.ts']),
    );
    const seen: string[] = [];
    for (const [path, text] of production) {
      expect({ path, console: /\bconsole\s*\./.test(text) }).toEqual({ path, console: false });
      if (path !== './route-support.ts') {
        expect({ path, logger: /\bcreateLogger\s*\(/.test(text) }).toEqual({ path, logger: false });
      }
      for (const call of logCalls(text)) {
        const event = /^'([a-z0-9_.]+)'$/.exec(call.event)?.[1];
        expect({ path, event }).toEqual({ path, event: expect.stringMatching(/./) });
        expect(LOG_EVENTS).toContain(event);
        for (const field of call.fields) expect(LOG_FIELDS).toContain(field);
        seen.push(String(event));
      }
    }
    // Every listed event is still used, so the list cannot grow stale and hide a removed check.
    expect([...new Set(seen)].sort()).toEqual([...LOG_EVENTS].sort());
  });

  it('link and OTP routes: api failures log the method only, never the link, contact or message', async () => {
    const h = await createHarness(failing(['inviteResolve']));
    for (const path of ['/v1/invite/resolve', '/v1/otp/request', '/v1/otp/verify']) {
      const res = await h.request('POST', path + query(), {
        json: { token: SECRETS.link, code: SECRETS.wrongCode },
        headers: noisyHeaders(),
      });
      // resolve and request take only `token`, so the extra `code` is a strict-parse 400 there; verify reaches api.
      expect([400, 503]).toContain(res.status);
    }
    for (const path of ['/v1/invite/resolve', '/v1/otp/request']) {
      const res = await h.request('POST', path + query(), {
        json: { token: SECRETS.link },
        headers: noisyHeaders(),
      });
      expect(res.status).toBe(503);
    }
    expect(events(h.lines)).toEqual(Array(3).fill('candidate_rpc.unavailable'));
    expectClean(h.lines);
  });

  it('a failed send logs the method only, never the issued code', async () => {
    const h = await createHarness(failing(['messagingSend']));
    const res = await h.request('POST', '/v1/otp/request' + query(), {
      json: { token: SECRETS.link },
      headers: noisyHeaders(),
    });
    expect(res.status).toBe(503);
    expect(h.codes()).toHaveLength(1);
    expect(events(h.lines)).toEqual(['candidate_rpc.unavailable']);
    expectClean(h.lines, h.codes());
  });

  it('the OTP lock logs the invitation id only, never the wrong codes or the issued code', async () => {
    const h = await createHarness();
    expect(
      (await h.request('POST', '/v1/otp/request', { json: { token: SECRETS.link } })).status,
    ).toBe(200);
    const issued = h.codes()[0] ?? '';
    const wrong = String((Number(issued) + 1) % 1_000_000).padStart(6, '0');
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await h.request('POST', '/v1/otp/verify' + query(), {
        json: { token: SECRETS.link, code: wrong },
        headers: noisyHeaders(),
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    expect(events(h.lines)).toEqual(['otp.locked']);
    expectClean(h.lines, [issued, wrong]);
  });

  it('lobby routes: api failures log the method only, never the lobby token, body or hash', async () => {
    const h = await createHarness(
      failing(['ageDeclare', 'noticeGet', 'consentRecord', 'photoPermit']),
    );
    const token = await h.login();
    const loginCodes = h.codes();
    // A valid JPEG (the bytes are checked before photoPermit, SEC-1) with the planted values in its scan data.
    const jpeg = testJpeg(640, 480);
    const photo = new Uint8Array([
      ...jpeg.slice(0, -2),
      ...utf8(`${SECRETS.answer} ${SECRETS.label}`),
      ...jpeg.slice(-2),
    ]);
    const photoSha = await sha256HexBytes(photo);
    const sends: [string, string, Parameters<Harness['request']>[2]][] = [
      ['POST', '/v1/lobby/age', { token, json: { adult: true }, headers: noisyHeaders() }],
      ['GET', '/v1/lobby/notice', { token, headers: noisyHeaders() }],
      [
        'POST',
        '/v1/lobby/consent',
        {
          token,
          json: { noticeVersionId: NOTICE_ID, renderedSha256: NOTICE_SHA, accepted: true },
          headers: noisyHeaders(),
        },
      ],
      [
        'PUT',
        '/v1/lobby/photo',
        {
          token,
          body: photo,
          headers: { ...noisyHeaders(), 'content-type': 'image/jpeg', 'x-photo-sha256': photoSha },
        },
      ],
    ];
    for (const [method, path, init] of sends) {
      expect((await h.request(method, path + query(), init)).status).toBe(503);
    }
    expect(events(h.lines)).toEqual(Array(4).fill('candidate_rpc.unavailable'));
    expectClean(h.lines, [...tokenParts(token), ...loginCodes, photoSha]);
  });

  it('a session-shaped or forged Bearer is refused without a log line', async () => {
    const h = await createHarness();
    for (const bearer of [SECRETS.sessionToken, SECRETS.jwt]) {
      const res = await h.request('GET', '/v1/lobby/notice' + query(), {
        token: bearer,
        headers: noisyHeaders(),
      });
      expect(res.status).toBe(401);
    }
    expect(h.lines).toEqual([]);
  });

  it('an unexpected failure reaches the shared 500 path, which logs no message, token or body', async () => {
    const h = await createHarness();
    const token = await h.login();
    const loginCodes = h.codes();
    // The OTP namespace itself throws (not an object call, which otpCall turns into 503): the shared path logs it.
    (h.env as unknown as { OTP: unknown }).OTP = {
      idFromName: () => {
        throw boom();
      },
      get: () => {
        throw boom();
      },
    };
    const lobby = await h.request('POST', '/v1/lobby/age' + query(), {
      token,
      json: { adult: true },
      headers: noisyHeaders(),
    });
    const request = await h.request('POST', '/v1/otp/request' + query(), {
      json: { token: SECRETS.link },
      headers: noisyHeaders(),
    });
    expect([lobby.status, request.status]).toEqual([500, 500]);
    expect(events(h.lines)).toEqual(['request.failed', 'request.failed']);
    expect(SHARED_EVENTS).toContain(events(h.lines)[0]);
    expectClean(h.lines, [...tokenParts(token), ...loginCodes]);
  });
});
