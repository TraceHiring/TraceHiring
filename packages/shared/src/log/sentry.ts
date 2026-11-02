// @trace/shared/sentry: the Sentry scrubber and adapter (spec §9.2, before D1). A separate entry
// point from @trace/shared/log, so the candidate app, which imports only the logger, never bundles it.
export * from './sentry-reporter.js';
export * from './sentry-scrub.js';
