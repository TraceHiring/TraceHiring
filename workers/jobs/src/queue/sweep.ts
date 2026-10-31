// Sweep (spec d1 §5.1 "Sweep (L-18)", §7.1). Neutral code (rule 1): it knows no score, band or SQL.
// Every minute the cron asks the database which sessions still miss a stage (pendingStages, backed by
// private.sweep_pending in stream R2), reads each session's mirror.json from R2 (written by the
// SessionDO at submit) and re-enqueues that message on the mirror queue. The consumer then runs the
// same pipeline, and every stage skips what its idempotency key already records. This recovers a lost
// enqueue, a failed queue send, a lost mirror and a quality card that arrived late.
// Logs carry constant event names and ids only: never the file content.
import { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import type { Logger } from '@trace/shared/log';
import { z } from 'zod';

/** How many pending rows one sweep asks for. */
export const DEFAULT_SWEEP_LIMIT = 50;

/** What private.sweep_pending returns for a row (spec §3.4). */
export const PendingStage = z.strictObject({
  orgId: z.uuid(),
  sessionId: z.uuid(),
  rulesetVersionId: z.uuid(),
  stage: z.enum(['session_mirror', 'quality_score', 'integrity_band']),
});
export type PendingStage = z.infer<typeof PendingStage>;

export interface SweepDeps {
  /** The database part: private.sweep_pending(limit). */
  pendingStages(limit: number): Promise<readonly PendingStage[]>;
  /** The text of an R2 evidence object, or null when the key does not exist. */
  readMirror(key: string): Promise<string | null>;
  /** The queue producer: sends one mirror message. */
  send(message: SessionMirrorMessage): Promise<void>;
  log: Logger;
  /** Rows per sweep. Defaults to DEFAULT_SWEEP_LIMIT. */
  limit?: number;
}

export interface SweepResult {
  /** Rows the database returned. */
  pending: number;
  /** Messages sent to the queue. */
  enqueued: number;
  /** Rows skipped: malformed row, missing, invalid or mismatching mirror.json. */
  skipped: number;
}

/** The constant message of the placeholder database part. */
export const NOT_IMPLEMENTED_SWEEP = 'sweep_not_implemented';

/** Placeholder until stream R2 backs it with private.sweep_pending. */
export const notImplementedPendingStages: SweepDeps['pendingStages'] = () =>
  Promise.reject(new Error(NOT_IMPLEMENTED_SWEEP));

/** An R2 bucket as a text reader: the object's text, or null when the key is absent. */
export const r2TextReader =
  (bucket: R2Bucket) =>
  async (key: string): Promise<string | null> => {
    const object = await bucket.get(key);
    return object === null ? null : object.text();
  };

/** Wraps a Queue producer as the sweep's `send`. */
export const queueSender =
  (queue: Queue) =>
  async (message: SessionMirrorMessage): Promise<void> => {
    await queue.send(message, { contentType: 'json' });
  };

/** The R2 key of a session's mirror message (spec §4.4). Ids are UUIDs, validated before this. */
const mirrorKey = (row: PendingStage): string =>
  `sessions/${row.orgId}/${row.sessionId}/mirror.json`;

/**
 * Runs one sweep. A skipped row is logged and does not stop the others. A failed R2 read or queue
 * send is logged, the sweep carries on, and the call then throws the constant `sweep_enqueue_failed`
 * so the failure is reported; the next minute's sweep tries again. A pendingStages failure is thrown
 * as it is.
 */
export const runSweep = async (deps: SweepDeps): Promise<SweepResult> => {
  const { log } = deps;
  const rows = await deps.pendingStages(deps.limit ?? DEFAULT_SWEEP_LIMIT);
  const result: SweepResult = { pending: rows.length, enqueued: 0, skipped: 0 };
  const seen = new Set<string>();
  let failed = 0;

  for (const candidate of rows) {
    const parsedRow = PendingStage.safeParse(candidate);
    if (!parsedRow.success) {
      // Nothing of the row is logged: an id that is not a UUID is not an id.
      log.warn('sweep.row_invalid');
      result.skipped++;
      continue;
    }
    const row = parsedRow.data;

    // One message per (session, ruleset): its stages are all re-run from the same message.
    const dedupe = `${row.orgId}:${row.sessionId}:${row.rulesetVersionId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const ids = { sessionId: row.sessionId, stage: row.stage };
    try {
      const text = await deps.readMirror(mirrorKey(row));
      if (text === null) {
        log.warn('sweep.mirror_missing', ids, { orgId: row.orgId });
        result.skipped++;
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      const message = SessionMirrorMessage.safeParse(json);
      if (!message.success) {
        log.warn('sweep.mirror_invalid', ids, { orgId: row.orgId });
        result.skipped++;
        continue;
      }
      if (
        message.data.sessionId !== row.sessionId ||
        message.data.orgId !== row.orgId ||
        message.data.rulesetVersionId !== row.rulesetVersionId
      ) {
        log.warn('sweep.mirror_mismatch', ids, { orgId: row.orgId });
        result.skipped++;
        continue;
      }
      await deps.send(message.data);
      result.enqueued++;
    } catch (err) {
      log.error('sweep.enqueue_failed', ids, { err, orgId: row.orgId });
      failed++;
    }
  }

  if (rows.length > 0) log.info('sweep.completed', { ...result, failed });
  if (failed > 0) throw new Error('sweep_enqueue_failed');
  return result;
};
