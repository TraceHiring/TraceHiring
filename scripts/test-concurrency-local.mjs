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
// M2 (AT-M2-08): two bookings on the last seat of a one-seat slot; the second waits and is refused as full.
// M2 (DC-M2-4): two messaging-worker claims at once; the second skips the rows the first holds, without waiting.
// Rows are committed and left behind until the next db reset: per run a running count-1 drafting job with
// one in_review AI draft, a cancelled import job, and a seat drive with one invitation and its planned messages,
// each in its own org-conc-* org. Nothing later in
// scripts/test-rls.mjs reads them; a future sweep over running drafting jobs across orgs must skip
// org-conc-* orgs (database review Info 5).
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
  if (!/^[a-z]+$/.test(kind)) throw new Error('bad kind');
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

/**
 * R5-71 setup (M1-p reviews: database Medium 1, security Low 1): a draft test version with no section yet whose
 * ruleset has the Standard settings (paste_written allowed_logged), on the operator path.
 */
export function pasteSetupSql({ owner, suffix }) {
  return [
    orgSetupSql({ owner, suffix, kind: 'paste' }),
    "insert into public.tests (org_id, workspace_id, name) values (:'org_id', :'ws_id', '[synthetic] Conc paste')",
    '  returning id as test_id \\gset',
    'insert into public.test_versions (org_id, test_id, total_time_seconds, quality_cutoff)',
    "  values (:'org_id', :'test_id', 1800, 40) returning id as version_id, ruleset_version_id as ruleset_id \\gset",
    "update public.ruleset_versions set preset_key = 'standard', settings = (select p.preset_values",
    "  from public.integrity_presets as p where p.preset_key = 'standard' and p.version = 1) where id = :'ruleset_id';",
    "select 'VER ' || :'version_id';",
    "select 'RS ' || :'ruleset_id';",
  ].join('\n');
}

/** R5-71 connection A: the owner stores Strict settings (paste_written blocked) in one write, left open. */
export function pasteSettingsSql({ owner, rulesetId, marker: m }) {
  return [
    'begin isolation level read committed;',
    "select p.preset_values::text as strict from public.integrity_presets as p where p.preset_key = 'strict'",
    '  and p.version = 1 \\gset',
    asOwnerSql(owner),
    "update public.ruleset_versions set preset_key = 'strict', settings = :'strict'::jsonb",
    `  where id = ${uuid(rulesetId)};`,
    `\\echo ${marker(m)}`,
  ].join('\n');
}

/** R5-71 connection B: the owner saves the draft with one written section naming no paste rule. */
export function pasteDraftSaveSql({ owner, versionId, marker: m }) {
  return [
    'begin isolation level read committed;',
    asOwnerSql(owner),
    `select public.save_test_draft(${uuid(versionId)}, '{"name": "[synthetic] Conc paste", "totalTimeSeconds": 1800,`,
    `  "qualityCutoff": 40, "sections": [{"name": "Essay", "format": "written", "weight": 100, "items": []}]}') is not null;`,
    `\\echo ${marker(m)}`,
  ].join('\n');
}

/** The written sections' paste rules of the version, read as the operator. */
export const pasteRulesSql = (versionId) =>
  "select coalesce(string_agg(coalesce(s.paste_rule, 'null'), ','), '') from public.sections as s" +
  ` where s.test_version_id = ${uuid(versionId)} and s.format = 'written';`;

/** R5-71 verdict: the save waited for the settings write, both committed, and the section took the new setting. */
export function pasteVerdict({ waited, settingsErrored, saveErrored, rules }) {
  if (settingsErrored) return 'the settings write failed';
  if (!waited) return 'the draft save did not wait for the settings write';
  if (saveErrored) return 'the draft save failed';
  if (rules !== 'blocked') return `the written section's paste rule is stale (${rules})`;
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

/** status|stored drafts of the job, read as the operator. */
export const draftsSql = (jobId) =>
  [
    "select j.status || '|' || (select count(*) from public.item_versions as v where v.ai_draft_job_id = j.id)",
    `from public.ai_draft_jobs as j where j.id = ${uuid(jobId)};`,
  ].join('\n');

/**
 * M1 verdict: the second delivery waited, was refused after the first committed, one draft is stored, and the job
 * is still running (the refusal message is shared with "job not running", so a job that ended early would hide a
 * missing cap; database review L3).
 */
export function draftVerdict({ waited, firstErrored, secondErrored, state }) {
  if (firstErrored) return 'the first delivery failed';
  if (!waited) return 'the second delivery did not wait for the first';
  if (!secondErrored) return 'the second delivery was not refused';
  const [status, drafts] = String(state).split('|');
  if (status !== 'running') return `the job is ${status}, not running`;
  if (drafts !== '1') return `the job has ${drafts} drafts, not 1`;
  return null;
}

// M2 (specs/m2-scheduling-invites.md AT-M2-08, I-M2-3, R2-15): two connections book the last seat of a one-seat slot
// at once. The first holds its row locks open; the second must wait and, once the first commits, be refused with
// "slot full", so the slot never holds more bookings than seats. The setup builds what a scheduled-mode drive needs
// on the operator path (a published version drawing 1 item from a 10-item pool, R5-10), as the pgTAP preamble does.

/** M2 setup, operator part: the org, a 10x pool version, a scheduled drive with a one-seat slot, two candidates. */
export function seatSetupSql({ owner, suffix }) {
  const ct = (s) => `'v1.1.${Buffer.from(s).toString('base64url')}'`;
  const cand = (k) => [
    'insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint)',
    `  values (:'org_id', :'ws_id', ${ct(`n-${k}`)}, 1, encode(sha256(convert_to('e-${k}-' || :'org_id', 'UTF8')), 'hex'))`,
    `  returning id as cand_${k} \\gset`,
    'insert into public.candidate_contacts (org_id, candidate_id, workspace_id, email_ct, email_bidx, email_hint,',
    '    key_version)',
    `  values (:'org_id', :'cand_${k}', :'ws_id', ${ct(`e-${k}`)},`,
    `    encode(sha256(convert_to('e-${k}-' || :'org_id', 'UTF8')), 'hex'), 'c•••@example.test', 1);`,
  ];
  return [
    orgSetupSql({ owner, suffix, kind: 'seat' }),
    'insert into public.items (org_id, workspace_id, format, skill_key, created_by)',
    `  select :'org_id', :'ws_id', 'mcq', 'verbal', ${uuid(owner)} from generate_series(1, 10);`,
    'insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256,',
    '    created_by)',
    '  select i.org_id, i.id, \'mcq\', \'[synthetic] Seat item\', \'[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]\',',
    `    'verbal', 0.50, repeat('c', 64), ${uuid(owner)} from public.items as i where i.org_id = :'org_id';`,
    'insert into public.item_answer_keys (org_id, item_version_id, format, key)',
    "  select v.org_id, v.id, 'mcq', '{\"option_id\": \"o1\"}' from public.item_versions as v where v.org_id = :'org_id';",
    "update public.item_versions set status = 'in_review' where org_id = :'org_id';",
    `update public.item_versions set status = 'approved', approved_by = ${uuid(owner)} where org_id = :'org_id';`,
    "insert into public.pools (org_id, workspace_id, name, format) values (:'org_id', :'ws_id', 'Seat pool', 'mcq')",
    '  returning id as pool_id \\gset',
    'insert into public.pool_items (org_id, pool_id, item_version_id)',
    "  select v.org_id, :'pool_id', v.id from public.item_versions as v where v.org_id = :'org_id';",
    "insert into public.tests (org_id, workspace_id, name) values (:'org_id', :'ws_id', 'Seat test') returning id as test_id \\gset",
    'insert into public.test_versions (org_id, test_id, total_time_seconds, quality_cutoff)',
    "  values (:'org_id', :'test_id', 1800, 40) returning id as tv_id \\gset",
    'insert into public.sections (org_id, test_version_id, position, name, format, weight, pool_id, draw_count, navigation)',
    "  values (:'org_id', :'tv_id', 1, 'Seat section', 'mcq', 100, :'pool_id', 1, 'free') returning id as sec_id \\gset",
    "update public.ruleset_versions as r set preset_key = 'standard', settings = (select p.preset_values",
    "  from public.integrity_presets as p where p.preset_key = 'standard' and p.version = 1)",
    "  where r.id = (select v.ruleset_version_id from public.test_versions as v where v.id = :'tv_id');",
    "update public.test_versions set status = 'published', content_sha256 = repeat('b', 64), snapshot_digest = (",
    "  select encode(sha256(convert_to(string_agg(:'sec_id' || ':' || pi.item_version_id::text, E'\\n'",
    "    order by :'sec_id' || ':' || pi.item_version_id::text collate \"C\"), 'UTF8')), 'hex')",
    "  from public.pool_items as pi where pi.pool_id = :'pool_id') where id = :'tv_id';",
    'insert into public.drives (org_id, test_id, default_test_version_id, name, mode, status, opens_at, deadline_at)',
    "  values (:'org_id', :'test_id', :'tv_id', 'Seat drive', 'scheduled', 'draft', now() - interval '1 day',",
    "    now() + interval '30 days') returning id as drive_id \\gset",
    "insert into public.slots (org_id, drive_id, starts_at, capacity) values (:'org_id', :'drive_id', now() + interval '2 days', 1)",
    '  returning id as slot_id \\gset',
    "update public.drives set status = 'scheduled' where id = :'drive_id';",
    ...cand('a'),
    ...cand('b'),
    "select 'ORG ' || :'org_id';",
    "select 'DRIVE ' || :'drive_id';",
    "select 'SLOT ' || :'slot_id';",
    "select 'CANDA ' || :'cand_a';",
    "select 'CANDB ' || :'cand_b';",
  ].join('\n');
}

/** M2: one booking (a drive invitation on the slot) by the org owner, left open after the marker. */
export function bookSql({ owner, orgId, driveId, slotId, candidateId, marker: m }) {
  return [
    'begin isolation level read committed;',
    asOwnerSql(owner),
    'insert into public.invitations (org_id, test_id, test_version_id, drive_id, slot_id, candidate_ref_id,',
    '    link_token_hash, adult_confirmed_by_inviter, expires_at)',
    `  select d.org_id, d.test_id, d.default_test_version_id, d.id, ${uuid(slotId)}, ${uuid(candidateId)},`,
    `    encode(sha256(convert_to(${uuid(candidateId)}, 'UTF8')), 'hex'), true, now() + interval '1 day'`,
    `  from public.drives as d where d.org_id = ${uuid(orgId)} and d.id = ${uuid(driveId)};`,
    `\\echo ${marker(m)}`,
  ].join('\n');
}

// M2 DC-M2-4 (specs/m2-scheduling-invites.md §8, R5-9; ADR-031 amendment 1): two cron claims at once. The first
// holds its claim open; the second, run meanwhile under a statement timeout, must take none of the org's due rows and
// must not wait (FOR UPDATE SKIP LOCKED), so overlapping ticks never double-send. Each claim is one transaction of
// simple-protocol statements (psql sends no prepared statement), the shape postgres.js uses with prepare: false through
// Hyperdrive. It connects as WORKER_USER only to SET ROLE to trace_messaging_worker (as jobs_messaging_login does).

/** M2 claim: one committed booking on the seat drive, so the planner leaves the org one due invite message. */
export function claimBookSql(ids) {
  return [bookSql({ ...ids, marker: 'BOOKED' }), 'commit;'].join('\n');
}

/** The first claim, as the messaging worker, left open after the marker; prints HELD <rows of the org>. */
export function claimHoldSql({ orgId, marker: m }) {
  return [
    'begin isolation level read committed;',
    'set local role trace_messaging_worker;',
    "select 'HELD ' || count(*) from private.claim_due_messages(now(), 1000) as c",
    `  where c.org_id = ${uuid(orgId)};`,
    `\\echo ${marker(m)}`,
  ].join('\n');
}

/** The second claim while the first holds: a wait would hit the statement timeout. Prints PROBE <rows>. */
export function claimProbeSql({ orgId }) {
  return [
    "set statement_timeout = '5s';",
    'begin isolation level read committed;',
    'set local role trace_messaging_worker;',
    "select 'PROBE ' || count(*) from private.claim_due_messages(now(), 1000) as c",
    `  where c.org_id = ${uuid(orgId)};`,
    'commit;',
  ].join('\n');
}

/** due planned|queued|distinct claim ids of the org's messages, read as the operator. */
export const claimStateSql = (orgId) =>
  [
    "select count(*) filter (where m.status = 'planned' and m.scheduled_for <= now()) || '|' ||",
    "  count(*) filter (where m.status = 'queued') || '|' || count(distinct m.claim_id)",
    `from public.outbound_messages as m where m.org_id = ${uuid(orgId)};`,
  ].join('\n');

/** DC-M2-4 verdict: the first claim took every due row, the second none and did not wait; one claim id per row. */
export function claimVerdict({ dueBefore, held, probe, probeErrored, state }) {
  if (!(Number(dueBefore) >= 1)) return 'the booking planned no due message';
  if (probeErrored) return 'the second claim waited or failed';
  if (String(held) !== String(dueBefore))
    return `the first claim took ${held} of ${dueBefore} due messages`;
  if (String(probe) !== '0') return `the second claim took ${probe} messages the first held`;
  const [due, queued, claims] = String(state).split('|');
  if (due !== '0' || queued !== String(held) || claims !== String(held))
    return `after both claims: due ${due}, queued ${queued}, claim ids ${claims}`;
  return null;
}

/** booked|live invitations of the slot, read as the operator. */
export const seatsSql = (slotId) =>
  [
    "select s.booked || '|' || (select count(*) from public.invitations as i where i.slot_id = s.id",
    "  and i.status not in ('revoked', 'expired', 'blocked_age'))",
    `from public.slots as s where s.id = ${uuid(slotId)};`,
  ].join('\n');

/** M2 verdict: the second booking waited and was refused as full; the slot holds exactly one booking. */
export function seatVerdict({ waited, firstErrored, secondRefusedFull, seats }) {
  if (firstErrored) return 'the first booking failed';
  if (!waited) return 'the second booking did not wait for the first';
  if (!secondRefusedFull) return 'the second booking was not refused as full';
  const [booked, invitations] = String(seats).split('|');
  if (booked !== '1' || invitations !== '1')
    return `the slot has booked ${booked}, invitations ${invitations}, not 1 and 1`;
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
// A wall-clock deadline: each check may itself take a docker exec (database review Info 4).
async function until(check) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
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
    state: runOnce(draftsSql(jobId)).out,
  });
}

async function pasteScenario() {
  const owner = randomUUID();
  const setup = runOnce(pasteSetupSql({ owner, suffix: randomBytes(4).toString('hex') }));
  const pick = (k) => (setup.out.match(new RegExp(`^${k} (\\S+)$`, 'm')) || [])[1] ?? '';
  const [versionId, rulesetId] = ['VER', 'RS'].map(pick);
  if (setup.status !== 0 || ![versionId, rulesetId].every(isUuid)) return 'setup failed';
  const r = await race({
    aSql: pasteSettingsSql({ owner, rulesetId, marker: 'A_SETTINGS' }),
    aMarker: 'A_SETTINGS',
    bSql: pasteDraftSaveSql({ owner, versionId, marker: 'B_SAVED' }),
    waitKey: versionId,
  });
  if (r.problem) return r.problem;
  return pasteVerdict({
    waited: r.waited,
    settingsErrored: /ERROR/.test(r.aErr),
    saveErrored: /ERROR/.test(r.bErr),
    rules: runOnce(pasteRulesSql(versionId)).out,
  });
}

export const M1_SCENARIOS = Object.freeze([
  {
    name: 'draft save during a settings write',
    run: pasteScenario,
    ok: 'the save waited and took the new paste rule',
  },
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

async function seatScenario() {
  const owner = randomUUID();
  const setup = runOnce(seatSetupSql({ owner, suffix: randomBytes(4).toString('hex') }));
  const pick = (k) => (setup.out.match(new RegExp(`^${k} (\\S+)$`, 'm')) || [])[1] ?? '';
  const [orgId, driveId, slotId, candA, candB] = ['ORG', 'DRIVE', 'SLOT', 'CANDA', 'CANDB'].map(
    pick,
  );
  if (setup.status !== 0 || ![orgId, driveId, slotId, candA, candB].every(isUuid))
    return 'setup failed';
  const ids = { owner, orgId, driveId, slotId };
  const r = await race({
    aSql: bookSql({ ...ids, candidateId: candA, marker: 'A_BOOKED' }),
    aMarker: 'A_BOOKED',
    bSql: bookSql({ ...ids, candidateId: candB, marker: 'B_BOOKED' }),
    waitKey: candB,
  });
  if (r.problem) return r.problem;
  return seatVerdict({
    waited: r.waited,
    firstErrored: /ERROR/.test(r.aErr),
    secondRefusedFull: /TRACE_GUARD: slot full/.test(r.bErr),
    seats: runOnce(seatsSql(slotId)).out,
  });
}

async function claimScenario() {
  const owner = randomUUID();
  const setup = runOnce(seatSetupSql({ owner, suffix: randomBytes(4).toString('hex') }));
  const pick = (k) => (setup.out.match(new RegExp(`^${k} (\\S+)$`, 'm')) || [])[1] ?? '';
  const [orgId, driveId, slotId, candA] = ['ORG', 'DRIVE', 'SLOT', 'CANDA'].map(pick);
  if (setup.status !== 0 || ![orgId, driveId, slotId, candA].every(isUuid)) return 'setup failed';
  const booked = runOnce(claimBookSql({ owner, orgId, driveId, slotId, candidateId: candA }));
  if (booked.status !== 0) return 'the booking failed';
  const dueBefore = runOnce(claimStateSql(orgId)).out.split('|')[0];
  const a = openSession(WORKER_USER);
  try {
    a.send(claimHoldSql({ orgId, marker: 'A_CLAIMED' }));
    if (!(await until(() => a.out.includes('A_CLAIMED') || /ERROR/.test(a.err))))
      return 'the first claim did not run';
    if (/ERROR/.test(a.err)) return 'the first claim failed';
    const b = runOnce(claimProbeSql({ orgId }), WORKER_USER);
    a.send('commit;\n\\echo A_DONE');
    if (!(await until(() => a.out.includes('A_DONE')))) return 'the first commit did not finish';
    const held = (a.out.match(/^HELD (\d+)$/m) || [])[1];
    const probe = (b.out.match(/^PROBE (\d+)$/m) || [])[1];
    return claimVerdict({
      dueBefore,
      held,
      probe,
      probeErrored: b.status !== 0 || probe === undefined,
      state: runOnce(claimStateSql(orgId)).out,
    });
  } finally {
    await a.close();
  }
}

export const M2_SCENARIOS = Object.freeze([
  {
    name: 'last seat of a slot',
    run: seatScenario,
    ok: 'the second booking waited and was refused as full',
  },
  {
    name: 'two messaging claims at once',
    run: claimScenario,
    ok: 'the second claim skipped the held rows without waiting',
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
  for (const s of [...M1_SCENARIOS, ...M2_SCENARIOS]) {
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
