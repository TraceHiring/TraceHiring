// Test helpers: ES256 key pairs generated at run time (no key material in the repo), the public key var in its one
// shape (§4.3), and a signer for candidate tokens with any header or claims. Synthetic ids only.
import { base64UrlEncode, utf8 } from './encoding.js';

export const KID = 'd1-2026-10';
export const OLD_KID = 'd1-2026-09';

export interface TestKey {
  kid: string;
  signing: CryptoKey;
  /** The public JWK in the shape the var holds. */
  publicJwk: Record<string, string>;
}

export const makeKey = async (kid: string = KID): Promise<TestKey> => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return {
    kid,
    signing: pair.privateKey,
    publicJwk: {
      kty: 'EC',
      crv: 'P-256',
      x: String(jwk.x),
      y: String(jwk.y),
      kid,
      alg: 'ES256',
      use: 'sig',
    },
  };
};

/** The CANDIDATE_TOKEN_PUBLIC_JWK value for these keys, the signing key first. */
export const publicVar = (...keys: TestKey[]): string =>
  JSON.stringify(keys.map((k) => k.publicJwk));

const part = (value: unknown): string => base64UrlEncode(utf8(JSON.stringify(value)));

/** Signs `claims` under `key` with the given header (default: the ES256 header with the key's kid). */
export const signToken = async (
  key: TestKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'ES256', typ: 'JWT', kid: key.kid },
): Promise<string> => {
  const input = `${part(header)}.${part(claims)}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key.signing,
    utf8(input),
  );
  return `${input}.${base64UrlEncode(new Uint8Array(signature))}`;
};

export const ORG = '22222222-2222-4222-8222-222222222222';
export const INVITATION = '11111111-1111-4111-8111-111111111111';
export const CANDIDATE = '33333333-3333-4333-8333-333333333333';
export const SESSION = '44444444-4444-4444-8444-444444444444';
export const OTHER_INVITATION = '55555555-5555-4555-8555-555555555555';

/** A lobby nonce, built at run time. */
export const nonce = (tag = 'a'): string => `nonce-${tag}-${'0123456789abcdef'}`;

/** Valid lobby claims at `nowSec`, with overrides. */
export const lobbyClaims = (
  nowSec: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  sub: CANDIDATE,
  candidate_id: CANDIDATE,
  invitation_id: INVITATION,
  org_id: ORG,
  typ: 'lobby',
  nonce: nonce(),
  iat: nowSec,
  exp: nowSec + 1800,
  ...overrides,
});
