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
  /** The three stages. Stream R2 implements them; until then notImplementedStages. */
  stages: Stages;
  /** The database part of the sweep: private.sweep_pending(limit). */
  pendingStages(limit: number): Promise<readonly PendingStage[]>;
  /** Where log lines go. Defaults to the logger's own sink (console). Tests inject their own. */
  sink?: ((line: string) => void) | undefined;
}

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
    await processBatch(batch, { stages: deps.stages, log, reporter: deps.reporter, release });
  },

  scheduled: async (_controller, env, ctx) => {
    const queue = env.MIRROR_QUEUE;
    const evidence = env.EVIDENCE;
    if (queue === undefined || evidence === undefined) throw new Error(BINDING_UNAVAILABLE);
    const { log } = loggerFor(env, deps.sink);
    const run = runSweep({
      pendingStages: deps.pendingStages,
      readMirror: r2TextReader(evidence),
      send: queueSender(queue),
      log,
    });
    // The invocation stays alive until the sweep ends. The rejection is not swallowed: awaiting
    // `run` hands it to the error-reporting wrapper, so a failed sweep is reported once.
    ctx.waitUntil(run.catch(() => undefined));
    await run;
  },
});
