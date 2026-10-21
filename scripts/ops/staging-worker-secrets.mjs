#!/usr/bin/env node
// Operator script: the four staging database login roles, the four staging Hyperdrive configs that hold them, and
// the one database-free api secret (specs/d1-demo-slice.md §3 "Roles", §7.1 secrets and the check-staging-secrets
// allow-list, §8 DC-D7; ADR-031 amendment 1, d1 revision 4o; scripts/lib/hyperdrive.mjs).
//   TRACE_OPERATOR_DB_URL=... node scripts/ops/staging-worker-secrets.mjs --env staging \
//     --ca-certificate-id <id> [--sslmode verify-full|verify-ca] [--dry-run | --yes]
// Why Hyperdrive: a Worker's own TLS client trusts only public roots, and Supabase Postgres presents a certificate
// under its private "Supabase Root 2021 CA", so a direct connection never completes (postgres.js reconnect-loops).
// Hyperdrive connects to Postgres for the Worker and verifies that CA, which the founder uploads once with
// `wrangler cert upload certificate-authority`; its id (not a secret) is --ca-certificate-id. One config per login
// role (MT-14), caching disabled (a cached read would cross role and org scoping). The *_DB_URL secrets are retired
// on staging; local dev keeps them (local hosts only).
// Run by the founder on their own computer, AFTER the first staging deploy (the Workers must exist), with wrangler
// logged in (OAuth `wrangler login`, or CLOUDFLARE_API_TOKEN). A re-run rotates: new passwords, then the same four
// configs updated in place.
//   1. Checks, before anything changes: --env staging only; --ca-certificate-id is a UUID; --sslmode is verify-full
//      (default) or verify-ca, never require; TRACE_OPERATOR_DB_URL is the staging project's Supabase session pooler
//      (postgres.<ref> @ aws-N-<region>.pooler.supabase.com:5432) or direct host (postgres @ db.<ref>.supabase.co),
//      with ?sslmode=require (or verify-ca / verify-full); its ref is the pinned STAGING_PROJECT_REF (and equals
//      SUPABASE_STAGING_PROJECT_REF when that is set); psql exists. The plan is printed; a dry run stops here.
//      With --yes: `wrangler secret list` works for trace-api-staging and trace-jobs-staging (wrangler 4.149's
//      `secret put` with piped input creates an empty draft Worker when the Worker is missing: createDraftWorker,
//      fallback "yes" in a non-interactive context), and the names it lists are kept for step 6; the Cloudflare
//      token comes from `wrangler auth token --json` (stdout, never printed or put on a command line); then the
//      account's Hyperdrive configs are listed, which proves the token, the account and Hyperdrive access.
//   2. Generates four 32-byte hex passwords and a 32-byte hex media-link HMAC key (services/api importHmacKey takes
//      the string, at least 32 characters), in memory only.
//   3. One psql transaction as postgres, SQL on stdin, ON_ERROR_STOP=1 (lib.mjs runSql): refuses (TR001) if a
//      trace_* role is missing (migrations not applied); per login creates the role (`login noinherit`) or sets a new
//      password; grants exactly its one trace_* role `with inherit false, set true`; then refuses (TR002) any other
//      membership or attribute. Never drops or revokes. The password reaches Postgres as a SCRAM-SHA-256 verifier
//      only, so the plain text is never in a server log.
//   4. Per HYPERDRIVE_PLAN entry, in order: PUT (full update) the config of that exact name, or POST (create) it.
//      The password travels only in the JSON body over HTTPS to api.cloudflare.com. Hyperdrive opens a test
//      connection to the origin on create and update, so a wrong CA, sslmode or host fails here.
//   5. `pnpm exec wrangler secret put MEDIA_LINK_HMAC_KEY --env staging` in services/api, the value on stdin only.
//      Never CANDIDATE_TOKEN_PRIVATE_JWK (candidate-token-key.mjs runbook) and never the edge Worker (no secret).
//   6. `pnpm exec wrangler secret delete <NAME> --env staging` for each retired *_DB_URL secret step 1 listed on
//      that Worker (check-staging-secrets fails on a leftover one).
//   7. Prints each config id (not a secret) and the env.staging `hyperdrive` lines for the two wrangler.jsonc files.
// No value is printed, logged, written to disk or put on a command line: not the operator URL, not a password,
// not the key, not the token. Errors name a variable, a secret, a config, a SQLSTATE, an HTTP status or a
// Cloudflare error code, never a value. Child output and Cloudflare error messages are not echoed.
// Exit codes: 0 done (or a clean dry run), 1 a step failed, 2 bad arguments or a refusal (nothing changed).
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOW_LIST, WORKER_DIRS, parseSecretList } from '../check-staging-secrets.mjs';
import { isEntryPoint } from '../lib/cli.mjs';
import { LOGIN_ROLES, isLoginPassword } from '../lib/e2e-local-secrets.mjs';
import {
  CLOUDFLARE_ACCOUNT_ID,
  HYPERDRIVE_ID_RE,
  HYPERDRIVE_PLAN,
  HYPERDRIVE_SSLMODES,
  ORIGIN_CONNECTION_LIMIT,
} from '../lib/hyperdrive.mjs';
import {
  DB_URL_ENV,
  childEnvOf,
  describeFailure,
  isUuid,
  line,
  parseFlags,
  pgEnvOf,
  runSql,
} from './lib.mjs';

const TAG = 'staging-worker-secrets';
/**
 * The staging project ref, pinned (public: docs/infra/environments.md, the GitHub variable of the same name; a test
 * keeps the two equal). The operator URL must point at this project. SUPABASE_STAGING_PROJECT_REF is optional; when
 * it is set it must equal this value, so a stale shell variable cannot quietly aim the script elsewhere.
 */
export const STAGING_PROJECT_REF = 'vsugnnxeahjtgzmgmyfu';
export const REF_ENV = 'SUPABASE_STAGING_PROJECT_REF';
/** The Hyperdrive configs of the pinned staging account (scripts/lib/hyperdrive.mjs); the only API this calls. */
export const HYPERDRIVE_CONFIGS_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/hyperdrive/configs`;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPTIONS = {
  env: { type: 'string' },
  'dry-run': { type: 'boolean' },
  yes: { type: 'boolean' },
  'ca-certificate-id': { type: 'string' },
  sslmode: { type: 'string' },
};
const DEFAULT_SSLMODE = 'verify-full';
const CF_TIMEOUT_MS = 60_000;

/**
 * The Workers this script touches and the secrets it sets. `login` is always null now: the database logins live in
 * Hyperdrive configs (HYPERDRIVE_PLAN), so the only secret is the media-link HMAC key. jobs is listed for the
 * "Worker exists" check and the retired-secret deletes. `workerName` is `env.staging.name` of the folder's
 * wrangler.jsonc (a test pins it).
 */
export const PLAN = Object.freeze([
  Object.freeze({
    worker: 'api',
    dir: WORKER_DIRS.api,
    workerName: 'trace-api-staging',
    secrets: Object.freeze([Object.freeze({ name: 'MEDIA_LINK_HMAC_KEY', login: null })]),
  }),
  Object.freeze({
    worker: 'jobs',
    dir: WORKER_DIRS.jobs,
    workerName: 'trace-jobs-staging',
    secrets: Object.freeze([]),
  }),
]);

/**
 * The database URL secrets retired on staging (ADR-031 amendment 1, d1 revision 4o): step 6 deletes each one the
 * Worker still holds, because check-staging-secrets refuses them.
 */
export const RETIRED_SECRETS = Object.freeze({
  api: Object.freeze(['API_DB_URL']),
  jobs: Object.freeze(['JOBS_MIRROR_DB_URL', 'JOBS_QUALITY_DB_URL', 'JOBS_INTEGRITY_DB_URL']),
});

// Fail at load if the plan ever leaves the allow-list, reaches edge, keeps a retired name or misses a login.
for (const w of PLAN) {
  if (w.worker === 'edge') throw new Error(`${TAG}: the edge Worker holds no secret`);
  for (const s of w.secrets) {
    if (!ALLOW_LIST[w.worker]?.includes(s.name)) {
      throw new Error(`${TAG}: ${s.name} is not on the ${w.worker} allow-list`);
    }
    if (s.login !== null) throw new Error(`${TAG}: ${s.name} must not hold a database login`);
  }
}
for (const [worker, names] of Object.entries(RETIRED_SECRETS)) {
  if (!PLAN.some((w) => w.worker === worker)) throw new Error(`${TAG}: ${worker} is not planned`);
  for (const name of names) {
    if (ALLOW_LIST[worker]?.includes(name)) {
      throw new Error(`${TAG}: the retired ${name} is still on the ${worker} allow-list`);
    }
  }
}
{
  const planned = HYPERDRIVE_PLAN.map((p) => p.login).sort();
  if (
    planned.join() !==
    LOGIN_ROLES.map((r) => r.login)
      .sort()
      .join()
  ) {
    throw new Error(`${TAG}: the plan must give each login role exactly one Hyperdrive config`);
  }
  for (const p of HYPERDRIVE_PLAN) {
    if (!PLAN.some((w) => w.worker === p.worker)) {
      throw new Error(`${TAG}: the Hyperdrive config ${p.config} is on an unplanned Worker`);
    }
  }
}

// --- arguments ------------------------------------------------------------------------------------

const USAGE =
  'use --env staging --ca-certificate-id <id> [--sslmode verify-full|verify-ca] [--dry-run | --yes]';

/**
 * `--env staging`, at most one of `--dry-run` / `--yes`, `--ca-certificate-id <uuid>` (required with either; the
 * id `wrangler cert upload certificate-authority` printed, lower-cased) and `--sslmode verify-full|verify-ca`
 * (default verify-full). Messages never echo a value.
 */
export function parseCli(argv) {
  let flags;
  try {
    flags = parseFlags(argv, OPTIONS);
  } catch {
    return { ok: false, why: `unknown or malformed argument (${USAGE})` };
  }
  if (flags.env === undefined) return { ok: false, why: '--env staging is required' };
  if (flags.env !== 'staging') return { ok: false, why: 'only --env staging is allowed' };
  const dryRun = flags['dry-run'] === true;
  const yes = flags.yes === true;
  if (dryRun && yes) return { ok: false, why: 'use --dry-run or --yes, not both' };
  const rawCa = flags['ca-certificate-id'];
  if (rawCa === undefined && (dryRun || yes)) {
    return {
      ok: false,
      why: '--ca-certificate-id is required with --dry-run or --yes (the ID `wrangler cert upload certificate-authority` printed)',
    };
  }
  if (rawCa !== undefined && !isUuid(rawCa)) {
    return {
      ok: false,
      why: '--ca-certificate-id must be the UUID `wrangler cert upload certificate-authority` printed',
    };
  }
  const sslmode = flags.sslmode ?? DEFAULT_SSLMODE;
  if (!HYPERDRIVE_SSLMODES.includes(sslmode)) {
    return {
      ok: false,
      why: `--sslmode must be ${HYPERDRIVE_SSLMODES.join(' or ')} (Hyperdrive must verify the Supabase CA; require is never allowed)`,
    };
  }
  return { ok: true, dryRun, yes, caId: rawCa === undefined ? null : rawCa.toLowerCase(), sslmode };
}

// --- the operator URL -----------------------------------------------------------------------------

const REF_RE = /^[a-z0-9]{20}$/;
const POOLER_HOST_RE = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/;
const POOLER_USER_RE = /^postgres\.([a-z0-9]{20})$/;
const DIRECT_HOST_RE = /^db\.([a-z0-9]{20})\.supabase\.co$/;
const STRONG_SSLMODES = new Set(['require', 'verify-ca', 'verify-full']);

const isLoopback = (host) =>
  host === 'localhost' ||
  host.endsWith('.localhost') ||
  host === '0.0.0.0' ||
  host === '[::1]' ||
  host === '[::]' ||
  /^127\.\d+\.\d+\.\d+$/.test(host) ||
  /^\[::ffff:(127\.|7f)/.test(host);

/**
 * Checks TRACE_OPERATOR_DB_URL against the staging project. Returns `{ ok, kind: 'pooler'|'direct', ref, host }`
 * or `{ ok: false, why }`; `why` names variables only, never a value.
 */
export function parseOperatorUrl(raw, expectedRef) {
  const fail = (why) => ({ ok: false, why });
  if (typeof expectedRef !== 'string' || !REF_RE.test(expectedRef)) {
    return fail('the expected staging project ref must be 20 lower-case letters or digits');
  }
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return fail(`${DB_URL_ENV} is not set`);
  let u;
  try {
    u = new URL(text);
  } catch {
    return fail(`${DB_URL_ENV} is not a URL`);
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    return fail(`${DB_URL_ENV} must be a postgresql:// URL`);
  }
  const host = u.hostname.toLowerCase();
  if (host === '') return fail(`${DB_URL_ENV} has no host`);
  if (isLoopback(host)) {
    return fail(
      `${DB_URL_ENV} points at this computer; this script is for staging only (the local stack makes its own login roles in scripts/e2e-local.mjs)`,
    );
  }
  let user;
  try {
    user = decodeURIComponent(u.username);
  } catch {
    return fail(`${DB_URL_ENV} has a malformed user name`);
  }
  if (/prod/i.test(host) || /prod/i.test(user) || /prod/i.test(u.pathname)) {
    return fail(`${DB_URL_ENV} looks like production; this script runs on staging only`);
  }
  const keys = [...u.searchParams.keys()];
  const modes = u.searchParams.getAll('sslmode');
  if (keys.some((k) => k !== 'sslmode') || modes.length !== 1 || !STRONG_SSLMODES.has(modes[0])) {
    return fail(`${DB_URL_ENV} must end in ?sslmode=require (TLS) and carry no other parameter`);
  }
  if (u.password === '') return fail(`${DB_URL_ENV} has no password`);
  if (u.pathname !== '/postgres') return fail(`${DB_URL_ENV} must name the database postgres`);

  let kind;
  let ref;
  if (POOLER_HOST_RE.test(host)) {
    if (u.port !== '5432') {
      return fail(
        `${DB_URL_ENV} must use the session pooler port 5432 (6543 is the transaction pooler)`,
      );
    }
    const m = POOLER_USER_RE.exec(user);
    if (!m) return fail(`${DB_URL_ENV} must connect to the pooler as postgres.<project ref>`);
    kind = 'pooler';
    ref = m[1];
  } else if (DIRECT_HOST_RE.test(host)) {
    if (u.port !== '' && u.port !== '5432') return fail(`${DB_URL_ENV} must use port 5432`);
    if (user !== 'postgres') return fail(`${DB_URL_ENV} must connect as postgres`);
    kind = 'direct';
    ref = DIRECT_HOST_RE.exec(host)[1];
  } else {
    return fail(
      `${DB_URL_ENV} must be the Supabase session pooler (aws-N-<region>.pooler.supabase.com) or the direct host (db.<ref>.supabase.co) of staging`,
    );
  }
  if (ref !== expectedRef) {
    return fail(`${DB_URL_ENV} is not the staging project (${REF_ENV})`);
  }
  return { ok: true, kind, ref, host };
}

// --- values, SCRAM and SQL ------------------------------------------------------------------------

const PASSWORD_BYTES = 32;
const HMAC_KEY_BYTES = 32;
const SALT_BYTES = 16;
const SCRAM_ITERATIONS = 4096;
const VERIFIER_RE =
  /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;

/** In-memory values for one run: a password and a salt per login, and the media-link HMAC key. */
export function generateValues(rand = randomBytes) {
  const passwords = {};
  for (const { login } of LOGIN_ROLES) passwords[login] = rand(PASSWORD_BYTES).toString('hex');
  const hmacKey = rand(HMAC_KEY_BYTES).toString('hex');
  const salts = {};
  for (const { login } of LOGIN_ROLES) salts[login] = Buffer.from(rand(SALT_BYTES));
  return { passwords, hmacKey, salts };
}

/**
 * The SCRAM-SHA-256 verifier Postgres stores for a password (RFC 5802/7677, the format of pg_authid.rolpassword and
 * of psql's \password): `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`, all base64. Handing Postgres
 * the verifier instead of the password keeps the plain text out of the server and its logs.
 */
export function scramSha256Verifier(password, salt, iterations = SCRAM_ITERATIONS) {
  if (typeof password !== 'string' || !/^[\x21-\x7e]+$/.test(password)) {
    throw new Error(`${TAG}: a SCRAM password must be printable ASCII`);
  }
  if (!(salt instanceof Uint8Array) || salt.length !== SALT_BYTES) {
    throw new Error(`${TAG}: a SCRAM salt must be ${SALT_BYTES} bytes`);
  }
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  const b64 = (b) => Buffer.from(b).toString('base64');
  return `SCRAM-SHA-256$${iterations}:${b64(salt)}$${b64(storedKey)}:${b64(serverKey)}`;
}

const sqlList = (names) => names.map((n) => `'${n}'`).join(', ');

/**
 * The one transaction run as postgres on staging. Roles are fixed names; each password enters as its SCRAM verifier
 * (base64 only, checked), so no value needs quoting beyond a plain literal. Throws, naming the login only, when a
 * password is not 64-128 lower-case hex characters or a salt is missing.
 */
export function stagingLoginRolesSql({ passwords, salts }) {
  const logins = LOGIN_ROLES.map((r) => r.login);
  const roles = LOGIN_ROLES.map((r) => r.role);
  const out = [
    'begin;',
    'do $trace$',
    'begin',
    `  if (select count(*) from pg_catalog.pg_roles where rolname in (${sqlList(roles)})) <> ${roles.length} then`,
    "    raise exception using errcode = 'TR001', message = 'a trace_* role is missing: apply the migrations first';",
    '  end if;',
    'end',
    '$trace$;',
  ];
  for (const { login, role } of LOGIN_ROLES) {
    const pw = passwords?.[login];
    if (!isLoginPassword(pw) || pw.length < PASSWORD_BYTES * 2) {
      throw new Error(
        `${TAG}: the generated password for ${login} is not 64-128 lower-case hex characters`,
      );
    }
    const salt = salts?.[login];
    if (!(salt instanceof Uint8Array) || salt.length !== SALT_BYTES) {
      throw new Error(`${TAG}: the salt for ${login} is missing`);
    }
    const verifier = scramSha256Verifier(pw, salt);
    if (!VERIFIER_RE.test(verifier))
      throw new Error(`${TAG}: the verifier for ${login} is malformed`);
    out.push(
      'do $trace$',
      'begin',
      `  if exists (select 1 from pg_catalog.pg_roles where rolname = '${login}') then`,
      `    alter role ${login} with login noinherit password '${verifier}';`,
      '  else',
      `    create role ${login} with login noinherit password '${verifier}';`,
      '  end if;',
      'end',
      '$trace$;',
      `grant ${role} to ${login} with inherit false, set true;`,
    );
  }
  const pairs = LOGIN_ROLES.map(({ login, role }) => `('${login}', '${role}')`).join(', ');
  out.push(
    'do $trace$',
    'begin',
    '  if exists (',
    '    select 1 from pg_catalog.pg_roles l',
    `    where l.rolname in (${sqlList(logins)})`,
    '      and (not l.rolcanlogin or l.rolinherit or l.rolsuper or l.rolcreaterole or l.rolcreatedb',
    '           or l.rolreplication or l.rolbypassrls)',
    '  ) or exists (',
    '    select 1',
    '    from pg_catalog.pg_auth_members m',
    '    join pg_catalog.pg_roles l on l.oid = m.member',
    '    join pg_catalog.pg_roles r on r.oid = m.roleid',
    `    where l.rolname in (${sqlList(logins)})`,
    `      and not ((l.rolname, r.rolname) in (${pairs})`,
    '               and not m.inherit_option and m.set_option and not m.admin_option)',
    '  ) then',
    "    raise exception using errcode = 'TR002', message = 'a login role has an unexpected membership or attribute';",
    '  end if;',
    'end',
    '$trace$;',
    'commit;',
    '',
  );
  return out.join('\n');
}

// --- Hyperdrive -----------------------------------------------------------------------------------

/**
 * The create (POST) and full-update (PUT) body of one login's Hyperdrive config. Origin: the operator's host
 * (pooler: user `<login>.<ref>`, Supavisor finds the project from the suffix; direct: `<login>` on
 * db.<ref>.supabase.co), port 5432 (session mode, ADR-031), database postgres. Caching is disabled: a cached read
 * would be served across role and org scoping. mtls verifies the origin against the uploaded Supabase CA; `require`
 * (no verification) is refused. Throws, naming the config only, never a value.
 */
export function hyperdriveBody(target, entry, password, { caId, sslmode = DEFAULT_SSLMODE } = {}) {
  const planned = HYPERDRIVE_PLAN.find((p) => p.config === entry?.config);
  if (!planned || planned.login !== entry.login) {
    throw new Error(`${TAG}: unknown Hyperdrive config`);
  }
  if (!isLoginPassword(password) || password.length < PASSWORD_BYTES * 2) {
    throw new Error(
      `${TAG}: the password for ${planned.config} is not 64-128 lower-case hex characters`,
    );
  }
  if (typeof caId !== 'string' || !isUuid(caId)) {
    throw new Error(`${TAG}: ${planned.config} needs the CA certificate id (a UUID)`);
  }
  if (!HYPERDRIVE_SSLMODES.includes(sslmode)) {
    throw new Error(`${TAG}: ${planned.config} needs sslmode verify-full or verify-ca`);
  }
  if (target?.kind !== 'pooler' && target?.kind !== 'direct') {
    throw new Error(`${TAG}: ${planned.config} has no checked database host`);
  }
  return {
    name: planned.config,
    origin: {
      scheme: 'postgresql',
      host: target.host,
      port: 5432,
      database: 'postgres',
      user: target.kind === 'pooler' ? `${planned.login}.${target.ref}` : planned.login,
      password,
    },
    caching: { disabled: true },
    mtls: { ca_certificate_id: caId, sslmode },
    origin_connection_limit: ORIGIN_CONNECTION_LIMIT,
  };
}

const TOKEN_TYPES = new Set(['oauth', 'api_token']);

/**
 * The output of `wrangler auth token --json` (wrangler 4.149 authTokenCommand: `{ type, token }` for an OAuth login
 * or CLOUDFLARE_API_TOKEN; `{ type: 'api_key', key, email }` for a global API key, which is refused). Returns
 * `{ ok: true, type, token }` or `{ ok: false }`; never a value on failure.
 */
export function parseAuthToken(stdout) {
  const text = typeof stdout === 'string' ? stdout : '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return { ok: false };
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return { ok: false };
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false };
  const { type, token } = parsed;
  if (!TOKEN_TYPES.has(type)) return { ok: false };
  // printable ASCII only: it goes into an HTTP header
  if (typeof token !== 'string' || !/^[\x21-\x7e]+$/.test(token)) return { ok: false };
  return { ok: true, type, token };
}

/**
 * The `hyperdrive` line to paste under env.staging of each Worker's wrangler.jsonc, from binding -> config id.
 * Ids are not secrets (a config id works only inside the account that owns it).
 */
export function wranglerSnippets(ids) {
  const out = [];
  for (const w of PLAN) {
    const entries = HYPERDRIVE_PLAN.filter((p) => p.worker === w.worker);
    if (entries.length === 0) continue;
    const parts = entries.map((p) => {
      const id = ids?.[p.binding];
      if (typeof id !== 'string' || !HYPERDRIVE_ID_RE.test(id)) {
        throw new Error(`${TAG}: no well-formed Hyperdrive id for ${p.binding}`);
      }
      return `{ "binding": "${p.binding}", "id": "${id}" }`;
    });
    out.push({
      worker: w.worker,
      file: `${w.dir}/wrangler.jsonc`,
      line: `"hyperdrive": [${parts.join(', ')}]`,
    });
  }
  return out;
}

/**
 * One Cloudflare API call through `deps.fetch`: Bearer token, JSON, no redirect (the token must not follow one),
 * a timeout. Success needs HTTP 2xx and `success === true`. A failure carries only the HTTP status (null when no
 * response came) and the numeric `errors[].code` values; never a message or the body.
 */
async function cloudflare(deps, token, method, url, body) {
  const init = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(CF_TIMEOUT_MS),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  let res;
  try {
    res = await deps.fetch(url, init);
  } catch {
    return { ok: false, status: null, codes: [] };
  }
  const status = Number.isInteger(res?.status) ? res.status : null;
  let json = null;
  try {
    json = JSON.parse(await res.text());
  } catch {
    json = null;
  }
  const codes = Array.isArray(json?.errors)
    ? json.errors
        .map((e) => e?.code)
        .filter((c) => Number.isInteger(c))
        .slice(0, 10)
    : [];
  if (status === null || status < 200 || status > 299 || json?.success !== true) {
    return { ok: false, status, codes };
  }
  return { ok: true, status, json };
}

/** "HTTP 403, Cloudflare error codes 10000, 9109" (or a no-response note); never a message. */
function cfDetail(r) {
  if (r.status === null) return 'no HTTP response (network error or timeout)';
  const codes =
    r.codes.length > 0
      ? `Cloudflare error code${r.codes.length > 1 ? 's' : ''} ${r.codes.join(', ')}`
      : 'no Cloudflare error code';
  return `HTTP ${r.status}, ${codes}`;
}

/**
 * The account's configs (GET list, one page) matched to the plan by exact name. `{ ok: true, existing }` (config
 * name -> id) or `{ ok: false, code, why }`.
 */
async function listConfigs(deps, token) {
  const r = await cloudflare(deps, token, 'GET', HYPERDRIVE_CONFIGS_URL);
  if (!r.ok || !Array.isArray(r.json.result)) {
    return {
      ok: false,
      code: 2,
      why: `listing the Hyperdrive configs of the staging account failed (${r.ok ? 'the result is not a list' : cfDetail(r)}); check that \`pnpm exec wrangler whoami\` shows the Trace account and that your login may manage Hyperdrive. Nothing was changed`,
    };
  }
  const list = r.json.result;
  const info = r.json.result_info ?? {};
  if (
    (Number.isInteger(info.total_pages) && info.total_pages > 1) ||
    (Number.isInteger(info.total_count) && info.total_count > list.length)
  ) {
    return {
      ok: false,
      code: 1,
      why: 'the staging account has more Hyperdrive configs than one page holds, so this script cannot tell whether a planned config exists; delete unused configs in the Cloudflare dashboard and retry. Nothing was changed',
    };
  }
  const existing = {};
  for (const { config } of HYPERDRIVE_PLAN) {
    const matches = list.filter((c) => c !== null && typeof c === 'object' && c.name === config);
    if (matches.length > 1) {
      return {
        ok: false,
        code: 1,
        why: `the staging account has ${matches.length} Hyperdrive configs named ${config}; delete the extra ones in the Cloudflare dashboard and retry. Nothing was changed`,
      };
    }
    if (matches.length === 1) {
      const { id } = matches[0];
      if (typeof id !== 'string' || !HYPERDRIVE_ID_RE.test(id)) {
        return {
          ok: false,
          code: 1,
          why: `the Hyperdrive config ${config} has an id that is not 32 lower-case hex characters. Nothing was changed`,
        };
      }
      existing[config] = id;
    }
  }
  return { ok: true, existing };
}

// --- wrangler -------------------------------------------------------------------------------------

/**
 * Runs `pnpm exec wrangler <args>` in a Worker folder with the value (if any) on stdin. pnpm is a .cmd shim on
 * Windows, which Node starts only through a shell; the command line is built from constants (secret names from the
 * frozen PLAN and RETIRED_SECRETS), never from a value. Output is captured; only the token call reads it.
 */
function wrangler(deps, dir, args, input) {
  const cwd = join(deps.repoRoot ?? REPO_ROOT, dir);
  const full = ['exec', 'wrangler', ...args];
  // wrangler 4.149 writes its debug log (with request bodies, so a `secret put` value) to ~/.wrangler/logs
  // unless told not to (cli.js shouldLogToDisk ~69710, WRANGLER_LOG ~69757, WRANGLER_LOG_SANITIZE ~25300).
  const env = childEnvOf(deps.env);
  delete env.WRANGLER_LOG;
  env.WRANGLER_WRITE_LOGS = 'false';
  env.WRANGLER_LOG_SANITIZE = 'true';
  const opts = {
    cwd,
    input: input ?? '',
    encoding: 'utf8',
    env,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  };
  try {
    return deps.platform === 'win32'
      ? deps.spawnSync(['pnpm', ...full].join(' '), [], { ...opts, shell: true })
      : deps.spawnSync('pnpm', full, { ...opts, shell: false });
  } catch {
    return { status: null, error: new Error('spawn failed'), stdout: '', stderr: '' };
  }
}

const failed = (r) => !r || r.error || r.status !== 0;

// --- main -----------------------------------------------------------------------------------------

function planLines(target, cli) {
  const via = target.kind === 'pooler' ? 'the Supabase session pooler' : 'the direct database host';
  const ca = cli.caId ?? '(not given: --ca-certificate-id is required with --dry-run or --yes)';
  const workerOf = (worker) => PLAN.find((w) => w.worker === worker);
  return [
    `${TAG}: plan for staging (database reached through ${via}, TLS)`,
    '  1. Database, one transaction as postgres (nothing is dropped or revoked):',
    ...LOGIN_ROLES.map(
      ({ login, role }) =>
        `       ${login} -> ${role} (inherit false, set true): create if missing, else set a new password`,
    ),
    `  2. Hyperdrive configs in Cloudflare account ${CLOUDFLARE_ACCOUNT_ID} (created if missing, else updated; Hyperdrive tests the connection):`,
    ...HYPERDRIVE_PLAN.map(
      (p) =>
        `       ${p.config}: binding ${p.binding} on ${workerOf(p.worker).workerName}, login ${p.login} via ${via}, sslmode ${cli.sslmode}, CA ${ca}, caching disabled, origin connection limit ${ORIGIN_CONNECTION_LIMIT}`,
    ),
    '  3. Worker secret (pnpm exec wrangler secret put <NAME> --env staging, value on stdin):',
    ...PLAN.filter((w) => w.secrets.length > 0).map(
      (w) => `       ${w.workerName} (${w.dir}): ${w.secrets.map((s) => s.name).join(', ')}`,
    ),
    '  4. Retired database URL secrets, deleted where present (pnpm exec wrangler secret delete <NAME> --env staging):',
    ...Object.entries(RETIRED_SECRETS).map(
      ([worker, names]) =>
        `       ${workerOf(worker).workerName} (${workerOf(worker).dir}): ${names.join(', ')}`,
    ),
    '  Not touched: CANDIDATE_TOKEN_PRIVATE_JWK and trace-edge-staging (no secret).',
    '  A re-run makes new passwords and updates the same four configs; between steps 1 and 2 the configs hold the',
    '  old passwords for tens of seconds (four config updates in a row, each one tests the database connection).',
  ];
}

/** Returns the exit code: 0 done, 1 a step failed, 2 bad arguments or a refusal (nothing changed). */
export async function main({ argv, deps = realScriptDeps() }) {
  const say = (text) => line(deps.stdout, text);
  const fail = (code, text) => {
    line(deps.stderr, `${TAG}: ${text}`);
    return code;
  };

  // 1. Checks. Nothing is generated, written or called before they pass.
  const cli = parseCli(argv);
  if (!cli.ok) return fail(2, cli.why);
  const raw = deps.env[DB_URL_ENV];
  if (typeof raw !== 'string' || raw.trim() === '') {
    return fail(2, `${DB_URL_ENV} is not set (the staging session-pooler string, as postgres)`);
  }
  const refFromEnv = (deps.env[REF_ENV] ?? '').trim();
  if (refFromEnv !== '' && refFromEnv !== STAGING_PROJECT_REF) {
    return fail(2, `${REF_ENV} is set but is not the staging project ref this script is pinned to`);
  }
  const target = parseOperatorUrl(raw, STAGING_PROJECT_REF);
  if (!target.ok) return fail(2, target.why);
  const operatorUrl = raw.trim();
  if (!pgEnvOf(operatorUrl).ok) return fail(2, `${DB_URL_ENV} cannot be handed to psql`);
  let probe;
  try {
    probe = deps.spawnSync('psql', ['--version'], { encoding: 'utf8', shell: false });
  } catch {
    probe = null;
  }
  if (failed(probe)) {
    return fail(2, 'psql is required on PATH (the PostgreSQL client); nothing was changed');
  }

  for (const text of planLines(target, cli)) say(text);
  if (cli.dryRun) {
    say(
      `${TAG}: dry run: the arguments, ${DB_URL_ENV} and psql are fine; nothing was changed (the Workers, wrangler's login and Hyperdrive are checked only with --yes)`,
    );
    return 0;
  }
  if (!cli.yes) {
    say(`${TAG}: nothing was changed; re-run with --yes to apply this plan`);
    return 2;
  }

  // Both Workers must exist: `secret put` would otherwise create an empty draft Worker without asking. The names
  // listed here decide which retired secrets step 6 deletes.
  const held = {};
  for (const w of PLAN) {
    const r = wrangler(deps, w.dir, ['secret', 'list', '--env', 'staging', '--format', 'json']);
    if (failed(r)) {
      const missing = /not found/i.test(`${r?.stdout ?? ''}\n${r?.stderr ?? ''}`);
      return fail(
        2,
        missing
          ? `the Worker ${w.workerName} does not exist yet; run this after the first staging deploy. Nothing was changed`
          : `wrangler cannot list the secrets of ${w.workerName}; check \`pnpm exec wrangler whoami\` (or run \`pnpm exec wrangler login\`) and retry. Nothing was changed`,
      );
    }
    const parsed = parseSecretList(r.stdout);
    if (parsed.error) {
      return fail(
        2,
        `cannot read the secret list of ${w.workerName} (${parsed.error}). Nothing was changed`,
      );
    }
    held[w.worker] = new Set(parsed.names);
  }

  // The Cloudflare token, from wrangler's own login, for the Hyperdrive API. It stays in memory: never printed,
  // never in a child's argv or environment.
  const tokenRun = wrangler(deps, WORKER_DIRS.api, ['auth', 'token', '--json']);
  const auth = failed(tokenRun) ? { ok: false } : parseAuthToken(tokenRun.stdout);
  if (!auth.ok) {
    return fail(
      2,
      'wrangler is not logged in with a token (an OAuth login or CLOUDFLARE_API_TOKEN; a global API key is not supported); run `pnpm exec wrangler login` and retry. Nothing was changed',
    );
  }

  // Listing the configs proves the token, the account and Hyperdrive access before anything changes.
  const listed = await listConfigs(deps, auth.token);
  if (!listed.ok) return fail(listed.code, listed.why);

  // 2. New values. 3. The database transaction.
  const values = generateValues(deps.randomBytes ?? randomBytes);
  let sql;
  let bodies;
  try {
    sql = stagingLoginRolesSql(values);
    bodies = HYPERDRIVE_PLAN.map((p) => hyperdriveBody(target, p, values.passwords[p.login], cli));
  } catch {
    return fail(1, 'building the role SQL or the Hyperdrive configs failed; nothing was changed');
  }
  const configs = HYPERDRIVE_PLAN.map((p) => p.config);
  const db = runSql({ url: operatorUrl, sql, vars: {} }, deps);
  if (!db.ok) {
    if (db.sqlstate === 'TR001') {
      return fail(
        1,
        'a trace_* role is missing on staging: apply the migrations first (the transaction rolled back; nothing was changed)',
      );
    }
    if (db.sqlstate === 'TR002') {
      return fail(
        1,
        'a login role has an unexpected membership or attribute (each may hold only its one trace_* role, inherit false, set true); fix it by hand. The transaction rolled back; nothing was changed',
      );
    }
    if (db.sqlstate === null) {
      // No SQLSTATE: the connection dropped, psql was killed or timed out. The commit may or may not have run.
      return fail(
        1,
        `the database call ended without a SQL error (connection lost, psql exit or timeout), so the outcome is unknown: the login passwords may have changed, and then the four Hyperdrive configs (${configs.join(', ')}) are stale and MEDIA_LINK_HMAC_KEY is not set yet. Re-run with --yes (it sets new passwords and updates every config and the secret again)`,
      );
    }
    return fail(1, `${describeFailure(db)}; the transaction rolled back, nothing was changed`);
  }
  say(`${TAG}: database: ${LOGIN_ROLES.length} login roles have new passwords and their one grant`);

  // 4. The Hyperdrive configs, in plan order. A failure leaves this and the later ones on old passwords.
  const ids = {};
  for (const [i, p] of HYPERDRIVE_PLAN.entries()) {
    const id = listed.existing[p.config];
    const r =
      id === undefined
        ? await cloudflare(deps, auth.token, 'POST', HYPERDRIVE_CONFIGS_URL, bodies[i])
        : await cloudflare(deps, auth.token, 'PUT', `${HYPERDRIVE_CONFIGS_URL}/${id}`, bodies[i]);
    const newId = id ?? r.json?.result?.id;
    if (!r.ok || typeof newId !== 'string' || !HYPERDRIVE_ID_RE.test(newId)) {
      const stale = configs.slice(i);
      return fail(
        1,
        `${id === undefined ? 'creating' : 'updating'} the Hyperdrive config ${p.config} failed (${r.ok ? 'the created config has no 32-character hex id' : cfDetail(r)}). Hyperdrive tests the database connection on create and update, so the CA, the sslmode or the host may be wrong: check --ca-certificate-id, or try --sslmode verify-ca. The database passwords already changed, so these configs hold old passwords or do not exist yet: ${stale.join(', ')}. Fix the cause and re-run with --yes`,
      );
    }
    ids[p.binding] = newId;
    say(`${TAG}: ${id === undefined ? 'created' : 'updated'} the Hyperdrive config ${p.config}`);
  }

  // 5. The api secret, value on stdin.
  for (const w of PLAN) {
    for (const s of w.secrets) {
      const r = wrangler(
        deps,
        w.dir,
        ['secret', 'put', s.name, '--env', 'staging'],
        values.hmacKey,
      );
      if (failed(r)) {
        return fail(
          1,
          `setting ${s.name} on ${w.workerName} failed (the four Hyperdrive configs are done). Fix the cause (wrangler whoami; a Worker whose latest version is not deployed) and re-run with --yes`,
        );
      }
      say(`${TAG}: set ${s.name} on ${w.workerName}`);
    }
  }

  // 6. Retired secrets the Workers still hold. stdin is empty, so wrangler's "Are you sure" confirm takes its
  // non-interactive fallback "yes" (wrangler 4.149 cli.js confirm2 + isNonInteractiveOrCI ~139587; the
  // `secret delete` handler ~310832).
  for (const w of PLAN) {
    for (const name of RETIRED_SECRETS[w.worker] ?? []) {
      if (!held[w.worker].has(name)) continue;
      const r = wrangler(deps, w.dir, ['secret', 'delete', name, '--env', 'staging']);
      if (failed(r)) {
        return fail(
          1,
          `deleting the retired secret ${name} on ${w.workerName} failed; check-staging-secrets fails the deploy until it is gone. Re-run with --yes, or run \`pnpm exec wrangler secret delete ${name} --env staging\` in ${w.dir}`,
        );
      }
      say(`${TAG}: deleted the retired secret ${name} on ${w.workerName}`);
    }
  }

  // 7. The ids (not secrets) and what to commit.
  for (const p of HYPERDRIVE_PLAN) {
    say(`${TAG}: hyperdrive ${p.binding} (${p.worker}) id=${ids[p.binding]}`);
  }
  say(`${TAG}: paste under env.staging of each wrangler.jsonc:`);
  for (const s of wranglerSnippets(ids)) {
    say(`  ${s.file}:`);
    say(`    ${s.line}`);
  }
  say(
    `${TAG}: done. send these ids to the lead; the next staging dispatch needs them committed. Its check-staging-secrets step lists the secret names; the values are only in Cloudflare.`,
  );
  return 0;
}

/** The real world, plus the values this script needs beyond lib.mjs realDeps. */
function realScriptDeps() {
  return {
    env: process.env,
    spawnSync,
    fetch: globalThis.fetch,
    randomBytes,
    platform: process.platform,
    stdout: process.stdout,
    stderr: process.stderr,
    repoRoot: REPO_ROOT,
  };
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main({ argv: process.argv.slice(2) });
}
