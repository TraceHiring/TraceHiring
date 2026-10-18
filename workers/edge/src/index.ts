// Worker entrypoint: a thin adapter over createApp (spec §2). The edge Worker has no secrets and
// no error reporter, so there is nothing to inject.
import { DurableObject } from 'cloudflare:workers';
import { createApp } from './app.js';

const app = createApp();

// InviteOtpDO (specs/d1-demo-slice.md §4.2) is the real object; wrangler needs both classes exported to build the
// `migrations` and `durable_objects` blocks.
export { InviteOtpDO } from './otp-do.js';

// Wave 0 stub: the candidate-runtime stream (C1b) replaces it with the real SessionDO (§4.4); until then any use
// throws.
export class SessionDO extends DurableObject<Env> {
  override fetch(): Promise<Response> {
    throw new Error('not implemented');
  }
}

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
