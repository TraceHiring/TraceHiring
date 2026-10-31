// DC-D4 cross-runtime: Node signs an ES256 JWT, workerd (wrangler dev edge, POST /d4/verify) verifies it.
import { publicJwkFromPrivate, signEs256Jwt } from '../src/crypto-checks.ts';

const base = process.env['EDGE_URL'] ?? 'http://localhost:8801';
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const secret = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
const jwt = await signEs256Jwt(secret, 'k1', { iss: 'node', sub: 'synthetic', exp: 1_900_000_000 });
const res = await fetch(`${base}/d4/verify`, {
  method: 'POST',
  body: JSON.stringify({ jwt, publicJwk: publicJwkFromPrivate(secret) }),
});
const body = (await res.json()) as { verified: boolean };
console.log(`DC-D4 cross-runtime (Node sign -> workerd verify): ${JSON.stringify(body)}`);
process.exit(body.verified ? 0 : 1);
