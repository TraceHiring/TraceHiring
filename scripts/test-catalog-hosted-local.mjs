#!/usr/bin/env node
// MT-9 on hosted Supabase (specs/d1-demo-slice.md revision 4m; security review of f5cd5da, finding 5): the hosted
// allow-list (hosted_extension, hosted_member) and the idempotency-index entry run for real on the shared local stack.
// No local stack has the three hosted extensions owned by postgres, so each scenario first makes the local stack
// look hosted, as the local superuser inside `begin; … rollback;`: pg_extension.extowner of pg_stat_statements,
// uuid-ossp and pgcrypto becomes postgres and every member function and view is re-owned to postgres (the worst
// case: the hosted members' owners are not observable from this account). Then `set local role postgres` (how
// migrations and the staging catalog run connect) does what a migration could, and the real MT-9 and MT-7 texts run
// as postgres. Meant to run from scripts/test-rls.mjs after pgTAP (step 5e). One psql session per scenario
// (`docker exec -i`, SQL on stdin, ON_ERROR_STOP=1), all rolled back; a killed session rolls back too. Output: one
// line per scenario; never SQL text or server output.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/cli.mjs';
import { LOCAL_DB_CONTAINER } from './ops/lib.mjs';

const TAG = 'test-catalog-hosted-local';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PSQL = Object.freeze([
  'exec',
  '-i',
  LOCAL_DB_CONTAINER,
  'psql',
  '-U',
  'supabase_admin',
  '-d',
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

export const HOSTED = Object.freeze(['pg_stat_statements', 'uuid-ossp', 'pgcrypto']);
const HOSTED_LIST = HOSTED.map((e) => `'${e}'`).join(', ');

/** A check file's single SELECT, without its optional trailing `;` (catalog-checks README rule 1). */
export function checkText(text) {
  const t = String(text).replace(/\r\n/g, '\n').trimEnd().replace(/;$/, '');
  if (t.includes(';')) throw new Error(`${TAG}: a check file holds more than one statement`);
  return t;
}

const readCheck = (id) =>
  checkText(readFileSync(path.join(ROOT, 'supabase', 'catalog-checks', `${id}.sql`), 'utf8'));

/** Make the local stack look hosted (as the local superuser; rolled back with the scenario). */
export const SIMULATE_HOSTED = [
  `update pg_catalog.pg_extension set extowner = 'postgres'::regrole where extname in (${HOSTED_LIST});`,
  'do $simulate$',
  'declare',
  '  m record;',
  'begin',
  '  for m in',
  '    select d.classid, d.objid',
  '    from pg_catalog.pg_depend as d',
  '    join pg_catalog.pg_extension as e on e.oid = d.refobjid',
  "    where d.refclassid = 'pg_catalog.pg_extension'::regclass",
  "      and d.deptype = 'e'",
  `      and e.extname in (${HOSTED_LIST})`,
  "      and d.classid in ('pg_catalog.pg_proc'::regclass, 'pg_catalog.pg_class'::regclass)",
  '  loop',
  "    if m.classid = 'pg_catalog.pg_proc'::regclass then",
  "      execute format('alter function %s owner to postgres', m.objid::regprocedure);",
  '    else',
  "      execute format('alter table %s owner to postgres', m.objid::regclass);",
  '    end if;',
  '  end loop;',
  'end',
  '$simulate$;',
].join('\n');

/** True when the simulation took: the three extensions and every one of their (at least 55) members are postgres's. */
const SIMULATED = [
  `(select count(*) from pg_catalog.pg_extension where extname in (${HOSTED_LIST})`,
  "  and extowner = 'postgres'::regrole) = 3",
  'and (select count(*) from pg_catalog.pg_depend as d',
  '  join pg_catalog.pg_extension as e on e.oid = d.refobjid',
  "  left join pg_catalog.pg_proc as p on d.classid = 'pg_catalog.pg_proc'::regclass and p.oid = d.objid",
  "  left join pg_catalog.pg_class as c on d.classid = 'pg_catalog.pg_class'::regclass and c.oid = d.objid",
  "  left join pg_catalog.pg_type as t on d.classid = 'pg_catalog.pg_type'::regclass and t.oid = d.objid",
  `  where d.refclassid = 'pg_catalog.pg_extension'::regclass and d.deptype = 'e' and e.extname in (${HOSTED_LIST})`,
  "  and coalesce(p.proowner, c.relowner, t.typowner) = 'postgres'::regrole) >= 55",
  'and not exists (select 1 from pg_catalog.pg_depend as d',
  '  join pg_catalog.pg_extension as e on e.oid = d.refobjid',
  "  left join pg_catalog.pg_proc as p on d.classid = 'pg_catalog.pg_proc'::regclass and p.oid = d.objid",
  "  left join pg_catalog.pg_class as c on d.classid = 'pg_catalog.pg_class'::regclass and c.oid = d.objid",
  "  left join pg_catalog.pg_type as t on d.classid = 'pg_catalog.pg_type'::regclass and t.oid = d.objid",
  `  where d.refclassid = 'pg_catalog.pg_extension'::regclass and d.deptype = 'e' and e.extname in (${HOSTED_LIST})`,
  "  and coalesce(p.proowner, c.relowner, t.typowner) is distinct from 'postgres'::regrole)",
].join('\n');

/**
 * The scenarios. `act` runs as postgres after the simulation; each `expect` entry is a boolean SQL expression over
 * `{MT9}` / `{MT7}` (replaced by the check texts) that must be true.
 */
export const SCENARIOS = Object.freeze([
  {
    id: 'hosted_clean',
    act: [],
    expect: [
      ['simulated', SIMULATED],
      ['mt9_clean', 'not exists (select 1 from ({MT9}) as v)'],
      ['mt7_clean', 'not exists (select 1 from ({MT7}) as v)'],
    ],
  },
  {
    id: 'added_function',
    act: [
      "create function extensions.mt_9_hidden() returns integer language sql as 'select 1';",
      'alter extension pgcrypto add function extensions.mt_9_hidden();',
    ],
    expect: [
      ['flagged', fires('extension_added_member', 'extensions.mt_9_hidden()')],
      [
        'owner_skip_holds',
        "not exists (select 1 from ({MT9}) as v where v.branch = 'extension_owner')",
      ],
    ],
  },
  {
    id: 'replaced_function',
    act: [
      'create or replace function extensions.gen_random_bytes(integer) returns bytea language sql',
      "  as 'select ''\\x00''::bytea';",
    ],
    expect: [['flagged', fires('extension_added_member', 'extensions.gen_random_bytes(integer)')]],
  },
  {
    id: 'definer_function',
    act: ['alter function extensions.digest(text, text) security definer;'],
    expect: [['flagged', fires('extension_added_member', 'extensions.digest(text, text)')]],
  },
  {
    id: 'set_function',
    act: ["alter function extensions.hmac(text, text, text) set work_mem = '64kB';"],
    expect: [['flagged', fires('extension_added_member', 'extensions.hmac(text, text, text)')]],
  },
  {
    id: 'replaced_view',
    act: [
      'create or replace view extensions.pg_stat_statements_info as',
      '  select dealloc, stats_reset from extensions.pg_stat_statements_info()',
      '  where exists (select 1 from supabase_migrations.schema_migrations);',
    ],
    expect: [['flagged', fires('extension_added_member', 'extensions.pg_stat_statements_info')]],
  },
  {
    id: 'moved_extension',
    act: ['alter extension pgcrypto set schema public;'],
    expect: [
      ['owner', fires('extension_owner', 'pgcrypto')],
      ['in_scope', fires('extension_in_scope', 'pgcrypto')],
    ],
  },
  {
    id: 'other_member',
    act: [
      'create text search configuration extensions.mt_9_config (copy = pg_catalog.simple);',
      'alter extension pgcrypto add text search configuration extensions.mt_9_config;',
    ],
    expect: [
      [
        'flagged',
        "exists (select 1 from ({MT9}) as v where v.branch = 'extension_other_member' and v.object like '%mt_9_config')",
      ],
    ],
  },
  {
    id: 'index_name_table',
    act: ['create table supabase_migrations.schema_migrations_idempotency_key_key (k integer);'],
    expect: [
      [
        'flagged',
        fires(
          'handmade_in_system_schema',
          'supabase_migrations.schema_migrations_idempotency_key_key',
        ),
      ],
    ],
  },
]);

function fires(branch, object) {
  return `exists (select 1 from ({MT9}) as v where v.branch = '${branch}' and v.object = '${object}')`;
}

/** The names a scenario prints, in order. */
export const checkNames = (s) => s.expect.map(([n]) => `${s.id}:${n}`);

/** One scenario: simulate, act as postgres, check, always roll back. */
export function scenarioSql(s, checks) {
  const fill = (e) => e.replaceAll('{MT9}', checks.mt9).replaceAll('{MT7}', checks.mt7);
  return [
    'begin;',
    SIMULATE_HOSTED,
    'set local role postgres;',
    ...s.act,
    ...s.expect.map(([n, e]) => `select '${s.id}:${n}', coalesce((${fill(e)}), false);`),
    'rollback;',
    '',
  ].join('\n');
}

/** `name|t` lines → ok, or the first failed check; the names must be exactly `expected`. */
export function parseChecks(stdout, expected) {
  const names = [];
  for (const l of String(stdout)
    .split(/\r?\n/)
    .filter((x) => x.trim() !== '')) {
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

/** Runs every scenario; returns the exit code. `deps.spawnSync` and `deps.readCheck` are injectable. */
export function main({ deps = { spawnSync, readCheck, stdout: process.stdout } } = {}) {
  const say = (t) => deps.stdout.write(`${TAG}: ${t}\n`);
  const checks = { mt9: deps.readCheck('MT-9'), mt7: deps.readCheck('MT-7') };
  let failures = 0;
  for (const s of SCENARIOS) {
    const r = deps.spawnSync('docker', [...PSQL], {
      input: scenarioSql(s, checks),
      encoding: 'utf8',
      shell: false,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    if (r.error || r.status !== 0) {
      failures += 1;
      say(
        `${s.id} FAILED (psql ${r.error ? 'did not run' : `exit ${r.status}`}, SQLSTATE ${sqlstateOf(r.stderr) ?? 'none'})`,
      );
      continue;
    }
    const p = parseChecks(r.stdout, checkNames(s));
    if (p.ok) say(`${s.id} OK (${s.expect.length} checks, rolled back)`);
    else {
      failures += 1;
      say(`${s.id} FAILED (${p.failed})`);
    }
  }
  return failures === 0 ? 0 : 1;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = main();
}
