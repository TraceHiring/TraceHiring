// Candidate tokens (spec §4.3, ADR-030 decisions 1, 2, 6, 7 as accepted for D1). services/api signs with the private
// JWK in the Worker secret CANDIDATE_TOKEN_PRIVATE_JWK, under that JWK's own `kid` (security review wave0-rest S4:
// tokens minted between `secret put` and the deploy still verify against the phase-1 public list). Every CandidateRpc
// method after lobbyMint re-verifies the raw token here against CANDIDATE_TOKEN_PUBLIC_JWK: a JSON array of one or two
// public JWKs, the signing key first. Errors carry a constant code only, never token or key material.
import { CandidateTokenClaims } from '@trace/shared/contracts/candidate';
import { z } from 'zod';
import { base64UrlDecode, base64UrlEncode, utf8 } from './encoding.js';

export const LOBBY_TTL_SECONDS = 1800;
export const SESSION_TTL_CAP_SECONDS = 10_800;
/** Allowed clock skew on `iat` (spec §4.3). */
export const IAT_SKEW_SECONDS = 60;

const KID = /^d1-\d{4}-(0[1-9]|1[0-2])$/;
const COORD = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const PrivateJwk = z.strictObject({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: COORD,
  y: COORD,
  d: COORD,
  kid: z.string().regex(KID),
  alg: z.literal('ES256').optional(),
  use: z.literal('sig').optional(),
  key_ops: z.array(z.string()).optional(),
  ext: z.boolean().optional(),
});

// Exactly the members the deploy guard allows (spec §4.3): a public key never has `d`.
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

export interface SigningKey {
  readonly kid: string;
  readonly key: CryptoKey;
}

/** kid -> verify key, in the order of the var (the signing key first). */
export type VerifyKeys = ReadonlyMap<string, CryptoKey>;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** Imports CANDIDATE_TOKEN_PRIVATE_JWK. Throws `signing_key_invalid` on any problem. */
export const importSigningKey = async (text: string): Promise<SigningKey> => {
  const parsed = PrivateJwk.safeParse(parseJson(text));
  if (!parsed.success) throw new Error('signing_key_invalid');
  const { kty, crv, x, y, d, kid } = parsed.data;
  try {
    const key = await crypto.subtle.importKey('jwk', { kty, crv, x, y, d }, ECDSA, false, ['sign']);
    return { kid, key };
  } catch {
    throw new Error('signing_key_invalid');
  }
};

/** Parses CANDIDATE_TOKEN_PUBLIC_JWK. Throws `verify_keys_invalid` on any problem (fail closed). */
export const parsePublicJwks = async (text: string): Promise<VerifyKeys> => {
  const parsed = PublicJwkList.safeParse(parseJson(text));
  if (!parsed.success) throw new Error('verify_keys_invalid');
  const keys = new Map<string, CryptoKey>();
  for (const jwk of parsed.data) {
    if (keys.has(jwk.kid)) throw new Error('verify_keys_invalid');
    try {
      const { kty, crv, x, y } = jwk;
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

const encodeJson = (value: unknown): string => base64UrlEncode(utf8(JSON.stringify(value)));

/** Signs a compact JWS. The caller builds the claims; the lifetime caps are checked again on verify. */
export const signCandidateToken = async (
  signer: SigningKey,
  claims: Readonly<Record<string, unknown>>,
): Promise<string> => {
  const input = `${encodeJson({ alg: 'ES256', typ: 'JWT', kid: signer.kid })}.${encodeJson(claims)}`;
  const signature = await crypto.subtle.sign(ES256, signer.key, utf8(input));
  return `${input}.${base64UrlEncode(new Uint8Array(signature))}`;
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

const invalid = (): never => {
  throw new Error('token_invalid');
};

/**
 * Re-verifies a candidate token (spec §4.3 order): `alg` is ES256 before anything else, the `kid` is known, the
 * signature, the strict claim shape, `typ` for this method, the lifetime cap, `exp > now`, `iat <= now + 60 s`.
 * Throws `token_invalid` or `token_expired`; `now` is in seconds.
 */
export const verifyCandidateToken = async (
  token: string,
  keys: VerifyKeys,
  typ: 'lobby' | 'session',
  now: number,
): Promise<CandidateTokenClaims> => {
  const parts = token.split('.');
  if (parts.length !== 3) return invalid();
  const [h, p, s] = parts as [string, string, string];
  const header = Header.safeParse(decodeJson(h));
  if (!header.success) return invalid();
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
  if (iat > now + IAT_SKEW_SECONDS) return invalid();
  if (exp <= now) throw new Error('token_expired');
  return claims.data;
};
