// Error reporting for the jobs Worker (spec m0-foundations §9.2 "Before D1: the Sentry adapter";
// d1 AT-D22). Errors reach Sentry only through the shared adapter (@trace/shared/sentry): already
// serialised and redacted by reportError, then scrubbed again by beforeSend. The SDK
// (@sentry/cloudflare) is initialised only when the var SENTRY_DSN_WORKERS holds a DSN; without one,
// requests are served by the plain handler and reports go nowhere.
import * as Sentry from '@sentry/cloudflare';
import {
  createSentryReporter,
  sentryDsn,
  sentryOptions,
  type SentryOptions,
} from '@trace/shared/sentry';

/** The reporter createApp gets: Sentry's captureEvent in the request's scope, a no-op without a client. */
export const sentryReporter = createSentryReporter((event, hint) => {
  Sentry.captureEvent(event as Sentry.Event, hint as Sentry.EventHint);
});

/**
 * The SDK options for this env, or undefined when SENTRY_DSN_WORKERS holds no DSN. The DSN is read
 * first, so without one nothing else of env is read here; an env that throws when read gives
 * undefined, and the app's own error path then answers the request. Never throws.
 */
export const workerSentryOptions = (env: Env): SentryOptions | undefined => {
  try {
    const dsn = sentryDsn(env.SENTRY_DSN_WORKERS);
    return dsn === undefined ? undefined : sentryOptions({ dsn, release: env.VERSION });
  } catch {
    return undefined;
  }
};

interface FetchHandler {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>;
}

/** The part of @sentry/cloudflare used here; tests pass their own. */
interface Sdk {
  withSentry: (
    options: (env: Env) => Sentry.CloudflareOptions | undefined,
    handler: FetchHandler,
  ) => FetchHandler;
}

/**
 * Wraps `handler` with the SDK when the env has a DSN, and serves it unwrapped when it has none.
 * `overrides` is for tests only (a capturing transport); production passes nothing.
 */
export const withErrorReporting = (
  handler: FetchHandler,
  overrides: Pick<Sentry.CloudflareOptions, 'transport'> = {},
  sdk: Sdk = { withSentry: Sentry.withSentry },
): FetchHandler => {
  // withSentry instruments the object it is given in place, so it gets its own.
  const instrumented = sdk.withSentry(
    (env) => {
      const options = workerSentryOptions(env);
      return options && { ...options, ...overrides };
    },
    { fetch: handler.fetch },
  );
  return {
    fetch(request, env, ctx) {
      return workerSentryOptions(env) === undefined
        ? handler.fetch(request, env, ctx)
        : instrumented.fetch(request, env, ctx);
    },
  };
};
