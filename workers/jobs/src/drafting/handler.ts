// One AI drafting job (specs/m1-test-authoring.md §4.4, §6.4, M1-8, M1-19, R5-35, R5-50, R5-51 d, R5-52 g, R5-56 c/e).
//
// Stage 1 (one transaction as trace_authoring_worker): lock the job row; a finished job, or one whose idempotency key
// exists, is skipped; a message that disagrees with the row ends the job `internal`; a queued job is claimed (running).
// Then, outside any transaction, the drafter runs with the job row's pinned values, the topic re-scrubbed and passed as
// DATA (the request has no identity field), and a seed derived from the job id, so a re-delivery drafts the same items.
// Stage 2 (one transaction): lock the job again; if it is still running, screen the answer (checks.ts), store the
// passing MCQ drafts while the job has room (the guard stores them `in_review`, never approved; a job never approves),
// and end the job: `completed` when it holds a draft, else `failed no_draft_passed`; a written draft is always discarded
// (R5-56 e). The end and the drafts commit together, and draft item ids are derived from the job id, so a re-delivery
// never duplicates a draft. A drafter failure ends the job `drafter_error`, `timeout` or `bad_output`. Database errors
// propagate (the consumer retries). Logs carry ids, codes and counts only: never the topic, a prompt or a draft.
import type { AiDraftErrorCode, AuthoringQueueMessage } from '@trace/shared/contracts/m1';
import { itemContentSha256, scrubDraftTopic } from '@trace/shared/item-hash';
import type { Logger } from '@trace/shared/log';
import type { DraftRequest, DraftResult, DraftedMcqItem, LlmDrafter } from '@trace/vendors';
import { DRAFT_LIMITS, normaliseText, preScreen, screenDrafts } from './checks.js';
import { draftItemId, jobSeed } from './seed.js';
import type { DraftJobRow, DraftStore } from './store.js';

/** Runs `fn` in one transaction as trace_authoring_worker bound to `orgId` (queue/stage-db.ts in production). */
export interface DraftingDb {
  run<T>(orgId: string, fn: (store: DraftStore) => Promise<T>): Promise<T>;
}

/** The drafter pinned on the job row (`provider`, `model_id`, `prompt_version`) and the job's seed. */
export interface DrafterSpec {
  provider: string;
  modelId: string;
  promptVersion: string;
  seed: number;
}

export interface DraftingDeps {
  db: DraftingDb;
  /** The drafter for the job's pinned provider, model and prompt, or null when none may run here. */
  drafterFor(spec: DrafterSpec): LlmDrafter | null;
  log: Logger;
  /** How long the drafter may take (default DRAFT_TIMEOUT_MS). */
  timeoutMs?: number | undefined;
}

export type DraftOutcome = 'completed' | 'failed' | 'skipped';

export const DRAFT_TIMEOUT_MS = 60_000;

const clampDiscarded = (n: number, count: number): number => Math.max(0, Math.min(n, count));

const sameDifficulty = (stored: string, sent: number): boolean =>
  Math.round(Number(stored) * 100) === Math.round(sent * 100);

const matches = (m: AuthoringQueueMessage, j: DraftJobRow): boolean =>
  j.workspace_id.toLowerCase() === m.workspaceId.toLowerCase() &&
  j.format === m.format &&
  j.skill_key === m.skillKey &&
  sameDifficulty(j.difficulty, m.difficulty) &&
  j.count === m.count;

/**
 * Ends a queued or running job as failed in its own transaction. Returns false when the job is not in the job org or
 * already ended. Used by the handler and by the consumer on a message's last try.
 */
export const failDraftJob = (
  msg: Pick<AuthoringQueueMessage, 'jobId' | 'orgId'>,
  deps: Pick<DraftingDeps, 'db' | 'log'>,
  errorCode: AiDraftErrorCode,
  discarded = 0,
): Promise<boolean> =>
  deps.db.run(msg.orgId, async (s) => {
    const job = await s.lockJob(msg.jobId);
    if (job === null || (job.status !== 'queued' && job.status !== 'running')) return false;
    await s.finish(job.id, {
      status: 'failed',
      errorCode,
      discarded: clampDiscarded(discarded, job.count),
    });
    deps.log.warn('drafting.job_failed', { jobId: job.id, errorCode });
    return true;
  });

type Claim =
  | { kind: 'missing' }
  | { kind: 'settled' }
  | { kind: 'mismatch' }
  | { kind: 'run'; job: DraftJobRow };

const claimJob = (msg: AuthoringQueueMessage, deps: DraftingDeps): Promise<Claim> =>
  deps.db.run(msg.orgId, async (s): Promise<Claim> => {
    const job = await s.lockJob(msg.jobId);
    if (job === null) return { kind: 'missing' };
    if (job.status === 'completed' || job.status === 'failed' || (await s.keyExists(job.id))) {
      return { kind: 'settled' };
    }
    if (!matches(msg, job)) {
      await s.finish(job.id, { status: 'failed', errorCode: 'internal', discarded: 0 });
      return { kind: 'mismatch' };
    }
    if (job.status === 'queued') await s.claim(job.id);
    return { kind: 'run', job: { ...job, status: 'running' } };
  });

type Drafted = { ok: true; result: DraftResult } | { ok: false; code: AiDraftErrorCode };

const callDrafter = async (
  drafter: LlmDrafter,
  req: DraftRequest,
  timeoutMs: number,
): Promise<Drafted> => {
  const ac = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
      reject(new Error('drafter_timeout'));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([drafter.draft(req, { signal: ac.signal }), expired]);
    return { ok: true, result };
  } catch {
    // The drafter's error text is never kept: it may echo the request.
    return { ok: false, code: timedOut ? 'timeout' : 'drafter_error' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/** The answer's items when it is a result of the pinned model and prompt; null otherwise (bad_output). */
const itemsOf = (result: unknown, job: DraftJobRow): readonly unknown[] | null => {
  if (typeof result !== 'object' || result === null) return null;
  const { items, modelId, promptVersion } = result as Record<string, unknown>;
  if (!Array.isArray(items) || modelId !== job.model_id || promptVersion !== job.prompt_version) {
    return null;
  }
  return items as readonly unknown[];
};

const trimmed = (item: DraftedMcqItem): DraftedMcqItem => ({
  format: 'mcq',
  stem: item.stem.trim(),
  options: item.options.map((o) => ({ id: o.id, text: o.text.trim() })),
  correctOptionId: item.correctOptionId,
});

const store = (
  msg: AuthoringQueueMessage,
  deps: DraftingDeps,
  items: readonly unknown[],
): Promise<DraftOutcome> =>
  deps.db.run(msg.orgId, async (s): Promise<DraftOutcome> => {
    const job = await s.lockJob(msg.jobId);
    if (job?.status !== 'running' || (await s.keyExists(job.id))) return 'skipped';
    const room = Math.max(0, job.count - (await s.storedDrafts(job.id)));
    const { candidates } = preScreen(items, job.format);
    const lookups = candidates
      .filter((c) => c.item.format === 'mcq')
      .map((c) => normaliseText(c.item.stem));
    const existing = await s.existingStems(lookups);
    const approved =
      job.format === 'mcq' ? await s.approvedStems(job.skill_key, DRAFT_LIMITS.maxComparisons) : [];
    const screened = screenDrafts(items, { format: job.format, existing, approved, room });
    for (let i = 0; i < screened.accepted.length; i++) {
      const item = trimmed(screened.accepted[i]!);
      await s.insertDraft(job, {
        itemId: await draftItemId(job.id, screened.positions[i]!),
        item,
        contentSha256: await itemContentSha256({
          format: 'mcq',
          stem: item.stem,
          options: item.options,
          media: null,
          paramSpec: null,
        }),
      });
    }
    const created = await s.storedDrafts(job.id);
    const discarded = clampDiscarded(screened.discarded, job.count);
    if (created > 0) {
      await s.finish(job.id, { status: 'completed', discarded });
      deps.log.info('drafting.job_completed', {
        jobId: job.id,
        draftsCreated: created,
        draftsDiscarded: discarded,
      });
      return 'completed';
    }
    await s.finish(job.id, { status: 'failed', errorCode: 'no_draft_passed', discarded });
    deps.log.warn('drafting.job_failed', { jobId: job.id, errorCode: 'no_draft_passed' });
    return 'failed';
  });

const ended = async (
  msg: AuthoringQueueMessage,
  deps: DraftingDeps,
  code: AiDraftErrorCode,
): Promise<DraftOutcome> => ((await failDraftJob(msg, deps, code)) ? 'failed' : 'skipped');

/** Runs one drafting job to its end. Throws only on database errors (the message is then retried). */
export const handleDraftMessage = async (
  msg: AuthoringQueueMessage,
  deps: DraftingDeps,
): Promise<DraftOutcome> => {
  const claim = await claimJob(msg, deps);
  if (claim.kind === 'missing') {
    deps.log.warn('drafting.job_not_found', { jobId: msg.jobId });
    return 'skipped';
  }
  if (claim.kind === 'settled') {
    deps.log.info('drafting.job_already_settled', { jobId: msg.jobId });
    return 'skipped';
  }
  if (claim.kind === 'mismatch') {
    deps.log.error('drafting.message_mismatch', { jobId: msg.jobId });
    return 'failed';
  }
  const { job } = claim;

  let drafter: LlmDrafter | null;
  try {
    drafter = deps.drafterFor({
      provider: job.provider,
      modelId: job.model_id,
      promptVersion: job.prompt_version,
      seed: await jobSeed(job.id),
    });
  } catch {
    drafter = null;
  }
  if (drafter === null) return ended(msg, deps, 'drafter_error');

  const drafted = await callDrafter(
    drafter,
    {
      format: job.format,
      skill: job.skill_key,
      difficulty: Number(job.difficulty),
      count: job.count,
      // Scrubbed by the api before enqueue (§6.4); scrubbed again here (defence in depth, idempotent).
      topic: scrubDraftTopic(msg.topic),
    },
    deps.timeoutMs ?? DRAFT_TIMEOUT_MS,
  );
  if (!drafted.ok) return ended(msg, deps, drafted.code);
  const items = itemsOf(drafted.result, job);
  if (items === null) return ended(msg, deps, 'bad_output');
  return store(msg, deps, items);
};
