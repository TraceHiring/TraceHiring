// AT-9 wiring (spec §9.2, §13): an error thrown inside the jobs Worker reaches the injected
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

const request = (
  app: ReturnType<typeof createApp>,
  workerEnv: Env,
  path = '/health',
  init?: RequestInit,
) => app.request(`https://jobs.test${path}`, init, workerEnv);

// Request data of every kind the error path must never read or echo. Built at run time.
const requestData = () => {
  const token = ['tok', 'live', 'x9y8z7w6v5'].join('_');
  const session = ['sid', 'q1w2e3r4t5'].join('');
  const ip = ['192', '0', '2', '77'].join('.');
  const forwarded = ['192', '0', '2', '78'].join('.');
  const agent = ['SyntheticAgent', '7.7.7'].join('/');
  const body = JSON.stringify({ contact: email(), phone: mobile() });
  const headers = {
    authorization: `Bearer ${token}`,
    cookie: `sid=${session}`,
    'cf-connecting-ip': ip,
    'x-forwarded-for': forwarded,
    'user-agent': agent,
  };
  return {
    path: `?email=${encodeURIComponent(email())}&token=${token}`,
    /** A GET carrying the headers. */
    getInit: { headers } satisfies RequestInit,
    /** A POST carrying the headers and a body. */
    postInit: {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body,
    } satisfies RequestInit,
    values: [email(), encodeURIComponent(email()), mobile(), token, session, ip, forwarded, agent],
  };
};

// Everything an observer could see: the response body, every log line, every reporter call.
const everythingSeen = (body: string, lines: string[], captured: Captured[]): string =>
  [body, ...lines, JSON.stringify(captured)].join(' | ');

// Throws a value that is not an Error. Hono hands only Errors to onError, so these are the values
// that would otherwise escape the app (S3A-1).
const throwValue = (value: unknown): never => {
  throw value;
};
const nonErrors: [string, () => unknown][] = [
  ['a string', () => piiMessage()],
  ['null', () => null],
  ['an object with an email field', () => ({ contact: email(), phone: mobile() })],
];

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
      service: 'jobs',
      version: 'abcdef1',
      event: 'request.failed',
    });
    expect(lines[0]).not.toContain(email());
    expect(lines[0]).not.toContain(mobile());
    expect(lines[0]).not.toContain('failed for');
  });

  it.each(nonErrors)(
    'answers the JSON 500 and reports once when a handler throws %s',
    async (_label, make) => {
      const lines: string[] = [];
      const { reporter, captured } = spyReporter();
      const app = createApp({
        reporter,
        now: () => throwValue(make()),
        sink: (line) => lines.push(line),
      });

      const response = await request(app, envWith('abcdef1'));

      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toBe('no-store');
      const text = await response.text();
      expect(text).toBe('{"error":"internal"}');
      expect(captured).toHaveLength(1);
      expect(captured[0]?.ctx).toEqual({ release: 'abcdef1' });
      expect(captured[0]?.err.name).toBe('Error');
      expect(lines).toHaveLength(1);
      for (const sensitive of [email(), mobile(), 'failed for']) {
        expect(everythingSeen(text, lines, captured)).not.toContain(sensitive);
      }
    },
  );

  it('still answers the JSON 500 when the logger sink and the reporter both throw', async () => {
    const reporter: ErrorReporter = {
      capture() {
        throw new Error(piiMessage());
      },
    };
    const app = createApp({
      reporter,
      now: failingClock,
      sink: () => {
        throw new Error(piiMessage());
      },
    });

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"error":"internal"}');
  });

  it('falls back to the static JSON 500 when the error handler itself throws', async () => {
    // Reading deps.reporter throws, which happens inside onError before anything is reported.
    const deps = {
      get reporter(): ErrorReporter {
        throw new Error(piiMessage());
      },
      now: failingClock,
      sink: () => {},
    };
    const app = createApp(deps);

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"error":"internal"}');
  });

  it('carries no request data to the response, the log or the reporter on the error path', async () => {
    const lines: string[] = [];
    const { reporter, captured } = spyReporter();
    const app = createApp({ reporter, now: failingClock, sink: (line) => lines.push(line) });
    const data = requestData();

    const response = await request(app, envWith('abcdef1'), `/health${data.path}`, data.getInit);

    expect(response.status).toBe(500);
    const everything = everythingSeen(await response.text(), lines, captured);
    for (const value of data.values) {
      expect(everything).not.toContain(value);
    }
  });

  it('carries no request data anywhere on the 404 path, and reports nothing', async () => {
    const lines: string[] = [];
    const { reporter, captured } = spyReporter();
    const app = createApp({ reporter, sink: (line) => lines.push(line) });
    const data = requestData();

    const response = await request(app, envWith('abcdef1'), `/nope${data.path}`, data.postInit);

    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).toBe('{"error":"not_found"}');
    expect(captured).toHaveLength(0);
    const everything = everythingSeen(text, lines, captured);
    for (const value of data.values) {
      expect(everything).not.toContain(value);
    }
  });
});
