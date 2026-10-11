// Worker entrypoint: a thin adapter over createApp (spec §2). The edge Worker has no secrets and
// no error reporter, so there is nothing to inject.
import { createApp } from './app.js';

const app = createApp();

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
