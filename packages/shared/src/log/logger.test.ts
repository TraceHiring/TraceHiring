import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { LogLine } from '../contracts.js';
import { noopErrorReporter, reportError, type ErrorReporter } from './error-reporter.js';
import { createLogger } from './logger.js';
import { REDACTED } from './redact.js';
import { serializeError } from './serialize-error.js';
import { synth } from './synth.test-helpers.js';

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
    const dynamic = `user ${synth.email()}` as 'x';
    log.info(dynamic);
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
    const { log } = capture();
    const dynamic: string = 'a.b';
    // @ts-expect-error a non-literal string is not a valid event
    log.info(dynamic);
    log.info('a.b');
    expect(true).toBe(true);
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
    const lock = readFileSync(
      fileURLToPath(new URL('../../../../pnpm-lock.yaml', import.meta.url)),
      'utf8',
    );
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
    log.info(`otp.sent.${synth.mobile()}` as 'x');
    log.info('a'.repeat(100) as 'x');
    expect(parsed().map((l) => l.event)).toEqual(['log.invalid_event', 'log.invalid_event']);
  });
});
