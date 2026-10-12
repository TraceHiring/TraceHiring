// Error and 404 handling shared by the three Workers (specs/m0b-tenancy.md §1.1 item 9b, AT-B14;
// M0a spec §9.2, S3A-1). These tests moved here from workers/edge, workers/jobs and services/api,
// which keep one wiring test each. They run in Node against a Hono app built in the test.
//
// What they pin: a thrown value that is not an Error still ends in the JSON 500; the response
// carries no message and no stack; the log line and the reporter get the serialised error and never
// its message; nothing from the request reaches the response, the log or the reporter; and if the
// error handler itself throws, the static 500 still goes out.
import { LogLine } from '@trace/shared/contracts';
import { noopErrorReporter, type ErrorReporter, type SerializedError } from '@trace/shared/log';
import { HTTPException } from 'hono/http-exception';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpApp, type ErrorHandlingDeps } from './index';

const SERVICE = 'testsvc';

afterEach(() => {
  vi.restoreAllMocks();
});

type TestEnv = { Bindings: { VERSION: string } };

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
const failWithPii = (): never => {
  throw new Error(piiMessage());
};

// Hono hands only Errors to onError; these are the values that would otherwise escape the app.
const nonErrors: [string, () => unknown][] = [
  ['a string', () => piiMessage()],
  ['null', () => null],
  ['an object with an email field', () => ({ contact: email(), phone: mobile() })],
];

// The cast lets a test pass values that the Env type would not allow, such as an unset VERSION.
const envWith = (version: unknown): TestEnv['Bindings'] =>
  ({ VERSION: version }) as TestEnv['Bindings'];

const brokenEnv = (): TestEnv['Bindings'] =>
  Object.defineProperty({}, 'VERSION', {
    enumerable: true,
    get(): never {
      throw new Error(piiMessage());
    },
  }) as TestEnv['Bindings'];

/** An app whose `/boom` route throws what `make` returns and whose `/ok` route answers 200. */
const buildApp = (make: () => unknown, deps?: ErrorHandlingDeps) => {
  const app = createHttpApp<TestEnv>(SERVICE, deps);
  app.get('/boom', () => throwValue(make()));
  app.get('/ok', (c) => c.text('fine'));
  return app;
};

const request = (
  app: ReturnType<typeof buildApp>,
  workerEnv: TestEnv['Bindings'],
  path = '/boom',
  init?: RequestInit,
) => app.request(`https://${SERVICE}.test${path}`, init, workerEnv);

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

describe('createHttpApp: unknown routes', () => {
  it.each([
    ['GET', '/'],
    ['GET', '/anything'],
    ['POST', '/ok'],
  ])('%s %s answers the JSON 404 with no-store, reports and logs nothing', async (method, path) => {
    const lines: string[] = [];
    const { reporter, captured } = spyReporter();
    const app = buildApp(failWithPii, { reporter, sink: (line) => lines.push(line) });

    const response = await request(app, envWith('abcdef1'), path, { method });

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"error":"not_found"}');
    expect(captured).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });

  it('carries no request data anywhere on the 404 path, and reports nothing', async () => {
    const lines: string[] = [];
    const { reporter, captured } = spyReporter();
    const app = buildApp(failWithPii, { reporter, sink: (line) => lines.push(line) });
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

describe('createHttpApp: a handler throws an Error', () => {
  it('reports it with the release, as redacted serialised output', async () => {
    const { reporter, captured } = spyReporter();
    const app = buildApp(failWithPii, { reporter, sink: () => {} });

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
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
    const app = buildApp(failWithPii, { reporter, sink: () => {} });

    await request(app, envWith('main'));

    expect(captured).toHaveLength(1);
    expect(captured[0]?.ctx).toEqual({ release: 'dev' });
  });

  it('labels the report dev when VERSION is unset', async () => {
    const { reporter, captured } = spyReporter();
    const app = buildApp(failWithPii, { reporter, sink: () => {} });

    await request(app, envWith(undefined));

    expect(captured).toHaveLength(1);
    expect(captured[0]?.ctx).toEqual({ release: 'dev' });
  });

  it('still reports, labelled dev, when reading the env is what failed', async () => {
    const { reporter, captured } = spyReporter();
    const app = buildApp(failWithPii, { reporter, sink: () => {} });

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
    const lines: string[] = [];
    const app = buildApp(failWithPii, { reporter, sink: (line) => lines.push(line) });

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"internal"}');
    // A broken reporter must not cost the log line.
    expect(lines).toHaveLength(1);
    expect(LogLine.parse(JSON.parse(lines[0] ?? ''))).toMatchObject({ event: 'request.failed' });
    expect(lines[0]).not.toContain(email());
  });

  it('does not report requests that succeed or that match no route', async () => {
    const { reporter, captured } = spyReporter();
    const app = buildApp(failWithPii, { reporter, sink: () => {} });

    expect((await request(app, envWith('abcdef1'), '/ok')).status).toBe(200);
    expect((await request(app, envWith('abcdef1'), '/nope')).status).toBe(404);

    expect(captured).toHaveLength(0);
  });

  it('logs the failure once through the redacting logger, without the message', async () => {
    const lines: string[] = [];
    const app = buildApp(failWithPii, {
      reporter: noopErrorReporter,
      sink: (line) => lines.push(line),
    });

    await request(app, envWith('abcdef1'));

    expect(lines).toHaveLength(1);
    const line = LogLine.parse(JSON.parse(lines[0] ?? ''));
    expect(line).toMatchObject({
      level: 'error',
      service: SERVICE,
      version: 'abcdef1',
      event: 'request.failed',
    });
    expect(lines[0]).not.toContain(email());
    expect(lines[0]).not.toContain(mobile());
    expect(lines[0]).not.toContain('failed for');
  });

  it('labels the log line dev when the env cannot be read', async () => {
    const lines: string[] = [];
    const app = buildApp(failWithPii, { sink: (line) => lines.push(line) });

    const response = await request(app, brokenEnv());

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"internal"}');
    expect(lines).toHaveLength(1);
    expect(LogLine.parse(JSON.parse(lines[0] ?? ''))).toMatchObject({ version: 'dev' });
  });

  it('still answers the JSON 500 when the logger sink and the reporter both throw', async () => {
    const reporter: ErrorReporter = {
      capture() {
        throw new Error(piiMessage());
      },
    };
    const app = buildApp(failWithPii, {
      reporter,
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

  it('falls back to the static JSON 500 when reading deps.reporter throws', async () => {
    // The deps are read inside the error handler, so a getter that throws ends in the static 500.
    const deps = {
      get reporter(): ErrorReporter {
        throw new Error(piiMessage());
      },
      sink: () => {},
    };
    const app = buildApp(failWithPii, deps);

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"error":"internal"}');
  });

  it('falls back to the static JSON 500 when reading deps.sink throws', async () => {
    const deps = {
      get sink(): (line: string) => void {
        throw new Error(piiMessage());
      },
    };
    const app = buildApp(failWithPii, deps);

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"error":"internal"}');
  });

  it('carries no request data to the response, the log or the reporter', async () => {
    const lines: string[] = [];
    const { reporter, captured } = spyReporter();
    const app = buildApp(failWithPii, { reporter, sink: (line) => lines.push(line) });
    const data = requestData();

    const response = await request(app, envWith('abcdef1'), `/boom${data.path}`, data.getInit);

    expect(response.status).toBe(500);
    const everything = everythingSeen(await response.text(), lines, captured);
    for (const value of data.values) {
      expect(everything).not.toContain(value);
    }
  });
});

describe('createHttpApp: without a reporter (the edge Worker)', () => {
  it('logs the failure once and answers the JSON 500, with nothing else to leak to', async () => {
    const lines: string[] = [];
    const app = buildApp(failWithPii, { sink: (line) => lines.push(line) });

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).toBe('{"error":"internal"}');
    expect(lines).toHaveLength(1);
    expect(LogLine.parse(JSON.parse(lines[0] ?? ''))).toMatchObject({
      level: 'error',
      service: SERVICE,
      version: 'abcdef1',
      event: 'request.failed',
    });
    for (const sensitive of [email(), mobile(), 'failed for']) {
      expect([text, ...lines].join(' | ')).not.toContain(sensitive);
    }
  });

  it('works with no deps at all, logging to the console', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
    const app = buildApp(() => new Error('boom'));

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"internal"}');
    expect(logged).toHaveLength(1);
    expect(LogLine.parse(JSON.parse(logged[0] ?? ''))).toMatchObject({ event: 'request.failed' });
  });

  it('keeps the request out of the response and the log on the error path and the 404 path', async () => {
    const lines: string[] = [];
    const app = buildApp(failWithPii, { sink: (line) => lines.push(line) });
    const data = requestData();

    const failed = await request(app, envWith('abcdef1'), `/boom${data.path}`, data.getInit);
    const missing = await request(app, envWith('abcdef1'), `/nope${data.path}`, data.postInit);

    expect(failed.status).toBe(500);
    expect(missing.status).toBe(404);
    const everything = [await failed.text(), await missing.text(), ...lines].join(' | ');
    for (const value of data.values) {
      expect(everything).not.toContain(value);
    }
  });
});

describe('createHttpApp: a handler throws something that is not an Error (S3A-1)', () => {
  it.each(nonErrors)(
    'answers the JSON 500, reports once and logs once when a handler throws %s',
    async (_label, make) => {
      const lines: string[] = [];
      const { reporter, captured } = spyReporter();
      const app = buildApp(make, { reporter, sink: (line) => lines.push(line) });

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
      expect(LogLine.parse(JSON.parse(lines[0] ?? ''))).toMatchObject({
        level: 'error',
        service: SERVICE,
        version: 'abcdef1',
        event: 'request.failed',
      });
      for (const sensitive of [email(), mobile(), 'failed for']) {
        expect(everythingSeen(text, lines, captured)).not.toContain(sensitive);
      }
    },
  );

  it.each(nonErrors)(
    'answers the JSON 500 and logs once without a reporter when a handler throws %s',
    async (_label, make) => {
      const lines: string[] = [];
      const app = buildApp(make, { sink: (line) => lines.push(line) });

      const response = await request(app, envWith('abcdef1'));

      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toBe('no-store');
      const text = await response.text();
      expect(text).toBe('{"error":"internal"}');
      expect(lines).toHaveLength(1);
      expect(LogLine.parse(JSON.parse(lines[0] ?? ''))).toMatchObject({
        level: 'error',
        service: SERVICE,
        version: 'abcdef1',
        event: 'request.failed',
      });
      for (const sensitive of [email(), mobile(), 'failed for']) {
        expect([text, ...lines].join(' | ')).not.toContain(sensitive);
      }
    },
  );

  it('also converts a non-Error thrown from a middleware registered after the factory', async () => {
    const lines: string[] = [];
    const app = createHttpApp<TestEnv>(SERVICE, { sink: (line) => lines.push(line) });
    app.use('*', () => throwValue('a thrown string'));
    app.get('/ok', (c) => c.text('fine'));

    const response = await request(app, envWith('abcdef1'), '/ok');

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"internal"}');
    expect(lines).toHaveLength(1);
  });
});

describe('createHttpApp: a handler throws a Hono HTTPException', () => {
  it('answers with the exception own response and status, not the 500', async () => {
    const lines: string[] = [];
    const { reporter, captured } = spyReporter();
    const app = buildApp(() => new HTTPException(401, { message: 'unauthorised' }), {
      reporter,
      sink: (line) => lines.push(line),
    });

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('unauthorised');
    // An HTTPException is an answer the code chose, not a failure: nothing is reported or logged.
    expect(captured).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });

  it('answers with the response the exception carries, under the exception status', async () => {
    const res = new Response('{"error":"conflict"}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
    const app = buildApp(() => new HTTPException(409, { res }), { sink: () => {} });

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"error":"conflict"}');
  });

  it('answers with its own status when a middleware throws it', async () => {
    const app = createHttpApp<TestEnv>(SERVICE, { sink: () => {} });
    app.use('*', () => throwValue(new HTTPException(403, { message: 'forbidden' })));
    app.get('/ok', (c) => c.text('fine'));

    const response = await request(app, envWith('abcdef1'), '/ok');

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('forbidden');
  });

  it('forces cache-control no-store on a 4xx, over any value the exception response sets', async () => {
    const res = new Response('{"error":"conflict"}', {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' },
    });
    const app = buildApp(() => new HTTPException(409, { res }), { sink: () => {} });

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.text()).toBe('{"error":"conflict"}');
  });

  it('adds cache-control no-store to a 4xx whose exception response sets none', async () => {
    const app = buildApp(() => new HTTPException(401, { message: 'unauthorised' }), {
      sink: () => {},
    });

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('drops set-cookie from a 4xx exception response and keeps its other headers', async () => {
    const session = ['sid', 'q1w2e3r4t5'].join('');
    const res = new Response('{"error":"denied"}', {
      headers: {
        'content-type': 'application/json',
        'set-cookie': `sid=${session}; Path=/`,
        'x-synthetic': 'kept',
      },
    });
    const app = buildApp(() => new HTTPException(403, { res }), { sink: () => {} });

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get('x-synthetic')).toBe('kept');
    expect(await response.text()).toBe('{"error":"denied"}');
  });

  it.each([400, 499])('passes the %i boundary status through', async (status) => {
    const app = buildApp(() => new HTTPException(status as 400, { message: 'constant' }), {
      sink: () => {},
    });

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(status);
    expect(await response.text()).toBe('constant');
  });

  it.each([500, 503])(
    'treats a %i HTTPException as a failure: constant 500, one log line, one report',
    async (status) => {
      const lines: string[] = [];
      const { reporter, captured } = spyReporter();
      const canary = piiMessage();
      const app = buildApp(
        () =>
          new HTTPException(status as 500, {
            message: canary,
            res: new Response(canary, { status, headers: { 'set-cookie': `sid=${canary}` } }),
            cause: new Error(canary),
          }),
        { reporter, sink: (line) => lines.push(line) },
      );

      const response = await request(app, envWith('abcdef1'));

      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('set-cookie')).toBeNull();
      const text = await response.text();
      expect(text).toBe('{"error":"internal"}');
      expect(captured).toHaveLength(1);
      expect(captured[0]?.ctx).toEqual({ release: 'abcdef1' });
      expect(lines).toHaveLength(1);
      expect(LogLine.parse(JSON.parse(lines[0] ?? ''))).toMatchObject({
        level: 'error',
        service: SERVICE,
        version: 'abcdef1',
        event: 'request.failed',
      });
      const everything = everythingSeen(text, lines, captured);
      for (const sensitive of [email(), mobile(), 'failed for']) {
        expect(everything).not.toContain(sensitive);
      }
    },
  );

  it.each([200, 302, 600])(
    'treats an HTTPException with status %i (outside 400-499) as a failure',
    async (status) => {
      const lines: string[] = [];
      const { reporter, captured } = spyReporter();
      const app = buildApp(() => new HTTPException(status as 400, { message: 'constant' }), {
        reporter,
        sink: (line) => lines.push(line),
      });

      const response = await request(app, envWith('abcdef1'));

      expect(response.status).toBe(500);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('{"error":"internal"}');
      expect(captured).toHaveLength(1);
      expect(lines).toHaveLength(1);
    },
  );

  it('falls back to the static JSON 500 when building the exception response throws', async () => {
    class BrokenException extends HTTPException {
      override getResponse(): Response {
        throw new Error(piiMessage());
      }
    }
    const app = buildApp(() => new BrokenException(400), { sink: () => {} });

    const response = await request(app, envWith('abcdef1'));

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"error":"internal"}');
  });
});
