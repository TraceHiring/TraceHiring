// AT-D23 (specs/d1-demo-slice.md §4.3, §4.8): the edge token verifier. Wrong `alg` or `none`, unknown `kid`, wrong
// `typ`, lifetime over the cap, expired `exp`, `iat` beyond the skew, an edited claim with the original signature: all
// 401. A missing, empty, malformed or private key var fails closed (503), never a pass. Keys are generated at run time.
import { beforeAll, describe, expect, it } from 'vitest';
import { base64UrlEncode, sha256HexBytes, utf8 } from './encoding.js';
import { createHarness, testJpeg, type Harness } from './edge.test-helpers.js';
import { EdgeError } from './http.js';
import {
  CANDIDATE,
  INVITATION,
  KID,
  lobbyClaims,
  makeKey,
  OLD_KID,
  ORG,
  OTHER_INVITATION,
  publicVar,
  signToken,
  type TestKey,
} from './token.test-helpers.js';
import { parsePublicJwks, verifyCandidateToken, type TokenTyp } from './token.js';

const NOW = 1_790_000_000;

let key: TestKey;
let oldKey: TestKey;
let strangerKey: TestKey;
let env: Env;

beforeAll(async () => {
  key = await makeKey(KID);
  oldKey = await makeKey(OLD_KID);
  strangerKey = await makeKey('d1-2026-08');
  env = { VERSION: 'dev', CANDIDATE_TOKEN_PUBLIC_JWK: publicVar(key, oldKey) } as Env;
});

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (err) {
    if (err instanceof EdgeError) return err.code;
    throw err;
  }
  return 'passed';
};

const verify = (token: string, typ: TokenTyp = 'lobby', nowSec = NOW, e: Env = env) =>
  codeOf(verifyCandidateToken(token, e, typ, nowSec));

const part = (value: unknown): string => base64UrlEncode(utf8(JSON.stringify(value)));

describe('verifyCandidateToken (AT-D23)', () => {
  it('accepts a valid lobby token and returns its claims', async () => {
    const token = await signToken(key, lobbyClaims(NOW));
    const claims = await verifyCandidateToken(token, env, 'lobby', NOW);
    expect(claims).toMatchObject({ invitation_id: INVITATION, org_id: ORG, sub: CANDIDATE });
  });

  it('accepts a token under the previous key during rotation', async () => {
    expect(await verify(await signToken(oldKey, lobbyClaims(NOW)))).toBe('passed');
  });

  it('accepts a session token up to the 10 800 s cap', async () => {
    const token = await signToken(key, lobbyClaims(NOW, { typ: 'session', exp: NOW + 10_800 }));
    expect(await verify(token, 'session')).toBe('passed');
  });

  it.each([
    ['HS256', { alg: 'HS256', typ: 'JWT', kid: KID }],
    ['none', { alg: 'none', typ: 'JWT', kid: KID }],
    ['RS256', { alg: 'RS256', typ: 'JWT', kid: KID }],
    ['no alg', { typ: 'JWT', kid: KID }],
    ['a wrong header typ', { alg: 'ES256', typ: 'JOSE', kid: KID }],
    ['an extra header member', { alg: 'ES256', typ: 'JWT', kid: KID, jku: 'https://x.test' }],
  ])('rejects alg %s with 401 token_invalid', async (_label, header) => {
    expect(await verify(await signToken(key, lobbyClaims(NOW), header))).toBe('token_invalid');
  });

  it('rejects alg none with an empty signature before any key is needed', async () => {
    const token = `${part({ alg: 'none', typ: 'JWT', kid: KID })}.${part(lobbyClaims(NOW))}.`;
    expect(await verify(token)).toBe('token_invalid');
    expect(await verify(token, 'lobby', NOW, { VERSION: 'dev' } as Env)).toBe('token_invalid');
  });

  it('rejects an unknown kid', async () => {
    const token = await signToken(strangerKey, lobbyClaims(NOW));
    expect(await verify(token)).toBe('token_invalid');
  });

  it('rejects a known kid signed by another key', async () => {
    const token = await signToken(strangerKey, lobbyClaims(NOW), {
      alg: 'ES256',
      typ: 'JWT',
      kid: KID,
    });
    expect(await verify(token)).toBe('token_invalid');
  });

  it.each([
    ['lobby on a session route', 'lobby', 'session'],
    ['session on a lobby route', 'session', 'lobby'],
    ['portal on a lobby route', 'portal', 'lobby'],
    ['portal on a session route', 'portal', 'session'],
  ] as const)('rejects typ %s', async (_label, claimTyp, routeTyp) => {
    const token = await signToken(key, lobbyClaims(NOW, { typ: claimTyp, exp: NOW + 600 }));
    expect(await verify(token, routeTyp)).toBe('token_invalid');
  });

  it('rejects a lobby lifetime over 1800 s', async () => {
    const token = await signToken(key, lobbyClaims(NOW, { exp: NOW + 1801 }));
    expect(await verify(token)).toBe('token_invalid');
  });

  it('rejects a session lifetime over 10 800 s', async () => {
    const token = await signToken(key, lobbyClaims(NOW, { typ: 'session', exp: NOW + 10_801 }));
    expect(await verify(token, 'session')).toBe('token_invalid');
  });

  it('rejects an expired token with 401 token_expired, and exp == now too', async () => {
    const token = await signToken(key, lobbyClaims(NOW - 1800, { exp: NOW }));
    expect(await verify(token)).toBe('token_expired');
    expect(await verify(token, 'lobby', NOW - 1)).toBe('passed');
  });

  it('allows iat up to 60 s ahead and rejects it beyond', async () => {
    expect(await verify(await signToken(key, lobbyClaims(NOW + 60)))).toBe('passed');
    expect(await verify(await signToken(key, lobbyClaims(NOW + 61)))).toBe('token_invalid');
  });

  it.each([
    ['org_id', { org_id: '99999999-9999-4999-8999-999999999999' }],
    ['invitation_id', { invitation_id: OTHER_INVITATION }],
    ['sub', { sub: OTHER_INVITATION }],
    ['typ', { typ: 'session' }],
    ['exp', { exp: NOW + 1700 }],
    ['nonce', { nonce: 'another-nonce-0123456789' }],
  ])('rejects an edited %s with the original signature (AT-D11 a)', async (_label, edit) => {
    const token = await signToken(key, lobbyClaims(NOW));
    const [h, , s] = token.split('.');
    const forged = `${h}.${part({ ...lobbyClaims(NOW), ...edit })}.${s}`;
    expect(await verify(forged, 'lobby')).toBe('token_invalid');
    expect(await verify(forged, 'session')).toBe('token_invalid');
  });

  it.each([
    ['sub differs from candidate_id', { sub: OTHER_INVITATION }],
    ['an extra claim', { email: ['pat', 'example.test'].join('@') }],
    ['a short nonce', { nonce: 'short' }],
    ['a fractional iat', { iat: NOW + 0.5 }],
    ['a non-uuid org', { org_id: 'org-1' }],
    ['exp before iat', { exp: NOW - 1 }],
  ])('rejects claims with %s (strict shape)', async (_label, edit) => {
    expect(await verify(await signToken(key, lobbyClaims(NOW, edit)))).toBe('token_invalid');
  });

  it.each([
    ['two parts', 'a.b'],
    ['four parts', 'a.b.c.d'],
    ['a padded signature', 'x.y.z='],
    ['garbage', '...'],
  ])('rejects a malformed token: %s', async (_label, token) => {
    expect(await verify(token)).toBe('token_invalid');
  });

  it('rejects a DER-length signature', async () => {
    const token = await signToken(key, lobbyClaims(NOW));
    const [h, p] = token.split('.');
    const long = base64UrlEncode(new Uint8Array(72));
    expect(await verify(`${h}.${p}.${long}`)).toBe('token_invalid');
  });
});

describe('the public key var fails closed', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['not JSON', '{'],
    ['an object, not an array', 'OBJECT'],
    ['an empty array', '[]'],
    ['three keys', 'THREE'],
    ['a duplicate kid', 'DUP'],
    ['a key with a private member', 'PRIVATE'],
    ['a key without kid', 'NOKID'],
    ['a kid of the wrong form', 'BADKID'],
  ])('a %s var answers 503 unavailable, never a pass', async (_label, kind) => {
    const jwk = key.publicJwk;
    const text =
      kind === 'OBJECT'
        ? JSON.stringify(jwk)
        : kind === 'THREE'
          ? publicVar(key, oldKey, strangerKey)
          : kind === 'DUP'
            ? JSON.stringify([jwk, jwk])
            : kind === 'PRIVATE'
              ? JSON.stringify([{ ...jwk, d: jwk.x }])
              : kind === 'NOKID'
                ? JSON.stringify([{ ...jwk, kid: undefined }])
                : kind === 'BADKID'
                  ? JSON.stringify([{ ...jwk, kid: 'k1' }])
                  : kind;
    const token = await signToken(key, lobbyClaims(NOW));
    expect(
      await verify(token, 'lobby', NOW, {
        VERSION: 'dev',
        CANDIDATE_TOKEN_PUBLIC_JWK: text,
      } as Env),
    ).toBe('unavailable');
  });

  it('parsePublicJwks refuses a private member explicitly', async () => {
    await expect(
      parsePublicJwks(JSON.stringify([{ ...key.publicJwk, d: key.publicJwk.x }])),
    ).rejects.toThrow('verify_keys_invalid');
  });
});

describe('lobby routes refuse a bad token before api is called (AT-D23, route level)', () => {
  type RouteBody = { json?: unknown; body?: Uint8Array; headers?: Record<string, string> };
  const photo = testJpeg(640, 480);
  /** The request body of each lobby route; the photo route sends raw JPEG bytes with their hash header. */
  const ROUTES: [string, string, () => Promise<RouteBody>][] = [
    ['POST', '/v1/lobby/age', async () => ({ json: { adult: true } })],
    ['GET', '/v1/lobby/notice', async () => ({})],
    [
      'POST',
      '/v1/lobby/consent',
      async () => ({
        json: { noticeVersionId: ORG, renderedSha256: 'a'.repeat(64), accepted: true },
      }),
    ],
    [
      'PUT',
      '/v1/lobby/photo',
      async () => ({
        body: photo,
        headers: { 'content-type': 'image/jpeg', 'x-photo-sha256': await sha256HexBytes(photo) },
      }),
    ],
  ];

  /** Nothing reached api and nothing was stored in R2 since `before` calls. */
  const expectUntouched = (h: Harness, before: number) => {
    expect(h.calls.length).toBe(before);
    expect(h.calls.some((c) => c.method === 'photoPermit')).toBe(false);
    expect(h.evidence.objects.size).toBe(0);
  };

  it.each(ROUTES)(
    '%s %s: a stale lobby nonce (a newer login) is 401 superseded',
    async (method, path, init) => {
      const h = await createHarness();
      const first = await h.login();
      h.clock.ms += 31_000;
      const second = await h.login();
      const before = h.calls.length;

      const stale = await h.request(method, path, { token: first, ...(await init()) });
      expect(stale.status).toBe(401);
      expect(await stale.json()).toEqual({ error: 'superseded' });
      expectUntouched(h, before);

      const fresh = await h.request(method, path, { token: second, ...(await init()) });
      expect(fresh.status).toBe(200);
    },
  );

  it.each(ROUTES)(
    '%s %s: a cleared lobby nonce (session granted) is 401 token_invalid',
    async (method, path, init) => {
      const h = await createHarness();
      const token = await h.login();
      const before = h.calls.length;
      h.otp.cores.get(INVITATION)?.clearLobbyNonce();
      const res = await h.request(method, path, { token, ...(await init()) });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'token_invalid' });
      expectUntouched(h, before);
    },
  );

  it.each(ROUTES)(
    '%s %s: expired, session-typed, none-alg and missing tokens are 401',
    async (method, path, init) => {
      const h = await createHarness();
      const token = await h.login();
      const nowSec = Math.floor(h.clock.ms / 1000);
      const nonceOf = (t: string) =>
        (
          JSON.parse(atob(t.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
            nonce: string;
          }
        ).nonce;
      const session = await signToken(
        h.key,
        lobbyClaims(nowSec, { typ: 'session', nonce: nonceOf(token) }),
      );
      const none = `${base64UrlEncode(utf8(JSON.stringify({ alg: 'none', typ: 'JWT', kid: KID })))}.${token.split('.')[1]}.`;
      const before = h.calls.length;
      const body = await init();

      expect((await h.request(method, path, { token: session, ...body })).status).toBe(401);
      expect((await h.request(method, path, { token: none, ...body })).status).toBe(401);
      expect((await h.request(method, path, body)).status).toBe(401);
      h.clock.ms += 1800 * 1000;
      const expired = await h.request(method, path, { token, ...body });
      expect(expired.status).toBe(401);
      expect(await expired.json()).toEqual({ error: 'token_expired' });
      expectUntouched(h, before);
    },
  );

  it('a lobby route with no key configured fails closed with 503, never a pass', async () => {
    const h = await createHarness();
    const token = await h.login();
    const { createApp } = await import('./app.js');
    const res = await createApp({ now: () => new Date(h.clock.ms) }).request(
      'https://edge.test/v1/lobby/notice',
      { headers: { authorization: `Bearer ${token}` } },
      { ...h.env, CANDIDATE_TOKEN_PUBLIC_JWK: '' } as Env,
    );
    expect(res.status).toBe(503);
  });
});
