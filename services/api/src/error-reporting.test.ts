// AT-9 wiring (spec §9.2, §13) and AT-B14 wiring (specs/m0b-tenancy.md §1.1 item 9b): the error and
// 404 handling itself lives in @trace/workers-http and is tested there (redaction, the release
// label, a failing reporter or sink, non-Error throws, HTTPException, no request data anywhere).
// This pins only that the api app uses it with the injected ErrorReporter: /health answers, an
// unknown path answers the JSON 404, and a thrown Error or non-Error answers the JSON 500, reaches
// the reporter once with the release and is logged once under the api service. M0a injects
// noopErrorReporter in src/index.ts; the Sentry adapter (before D1) implements the same interface,
// so nothing here changes when it is swapped in.
import { HealthResponse, LogLine } from '@trace/shared/contracts';
import { type ErrorReporter, type SerializedError } from '@trace/shared/log';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { sentryReporter, withErrorReporting, workerSentryOptions } from './error-reporting.js';

interface Captured {
  err: SerializedError;
  ctx: { release: string } | undefined;
}

const spyReporter = () => {
  const captured: Captured[] = [];
  const reporter: ErrorReporter = {
    capture(err, ctx) {
      captured.push({ err, ctx });
    },
  };
  return { reporter, captured };
};

// Synthesised at run time, so no PII-shaped literal sits in the repo.
const email = (): string => ['pat', 'example.test'].join('@');
const mobile = (): string => ['98765', '43210'].join('');
const piiMessage = (): string => `failed for ${email()} and ${mobile()}`;

const throwValue = (value: unknown): never => {
  throw value;
};

const request = (app: ReturnType<typeof createApp>, path = '/health') =>
  app.request(`https://api.test${path}`, undefined, { VERSION: 'abcdef1' } as Env);

describe('api app wiring (AT-9, AT-B14)', () => {
  it('answers /health 200 as the api service, never cached, and reports nothing', async () => {
    const { reporter, captured } = spyReporter();
    const app = createApp({ reporter, now: () => new Date('2026-10-12T00:00:00.000Z') });

    const response = await request(app);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(HealthResponse.parse(await response.json())).toMatchObject({
      status: 'ok',
      service: 'api',
      version: 'abcdef1',
    });
    expect(captured).toHaveLength(0);
  });

  it('answers an unknown path with the JSON 404, and reports and logs nothing', async () => {
    const lines: string[] = [];
    const { reporter, captured } = spyReporter();
    const app = createApp({ reporter, sink: (line) => lines.push(line) });

    const response = await request(app, '/nope');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"error":"not_found"}');
    expect(captured).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });

  it.each([
    ['an Error', () => new Error(piiMessage())],
    ['a string', () => piiMessage()],
    ['null', () => null],
    ['an object with an email field', () => ({ contact: email(), phone: mobile() })],
  ])(
    'answers the JSON 500, reports once and logs once under api when a handler throws %s',
    async (_label, make) => {
      const lines: string[] = [];
      const { reporter, captured } = spyReporter();
      const app = createApp({
        reporter,
        now: () => throwValue(make()),
        sink: (line) => lines.push(line),
      });

      const response = await request(app);

      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toBe('no-store');
      const text = await response.text();
      expect(text).toBe('{"error":"internal"}');
      expect(captured).toHaveLength(1);
      expect(captured[0]?.ctx).toEqual({ release: 'abcdef1' });
      expect(captured[0]?.err.name).toBe('Error');
      expect(lines).toHaveLength(1);
      expect(LogLine.parse(JSON.parse(lines[0] ?? ''))).toMatchObject({
        level: 'error',
        service: 'api',
        version: 'abcdef1',
        event: 'request.failed',
      });
      const everything = [text, ...lines, JSON.stringify(captured)].join(' | ');
      for (const sensitive of [email(), mobile(), 'failed for']) {
        expect(everything).not.toContain(sensitive);
      }
    },
  );
});

// AT-D22 / AT-9-sentry wiring (specs/d1-demo-slice.md AT-D22, m0-foundations §9.2): src/index.ts
// reports through the shared Sentry adapter, and the SDK (@sentry/cloudflare) runs only when the
// var SENTRY_DSN_WORKERS holds a DSN. With one, a failing request sends one scrubbed event: no
// message text, query string, header, IP or user, the exception value [REDACTED], the release the
// VERSION. The DSN is built at run time, so no DSN-shaped literal sits in the repo.
describe('api Sentry wiring (AT-D22)', () => {
  const dsn = (): string => `https://${'ab12'.repeat(8)}@o1.ingest.de.sentry.io/42`;
  const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const ip = (): string => ['10', '1', '2', '3'].join('.');

  /** A Worker ctx whose waitUntil promises the test can await (the SDK flushes through it). */
  const execution = () => {
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(p: Promise<unknown>) {
        pending.push(p);
      },
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext;
    return { ctx, settle: () => Promise.all(pending) };
  };

  /** A Sentry transport that keeps every envelope instead of sending it. */
  const capturing = () => {
    const envelopes: unknown[] = [];
    const transport = () => ({
      send(envelope: unknown) {
        envelopes.push(envelope);
        return Promise.resolve({});
      },
      flush() {
        return Promise.resolve(true);
      },
    });
    /** The event payloads of all envelopes. */
    const events = (): Record<string, unknown>[] =>
      envelopes.flatMap((envelope) =>
        ((envelope as [unknown, [{ type?: string }, unknown][]])[1] ?? [])
          .filter(([header]) => header.type === 'event')
          .map(([, payload]) => payload as Record<string, unknown>),
      );
    return { transport, envelopes, events };
  };

  const failingHandler = (lines: string[]) => {
    const app = createApp({
      reporter: sentryReporter,
      now: () => throwValue(new Error(piiMessage())),
      sink: (line) => lines.push(line),
    });
    return { fetch: app.fetch };
  };

  it('takes the DSN from SENTRY_DSN_WORKERS and the release from VERSION', () => {
    expect(workerSentryOptions({ SENTRY_DSN_WORKERS: dsn(), VERSION: SHA } as Env)).toMatchObject({
      dsn: dsn(),
      release: SHA,
      sendDefaultPii: false,
      tracesSampleRate: 0,
    });
    expect(workerSentryOptions({ SENTRY_DSN_WORKERS: '', VERSION: SHA } as Env)).toBeUndefined();
  });

  it('serves requests without initialising the SDK when there is no DSN', async () => {
    const lines: string[] = [];
    let wrapped = 0;
    const handler = withErrorReporting(
      failingHandler(lines),
      {},
      {
        withSentry: (_options, inner) => ({
          fetch: (...args: Parameters<typeof inner.fetch>) => {
            wrapped++;
            return inner.fetch(...args);
          },
        }),
      },
    );
    const { ctx } = execution();

    const response = await handler.fetch(
      new Request('https://api.test/health'),
      { SENTRY_DSN_WORKERS: '', VERSION: SHA } as Env,
      ctx,
    );

    expect(response.status).toBe(500);
    expect(wrapped).toBe(0);
    expect(lines).toHaveLength(1);
  });

  it('sends one scrubbed event for a failing request, and the DSN reaches no log line', async () => {
    const lines: string[] = [];
    const sentry = capturing();
    const handler = withErrorReporting(failingHandler(lines), { transport: sentry.transport });
    const { ctx, settle } = execution();

    const response = await handler.fetch(
      new Request(`https://api.test/health?email=${email()}&m=${mobile()}`, {
        headers: { authorization: `Bearer ${mobile()}`, 'cf-connecting-ip': ip() },
      }),
      { SENTRY_DSN_WORKERS: dsn(), VERSION: SHA } as Env,
      ctx,
    );
    await settle();

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"internal"}');
    const events = sentry.events();
    expect(events).toHaveLength(1);
    const event = events[0] as {
      release?: string;
      user?: unknown;
      request?: { url?: string; headers?: unknown };
      exception?: { values?: { type?: string; value?: string }[] };
    };
    expect(event.release).toBe(SHA);
    expect(event.user).toBeUndefined();
    expect(event.request?.headers).toBeUndefined();
    if (event.request?.url !== undefined) expect(event.request.url).not.toContain('?');
    expect(event.exception?.values?.[0]).toMatchObject({ type: 'Error', value: '[REDACTED]' });
    const everything = JSON.stringify(sentry.envelopes);
    for (const sensitive of [email(), mobile(), ip(), 'failed for']) {
      expect(everything).not.toContain(sensitive);
    }
    expect(lines.join('\n')).not.toContain(dsn());
  });
});
