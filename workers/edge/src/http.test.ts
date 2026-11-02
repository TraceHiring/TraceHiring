// The common edge rules (specs/d1-demo-slice.md §4.2): JSON in and out, `cache-control: no-store` on every answer,
// constant `{ "error": "<code>" }` bodies, CORS for exactly CANDIDATE_APP_ORIGIN, body caps before parsing, identity
// keys discarded before the strict parse, Bearer only.
import { CANDIDATE_ERROR_CODES, CANDIDATE_ERROR_STATUS } from '@trace/shared/contracts/candidate';
import { createHttpApp } from '@trace/workers-http';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from './app.js';
import {
  bearer,
  candidateCors,
  capBody,
  errorResponse,
  fail,
  handle,
  noStore,
  readJson,
  sendJson,
  type EdgeEnv,
} from './http.js';

const ORIGIN = 'https://candidate.example.test';
const ENV = { VERSION: 'dev', CANDIDATE_APP_ORIGIN: ORIGIN } as Env;

/** A small app with the same middleware, so the helpers can be driven directly. */
const probeApp = () => {
  const app = createHttpApp<EdgeEnv>('edge');
  app.use('/v1/*', noStore, candidateCors());
  const Body = z.strictObject({ adult: z.boolean() });
  app.post(
    '/v1/probe',
    capBody(128),
    handle(async (c) => {
      const body = await readJson(c, Body);
      return sendJson(c, z.strictObject({ ok: z.literal(true), adult: z.boolean() }), {
        ok: true,
        adult: body.adult,
      });
    }),
  );
  app.get(
    '/v1/unavailable',
    handle(async () => fail('unavailable')),
  );
  app.get(
    '/v1/limited',
    handle(async () => fail('rate_limited', 42)),
  );
  app.get(
    '/v1/bad-answer',
    handle(async (c) =>
      sendJson(c, z.strictObject({ ok: z.literal(true) }), { ok: false } as never),
    ),
  );
  app.get(
    '/v1/bearer',
    handle(async (c) => c.json({ length: bearer(c).length })),
  );
  return app;
};

const post = (body: string, headers: Record<string, string> = {}) =>
  probeApp().request(
    'https://edge.test/v1/probe',
    { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } },
    ENV,
  );

describe('error bodies', () => {
  it.each(CANDIDATE_ERROR_CODES)(
    '%s answers exactly {"error":"%s"} with its status',
    async (code) => {
      const res = errorResponse(code);
      expect(res.status).toBe(CANDIDATE_ERROR_STATUS[code]);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.text()).toBe(JSON.stringify({ error: code }));
    },
  );

  it('a 503 is answered as 503 unavailable, not as the logged 500', async () => {
    const res = await probeApp().request('https://edge.test/v1/unavailable', undefined, ENV);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('a 429 carries Retry-After', async () => {
    const res = await probeApp().request('https://edge.test/v1/limited', undefined, ENV);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(await res.json()).toEqual({ error: 'rate_limited' });
  });

  it('an answer that does not fit its contract is unavailable', async () => {
    const res = await probeApp().request('https://edge.test/v1/bad-answer', undefined, ENV);
    expect(res.status).toBe(503);
  });
});

describe('JSON bodies', () => {
  it('accepts a strict body', async () => {
    const res = await post('{"adult":true}');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true, adult: true });
  });

  it.each(['invitationId', 'sessionId', 'orgId', 'candidateId'])(
    'discards the identity key %s before the strict parse',
    async (key) => {
      const res = await post(JSON.stringify({ adult: false, [key]: crypto.randomUUID() }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, adult: false });
    },
  );

  it.each([
    ['an unknown key', '{"adult":true,"extra":1}'],
    ['a wrong type', '{"adult":"yes"}'],
    ['not JSON', '{adult:true'],
    ['an empty body', ''],
    ['an array', '[]'],
  ])('answers 400 bad_request for %s', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it.each([['text/plain'], ['application/x-www-form-urlencoded'], ['multipart/form-data']])(
    'refuses content-type %s (a browser must preflight)',
    async (type) => {
      const res = await post('{"adult":true}', { 'content-type': type });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_request' });
    },
  );

  it('answers 413 too_large over the cap, before parsing', async () => {
    const res = await post(JSON.stringify({ adult: true, pad: 'x'.repeat(200) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too_large' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 413 for a streamed body without content-length', async () => {
    const big = new TextEncoder().encode(JSON.stringify({ adult: true, pad: 'y'.repeat(200) }));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    const res = await probeApp().request(
      'https://edge.test/v1/probe',
      {
        method: 'POST',
        body: stream,
        headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        duplex: 'half',
      } as RequestInit,
      ENV,
    );
    expect(res.status).toBe(413);
  });
});

describe('Bearer only', () => {
  const call = (headers: Record<string, string>) =>
    probeApp().request('https://edge.test/v1/bearer', { headers }, ENV);

  it('reads the Bearer credential', async () => {
    const res = await call({ authorization: 'Bearer abc.def.ghi' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ length: 11 });
  });

  it.each([
    ['no header', {}],
    ['a cookie only', { cookie: 'token=abc.def.ghi' }],
    ['another scheme', { authorization: 'Basic abc' }],
    ['an empty Bearer', { authorization: 'Bearer ' }],
    ['a Bearer with spaces', { authorization: 'Bearer a b' }],
  ])('answers 401 token_invalid with %s', async (_label, headers) => {
    const res = await call(headers as Record<string, string>);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'token_invalid' });
  });
});

describe('CORS on /v1 (the real app)', () => {
  const app = createApp();

  it('allows exactly CANDIDATE_APP_ORIGIN, with the three headers and max-age 600', async () => {
    const res = await app.request(
      'https://edge.test/v1/otp/request',
      {
        method: 'OPTIONS',
        headers: {
          origin: ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      },
      ENV,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'authorization,content-type,x-photo-sha256',
    );
    expect(res.headers.get('access-control-max-age')).toBe('600');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['another origin', 'https://evil.example.test'],
    ['a sub-domain of the app', `https://x.${ORIGIN.slice('https://'.length)}`],
    ['the null origin', 'null'],
  ])('allows no %s', async (_label, origin) => {
    const res = await app.request(
      'https://edge.test/v1/otp/request',
      { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } },
      ENV,
    );
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('allows no origin at all when CANDIDATE_APP_ORIGIN is unset or empty', async () => {
    for (const value of [undefined, '']) {
      const res = await app.request(
        'https://edge.test/v1/otp/request',
        { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } },
        { VERSION: 'dev', CANDIDATE_APP_ORIGIN: value } as Env,
      );
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('an unknown /v1 path is the JSON 404, never cached, with the CORS header', async () => {
    const res = await app.request(
      'https://edge.test/v1/nope',
      { headers: { origin: ORIGIN } },
      ENV,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });
});
