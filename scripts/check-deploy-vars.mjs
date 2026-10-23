#!/usr/bin/env node
// Public deploy-variable guard (specs/d1-demo-slice.md §7.1; docs/reviews/D1-security-review-bindings.md
// F4). The staging deploy runs this before it applies migrations or deploys a Worker. It reads four
// GitHub variables from the environment and exits 1 when
//   - any is empty,
//   - CANDIDATE_TOKEN_PUBLIC_JWK is not valid JSON, is not a JSON array of one or two JWK objects
//     (the one shape: lead decision 2026-10-16; a bare JWK object or a {"keys":[...]} set is refused),
//     has a key without a `kid`, has two keys with the same `kid`, or has a key with a private member
//     (`d` first of all: a private key pasted into a public var must never be deployed),
//   - CANDIDATE_TOKEN_KID is not the kid of the FIRST key in that array (the current signing key comes
//     first; the second, during rotation, is the previous key, spec §4.3),
//   - SUPABASE_STAGING_URL is not an https URL,
//   - SUPABASE_STAGING_PUBLISHABLE_KEY is a secret key (`sb_secret_…` or a service_role JWT),
//   - API_STAGING_ORIGIN is not exactly the staging api Worker origin (the recruiter CSP reads it).
// Security review S3/S8 (docs/reviews/D1-security-review-wave0-rest.md): every key is allow-listed
// (only kty, crv, x, y, kid, alg, use; an ES256 P-256 signing key; kid d1-YYYY-MM), and
// CANDIDATE_TOKEN_KID must be exactly d1-YYYY-MM with no surrounding whitespace (--var deploys it as is).
// ADR-031 amendment 1 (d1 revision 4o): it also reads the three wrangler.jsonc files and fails unless the staging
// blocks carry exactly the Hyperdrive bindings of scripts/lib/hyperdrive.mjs with well-formed, distinct config ids
// (the Workers reach staging Postgres only through them; the ids are committed after the founder creates the
// configs), so a dispatch without them stops before any Worker deploy. That includes the two M1 jobs logins
// (JOBS_AUTHORING_DB, JOBS_ADMIN_DB; specs/m1-test-authoring.md R5-11): PENDING_BINDINGS never applies here.
// Two deploy steps (security review INF-1): `--vars` before the migrations, `--hyperdrive` after the migrations and
// catalog checks. The M1 configs need the roles migration M1-a creates, so the deploy must apply it before it stops
// for their missing ids. No argument runs both (a local run).
// A violation names the variable and the problem and never prints a value (a value that fails here
// may be a secret). It holds no secret itself and calls nothing: it only reads process.env and the wrangler files.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from './check-boundaries.mjs';
import { WORKER_DIRS } from './check-staging-secrets.mjs';
import { isEntryPoint } from './lib/cli.mjs';
import { allHyperdriveProblems } from './lib/hyperdrive.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The parsed wrangler.jsonc of each Worker ({ edge, api, jobs }), from the repository. */
export function loadWranglerConfigs(root = REPO) {
  return Object.fromEntries(
    Object.entries(WORKER_DIRS).map(([worker, dir]) => [
      worker,
      parseJsonc(readFileSync(path.join(root, dir, 'wrangler.jsonc'), 'utf8')),
    ]),
  );
}

/** The values the deploy cannot work without (D1 §7.1: wrangler placeholders are empty in git). */
export const REQUIRED_VARS = Object.freeze([
  'CANDIDATE_TOKEN_KID',
  'CANDIDATE_TOKEN_PUBLIC_JWK',
  'SUPABASE_STAGING_URL',
  'SUPABASE_STAGING_PUBLISHABLE_KEY',
  'API_STAGING_ORIGIN',
]);

/** The staging api Worker origin (H4 subdomain, spec §7.1): the only value API_STAGING_ORIGIN may hold. */
export const API_STAGING_ORIGIN = 'https://trace-api-staging.abhayraj.workers.dev';

/** The only members a public candidate-token key may carry (as scripts/ops/candidate-token-key.mjs writes). */
const PUBLIC_MEMBERS = Object.freeze(['kty', 'crv', 'x', 'y', 'kid', 'alg', 'use']);

/** Spec §4.3: `d1-YYYY-MM`, a real month. */
const KID_RE = /^d1-\d{4}-(?:0[1-9]|1[0-2])$/;

const isText = (x) => typeof x === 'string' && x !== '';

/** JWK members that only a private or symmetric key has (RFC 7517/7518). */
const PRIVATE_MEMBERS = Object.freeze(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']);

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/**
 * CANDIDATE_TOKEN_PUBLIC_JWK text → { keys } or { error }. The one shape (spec §4.2, §4.3; lead
 * decision 2026-10-16, which the key script writes and the api/edge parsers accept): a JSON array of
 * one public JWK, or two during rotation, the current signing key first, each with a kid. A bare JWK
 * object and a `{ "keys": [...] }` set are refused before any key in them is read. An error never
 * holds the value.
 */
export function parseJwkSet(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'is not valid JSON' };
  }
  if (!Array.isArray(value))
    return {
      error:
        'must be a JSON array of one or two public JWKs, the current signing key first (not a single JWK object or a {"keys": [...]} set)',
    };
  if (value.length < 1 || value.length > 2)
    return { error: 'must hold one key, or two during rotation' };
  if (!value.every(isObj)) return { error: 'must hold JWK objects only' };
  return { keys: value };
}

/** Violations for one environment mapping ({ NAME: value }). Never includes a value. */
export function checkDeployVars(env) {
  const out = [];
  const raw = (name) => (typeof env[name] === 'string' ? env[name] : '');
  const empty = new Set();
  for (const name of REQUIRED_VARS) {
    if (raw(name).trim() === '') {
      out.push(`${name}: is empty or not set (the deploy would ship an empty placeholder)`);
      empty.add(name);
    }
  }

  let kids = null;
  if (!empty.has('CANDIDATE_TOKEN_PUBLIC_JWK')) {
    const parsed = parseJwkSet(raw('CANDIDATE_TOKEN_PUBLIC_JWK'));
    if (parsed.error) out.push(`CANDIDATE_TOKEN_PUBLIC_JWK: ${parsed.error}`);
    else {
      kids = [];
      let sound = true;
      parsed.keys.forEach((key, i) => {
        if (typeof key.kid !== 'string' || !KID_RE.test(key.kid)) {
          out.push(
            `CANDIDATE_TOKEN_PUBLIC_JWK: key ${i} has no kid of the form d1-YYYY-MM (every key needs one)`,
          );
          sound = false;
        } else if (kids.includes(key.kid)) {
          out.push(`CANDIDATE_TOKEN_PUBLIC_JWK: key ${i} has a duplicate kid`);
          sound = false;
        } else kids.push(key.kid);
        for (const member of PRIVATE_MEMBERS) {
          if (Object.hasOwn(key, member)) {
            out.push(
              `CANDIDATE_TOKEN_PUBLIC_JWK: key ${i} has a private member "${member}" (only the public key may be deployed)`,
            );
            sound = false;
          }
        }
        if (
          Object.keys(key).some((m) => !PUBLIC_MEMBERS.includes(m) && !PRIVATE_MEMBERS.includes(m))
        ) {
          out.push(
            `CANDIDATE_TOKEN_PUBLIC_JWK: key ${i} has a member outside ${PUBLIC_MEMBERS.join(', ')}`,
          );
          sound = false;
        }
        if (
          key.kty !== 'EC' ||
          key.crv !== 'P-256' ||
          key.alg !== 'ES256' ||
          key.use !== 'sig' ||
          !isText(key.x) ||
          !isText(key.y)
        ) {
          out.push(
            `CANDIDATE_TOKEN_PUBLIC_JWK: key ${i} is not an ES256 P-256 signing key (kty EC, crv P-256, alg ES256, use sig, x and y)`,
          );
          sound = false;
        }
      });
      if (!sound) kids = null;
    }
  }

  // Only the current kid signs (spec §4.3), and it is the first key of the array.
  const kid = raw('CANDIDATE_TOKEN_KID');
  const kidWellFormed = KID_RE.test(kid);
  if (!empty.has('CANDIDATE_TOKEN_KID') && !kidWellFormed) {
    out.push('CANDIDATE_TOKEN_KID: must be exactly d1-YYYY-MM, with no surrounding whitespace');
  }
  if (kids !== null && !empty.has('CANDIDATE_TOKEN_KID') && kidWellFormed) {
    if (!kids.includes(kid)) {
      out.push('CANDIDATE_TOKEN_KID: is not the kid of any key in CANDIDATE_TOKEN_PUBLIC_JWK');
    } else if (kids[0] !== kid) {
      out.push(
        'CANDIDATE_TOKEN_KID: names a later key of CANDIDATE_TOKEN_PUBLIC_JWK; the current signing key must come first',
      );
    }
  }

  if (!empty.has('SUPABASE_STAGING_URL')) {
    let url = null;
    try {
      url = new URL(raw('SUPABASE_STAGING_URL').trim());
    } catch {
      /* reported below */
    }
    if (url === null || url.protocol !== 'https:')
      out.push('SUPABASE_STAGING_URL: must be an https URL');
  }

  if (!empty.has('SUPABASE_STAGING_PUBLISHABLE_KEY')) {
    const key = raw('SUPABASE_STAGING_PUBLISHABLE_KEY').trim();
    if (key.startsWith('sb_secret_'))
      out.push('SUPABASE_STAGING_PUBLISHABLE_KEY: is a secret key, not a publishable one');
    else if (jwtRole(key) === 'service_role')
      out.push('SUPABASE_STAGING_PUBLISHABLE_KEY: is a service_role key, not a publishable one');
  }
  if (!empty.has('API_STAGING_ORIGIN') && raw('API_STAGING_ORIGIN') !== API_STAGING_ORIGIN) {
    out.push(`API_STAGING_ORIGIN: must be exactly ${API_STAGING_ORIGIN}`);
  }
  return out;
}

/** The `role` claim of a JWT-shaped value, or null when it is not one. */
function jwtRole(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return isObj(payload) && typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Which checks a command line asks for: `--vars` (the public variables; the deploy's first guard, before the
 * migrations), `--hyperdrive` (the Hyperdrive bindings; after the migrations and catalog checks, before any Worker
 * deploy, security review INF-1), or no argument for both. Anything else is null.
 */
export function modeOf(argv) {
  if (argv.length === 0) return { vars: true, hyperdrive: true };
  if (argv.length === 1 && argv[0] === '--vars') return { vars: true, hyperdrive: false };
  if (argv.length === 1 && argv[0] === '--hyperdrive') return { vars: false, hyperdrive: true };
  return null;
}

/** CLI body; returns the exit code. `configs` defaults to the repository's wrangler files. */
export function main({
  argv = [],
  env = process.env,
  configs = loadWranglerConfigs(),
  out = console.log,
  err = console.error,
} = {}) {
  const mode = modeOf(argv);
  if (mode === null) {
    err(
      'check-deploy-vars: use --vars or --hyperdrive (or neither, for both); nothing was checked',
    );
    return 2;
  }
  const violations = [
    ...(mode.vars ? checkDeployVars(env) : []),
    ...(mode.hyperdrive ? allHyperdriveProblems(configs, { requireStaging: true }) : []),
  ];
  for (const line of violations) err(`check-deploy-vars: ${line}`);
  if (violations.length > 0) {
    err(`check-deploy-vars: ${violations.length} problem(s); nothing was deployed (spec §7.1)`);
    return 1;
  }
  out('check-deploy-vars: OK');
  return 0;
}

if (isEntryPoint(import.meta.url)) process.exit(main({ argv: process.argv.slice(2) }));
