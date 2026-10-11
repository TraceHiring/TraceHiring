// AT-4: verify:fast selects the changed packages and their dependents; global files → full run;
// docs-only → Prettier only (spec §5 "verify:fast algorithm"). Fixture repos are built at test time.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyFile,
  computePlan,
  planVerifyFast,
  shellCommandLine,
  tailLines,
} from '../verify-fast.mjs';
import { commitAll, g, makeRepo, removeDir, writeFiles } from './fixtures/verify/temp-repo.mjs';

const SCRIPT = fileURLToPath(new URL('../verify-fast.mjs', import.meta.url));

const WS = [
  { dir: 'packages/config', name: '@t/config', deps: [] },
  { dir: 'packages/shared', name: '@t/shared', deps: ['@t/config'] },
  { dir: 'packages/ui', name: '@t/ui', deps: ['@t/shared', '@t/config'] },
  { dir: 'apps/candidate', name: '@t/candidate', deps: ['@t/ui', '@t/shared'] },
  { dir: 'workers/edge', name: '@t/edge', deps: ['@t/shared'] },
  { dir: 'services/api', name: '@t/api', deps: [] },
];

const plan = (changed, extra = {}) =>
  planVerifyFast({ base: 'abc123', changed, workspaces: WS, ...extra });

const FULL_STEPS = [
  { label: 'typecheck', tool: 'pnpm', args: ['typecheck'] },
  { label: 'lint', tool: 'pnpm', args: ['lint'] },
  { label: 'test', tool: 'pnpm', args: ['test'] },
];

describe('classifyFile()', () => {
  it.each([
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'eslint.config.js',
    '.prettierrc.json',
    'packages/config/eslint/index.js',
    'packages/config/README.md',
    'scripts/verify-fast.mjs',
    'scripts/README.md',
    'lefthook.yml',
    '.github/workflows/ci.yml',
    'supabase/migrations/20261011000000_m0a_baseline.sql',
    '.gitattributes',
    'apps/orphan/file.ts',
  ])('%s is global', (file) => {
    expect(classifyFile(file, WS)).toEqual({ kind: 'global' });
  });

  it.each(['README.md', 'docs/plan.md', 'docs/design/README.md', 'specs/m0-foundations.md'])(
    '%s is docs',
    (file) => {
      expect(classifyFile(file, WS)).toEqual({ kind: 'docs' });
    },
  );

  it('a markdown file inside a non-global workspace is docs', () => {
    expect(classifyFile('packages/ui/README.md', WS)).toEqual({ kind: 'docs' });
  });

  it('docs/design/tokens.json is an input of packages/ui, not docs (S2 review follow-up 2)', () => {
    expect(classifyFile('docs/design/tokens.json', WS)).toEqual({ kind: 'package', pkg: '@t/ui' });
  });

  it('a package input whose workspace is missing counts as global (fails safe)', () => {
    const noUi = WS.filter((w) => w.dir !== 'packages/ui');
    expect(classifyFile('docs/design/tokens.json', noUi)).toEqual({ kind: 'global' });
  });

  it('a nested package.json is a package change, not a global one', () => {
    expect(classifyFile('apps/candidate/package.json', WS)).toEqual({
      kind: 'package',
      pkg: '@t/candidate',
    });
  });
});

describe('planVerifyFast()', () => {
  it('a design-token change checks @trace/ui and every dependent, not only Prettier', () => {
    const p = plan(['docs/design/tokens.json']);
    expect(p.mode).toBe('packages');
    expect(p.packages).toEqual(['@t/ui']);
    expect(p.affected).toEqual(expect.arrayContaining(['@t/ui', '@t/candidate']));
  });

  it('runs everything when there is no base', () => {
    const p = planVerifyFast({ base: null, changed: [], workspaces: WS });
    expect(p.mode).toBe('full');
    expect(p.reason).toMatch(/merge-base/);
    expect(p.steps).toEqual(FULL_STEPS);
  });

  it('runs everything when any changed path is global, even alongside docs and packages', () => {
    const p = plan(['docs/a.md', 'packages/ui/src/x.ts', 'pnpm-lock.yaml']);
    expect(p.mode).toBe('full');
    expect(p.reason).toContain('pnpm-lock.yaml');
    expect(p.steps).toEqual(FULL_STEPS);
  });

  it('never runs build or anything that needs Docker or the network', () => {
    const all = [
      planVerifyFast({ base: null, changed: [], workspaces: WS }),
      plan(['packages/shared/src/a.ts', 'docs/x.md']),
      plan(['docs/x.md']),
    ].flatMap((p) => p.steps.map((s) => s.args.join(' ')));
    for (const cmd of all) expect(cmd).not.toMatch(/\bbuild\b|test:rls|docker|supabase|install/);
  });

  it('docs-only changes run Prettier on those files only', () => {
    const p = plan(['docs/plan.md', 'specs/m0.md', 'README.md']);
    expect(p.mode).toBe('docs');
    expect(p.steps).toEqual([
      {
        label: 'prettier',
        tool: 'prettier',
        args: ['--check', '--ignore-unknown', 'README.md', 'docs/plan.md', 'specs/m0.md'],
      },
    ]);
  });

  it('docs-only changes that are all deletions have nothing to check', () => {
    const p = plan(['docs/old.md'], { isPresent: () => false });
    expect(p.mode).toBe('docs');
    expect(p.steps).toEqual([]);
  });

  it('a package change runs typecheck, lint and test for it and its dependents, then Prettier', () => {
    const p = plan(['packages/shared/src/a.ts', 'docs/notes.md']);
    expect(p.mode).toBe('packages');
    expect(p.packages).toEqual(['@t/shared']);
    expect(p.affected).toEqual(['@t/candidate', '@t/edge', '@t/shared', '@t/ui']);
    const filter = ['--filter', '...@t/shared', '--if-present', 'run'];
    expect(p.steps).toEqual([
      { label: 'typecheck', tool: 'pnpm', args: [...filter, 'typecheck'] },
      { label: 'lint', tool: 'pnpm', args: [...filter, 'lint'] },
      { label: 'test', tool: 'pnpm', args: [...filter, 'test'] },
      {
        label: 'prettier',
        tool: 'prettier',
        args: ['--check', '--ignore-unknown', 'docs/notes.md', 'packages/shared/src/a.ts'],
      },
    ]);
  });

  it('several changed packages each get a dependents filter', () => {
    const p = plan(['services/api/src/a.ts', 'apps/candidate/src/b.tsx']);
    expect(p.packages).toEqual(['@t/api', '@t/candidate']);
    expect(p.affected).toEqual(['@t/api', '@t/candidate']);
    expect(p.steps[0].args).toEqual([
      '--filter',
      '...@t/api',
      '--filter',
      '...@t/candidate',
      '--if-present',
      'run',
      'typecheck',
    ]);
  });

  it('a deleted file still selects its package but is not passed to Prettier', () => {
    const p = plan(['packages/ui/src/gone.ts', 'packages/ui/src/kept.ts'], {
      isPresent: (f) => f !== 'packages/ui/src/gone.ts',
    });
    expect(p.packages).toEqual(['@t/ui']);
    expect(p.steps.at(-1).args).toEqual(['--check', '--ignore-unknown', 'packages/ui/src/kept.ts']);
  });

  it('a package change whose files are all deleted skips Prettier', () => {
    const p = plan(['packages/ui/src/gone.ts'], { isPresent: () => false });
    expect(p.steps.map((s) => s.label)).toEqual(['typecheck', 'lint', 'test']);
  });

  it('no changes means nothing to run', () => {
    const p = plan([]);
    expect(p.mode).toBe('none');
    expect(p.steps).toEqual([]);
  });
});

describe('shellCommandLine()', () => {
  it('quotes nothing for plain arguments', () => {
    expect(shellCommandLine('pnpm', ['--filter', '...@trace/ui', 'run', 'test'])).toBe(
      'pnpm --filter ...@trace/ui run test',
    );
  });

  it('refuses arguments a shell could reinterpret', () => {
    for (const bad of ['a b', 'a&b', 'a"b', '%PATH%', 'a|b', 'a;b', '$(x)']) {
      expect(() => shellCommandLine('pnpm', [bad])).toThrow(/unsafe/);
    }
  });
});

describe('tailLines()', () => {
  it('keeps the last n lines and ignores a trailing newline', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const out = tailLines(text, 60).split('\n');
    expect(out).toHaveLength(60);
    expect(out[0]).toBe('line 41');
    expect(out.at(-1)).toBe('line 100');
    expect(tailLines('a\nb', 60)).toBe('a\nb');
  });
});

// ---- Fixture git repositories -------------------------------------------------------------

const cleanup = [];
afterEach(() => {
  while (cleanup.length) removeDir(cleanup.pop());
});

function fixtureRepo() {
  const { parent, repo } = makeRepo('trace verify-fast');
  cleanup.push(parent);
  writeFiles(repo, {
    'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n',
    'package.json': { name: 'root', private: true },
    '.gitignore': 'node_modules/\n',
    'README.md': '# Fixture\n',
    'docs/guide.md': '# Guide\n',
    'packages/shared/package.json': { name: '@f/shared' },
    'packages/shared/src/index.ts': 'export const a = 1;\n',
    'packages/ui/package.json': { name: '@f/ui', dependencies: { '@f/shared': 'workspace:*' } },
    'packages/ui/src/index.ts': 'export const b = 2;\n',
    'apps/web/package.json': { name: '@f/web', dependencies: { '@f/ui': 'workspace:*' } },
    'apps/web/src/main.ts': 'export const c = 3;\n',
    'apps/solo/package.json': { name: '@f/solo' },
  });
  commitAll(repo, 'fixture base');
  g(repo, ['switch', '-q', '-c', 'feature']);
  return repo;
}

describe('computePlan() over fixture repositories', () => {
  it('a committed change in a library selects it and every dependent', () => {
    const repo = fixtureRepo();
    writeFiles(repo, { 'packages/shared/src/index.ts': 'export const a = 2;\n' });
    commitAll(repo, 'change shared');
    const { base, plan: p } = computePlan(repo);
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    expect(p.mode).toBe('packages');
    expect(p.packages).toEqual(['@f/shared']);
    expect(p.affected).toEqual(['@f/shared', '@f/ui', '@f/web']);
  });

  it('an untracked file in an app selects only that app', () => {
    const repo = fixtureRepo();
    writeFiles(repo, { 'apps/solo/src/new file.ts': 'export {};\n' });
    const { plan: p, changed } = computePlan(repo);
    expect(changed).toEqual(['apps/solo/src/new file.ts']);
    expect(p.affected).toEqual(['@f/solo']);
  });

  it('docs-only working-tree changes run Prettier only', () => {
    const repo = fixtureRepo();
    writeFiles(repo, { 'docs/guide.md': '# Guide v2\n', 'README.md': '# Fixture v2\n' });
    const { plan: p } = computePlan(repo);
    expect(p.mode).toBe('docs');
    expect(p.steps.map((s) => s.tool)).toEqual(['prettier']);
  });

  it('a root config change runs everything', () => {
    const repo = fixtureRepo();
    writeFiles(repo, { 'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n# x\n' });
    expect(computePlan(repo).plan.mode).toBe('full');
  });

  it('without a local main, everything runs (no remote fallback)', () => {
    const repo = fixtureRepo();
    g(repo, ['branch', '-D', 'main']);
    const { base, plan: p } = computePlan(repo);
    expect(base).toBeNull();
    expect(p.mode).toBe('full');
  });

  it('a deleted file in a package still selects it', () => {
    const repo = fixtureRepo();
    rmSync(join(repo, 'apps/web/src/main.ts'));
    const { plan: p } = computePlan(repo);
    expect(p.affected).toEqual(['@f/web']);
    expect(p.steps.map((s) => s.label)).toEqual(['typecheck', 'lint', 'test']);
  });
});

describe('verify-fast CLI over fixture repositories (Prettier only, no pnpm)', () => {
  const run = (cwd) => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });

  it('exits 0 with nothing to check', () => {
    const repo = fixtureRepo();
    const res = run(repo);
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toMatch(/nothing changed/i);
  });

  it('exits 0 for well-formatted docs-only changes', () => {
    const repo = fixtureRepo();
    writeFiles(repo, { 'docs/guide.md': '# Guide\n\nMore text.\n' });
    const res = run(repo);
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toMatch(/docs-only/);
  });

  it('exits non-zero and names the file for badly formatted docs', () => {
    const repo = fixtureRepo();
    writeFiles(repo, { 'docs/bad file.md': '#   Heading\n\n\n\n*  item\n' });
    const res = run(repo);
    expect(res.status).not.toBe(0);
    expect(res.stdout + res.stderr).toContain('docs/bad file.md');
    expect((res.stdout + res.stderr).trimEnd().split('\n').length).toBeLessThanOrEqual(62);
  });

  it('exits non-zero with a clear reason outside a git repository', () => {
    const { parent } = makeRepo('trace verify-fast-outside');
    cleanup.push(parent);
    const res = run(parent);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/not inside a git repository/i);
  });
});
