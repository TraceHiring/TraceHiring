// Worker entrypoint: a thin adapter over createApp (fetch: /health), the queue consumers (queue) and the sweep cron
// (scheduled); lead-wired (spec d1 §11; specs/m1-test-authoring.md R5-13).
// Errors from all three go to Sentry through the shared adapter, and only when SENTRY_DSN_WORKERS
// holds a DSN (spec m0-foundations §9.2; d1 AT-D22).
// queue() dispatches on the batch's queue (queue/wiring.ts dispatchQueue): the D1 session mirror, unchanged; the
// AI drafting and member provisioning queues, stubs until stream A3 that throw so their messages are retried and
// then dead-lettered; any other queue is an error.
// The stages (stream R2) are built per invocation from its env (queue/wiring.ts): each runs in its own
// transaction as its own worker role; a missing secret or binding fails closed, so the message is retried and
// then dead-lettered, never acked without its results. The sweep runs private.sweep_pending as trace_worker.
import { createApp } from './app.js';
import { draftingConsumer } from './drafting/stub.js';
import { sentryReporter, withErrorReporting } from './error-reporting.js';
import { membersConsumer } from './members/stub.js';
import { createQueueHandlers } from './queue/handlers.js';
import { dispatchQueue, pendingStagesFor, stagesFor } from './queue/wiring.js';

const app = createApp({ reporter: sentryReporter });

const { queue: mirrorQueue, scheduled } = createQueueHandlers({
  reporter: sentryReporter,
  stages: (env) => stagesFor(env),
  pendingStages: (limit, env) => pendingStagesFor(limit, env),
});

const queue = dispatchQueue({
  mirror: mirrorQueue,
  drafting: draftingConsumer,
  members: membersConsumer,
});

export default withErrorReporting({
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  queue,
  scheduled,
}) satisfies ExportedHandler<Env>;
