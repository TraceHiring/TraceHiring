#!/usr/bin/env node
// Operator script: generate the ES256 key pair that signs and verifies candidate tokens
// (specs/d1-demo-slice.md §4.3, ADR-030, docs/progress/FOUNDER-QUEUE.md "D1: candidate-token key pair").
//   node scripts/ops/candidate-token-key.mjs --kid d1-YYYY-MM --out-dir <dir> [--previous-public <file>]
// Run once, locally, before the first staging deploy (and again with --previous-public to rotate).
// It writes two files into --out-dir and prints only public material plus the exact next commands:
//   candidate-token-<kid>.private.jwk.json  {kty,crv,x,y,d,kid,alg:'ES256',use:'sig'}  mode 0600 on POSIX
//       -> the api secret CANDIDATE_TOKEN_PRIVATE_JWK (`wrangler secret put`), then delete the file
//   candidate-token-<kid>.public.json       the value of the GitHub variable CANDIDATE_TOKEN_PUBLIC_JWK:
//       one public JWK {kty,crv,x,y,kid,alg,use}, or, with --previous-public, a JSON list [new, previous]
//       (the new key first; scripts/check-deploy-vars.mjs accepts one key, or two during rotation)
// The key is made with WebCrypto (Node 22, no dependency). --out-dir must be outside every git working
// tree (a private key must never be committable) and an existing file is never overwritten. The private
// key is never printed: not to stdout, not to stderr, not in an error. Failures print a fixed message
// plus, for the file system, the error code only; no value, no path of an error, no exception text.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from '../lib/cli.mjs';
import { line, parseFlags, realDeps } from './lib.mjs';

const TAG = 'candidate-token-key';
const OPTIONS = {
  kid: { type: 'string' },
  'out-dir': { type: 'string' },
  'previous-public': { type: 'string' },
};

/** The working tree this script lives in (scripts/ops/ → two levels up). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const P256 = { name: 'ECDSA', namedCurve: 'P-256' };
const ES256 = { name: 'ECDSA', hash: 'SHA-256' };

/** Spec §4.3: `d1-YYYY-MM`, a real month. */
const KID_RE = /^d1-\d{4}-(?:0[1-9]|1[0-2])$/;
export const isValidKid = (kid) => typeof kid === 'string' && KID_RE.test(kid);

/** JWK members that only a private or symmetric key has (RFC 7517/7518), as in check-deploy-vars. */
const PRIVATE_MEMBERS = Object.freeze(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']);
/** The only members a public candidate-token key may carry. */
const PUBLIC_MEMBERS = Object.freeze(['kty', 'crv', 'x', 'y', 'kid', 'alg', 'use']);
/** The deploy guard accepts one key, or two during rotation (specs/d1-demo-slice.md §4.3). */
const MAX_KEYS = 2;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x !== '';

/** A file-system error code, safe to print; anything else (a message, a path) is dropped. */
const codeOf = (e) =>
  typeof e?.code === 'string' && /^[A-Z0-9_]{3,20}$/.test(e.code) ? e.code : 'error';

const fileNames = (kid) => ({
  priv: `candidate-token-${kid}.private.jwk.json`,
  pub: `candidate-token-${kid}.public.json`,
});

// --- previous public keys (rotation) ---------------------------------------------------------------

/**
 * One previous public key → the canonical public JWK, or `{ error }` (value-free). A private member
 * is refused first and by name; the names printed come from PRIVATE_MEMBERS, never from the file.
 */
function checkPublicKey(key, i) {
  for (const member of PRIVATE_MEMBERS) {
    if (Object.hasOwn(key, member)) {
      return { error: `key ${i} has a private member (${member}); only public keys may be listed` };
    }
  }
  if (Object.keys(key).some((m) => !PUBLIC_MEMBERS.includes(m))) {
    return { error: `key ${i} has an unexpected member (allowed: ${PUBLIC_MEMBERS.join(', ')})` };
  }
  if (key.kty !== 'EC' || key.crv !== 'P-256') return { error: `key ${i} is not an EC P-256 key` };
  if (!isText(key.x) || !isText(key.y)) return { error: `key ${i} has no x and y` };
  if (!isValidKid(key.kid)) return { error: `key ${i} needs a kid like d1-YYYY-MM` };
  if (key.alg !== undefined && key.alg !== 'ES256') return { error: `key ${i} is not ES256` };
  if (key.use !== undefined && key.use !== 'sig') return { error: `key ${i} is not a signing key` };
  return { jwk: publicJwkOf(key, key.kid) };
}

/** The one shape of a public candidate-token key, in a fixed member order. */
const publicJwkOf = (k, kid) => ({
  kty: k.kty,
  crv: k.crv,
  x: k.x,
  y: k.y,
  kid,
  alg: 'ES256',
  use: 'sig',
});

/**
 * The text of a `--previous-public` file → `{ keys }` (canonical public JWKs) or `{ error }`.
 * Accepts what this script writes (one JWK object, or a list) and a `{ "keys": [...] }` set.
 * Structure only; the point is checked against WebCrypto in main().
 */
export function parsePreviousPublic(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'the file is not valid JSON' };
  }
  let list;
  if (Array.isArray(value)) list = value;
  else if (isObj(value) && Object.hasOwn(value, 'keys')) list = value.keys;
  else if (isObj(value)) list = [value];
  else return { error: 'the file must hold one JWK object or a list of them' };
  if (!Array.isArray(list) || list.length < 1) return { error: 'the file holds no key' };
  if (!list.every(isObj)) return { error: 'the file must hold JWK objects only' };
  const keys = [];
  for (const [i, key] of list.entries()) {
    const checked = checkPublicKey(key, i);
    if (checked.error) return { error: checked.error };
    keys.push(checked.jwk);
  }
  return { keys };
}

/** The rotation rules that need only the kids: no duplicates, and the deploy guard's key cap. */
function checkRotation(kid, previous) {
  const kids = [kid, ...previous.map((k) => k.kid)];
  if (new Set(kids).size !== kids.length) return 'duplicate kid (every kid must be unique)';
  if (kids.length > MAX_KEYS) {
    return `the result would hold ${kids.length} keys; the deploy allows at most two keys (the new one and one previous)`;
  }
  return null;
}

// --- --out-dir ------------------------------------------------------------------------------------

/** `target` is `root` or below it. Both are absolute and already real. */
function isInside(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * The real, absolute form of --out-dir: the nearest existing ancestor through realpath (so a link
 * into the repository is seen for what it is), plus the part that does not exist yet.
 * @returns {{ dir: string } | { error: string }}
 */
function resolveOutDir(raw) {
  let probe = resolve(raw);
  const rest = [];
  for (;;) {
    try {
      const real = realpathSync.native(probe);
      if (!statSync(real).isDirectory()) return { error: '--out-dir is not a directory' };
      return { dir: join(real, ...rest) };
    } catch (e) {
      if (e?.code !== 'ENOENT') return { error: `--out-dir cannot be resolved (${codeOf(e)})` };
    }
    try {
      lstatSync(probe);
      return { error: '--out-dir goes through a broken link' };
    } catch {
      // really absent: look one level up
    }
    const parent = dirname(probe);
    if (parent === probe) return { error: '--out-dir cannot be resolved (ENOENT)' };
    rest.unshift(basename(probe));
    probe = parent;
  }
}

/** True under the repo root, or under any directory that has a `.git` entry (file or directory). */
function insideWorkingTree(dir, repoRoot) {
  let root = resolve(repoRoot);
  try {
    root = realpathSync.native(root);
  } catch {
    // an unresolvable root still counts as typed
  }
  if (isInside(root, dir)) return true;
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return true;
    if (dirname(d) === d) return false;
  }
}

// --- keys -----------------------------------------------------------------------------------------

/** Generates the pair and returns the two JWKs; the private one exists only in memory and the file. */
async function generateJwks(subtle, kid) {
  const pair = await subtle.generateKey(P256, true, ['sign', 'verify']);
  const priv = await subtle.exportKey('jwk', pair.privateKey);
  const pub = await subtle.exportKey('jwk', pair.publicKey);
  for (const jwk of [priv, pub]) {
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !isText(jwk.x) || !isText(jwk.y)) {
      throw new Error('unexpected key shape');
    }
  }
  if (!isText(priv.d)) throw new Error('unexpected key shape');
  return {
    privateJwk: {
      kty: priv.kty,
      crv: priv.crv,
      x: priv.x,
      y: priv.y,
      d: priv.d,
      kid,
      alg: 'ES256',
      use: 'sig',
    },
    publicJwk: publicJwkOf(pub, kid),
  };
}

/**
 * Signs with the private JWK and verifies with the public one (ES256, raw IEEE-P1363 r||s), and checks
 * that a changed message does not verify. Works on the JWKs exactly as they will be written.
 */
async function selfTest(subtle, privateJwk, publicJwk) {
  const signKey = await subtle.importKey('jwk', privateJwk, P256, false, ['sign']);
  const verifyKey = await subtle.importKey('jwk', publicJwk, P256, false, ['verify']);
  const message = new TextEncoder().encode('trace candidate-token key self-test');
  const other = new TextEncoder().encode('trace candidate-token key self-test!');
  const signature = new Uint8Array(await subtle.sign(ES256, signKey, message));
  return (
    signature.byteLength === 64 &&
    (await subtle.verify(ES256, verifyKey, signature, message)) === true &&
    (await subtle.verify(ES256, verifyKey, signature, other)) === false
  );
}

// --- main -----------------------------------------------------------------------------------------

/** Returns the exit code: 0 ok, 1 failure, 2 bad arguments or a refusal (before any key exists). */
export async function main({ argv, deps = realDeps() }) {
  const fail = (code, text) => {
    line(deps.stderr, `${TAG}: ${text}`);
    return code;
  };
  const subtle = deps.subtle ?? globalThis.crypto.subtle;
  const write = deps.writeFileSync ?? writeFileSync;

  let flags;
  try {
    flags = parseFlags(argv, OPTIONS);
  } catch {
    return fail(2, 'unknown or malformed argument');
  }

  // 1. Arguments. A failure names the field, never the value.
  const kid = flags.kid;
  const outDirArg = flags['out-dir'];
  const bad = [];
  if (!isValidKid(kid)) bad.push('kid');
  if (!isText(outDirArg) || outDirArg.trim() === '') bad.push('out-dir');
  if (bad.length > 0) {
    line(deps.stderr, `${TAG}: invalid argument(s): ${bad.join(', ')}`);
    if (bad.includes('kid'))
      line(deps.stderr, '  --kid is required: d1-YYYY-MM with a month 01-12');
    if (bad.includes('out-dir'))
      line(deps.stderr, '  --out-dir is required: a folder outside the repository');
    return 2;
  }

  // 2. Where the files go: real path, outside every working tree, nothing overwritten.
  const target = resolveOutDir(outDirArg);
  if (target.error) return fail(2, target.error);
  const dir = target.dir;
  if (insideWorkingTree(dir, deps.repoRoot ?? REPO_ROOT)) {
    return fail(
      2,
      'refused: --out-dir is inside the git working tree; a private key must never sit where it could be committed. Choose a folder outside the repository',
    );
  }
  const names = fileNames(kid);
  const privFile = join(dir, names.priv);
  const pubFile = join(dir, names.pub);
  for (const file of [privFile, pubFile]) {
    let exists = true;
    try {
      lstatSync(file);
    } catch {
      exists = false;
    }
    if (exists) {
      return fail(
        2,
        `refusing to overwrite ${basename(file)}; move it away, or use another --kid or --out-dir`,
      );
    }
  }

  // 3. The previous public key(s), before anything is generated.
  let previous = [];
  if (flags['previous-public'] !== undefined) {
    let text;
    try {
      text = readFileSync(resolve(flags['previous-public']), 'utf8');
    } catch (e) {
      return fail(2, `--previous-public: cannot read the file (${codeOf(e)})`);
    }
    const parsed = parsePreviousPublic(text);
    if (parsed.error) return fail(2, `--previous-public: ${parsed.error}`);
    for (const key of parsed.keys) {
      try {
        await subtle.importKey('jwk', key, P256, true, ['verify']);
      } catch {
        return fail(2, '--previous-public: a key is not a valid P-256 public key');
      }
    }
    previous = parsed.keys;
    const problem = checkRotation(kid, previous);
    if (problem) return fail(2, `--previous-public: ${problem}`);
  }

  // 4. The key pair, checked before it is written.
  let jwks;
  try {
    jwks = await generateJwks(subtle, kid);
  } catch {
    return fail(1, 'generating the key pair failed');
  }
  let ok = false;
  try {
    ok = await selfTest(subtle, jwks.privateJwk, jwks.publicJwk);
  } catch {
    // reported below, with the same fixed message
  }
  if (!ok) return fail(1, 'the generated key pair failed its self-test');

  // One public key as a bare JWK; during rotation a list with the new key first.
  const publicValue = previous.length === 0 ? jwks.publicJwk : [jwks.publicJwk, ...previous];
  const publicText = JSON.stringify(publicValue);
  // No trailing newline in either file: `gh variable set < file` and `wrangler secret put < file`
  // then read the exact value.
  const privateText = JSON.stringify(jwks.privateJwk);

  // 5. Write. The public file first, so a failure on the private one leaves nothing behind.
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    write(pubFile, publicText, { flag: 'wx', mode: 0o644 });
    try {
      write(privFile, privateText, { flag: 'wx', mode: 0o600 });
      if (deps.platform !== 'win32') chmodSync(privFile, 0o600);
    } catch (e) {
      rmSync(pubFile, { force: true });
      throw e;
    }
  } catch (e) {
    return fail(1, `writing the key files failed (${codeOf(e)})`);
  }

  // 6. Public material and the next steps only.
  const out = deps.stdout;
  const keyList = [jwks.publicJwk, ...previous].map((k) => k.kid);
  line(out, `${TAG}: generated an ES256 (ECDSA P-256) key pair, kid ${kid}`);
  line(out, '');
  line(out, 'CANDIDATE_TOKEN_PUBLIC_JWK (public, safe to share):');
  line(out, publicText);
  line(out, `keys in it: ${keyList.join(', ')} (only ${kid} signs; the others only verify)`);
  line(out, '');
  line(out, 'Files written:');
  line(out, `  private (secret${deps.platform === 'win32' ? '' : ', mode 600'}): ${privFile}`);
  line(out, `  public: ${pubFile}`);
  if (deps.platform === 'win32') {
    line(
      out,
      '  Windows: file mode bits do not apply here; the private file keeps the ACL of its folder. Keep --out-dir inside your own user profile.',
    );
  }
  line(out, '');
  line(out, 'Next steps, in this order:');
  line(
    out,
    '# 1. The GitHub variables of the staging environment (run inside the repository checkout, so gh finds it)',
  );
  line(out, `gh variable set CANDIDATE_TOKEN_KID --env staging --body ${kid}`);
  line(out, `gh variable set CANDIDATE_TOKEN_PUBLIC_JWK --env staging < "${pubFile}"`);
  line(out, '# 2. The api secret (run from services/api)');
  line(
    out,
    `pnpm exec wrangler secret put CANDIDATE_TOKEN_PRIVATE_JWK --env staging < "${privFile}"`,
  );
  line(
    out,
    '# 3. Delete the private file after "secret put". It is the only copy; if it is lost, generate a new pair with a new kid.',
  );
  line(
    out,
    '# PowerShell has no "<": pipe the file instead, for example  Get-Content -Raw "<file>" | <command>',
  );
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main({ argv: process.argv.slice(2) });
}
