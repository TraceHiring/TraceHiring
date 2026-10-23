// The consumer of the AI drafting queue `trace-authoring-<env>` (specs/m1-test-authoring.md R5-13, §6.4). It replaces
// drafting/stub.ts when the lead wires it (`createDraftingConsumer((env) => draftingDepsFor(env))`). Per message:
//   - malformed (not an AuthoringQueueMessage): ack and log a constant event; retrying could never fix it;
//   - the job ran to an end, or there was nothing to do: ack;
//   - an error (the database): retry; on the last try (FINAL_ATTEMPT: 1 + the queue's max_retries 5) end the job
//     `internal` so it never stays running, and ack when that worked.
// Errors are logged with the job id and the SQLSTATE only, and reported as a constant error: a driver error can quote a
// row (a draft) in its detail, so it never reaches a log or a report.
import { AuthoringQueueMessage } from '@trace/shared/contracts/m1';
import { reportError, type ErrorReporter } from '@trace/shared/log';
import { failDraftJob, handleDraftMessage, type DraftingDeps } from './handler.js';

/** The delivery that is the queue's last: the first try plus max_retries (5, workers/jobs/wrangler.jsonc). */
export const FINAL_ATTEMPT = 6;

/** The constant error a report carries. */
export const DRAFTING_JOB_ERROR = 'drafting_job_error';

export interface DraftingConsumerDeps extends DraftingDeps {
  reporter?: ErrorReporter | undefined;
  release?: string | undefined;
}

/** A queue() consumer (batch, env, ctx), as queue/wiring.ts QueueConsumer. */
export type DraftingConsumer = (
  batch: MessageBatch<unknown>,
  env: Env,
  ctx: ExecutionContext,
) => Promise<void>;

/** The SQLSTATE of a driver error (five upper-case letters or digits), or null. */
export const sqlStateOf = (err: unknown): string | null => {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : null;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
};

const settle = async (
  raw: Message<unknown>,
  msg: AuthoringQueueMessage,
  deps: DraftingConsumerDeps,
): Promise<void> => {
  try {
    await handleDraftMessage(msg, deps);
    raw.ack();
    return;
  } catch (err) {
    deps.log.error('drafting.job_error', {
      jobId: msg.jobId,
      sqlstate: sqlStateOf(err) ?? 'none',
      attempt: raw.attempts,
    });
    if (deps.reporter !== undefined) {
      reportError(
        deps.reporter,
        Object.assign(new Error(DRAFTING_JOB_ERROR), { code: DRAFTING_JOB_ERROR }),
        deps.release === undefined ? undefined : { release: deps.release },
      );
    }
  }
  if (raw.attempts >= FINAL_ATTEMPT) {
    try {
      await failDraftJob(msg, deps, 'internal');
      raw.ack();
      return;
    } catch (err) {
      deps.log.error('drafting.job_end_failed', {
        jobId: msg.jobId,
        sqlstate: sqlStateOf(err) ?? 'none',
      });
    }
  }
  raw.retry();
};

/** The drafting consumer; `deps` may be built per invocation from its env (database logins, TRACE_ENV). */
export const createDraftingConsumer =
  (deps: DraftingConsumerDeps | ((env: Env) => DraftingConsumerDeps)): DraftingConsumer =>
  async (batch, env) => {
    const d = typeof deps === 'function' ? deps(env) : deps;
    // max_batch_size is 1 (wrangler.jsonc); any larger batch is still settled one message at a time.
    for (const raw of batch.messages) {
      const parsed = AuthoringQueueMessage.safeParse(raw.body);
      if (!parsed.success) {
        d.log.warn('drafting.message_invalid');
        raw.ack();
        continue;
      }
      try {
        await settle(raw, parsed.data, d);
      } catch {
        // ack()/retry() threw: the platform redelivers an unsettled message.
      }
    }
  };
