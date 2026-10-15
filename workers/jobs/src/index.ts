// Worker entrypoint: a thin adapter over createApp (fetch: /health), the session-mirror queue consumer
// (queue) and the sweep cron (scheduled); lead-wired (spec d1 §11).
// Errors from all three go to Sentry through the shared adapter, and only when SENTRY_DSN_WORKERS
// holds a DSN (spec m0-foundations §9.2; d1 AT-D22).
// Until stream R2 lands, the three stages and the sweep's database part are the "not implemented"
// placeholders: a queued message goes to retry and then the DLQ (never an ack), and the sweep fails
// visibly instead of doing nothing. R2 replaces `stages` and `pendingStages` below.
import { createApp } from './app.js';
import { sentryReporter, withErrorReporting } from './error-reporting.js';
import { notImplementedStages } from './queue/consumer.js';
import { createQueueHandlers } from './queue/handlers.js';
import { notImplementedPendingStages } from './queue/sweep.js';

const app = createApp({ reporter: sentryReporter });

const { queue, scheduled } = createQueueHandlers({
  reporter: sentryReporter,
  stages: notImplementedStages,
  pendingStages: notImplementedPendingStages,
});

export default withErrorReporting({
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  queue,
  scheduled,
}) satisfies ExportedHandler<Env>;
