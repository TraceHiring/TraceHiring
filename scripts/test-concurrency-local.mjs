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
// The worker scenario connects as the local stack's superuser only to SET ROLE to the authoring worker (as the real
// jobs_authoring_login does; the local postgres is not a member, and a committed grant would leak into the catalog
// checks run after this script). After SET ROLE the session has only the worker's privileges, and
// private.is_operator() is false (session_user is not postgres).
export const WORKER_USER = 'supabase_admin';

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

// M1 (specs/m1-test-authoring.md R5-51 b; M1-c database review H1 and M1): two more two-connection scenarios, each in
// its own synthetic org. H1: a cancel waits for a running import batch (the batch holds the job row FOR SHARE) and
// then counts that batch's rows. M1: two deliveries of a count-1 drafting job take turns on the job row (FOR NO KEY
// UPDATE), so the second sees the first's draft and is refused; the job never holds more drafts than its count.
const MARKER = /^[A-Z_]+$/;
const marker = (v) => {
  if (!MARKER.test(v)) throw new Error('bad marker');
  return v;
};
const suffixOf = (v) => {
  if (!/^[0-9a-f]{8}$/.test(v)) throw new Error('bad suffix');
  return v;
};
const IMPORT_ERROR_ROW = (rowNo) => {
  if (!Number.isInteger(rowNo) || rowNo < 2 || rowNo > 2001) throw new Error('bad row number');
  return `'[{"rowNo": ${rowNo}, "errors": [{"field": "stem", "code": "missing_field"}]}]'`;
};

/** The caller is the org owner (aal2), for the rest of the transaction. */
const asOwnerSql = (owner) =>
  [
    "select set_config('role', 'authenticated', true) is not null,",
    `  set_config('request.jwt.claims', '{"sub": "${uuid(owner).slice(1, -1)}", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}', true) is not null;`,
  ].join('\n');

/** The caller is the authoring worker bound to the org, for the rest of the transaction. */
const asAuthoringWorkerSql = (orgSql) =>
  `select set_config('role', 'trace_authoring_worker', true) is not null, set_config('trace.job_org_id', ${orgSql}, true) is not null;`;

/** Shared setup: one synthetic owner and an org (operator path); sets psql variables org_id and ws_id. */
function orgSetupSql({ owner, suffix, kind }) {
  return [
    'insert into auth.users (id, aud, role, email) values',
    `  (${uuid(owner)}, 'authenticated', 'authenticated', 'p-conc-${kind}-${suffixOf(suffix)}@example.test');`,
    `select private.create_org('Org Conc ${kind}', 'org-conc-${kind}-${suffix}', 'customer', ${uuid(owner)},`,
    `  'Persona Conc ${kind}', ${uuid(randomUUID())}) as org_id \\gset`,
    "select w.id as ws_id from public.workspaces as w where w.org_id = :'org_id' and w.is_default \\gset",
  ].join('\n');
}

/** H1 setup: an xlsx import job whose first batch (one error row) is committed, so the job is validating. */
export function importSetupSql({ owner, suffix }) {
  return [
    orgSetupSql({ owner, suffix, kind: 'imp' }),
    'insert into public.import_jobs (org_id, workspace_id, source_kind, template_version, created_by)',
    `  values (:'org_id', :'ws_id', 'xlsx', 'trace-items-v1', ${uuid(owner)}) returning id as job_id \\gset`,
    'begin;',
    asOwnerSql(owner),
    `select public.import_item_batch(:'job_id', ${IMPORT_ERROR_ROW(2)}) is not null;`,
    'commit;',
    "select 'JOB ' || :'job_id';",
  ].join('\n');
}

/** H1 connection A: a second batch (one error row), left open after the marker. */
export function importBatchSql({ owner, jobId, rowNo, marker: m }) {
  return [
    'begin isolation level read committed;',
    asOwnerSql(owner),
    `select public.import_item_batch(${uuid(jobId)}, ${IMPORT_ERROR_ROW(rowNo)}) is not null;`,
    `\\echo ${marker(m)}`,
  ].join('\n');
}

/** H1 connection B: the owner cancels the job. */
export function cancelSql({ owner, jobId, marker: m }) {
  return [
    'begin isolation level read committed;',
    asOwnerSql(owner),
    `update public.import_jobs set status = 'cancelled' where id = ${uuid(jobId)};`,
    `\\echo ${marker(m)}`,
  ].join('\n');
}

/** status|rows_error|stored error rows, read as the operator. */
export const importCountsSql = (jobId) =>
  [
    "select j.status || '|' || j.rows_error || '|' ||",
    '  (select count(distinct e.row_no) from public.import_row_errors as e where e.import_job_id = j.id)',
    `from public.import_jobs as j where j.id = ${uuid(jobId)};`,
  ].join('\n');

/** H1 verdict: the cancel waited for the batch, both committed, and the job counts both batches' rows. */
export function cancelVerdict({ waited, batchErrored, cancelErrored, counts }) {
  if (batchErrored) return 'the batch failed';
  if (!waited) return 'the cancel did not wait for the running batch';
  if (cancelErrored) return 'the cancel failed';
  const [status, rowsError, stored] = String(counts).split('|');
  if (status !== 'cancelled') return `the job is ${status}, not cancelled`;
  if (rowsError !== stored)
    return `the job counts ${rowsError} error rows but ${stored} are stored`;
  if (stored !== '2') return `${stored} error rows are stored, not 2`;
  return null;
}

/** M1 setup, operator part: an org and a queued count-1 drafting job. */
export function draftSetupSql({ owner, suffix }) {
  return [
    orgSetupSql({ owner, suffix, kind: 'draft' }),
    'insert into public.ai_draft_jobs (org_id, workspace_id, requested_by, format, skill_key, difficulty, count,',
    '    topic_sha256, provider, model_id, prompt_version)',
    `  values (:'org_id', :'ws_id', ${uuid(owner)}, 'mcq', 'verbal', 0.50, 1, repeat('e', 64), 'mock',`,
    "    'mock-drafter-v1', 'draft-v1') returning id as job_id \\gset",
    "select 'ORG ' || :'org_id';",
    "select 'WS ' || :'ws_id';",
    "select 'JOB ' || :'job_id';",
  ].join('\n');
}

/**
 * M1 setup, worker part (run as WORKER_USER, which may SET ROLE to the worker as the real login does): the
 * authoring worker moves the job to running and writes two items.
 */
export function draftWorkerSetupSql({ orgId, wsId, jobId }) {
  const item = `insert into public.items (org_id, workspace_id, format, skill_key) values (${uuid(orgId)}, ${uuid(wsId)}, 'mcq', 'verbal')`;
  return [
    'begin;',
    asAuthoringWorkerSql(uuid(orgId)),
    `update public.ai_draft_jobs set status = 'running' where id = ${uuid(jobId)};`,
    `${item} returning id as item_a \\gset`,
    `${item} returning id as item_b \\gset`,
    'commit;',
    "select 'ITEMA ' || :'item_a';",
    "select 'ITEMB ' || :'item_b';",
  ].join('\n');
}

/** M1: one delivery (a draft version of its own item, with its own content hash), left open after the marker. */
export function draftInsertSql({ orgId, jobId, itemId, shaChar, marker: m }) {
  if (!/^[0-9a-f]$/.test(shaChar)) throw new Error('bad hash character');
  return [
    'begin isolation level read committed;',
    asAuthoringWorkerSql(uuid(orgId)),
    'insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id,',
    '    content_sha256)',
    `  values (${uuid(orgId)}, ${uuid(itemId)}, 'mcq', '[synthetic] Concurrent draft',`,
    `    '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, ${uuid(jobId)}, repeat('${shaChar}', 64));`,
    `\\echo ${marker(m)}`,
  ].join('\n');
}

export const draftsSql = (jobId) =>
  `select count(*) from public.item_versions where ai_draft_job_id = ${uuid(jobId)};`;

/** M1 verdict: the second delivery waited, was refused after the first committed, and one draft is stored. */
export function draftVerdict({ waited, firstErrored, secondErrored, drafts }) {
  if (firstErrored) return 'the first delivery failed';
  if (!waited) return 'the second delivery did not wait for the first';
  if (!secondErrored) return 'the second delivery was not refused';
  if (drafts !== 1) return `the job has ${drafts} drafts, not 1`;
  return null;
}

const psql = (user) => {
  if (user !== 'postgres' && user !== WORKER_USER) throw new Error('unknown database user');
  return [
    'exec',
    '-i',
    LOCAL_DB_CONTAINER,
    'psql',
    '-U',
    user,
    '-d',
    'postgres',
    '-X',
    '-q',
    '-At',
  ];
};

function runOnce(sql, user = 'postgres') {
  const r = spawnSync('docker', [...psql(user), '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
  });
  return { status: r.status, out: (r.stdout || '').trim() };
}

/** An interactive psql session in the container; output is collected, never printed. */
function openSession(user = 'postgres') {
  const child = spawn('docker', [...psql(user), '-v', 'ON_ERROR_STOP=0'], {
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

/**
 * Two connections hold A open after its marker; B is sent with its commit and must wait on a row lock (seen by
 * waitKey in pg_stat_activity) until A commits. Returns null when it ran, else the failed step.
 */
async function race({ aSql, aMarker, bSql, waitKey, user = 'postgres' }) {
  const a = openSession(user);
  const b = openSession(user);
  const result = { waited: false };
  try {
    a.send(aSql);
    if (!(await until(() => a.out.includes(aMarker) || /ERROR/.test(a.err))))
      return { problem: 'A did not run' };
    b.send(bSql);
    b.send('commit;\n\\echo B_DONE');
    result.waited = await until(() => runOnce(waitingSql(waitKey), user).out === '1');
    a.send('commit;\n\\echo A_DONE');
    if (!(await until(() => a.out.includes('A_DONE'))))
      return { problem: 'the first commit did not finish' };
    if (!(await until(() => b.out.includes('B_DONE'))))
      return { problem: 'the second transaction did not finish' };
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
  return { ...result, aErr: a.err, bErr: b.err };
}

async function importCancelScenario() {
  const owner = randomUUID();
  const setup = runOnce(importSetupSql({ owner, suffix: randomBytes(4).toString('hex') }));
  const jobId = (setup.out.match(/^JOB (\S+)$/m) || [])[1];
  if (setup.status !== 0 || !isUuid(jobId ?? '')) return 'setup failed';
  const r = await race({
    aSql: importBatchSql({ owner, jobId, rowNo: 3, marker: 'A_BATCHED' }),
    aMarker: 'A_BATCHED',
    bSql: cancelSql({ owner, jobId, marker: 'B_CANCELLED' }),
    waitKey: jobId,
  });
  if (r.problem) return r.problem;
  return cancelVerdict({
    waited: r.waited,
    batchErrored: /ERROR/.test(r.aErr),
    cancelErrored: /ERROR/.test(r.bErr),
    counts: runOnce(importCountsSql(jobId)).out,
  });
}

async function draftCapScenario() {
  const owner = randomUUID();
  const setup = runOnce(draftSetupSql({ owner, suffix: randomBytes(4).toString('hex') }));
  const pick = (out, k) => (out.match(new RegExp(`^${k} (\\S+)$`, 'm')) || [])[1] ?? '';
  const [orgId, wsId, jobId] = ['ORG', 'WS', 'JOB'].map((k) => pick(setup.out, k));
  if (setup.status !== 0 || ![orgId, wsId, jobId].every(isUuid)) return 'setup failed';
  const worker = runOnce(draftWorkerSetupSql({ orgId, wsId, jobId }), WORKER_USER);
  const [itemA, itemB] = ['ITEMA', 'ITEMB'].map((k) => pick(worker.out, k));
  if (worker.status !== 0 || ![itemA, itemB].every(isUuid)) return 'worker setup failed';
  const r = await race({
    user: WORKER_USER,
    aSql: draftInsertSql({ orgId, jobId, itemId: itemA, shaChar: 'c', marker: 'A_DRAFTED' }),
    aMarker: 'A_DRAFTED',
    bSql: draftInsertSql({ orgId, jobId, itemId: itemB, shaChar: 'd', marker: 'B_DRAFTED' }),
    waitKey: itemB,
  });
  if (r.problem) return r.problem;
  return draftVerdict({
    waited: r.waited,
    firstErrored: /ERROR/.test(r.aErr),
    secondErrored: /an AI draft needs its running drafting job/.test(r.bErr),
    drafts: Number(runOnce(draftsSql(jobId)).out),
  });
}

export const M1_SCENARIOS = Object.freeze([
  {
    name: 'import cancel during a batch',
    run: importCancelScenario,
    ok: 'the cancel waited and counted the batch',
  },
  {
    name: 'count-1 drafting job',
    run: draftCapScenario,
    ok: 'the second delivery waited and was refused',
  },
]);

export async function main({ out = process.stdout } = {}) {
  let failed = false;
  const report = (name, problem, ok) => {
    failed ||= problem !== null;
    out.write(`${TAG}: ${name}: ${problem === null ? `OK (${ok})` : `FAILED: ${problem}`}\n`);
  };
  for (const isolation of LEVELS) {
    let problem;
    try {
      problem = await scenario(isolation);
    } catch {
      problem = 'could not run';
    }
    report(
      isolation,
      problem,
      isolation === 'read committed'
        ? 'the second demotion was refused'
        : 'refused up front, both owners stay',
    );
  }
  for (const s of M1_SCENARIOS) {
    let problem;
    try {
      problem = await s.run();
    } catch {
      problem = 'could not run';
    }
    report(s.name, problem, s.ok);
  }
  return failed ? 1 : 0;
}

if (isEntryPoint(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  });
}
