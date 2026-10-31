// The consumer of the AI drafting queue `trace-authoring-<env>` (specs/m1-test-authoring.md §6.4, R5-13): a stub
// until stream A3 replaces this file with the real job (role trace_authoring_worker). It acks nothing and throws a
// constant error, so every message is retried and then dead-lettered to `trace-authoring-dlq-<env>`; a draft job is
// never silently dropped.

/** The constant error of the stub (no message content, no ids). */
export const DRAFTING_NOT_IMPLEMENTED = 'drafting_not_implemented_until_stream_a3';

/** A queue() consumer (batch, env, ctx) that reads none of its arguments. */
export const draftingConsumer = (): Promise<never> =>
  Promise.reject(new Error(DRAFTING_NOT_IMPLEMENTED));
