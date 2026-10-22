#!/usr/bin/env node
// Spec review SR-E-5 (specs/d1-demo-slice.md §3 login roles, MT-14, L-29): the role SQL that
// scripts/ops/staging-worker-secrets.mjs runs on staging, run for real on the shared local stack before the founder's
// staging run. Meant to run from scripts/test-rls.mjs after pgTAP, like test-concurrency-local.mjs (the lead wires it).
// Every scenario is one psql session in the local stack's Postgres container (`docker exec -i`, as postgres, SQL on
// stdin, ON_ERROR_STOP=1) inside `begin; … rollback;`: CREATE ROLE, ALTER ROLE and GRANT are transactional, so
// nothing survives a run, and a killed session rolls back too. The `begin;`/`commit;` of the generated text are
// replaced by the outer transaction; everything between them is the script's real output, with passwords and SCRAM
// salts generated at run time here.
//   apply: two runs in one transaction (create path, then the alter path with new passwords); after each, every
//          login can log in, is NOINHERIT and holds exactly one membership (its trace_* role, inherit false,
//          set true, no admin), and pg_authid.rolpassword is exactly the verifier the script computed.
//   TR001: with one trace_* role renamed away, the run stops with SQLSTATE TR001.
//   TR002: with a login already holding a second trace_* role, the run stops with SQLSTATE TR002.
// Not covered here (hosted only): Supavisor accepting `<login>.<ref>` users, TLS, and the hosted postgres role's
// rights; the staging run itself checks those. Output: one line per scenario; never SQL text, server output or a
// value.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { isEntryPoint } from './lib/cli.mjs';
import { LOGIN_ROLES } from './lib/e2e-local-secrets.mjs';
import { LOCAL_DB_CONTAINER } from './ops/lib.mjs';
import {
  LOGIN_TIMEOUTS,
  generateValues,
  stagingLoginRolesSql,
} from './ops/staging-worker-secrets.mjs';

const TAG = 'test-staging-roles-local';
const PSQL = Object.freeze([
  'exec',
  '-i',
  LOCAL_DB_CONTAINER,
  'psql',
  '-U',
  'postgres',
  '-X',
  '-q',
  '-At',
  '-v',
  'ON_ERROR_STOP=1',
  '-v',
  'VERBOSITY=sqlstate',
  '-f',
  '-',
]);
const VERIFIER_RE = /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

/**
 * The generated text without its own transaction control: it must start with `begin;` and end with `commit;`, each
 * exactly once, so the outer `begin; … rollback;` holds everything.
 */
export function innerSql(full) {
  const lines = String(full).replace(/\n+$/, '').split('\n');
  if (lines[0] !== 'begin;' || lines.at(-1) !== 'commit;') {
    throw new Error(`${TAG}: the role SQL is not one begin … commit transaction`);
  }
  const inner = lines.slice(1, -1);
  if (inner.some((l) => /^\s*(begin|commit|rollback|end)\s*;/i.test(l))) {
    throw new Error(`${TAG}: the role SQL has extra transaction control`);
  }
  return inner.join('\n');
}

/** The verifiers the generated text carries, by login (create and alter branches hold the same one). */
export function verifiersOf(full) {
  const out = {};
  for (const { login } of LOGIN_ROLES) {
    const m = new RegExp(`create role ${login} with login noinherit password '([^']+)'`).exec(full);
    if (!m || !VERIFIER_RE.test(m[1])) throw new Error(`${TAG}: no verifier for ${login}`);
    out[login] = m[1];
  }
  return out;
}

/** One `<check>|t|f` line per login and property, after a run whose verifiers are `verifiers`. */
export function checksSql(label, verifiers) {
  const out = [];
  for (const { login, role } of LOGIN_ROLES) {
    const v = verifiers[login];
    if (!VERIFIER_RE.test(String(v))) throw new Error(`${TAG}: bad verifier for ${login}`);
    out.push(
      `select '${label}:attrs:${login}', coalesce((select rolcanlogin and not rolinherit and not rolsuper` +
        ` and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls` +
        ` from pg_catalog.pg_roles where rolname = '${login}'), false);`,
      `select '${label}:grant:${login}', coalesce((select count(*) = 1 and bool_and(r.rolname = '${role}'` +
        ` and not m.inherit_option and m.set_option and not m.admin_option)` +
        ` from pg_catalog.pg_auth_members m join pg_catalog.pg_roles l on l.oid = m.member` +
        ` join pg_catalog.pg_roles r on r.oid = m.roleid where l.rolname = '${login}'), false);`,
      `select '${label}:scram:${login}', coalesce((select rolpassword = '${v}'` +
        ` from pg_catalog.pg_authid where rolname = '${login}'), false);`,
      `select '${label}:settings:${login}', coalesce((select s.setconfig @> array[${settings}]::text[]` +
        ` from pg_catalog.pg_db_role_setting s join pg_catalog.pg_roles l on l.oid = s.setrole` +
        ` where l.rolname = '${login}' and s.setdatabase = 0), false);`,
    );
  }
  return out.join('\n');
}

/** `'name=value', …` for the login timeouts, as pg_db_role_setting stores them. */
const settings = Object.entries(LOGIN_TIMEOUTS)
  .map(([k, v]) => `'${k}=${v}'`)
  .join(', ');

/** The names `checksSql(label, …)` prints, in order. */
export const checkNames = (label) =>
  LOGIN_ROLES.flatMap(({ login }) =>
    ['attrs', 'grant', 'scram', 'settings'].map((k) => `${label}:${k}:${login}`),
  );

/** Scenario `apply`: two real runs (create, then alter) in one rolled-back transaction. */
export function applyScenarioSql(first, second) {
  return [
    'begin;',
    innerSql(first),
    checksSql('create', verifiersOf(first)),
    innerSql(second),
    checksSql('alter', verifiersOf(second)),
    'rollback;',
    '',
  ].join('\n');
}

/** Scenario TR001: a trace_* role is missing (renamed inside the transaction). */
export function missingRoleScenarioSql(full, suffix) {
  if (!/^[0-9a-f]{8}$/.test(suffix)) throw new Error(`${TAG}: bad suffix`);
  return [
    'begin;',
    `alter role trace_integrity_worker rename to trace_integrity_gone_${suffix};`,
    innerSql(full),
    'rollback;',
    '',
  ].join('\n');
}

/** Scenario TR002: jobs_quality_login already holds trace_worker as well. */
export function extraMembershipScenarioSql(full) {
  return [
    'begin;',
    'do $setup$',
    'begin',
    "  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'jobs_quality_login') then",
    '    create role jobs_quality_login with login noinherit;',
    '  end if;',
    'end',
    '$setup$;',
    'grant trace_worker to jobs_quality_login with inherit false, set true;',
    innerSql(full),
    'rollback;',
    '',
  ].join('\n');
}

/** `name|t` lines → the names, or null when any line is not `|t` or the names differ from `expected`. */
export function parseChecks(stdout, expected) {
  const lines = String(stdout)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  const names = [];
  for (const l of lines) {
    const m = /^([a-z0-9_:]+)\|(t|f)$/.exec(l.trim());
    if (!m || m[2] !== 't') return { ok: false, failed: m ? m[1] : 'unreadable line' };
    names.push(m[1]);
  }
  if (names.join() !== expected.join()) return { ok: false, failed: 'unexpected set of checks' };
  return { ok: true };
}

/** The SQLSTATE of a failed psql run (VERBOSITY=sqlstate), or null. */
export const sqlstateOf = (stderr) =>
  /ERROR:\s+([0-9A-Z]{5})\b/.exec(String(stderr ?? ''))?.[1] ?? null;

const fresh = (rand) => stagingLoginRolesSql(generateValues(rand));

/** Runs the three scenarios; returns the exit code. `deps.spawnSync` and `deps.randomBytes` are injectable. */
export function main({ deps = { spawnSync, randomBytes, stdout: process.stdout } } = {}) {
  const say = (t) => deps.stdout.write(`${TAG}: ${t}\n`);
  const psql = (sql) =>
    deps.spawnSync('docker', [...PSQL], {
      input: sql,
      encoding: 'utf8',
      shell: false,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
  let failures = 0;

  const apply = psql(applyScenarioSql(fresh(deps.randomBytes), fresh(deps.randomBytes)));
  if (apply.error || apply.status !== 0) {
    failures += 1;
    say(
      `apply FAILED (psql ${apply.error ? 'did not run' : `exit ${apply.status}`}, SQLSTATE ${sqlstateOf(apply.stderr) ?? 'none'})`,
    );
  } else {
    const r = parseChecks(apply.stdout, [...checkNames('create'), ...checkNames('alter')]);
    if (r.ok) say('apply OK (create path and alter path, 32 checks, rolled back)');
    else {
      failures += 1;
      say(`apply FAILED (${r.failed})`);
    }
  }

  const suffix = deps.randomBytes(4).toString('hex');
  for (const [name, sql, want] of [
    ['TR001 guard', missingRoleScenarioSql(fresh(deps.randomBytes), suffix), 'TR001'],
    ['TR002 guard', extraMembershipScenarioSql(fresh(deps.randomBytes)), 'TR002'],
  ]) {
    const r = psql(sql);
    const got = r.error ? null : sqlstateOf(r.stderr);
    if (!r.error && r.status !== 0 && got === want)
      say(`${name} OK (SQLSTATE ${want}, rolled back)`);
    else {
      failures += 1;
      say(
        `${name} FAILED (expected SQLSTATE ${want}, got ${r.error ? 'no run' : (got ?? `exit ${r.status}`)})`,
      );
    }
  }
  return failures === 0 ? 0 : 1;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = main();
}
