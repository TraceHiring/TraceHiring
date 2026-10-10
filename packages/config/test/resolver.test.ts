// The boundaries import resolver (eslint/resolver.cjs): package names map to workspace folders.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Resolved = { found: boolean; path?: string | null };
type Resolver = {
  interfaceVersion: number;
  resolve: (
    source: string,
    file: string,
    config: { rootPath: string; packages: Record<string, string> },
  ) => Resolved;
  UNMAPPED_DIR: string;
};

const require = createRequire(import.meta.url);
const resolver = require('../eslint/resolver.cjs') as Resolver;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'fixtures', 'virtual-repo');
const config = { rootPath: root, packages: { '@trace/shared': 'packages/shared' } };
const from = path.join(root, 'apps', 'candidate', 'src', 'main.tsx');

describe('resolver.cjs', () => {
  it('implements resolver interface v2', () => {
    expect(resolver.interfaceVersion).toBe(2);
  });

  it('maps a package name to its workspace entry', () => {
    expect(resolver.resolve('@trace/shared', from, config)).toEqual({
      found: true,
      path: path.join(root, 'packages', 'shared', 'src', 'index.ts'),
    });
  });

  it('maps a subpath into the workspace folder', () => {
    expect(resolver.resolve('@trace/shared/log', from, config)).toEqual({
      found: true,
      path: path.join(root, 'packages', 'shared', 'log'),
    });
  });

  it('sends unknown @trace names to the reserved unmapped folder', () => {
    expect(resolver.resolve('@trace/other', from, config)).toEqual({
      found: true,
      path: path.join(root, resolver.UNMAPPED_DIR, 'other', 'index.ts'),
    });
  });

  it('resolves relative imports against the importing file', () => {
    expect(resolver.resolve('./App', from, config)).toEqual({
      found: true,
      path: path.join(root, 'apps', 'candidate', 'src', 'App'),
    });
  });

  it('picks the real file when one exists', () => {
    expect(resolver.resolve('../eslint/index', path.join(here, 'helpers.ts'), config)).toEqual({
      found: true,
      path: path.join(here, '..', 'eslint', 'index.js'),
    });
  });

  it('leaves third-party packages unresolved (external)', () => {
    expect(resolver.resolve('react', from, config)).toEqual({ found: false });
    expect(resolver.resolve('node:path', from, config)).toEqual({ found: false });
  });
});
