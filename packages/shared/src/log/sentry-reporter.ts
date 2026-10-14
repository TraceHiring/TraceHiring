// The Sentry adapter (spec specs/m0-foundations.md §9.2 "Before D1: the Sentry adapter"; d1 AT-D22).
// It implements ErrorReporter over an SDK's captureEvent, so the recruiter app (@sentry/react),
// workers/jobs and services/api (@sentry/cloudflare) share it and no call site changes. It imports no
// Sentry package: each consumer passes its SDK's captureEvent and initialises the SDK with
// sentryOptions(), and only when sentryDsn() finds a DSN (spec: no DSN, no SDK).
// Never used by workers/edge or the candidate app.
import { type ErrorReporter } from './error-reporter.js';
import { REDACTED } from './redact.js';
import { type SerializedError } from './serialize-error.js';
import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  type SentryEventLike,
  type SentryFrameLike,
  type SentryHintLike,
} from './sentry-scrub.js';
import { isVersion } from './version.js';

/** An SDK's captureEvent. */
export type SentryCapture = (event: SentryEventLike, hint: SentryHintLike) => void;

/** One V8 frame string as serializeError keeps it: `at fn (location:line:col)` or `at location:line:col`. */
const FRAME = /^at (?:(.+?) \()?(.+):(\d+):(\d+)\)?$/;

const toFrame = (line: string): SentryFrameLike | undefined => {
  const m = FRAME.exec(line);
  if (m === null) return undefined;
  return {
    filename: m[2] ?? '',
    function: m[1] ?? '?',
    lineno: Number(m[3]),
    colno: Number(m[4]),
    in_app: true,
  };
};

/**
 * The Sentry event for a serialised, redacted error: one exception whose value is the error's code
 * (never a message) or "[REDACTED]", with its frames oldest first as Sentry expects.
 */
export const toSentryEvent = (err: SerializedError, ctx?: { release: string }): SentryEventLike => {
  const frames = (err.stack ?? [])
    .map(toFrame)
    .filter((f) => f !== undefined)
    .reverse();
  return {
    level: 'error',
    ...(ctx?.release === undefined ? {} : { release: ctx.release }),
    exception: {
      values: [
        {
          type: err.name,
          value: err.code ?? REDACTED,
          mechanism: { type: 'trace.report_error', handled: true },
          ...(err.stack === undefined ? {} : { stacktrace: { frames } }),
        },
      ],
    },
  };
};

/**
 * An ErrorReporter that sends through `capture`. The serialised error rides in the hint, so the
 * scrubber (beforeSend) keeps its code as the exception value. Never throws.
 */
export const createSentryReporter = (capture: SentryCapture): ErrorReporter => ({
  capture(err, ctx) {
    try {
      capture(toSentryEvent(err, ctx), { data: { serializedError: err } });
    } catch {
      // A failing SDK must never break the request that hit the error.
    }
  },
});

/** A Sentry DSN: https, a 32-hex public key, a host and a numeric project id, nothing else. */
const DSN = /^https:\/\/[0-9a-f]{32}@[a-z0-9.-]+\/\d+$/;

/** The DSN if `value` is one, else undefined: without a DSN the SDK is not initialised (spec §9.2). */
export const sentryDsn = (value: unknown): string | undefined =>
  typeof value === 'string' && DSN.test(value) ? value : undefined;

export interface SentryOptions {
  dsn: string;
  release?: string;
  environment?: string;
  sendDefaultPii: false;
  tracesSampleRate: 0;
  attachStacktrace: false;
  maxBreadcrumbs: number;
  beforeSend: typeof scrubSentryEvent;
  beforeBreadcrumb: typeof scrubSentryBreadcrumb;
}

/**
 * The options every consumer initialises its SDK with (spec §9.2): no default PII, no tracing (and
 * so no Session Replay data), `release` = the commit SHA, the scrubber as beforeSend and
 * beforeBreadcrumb. Undefined when there is no valid DSN: then the consumer does not initialise the
 * SDK. The release must be a version (a SHA holding a hex letter, or 'dev'), as in error-reporter.ts.
 */
export const sentryOptions = (input: {
  dsn: unknown;
  release: unknown;
  environment?: unknown;
}): SentryOptions | undefined => {
  const dsn = sentryDsn(input.dsn);
  if (dsn === undefined) return undefined;
  const { release, environment } = input;
  return {
    dsn,
    ...(isVersion(release) && (release === 'dev' || /[a-f]/.test(release)) ? { release } : {}),
    ...(typeof environment === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(environment)
      ? { environment }
      : {}),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    attachStacktrace: false,
    maxBreadcrumbs: 50,
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: scrubSentryBreadcrumb,
  };
};
