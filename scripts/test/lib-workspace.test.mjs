// Unit tests for scripts/lib/workspace.mjs (spec §5 verify:fast step 5: changed packages + dependents).
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  dependentsClosure,
  loadWorkspaces,
  matchesWorkspaceGlob,
  packageForFile,
  parseWorkspaceGlobs,
} from '../lib/workspace.mjs';
import { makeTempDir, removeDir, writeFiles } from './fixtures/verify/temp-repo.mjs';

const cleanup = [];
afterEach(() => {
  while (cleanup.length) removeDir(cleanup.pop());
});

const YAML = `# comment
packages:
  - apps/*
  - 'packages/*'
  - "workers/*"
  - services/api # trailing comment
  - '!packages/ignored'

catalog:
  typescript: 6.0.3
`;

describe('parseWorkspaceGlobs()', () => {
  it('reads the packages list and ignores comments, quotes and later sections', () => {
    expect(parseWorkspaceGlobs(YAML)).toEqual([
      'apps/*',
      'packages/*',
      'workers/*',
      'services/api',
      '!packages/ignored',
    ]);
  });

  it('throws when there is no packages list', () => {
    expect(() => parseWorkspaceGlobs('catalog:\n  a: 1\n')).toThrow(/packages/);
  });

  it('rejects glob forms it cannot evaluate exactly', () => {
    expect(() => parseWorkspaceGlobs('packages:\n  - apps/**\n')).toThrow(/apps\/\*\*/);
    expect(() => parseWorkspaceGlobs('packages:\n  - apps/a*\n')).toThrow(/apps\/a\*/);
  });
});

describe('matchesWorkspaceGlob()', () => {
  it('matches one path segment per *', () => {
    expect(matchesWorkspaceGlob('apps/*', 'apps/candidate')).toBe(true);
    expect(matchesWorkspaceGlob('apps/*', 'apps/candidate/src')).toBe(false);
    expect(matchesWorkspaceGlob('apps/*', 'apps')).toBe(false);
    expect(matchesWorkspaceGlob('services/api', 'services/api')).toBe(true);
    expect(matchesWorkspaceGlob('services/api', 'services/apix')).toBe(false);
  });
});

function fixtureTree() {
  const root = makeTempDir('trace lib-workspace');
  cleanup.push(root);
  writeFiles(root, {
    'pnpm-workspace.yaml': YAML,
    'package.json': { name: 'root', private: true },
    'packages/config/package.json': { name: '@t/config' },
    'packages/shared/package.json': {
      name: '@t/shared',
      devDependencies: { '@t/config': 'workspace:*' },
    },
    'packages/ui/package.json': {
      name: '@t/ui',
      dependencies: { '@t/shared': 'workspace:*', react: '19.3.0' },
    },
    'packages/ignored/package.json': { name: '@t/ignored' },
    'packages/no-manifest/README.md': 'not a package\n',
    'apps/candidate/package.json': {
      name: '@t/candidate',
      dependencies: { '@t/ui': 'workspace:*' },
    },
    'apps/candidate-tools/package.json': { name: '@t/candidate-tools' },
    'workers/edge/package.json': {
      name: '@t/edge',
      dependencies: { '@t/shared': 'workspace:*' },
      peerDependencies: { '@t/edge': '*' },
    },
    'services/api/package.json': {
      name: '@t/api',
      optionalDependencies: { '@t/shared': 'workspace:*' },
    },
    'services/other/package.json': { name: '@t/other' },
  });
  return root;
}

describe('loadWorkspaces()', () => {
  it('expands globs, skips directories without package.json and applies exclusions', () => {
    const ws = loadWorkspaces(fixtureTree());
    expect(ws.map((w) => [w.dir, w.name])).toEqual([
      ['apps/candidate', '@t/candidate'],
      ['apps/candidate-tools', '@t/candidate-tools'],
      ['packages/config', '@t/config'],
      ['packages/shared', '@t/shared'],
      ['packages/ui', '@t/ui'],
      ['services/api', '@t/api'],
      ['workers/edge', '@t/edge'],
    ]);
  });

  it('keeps only workspace-internal dependencies, from every dependency field', () => {
    const ws = loadWorkspaces(fixtureTree());
    const byName = Object.fromEntries(ws.map((w) => [w.name, w.deps]));
    expect(byName['@t/ui']).toEqual(['@t/shared']);
    expect(byName['@t/shared']).toEqual(['@t/config']);
    expect(byName['@t/api']).toEqual(['@t/shared']);
    expect(byName['@t/edge']).toEqual(['@t/shared']); // self-reference dropped
  });

  it('works on the real repository', () => {
    const ws = loadWorkspaces(fileURLToPath(new URL('../..', import.meta.url)));
    expect(ws.map((w) => w.name)).toContain('@trace/shared');
  });
});

describe('dependentsClosure()', () => {
  it('returns the changed packages plus every transitive dependent, sorted', () => {
    const ws = loadWorkspaces(fixtureTree());
    expect(dependentsClosure(ws, ['@t/shared'])).toEqual([
      '@t/api',
      '@t/candidate',
      '@t/edge',
      '@t/shared',
      '@t/ui',
    ]);
    expect(dependentsClosure(ws, ['@t/ui'])).toEqual(['@t/candidate', '@t/ui']);
    expect(dependentsClosure(ws, ['@t/candidate-tools'])).toEqual(['@t/candidate-tools']);
    expect(dependentsClosure(ws, [])).toEqual([]);
  });

  it('terminates on dependency cycles', () => {
    const ws = [
      { dir: 'a', name: 'a', deps: ['b'] },
      { dir: 'b', name: 'b', deps: ['a'] },
    ];
    expect(dependentsClosure(ws, ['a'])).toEqual(['a', 'b']);
  });
});

describe('packageForFile()', () => {
  it('maps a path to the workspace that contains it, never by bare prefix', () => {
    const ws = loadWorkspaces(fixtureTree());
    expect(packageForFile(ws, 'apps/candidate/src/main.tsx')?.name).toBe('@t/candidate');
    expect(packageForFile(ws, 'apps/candidate-tools/x.ts')?.name).toBe('@t/candidate-tools');
    expect(packageForFile(ws, 'apps/candidate')?.name).toBe('@t/candidate');
    expect(packageForFile(ws, 'packages/ignored/x.ts')).toBeNull();
    expect(packageForFile(ws, 'supabase/config.toml')).toBeNull();
    expect(packageForFile(ws, 'README.md')).toBeNull();
  });
});
