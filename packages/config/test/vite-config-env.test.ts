// vite.config.ts: `define` may not read process.env and `envPrefix` must stay 'VITE_' (spec §10.1).
import { describe, expect, it } from 'vitest';
import { ruleMessages } from './helpers.js';

const RULE = 'trace/vite-config-env';
const FILE = 'apps/candidate/vite.config.ts';

const head = "import { defineConfig } from 'vite';\ndeclare const process: any;\n";

function violations(code: string, file = FILE): number {
  return ruleMessages(file, head + code, RULE).length;
}

describe('vite-config-env: allowed', () => {
  it.each([
    'export default defineConfig({});',
    "export default defineConfig({ envPrefix: 'VITE_' });",
    "export default defineConfig({ define: { __APP_VERSION__: JSON.stringify('dev') } });",
    "const version = 'dev';\nexport default defineConfig({ define: { __V__: JSON.stringify(version) } });",
    // process.env outside `define` is not this rule's business (e.g. a port for the dev server)
    'export default defineConfig({ server: { port: Number(process.env.PORT) } });',
    "export default { envPrefix: 'VITE_', define: {} };",
  ])('%s', (code) => {
    expect(violations(code)).toBe(0);
  });

  it('ignores files that are not a Vite config', () => {
    const code = 'export const x = { define: { A: process.env.A }, envPrefix: "X_" };';
    expect(violations(code, 'apps/candidate/src/config.ts')).toBe(0);
  });
});

describe('vite-config-env: reported', () => {
  it.each([
    'export default defineConfig({ define: { __SHA__: process.env.GIT_SHA } });',
    "export default defineConfig({ define: { __SHA__: process.env['GIT_SHA'] } });",
    'export default defineConfig({ define: { __SHA__: JSON.stringify(process.env.GIT_SHA) } });',
    'export default defineConfig({ define: process.env });',
    'export default defineConfig({ define: { ...process.env } });',
    'const sha = process.env.GIT_SHA;\nexport default defineConfig({ define: { __SHA__: sha } });',
    'const { GIT_SHA } = process.env;\nexport default defineConfig({ define: { __SHA__: GIT_SHA } });',
    'const env = process.env;\nconst sha = env.GIT_SHA;\nexport default defineConfig({ define: { __SHA__: sha } });',
    "declare const loadEnv: any;\nconst env = loadEnv('production', '.', '');\nexport default defineConfig({ define: { A: env.A } });",
    "export default defineConfig({ envPrefix: 'APP_' });",
    "export default defineConfig({ envPrefix: '' });",
    "export default defineConfig({ envPrefix: ['VITE_', 'SECRET_'] });",
    "const p = 'VITE_';\nexport default defineConfig({ envPrefix: p });",
    "export default { envPrefix: 'PUBLIC_' };",
  ])('%s', (code) => {
    expect(violations(code)).toBe(1);
  });

  it('applies to the recruiter app too', () => {
    const code = 'export default defineConfig({ define: { A: process.env.A } });';
    expect(violations(code, 'apps/recruiter/vite.config.ts')).toBe(1);
  });
});
