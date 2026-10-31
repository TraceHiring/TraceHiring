// The queue() and scheduled() entrypoints of the jobs Worker (spec d1 §5.1, §7.1), built from injected
// parts so they can be tested without a queue, a bucket or a database. index.ts (lead-wired) passes
// the real ones and wraps the result with withErrorReporting. Neutral code (rule 1).
//
// Every binding in the generated Env is optional (spec §11 "Binding rules"): the sweep needs both
// MIRROR_QUEUE and EVIDENCE and fails closed without them (a constant error, which is reported and
// retried by the next cron tick), never a `!`. The consumer needs neither today: its stages are
// injected and stream R2 brings their own bindings.
import { resolveVersion } from '@trace/shared';
import { createLogger, type ErrorReporter, type Logger } from '@trace/shared/log';
import { processBatch, type Stages } from './consumer.js';
import { queueSender, r2TextReader, runSweep, type PendingStage } from './sweep.js';

const SERVICE = 'jobs';

/** The constant message thrown when a binding the handler needs is not configured. */
export const BINDING_UNAVAILABLE = 'binding_unavailable';

export interface QueueHandlerDeps {
  /** Where stage errors are reported (the Sentry adapter in production). */
  reporter: ErrorReporter;
  /**
   * The three stages, or a factory that builds them from the invocation's env (their database secrets and the
   * evidence bucket are bindings). Placeholder: notImplementedStages.
   */
  stages: Stages | ((env: Env) => Stages);
  /** The database part of the sweep: private.sweep_pending(limit), with the invocation's env. */
  pendingStages(limit: number, env: Env): Promise<readonly PendingStage[]>;
  /**
   * The stranded drafting-job sweep (R5-64 m), run on every tick beside the mirror sweep and independent of its
   * bindings. Absent: not run.
   */
  draftSweep?: ((env: Env) => Promise<unknown>) | undefined;
  /**
   * The messaging claim stage (M2 R5-9: claim_due_messages and close_due_drives, then the ids to trace-messages),
   * run on every tick beside the sweeps. Absent: not run (stream B3 wires it).
   */
  messagesClaim?: ((env: Env) => Promise<unknown>) | undefined;
  /** Where log lines go. Defaults to the logger's own sink (console). Tests inject their own. */
  sink?: ((line: string) => void) | undefined;
}

/** Settles every task; then throws the first rejection, if any (each task has run to its end). */
const allOrFirstError = async (tasks: readonly Promise<unknown>[]): Promise<void> => {
  const settled = await Promise.allSettled(tasks);
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failed !== undefined) throw failed.reason;
};

export interface QueueHandlers {
  queue: ExportedHandlerQueueHandler<Env, unknown>;
  scheduled: ExportedHandlerScheduledHandler<Env>;
}

const loggerFor = (env: Env, sink: QueueHandlerDeps['sink']): { log: Logger; release: string } => {
  const release = resolveVersion(env.VERSION);
  return {
    release,
    log: createLogger({
      service: SERVICE,
      version: release,
      ...(sink === undefined ? {} : { sink }),
    }),
  };
};

export const createQueueHandlers = (deps: QueueHandlerDeps): QueueHandlers => ({
  queue: async (batch, env) => {
    const { log, release } = loggerFor(env, deps.sink);
    const stages = typeof deps.stages === 'function' ? deps.stages(env) : deps.stages;
    await processBatch(batch, { stages, log, reporter: deps.reporter, release });
  },

  scheduled: async (_controller, env, ctx) => {
    const mirrorSweep = async (): Promise<void> => {
      const queue = env.MIRROR_QUEUE;
      const evidence = env.EVIDENCE;
      if (queue === undefined || evidence === undefined) throw new Error(BINDING_UNAVAILABLE);
      const { log } = loggerFor(env, deps.sink);
      await runSweep({
        pendingStages: (limit) => deps.pendingStages(limit, env),
        readMirror: r2TextReader(evidence),
        send: queueSender(queue),
        log,
      });
    };
    const { draftSweep, messagesClaim } = deps;
    const run = allOrFirstError([
      mirrorSweep(),
      ...(draftSweep === undefined ? [] : [draftSweep(env)]),
      ...(messagesClaim === undefined ? [] : [messagesClaim(env)]),
    ]);
    // The invocation stays alive until every task ends. The rejection is not swallowed: awaiting
    // `run` hands it to the error-reporting wrapper, so a failed sweep is reported once.
    ctx.waitUntil(run.catch(() => undefined));
    await run;
  },
});
