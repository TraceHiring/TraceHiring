// The consumer of the messaging queue `trace-messages-<env>` (specs/m2-scheduling-invites.md §6.3, R5-9): a stub
// until stream B3 replaces this file with the real consumer (role trace_messaging_worker). Nothing produces to the
// queue before B3 wires the claim stage. It acks nothing and throws a constant error, so every message is retried
// and then dead-lettered to `trace-messages-dlq-<env>`; a message is never silently dropped.

/** The constant error of the stub (no message content, no ids). */
export const MESSAGES_NOT_IMPLEMENTED = 'messages_not_implemented_until_stream_b3';

/** A queue() consumer (batch, env, ctx) that reads none of its arguments. */
export const messagesConsumer = (): Promise<never> =>
  Promise.reject(new Error(MESSAGES_NOT_IMPLEMENTED));
