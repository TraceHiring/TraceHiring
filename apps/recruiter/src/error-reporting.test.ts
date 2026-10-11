// AT-9, recruiter part (spec m0-foundations §9.2, §13): errors reach an ErrorReporter only as
// redacted `serializeError` output (no message text, request, user or query data); the M0a reporter
// is `noopErrorReporter`; no Sentry package is installed (the lockfile check lives in
// packages/shared). Every PII-like value is built at test time, so no literal fixture exists.
import { randomBytes } from 'node:crypto';
import { noopErrorReporter, type ErrorReporter, type SerializedError } from '@trace/shared/log';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import {
  errorReporter,
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
  it('uses the no-op reporter in M0a', () => {
    expect(errorReporter).toBe(noopErrorReporter);
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
  it('has no Sentry package or DSN (deferred until before D1, revision 10)', () => {
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((n) => /sentry/i.test(n))).toEqual([]);
  });
});
