// Shared helpers of the M0b operator scripts (specs/m0b-tenancy.md §2.6, §4.4).
// Every process and network call goes through `deps`, so the tests use fakes and never touch a
// real database or network. Nothing here prints a URL, a password, a key or a token: failures are
// fixed messages plus (for the database) the SQLSTATE.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

/** The one place the real world is wired in; tests pass their own `deps`. */
export function realDeps() {
  return {
    env: process.env,
    spawnSync,
    fetch: globalThis.fetch,
    randomUUID,
    platform: process.platform,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}

/** The local stack's Postgres container: `supabase_db_<project_id>`, project_id = "trace". */
export const LOCAL_DB_CONTAINER = 'supabase_db_trace';
export const DB_URL_ENV = 'TRACE_OPERATOR_DB_URL';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (text) => UUID_RE.test(text);

/** Parses `--flag value` / `--flag=value`. Throws a value-free Error on an unknown or malformed flag. */
export function parseFlags(argv, options) {
  try {
    return parseArgs({ args: argv, options, strict: true, allowPositionals: false }).values;
  } catch {
    throw new Error('unknown or malformed argument');
  }
}

/** Runs a zod schema; on failure returns the field names only, never a value. */
export function validate(schema, input) {
  const res = schema.safeParse(input);
  if (res.success) return { ok: true, data: res.data };
  const fields = new Set();
  for (const issue of res.error.issues) {
    const field = issue.path.map(String).join('.');
    fields.add(field || issue.message);
  }
  return { ok: false, fields: [...fields] };
}

/** Writes `text` plus a newline to a stream-like `{ write }`. */
export const line = (stream, text) => stream.write(`${text}\n`);

/** `KEY="value"` lines as printed by `supabase status -o env`. */
export function parseEnvOutput(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(raw.trim());
    if (!m) continue;
    let value = m[2];
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

const STATUS_ARGS = ['exec', 'supabase', 'status', '-o', 'env'];

/**
 * The local stack's variables (`DB_URL`, `API_URL`, `SERVICE_ROLE_KEY`, ...), or null when the
 * stack is not running. The values are never printed by this module.
 * pnpm is a .cmd shim on Windows, which Node starts only through a shell; the command line is a
 * constant, no user input reaches it.
 */
export function localStackEnv(deps) {
  const win = deps.platform === 'win32';
  const res = win
    ? deps.spawnSync(['pnpm', ...STATUS_ARGS].join(' '), [], {
        encoding: 'utf8',
        shell: true,
        env: deps.env,
      })
    : deps.spawnSync('pnpm', STATUS_ARGS, { encoding: 'utf8', shell: false, env: deps.env });
  if (res.error || res.status !== 0) return null;
  const parsed = parseEnvOutput(res.stdout ?? '');
  return Object.keys(parsed).length > 0 ? parsed : null;
}

/** The operator DB URL: env `TRACE_OPERATOR_DB_URL`, else the local stack's `DB_URL`. Null if neither. */
export function resolveDbUrl(deps) {
  const fromEnv = (deps.env[DB_URL_ENV] ?? '').trim();
  if (fromEnv) return fromEnv;
  return localStackEnv(deps)?.DB_URL ?? null;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const PSQL_FLAGS = ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'];

/**
 * Runs one SQL statement through psql. The SQL text goes on stdin (`-f -`, the only way psql
 * interpolates `-v` variables); argument values travel only as `-v name=value`, never inside the
 * SQL. The URL goes to psql through the environment (PGDATABASE), never through argv. Without a
 * psql binary and with a local URL, the statement runs in the local stack's Postgres container
 * (`docker exec -i`, no URL at all).
 * @returns {{ ok: true, out: string } | { ok: false, why: string, sqlstate: string | null }}
 */
export function runSql({ url, sql, vars }, deps) {
  const varArgs = Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]);
  const childEnv = { ...deps.env };
  // the child needs none of these (the URL travels as PGDATABASE, only for a real psql)
  for (const name of [DB_URL_ENV, 'SMOKE_PASSWORD', 'SUPABASE_STAGING_PUBLISHABLE_KEY']) {
    delete childEnv[name];
  }
  const opts = {
    input: sql,
    encoding: 'utf8',
    shell: false,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  };
  const probe = deps.spawnSync('psql', ['--version'], { encoding: 'utf8', shell: false });
  const hasPsql = !probe.error && probe.status === 0;
  let res;
  if (hasPsql) {
    res = deps.spawnSync('psql', [...PSQL_FLAGS, ...varArgs, '-f', '-'], {
      ...opts,
      env: { ...childEnv, PGDATABASE: url, PGCONNECT_TIMEOUT: '15' },
    });
  } else {
    const host = hostOf(url);
    if (host === null || !LOCAL_HOSTS.has(host)) {
      return {
        ok: false,
        why: 'psql is not installed and the database is not local',
        sqlstate: null,
      };
    }
    res = deps.spawnSync(
      'docker',
      [
        'exec',
        '-i',
        LOCAL_DB_CONTAINER,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        ...PSQL_FLAGS,
        ...varArgs,
        '-f',
        '-',
      ],
      { ...opts, env: childEnv },
    );
  }
  if (res.error || res.status !== 0) {
    // stderr can hold the connection string; only the SQLSTATE leaves this function.
    const m = /ERROR:\s+([0-9A-Z]{5})\b/.exec(String(res.stderr ?? ''));
    return { ok: false, why: 'the database call failed', sqlstate: m ? m[1] : null };
  }
  return { ok: true, out: String(res.stdout ?? '').trim() };
}

/** `(SQLSTATE 23505)` or a hint, for a failed `runSql`. */
export const describeFailure = (r) =>
  r.sqlstate ? `${r.why} (SQLSTATE ${r.sqlstate})` : `${r.why} (no SQLSTATE; check the connection)`;

const CREATE_ORG_SQL = `select private.create_org(:'p_name', :'p_slug', :'p_kind'::public.org_kind, :'p_owner'::uuid, :'p_display', :'p_rid'::uuid);\n`;
const ADD_MEMBER_SQL = `select private.add_member(:'p_org'::uuid, :'p_user'::uuid, :'p_roles'::public.org_role[], :'p_display', :'p_rid'::uuid);\n`;
const LOOKUP_USER_SQL = `select id from auth.users where email = :'p_email';\n`;

/** Wraps a runSql result: the single UUID on stdout, or a failure. */
function oneUuid(r) {
  if (!r.ok) return r;
  if (!isUuid(r.out)) {
    return { ok: false, why: 'the database returned an unexpected result', sqlstate: null };
  }
  return { ok: true, id: r.out.toLowerCase() };
}

/** `private.create_org`; args are validated `CreateOrgArgs`. Returns `{ ok, id }` or the failure. */
export function createOrg(args, url, deps) {
  return oneUuid(
    runSql(
      {
        url,
        sql: CREATE_ORG_SQL,
        vars: {
          p_name: args.name,
          p_slug: args.slug,
          p_kind: args.kind,
          p_owner: args.ownerUserId,
          p_display: args.displayName,
          p_rid: args.requestId,
        },
      },
      deps,
    ),
  );
}

/** `private.add_member`; args are validated `AddMemberArgs`. Returns `{ ok, id }` or the failure. */
export function addMember(args, url, deps) {
  return oneUuid(
    runSql(
      {
        url,
        sql: ADD_MEMBER_SQL,
        vars: {
          p_org: args.orgId,
          p_user: args.userId,
          p_roles: `{${args.roles.join(',')}}`,
          p_display: args.displayName,
          p_rid: args.requestId,
        },
      },
      deps,
    ),
  );
}

/** The `auth.users` id for an email, or a failure. */
export function lookupUserId(email, url, deps) {
  return oneUuid(
    runSql({ url, sql: LOOKUP_USER_SQL, vars: { p_email: email.toLowerCase() } }, deps),
  );
}
