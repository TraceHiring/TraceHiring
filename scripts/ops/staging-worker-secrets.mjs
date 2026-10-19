#!/usr/bin/env node
// Operator script: the four staging database login roles and the staging Worker secrets that hold them
// (specs/d1-demo-slice.md §3 "Roles", §7.1 secrets and the check-staging-secrets allow-list, §8 DC-D7; ADR-031).
//   TRACE_OPERATOR_DB_URL=... SUPABASE_STAGING_PROJECT_REF=... \
//     node scripts/ops/staging-worker-secrets.mjs --env staging [--dry-run | --yes]
// Run by the founder, once, on their own computer, AFTER the first staging deploy (the Workers must exist) and
// before the D1 staging smoke. A re-run rotates: new passwords, then new secrets.
//   1. Checks: --env staging only; TRACE_OPERATOR_DB_URL is the staging project's Supabase session pooler
//      (postgres.<ref> @ aws-N-<region>.pooler.supabase.com:5432) or direct host (postgres @ db.<ref>.supabase.co),
//      with ?sslmode=require (or verify-ca / verify-full); the ref equals SUPABASE_STAGING_PROJECT_REF; psql exists;
//      and (with --yes) `wrangler secret list` works for trace-api-staging and trace-jobs-staging. wrangler 4.149's
//      `secret put` with piped input creates an empty draft Worker when the Worker is missing (createDraftWorker,
//      fallback "yes" in a non-interactive context), so a missing Worker stops the run here, before the database.
//   2. Generates four 32-byte hex passwords and a 32-byte hex media-link HMAC key (services/api importHmacKey takes
//      the string, at least 32 characters), in memory only.
//   3. One psql transaction as postgres, SQL on stdin, ON_ERROR_STOP=1 (lib.mjs runSql): refuses (TR001) if a
//      trace_* role is missing (migrations not applied); per login creates the role (`login noinherit`) or sets a new
//      password; grants exactly its one trace_* role `with inherit false, set true`; then refuses (TR002) any other
//      membership or attribute. Never drops or revokes. The password reaches Postgres as a SCRAM-SHA-256 verifier
//      only, so the plain text is never in a server log.
//   4. `pnpm exec wrangler secret put <NAME> --env staging` in services/api (API_DB_URL, MEDIA_LINK_HMAC_KEY) and
//      workers/jobs (JOBS_MIRROR_DB_URL, JOBS_QUALITY_DB_URL, JOBS_INTEGRITY_DB_URL), each value on stdin only.
//      Never CANDIDATE_TOKEN_PRIVATE_JWK (candidate-token-key.mjs runbook) and never the edge Worker (no secret).
// No value is printed, logged, written to disk or put on a command line: not the operator URL, not a password,
// not the key. Errors name a variable, a secret or a SQLSTATE, never a value. Child output is not echoed.
// Exit codes: 0 done (or a clean dry run), 1 a step failed, 2 bad arguments or a refusal (nothing changed).
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOW_LIST, WORKER_DIRS } from '../check-staging-secrets.mjs';
import { isEntryPoint } from '../lib/cli.mjs';
import { LOGIN_ROLES, isLoginPassword } from '../lib/e2e-local-secrets.mjs';
import {
  DB_URL_ENV,
  childEnvOf,
  describeFailure,
  line,
  parseFlags,
  pgEnvOf,
  runSql,
} from './lib.mjs';

const TAG = 'staging-worker-secrets';
/** The public staging project ref (GitHub variable of the same name, docs/infra/environments.md). */
export const REF_ENV = 'SUPABASE_STAGING_PROJECT_REF';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPTIONS = {
  env: { type: 'string' },
  'dry-run': { type: 'boolean' },
  yes: { type: 'boolean' },
};

/**
 * What goes where. `login` names the database login whose URL is the value; null is the media-link HMAC key.
 * `workerName` is `env.staging.name` of the folder's wrangler.jsonc (a test pins it).
 */
export const PLAN = Object.freeze([
  Object.freeze({
    worker: 'api',
    dir: WORKER_DIRS.api,
    workerName: 'trace-api-staging',
    secrets: Object.freeze([
      Object.freeze({ name: 'API_DB_URL', login: 'api_login' }),
      Object.freeze({ name: 'MEDIA_LINK_HMAC_KEY', login: null }),
    ]),
  }),
  Object.freeze({
    worker: 'jobs',
    dir: WORKER_DIRS.jobs,
    workerName: 'trace-jobs-staging',
    secrets: Object.freeze([
      Object.freeze({ name: 'JOBS_MIRROR_DB_URL', login: 'jobs_mirror_login' }),
      Object.freeze({ name: 'JOBS_QUALITY_DB_URL', login: 'jobs_quality_login' }),
      Object.freeze({ name: 'JOBS_INTEGRITY_DB_URL', login: 'jobs_integrity_login' }),
    ]),
  }),
]);

// Fail at load if the plan ever leaves the allow-list, reaches edge, or misses a login.
for (const w of PLAN) {
  if (w.worker === 'edge') throw new Error(`${TAG}: the edge Worker holds no secret`);
  for (const s of w.secrets) {
    if (!ALLOW_LIST[w.worker]?.includes(s.name)) {
      throw new Error(`${TAG}: ${s.name} is not on the ${w.worker} allow-list`);
    }
  }
}
{
  const planned = PLAN.flatMap((w) => w.secrets.map((s) => s.login)).filter(Boolean);
  if (
    planned.sort().join() !==
    LOGIN_ROLES.map((r) => r.login)
      .sort()
      .join()
  ) {
    throw new Error(`${TAG}: the plan must give each login role exactly one secret`);
  }
}

// --- arguments ------------------------------------------------------------------------------------

/** `--env staging` plus at most one of `--dry-run` / `--yes`. Messages never echo a value. */
export function parseCli(argv) {
  let flags;
  try {
    flags = parseFlags(argv, OPTIONS);
  } catch {
    return {
      ok: false,
      why: 'unknown or malformed argument (use --env staging [--dry-run | --yes])',
    };
  }
  if (flags.env === undefined) return { ok: false, why: '--env staging is required' };
  if (flags.env !== 'staging') return { ok: false, why: 'only --env staging is allowed' };
  const dryRun = flags['dry-run'] === true;
  const yes = flags.yes === true;
  if (dryRun && yes) return { ok: false, why: 'use --dry-run or --yes, not both' };
  return { ok: true, dryRun, yes };
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
    return fail(`${REF_ENV} must be set to the 20-character staging project ref`);
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
    return fail(`${DB_URL_ENV} is not the staging project named by ${REF_ENV}`);
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

/**
 * A login's connection URL for the Workers. Pooler: user `<login>.<ref>` on the operator's pooler host (Supavisor
 * finds the project from the suffix); direct: `<login>` on db.<ref>.supabase.co. Always port 5432 (session mode,
 * ADR-031), database postgres and `sslmode=require`, which apiDbSsl and jobsDbSsl turn into TLS `require`.
 */
export function workerDbUrl(target, login, password) {
  if (!LOGIN_ROLES.some((r) => r.login === login)) throw new Error(`${TAG}: unknown login role`);
  if (!isLoginPassword(password)) {
    throw new Error(`${TAG}: the password for ${login} is not lower-case hex`);
  }
  const user = target.kind === 'pooler' ? `${login}.${target.ref}` : login;
  return `postgresql://${user}:${password}@${target.host}:5432/postgres?sslmode=require`;
}

/** NAME -> value for every secret in PLAN. */
export function secretValues(target, values) {
  const out = {};
  for (const w of PLAN) {
    for (const s of w.secrets) {
      out[s.name] = s.login
        ? workerDbUrl(target, s.login, values.passwords[s.login])
        : values.hmacKey;
    }
  }
  return out;
}

// --- wrangler -------------------------------------------------------------------------------------

/**
 * Runs `pnpm exec wrangler <args>` in a Worker folder with the value (if any) on stdin. pnpm is a .cmd shim on
 * Windows, which Node starts only through a shell; the command line is built from constants (secret names from the
 * frozen PLAN), never from a value. Output is captured and dropped by the caller.
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

function planLines(target) {
  const via = target.kind === 'pooler' ? 'the Supabase session pooler' : 'the direct database host';
  return [
    `${TAG}: plan for staging (database reached through ${via}, TLS)`,
    '  1. Database, one transaction as postgres (nothing is dropped or revoked):',
    ...LOGIN_ROLES.map(
      ({ login, role }) =>
        `       ${login} -> ${role} (inherit false, set true): create if missing, else set a new password`,
    ),
    '  2. Worker secrets (pnpm exec wrangler secret put <NAME> --env staging, value on stdin):',
    ...PLAN.map(
      (w) =>
        `       ${w.workerName} (${w.dir}): ${w.secrets
          .map((s) => (s.login ? `${s.name} (${s.login})` : s.name))
          .join(', ')}`,
    ),
    '  Not touched: CANDIDATE_TOKEN_PRIVATE_JWK (scripts/ops/candidate-token-key.mjs) and trace-edge-staging (no secret).',
    '  A re-run makes new passwords and replaces these secrets; between steps 1 and 2 the Workers hold the old',
    '  passwords for a few seconds.',
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
  const target = parseOperatorUrl(raw, (deps.env[REF_ENV] ?? '').trim());
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

  for (const text of planLines(target)) say(text);
  if (cli.dryRun) {
    say(
      `${TAG}: dry run: the arguments, ${DB_URL_ENV} and psql are fine; nothing was changed (the Workers are checked only with --yes)`,
    );
    return 0;
  }
  if (!cli.yes) {
    say(`${TAG}: nothing was changed; re-run with --yes to apply this plan`);
    return 2;
  }

  // 2. Both Workers must exist: `secret put` would otherwise create an empty draft Worker without asking.
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
  }

  // 3. New values and the database transaction.
  const values = generateValues(deps.randomBytes ?? randomBytes);
  let sql;
  let secrets;
  try {
    sql = stagingLoginRolesSql(values);
    secrets = secretValues(target, values);
  } catch {
    return fail(1, 'building the role SQL or the Worker URLs failed; nothing was changed');
  }
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
      const all = PLAN.flatMap((w) => w.secrets.map((s) => s.name));
      return fail(
        1,
        `the database call ended without a SQL error (connection lost, psql exit or timeout), so the outcome is unknown: the login passwords may have changed, and then all five secrets are stale: ${all.join(', ')}. Re-run with --yes (it sets new passwords and every secret again)`,
      );
    }
    return fail(1, `${describeFailure(db)}; the transaction rolled back, nothing was changed`);
  }
  say(`${TAG}: database: ${LOGIN_ROLES.length} login roles have new passwords and their one grant`);

  // 4. The secrets, in PLAN order. A failure leaves the rest stale until a re-run.
  const order = PLAN.flatMap((w) => w.secrets.map((s) => ({ w, s })));
  for (const [i, { w, s }] of order.entries()) {
    const r = wrangler(deps, w.dir, ['secret', 'put', s.name, '--env', 'staging'], secrets[s.name]);
    if (failed(r)) {
      const stale = order.slice(i).map((x) => x.s.name);
      return fail(
        1,
        `setting ${s.name} on ${w.workerName} failed. The database passwords already changed, so these secrets are stale: ${stale.join(', ')}. Fix the cause (wrangler whoami; a Worker whose latest version is not deployed) and re-run with --yes`,
      );
    }
    say(`${TAG}: set ${s.name} on ${w.workerName}`);
  }
  say(
    `${TAG}: done. The staging deploy's check-staging-secrets step lists these names; the values are only in Cloudflare.`,
  );
  return 0;
}

/** The real world, plus the values this script needs beyond lib.mjs realDeps. */
function realScriptDeps() {
  return {
    env: process.env,
    spawnSync,
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
