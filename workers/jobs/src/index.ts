// Worker entrypoint: a thin adapter over createApp (fetch: /health), the session-mirror queue consumer
// (queue) and the sweep cron (scheduled); lead-wired (spec d1 §11).
// Errors from all three go to Sentry through the shared adapter, and only when SENTRY_DSN_WORKERS
// holds a DSN (spec m0-foundations §9.2; d1 AT-D22).
// The stages (stream R2) are built per invocation from its env (queue/wiring.ts): each runs in its own
// transaction as its own worker role; a missing secret or binding fails closed, so the message is retried and
// then dead-lettered, never acked without its results. The sweep runs private.sweep_pending as trace_worker.
import { createApp } from './app.js';
import { sentryReporter, withErrorReporting } from './error-reporting.js';
import { createQueueHandlers } from './queue/handlers.js';
import { pendingStagesFor, stagesFor } from './queue/wiring.js';

const app = createApp({ reporter: sentryReporter });

const { queue, scheduled } = createQueueHandlers({
  reporter: sentryReporter,
  stages: (env) => stagesFor(env),
  pendingStages: (limit, env) => pendingStagesFor(limit, env),
});

export default withErrorReporting({
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  queue,
  scheduled,
}) satisfies ExportedHandler<Env>;
