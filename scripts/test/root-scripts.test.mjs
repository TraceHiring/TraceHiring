// Spec specs/m0-foundations.md §5 (S1.7): the root `lint`, `test`, `build` and `verify` scripts run every
// command in the §5 table, in order. A missing or reordered step would silently drop a gate (for example
// test:rls or the full-history gitleaks scan), so this test fails on any difference.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { scripts } = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));

const steps = (name) => (scripts[name] ?? '').split('&&').map((s) => s.trim());

const EXPECTED = {
  typecheck: ['pnpm -r --if-present typecheck'],
  lint: [
    'pnpm -r --if-present lint',
    'prettier --check .',
    'node scripts/check-boundaries.mjs',
    'node scripts/check-workflows.mjs',
    'node scripts/gen-catalog-tests.mjs --check',
    'node scripts/check-migrations.mjs',
    'gitleaks git --redact --no-banner',
  ],
  test: ['pnpm -r --if-present test', 'vitest run --root scripts'],
  'test:rls': ['node scripts/test-rls.mjs'],
  build: [
    'pnpm -r --if-present build',
    'node scripts/check-bundle-size.mjs',
    'node scripts/check-headers.mjs',
    'node scripts/scan-dist.mjs',
  ],
  verify: ['pnpm typecheck', 'pnpm lint', 'pnpm test', 'pnpm test:rls', 'pnpm build'],
  'verify:fast': ['node scripts/verify-fast.mjs'],
  'db:types': ['node scripts/db-types.mjs'],
};

describe('root package.json scripts (spec §5)', () => {
  it.each(Object.entries(EXPECTED))(
    '%s runs exactly the §5 commands, in order',
    (name, expected) => {
      expect(steps(name)).toEqual(expected);
    },
  );

  it('verify runs every gate CLAUDE.md lists: typecheck, lint, unit, RLS tests, build', () => {
    const verify = steps('verify');
    for (const gate of [
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      'pnpm test:rls',
      'pnpm build',
    ]) {
      expect(verify).toContain(gate);
    }
  });

  it('every script a §5 command calls exists in the repo', () => {
    const files = Object.values(EXPECTED)
      .flat()
      .map((cmd) => /^node (scripts\/\S+\.mjs)/.exec(cmd)?.[1])
      .filter(Boolean);
    for (const file of files) {
      expect(() => readFileSync(resolve(repoRoot, file)), file).not.toThrow();
    }
  });
});

describe('workspace scripts the spec pins (revision 16)', () => {
  const pkg = (dir) =>
    JSON.parse(readFileSync(resolve(repoRoot, dir, 'package.json'), 'utf8')).scripts ?? {};

  it('@trace/ui lint also checks that the generated token files are current (§5, §11)', () => {
    const ui = pkg('packages/ui');
    expect(ui['tokens:check']).toBe('node scripts/build-tokens.mjs --check');
    expect(ui.tokens).toBe('node scripts/build-tokens.mjs');
    expect((ui.lint ?? '').split('&&').map((s) => s.trim())).toEqual([
      'eslint . --max-warnings=0',
      'node scripts/build-tokens.mjs --check',
    ]);
  });

  it.each(['workers/edge', 'workers/jobs', 'services/api'])(
    '%s types:gen keeps VERSION a string (wrangler types --strict-vars=false)',
    (dir) => {
      expect(pkg(dir)['types:gen']).toBe('wrangler types --strict-vars=false');
    },
  );
});
