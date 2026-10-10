// The logger's `event` argument must be a string literal (spec §9.1, §10.1).
// Call shape: `<logger>.<debug|info|warn|error>(event, data?)`.
import { describe, expect, it } from 'vitest';
import { ruleMessages } from './helpers.js';

const RULE = 'trace/log-event-literal';
const FILE = 'workers/edge/src/handler.ts';

const wrap = (body: string): string =>
  `declare const logger: any;\ndeclare const log: any;\ndeclare const ctx: any;\ndeclare const requestLogger: any;\ndeclare const name: string;\ndeclare const args: unknown[];\nexport function f(this: any) {\n${body}\n}\n`;

function violations(body: string, file = FILE): number {
  return ruleMessages(file, wrap(body), RULE).length;
}

describe('log-event-literal: allowed', () => {
  it.each([
    "logger.info('session.started', { step: 1 });",
    "log.error('job.failed');",
    "logger.debug('a_b.c_1');",
    "this.logger.warn('item.served');",
    "ctx.log.info('health.ok');",
    "requestLogger.info('request.done');",
    // not a logger call
    'console.info(name);',
    'ctx.info(name);',
    'logger.child(name);',
  ])('%s', (body) => {
    expect(violations(body)).toBe(0);
  });

  it('also applies in apps (tsx)', () => {
    expect(violations("logger.info('page.viewed');", 'apps/candidate/src/App.tsx')).toBe(0);
  });
});

describe('log-event-literal: reported', () => {
  it.each([
    'logger.info(name);',
    'logger.info(`session.${name}`);',
    'logger.info(`session.started`);',
    "logger.warn('session.' + name);",
    'logger.error();',
    'log.error(...args);',
    "logger.info('Session Started');",
    "logger.info('');",
    'this.logger.debug(name);',
    'ctx.log.warn(name);',
    'requestLogger.info(name);',
    "logger.info(name ? 'a.b' : 'c.d');",
  ])('%s', (body) => {
    expect(violations(body)).toBe(1);
  });

  it('also applies in apps (tsx)', () => {
    expect(violations('logger.info(name);', 'apps/candidate/src/App.tsx')).toBe(1);
  });
});
