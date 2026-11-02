// OPEN-13 (specs/d1-demo-slice.md §4.2, §11; C1a security review SEC-2): a coarse volumetric limit at the edge for the
// three routes that reach api's database with a raw link token. The key is one constant per route, never a value from
// the request (rule 7: an IP is never a signal; no personal data). The body is capped and strictly parsed first, so a
// malformed body is 400 and does not count; a refusal is 429 `rate_limited` with `Retry-After: 10` and no rpc; a
// missing or failing limiter fails closed (503 `unavailable`). The limit records nothing per candidate. The lobby,
// photo and session routes never call it. Synthetic data only.
import type { SessionView } from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import wranglerText from '../wrangler.jsonc?raw';
import { sha256HexBytes } from './encoding.js';
import {
  createHarness,
  LINK,
  NOTICE_ID,
  NOTICE_SHA,
  ORIGIN,
  testJpeg,
  type Harness,
  type LimiterMode,
} from './edge.test-helpers.js';
import { heartbeat, postEvents, sessionHarness } from './session.test-helpers.js';

type LinkRoute = { path: string; key: string; label: string; body: () => Record<string, unknown> };

/**
 * JSONC as wrangler reads it (line and block comments, trailing commas), string-aware: the same algorithm as
 * scripts/check-boundaries.mjs `parseJsonc`, which a workerd test cannot import (the edge may import no repo script).
 */
const parseJsonc = (text: string): unknown => {
  const skipString = (src: string, at: number): number => {
    let j = at + 1;
    while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
    return j + 1;
  };
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text[i] === '"') {
      const end = skipString(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (text.startsWith('//', i)) {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated block comment');
      i = end + 2;
    } else {
      out += text[i];
      i += 1;
    }
  }
  let clean = '';
  for (let k = 0; k < out.length;) {
    if (out[k] === '"') {
      const end = skipString(out, k);
      clean += out.slice(k, end);
      k = end;
    } else {
      if (!(out[k] === ',' && /^\s*[}\]]/.test(out.slice(k + 1)))) clean += out[k];
      k += 1;
    }
  }
  return JSON.parse(clean) as unknown;
};

const ROUTES: LinkRoute[] = [
  {
    path: '/v1/invite/resolve',
    key: 'link:resolve',
    label: 'resolve',
    body: () => ({ token: LINK() }),
  },
  {
    path: '/v1/otp/request',
    key: 'link:otp_request',
    label: 'otp_request',
    body: () => ({ token: LINK() }),
  },
  {
    path: '/v1/otp/verify',
    key: 'link:otp_verify',
    label: 'otp_verify',
    body: () => ({ token: LINK(), code: '000000' }),
  },
];

const post = (h: Harness, route: LinkRoute, headers: Record<string, string> = {}) =>
  h.request('POST', route.path, { json: route.body(), headers });

interface LogLine {
  level: string;
  event: string;
  data?: Record<string, unknown>;
}
const parsed = (h: Harness): LogLine[] => h.lines.map((l) => JSON.parse(l) as LogLine);

describe('the link-token routes call the limiter with one constant key, after the parse and before api', () => {
  it.each(ROUTES)('$path calls limit({ key: "$key" }) once, before any api call', async (route) => {
    const h = await createHarness();
    const res = await post(h, route);

    // resolve and request succeed; verify with an unissued code is refused by the OTP object, after the limit.
    expect([200, 401]).toContain(res.status);
    expect(h.limiter.calls).toEqual([{ options: { key: route.key }, apiCallsBefore: 0 }]);
    expect(h.calls[0]?.method).toBe('inviteResolve');
  });

  it('the key never carries the link token, an id, a header or the client address', async () => {
    const h = await createHarness();
    for (const route of ROUTES) {
      await post(h, route, {
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '198.51.100.9',
        'user-agent': 'synthetic-agent',
      });
    }
    expect(h.limiter.keys()).toEqual(['link:resolve', 'link:otp_request', 'link:otp_verify']);
    const text = JSON.stringify(h.limiter.calls);
    for (const value of [LINK(), '203.0.113.7', '198.51.100.9', 'synthetic-agent']) {
      expect(text).not.toContain(value);
    }
  });

  it.each(ROUTES)('$path: a malformed body is 400 or 413 and is not counted', async (route) => {
    const h = await createHarness();
    const bad: [number, Parameters<Harness['request']>[2]][] = [
      [400, { body: '{not json', headers: { 'content-type': 'application/json' } }],
      [400, { json: route.body(), headers: { 'content-type': 'text/plain' } }],
      [400, { json: { ...route.body(), extra: true } }],
      [400, { json: {} }],
      [413, { json: { ...route.body(), pad: 'x'.repeat(5000) } }],
    ];
    for (const [status, init] of bad) {
      expect((await h.request('POST', route.path, init)).status).toBe(status);
    }
    expect(h.limiter.calls).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it('a CORS preflight is not counted', async () => {
    const h = await createHarness();
    for (const route of ROUTES) {
      const res = await h.request('OPTIONS', route.path, {
        headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
      });
      expect(res.status).toBe(204);
    }
    expect(h.limiter.calls).toEqual([]);
  });
});

describe('a refusal is 429 rate_limited with Retry-After: 10, and api is never called', () => {
  it.each(ROUTES)('$path', async (route) => {
    const h = await createHarness();
    h.limiter.state.mode = 'deny';
    const res = await post(h, route, { origin: ORIGIN });

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(res.headers.get('retry-after')).toBe('10');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-expose-headers')).toContain('retry-after');
    expect(h.limiter.keys()).toEqual([route.key]);
    expect(h.calls).toEqual([]);
    // No InviteOtpDO is addressed either: the refusal happens before the link is resolved.
    expect(h.otp.names).toEqual([]);
  });
});

describe('a missing or failing limiter fails closed: 503 unavailable, no api call', () => {
  const FAILURES: ['missing' | Exclude<LimiterMode, 'allow' | 'deny'>][] = [
    ['missing'],
    ['throw'],
    ['reject'],
    ['malformed'],
  ];

  it.each(FAILURES)('%s', async (failure) => {
    for (const route of ROUTES) {
      const h = await createHarness();
      if (failure === 'missing') {
        delete (h.env as unknown as { LINK_LIMITER?: unknown }).LINK_LIMITER;
      } else {
        h.limiter.state.mode = failure;
      }
      const res = await post(h, route, { origin: ORIGIN });

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'unavailable' });
      expect(res.headers.get('retry-after')).toBeNull();
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      expect(h.calls).toEqual([]);
      expect(parsed(h)).toEqual([
        expect.objectContaining({
          level: 'error',
          event: 'edge.rate_limiter_error',
          data: { route: route.label },
        }),
      ]);
    }
  });
});

describe('refusals are logged at most once per route per 10 s, with the route label only', () => {
  it('two refusals within 10 s log one line; 10 s later another', async () => {
    const h = await createHarness();
    h.limiter.state.mode = 'deny';
    const resolve = ROUTES[0];
    if (resolve === undefined) throw new Error('no route');

    for (let i = 0; i < 5; i += 1) expect((await post(h, resolve)).status).toBe(429);
    h.clock.ms += 9_999;
    expect((await post(h, resolve)).status).toBe(429);
    expect(parsed(h)).toEqual([
      expect.objectContaining({
        level: 'warn',
        event: 'edge.rate_limited',
        data: { route: 'resolve' },
      }),
    ]);

    h.clock.ms += 1;
    expect((await post(h, resolve)).status).toBe(429);
    expect(parsed(h).map((l) => l.event)).toEqual(['edge.rate_limited', 'edge.rate_limited']);
  });

  it('each route has its own window', async () => {
    const h = await createHarness();
    h.limiter.state.mode = 'deny';
    for (const route of [...ROUTES, ...ROUTES]) expect((await post(h, route)).status).toBe(429);
    expect(parsed(h).map((l) => l.data)).toEqual([
      { route: 'resolve' },
      { route: 'otp_request' },
      { route: 'otp_verify' },
    ]);
  });

  it('a limiter error is logged at most once per route per 10 s as well', async () => {
    const h = await createHarness();
    h.limiter.state.mode = 'reject';
    const resolve = ROUTES[0];
    if (resolve === undefined) throw new Error('no route');
    for (let i = 0; i < 3; i += 1) expect((await post(h, resolve)).status).toBe(503);
    h.clock.ms += 10_000;
    expect((await post(h, resolve)).status).toBe(503);
    expect(parsed(h).map((l) => l.event)).toEqual([
      'edge.rate_limiter_error',
      'edge.rate_limiter_error',
    ]);
  });

  it('an allowed call logs nothing', async () => {
    const h = await createHarness();
    for (const route of ROUTES) await post(h, route);
    expect(h.lines).toEqual([]);
  });
});

describe('only the three link-token routes are limited', () => {
  it('the lobby, photo and session routes never call the limiter', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    expect(h.limiter.keys()).toEqual(['link:otp_request', 'link:otp_verify']);
    // From here on any limiter call would fail its route (503), so a stray call cannot pass unnoticed.
    h.limiter.state.mode = 'throw';
    const photo = testJpeg(640, 480);
    const statuses = [
      await h.request('POST', '/v1/lobby/age', { token: lobby, json: { adult: true } }),
      await h.request('GET', '/v1/lobby/notice', { token: lobby }),
      await h.request('POST', '/v1/lobby/consent', {
        token: lobby,
        json: { noticeVersionId: NOTICE_ID, renderedSha256: NOTICE_SHA, accepted: true },
      }),
      await h.request('PUT', '/v1/lobby/photo', {
        token: lobby,
        body: photo,
        headers: { 'content-type': 'image/jpeg', 'x-photo-sha256': await sha256HexBytes(photo) },
      }),
    ].map((r) => r.status);
    expect(statuses).toEqual([200, 200, 200, 200]);

    const started = await h.request('POST', '/v1/session/start', {
      token: lobby,
      json: { rulesAcknowledged: true, photo: { skippedReason: 'declined' } },
    });
    expect(started.status).toBe(200);
    const { sessionToken: token, view } = (await started.json()) as {
      sessionToken: string;
      view: SessionView;
    };
    const items = await h.request('GET', '/v1/session/items/1', { token });
    expect(items.status).toBe(200);
    expect((await postEvents(h, token, view.streamId, [heartbeat(1)])).status).toBe(200);
    const submitted = await h.request('POST', '/v1/session/submit', {
      token,
      json: { streamId: view.streamId, finalSeq: 1 },
    });
    expect(submitted.status).toBe(200);
    expect((await h.request('POST', '/v1/session/attach', { token })).status).not.toBe(503);

    expect(h.limiter.keys()).toEqual(['link:otp_request', 'link:otp_verify']);
  });
});

describe('wrangler.jsonc binds LINK_LIMITER in dev and staging only', () => {
  type Ratelimit = { name?: unknown; namespace_id?: unknown; simple?: unknown };
  type Block = { name?: unknown; ratelimits?: Ratelimit[] };
  const config = parseJsonc(wranglerText) as Block & { env: Record<string, Block> };

  it('reads the real file (guards the parse)', () => {
    expect(config.name).toBe('trace-edge');
    expect(config.env.staging?.name).toBe('trace-edge-staging');
  });

  it('the top level binds no rate limiter (the edge test pool relies on it)', () => {
    expect(config).not.toHaveProperty('ratelimits');
  });

  it.each(['dev', 'staging'])(
    'env.%s has exactly one LINK_LIMITER: simple, 300 per 10 s',
    (env) => {
      const block = config.env[env];
      expect(block?.ratelimits).toEqual([
        {
          name: 'LINK_LIMITER',
          namespace_id: expect.stringMatching(/^[0-9]+$/),
          simple: { limit: 300, period: 10 },
        },
      ]);
    },
  );

  it('dev and staging use distinct namespace ids (one id would share counters)', () => {
    const ids = ['dev', 'staging'].map((env) => config.env[env]?.ratelimits?.[0]?.namespace_id);
    expect(ids).toEqual(['1101', '1102']);
    expect(new Set(ids).size).toBe(2);
  });

  it('no other env block exists that could miss the binding', () => {
    expect(Object.keys(config.env).sort()).toEqual(['dev', 'staging']);
  });
});
