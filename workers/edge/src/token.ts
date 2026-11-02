// Candidate token verification at the edge (specs/d1-demo-slice.md §4.3, ADR-030). The edge holds only the public
// keys (CANDIDATE_TOKEN_PUBLIC_JWK: a JSON array of one or two public JWKs, the signing key first) and verifies, in
// this order, rejecting on the first failure: `alg` is ES256 (anything else, `none` included, before the signature);
// the `kid` is in the var; the signature (Web Crypto); the strict claim shape; `typ` is the route's; the lifetime cap;
// `iat <= now + 60 s` and `exp > now`. The nonce check (InviteOtpDO for `lobby`, SessionDO for `session`) follows in
// the caller. A missing, empty or malformed key var, or one holding a private member, fails closed with 503.
import { CandidateTokenClaims } from '@trace/shared/contracts/candidate';
import { z } from 'zod';
import { base64UrlDecode, utf8 } from './encoding.js';
import { fail } from './http.js';

export const LOBBY_TTL_SECONDS = 1800;
export const SESSION_TTL_CAP_SECONDS = 10_800;
/** Allowed clock skew on `iat` (§4.3). */
export const IAT_SKEW_SECONDS = 60;

export type TokenTyp = 'lobby' | 'session';

const KID = /^d1-\d{4}-(0[1-9]|1[0-2])$/;
const COORD = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

// Exactly the members the deploy guard allows (§4.3); strict, so a private `d` member is refused.
const PublicJwk = z.strictObject({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: COORD,
  y: COORD,
  kid: z.string().regex(KID),
  alg: z.literal('ES256'),
  use: z.literal('sig'),
});
const PublicJwkList = z.array(PublicJwk).min(1).max(2);

const Header = z.strictObject({ alg: z.literal('ES256'), typ: z.literal('JWT'), kid: z.string() });

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ES256 = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** kid -> verify key. */
export type VerifyKeys = ReadonlyMap<string, CryptoKey>;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** Has any object in the value a private-key member (`d`)? Checked before the schema, so the refusal is explicit. */
const hasPrivateMember = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.some((jwk) => typeof jwk === 'object' && jwk !== null && Object.hasOwn(jwk, 'd'));

/** Parses the public key var. Throws `verify_keys_invalid` on any problem (fail closed). */
export const parsePublicJwks = async (text: string): Promise<VerifyKeys> => {
  const raw = parseJson(text);
  if (hasPrivateMember(raw)) throw new Error('verify_keys_invalid');
  const parsed = PublicJwkList.safeParse(raw);
  if (!parsed.success) throw new Error('verify_keys_invalid');
  const keys = new Map<string, CryptoKey>();
  for (const jwk of parsed.data) {
    if (keys.has(jwk.kid)) throw new Error('verify_keys_invalid');
    const { kty, crv, x, y } = jwk;
    try {
      keys.set(
        jwk.kid,
        await crypto.subtle.importKey('jwk', { kty, crv, x, y }, ECDSA, false, ['verify']),
      );
    } catch {
      throw new Error('verify_keys_invalid');
    }
  }
  return keys;
};

// One parse per distinct var text per isolate. Bounded: a rotation adds one entry.
const keyCache = new Map<string, Promise<VerifyKeys>>();

/** The verify keys of this env, or 503 `unavailable` when the var is missing, empty or invalid. */
export const verifyKeysFor = async (env: Env): Promise<VerifyKeys> => {
  const text = env.CANDIDATE_TOKEN_PUBLIC_JWK;
  if (typeof text !== 'string' || text.trim() === '') return fail('unavailable');
  let pending = keyCache.get(text);
  if (pending === undefined) {
    if (keyCache.size >= 4) keyCache.clear();
    pending = parsePublicJwks(text);
    keyCache.set(text, pending);
  }
  try {
    return await pending;
  } catch {
    keyCache.delete(text);
    return fail('unavailable');
  }
};

const decodeJson = (part: string): unknown => {
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(base64UrlDecode(part)),
    ) as unknown;
  } catch {
    return undefined;
  }
};

const invalid = (): never => fail('token_invalid');

/**
 * Verifies a compact JWS for `typ` at `nowSec` (integer seconds, the server's clock). Returns the verified claims, or
 * throws 401 `token_invalid` / `token_expired`, or 503 `unavailable` when no key is configured. The signature is
 * checked before any claim is read, so an edited claim with the original signature is `token_invalid`.
 */
export const verifyCandidateToken = async (
  token: string,
  env: Env,
  typ: TokenTyp,
  nowSec: number,
): Promise<CandidateTokenClaims> => {
  const parts = token.split('.');
  if (parts.length !== 3) return invalid();
  const [h, p, s] = parts as [string, string, string];
  const header = Header.safeParse(decodeJson(h));
  if (!header.success) return invalid();
  const keys = await verifyKeysFor(env);
  const key = keys.get(header.data.kid);
  if (key === undefined) return invalid();
  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(s);
  } catch {
    return invalid();
  }
  if (signature.length !== 64) return invalid();
  const ok = await crypto.subtle.verify(ES256, key, signature, utf8(`${h}.${p}`));
  if (!ok) return invalid();
  const claims = CandidateTokenClaims.safeParse(decodeJson(p));
  if (!claims.success || claims.data.typ !== typ) return invalid();
  const { iat, exp } = claims.data;
  const cap = typ === 'lobby' ? LOBBY_TTL_SECONDS : SESSION_TTL_CAP_SECONDS;
  if (exp - iat > cap) return invalid();
  if (iat > nowSec + IAT_SKEW_SECONDS) return invalid();
  if (exp <= nowSec) return fail('token_expired');
  return claims.data;
};
