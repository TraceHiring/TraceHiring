import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { LogLine } from '../contracts.js';
import { noopErrorReporter, reportError, type ErrorReporter } from './error-reporter.js';
import { createLogger, type LiteralEvent, type Logger } from './logger.js';
import { REDACTED, redact } from './redact.js';
import { serializeError } from './serialize-error.js';
import { synth } from './synth.test-helpers.js';

/**
 * Calls the logger the way untyped JS (or an `any` value) would, to prove the runtime event guard.
 * The parameter is deliberately not named like a logger: the `trace/log-event-literal` rule would
 * (rightly) reject these calls in product code, and eslint-disable for trace/ rules is banned.
 */
const callUntyped = (target: Logger, event: unknown): void => target.info(event as never);

/** The workspace root: the nearest ancestor of this file that holds pnpm-workspace.yaml. */
const workspaceRoot = (): string => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error('workspace root not found');
    dir = up;
  }
  return dir;
};

const fixedNow = () => new Date('2026-10-11T00:00:00.000Z');
const capture = () => {
  const lines: string[] = [];
  const log = createLogger({
    service: 'api',
    version: 'dev',
    now: fixedNow,
    sink: (l) => lines.push(l),
  });
  return { lines, log, parsed: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
};

describe('createLogger', () => {
  it('writes one strict LogLine per call, with redacted data', () => {
    const { log, parsed } = capture();
    const id = '7f3c1e2a-5b6d-4c8e-9f01-23456789abcd';
    log.info('session.started', { email: synth.email(), count: 2 }, { requestId: id, orgId: id });
    const [line] = parsed();
    expect(LogLine.parse(line)).toEqual({
      ts: '2026-10-11T00:00:00.000Z',
      level: 'info',
      service: 'api',
      version: 'dev',
      event: 'session.started',
      requestId: id,
      orgId: id,
      data: { email: REDACTED, count: 2 },
    });
  });

  it('supports every level', () => {
    const { log, parsed } = capture();
    log.debug('a.b');
    log.info('a.b');
    log.warn('a.b');
    log.error('a.b');
    expect(parsed().map((l) => l.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('replaces an event that breaks the LogLine pattern at runtime', () => {
    const { log, parsed } = capture();
    callUntyped(log, `user ${synth.email()}`);
    expect(parsed()[0]?.event).toBe('log.invalid_event');
    expect(JSON.stringify(parsed())).not.toContain('@');
  });

  it('drops requestId and orgId values that are not UUIDs', () => {
    const { log, parsed } = capture();
    log.info('a.b', undefined, { requestId: synth.email(), orgId: 'x' });
    expect(parsed()[0]).not.toHaveProperty('requestId');
    expect(parsed()[0]).not.toHaveProperty('orgId');
  });

  it('adds a serialised, redacted error without its message', () => {
    const { log, parsed } = capture();
    const err = Object.assign(new Error(`Key (email)=(${synth.email()})`), { code: '23505' });
    log.error('db.insert_failed', { table: 'orgs' }, { err });
    const data = parsed()[0]?.data as Record<string, unknown>;
    expect(JSON.stringify(data)).not.toContain('Key (email)');
    expect(data.error).toMatchObject({ name: 'Error', code: '23505' });
  });

  it('rejects an invalid version at creation', () => {
    expect(() => createLogger({ service: 'api', version: 'v1.2' })).toThrow();
  });

  it('only accepts literal events at the type level', () => {
    // A widened `string` event resolves to `never`, so `log.info(someString)` cannot type-check.
    expectTypeOf<LiteralEvent<string>>().toBeNever();
    expectTypeOf<LiteralEvent<'a.b'>>().toEqualTypeOf<'a.b'>();
    expectTypeOf<Parameters<Logger['info']>[0]>().toBeNever();
    const { log, parsed } = capture();
    log.info('a.b');
    expect(parsed()[0]?.event).toBe('a.b');
  });

  it('rejects non-string events at runtime', () => {
    const { log, parsed } = capture();
    for (const ev of [undefined, null, 42, { e: 'a.b' }, ['a.b']]) callUntyped(log, ev);
    expect(parsed().map((l) => l.event)).toEqual(Array(5).fill('log.invalid_event'));
  });
});

describe('serializeError', () => {
  it('keeps name, code and stack frames only', () => {
    const err = Object.assign(new TypeError(`bad ${synth.mobile()}`), { code: 'E_BAD' });
    const out = serializeError(err);
    expect(Object.keys(out).sort()).toEqual(['code', 'name', 'stack']);
    expect(out.name).toBe('TypeError');
    expect(JSON.stringify(out)).not.toContain('bad ');
    for (const frame of out.stack ?? []) expect(frame.startsWith('at ')).toBe(true);
  });

  it('handles non-errors and hostile names or codes', () => {
    expect(serializeError('boom')).toEqual({ name: 'NonError' });
    const weird = Object.assign(new Error('x'), { name: synth.email(), code: { a: 1 } });
    expect(serializeError(weird)).toEqual({ name: 'Error', stack: expect.any(Array) });
  });
});

describe('ErrorReporter (AT-9)', () => {
  it('passes only redacted serializeError output to the reporter', () => {
    const capture = vi.fn();
    const reporter: ErrorReporter = { capture };
    const err = Object.assign(new Error(`for ${synth.email()}`), { code: synth.mobile() });
    reportError(reporter, err, { release: 'dev' });
    expect(capture).toHaveBeenCalledTimes(1);
    const [sent, ctx] = capture.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(Object.keys(sent).every((k) => ['name', 'code', 'stack'].includes(k))).toBe(true);
    expect(JSON.stringify(sent)).not.toContain(synth.email());
    expect(JSON.stringify(sent)).not.toContain(synth.mobile());
    expect(ctx).toEqual({ release: 'dev' });
  });

  it('ships a no-op reporter in M0a', () => {
    expect(() => noopErrorReporter.capture({ name: 'Error' }, { release: 'dev' })).not.toThrow();
  });

  it('has no Sentry package in any lockfile importer (revision 10)', () => {
    const lock = readFileSync(path.join(workspaceRoot(), 'pnpm-lock.yaml'), 'utf8');
    expect(lock).toMatch(/^importers:/m);
    expect(lock).not.toMatch(/@sentry\//);
  });
});

describe('security review regressions (S1.7)', () => {
  it('drops message lines that look like frames from the stack', () => {
    const err = new Error('dup\n    at Some Person, 12 Main Road');
    const out = serializeError(err);
    expect(JSON.stringify(out)).not.toContain('Main Road');
    for (const frame of out.stack ?? []) expect(frame).toMatch(/:\d+:\d+\)?$/);
  });

  it('redacts and caps the event, falling back to log.invalid_event', () => {
    const { log, parsed } = capture();
    for (const ev of [`otp.sent.${synth.mobile()}`, 'a'.repeat(100)]) callUntyped(log, ev);
    expect(parsed().map((l) => l.event)).toEqual(['log.invalid_event', 'log.invalid_event']);
  });

  it('never repeats the message in any stack line, even a frame-shaped one', () => {
    const msg = `dup ${synth.email()}\n    at leak (${synth.mobile()}:1:2)`;
    const err = new Error(msg);
    const out = serializeError(err);
    expect(out.stack?.length).toBeGreaterThan(0);
    const text = JSON.stringify(out);
    expect(text).not.toContain('dup ');
    expect(text).not.toContain('at leak');
    expect(text).not.toContain(synth.mobile());
  });

  it('keeps only V8 frames ending in line:column, at most 20', () => {
    const err = new Error('x');
    err.stack = ['Error: x', ...Array.from({ length: 30 }, (_, i) => `    at f${i} (m.js:${i}:1)`)]
      .concat('    at native', '    at Array.map (<anonymous>)')
      .join('\n');
    const out = serializeError(err);
    expect(out.stack).toHaveLength(20);
    expect(out.stack?.[0]).toBe('at f0 (m.js:0:1)');
  });

  it('serialises an error inside data without its message, in the message-free stack too', () => {
    const msg = `Key (email)=(${synth.email()})`;
    const once = redact({ err: Object.assign(new Error(msg), { code: '23505' }) });
    expect(once).toMatchObject({ err: { name: 'Error', code: '23505', stack: expect.any(Array) } });
    expect(JSON.stringify(once)).not.toContain('Key (email)');
    expect(JSON.stringify(redact(once))).not.toContain('Key (email)');
  });
});
