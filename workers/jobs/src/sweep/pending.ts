// The database part of the sweep (spec d1 §5.1 "Sweep (L-18)", §3.4): private.sweep_pending(p_limit), called as
// trace_worker (the only role with EXECUTE). The function is a STABLE DEFINER that reads public tables of every org
// and returns (org_id, session_id, ruleset_version_id, stage); no trace.job_org_id is needed for it. The rows go to
// queue/sweep.ts runSweep, which validates each one, reads the session's mirror.json and re-enqueues it.
// Neutral code (rule 1): stage names and ids only.
import type { SqlTx } from '@trace/shared/jobs';
import type { PendingStage } from '../queue/sweep.js';

export const SWEEP_SQL =
  'select org_id::text as org_id, session_id::text as session_id, ruleset_version_id::text as ruleset_version_id, ' +
  'stage from private.sweep_pending($1::int)';

/** The most rows one call may ask for. */
export const MAX_SWEEP_LIMIT = 500;

interface Row {
  org_id: string;
  session_id: string;
  ruleset_version_id: string;
  stage: string;
}

/**
 * Rows of private.sweep_pending, in its order, as runSweep's PendingStage shape. runSweep parses every row again
 * (a malformed row is skipped and logged there without its content), so the cast below never reaches a send.
 */
export const sweepPending = async (tx: SqlTx, limit: number): Promise<PendingStage[]> => {
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_SWEEP_LIMIT)
    throw new Error('sweep_bad_limit');
  const rows = await tx.query<Row>(SWEEP_SQL, [limit]);
  return rows.map(
    (r) =>
      ({
        orgId: r.org_id,
        sessionId: r.session_id,
        rulesetVersionId: r.ruleset_version_id,
        stage: r.stage,
      }) as PendingStage,
  );
};
