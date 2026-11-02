// The real stages and the sweep's database part, built from the invocation env (spec d1 §5.1, §11). Neutral,
// lead-wired code: index.ts hands these to createQueueHandlers. Each stage opens its own connection as its own
// worker role (withStageConnection) with the message's org as the job org; the sweep runs as trace_worker with no
// org (private.sweep_pending reads every org and returns ids only). Every missing binding or secret fails closed with
// a constant error, so the message is retried and then dead-lettered, never acked without its results.
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
