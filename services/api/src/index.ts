// Worker entrypoint: a thin adapter over createApp (spec §2, ADR-027); module code lives in
// src/modules/. M0a reports errors to the no-op reporter; the Sentry adapter replaces it here, and
// only here, before D1 (spec §9.2).
import { noopErrorReporter } from '@trace/shared/log';
import { createApp } from './app.js';

const app = createApp({ reporter: noopErrorReporter });

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
