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

  // Spec review L5: ctx.release reaches the reporter only in the logger's version shape (a commit
  // SHA or 'dev'); anything else is dropped, and so is any other field of ctx.
  it.each([
    ['text with a UPI id', `user ${synth.upi()}`],
    ['an email', synth.email()],
    ['a semver', 'v1.2.3'],
    ['an empty string', ''],
    ['a number', 7 as unknown as string],
    // Redactor lows review F7: an all-digit value matches the SHA shape but may be a mobile or an
    // Aadhaar-shaped number (built at run time, synthetic).
    ['an all-digit 10-digit value', '9' + '8'.repeat(9)],
    ['an all-digit 12-digit value', '2345' + '6'.repeat(8)],
  ])('drops a release that is %s', (_label, release) => {
    const capture = vi.fn();
    reportError({ capture }, new Error('x'), { release });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('passes a commit SHA or dev release, and nothing else from ctx', () => {
    const capture = vi.fn();
    const sha = synth.hex();
    reportError({ capture }, new Error('x'), { release: sha });
    reportError({ capture }, new Error('x'), { release: sha.slice(0, 7) });
    const ctx = { release: 'dev', user: synth.email() };
    reportError({ capture }, new Error('x'), ctx);
    expect(capture.mock.calls.map((call) => call[1])).toEqual([
      { release: sha },
      { release: sha.slice(0, 7) },
      { release: 'dev' },
    ]);
  });

  it('ships a no-op reporter in M0a', () => {
    expect(() => noopErrorReporter.capture({ name: 'Error' }, { release: 'dev' })).not.toThrow();
  });

  it('has Sentry packages only in the recruiter app, api and jobs importers (d1 AT-D22)', () => {
    // M0a (revision 10) had none at all. From D1 only the three reporting consumers hold one; the
    // candidate app, workers/edge and the shared packages never do (spec §9.2, build-notes Q17).
    const lock = readFileSync(path.join(workspaceRoot(), 'pnpm-lock.yaml'), 'utf8');
    expect(lock).toMatch(/^importers:$/m);
    // pnpm 12 writes more than one YAML document, each may have an importers section: read them all.
    const sentry: Record<string, string[]> = {};
    let inImporters = false;
    let importer = '';
    for (const line of lock.split('\n')) {
      if (/^\S/.test(line)) inImporters = line === 'importers:';
      if (!inImporters) continue;
      const header = /^ {2}(\S+):$/.exec(line);
      if (header) importer = header[1] ?? '';
      const dep = /^ {6}'?(@sentry\/[^':]+)'?:/.exec(line);
      if (dep) (sentry[importer] ??= []).push(dep[1] ?? '');
    }
    expect(sentry).toEqual({
      'apps/recruiter': ['@sentry/react'],
      'services/api': ['@sentry/cloudflare'],
      'workers/jobs': ['@sentry/cloudflare'],
    });
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

  // Spec review L2 (and redactor review #1's requested test): a message changed after the stack
  // was captured is no longer in the stack's header, so it cannot be used to find the message
  // lines; a frame-shaped one-token line of the old message must still not survive.
  it('drops frame-shaped message lines when the message changed after the stack was captured', () => {
    const word = synth.word(3);
    const err = new Error(`dup ${synth.email()}\nat ${word}.${word}:1:1`);
    expect(err.stack).toContain(`at ${word}.${word}:1:1`); // the stack is built with the message
    err.message = 'other';
    const out = serializeError(err);
    expect(out.stack?.length).toBeGreaterThan(0);
    const text = JSON.stringify(out);
    expect(text).not.toContain(word);
    expect(text).not.toContain('dup');
    for (const frame of out.stack ?? []) expect(frame).toMatch(/^at .*:\d+:\d+\)?$/);
  });

  // Redactor lows review F6: a message line indented like a V8 frame sits right before the real
  // frames. Once the stack was read and the message (or name) then changed, it is neither in the
  // current message nor told apart from the frames by position, so it was kept.
  it.each([
    ['the message', (err: Error) => Object.assign(err, { message: 'other' })],
    ['the name', (err: Error) => Object.assign(err, { name: 'ValidationError' })],
  ])(
    'drops an indented frame-shaped message line when %s changed after the stack was read',
    (_label, change) => {
      const word = synth.word(5);
      const err = new Error(`dup\n    at ${word}.${word}:1:1`);
      expect(err.stack).toContain(`\n    at ${word}.${word}:1:1\n`); // read: the header is now fixed
      change(err);
      const out = serializeError(err);
      expect(out.stack?.length).toBeGreaterThan(0);
      expect(JSON.stringify(out)).not.toContain(word);
    },
  );

  it('keeps only frames with a path or URL location when the header is not the current one', () => {
    const err = new Error('x');
    err.stack = [
      'Error: y',
      '    at f (index.js:1:2)',
      '    at g (/app/a.js:3:4)',
      '    at node:internal/x:5:6',
      '    at h (file:///app/b.js:7:8)',
      '    at k (C:\\app\\c.js:9:1)',
    ].join('\n');
    expect(serializeError(err).stack).toEqual([
      'at g (/app/a.js:3:4)',
      'at node:internal/x:5:6',
      'at h (file:///app/b.js:7:8)',
      'at k (C:\\app\\c.js:9:1)',
    ]);
  });

  it('keeps frames without a path when the header is the current name and message', () => {
    for (const [name, message, header] of [
      ['Error', 'x', 'Error: x'],
      ['TypeError', '', 'TypeError'],
      ['', 'x', 'x'],
    ]) {
      const err = new Error(message);
      err.name = name ?? '';
      err.stack = `${header}\n    at f (index.js:1:2)\n    at [eval]:3:4`;
      expect(serializeError(err).stack).toEqual(['at f (index.js:1:2)', 'at [eval]:3:4']);
    }
  });

  it('skips every header line when the header is the current name and message', () => {
    const word = synth.word(6);
    const message = `dup\n    at ${word}.${word}:1:1\n    at ${word} (/${word}.js:2:2)`;
    const err = new Error(message);
    err.stack = `Error: ${message}\n    at f (index.js:1:2)`;
    expect(serializeError(err).stack).toEqual(['at f (index.js:1:2)']);
  });

  // The header check and the path test are linear: ~100 KB stacks, best of five well inside 50 ms.
  it.each([
    [
      'a long matched header of frame-shaped lines',
      () => {
        const err = new Error('    at a.b:1:1\n'.repeat(6700));
        err.stack = `Error: ${err.message}\n    at f (/a.js:1:2)`;
        return err;
      },
    ],
    [
      'long frames without a path, header not matched',
      () => {
        const err = new Error('x');
        err.stack = `Error: y\n${`    at f (${'a.'.repeat(140)}b:1:2)\n`.repeat(350)}`;
        return err;
      },
    ],
    [
      'long paren-free frames without a path, header not matched',
      () => {
        const err = new Error('x');
        err.stack = `Error: y\n${`    at ${'a.'.repeat(142)}b:1:2\n`.repeat(350)}`;
        return err;
      },
    ],
  ])('serialises a ~100 KB stack of %s well inside 50 ms', (_label, make) => {
    const err = make();
    expect((err.stack ?? '').length).toBeGreaterThanOrEqual(100_000);
    expect(serializeError(err).stack).toHaveLength(err.message === 'x' ? 0 : 1);
    serializeError(err); // warm-up
    let best = Infinity;
    for (let i = 0; i < 5; i += 1) {
      const start = performance.now();
      serializeError(err);
      best = Math.min(best, performance.now() - start);
    }
    expect(best).toBeLessThan(50);
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
