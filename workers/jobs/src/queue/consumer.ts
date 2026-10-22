// Queue consumer for trace-session-mirror-<env> (spec d1 §5.1). Neutral code (rule 1): it knows
// nothing of scores, bands or SQL. Per message it runs three injected stages in order,
// mirror -> quality -> integrity, and settles the message:
//   - invalid message: ack and log (constant event, no payload); retrying could never fix it;
//   - mirror fails: nothing else runs, retry();
//   - quality fails: integrity still runs (it finds no quality card), then retry();
//   - integrity fails: retry();
//   - all succeed: ack().
// Each stage is idempotent under its own key, so a retry re-runs only what is missing. After the
// queue's max_retries (5) the message goes to the DLQ. Stage errors are logged by stage name and ids
// only and reported through reportError (serialised and redacted); a message body never reaches a log.
import { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { reportError, type ErrorReporter, type Logger } from '@trace/shared/log';

export type StageName = 'mirror' | 'quality' | 'integrity';

/** The three stages, injected. Stream R2 implements them; each opens its own transaction. */
export interface Stages {
  mirror(message: SessionMirrorMessage): Promise<void>;
  quality(message: SessionMirrorMessage): Promise<void>;
  integrity(message: SessionMirrorMessage): Promise<void>;
}

/** The constant message of the placeholder stages. */
export const NOT_IMPLEMENTED = 'stage_not_implemented';

const notImplemented = (): Promise<void> => Promise.reject(new Error(NOT_IMPLEMENTED));

/**
 * Placeholder until stream R2 lands. Every stage throws, so a deploy before R2 sends each message to
 * retry and then the DLQ instead of silently acking it.
 */
export const notImplementedStages: Stages = {
  mirror: notImplemented,
  quality: notImplemented,
  integrity: notImplemented,
};

export interface ConsumerDeps {
  stages: Stages;
  log: Logger;
  /** Where stage errors are reported. Absent: they are only logged. */
  reporter?: ErrorReporter | undefined;
  /** The release label for reports (the build version). */
  release?: string | undefined;
}

/** Runs one stage and returns whether it succeeded. Never throws. */
const attempt = async (
  stage: StageName,
  message: SessionMirrorMessage,
  deps: ConsumerDeps,
): Promise<boolean> => {
  try {
    await deps.stages[stage](message);
    return true;
  } catch (err) {
    // Ids only: never the message text, the message body or anything else of the payload.
    deps.log.error(
      'queue.stage_failed',
      { stage, sessionId: message.sessionId },
      { err, orgId: message.orgId },
    );
    if (deps.reporter !== undefined) {
      reportError(
        deps.reporter,
        err,
        deps.release === undefined ? undefined : { release: deps.release },
      );
    }
    return false;
  }
};

/** Sessions handled side by side in one batch; each runs one stage (one connection) at a time, and Workers allow
 * six open connections per invocation. */
export const SESSION_CONCURRENCY = 4;

const settle = async (
  raw: Message<unknown>,
  message: SessionMirrorMessage,
  deps: ConsumerDeps,
): Promise<void> => {
  if (!(await attempt('mirror', message, deps))) {
    raw.retry();
    return;
  }
  const qualityOk = await attempt('quality', message, deps);
  const integrityOk = await attempt('integrity', message, deps);
  if (qualityOk && integrityOk) raw.ack();
  else raw.retry();
};

/**
 * Handles a batch: different sessions side by side (at most SESSION_CONCURRENCY at once), one session's messages
 * in arrival order, so a redelivered message never races its own session's stages. One message's failure never
 * affects another's. (On staging one message takes ~25 s; one at a time put the last of four sessions past the
 * 90 s AT-D17 limit, e2e-staging run 39791480658.)
 */
export const processBatch = async (
  batch: MessageBatch<unknown>,
  deps: ConsumerDeps,
): Promise<void> => {
  const lanes = new Map<string, { raw: Message<unknown>; message: SessionMirrorMessage }[]>();
  for (const raw of batch.messages) {
    const parsed = SessionMirrorMessage.safeParse(raw.body);
    if (!parsed.success) {
      // A malformed message can never become valid: ack so it is not retried forever, and log nothing of it.
      deps.log.warn('queue.message_invalid');
      raw.ack();
      continue;
    }
    const lane = lanes.get(parsed.data.sessionId) ?? [];
    lane.push({ raw, message: parsed.data });
    lanes.set(parsed.data.sessionId, lane);
  }
  const waiting = [...lanes.values()];
  const runLanes = async (): Promise<void> => {
    for (let lane = waiting.shift(); lane !== undefined; lane = waiting.shift()) {
      for (const { raw, message } of lane) await settle(raw, message, deps);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SESSION_CONCURRENCY, waiting.length) }, runLanes),
  );
};
