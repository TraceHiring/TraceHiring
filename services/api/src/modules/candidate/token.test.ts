// Candidate token mint and re-verify in services/api (spec §4.3, ADR-030 D1 acceptance, security review wave0-rest
// S4). Keys are generated at run time with Web Crypto; no key material is committed (gitleaks).
import { describe, expect, it } from 'vitest';
import { base64UrlDecode, base64UrlEncode, utf8 } from './encoding.js';
import {
  LOBBY_TTL_SECONDS,
  SESSION_TTL_CAP_SECONDS,
  importSigningKey,
  parsePublicJwks,
  signCandidateToken,
  verifyCandidateToken,
  type VerifyKeys,
} from './token.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const INV = '22222222-2222-4222-8222-222222222222';
const CAND = '33333333-3333-4333-8333-333333333333';
const NOW = 1_800_000_000;

interface TestKeys {
  privateText: string;
  publicJwk: JsonWebKey & { kid: string };
}

const makeKeys = async (kid: string): Promise<TestKeys> => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const priv = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  const privateText = JSON.stringify({
    kty: priv.kty,
    crv: priv.crv,
    x: priv.x,
    y: priv.y,
    d: priv.d,
    kid,
  });
  return {
    privateText,
    publicJwk: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y, kid, alg: 'ES256', use: 'sig' },
  };
};

const claimsFor = (typ: 'lobby' | 'session', iat = NOW, exp = NOW + 600) => ({
  sub: CAND,
  candidate_id: CAND,
  invitation_id: INV,
  org_id: ORG,
  typ,
  nonce: 'n'.repeat(24),
  iat,
  exp,
});

const setup = async () => {
  const current = await makeKeys('d1-2026-10');
  const signer = await importSigningKey(current.privateText);
  const keys: VerifyKeys = await parsePublicJwks(JSON.stringify([current.publicJwk]));
  return { current, signer, keys };
};

/** Rebuilds a token with a new header or payload and the original signature. */
const reshape = (
  token: string,
  edit: { header?: Record<string, unknown>; payload?: Record<string, unknown> },
): string => {
  const [h, p, s] = token.split('.') as [string, string, string];
  const header =
    edit.header ?? (JSON.parse(new TextDecoder().decode(base64UrlDecode(h))) as object);
  const payload =
    edit.payload ?? (JSON.parse(new TextDecoder().decode(base64UrlDecode(p))) as object);
  return `${base64UrlEncode(utf8(JSON.stringify(header)))}.${base64UrlEncode(utf8(JSON.stringify(payload)))}.${s}`;
};

describe('importSigningKey', () => {
  it('signs with the kid inside the private JWK (S4)', async () => {
    const { signer, keys } = await setup();
    expect(signer.kid).toBe('d1-2026-10');
    const token = await signCandidateToken(signer, claimsFor('lobby'));
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(token.split('.')[0] ?? '')));
    expect(header).toEqual({ alg: 'ES256', typ: 'JWT', kid: 'd1-2026-10' });
    await expect(verifyCandidateToken(token, keys, 'lobby', NOW)).resolves.toMatchObject({
      typ: 'lobby',
    });
  });

  it.each([
    ['not json', 'nope'],
    ['an array', '[]'],
    ['no d', (k: TestKeys) => JSON.stringify({ ...JSON.parse(k.privateText), d: undefined })],
    ['no kid', (k: TestKeys) => JSON.stringify({ ...JSON.parse(k.privateText), kid: undefined })],
    [
      'a bad kid form',
      (k: TestKeys) => JSON.stringify({ ...JSON.parse(k.privateText), kid: 'key-1' }),
    ],
    [
      'another curve',
      (k: TestKeys) => JSON.stringify({ ...JSON.parse(k.privateText), crv: 'P-384' }),
    ],
  ])('refuses %s with a constant message', async (_name, make) => {
    const keys = await makeKeys('d1-2026-10');
    const text = typeof make === 'string' ? make : make(keys);
    await expect(importSigningKey(text)).rejects.toThrow(/^signing_key_invalid$/);
  });
});

describe('parsePublicJwks', () => {
  it('accepts one or two public keys', async () => {
    const a = await makeKeys('d1-2026-10');
    const b = await makeKeys('d1-2026-09');
    const keys = await parsePublicJwks(JSON.stringify([a.publicJwk, b.publicJwk]));
    expect([...keys.keys()]).toEqual(['d1-2026-10', 'd1-2026-09']);
  });

  it.each([
    ['an object instead of an array', (a: TestKeys) => JSON.stringify(a.publicJwk)],
    ['an empty array', () => '[]'],
    ['three keys', (a: TestKeys) => JSON.stringify([a.publicJwk, a.publicJwk, a.publicJwk])],
    ['a private member d', (a: TestKeys) => JSON.stringify([{ ...a.publicJwk, d: 'AAAA' }])],
    ['another alg', (a: TestKeys) => JSON.stringify([{ ...a.publicJwk, alg: 'ES384' }])],
    ['a duplicate kid', (a: TestKeys) => JSON.stringify([a.publicJwk, a.publicJwk])],
    ['an empty string', () => ''],
  ])('refuses %s', async (_name, make) => {
    const a = await makeKeys('d1-2026-10');
    await expect(parsePublicJwks(make(a))).rejects.toThrow(/^verify_keys_invalid$/);
  });
});

describe('verifyCandidateToken (api re-verify, §4.2)', () => {
  it('returns the claims of a good lobby and session token', async () => {
    const { signer, keys } = await setup();
    const lobby = await signCandidateToken(signer, claimsFor('lobby'));
    const session = await signCandidateToken(signer, claimsFor('session', NOW, NOW + 7200));
    await expect(verifyCandidateToken(lobby, keys, 'lobby', NOW)).resolves.toMatchObject({
      invitation_id: INV,
      org_id: ORG,
    });
    await expect(verifyCandidateToken(session, keys, 'session', NOW)).resolves.toMatchObject({
      typ: 'session',
    });
  });

  it('verifies a token of the previous key during rotation', async () => {
    const old = await makeKeys('d1-2026-09');
    const current = await makeKeys('d1-2026-10');
    const keys = await parsePublicJwks(JSON.stringify([current.publicJwk, old.publicJwk]));
    const token = await signCandidateToken(
      await importSigningKey(old.privateText),
      claimsFor('lobby'),
    );
    await expect(verifyCandidateToken(token, keys, 'lobby', NOW)).resolves.toMatchObject({
      typ: 'lobby',
    });
  });

  it.each([
    ['alg none', { alg: 'none', typ: 'JWT', kid: 'd1-2026-10' }],
    ['alg HS256', { alg: 'HS256', typ: 'JWT', kid: 'd1-2026-10' }],
    ['an unknown kid', { alg: 'ES256', typ: 'JWT', kid: 'd1-2020-01' }],
    ['no kid', { alg: 'ES256', typ: 'JWT' }],
  ])('refuses %s', async (_name, header) => {
    const { signer, keys } = await setup();
    const token = reshape(await signCandidateToken(signer, claimsFor('lobby')), { header });
    await expect(verifyCandidateToken(token, keys, 'lobby', NOW)).rejects.toThrow(
      /^token_invalid$/,
    );
  });

  it.each([
    ['org_id', { org_id: '44444444-4444-4444-8444-444444444444' }],
    ['invitation_id', { invitation_id: '44444444-4444-4444-8444-444444444444' }],
    ['typ', { typ: 'session' }],
    ['sub', { sub: '44444444-4444-4444-8444-444444444444' }],
  ])('refuses an edited %s with the original signature', async (_name, change) => {
    const { signer, keys } = await setup();
    const token = reshape(await signCandidateToken(signer, claimsFor('lobby')), {
      payload: { ...claimsFor('lobby'), ...change },
    });
    await expect(verifyCandidateToken(token, keys, 'lobby', NOW)).rejects.toThrow(
      /^token_invalid$/,
    );
  });

  it('refuses a token of another key pair with a known kid', async () => {
    const { keys } = await setup();
    const forger = await makeKeys('d1-2026-10');
    const token = await signCandidateToken(
      await importSigningKey(forger.privateText),
      claimsFor('lobby'),
    );
    await expect(verifyCandidateToken(token, keys, 'lobby', NOW)).rejects.toThrow(
      /^token_invalid$/,
    );
  });

  it('refuses the wrong typ for the method, and portal everywhere', async () => {
    const { signer, keys } = await setup();
    const session = await signCandidateToken(signer, claimsFor('session'));
    await expect(verifyCandidateToken(session, keys, 'lobby', NOW)).rejects.toThrow(
      /^token_invalid$/,
    );
    const portal = await signCandidateToken(signer, { ...claimsFor('lobby'), typ: 'portal' });
    await expect(verifyCandidateToken(portal, keys, 'lobby', NOW)).rejects.toThrow(
      /^token_invalid$/,
    );
  });

  it('refuses an expired token, a future iat beyond 60 s and a lifetime over the cap', async () => {
    const { signer, keys } = await setup();
    const expired = await signCandidateToken(signer, claimsFor('lobby', NOW - 700, NOW - 100));
    await expect(verifyCandidateToken(expired, keys, 'lobby', NOW)).rejects.toThrow(
      /^token_expired$/,
    );
    const atExp = await signCandidateToken(signer, claimsFor('lobby', NOW - 600, NOW));
    await expect(verifyCandidateToken(atExp, keys, 'lobby', NOW)).rejects.toThrow(
      /^token_expired$/,
    );
    const future = await signCandidateToken(signer, claimsFor('lobby', NOW + 61, NOW + 600));
    await expect(verifyCandidateToken(future, keys, 'lobby', NOW)).rejects.toThrow(
      /^token_invalid$/,
    );
    const skewOk = await signCandidateToken(signer, claimsFor('lobby', NOW + 60, NOW + 600));
    await expect(verifyCandidateToken(skewOk, keys, 'lobby', NOW)).resolves.toBeDefined();
    const longLobby = await signCandidateToken(
      signer,
      claimsFor('lobby', NOW, NOW + LOBBY_TTL_SECONDS + 1),
    );
    await expect(verifyCandidateToken(longLobby, keys, 'lobby', NOW)).rejects.toThrow(
      /^token_invalid$/,
    );
    const longSession = await signCandidateToken(
      signer,
      claimsFor('session', NOW, NOW + SESSION_TTL_CAP_SECONDS + 1),
    );
    await expect(verifyCandidateToken(longSession, keys, 'session', NOW)).rejects.toThrow(
      /^token_invalid$/,
    );
  });

  it('refuses malformed compact forms and an extra claim', async () => {
    const { signer, keys } = await setup();
    for (const bad of ['', 'a.b', 'a.b.c.d', '!!.??.**']) {
      await expect(verifyCandidateToken(bad, keys, 'lobby', NOW)).rejects.toThrow(
        /^token_invalid$/,
      );
    }
    const extra = await signCandidateToken(signer, {
      ...claimsFor('lobby'),
      email: 'x@example.test',
    });
    await expect(verifyCandidateToken(extra, keys, 'lobby', NOW)).rejects.toThrow(
      /^token_invalid$/,
    );
  });
});
