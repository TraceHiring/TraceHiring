// Vite/Vitest config files (spec §10.1): `define` is an allow-list of literals, `envPrefix` stays 'VITE_',
// and the file may not touch process, loadEnv or fs at all.
import { describe, expect, it } from 'vitest';
import { ruleMessages } from './helpers.js';

const RULE = 'trace/vite-config-env';
const FILE = 'apps/candidate/vite.config.ts';

const head = "import { defineConfig } from 'vite';\n";

function violations(code: string, file = FILE): number {
  return ruleMessages(file, head + code, RULE).length;
}

describe('vite-config-env: allowed', () => {
  it.each([
    'export default defineConfig({});',
    "export default defineConfig({ envPrefix: 'VITE_' });",
    "export default defineConfig({ define: { __APP_VERSION__: JSON.stringify('dev') } });",
    'export default defineConfig({ define: { __A__: \'"x"\', __B__: 1, __C__: true, __D__: null } });',
    "export default defineConfig({ define: { 'import.meta.env.X': JSON.stringify(42) } });",
    "export default { envPrefix: 'VITE_', define: {} };",
    "export default defineConfig({ server: { port: 5173 }, build: { sourcemap: 'hidden' } });",
  ])('%s', (code) => {
    expect(violations(code)).toBe(0);
  });

  it('ignores files that are not a Vite or Vitest config', () => {
    const code =
      'declare const process: any;\nexport const x = { define: { A: process.env.A }, envPrefix: "X_" };';
    expect(violations(code, 'apps/candidate/src/config.ts')).toBe(0);
  });
});

describe('vite-config-env: reported', () => {
  it.each([
    // define values are literals or JSON.stringify(<literal>) only
    'declare const process: any;\nexport default defineConfig({ define: { __SHA__: process.env.GIT_SHA } });',
    "const version = 'dev';\nexport default defineConfig({ define: { __V__: JSON.stringify(version) } });",
    "export default defineConfig({ define: { __V__: JSON.stringify('a', null, 2) } });",
    'export default defineConfig({ define: { __V__: `x` } });',
    'declare const sha: () => string;\nexport default defineConfig({ define: { __SHA__: sha() } });',
    "const d = { A: '1' };\nexport default defineConfig({ define: d });",
    "const d = { A: '1' };\nexport default defineConfig({ define: { ...d } });",
    "export default defineConfig({ define: { get A() { return '1'; } } });",
    "import { define } from './define';\nexport default defineConfig({ define });",
    // process in any form
    'declare const process: any;\nconst { env } = process;\nexport default defineConfig({ define: {} , x: env });',
    'declare const process: any;\nconst p = process;\nexport default defineConfig({ x: p });',
    'declare const process: any;\nfunction e() { return process.env; }\nexport default defineConfig({ define: e() });',
    'export default defineConfig({ server: { port: Number(globalThis.process.env.PORT) } });',
    "export default defineConfig({ x: (globalThis as any)['process'] });",
    "import process from 'node:process';\nexport default defineConfig({ x: process.env });",
    "import { env } from 'process';\nexport default defineConfig({ x: env });",
    // loadEnv in any form
    "import { loadEnv } from 'vite';\nexport default defineConfig({ x: loadEnv('production', '.') });",
    "import { loadEnv as le } from 'vite';\nexport default defineConfig({ x: le('production', '.') });",
    "import * as vite from 'vite';\nexport default defineConfig({ x: vite.loadEnv('production', '.') });",
    "import * as vite from 'vite';\nexport default defineConfig({ x: vite['loadEnv']('production', '.') });",
    // fs
    "import fs from 'node:fs';\nexport default defineConfig({ x: fs });",
    "import { readFileSync } from 'fs';\nexport default defineConfig({ x: readFileSync });",
    "import { readFile } from 'node:fs/promises';\nexport default defineConfig({ x: readFile });",
    "export default defineConfig({ x: import('node:fs') });",
    // envPrefix
    "export default defineConfig({ envPrefix: 'APP_' });",
    "export default defineConfig({ envPrefix: '' });",
    "export default defineConfig({ envPrefix: ['VITE_', 'SECRET_'] });",
    "const p = 'VITE_';\nexport default defineConfig({ envPrefix: p });",
    "export default { envPrefix: 'PUBLIC_' };",
    // indirect access to define/envPrefix
    "export default defineConfig({ ['define']: { A: '1' } });",
    "export default defineConfig({ ['envPrefix']: 'X_' });",
    "const k = 'define';\nexport default defineConfig({ [k]: {} });",
    "export default defineConfig({ [`envPrefix`]: 'X_' });",
    "const cfg = defineConfig({});\ncfg.define = { A: '1' };\nexport default cfg;",
    "const cfg: any = defineConfig({});\ncfg['envPrefix'] = 'X_';\nexport default cfg;",
    'const cfg = {};\nObject.assign(cfg, { define: {} as Record<string, string> });\nexport default cfg;',
  ])('%s', (code) => {
    expect(violations(code)).toBeGreaterThan(0);
  });

  it.each([
    'apps/recruiter/vite.config.ts',
    'apps/candidate/vite.config.mts',
    'apps/candidate/vite.config.cts',
    'apps/candidate/vite.config.js',
    'apps/candidate/vite.config.mjs',
    'apps/candidate/vitest.config.ts',
    'apps/candidate/vitest.config.mts',
    'workers/edge/vitest.config.ts',
  ])('applies to %s', (file) => {
    expect(violations("export default defineConfig({ envPrefix: 'APP_' });", file)).toBe(1);
  });

  it('applies to CommonJS configs', () => {
    const code = "module.exports = { envPrefix: 'APP_', define: { A: require('node:fs') } };";
    expect(
      ruleMessages('apps/candidate/vite.config.cjs', code, RULE).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
