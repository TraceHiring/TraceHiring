// Error reporting for the recruiter app (spec m0-foundations §9.2, revision 10).
// M0a ships the `ErrorReporter` interface with a no-op implementation; the Sentry adapter, with the
// same interface, comes before D1 and changes no call site. Errors reach the reporter only through
// `reportError` from @trace/shared/log: serialised (name, code, stack frames; never the message) and
// redacted. No raw Error, message text, request, user or query data is ever passed on.
import { noopErrorReporter, reportError, type ErrorReporter } from '@trace/shared/log';
import { APP_VERSION } from './version';

/** The reporter in use. Swapping the Sentry adapter in (before D1) is a change to this line only. */
export const errorReporter: ErrorReporter = noopErrorReporter;

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
