// AT-9 wiring (spec §9.2, §13): an error thrown inside the api service reaches the injected
// ErrorReporter only as redacted serializeError output, together with the release, and the response
// body stays {"error":"internal"}. M0a injects noopErrorReporter in src/index.ts; the Sentry adapter
// (before D1) implements the same interface, so nothing here changes when it is swapped in.
import { LogLine } from '@trace/shared/contracts';
import { noopErrorReporter, type ErrorReporter, type SerializedError } from '@trace/shared/log';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

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

const failingClock = (): Date => {
  throw new Error(piiMessage());
};

// The cast lets a test pass values that the generated Env type would not allow.
const envWith = (version: unknown): Env => ({ VERSION: version }) as Env;

const brokenEnv = (): Env =>
  Object.defineProperty({}, 'VERSION', {
    enumerable: true,
    get(): never {
      throw new Error(piiMessage());
    },
  }) as Env;

const request = (app: ReturnType<typeof createApp>, workerEnv: Env, path = '/health') =>
  app.request(`https://api.test${path}`, undefined, workerEnv);

describe('error reporting wiring (AT-9)', () => {
  it('reports a thrown handler error with the release, as redacted serialised output', async () => {
    const { reporter, captured } = spyReporter();
    const app = createApp({ reporter, now: failingClock, sink: () => {} });

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"internal"}');
    expect(captured).toHaveLength(1);
    const [report] = captured;
    expect(report?.ctx).toEqual({ release: 'abcdef1' });
    expect(report?.err.name).toBe('Error');
    // Only the serialiser's fields: no message, and nothing from the request.
    expect(
      Object.keys(report?.err ?? {}).every((key) => ['name', 'code', 'stack'].includes(key)),
    ).toBe(true);
    const reported = JSON.stringify(captured);
    expect(reported).not.toContain(email());
    expect(reported).not.toContain(mobile());
    expect(reported).not.toContain('failed for');
  });

  it('labels the report dev when VERSION is not a build version', async () => {
    const { reporter, captured } = spyReporter();
    const app = createApp({ reporter, now: failingClock, sink: () => {} });

    await request(app, envWith('main'));

    expect(captured).toHaveLength(1);
    expect(captured[0]?.ctx).toEqual({ release: 'dev' });
  });

  it('still reports, labelled dev, when reading the env is what failed', async () => {
    const { reporter, captured } = spyReporter();
    const app = createApp({ reporter, sink: () => {} });

    const response = await request(app, brokenEnv());

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"internal"}');
    expect(captured).toHaveLength(1);
    expect(captured[0]?.ctx).toEqual({ release: 'dev' });
    expect(JSON.stringify(captured)).not.toContain(email());
  });

  it('keeps answering {"error":"internal"} when the reporter itself throws', async () => {
    const reporter: ErrorReporter = {
      capture() {
        throw new Error(piiMessage());
      },
    };
    const app = createApp({ reporter, now: failingClock, sink: () => {} });

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"internal"}');
  });

  it('does not report requests that succeed or that match no route', async () => {
    const { reporter, captured } = spyReporter();
    const app = createApp({ reporter, sink: () => {} });

    expect((await request(app, envWith('abcdef1'))).status).toBe(200);
    expect((await request(app, envWith('abcdef1'), '/nope')).status).toBe(404);

    expect(captured).toHaveLength(0);
  });

  it('logs the failure once through the redacting logger, without the message', async () => {
    const lines: string[] = [];
    const app = createApp({
      reporter: noopErrorReporter,
      now: failingClock,
      sink: (line) => lines.push(line),
    });

    await request(app, envWith('abcdef1'));

    expect(lines).toHaveLength(1);
    const line = LogLine.parse(JSON.parse(lines[0] ?? ''));
    expect(line).toMatchObject({
      level: 'error',
      service: 'api',
      version: 'abcdef1',
      event: 'request.failed',
    });
    expect(lines[0]).not.toContain(email());
    expect(lines[0]).not.toContain(mobile());
    expect(lines[0]).not.toContain('failed for');
  });
});
