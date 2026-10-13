#!/usr/bin/env node
// M0b review M0B-DB-5 (specs/m0b-tenancy.md §3.5, §10 C1): two connections demote the two owners of one
// org at the same time. The lock-first guard makes the second wait on the first's orgs row lock; when the
// first commits, the second must be refused, so the org keeps exactly one owner. Run once under READ
// COMMITTED (what PostgREST and psql use). Under REPEATABLE READ the second transaction's snapshot
// predates the first commit, so the deferred last-owner check alone would not see it and both committed;
// memberships_isolation_guard now refuses any owner change outside READ COMMITTED, and the REPEATABLE READ
// scenario checks that a single demotion is refused up front and both owners stay.
// Run by scripts/test-rls.mjs after pgTAP on the freshly reset local stack, as the operator (postgres)
// inside the local stack's Postgres container. Each scenario creates its own org with two fixed-shape
// synthetic users (random ids), so a re-run never collides. Output: one line per scenario, OK or the
// failed step; never SQL text, server output, a URL or an id.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { isEntryPoint } from './lib/cli.mjs';
import { LOCAL_DB_CONTAINER, isUuid } from './ops/lib.mjs';

const TAG = 'test-concurrency-local';
const WAIT_MS = 10_000;
const POLL_MS = 100;
export const LEVELS = Object.freeze(['read committed', 'repeatable read']);
const PSQL = ['exec', '-i', LOCAL_DB_CONTAINER, 'psql', '-U', 'postgres', '-X', '-q', '-At'];

const uuid = (v) => {
  if (!isUuid(v)) throw new Error('not a uuid');
  return `'${v}'`;
};
const level = (v) => {
  if (!LEVELS.includes(v)) throw new Error('unknown isolation level');
  return v;
};

/** Setup: two synthetic users and an org they both own (operator path). Values are validated ids. */
export function setupSql({ ownerA, ownerB, suffix }) {
  if (!/^[0-9a-f]{8}$/.test(suffix)) throw new Error('bad suffix');
  return [
    'insert into auth.users (id, aud, role, email) values',
    `  (${uuid(ownerA)}, 'authenticated', 'authenticated', 'p-conc-a-${suffix}@example.test'),`,
    `  (${uuid(ownerB)}, 'authenticated', 'authenticated', 'p-conc-b-${suffix}@example.test');`,
    `select private.create_org('Org Conc', 'org-conc-${suffix}', 'customer', ${uuid(ownerA)},`,
    `  'Persona Conc A', ${uuid(randomUUID())}) as org_id \\gset`,
    `select private.add_member(:'org_id', ${uuid(ownerB)}, '{org_owner,admin}', 'Persona Conc B',`,
    `  ${uuid(randomUUID())}) is not null;`,
    "select 'ORG ' || :'org_id';",
  ].join('\n');
}

/** One demotion: the owner keeps admin only. The second statement is the progress marker. */
export function demoteSql({ isolation, orgId, userId, marker }) {
  return [
    `begin isolation level ${level(isolation)};`,
    `update public.memberships set roles = '{admin}' where org_id = ${uuid(orgId)} and user_id = ${uuid(userId)};`,
    `\\echo ${marker}`,
  ].join('\n');
}

export const waitingSql = (userId) =>
  `select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%${isUuid(userId) ? userId : 'x'}%';`;

export const ownersSql = (orgId) =>
  `select count(*) from public.memberships where org_id = ${uuid(orgId)} and status = 'active' and 'org_owner' = any (roles);`;

/**
 * The verdict outside READ COMMITTED: the guard refuses the first owner change up front
 * (memberships_isolation_guard), so both owners stay.
 */
export function upFrontVerdict({ refused, owners }) {
  if (!refused) return 'an owner change outside READ COMMITTED was not refused';
  if (owners !== 2) return `the org has ${owners} active owners, not 2`;
  return null;
}

/**
 * The verdict under READ COMMITTED: the first transaction committed, the second was refused with an
 * error, and exactly one owner is left.
 */
export function verdict({ firstErrored, secondErrored, owners }) {
  if (firstErrored) return 'the first demotion failed';
  if (!secondErrored) return 'the second demotion was not refused';
  if (owners !== 1) return `the org has ${owners} active owners, not 1`;
  return null;
}

function runOnce(sql) {
  const r = spawnSync('docker', [...PSQL, '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
  });
  return { status: r.status, out: (r.stdout || '').trim() };
}

/** An interactive psql session in the container; output is collected, never printed. */
function openSession() {
  const child = spawn('docker', [...PSQL, '-v', 'ON_ERROR_STOP=0'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const s = { out: '', err: '', child };
  child.stdout.on('data', (d) => (s.out += d));
  child.stderr.on('data', (d) => (s.err += d));
  s.send = (sql) => child.stdin.write(`${sql}\n`);
  s.close = () =>
    new Promise((resolve) => {
      child.on('close', resolve);
      child.stdin.end();
    });
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check) {
  for (let t = 0; t < WAIT_MS; t += POLL_MS) {
    if (check()) return true;
    await sleep(POLL_MS);
  }
  return false;
}

async function scenario(isolation) {
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const setup = runOnce(setupSql({ ownerA, ownerB, suffix: randomBytes(4).toString('hex') }));
  const orgId = (setup.out.match(/^ORG (\S+)$/m) || [])[1];
  if (setup.status !== 0 || !isUuid(orgId ?? '')) return 'setup failed';

  if (isolation !== 'read committed') {
    const solo = openSession();
    try {
      solo.send(demoteSql({ isolation, orgId, userId: ownerA, marker: 'A_UPDATED' }));
      solo.send('commit;\n\\echo A_DONE');
      if (!(await until(() => solo.out.includes('A_DONE')))) return 'the demotion did not finish';
    } finally {
      await solo.close();
    }
    return upFrontVerdict({
      refused: /READ COMMITTED only/.test(solo.err),
      owners: Number(runOnce(ownersSql(orgId)).out),
    });
  }
  const a = openSession();
  const b = openSession();
  try {
    a.send(demoteSql({ isolation, orgId, userId: ownerA, marker: 'A_UPDATED' }));
    if (!(await until(() => a.out.includes('A_UPDATED')))) return 'the first demotion did not run';
    b.send(demoteSql({ isolation, orgId, userId: ownerB, marker: 'B_UPDATED' }));
    b.send('commit;\n\\echo B_DONE');
    const waited = await until(() => runOnce(waitingSql(ownerB)).out === '1');
    if (!waited) return 'the second demotion did not wait for the first';
    a.send('commit;\n\\echo A_DONE');
    if (!(await until(() => a.out.includes('A_DONE')))) return 'the first commit did not finish';
    if (!(await until(() => b.out.includes('B_DONE'))))
      return 'the second transaction did not finish';
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
  const owners = Number(runOnce(ownersSql(orgId)).out);
  return verdict({ firstErrored: /ERROR/.test(a.err), secondErrored: /ERROR/.test(b.err), owners });
}

export async function main({ out = process.stdout } = {}) {
  let failed = false;
  for (const isolation of LEVELS) {
    let problem;
    try {
      problem = await scenario(isolation);
    } catch {
      problem = 'could not run';
    }
    failed ||= problem !== null;
    out.write(
      `${TAG}: ${isolation}: ${problem === null ? `OK (${isolation === 'read committed' ? 'the second demotion was refused' : 'refused up front, both owners stay'})` : `FAILED: ${problem}`}\n`,
    );
  }
  return failed ? 1 : 0;
}

if (isEntryPoint(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  });
}
