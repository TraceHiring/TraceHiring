// Worker entrypoint: a thin adapter over createApp (spec §2). The edge Worker has no secrets and
// no error reporter, so there is nothing to inject.
import { createApp } from './app.js';

const app = createApp();

// The two SQLite-backed Durable Objects of specs/d1-demo-slice.md §4.2; wrangler needs both classes exported to build
// the `migrations` and `durable_objects` blocks.
export { InviteOtpDO } from './otp-do.js';
export { SessionDO } from './session-do.js';

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
