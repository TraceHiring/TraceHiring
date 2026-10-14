// Error reporting for the api Worker (spec m0-foundations §9.2 "Before D1: the Sentry adapter";
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

/** Worker options: the shared ones, plus SDK metadata telling Sentry never to infer an IP or user agent. */
type WorkerSentryOptions = SentryOptions & {
  _metadata: { sdk: { settings: { infer_ip: 'never'; infer_user_agent: 'never' } } };
};

/**
 * The SDK options for this env, or undefined when SENTRY_DSN_WORKERS holds no DSN. The DSN is read
 * first, so without one nothing else of env is read here; an env that throws when read gives
 * undefined, and the app's own error path then answers the request. Never throws.
 *
 * Fails closed when the env holds any other SENTRY_* name: @sentry/cloudflare reads
 * SENTRY_TRACES_SAMPLE_RATE, SENTRY_TUNNEL, SENTRY_DSN, SENTRY_DEBUG and others from env, which could
 * turn tracing back on or send envelopes elsewhere (AT-D22 re-review Mi-1).
 */
export const workerSentryOptions = (env: Env): WorkerSentryOptions | undefined => {
  try {
    const dsn = sentryDsn(env.SENTRY_DSN_WORKERS);
    if (dsn === undefined) return undefined;
    if (Object.keys(env).some((k) => k.startsWith('SENTRY_') && k !== 'SENTRY_DSN_WORKERS')) {
      return undefined;
    }
    const options = sentryOptions({ dsn, release: env.VERSION });
    return (
      options && {
        ...options,
        // The Cloudflare client sets no sdk.settings itself (AT-D22 re-review N-1).
        _metadata: { sdk: { settings: { infer_ip: 'never', infer_user_agent: 'never' } } },
      }
    );
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
