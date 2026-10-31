// Worker entrypoint: a thin adapter over createApp (spec §2, ADR-027); module code lives in
// src/modules/. Errors go to Sentry through the shared adapter, and only when SENTRY_DSN_WORKERS
// holds a DSN (spec m0-foundations §9.2; d1 AT-D22).
import { createApp } from './app.js';
import { sentryReporter, withErrorReporting } from './error-reporting.js';

const app = createApp({ reporter: sentryReporter });

// The Durable Objects and the edge's service-binding entrypoint (specs/d1-demo-slice.md §4.2, §4.5);
// index exports only these and the default handler.
export { CandidateRpc } from './modules/candidate/candidate-rpc.js';
export { MediaLinkDO } from './modules/media/media-link-do.js';
export { DemoOutboxDO } from './modules/outbox/outbox-do.js';

export default withErrorReporting({
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
}) satisfies ExportedHandler<Env>;
