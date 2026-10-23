// The stranded drafting-job sweep (specs/m1-test-authoring.md R5-64 m; migration M1-n). A drafting job whose queue
// message was never sent stays queued and no org role may fail it; the topic text is not stored (§6.4), so it cannot
// be re-enqueued. Every cron tick calls private.fail_stranded_ai_draft_jobs once on the authoring_sweep stage (the
// authoring login as trace_authoring_worker, no job org): queued jobs older than 15 minutes fail with `timeout`, and
// the database audits each. Logs carry the count only.
import type { SqlTx } from '@trace/shared/jobs';
import { createLogger, type Logger } from '@trace/shared/log';
import { resolveVersion } from '@trace/shared';
import { withStageConnection } from '../queue/stage-db.js';
import type { OpenStage } from './wiring.js';

/** Jobs failed per tick at most (the function accepts 1..500). */
export const DRAFT_SWEEP_LIMIT = 100;

export const FAIL_STRANDED_SQL = 'select private.fail_stranded_ai_draft_jobs($1::int) as failed';

/** The constant error for a result that is not one non-negative integer count. */
export const DRAFT_SWEEP_BAD_RESULT = 'draft_sweep_bad_result';

export interface DraftSweepDeps {
  /** Runs `fn` in one transaction on the authoring_sweep stage. */
  run<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T>;
  log: Logger;
  limit?: number;
}

/** Runs one sweep and returns the number of jobs it failed. A database failure is thrown as it is. */
export const runDraftSweep = async (deps: DraftSweepDeps): Promise<number> => {
  const rows = await deps.run((tx) =>
    tx.query<{ failed: unknown }>(FAIL_STRANDED_SQL, [deps.limit ?? DRAFT_SWEEP_LIMIT]),
  );
  const failed = rows.length === 1 ? rows[0]?.failed : undefined;
  if (typeof failed !== 'number' || !Number.isInteger(failed) || failed < 0) {
    throw new Error(DRAFT_SWEEP_BAD_RESULT);
  }
  if (failed > 0) deps.log.warn('drafting.sweep_failed_stranded', { failed });
  return failed;
};

/** The production sweep for one cron tick (lead-wired in index.ts). */
export const draftSweepFor = (
  env: Env,
  open: OpenStage = withStageConnection,
  opts: { sink?: (line: string) => void } = {},
): Promise<number> =>
  runDraftSweep({
    run: (fn) => open(env, 'authoring_sweep', null, fn),
    log: createLogger({
      service: 'jobs',
      version: resolveVersion(env.VERSION),
      ...(opts.sink === undefined ? {} : { sink: opts.sink }),
    }),
  });
