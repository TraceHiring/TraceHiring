// Worker entrypoint: a thin adapter over createApp (spec §2). The edge Worker has no secrets and
// no error reporter, so there is nothing to inject.
import { DurableObject } from 'cloudflare:workers';
import { createApp } from './app.js';

const app = createApp();

// Wave 0 stubs (specs/d1-demo-slice.md §4.2): wrangler needs these classes exported to build the
// `migrations` and `durable_objects` blocks. The candidate-runtime stream replaces both with the
// real SessionDO (§4.4) and InviteOtpDO (§4.2); until then any use throws.
export class SessionDO extends DurableObject<Env> {
  override fetch(): Promise<Response> {
    throw new Error('not implemented');
  }
}

export class InviteOtpDO extends DurableObject<Env> {
  override fetch(): Promise<Response> {
    throw new Error('not implemented');
  }
}

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
