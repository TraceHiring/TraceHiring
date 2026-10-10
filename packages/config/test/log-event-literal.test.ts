// The logger's `event` argument must be a string literal (spec §9.1, §10.1).
// Call shape: `<logger>.<debug|info|warn|error>(event, data?)`.
import { describe, expect, it } from 'vitest';
import { ruleMessages } from './helpers.js';

const RULE = 'trace/log-event-literal';
const FILE = 'workers/edge/src/handler.ts';

const wrap = (body: string): string =>
  [
    'declare const logger: any;',
    'declare const log: any;',
    'declare const ctx: any;',
    'declare const requestLogger: any;',
    'declare const name: string;',
    'declare const args: unknown[];',
    'declare function createLogger(o: unknown): any;',
    'type T = any;',
    'export class C {',
    '  #logger: any;',
    '  m(this: any) {',
    body,
    '  }',
    '}',
  ].join('\n');

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
    "this.#logger.info('a.b');",
    "logger!.warn('a.b');",
    "(logger as T).error('a.b');",
    "logger['info']('a.b');",
    "logger?.info('a.b');",
    "logger.child({ step: 1 }).info('a.b');",
    "createLogger({}).debug('a.b');",
    "logger.info.call(logger, 'a.b', {});",
    "logger.info.apply(logger, ['a.b', {}]);",
    "logger.info.bind(logger, 'a.b');",
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
    'this.#logger.info(name);',
    'logger!.warn(name);',
    '(logger as T).error(name);',
    '(<T>logger).error(name);',
    '(logger satisfies T).error(name);',
    "logger['info'](name);",
    'logger[name](name);',
    'logger?.info(name);',
    'logger.info!(name);',
    'logger.child({ step: 1 }).info(name);',
    'logger.child({}).child({}).warn(name);',
    'createLogger({}).debug(name);',
    'logger.info.call(logger, name);',
    'logger.info.call(logger);',
    'logger.info.apply(logger, [name]);',
    'logger.info.apply(logger, args);',
    'logger.info.bind(logger, name);',
    'logger.info.bind(logger);',
    'const info = logger.info;\ninfo(name);',
    '[name].forEach(logger.warn);',
  ])('%s', (body) => {
    expect(violations(body)).toBeGreaterThan(0);
  });

  it('also applies in apps (tsx)', () => {
    expect(violations('logger.info(name);', 'apps/candidate/src/App.tsx')).toBe(1);
  });
});
