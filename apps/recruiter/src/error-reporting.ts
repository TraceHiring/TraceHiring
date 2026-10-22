// Error reporting for the recruiter app (spec m0-foundations §9.2; d1 AT-D22). Errors reach the
// reporter only through `reportError` from @trace/shared/log: serialised (name, code, stack frames;
// never the message) and redacted. The reporter is the shared Sentry adapter (@trace/shared/sentry),
// whose events are scrubbed again by beforeSend. The SDK (@sentry/react) is initialised only when the
// build var VITE_SENTRY_DSN holds a DSN; until then the reporter does nothing.
import * as Sentry from '@sentry/react';
import { reportError, type ErrorReporter } from '@trace/shared/log';
import { createSentryReporter, sentryOptions } from '@trace/shared/sentry';
import { APP_VERSION } from './version';

/** The reporter in use: Sentry's captureEvent, a no-op until initErrorReporting found a DSN. */
export const errorReporter: ErrorReporter = createSentryReporter((event, hint) => {
  Sentry.captureEvent(event as Sentry.Event, hint as Sentry.EventHint);
});

/** The part of @sentry/react used here; tests pass their own. */
interface Sdk {
  init(options: Sentry.BrowserOptions): unknown;
}

/**
 * Initialises the SDK when `env.VITE_SENTRY_DSN` holds a DSN, with the shared options, and returns
 * whether it did. `overrides` is for tests only (a capturing transport); the app passes nothing.
 */
export function initErrorReporting(
  env: { VITE_SENTRY_DSN?: string | undefined },
  sdk: Sdk = Sentry,
  overrides: Pick<Sentry.BrowserOptions, 'transport'> = {},
): boolean {
  const options = sentryOptions({ dsn: env.VITE_SENTRY_DSN, release: APP_VERSION });
  if (options === undefined) return false;
  // The shared options keep only the allow-listed integrations: no window handlers (installGlobalErrorReporting
  // reports those), sessions, HTTP or culture context, wrapped-callback errors, Replay or Feedback.
  sdk.init({ ...options, ...overrides });
  return true;
}

/** Reports `err`, tagged with this build's release. Never throws. */
export function reportAppError(err: unknown, reporter: ErrorReporter = errorReporter): void {
  reportError(reporter, err, { release: APP_VERSION });
}

/** The part of `window` that global error reporting needs. */
export interface ErrorSource {
  addEventListener(type: 'error' | 'unhandledrejection', listener: (event: Event) => void): void;
}

/** Reports uncaught errors and unhandled promise rejections from `source` (the window). */
export function installGlobalErrorReporting(
  source: ErrorSource,
  reporter: ErrorReporter = errorReporter,
): void {
  source.addEventListener('error', (event) => {
    reportAppError((event as Event & { error?: unknown }).error, reporter);
  });
  source.addEventListener('unhandledrejection', (event) => {
    reportAppError((event as Event & { reason?: unknown }).reason, reporter);
  });
}
