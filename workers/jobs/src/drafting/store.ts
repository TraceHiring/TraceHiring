// SQL of the AI drafting job (specs/m1-test-authoring.md §6.4, M1-19, R5-35, R5-50), run as trace_authoring_worker inside
// one transaction per stage with trace.job_org_id bound (queue/stage-db.ts). Constant SQL text, bound parameters only,
// jsonb sent as `$n::text::jsonb`, values selected as text or plain numbers. The worker's grants (M1-19) are: SELECT and
// UPDATE (status, drafts_discarded, error_code) on its org's ai_draft_jobs; SELECT and INSERT of items and item_versions;
// INSERT only of item_answer_keys (it never reads a key, so no RETURNING there); SELECT and INSERT of its `ai_draft`
// idempotency keys. The guards decide the rest: origin `ai_draft`, status `in_review`, the running job, the cap
// (private.ai_draft_job_has_room) and drafts_created, counted from the stored drafts when the job ends.
import type { AiDraftErrorCode } from '@trace/shared/contracts/m1';
import type { SqlTx } from '@trace/shared/jobs';
import type { DraftFormat, DraftedMcqItem } from '@trace/vendors';

/** The whitespace class normaliseText() collapses (checks.ts), bound as a parameter so SQL and TS use one pattern. */
const WS_CLASS = '[ \t\n\r\f\v]+';

export const SQL = {
  lockJob:
    'select id::text as id, workspace_id::text as workspace_id, format::text as format, skill_key, ' +
    'difficulty::text as difficulty, count::int as count, status, provider, model_id, prompt_version, topic_sha256 ' +
    'from public.ai_draft_jobs where org_id = $1::uuid and id = $2::uuid for no key update',
  claim:
    "update public.ai_draft_jobs set status = 'running' where org_id = $1::uuid and id = $2::uuid " +
    "and status = 'queued'",
  keyExists:
    "select 1 as one from public.idempotency_keys where org_id = $1::uuid and scope = 'ai_draft' and key = $2",
  storedDrafts:
    'select count(*)::int as n from public.item_versions where org_id = $1::uuid and ai_draft_job_id = $2::uuid',
  existingStems:
    'select distinct s.n from (select btrim(lower(regexp_replace(v.stem, $3, $4, $5)), $4) as n ' +
    'from public.item_versions as v where v.org_id = $1::uuid) as s ' +
    'where s.n in (select jsonb_array_elements_text($2::text::jsonb))',
  approvedStems:
    "select stem from public.item_versions where org_id = $1::uuid and section_id is null and status = 'approved' " +
    'and skill_key = $2 order by created_at desc, id limit $3::int',
  insertItem:
    // A plain insert (R5-61; A3b security review): an id clash, in this org or another, raises 23505, the stage rolls
    // back and the message is retried (the last try ends the job `internal`); it is never read as a re-delivery.
    "insert into public.items (id, org_id, workspace_id, format, skill_key) values ($1::uuid, $2::uuid, $3::uuid, 'mcq', $4)",
  insertVersion:
    'insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, origin, ' +
    "ai_draft_job_id, content_sha256) values ($1::uuid, $2::uuid, 'mcq', $3, $4::text::jsonb, $5, $6::numeric, " +
    "'ai_draft', $7::uuid, $8) returning id::text as id",
  insertKey:
    "insert into public.item_answer_keys (org_id, item_version_id, format, key) values ($1::uuid, $2::uuid, 'mcq', " +
    '$3::text::jsonb)',
  complete:
    "update public.ai_draft_jobs set status = 'completed', drafts_discarded = $3::int where org_id = $1::uuid " +
    "and id = $2::uuid and status = 'running' returning id::text as id",
  fail:
    "update public.ai_draft_jobs set status = 'failed', error_code = $3, drafts_discarded = $4::int " +
    "where org_id = $1::uuid and id = $2::uuid and status in ('queued', 'running') returning id::text as id",
  insertIdempotencyKey:
    'insert into public.idempotency_keys (org_id, scope, key, result_ref, expires_at) ' +
    "values ($1::uuid, 'ai_draft', $2, $3, now() + interval '90 days') on conflict do nothing",
} as const;

export type DraftJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface DraftJobRow {
  id: string;
  workspace_id: string;
  format: DraftFormat;
  skill_key: string;
  /** numeric as text, e.g. '0.5' or '0.50'. */
  difficulty: string;
  count: number;
  status: DraftJobStatus;
  provider: string;
  model_id: string;
  prompt_version: string;
  /** SHA-256 hex of the UTF-8 of scrubDraftTopic(topic), written by the api (R5-61 d). */
  topic_sha256: string;
}

/** A checked MCQ draft as it is stored (texts already trimmed; the hash is of exactly these texts). */
export interface StoredDraft {
  itemId: string;
  item: DraftedMcqItem;
  contentSha256: string;
}

export type DraftOutcomeWrite =
  | { status: 'completed'; discarded: number }
  | { status: 'failed'; errorCode: AiDraftErrorCode; discarded: number };

export interface DraftStore {
  /** The job row, locked FOR NO KEY UPDATE (serialises deliveries and the draft hooks); null if not in the job org. */
  lockJob(jobId: string): Promise<DraftJobRow | null>;
  /** queued → running (no-op in any other state). */
  claim(jobId: string): Promise<void>;
  keyExists(jobId: string): Promise<boolean>;
  storedDrafts(jobId: string): Promise<number>;
  /** Which of the normalised stems already exist among the org's item versions. */
  existingStems(normalised: readonly string[]): Promise<Set<string>>;
  /** Approved bank stems of a skill, most recent first. */
  approvedStems(skillKey: string, limit: number): Promise<string[]>;
  /** Stores one draft with its key; returns the version id. Throws (23505) when its item id already exists. */
  insertDraft(job: DraftJobRow, draft: StoredDraft): Promise<string>;
  /** Ends the job and writes its idempotency key; throws when the job is no longer open. */
  finish(jobId: string, outcome: DraftOutcomeWrite): Promise<void>;
}

/** The constant error when a job could not be ended (another delivery ended it first). */
export const JOB_NOT_OPEN = 'drafting_job_not_open';

export const idempotencyKey = (jobId: string): string => `${jobId}:ai_draft`;

export const sqlDraftStore = (tx: SqlTx, orgId: string): DraftStore => ({
  lockJob: async (jobId) => {
    const [row] = await tx.query<DraftJobRow>(SQL.lockJob, [orgId, jobId]);
    return row ?? null;
  },
  claim: async (jobId) => {
    await tx.query(SQL.claim, [orgId, jobId]);
  },
  keyExists: async (jobId) =>
    (await tx.query(SQL.keyExists, [orgId, idempotencyKey(jobId)])).length > 0,
  storedDrafts: async (jobId) => {
    const [row] = await tx.query<{ n: number }>(SQL.storedDrafts, [orgId, jobId]);
    return Number(row?.n ?? 0);
  },
  existingStems: async (normalised) => {
    if (normalised.length === 0) return new Set();
    const rows = await tx.query<{ n: string }>(SQL.existingStems, [
      orgId,
      JSON.stringify(normalised),
      WS_CLASS,
      ' ',
      'g',
    ]);
    return new Set(rows.map((r) => r.n));
  },
  approvedStems: async (skillKey, limit) =>
    (await tx.query<{ stem: string }>(SQL.approvedStems, [orgId, skillKey, limit])).map(
      (r) => r.stem,
    ),
  insertDraft: async (job, draft) => {
    await tx.query(SQL.insertItem, [draft.itemId, orgId, job.workspace_id, job.skill_key]);
    const [version] = await tx.query<{ id: string }>(SQL.insertVersion, [
      orgId,
      draft.itemId,
      draft.item.stem,
      JSON.stringify(draft.item.options.map((o) => ({ id: o.id, text: o.text }))),
      job.skill_key,
      job.difficulty,
      job.id,
      draft.contentSha256,
    ]);
    if (version === undefined) throw new Error('drafting_version_not_returned');
    await tx.query(SQL.insertKey, [
      orgId,
      version.id,
      JSON.stringify({ option_id: draft.item.correctOptionId }),
    ]);
    return version.id;
  },
  finish: async (jobId, outcome) => {
    const rows =
      outcome.status === 'completed'
        ? await tx.query(SQL.complete, [orgId, jobId, outcome.discarded])
        : await tx.query(SQL.fail, [orgId, jobId, outcome.errorCode, outcome.discarded]);
    if (rows.length === 0) throw new Error(JOB_NOT_OPEN);
    await tx.query(SQL.insertIdempotencyKey, [orgId, idempotencyKey(jobId), outcome.status]);
  },
});
