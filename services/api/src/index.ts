// Worker entrypoint: a thin adapter over createApp (spec §2, ADR-027); module code lives in
// src/modules/. Errors go to Sentry through the shared adapter, and only when SENTRY_DSN_WORKERS
// holds a DSN (spec m0-foundations §9.2; d1 AT-D22).
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { createApp } from './app.js';
import { sentryReporter, withErrorReporting } from './error-reporting.js';

const app = createApp({ reporter: sentryReporter });

// Wave 0 stubs (specs/d1-demo-slice.md §4.2): wrangler needs these classes exported to build the
// `migrations` block and the service binding the edge declares. The candidate-runtime and api
// streams replace them with the real DemoOutboxDO, MediaLinkDO (§4.5) and CandidateRpc (§4.2
// methods); until then any use throws.
export class DemoOutboxDO extends DurableObject<Env> {
  override fetch(): Promise<Response> {
    throw new Error('not implemented');
  }
}

export class MediaLinkDO extends DurableObject<Env> {
  override fetch(): Promise<Response> {
    throw new Error('not implemented');
  }
}

export class CandidateRpc extends WorkerEntrypoint<Env> {
  inviteResolve(): Promise<never> {
    throw new Error('not implemented');
  }
}

export default withErrorReporting({
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
}) satisfies ExportedHandler<Env>;
