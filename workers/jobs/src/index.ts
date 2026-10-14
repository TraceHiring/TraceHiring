// Worker entrypoint: a thin adapter over createApp (spec §2).
// Errors go to Sentry through the shared adapter, and only when SENTRY_DSN_WORKERS
// holds a DSN (spec m0-foundations §9.2; d1 AT-D22).
import { createApp } from './app.js';
import { sentryReporter, withErrorReporting } from './error-reporting.js';

const app = createApp({ reporter: sentryReporter });

export default withErrorReporting({
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
}) satisfies ExportedHandler<Env>;
