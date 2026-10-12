// Module paths the boundaries plugin cannot see must be static and local (spec §10.1):
// import()/require() take a string literal; import.meta.glob patterns start with './' and never climb;
// new URL(<path>, import.meta.url) never climbs out with '../'.
import { describe, expect, it } from 'vitest';
import { ruleMessages } from './helpers.js';

const RULE = 'trace/static-module-paths';
const FILE = 'apps/candidate/src/main.ts';

const head =
  'declare const require: (id: string) => unknown;\ndeclare const name: string;\ndeclare const pattern: string;\n';

function violations(code: string, file = FILE): number {
  return ruleMessages(file, head + code, RULE).length;
}

describe('static-module-paths: allowed', () => {
  it.each([
    "export const a = import('./routes/home');",
    "export const a = import('@trace/shared');",
    "export const a = require('./x');",
    "export const g = import.meta.glob('./routes/*.tsx');",
    "export const g = import.meta.glob(['./a/*.ts', './b/**/*.ts'], { eager: true });",
    "export const u = new URL('./logo.png', import.meta.url);",
    'export const u = new URL(`./icons/${name}.svg`, import.meta.url);',
    "export const u = new URL('https://example.invalid/x');",
    "export const u = new URL(name, 'https://example.invalid/');",
  ])('%s', (code) => {
    expect(violations(code)).toBe(0);
  });
});

describe('static-module-paths: reported', () => {
  it.each([
    'export const a = import(name);',
    'export const a = import(`./routes/${name}`);',
    'export const a = import(`./routes/home`);',
    "export const a = import('./routes/' + name);",
    'export const a = require(name);',
    'export const a = require(`./x`);',
    "export const g = import.meta.glob('../../../packages/vendors/**');",
    "export const g = import.meta.glob('/src/**/*.ts');",
    "export const g = import.meta.glob('**/*.ts');",
    "export const g = import.meta.glob('./../../workers/**');",
    "export const g = import.meta.glob(['./a/*', '../b/*']);",
    "export const g = import.meta.glob(['./a/*', '!../b/*']);",
    'export const g = import.meta.glob(pattern);',
    'export const g = import.meta.glob([pattern]);',
    "export const u = new URL('../../../packages/vendors/x.ts', import.meta.url);",
    "export const u = new URL('./a/../../x.ts', import.meta.url);",
    "export const u = new URL('..\\\\..\\\\x.ts', import.meta.url);",
    'export const u = new URL(`../${name}.png`, import.meta.url);',
    'export const u = new URL(name, import.meta.url);',
  ])('%s', (code) => {
    expect(violations(code)).toBeGreaterThan(0);
  });

  it('applies in every workspace', () => {
    expect(violations('export const a = import(name);', 'workers/edge/src/index.ts')).toBe(1);
    expect(violations('export const a = import(name);', 'packages/ui/src/index.ts')).toBe(1);
  });
});
