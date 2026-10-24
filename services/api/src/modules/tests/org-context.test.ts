// R3-1 (security review m4): the viewer id, aal and amr come only from a Supabase access token the api verified
// (signature against the JWKS, iss, aud, exp, role). Keys are generated at run time; the JWKS is served by a fake fetch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64UrlEncode, utf8 } from '../candidate/encoding.js';
import {
  createOrgDeps,
  createRest,
  createSupabaseVerifier,
  restErrorCode,
  RestError,
  unbound,
} from './org-context.js';

const SUPA = 'http://127.0.0.1:54321';
const USER = '0f000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-10-17T08:00:00.000Z');

const makeIssuer = async (kid = 'k1') => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  const jwks = {
    keys: [{ kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y, kid, alg: 'ES256', use: 'sig' }],
  };
  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = {}) => {
    const h = base64UrlEncode(utf8(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid, ...header })));
    const p = base64UrlEncode(utf8(JSON.stringify(claims)));
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      utf8(`${h}.${p}`),
    );
    return `${h}.${p}.${base64UrlEncode(new Uint8Array(sig))}`;
  };
  return { jwks, sign };
};

const goodClaims = (patch: Record<string, unknown> = {}) => ({
  sub: USER,
  iss: `${SUPA}/auth/v1`,
  aud: 'authenticated',
  role: 'authenticated',
  exp: Math.floor(NOW / 1000) + 3600,
  iat: Math.floor(NOW / 1000),
  aal: 'aal1',
  amr: [{ method: 'otp', timestamp: 1 }],
  email: 'p-recruiter@example.test',
  ...patch,
});

const setup = async () => {
  const issuer = await makeIssuer();
  let fetches = 0;
  const fakeFetch = (async (url: string) => {
    fetches += 1;
    if (url !== `${SUPA}/auth/v1/.well-known/jwks.json`) return new Response('no', { status: 404 });
    return Response.json(issuer.jwks);
  }) as unknown as typeof fetch;
  const verify = createSupabaseVerifier({ supabaseUrl: SUPA, fetch: fakeFetch, now: () => NOW });
  return { issuer, verify, fetches: () => fetches };
};

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof Error ? err.message : 'x';
  }
};

describe('createSupabaseVerifier', () => {
  it('returns the user id, aal and the amr methods of a valid token', async () => {
    const { issuer, verify } = await setup();
    const jwt = await issuer.sign(
      goodClaims({ aal: 'aal2', amr: [{ method: 'password' }, { method: 'totp' }, 'x', {}] }),
    );
    await expect(verify(`Bearer ${jwt}`)).resolves.toEqual({
      userId: USER,
      aal: 'aal2',
      amr: ['password', 'totp'],
      jwt,
    });
  });

  it('caches the JWKS', async () => {
    const { issuer, verify, fetches } = await setup();
    const jwt = await issuer.sign(goodClaims());
    await verify(`Bearer ${jwt}`);
    await verify(`Bearer ${jwt}`);
    expect(fetches()).toBe(1);
  });

  it.each([
    ['another issuer', { iss: 'https://evil.test/auth/v1' }],
    ['another audience', { aud: 'anon' }],
    ['the anon role', { role: 'anon' }],
    ['an expired token', { exp: Math.floor(NOW / 1000) - 1 }],
    ['an unknown aal', { aal: 'aal3' }],
    ['no aal', { aal: undefined }],
    ['a non-uuid sub', { sub: 'someone' }],
  ])('refuses %s', async (_name, patch) => {
    const { issuer, verify } = await setup();
    expect(await code(verify(`Bearer ${await issuer.sign(goodClaims(patch))}`))).toBe(
      'unauthorized',
    );
  });

  it('refuses another key, alg HS256, an unknown kid and a malformed header', async () => {
    const { verify } = await setup();
    const other = await makeIssuer();
    expect(await code(verify(`Bearer ${await other.sign(goodClaims())}`))).toBe('unauthorized');
    const { issuer } = await setup();
    expect(await code(verify(`Bearer ${await issuer.sign(goodClaims(), { alg: 'HS256' })}`))).toBe(
      'unauthorized',
    );
    expect(await code(verify(`Bearer ${await issuer.sign(goodClaims(), { kid: 'zz' })}`))).toBe(
      'unauthorized',
    );
    for (const h of [undefined, '', 'Basic abc', 'Bearer a.b', 'bearer x.y.z']) {
      expect(await code(verify(h))).toBe('unauthorized');
    }
  });

  it('is unavailable when the JWKS cannot be read', async () => {
    const { issuer } = await setup();
    const verify = createSupabaseVerifier({
      supabaseUrl: SUPA,
      fetch: (async () => new Response('down', { status: 503 })) as unknown as typeof fetch,
      now: () => NOW,
    });
    expect(await code(verify(`Bearer ${await issuer.sign(goodClaims())}`))).toBe('unavailable');
  });
});

describe('createRest', () => {
  it('calls PostgREST as the caller with the publishable key, and maps failures to codes', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      if (url.includes('fails')) {
        return Response.json(
          { code: '42501', message: 'permission denied for cand1@example.test' },
          { status: 403 },
        );
      }
      return Response.json([{ id: 1 }]);
    }) as unknown as typeof fetch;
    const rest = createRest(
      { supabaseUrl: SUPA, publishableKey: 'sb_publishable_test', fetch: fakeFetch },
      { userId: USER, aal: 'aal1', amr: [], jwt: 'h.p.s' },
    );
    expect(await rest.select('tests', { select: 'id', id: 'eq.1' })).toEqual([{ id: 1 }]);
    expect(seen[0]?.url).toBe(`${SUPA}/rest/v1/tests?select=id&id=eq.1`);
    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer h.p.s');
    expect(headers.apikey).toBe('sb_publishable_test');
    let failure: unknown;
    try {
      await rest.select('fails', {});
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(RestError);
    expect(String((failure as Error).message)).toBe('rest_failed');
    expect(restErrorCode(failure)).toBe('not_found');
    await expect(rest.select('Robert; drop', {})).rejects.toBeInstanceOf(RestError);
  });
});

describe('fetch is never called as a method (workerd: "Illegal invocation")', () => {
  // A strict-mode function standing in for workerd's fetch: it refuses any `this` but none or the global one.
  const strictFetch = (seen: unknown[]) =>
    function (this: unknown, url: string) {
      seen.push(this);
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      if (url.endsWith('/.well-known/jwks.json'))
        return Promise.resolve(Response.json({ keys: [] }));
      return Promise.resolve(Response.json([]));
    } as unknown as typeof fetch;

  it('the verifier and the PostgREST client call the injected fetch unbound', async () => {
    const seen: unknown[] = [];
    const verify = createSupabaseVerifier({
      supabaseUrl: SUPA,
      fetch: strictFetch(seen),
      now: () => NOW,
    });
    const issuer = await makeIssuer();
    // An empty JWKS: the token is refused as unauthorized (not unavailable), so the fetch itself succeeded.
    expect(await code(verify(`Bearer ${await issuer.sign(goodClaims())}`))).toBe('unauthorized');
    const rest = createRest(
      { supabaseUrl: SUPA, publishableKey: 'pk', fetch: strictFetch(seen) },
      { userId: USER, aal: 'aal1', amr: ['otp'], jwt: 'h.p.s' },
    );
    expect(await rest.select('tests', { select: 'id' })).toEqual([]);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const t of seen) expect(t === undefined || t === globalThis).toBe(true);
  });

  it('unbound() drops a foreign this', async () => {
    const seen: unknown[] = [];
    const holder = { f: unbound(strictFetch(seen)) };
    await holder.f('https://api.test/x');
    expect(seen).toHaveLength(1);
    expect(seen[0] === undefined || seen[0] === globalThis).toBe(true);
  });
});

// Spec review r3 reports #1 and r3a #5b: the production default, with no injected fetcher, calls the global fetch
// unbound. The stub refuses a foreign `this` the way workerd's fetch does ("Illegal invocation").
describe('createOrgDeps() default fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reaches JWKS and PostgREST through the global fetch, never as a method call', async () => {
    const issuer = await makeIssuer();
    const urls: string[] = [];
    vi.stubGlobal('fetch', function (this: unknown, input: string | URL | Request) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      urls.push(url.split('?')[0] ?? url);
      if (url.endsWith('/auth/v1/.well-known/jwks.json'))
        return Promise.resolve(Response.json(issuer.jwks));
      return Promise.resolve(Response.json([]));
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const jwt = await issuer.sign(goodClaims({ iat: nowSec, exp: nowSec + 600 }));
    const deps = createOrgDeps();
    const env = {
      SUPABASE_URL: SUPA,
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    } as unknown as Env;
    const ctx = await deps.context(
      new Request('https://api.test/v1/orgs/x', { headers: { authorization: `Bearer ${jwt}` } }),
      env,
    );
    expect(ctx.caller.userId).toBe(USER);
    expect(await ctx.rest.select('tests', { select: 'id' })).toEqual([]);
    expect(urls).toEqual([`${SUPA}/auth/v1/.well-known/jwks.json`, `${SUPA}/rest/v1/tests`]);
  });
});
