// The consumer of the member provisioning queue `trace-admin-<env>` (specs/m1-test-authoring.md M1-20, R5-13): a
// stub until stream A3 replaces this file with the real job (role trace_admin_worker). It acks nothing and throws a
// constant error, so every message is retried and then dead-lettered to `trace-admin-dlq-<env>`; an invite job is
// never silently dropped.

/** The constant error of the stub (no message content, no ids, no address). */
export const MEMBERS_NOT_IMPLEMENTED = 'members_not_implemented_until_stream_a3';

/** A queue() consumer (batch, env, ctx) that reads none of its arguments. */
export const membersConsumer = (): Promise<never> =>
  Promise.reject(new Error(MEMBERS_NOT_IMPLEMENTED));
