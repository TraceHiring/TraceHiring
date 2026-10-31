// The one pipeline both mirror transports feed (spec d1 §5.1, AT-D27, OPEN-9). Neutral code: it wires the three
// stage entry points to their own transactions and hands every message, whatever its transport, to the same
// queue/consumer.ts processBatch, so ordering (mirror -> quality -> integrity), retries and logging are shared.
//   - `queue` transport: the Worker's queue() handler calls processBatch with the delivered batch (lead-wired).
//   - `service` transport (only if DC-D2 picks it): deliverViaService wraps one body as a one-message batch and
//     answers 'ack' or 'retry' to the caller (the SessionDO alarm retries on 'retry').
// Each stage runs in its own transaction as its own worker role; StageDb is that seam (the lead's implementation
// opens jobs_<stage>_login, BEGIN, SET LOCAL ROLE, set_config('trace.job_org_id', org, true), COMMIT).
import type { EvidenceReader, SqlTx } from '@trace/shared/jobs';
import type { LlmGrader } from '@trace/vendors';
import { runIntegrity } from '../integrity/handler.js';
import { runQuality } from '../quality/handler.js';
import { processBatch, type ConsumerDeps, type StageName, type Stages } from '../queue/consumer.js';
import { runMirror } from './handler.js';

/** Opens one transaction for `stage` as its worker role with trace.job_org_id = orgId, commits if fn resolves. */
export interface StageDb {
  run<T>(stage: StageName, orgId: string, fn: (tx: SqlTx) => Promise<T>): Promise<T>;
}

export interface StageDeps {
  db: StageDb;
  evidence: EvidenceReader;
  grader: LlmGrader;
}

/** The real stages for queue/consumer.ts. Quality never receives the evidence bucket; integrity never the grader. */
export const createStages = (deps: StageDeps): Stages => ({
  mirror: (m) =>
    deps.db.run('mirror', m.orgId, (tx) => runMirror(m, { tx, evidence: deps.evidence })),
  quality: (m) =>
    deps.db.run('quality', m.orgId, (tx) => runQuality(m, { tx, grader: deps.grader })),
  integrity: (m) =>
    deps.db.run('integrity', m.orgId, (tx) => runIntegrity(m, { tx, evidence: deps.evidence })),
});

export type Delivery = 'ack' | 'retry';

/** The `service` transport: one body through the same processBatch the queue uses. */
export const deliverViaService = async (body: unknown, deps: ConsumerDeps): Promise<Delivery> => {
  let outcome: Delivery = 'retry';
  const message: Message<unknown> = {
    id: 'service',
    timestamp: new Date(0),
    body,
    attempts: 1,
    ack() {
      outcome = 'ack';
    },
    retry() {
      outcome = 'retry';
    },
  };
  const batch: MessageBatch<unknown> = {
    messages: [message],
    queue: 'service',
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    retryAll() {},
    ackAll() {},
  };
  await processBatch(batch, deps);
  return outcome;
};
