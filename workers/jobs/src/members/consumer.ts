// The consumer of the member provisioning queue `trace-admin-<env>` (specs/m1-test-authoring.md R5-13, M1-20). It
// replaces members/stub.ts when the lead wires it (`createMembersConsumer((env) => membersDepsFor(env))`). Per message:
//   - malformed (not an AdminQueueMessage, e.g. one that names roles): ack and log a constant event, never the body;
//   - the invite was provisioned, failed or skipped: ack;
//   - an error (pepper, Auth API, database): retry; on the last try (FINAL_ATTEMPT) settle the invite as failed and
//     ack when that worked, so an invite never stays pending behind a dead-lettered message.
// Errors are logged with the invite id and the SQLSTATE only and reported as a constant error: an Auth or driver error
// can echo the address.
import { AdminQueueMessage } from '@trace/shared/contracts/m1';
import { reportError, type ErrorReporter } from '@trace/shared/log';
import { failInvite, handleInviteMessage, type MembersDeps } from './provision.js';

/** The delivery that is the queue's last: the first try plus max_retries (5, workers/jobs/wrangler.jsonc). */
export const FINAL_ATTEMPT = 6;

export const MEMBER_INVITE_JOB_ERROR = 'member_invite_job_error';

export interface MembersConsumerDeps extends MembersDeps {
  reporter?: ErrorReporter | undefined;
  release?: string | undefined;
}

export type MembersConsumer = (
  batch: MessageBatch<unknown>,
  env: Env,
  ctx: ExecutionContext,
) => Promise<void>;

const sqlStateOf = (err: unknown): string => {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : null;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'none';
};

const settle = async (
  raw: Message<unknown>,
  msg: AdminQueueMessage,
  deps: MembersConsumerDeps,
): Promise<void> => {
  try {
    await handleInviteMessage(msg, deps);
    raw.ack();
    return;
  } catch (err) {
    deps.log.error('members.invite_error', {
      inviteId: msg.inviteId,
      sqlstate: sqlStateOf(err),
      attempt: raw.attempts,
    });
    if (deps.reporter !== undefined) {
      reportError(
        deps.reporter,
        Object.assign(new Error(MEMBER_INVITE_JOB_ERROR), { code: MEMBER_INVITE_JOB_ERROR }),
        deps.release === undefined ? undefined : { release: deps.release },
      );
    }
  }
  if (raw.attempts >= FINAL_ATTEMPT) {
    try {
      await failInvite(msg, deps, 'retries_exhausted');
      raw.ack();
      return;
    } catch (err) {
      deps.log.error('members.invite_end_failed', {
        inviteId: msg.inviteId,
        sqlstate: sqlStateOf(err),
      });
    }
  }
  raw.retry();
};

export const createMembersConsumer =
  (deps: MembersConsumerDeps | ((env: Env) => MembersConsumerDeps)): MembersConsumer =>
  async (batch, env) => {
    const d = typeof deps === 'function' ? deps(env) : deps;
    for (const raw of batch.messages) {
      const parsed = AdminQueueMessage.safeParse(raw.body);
      if (!parsed.success) {
        d.log.warn('members.message_invalid');
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
