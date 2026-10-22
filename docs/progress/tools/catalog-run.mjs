// Dev helper for writing catalog checks (not part of the repo). Runs each check against the shared local
// Supabase stack (container supabase_db_trace) exactly the way the generated pgTAP file will, but in separate
// rolled-back transactions, and prints a result table.
//   node catalog-run.mjs <repoRoot> [MT-1 MT-2 ...]
// For each check: CLEAN (read-only transaction) must return 0 rows; for each branch, after its fixture,
// the check must return >= 1 row with branch = '<branch>'. "others" lists any other branch that also fired.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const [root, ...only] = process.argv.slice(2);
if (!root) {
  console.error('usage: node catalog-run.mjs <repoRoot> [MT-id ...]');
  process.exit(2);
}
const dir = join(root, 'supabase', 'catalog-checks');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

function psql(sql) {
  const r = spawnSync(
    'docker',
    ['exec', '-i', 'supabase_db_trace', 'psql', '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', '|'],
    { input: sql, encoding: 'utf8' },
  );
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function loadCheck(id) {
  const file = join(dir, `${id}.sql`);
  if (!existsSync(file)) return { error: 'missing check file' };
  let sql = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd();
  if (sql.endsWith(';')) sql = sql.slice(0, -1).trimEnd();
  if (sql.includes(';')) return { error: 'check contains a ";" other than a trailing one' };
  if (sql.includes('$q$')) return { error: 'check contains $q$' };
  return { sql };
}

let failures = 0;
for (const check of manifest.checks) {
  if (only.length && !only.includes(check.id)) continue;
  const c = loadCheck(check.id);
  if (c.error) {
    console.log(`FAIL ${check.id}: ${c.error}`);
    failures++;
    continue;
  }
  const clean = psql(
    `begin;\nset transaction read only;\nselect count(*) from (\n${c.sql}\n) as v;\nselect v.branch, v.object, v.detail from (\n${c.sql}\n) as v limit 5;\nrollback;\n`,
  );
  const cleanCount = clean.out.split('\n')[0];
  if (clean.status !== 0 || cleanCount !== '0') {
    console.log(`FAIL ${check.id} clean: status=${clean.status} rows=${cleanCount}\n${clean.out}\n${clean.err}`);
    failures++;
  } else console.log(`ok   ${check.id} clean`);

  for (const b of check.branches) {
    const branch = typeof b === 'string' ? b : b.id;
    if (typeof b !== 'string' && b.unreachable) {
      console.log(`skip ${check.id}.${branch} (unreachable)`);
      continue;
    }
    const fx = join(dir, 'fixtures', `${check.id}.${branch}.violation.sql`);
    if (!existsSync(fx)) {
      console.log(`FAIL ${check.id}.${branch}: missing fixture`);
      failures++;
      continue;
    }
    const fixture = readFileSync(fx, 'utf8').replace(/\r\n/g, '\n');
    const r = psql(
      `begin;\nsavepoint mt;\n${fixture}\nreset role;\n` +
        `select count(*) filter (where v.branch = '${branch}'), coalesce(string_agg(distinct v.branch, ',') filter (where v.branch <> '${branch}'), '') from (\n${c.sql}\n) as v;\n` +
        `rollback to savepoint mt;\nrollback;\n`,
    );
    const [hits, others] = (r.out.split('\n').pop() || '').split('|');
    if (r.status !== 0 || !(Number(hits) > 0)) {
      console.log(`FAIL ${check.id}.${branch}: status=${r.status} hits=${hits}\n${r.err}`);
      failures++;
    } else console.log(`ok   ${check.id}.${branch} fires (${hits} rows)${others ? `  others also fired: ${others}` : ''}`);
  }
}
console.log(failures ? `\n${failures} failure(s)` : '\nall green');
process.exit(failures ? 1 : 0);
