// Error reporting contract (spec §9.2, revision 10). M0a ships only the no-op reporter;
// the Sentry adapter implements the same interface before D1, so no call site changes.
// Never used by workers/edge or the candidate app.
import { redactSerializedError } from './redact.js';
import { serializeError, type SerializedError } from './serialize-error.js';
import { isVersion } from './version.js';

export interface ErrorReporter {
  capture(err: SerializedError, ctx?: { release: string }): void;
}

export const noopErrorReporter: ErrorReporter = {
  capture() {},
};

/**
 * The release a reporter may see: ctx.release only in the logger's version shape (a commit SHA or
 * 'dev'), in a fresh object, so no other field of ctx and no free text gets through (spec review
 * L5). Anything else, or a ctx that throws when read, is dropped.
 */
const safeContext = (ctx: { release: string } | undefined): { release: string } | undefined => {
  try {
    const release: unknown = ctx?.release;
    return isVersion(release) ? { release } : undefined;
  } catch {
    return undefined;
  }
};

/** The only way consumers report errors: serialised, then redacted. Never throws. */
export const reportError = (
  reporter: ErrorReporter,
  err: unknown,
  ctx?: { release: string },
): void => {
  try {
    const safe = redactSerializedError(serializeError(err));
    reporter.capture(safe, safeContext(ctx));
  } catch {
    // A failing reporter must never break the request that hit the error.
  }
};
