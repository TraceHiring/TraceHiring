// The real stages and the sweep's database part, built from the invocation env (spec d1 §5.1, §11). Neutral,
// lead-wired code: index.ts hands these to createQueueHandlers. Each stage opens its own connection as its own
// worker role (withStageConnection) with the message's org as the job org; the sweep runs as trace_worker with no
// org (private.sweep_pending reads every org and returns ids only). Every missing binding or secret fails closed with
// a constant error, so the message is retried and then dead-lettered, never acked without its results.
// M1 R5-13: dispatchQueue routes each batch to the consumer of its queue (mirror, AI drafting, member provisioning).
import type { EvidenceReader, SqlTx } from '@trace/shared/jobs';
import { MockLlmGrader, type LlmGrader } from '@trace/vendors';
import { createStages } from '../mirror/pipeline.js';
import { sweepPending } from '../sweep/pending.js';
import type { Stages } from './consumer.js';
import { r2EvidenceReader } from './evidence.js';
import { BINDING_UNAVAILABLE } from './handlers.js';
import { withStageConnection, type StageDbName } from './stage-db.js';
import type { PendingStage } from './sweep.js';

/** The constant error of the grader in production: the mock never grades there; real adapters are M5. */
export const GRADER_UNAVAILABLE = 'grader_unavailable';

/** How a stage gets its transaction; withStageConnection in production, a fake in tests. */
export type OpenStage = <T>(
  env: Env,
  stage: StageDbName,
  orgId: string | null,
  fn: (tx: SqlTx) => Promise<T>,
) => Promise<T>;

const unavailable = (): Promise<never> => Promise.reject(new Error(BINDING_UNAVAILABLE));

/** The evidence reader when the EVIDENCE binding is not configured: every read fails closed. */
export const unavailableEvidence: EvidenceReader = { get: unavailable, head: unavailable };

/** The mock grader outside production only (as the mock Messaging, L-11). */
export const graderFor = (env: Env): LlmGrader =>
  env.TRACE_ENV === 'production'
    ? { grade: () => Promise.reject(new Error(GRADER_UNAVAILABLE)) }
    : new MockLlmGrader();

export const stagesFor = (env: Env, open: OpenStage = withStageConnection): Stages =>
  createStages({
    db: { run: (stage, orgId, fn) => open(env, stage, orgId, fn) },
    evidence: env.EVIDENCE === undefined ? unavailableEvidence : r2EvidenceReader(env.EVIDENCE),
    grader: graderFor(env),
  });

export const pendingStagesFor = (
  limit: number,
  env: Env,
  open: OpenStage = withStageConnection,
): Promise<PendingStage[]> => open(env, 'sweep', null, (tx) => sweepPending(tx, limit));

// ---- queue dispatch (specs/m1-test-authoring.md R5-13) ----

/** The consumers of the jobs Worker: the D1 session mirror, the M1 AI drafting job and member provisioning. */
export type QueueKind = 'mirror' | 'drafting' | 'members';

/** One queue's consumer: the same signature as the Worker's queue() handler. */
export type QueueConsumer = (
  batch: MessageBatch<unknown>,
  env: Env,
  ctx: ExecutionContext,
) => void | Promise<void>;

/**
 * Queue base names (`<name>-<env>`, scripts/ensure-staging-resources.mjs) and their consumers. A dead-letter queue
 * (`<name>-dlq-<env>`) has no consumer here.
 */
export const QUEUE_KINDS: Readonly<Record<string, QueueKind>> = Object.freeze({
  'trace-session-mirror': 'mirror',
  'trace-authoring': 'drafting',
  'trace-admin': 'members',
});

/** The constant error for a batch from a queue this Worker does not consume. */
export const UNKNOWN_QUEUE = 'unknown_queue';

const QUEUE_NAME = /^([a-z]+(?:-[a-z]+)*)-([a-z]+)$/;

/** The consumer kind of a queue name `<name>-<env>` (env one lower-case word), or null for any other name. */
export const queueKindOf = (queue: string): QueueKind | null => {
  const m = QUEUE_NAME.exec(queue);
  if (m?.[1] === undefined || !Object.hasOwn(QUEUE_KINDS, m[1])) return null;
  return QUEUE_KINDS[m[1]] ?? null;
};

/**
 * The Worker's queue() handler: each batch goes to the one consumer of its queue (`batch.queue`). An unknown queue
 * throws a constant error and touches no message, so its messages are retried and then dead-lettered, never acked.
 */
export const dispatchQueue =
  (consumers: Readonly<Record<QueueKind, QueueConsumer>>): QueueConsumer =>
  async (batch, env, ctx) => {
    const kind = queueKindOf(batch.queue);
    if (kind === null) throw new Error(UNKNOWN_QUEUE);
    await consumers[kind](batch, env, ctx);
  };
