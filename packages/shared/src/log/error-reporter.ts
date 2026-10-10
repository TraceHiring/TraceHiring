// Error reporting contract (spec §9.2, revision 10). M0a ships only the no-op reporter;
// the Sentry adapter implements the same interface before D1, so no call site changes.
// Never used by workers/edge or the candidate app.
import { redactSerializedError } from './redact.js';
import { serializeError, type SerializedError } from './serialize-error.js';

export interface ErrorReporter {
  capture(err: SerializedError, ctx?: { release: string }): void;
}

export const noopErrorReporter: ErrorReporter = {
  capture() {},
};

/** The only way consumers report errors: serialised, then redacted. Never throws. */
export const reportError = (
  reporter: ErrorReporter,
  err: unknown,
  ctx?: { release: string },
): void => {
  try {
    const safe = redactSerializedError(serializeError(err));
    reporter.capture(safe, ctx);
  } catch {
    // A failing reporter must never break the request that hit the error.
  }
};
