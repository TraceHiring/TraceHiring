// DC-D4: the same code runs in Node 22 and in workerd. Only WebCrypto (globalThis.crypto) is used.
// Keys are generated at run time and never printed.

const enc = new TextEncoder();

export const b64u = (bytes: ArrayBuffer | Uint8Array): string => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const unb64u = (s: string): Uint8Array => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

// Constant-time compare of two byte arrays (no early exit on content; length is not secret).
export const constantTimeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
};

const ES256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIG = { name: 'ECDSA', hash: 'SHA-256' } as const;

export const publicJwkFromPrivate = (privateJwkJson: string): JsonWebKey => {
  const { d: _d, key_ops: _ops, ...pub } = JSON.parse(privateJwkJson) as JsonWebKey;
  return pub;
};

// Signs a compact ES256 JWT from a private JWK held in a JSON string (the secret shape).
export const signEs256Jwt = async (
  privateJwkJson: string,
  kid: string,
  payload: Record<string, unknown>,
): Promise<string> => {
  const key = await crypto.subtle.importKey('jwk', JSON.parse(privateJwkJson), ES256, false, [
    'sign',
  ]);
  const head = b64u(enc.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid })));
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const input = `${head}.${body}`;
  const sig = await crypto.subtle.sign(SIG, key, enc.encode(input)); // raw IEEE P1363 r||s
  if (sig.byteLength !== 64)
    throw new Error(`expected 64-byte P1363 signature, got ${sig.byteLength}`);
  return `${input}.${b64u(sig)}`;
};

export const verifyEs256Jwt = async (publicJwk: JsonWebKey, jwt: string): Promise<boolean> => {
  const parts = jwt.split('.');
  if (parts.length !== 3) return false;
  const [h, p, s] = parts as [string, string, string];
  const key = await crypto.subtle.importKey('jwk', publicJwk, ES256, false, ['verify']);
  return crypto.subtle.verify(SIG, key, unb64u(s) as BufferSource, enc.encode(`${h}.${p}`));
};

export interface CryptoReport {
  runtime: string;
  results: Record<string, boolean | string | number>;
  allPass: boolean;
}

export const runCryptoChecks = async (runtime: string): Promise<CryptoReport> => {
  const r: CryptoReport['results'] = {};

  // 1. generate a key at run time; the "secret" is its private JWK as a JSON string.
  const pair = await crypto.subtle.generateKey(ES256, true, ['sign', 'verify']);
  const secretJson = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
  const pubJwk = publicJwkFromPrivate(secretJson);

  // 2. JWK import from a string, sign, P1363 -> compact JWT, verify with the public JWK.
  const now = 1_800_000_000;
  const jwt = await signEs256Jwt(secretJson, 'k1', {
    iss: 'edge',
    sub: 'synthetic',
    iat: now,
    exp: now + 60,
  });
  r['jwt_parts'] = jwt.split('.').length;
  r['jwt_sig_bytes'] = unb64u(jwt.split('.')[2] as string).length;
  r['es256_verify_ok'] = await verifyEs256Jwt(pubJwk, jwt);

  // 3. negative: tampered payload and a different key must fail.
  const [h, , s] = jwt.split('.') as [string, string, string];
  const forgedBody = b64u(
    enc.encode(JSON.stringify({ iss: 'edge', sub: 'attacker', iat: now, exp: now + 60 })),
  );
  r['es256_tampered_rejected'] = !(await verifyEs256Jwt(pubJwk, `${h}.${forgedBody}.${s}`));
  const other = await crypto.subtle.generateKey(ES256, true, ['sign', 'verify']);
  const otherPub = await crypto.subtle.exportKey('jwk', other.publicKey);
  r['es256_wrong_key_rejected'] = !(await verifyEs256Jwt(otherPub, jwt));

  // 4. HMAC-SHA-256 (media link signature) + constant-time compare.
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    crypto.getRandomValues(new Uint8Array(32)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const msg = enc.encode('jti-synthetic.1800000060');
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, msg));
  r['hmac_bytes'] = mac.length;
  r['hmac_verify_ok'] = await crypto.subtle.verify('HMAC', hmacKey, mac, msg);
  const mac2 = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, msg));
  r['ct_equal_same'] = constantTimeEqual(mac, mac2);
  const flipped = mac.slice();
  flipped[31] = (flipped[31] as number) ^ 1;
  r['ct_equal_flipped_rejected'] = !constantTimeEqual(mac, flipped);
  r['ct_equal_length_rejected'] = !constantTimeEqual(mac, mac.slice(0, 31));
  r['hmac_tamper_rejected'] = !(await crypto.subtle.verify('HMAC', hmacKey, flipped, msg));

  // 5. platform timingSafeEqual (Workers extension; Node has none on subtle).
  const tse = (
    crypto.subtle as unknown as { timingSafeEqual?: (a: BufferSource, b: BufferSource) => boolean }
  ).timingSafeEqual;
  r['subtle_timingSafeEqual_available'] = typeof tse === 'function';
  if (typeof tse === 'function') {
    r['subtle_timingSafeEqual_ok'] =
      tse.call(crypto.subtle, mac, mac2) === true &&
      tse.call(crypto.subtle, mac, flipped) === false;
  }

  const required = Object.entries(r).filter(
    ([k, v]) => typeof v === 'boolean' && k !== 'subtle_timingSafeEqual_available',
  );
  const allPass = required.every(([, v]) => v === true) && r['jwt_sig_bytes'] === 64;
  return { runtime, results: r, allPass };
};
