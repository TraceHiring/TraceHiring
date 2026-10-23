// The AI drafting job against the real schema (specs/m1-test-authoring.md §6.4, M1-19, R5-35, R5-50 draft cap, R5-56 e;
// AT-M1-09): the job runs as trace_authoring_worker bound to its job org, its drafts land in_review with their keys and
// audit rows and never approved, a re-delivery adds nothing, the item_versions guard enforces the cap, and the worker's
// grants refuse everything else. Synthetic org per file, cleaned up afterwards.
import { randomBytes } from 'node:crypto';
import { MockLlmDrafter } from '@trace/vendors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleDraftMessage, type DraftingDeps } from '../src/drafting/handler.js';
import { draftItemId } from '../src/drafting/seed.js';
import { normaliseText } from '../src/drafting/checks.js';
import { sqlDraftStore, type DraftStore } from '../src/drafting/store.js';
import { createLogger } from '@trace/shared/log';
import { cleanupOrg, newId, openHarness, type Harness } from './harness.js';

let h: Harness;
const org = newId();
const otherOrg = newId();
const workspace = newId();
const otherWorkspace = newId();
const hex = (n: number): string => randomBytes(n).toString('hex');

const insertJob = async (
  o: string,
  ws: string,
  patch: { format?: string; count?: number; status?: string } = {},
): Promise<string> => {
  const id = newId();
  await h.admin.unsafe(
    'insert into public.ai_draft_jobs (id, org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, ' +
      "provider, model_id, prompt_version) values ($1, $2, $3, $4::public.section_format, 'logical', 0.5, $5, $6, " +
      "'mock', 'mock-drafter-v1', 'draft-v1')",
    [id, o, ws, patch.format ?? 'mcq', patch.count ?? 3, hex(32)],
  );
  if (patch.status !== undefined) {
    await h.admin.unsafe('update public.ai_draft_jobs set status = $2 where id = $1', [
      id,
      patch.status,
    ]);
  }
  return id;
};

const asWorker = <T>(o: string, fn: (s: DraftStore) => Promise<T>): Promise<T> =>
  h.stage('trace_authoring_worker', o, (tx) => fn(sqlDraftStore(tx, o)));

const deps = (): DraftingDeps => ({
  db: { run: asWorker },
  drafterFor: (spec) => new MockLlmDrafter('dev', { seed: spec.seed }),
  log: createLogger({ service: 'jobs', version: 'dev', sink: () => {} }),
});

const msg = (jobId: string, patch: Record<string, unknown> = {}) => ({
  v: 1 as const,
  kind: 'ai_draft' as const,
  jobId,
  orgId: org,
  workspaceId: workspace,
  format: 'mcq' as const,
  skillKey: 'logical',
  difficulty: 0.5,
  count: 3,
  topic: '[synthetic] a small team week',
  ...patch,
});

const deniedCode = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return String((e as { code?: unknown }).code);
  }
};

beforeAll(async () => {
  h = await openHarness();
  for (const [o, ws] of [
    [org, workspace],
    [otherOrg, otherWorkspace],
  ] as const) {
    await h.admin.unsafe(
      "insert into public.orgs (id, kind, name, slug) values ($1, 'customer', 'Jobs DB test', $2)",
      [o, `jobs-dbtest-${hex(6)}`],
    );
    await h.admin.unsafe(
      "insert into public.workspaces (id, org_id, name, kind, is_default) values ($1, $2, 'Default', 'default', true)",
      [ws, o],
    );
  }
});

afterAll(async () => {
  if (h === undefined) return;
  await cleanupOrg(h.admin, org);
  await cleanupOrg(h.admin, otherOrg);
  await h.close();
});

describe('drafting job on the real schema', () => {
  let jobId = '';

  it('AT-M1-09: stores count MCQ drafts in_review with keys and audit rows; never approved', async () => {
    jobId = await insertJob(org, workspace);
    expect(await handleDraftMessage(msg(jobId), deps())).toBe('completed');

    const versions = await h.admin.unsafe<
      {
        item_id: string;
        status: string;
        origin: string;
        approved_by: string | null;
        workspace_id: string;
        skill_key: string;
        difficulty: string;
        section_id: string | null;
        has_key: boolean;
      }[]
    >(
      'select v.item_id::text as item_id, v.status::text as status, v.origin, v.approved_by::text as approved_by, ' +
        'v.workspace_id::text as workspace_id, v.skill_key, v.difficulty::text as difficulty, ' +
        'v.section_id::text as section_id, exists (select 1 from public.item_answer_keys as k ' +
        'where k.org_id = v.org_id and k.item_version_id = v.id) as has_key ' +
        'from public.item_versions as v where v.org_id = $1 and v.ai_draft_job_id = $2 order by v.item_id',
      [org, jobId],
    );
    expect(versions).toHaveLength(3);
    for (const v of versions) {
      expect(v).toMatchObject({
        status: 'in_review',
        origin: 'ai_draft',
        approved_by: null,
        workspace_id: workspace,
        skill_key: 'logical',
        section_id: null,
        has_key: true,
      });
      expect(Number(v.difficulty)).toBe(0.5);
    }
    const ids = await Promise.all([0, 1, 2].map((i) => draftItemId(jobId, i)));
    expect(versions.map((v) => v.item_id).sort()).toEqual([...ids].sort());

    const [j] = await h.admin.unsafe<
      {
        status: string;
        drafts_created: number;
        drafts_discarded: number;
        error_code: string | null;
      }[]
    >(
      'select status, drafts_created, drafts_discarded, error_code from public.ai_draft_jobs where id = $1',
      [jobId],
    );
    expect(j).toEqual({
      status: 'completed',
      drafts_created: 3,
      drafts_discarded: 0,
      error_code: null,
    });

    const audit = await h.admin.unsafe<{ action: string; n: number }[]>(
      "select action, count(*)::int as n from public.audit_log where org_id = $1 and action in ('item.ai_drafted', " +
        "'ai_draft.complete') group by action order by action",
      [org],
    );
    expect(audit).toEqual([
      { action: 'ai_draft.complete', n: 1 },
      { action: 'item.ai_drafted', n: 3 },
    ]);
    const keys = await h.admin.unsafe(
      "select 1 from public.idempotency_keys where org_id = $1 and scope = 'ai_draft' and key = $2",
      [org, `${jobId}:ai_draft`],
    );
    expect(keys).toHaveLength(1);
  });

  it('a re-delivery is skipped and adds no draft', async () => {
    expect(await handleDraftMessage(msg(jobId), deps())).toBe('skipped');
    const [count] = await h.admin.unsafe<{ n: number }[]>(
      'select count(*)::int as n from public.item_versions where org_id = $1 and ai_draft_job_id = $2',
      [org, jobId],
    );
    expect(count?.n).toBe(3);
  });

  it('the exact-duplicate lookup normalises as the job does', async () => {
    const stems = await h.admin.unsafe<{ stem: string }[]>(
      'select stem from public.item_versions where org_id = $1 and ai_draft_job_id = $2',
      [org, jobId],
    );
    const wanted = stems.map((s) => normaliseText(`  ${s.stem.toUpperCase()}  `));
    const found = await asWorker(org, (s) =>
      s.existingStems([...wanted, 'no such stem here at all']),
    );
    expect([...found].sort()).toEqual([...wanted].sort());
    expect(await asWorker(org, (s) => s.approvedStems('logical', 2000))).toEqual([]);
  });

  it('R5-56 e: a written job discards every draft and fails no_draft_passed', async () => {
    const id = await insertJob(org, workspace, { format: 'written', count: 2 });
    expect(await handleDraftMessage(msg(id, { format: 'written', count: 2 }), deps())).toBe(
      'failed',
    );
    const [j] = await h.admin.unsafe<
      { status: string; drafts_created: number; drafts_discarded: number; error_code: string }[]
    >(
      'select status, drafts_created, drafts_discarded, error_code from public.ai_draft_jobs where id = $1',
      [id],
    );
    expect(j).toEqual({
      status: 'failed',
      drafts_created: 0,
      drafts_discarded: 2,
      error_code: 'no_draft_passed',
    });
  });
});

describe('the draft cap and the authoring worker grants', () => {
  const draft = async (jobId: string, n: number) => ({
    itemId: await draftItemId(jobId, n),
    contentSha256: hex(32),
    item: {
      format: 'mcq' as const,
      stem: `[synthetic] Case ${n}. A shop has ${20 + n} boxes to sort before the end of the day. What is the best next step?`,
      options: [
        { id: 'a', text: 'Split the work into small parts' },
        { id: 'b', text: 'Ignore the deadline' },
      ],
      correctOptionId: 'a',
    },
  });

  it('R5-50: the item_versions guard refuses a draft past the job count (has_room)', async () => {
    const id = await insertJob(org, workspace, { count: 1, status: 'running' });
    const job = (await asWorker(org, (s) => s.lockJob(id)))!;
    expect(await asWorker(org, async (s) => s.insertDraft(job, await draft(id, 0)))).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(
      await deniedCode(asWorker(org, async (s) => s.insertDraft(job, await draft(id, 1)))),
    ).toBe('42501');
  });

  it('R5-35: no draft for a queued job; the job of another org is invisible', async () => {
    const queued = await insertJob(org, workspace);
    const job = (await asWorker(org, (s) => s.lockJob(queued)))!;
    expect(job.status).toBe('queued');
    expect(
      await deniedCode(asWorker(org, async (s) => s.insertDraft(job, await draft(queued, 0)))),
    ).toBe('42501');
    const foreign = await insertJob(otherOrg, otherWorkspace, { status: 'running' });
    expect(await asWorker(org, (s) => s.lockJob(foreign))).toBeNull();
    expect(await asWorker(org, (s) => s.storedDrafts(foreign))).toBe(0);
  });

  it('M1-19: the worker cannot change a job request, approve a draft or read a key', async () => {
    const id = await insertJob(org, workspace, { status: 'running' });
    const run = (sql: string, params: string[]) =>
      deniedCode(h.stage('trace_authoring_worker', org, (tx) => tx.query(sql, params)));
    expect(await run('update public.ai_draft_jobs set count = 10 where id = $1', [id])).toBe(
      '42501',
    );
    expect(
      await run("update public.item_versions set status = 'approved' where ai_draft_job_id = $1", [
        id,
      ]),
    ).toBe('42501');
    expect(await run('select key from public.item_answer_keys where org_id = $1', [org])).toBe(
      '42501',
    );
    expect(await run('select 1 from public.memberships where org_id = $1', [org])).toBe('42501');
  });
});
