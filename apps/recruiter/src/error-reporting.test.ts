// AT-9, recruiter part (spec m0-foundations §9.2, §13): errors reach an ErrorReporter only as
// redacted `serializeError` output (no message text, request, user or query data). From D1 the
// reporter is the Sentry adapter (AT-D22, below); which importers may hold a Sentry package is checked
// in packages/shared. Every PII-like value is built at test time, so no literal fixture exists.
import { randomBytes } from 'node:crypto';
import * as Sentry from '@sentry/react';
import { noopErrorReporter, type ErrorReporter, type SerializedError } from '@trace/shared/log';
import {
  SENTRY_DATA_COLLECTION,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from '@trace/shared/sentry';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import {
  errorReporter,
  initErrorReporting,
  installGlobalErrorReporting,
  reportAppError,
  type ErrorSource,
} from './error-reporting';
import { APP_VERSION } from './version';

const hex = (bytes: number): string => randomBytes(bytes).toString('hex');

/** Values that must never reach a reporter, synthesised for this run. */
function synthetic() {
  const email = `${hex(5)}@${hex(4)}.test`;
  const mobile = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const word = `msg${hex(6)}`;
  return { email, mobile, word, all: [email, mobile, word] };
}

/** A reporter that records what it is given. */
function spy() {
  const calls: { err: SerializedError; ctx: { release: string } | undefined }[] = [];
  const reporter: ErrorReporter = {
    capture(err, ctx) {
      calls.push({ err, ctx });
    },
  };
  return { reporter, calls };
}

describe('recruiter error reporting (AT-9)', () => {
  it('uses the Sentry adapter from D1 (AT-D22), which is a no-op until the SDK is initialised', () => {
    expect(errorReporter).not.toBe(noopErrorReporter);
    expect(() => reportAppError(new Error('x'))).not.toThrow();
  });

  it('reports only the serialised error: name, code and stack frames, no message', () => {
    const s = synthetic();
    const { reporter, calls } = spy();
    const err = Object.assign(new Error(`user ${s.email} phone ${s.mobile} ${s.word}`), {
      code: 'ECONNRESET',
    });
    reportAppError(err, reporter);
    expect(calls).toHaveLength(1);
    const reported = calls[0]?.err;
    expect(reported?.name).toBe('Error');
    expect(reported?.code).toBe('ECONNRESET');
    expect(Object.keys(reported ?? {}).every((k) => ['name', 'code', 'stack'].includes(k))).toBe(
      true,
    );
    const text = JSON.stringify(calls[0]);
    for (const value of s.all) expect(text).not.toContain(value);
  });

  it('passes the release (the app version) and nothing else as context', () => {
    const { reporter, calls } = spy();
    reportAppError(new Error('x'), reporter);
    expect(calls[0]?.ctx).toEqual({ release: APP_VERSION });
  });

  it('drops a name that is not an error class name, and any property of the error', () => {
    const s = synthetic();
    const { reporter, calls } = spy();
    const err = Object.assign(new Error('x'), {
      name: s.email,
      user: { email: s.email },
      request: { url: `https://example.test/?q=${s.word}` },
      query: `select ${s.word}`,
    });
    reportAppError(err, reporter);
    expect(calls[0]?.err.name).toBe('Error');
    const text = JSON.stringify(calls[0]);
    for (const value of s.all) expect(text).not.toContain(value);
    expect(text).not.toContain('select');
  });

  it('reports anything that is not an Error as NonError, without its content', () => {
    const s = synthetic();
    const { reporter, calls } = spy();
    reportAppError(`failed for ${s.email}`, reporter);
    reportAppError({ message: s.word, user: s.email }, reporter);
    reportAppError(null, reporter);
    expect(calls.map((c) => c.err)).toEqual([
      { name: 'NonError' },
      { name: 'NonError' },
      { name: 'NonError' },
    ]);
  });

  it('never throws when the reporter does', () => {
    const throwing: ErrorReporter = {
      capture() {
        throw new Error('reporter down');
      },
    };
    expect(() => reportAppError(new Error('x'), throwing)).not.toThrow();
  });
});

describe('global error wiring', () => {
  /** A stand-in for `window` that keeps its listeners. */
  function fakeWindow() {
    const listeners = new Map<string, ((event: Event) => void)[]>();
    const source: ErrorSource = {
      addEventListener(type, listener) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
    };
    const fire = (type: string, props: Record<string, unknown>) => {
      for (const listener of listeners.get(type) ?? [])
        listener(Object.assign(new Event(type), props));
    };
    return { source, listeners, fire };
  }

  it('listens for error and unhandledrejection only', () => {
    const w = fakeWindow();
    installGlobalErrorReporting(w.source, spy().reporter);
    expect([...w.listeners.keys()].sort()).toEqual(['error', 'unhandledrejection']);
  });

  it('reports an uncaught error and an unhandled rejection as serialised errors', () => {
    const s = synthetic();
    const { reporter, calls } = spy();
    const w = fakeWindow();
    installGlobalErrorReporting(w.source, reporter);
    w.fire('error', {
      message: `boom ${s.email}`,
      filename: `https://example.test/${s.word}.js`,
      error: new TypeError(`bad ${s.mobile}`),
    });
    w.fire('unhandledrejection', { reason: `rejected ${s.email}` });
    w.fire('unhandledrejection', { reason: new RangeError(s.word) });
    expect(calls.map((c) => c.err.name)).toEqual(['TypeError', 'NonError', 'RangeError']);
    const text = JSON.stringify(calls);
    for (const value of s.all) expect(text).not.toContain(value);
  });

  it('survives an error event without an error object', () => {
    const { reporter, calls } = spy();
    const w = fakeWindow();
    installGlobalErrorReporting(w.source, reporter);
    expect(() => w.fire('error', { message: 'Script error.' })).not.toThrow();
    expect(calls.map((c) => c.err)).toEqual([{ name: 'NonError' }]);
  });
});

describe('recruiter package', () => {
  it('has @sentry/react as its only Sentry package (d1 AT-D22; no replay or other vendor)', () => {
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((n) => /sentry/i.test(n))).toEqual(['@sentry/react']);
  });
});

// AT-D22 / AT-9-sentry wiring (specs/d1-demo-slice.md AT-D22, m0-foundations §9.2): the SDK
// (@sentry/react) is initialised only when the build var VITE_SENTRY_DSN holds a DSN, with no default
// PII, no tracing, no Session Replay, the scrubber as beforeSend and beforeBreadcrumb, and the release
// APP_VERSION. Its own window handlers and browser sessions are off: installGlobalErrorReporting
// reports window errors, and a session carries the user agent. The DSN is built at run time.
describe('recruiter Sentry wiring (AT-D22)', () => {
  const dsn = (): string => `https://${'ab12'.repeat(8)}@o1.ingest.de.sentry.io/42`;

  /** A stand-in SDK that keeps the options init was called with. */
  const fakeSdk = () => {
    const inits: Record<string, unknown>[] = [];
    return { sdk: { init: (o: Record<string, unknown>) => void inits.push(o) }, inits };
  };

  it('does not initialise the SDK without a DSN', () => {
    const { sdk, inits } = fakeSdk();
    for (const value of [undefined, '', 'not a dsn']) {
      expect(initErrorReporting({ VITE_SENTRY_DSN: value }, sdk)).toBe(false);
    }
    expect(inits).toHaveLength(0);
  });

  it('initialises it with the shared options and without replay, sessions or window handlers', () => {
    const { sdk, inits } = fakeSdk();
    expect(initErrorReporting({ VITE_SENTRY_DSN: dsn() }, sdk)).toBe(true);
    expect(inits).toHaveLength(1);
    const options = inits[0] ?? {};
    expect(options).toMatchObject({
      dsn: dsn(),
      dataCollection: SENTRY_DATA_COLLECTION,
      sendClientReports: false,
      beforeSend: scrubSentryEvent,
      beforeBreadcrumb: scrubSentryBreadcrumb,
    });
    if (APP_VERSION === 'dev' || /[a-f]/.test(APP_VERSION)) {
      expect(options['release']).toBe(APP_VERSION);
    }
    for (const key of Object.keys(options)) expect(key).not.toMatch(/replay|traces/i);
    const integrations = options['integrations'] as (d: { name: string }[]) => { name: string }[];
    const defaults = [
      'GlobalHandlers',
      'BrowserSession',
      'Replay',
      'Feedback',
      'Breadcrumbs',
      'Dedupe',
    ];
    expect(integrations(defaults.map((name) => ({ name }))).map((i) => i.name)).toEqual([
      'Breadcrumbs',
      'Dedupe',
    ]);
  });

  it('with the real SDK, sends one scrubbed event and no message text', async () => {
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
    const s = synthetic();
    try {
      expect(initErrorReporting({ VITE_SENTRY_DSN: dsn() }, Sentry, { transport })).toBe(true);
      reportAppError(Object.assign(new TypeError(`bad ${s.email} ${s.mobile} ${s.word}`), {}));
      await Sentry.flush(2000);
    } finally {
      await Sentry.close(2000);
    }
    const events = envelopes.flatMap((envelope) =>
      ((envelope as [unknown, [{ type?: string }, unknown][]])[1] ?? [])
        .filter(([header]) => header.type === 'event')
        .map(([, payload]) => payload as Record<string, unknown>),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty('user');
    expect(
      (events[0] as { exception?: { values?: unknown[] } }).exception?.values?.[0],
    ).toMatchObject({ type: 'TypeError', value: '[REDACTED]' });
    // No user info is collected, so the SDK tells Relay never to infer the client IP (AT-D22 review, blocker 1).
    // The SDK adds sdk.settings to the event after beforeSend, so the scrubber cannot remove it.
    const sdkInfo = (events[0] as { sdk?: { settings?: { infer_ip?: string } } }).sdk;
    expect(sdkInfo?.settings?.infer_ip).toBe('never');
    const text = JSON.stringify(envelopes);
    for (const value of s.all) expect(text).not.toContain(value);
  });

  it('with the real SDK, a start-photo fetch breadcrumb never reaches Sentry (d1 R3-6)', async () => {
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
    const jti = '7d3f9a21-5c4e-4b8a-9e10-2f6b8c4d1a73';
    try {
      expect(initErrorReporting({ VITE_SENTRY_DSN: dsn() }, Sentry, { transport })).toBe(true);
      Sentry.addBreadcrumb({
        type: 'http',
        category: 'fetch',
        data: {
          url: `https://trace-api-staging.example.workers.dev/media/${jti}?exp=1&sig=c2ln`,
          method: 'GET',
          status_code: 200,
        },
      });
      Sentry.addBreadcrumb({
        type: 'http',
        category: 'fetch',
        data: { url: 'https://trace-api-staging.example.workers.dev/v1/orgs', method: 'GET' },
      });
      reportAppError(new TypeError('synthetic'));
      await Sentry.flush(2000);
    } finally {
      await Sentry.close(2000);
    }
    const text = JSON.stringify(envelopes);
    expect(text).toContain('/v1/orgs');
    expect(text).not.toMatch(/\/media\//i);
    expect(text).not.toContain(jti);
  });
});
