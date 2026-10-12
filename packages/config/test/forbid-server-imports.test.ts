// Vite plugin that stops the apps' bundles from pulling in server-side code (spec §10.1),
// as a build-time backstop for anything the lint rules cannot see.
import { describe, expect, it } from 'vitest';
import { forbidServerImports } from '../vite/forbid-server-imports.js';

const winRoot = 'C:\\repo\\trace';
const posixRoot = '/home/ci/trace';

const winPlugin = forbidServerImports({ root: winRoot });
const posixPlugin = forbidServerImports({ root: posixRoot });

describe('forbid-server-imports: load', () => {
  it.each([
    [winPlugin, 'C:\\repo\\trace\\packages\\vendors\\src\\index.ts'],
    [winPlugin, 'C:/repo/trace/packages/config/eslint/index.js'],
    [winPlugin, 'c:/Repo/Trace/workers/edge/src/index.ts'],
    [winPlugin, '/@fs/C:/repo/trace/services/api/src/index.ts'],
    [winPlugin, 'C:/repo/trace/workers/jobs/src/x.ts?import&t=1'],
    [winPlugin, '\0C:/repo/trace/packages/vendors/src/index.ts?commonjs-proxy'],
    [winPlugin, 'C:/repo/trace/node_modules/@trace/vendors/src/index.ts'],
    [posixPlugin, '/home/ci/trace/packages/vendors/src/index.ts'],
    [posixPlugin, '/home/ci/trace/workers/edge/src/index.ts'],
    [posixPlugin, '/home/ci/trace/services/api/src/modules/integrity/band.ts'],
    [posixPlugin, '/home/ci/trace/packages/config/vite/forbid-server-imports.js'],
    [posixPlugin, '/home/ci/trace/apps/candidate/node_modules/@trace/api/src/index.ts'],
  ])('throws for %#', (plugin, id) => {
    expect(() => plugin.load(id)).toThrow(/server-side code/);
  });

  it.each([
    [winPlugin, 'C:\\repo\\trace\\packages\\shared\\src\\index.ts'],
    [winPlugin, 'C:/repo/trace/packages/ui/src/index.ts'],
    [winPlugin, 'C:/repo/trace/apps/candidate/src/main.tsx'],
    [winPlugin, 'C:/repo/trace/packages/vendors-docs/x.ts'],
    [winPlugin, 'C:/repo/trace/workersx/x.ts'],
    [posixPlugin, '/home/ci/trace/packages/db-types/src/index.ts'],
    [posixPlugin, '/home/ci/trace/node_modules/.pnpm/react@19.3.0/node_modules/react/index.js'],
    [posixPlugin, '/elsewhere/workers/edge/src/index.ts'],
    [posixPlugin, '\0vite/preload-helper.js'],
  ])('allows %#', (plugin, id) => {
    expect(plugin.load(id)).toBeNull();
  });
});

describe('forbid-server-imports: resolveId', () => {
  const ctx = (id: string | null) => ({
    resolve: async () => (id === null ? null : { id }),
  });

  it('throws when the resolved id is server-side', async () => {
    await expect(
      posixPlugin.resolveId.call(
        ctx('/home/ci/trace/packages/vendors/src/index.ts'),
        '../../packages/vendors',
        '/home/ci/trace/apps/candidate/src/main.tsx',
        {},
      ),
    ).rejects.toThrow(/server-side code/);
  });

  it.each(['@trace/vendors', '@trace/config/vite', '@trace/edge', '@trace/jobs', '@trace/api/x'])(
    'throws for the package name %s before resolving',
    async (source) => {
      await expect(
        posixPlugin.resolveId.call(ctx(null), source, '/home/ci/trace/apps/x/src/a.ts', {}),
      ).rejects.toThrow(/server-side code/);
    },
  );

  it('names the importer relative to the repo root only', async () => {
    const attempt = posixPlugin.resolveId.call(
      ctx(null),
      '@trace/vendors',
      '/home/ci/trace/apps/candidate/src/main.tsx',
      {},
    );
    await expect(attempt).rejects.toThrow(/imported from apps\/candidate\/src\/main\.tsx\)/);
    await expect(
      posixPlugin.resolveId.call(ctx(null), '@trace/vendors', '/home/ci/trace/apps/x.ts', {}),
    ).rejects.not.toThrow(/home\/ci/);
  });

  it('passes allowed ids through', async () => {
    const resolved = await posixPlugin.resolveId.call(
      ctx('/home/ci/trace/packages/shared/src/index.ts'),
      '@trace/shared',
      '/home/ci/trace/apps/candidate/src/main.tsx',
      {},
    );
    expect(resolved).toEqual({ id: '/home/ci/trace/packages/shared/src/index.ts' });
  });

  it('returns null when nothing resolves', async () => {
    const resolved = await posixPlugin.resolveId.call(ctx(null), 'missing', undefined, {});
    expect(resolved).toBeNull();
  });

  it('has a stable name and runs before other resolvers', () => {
    expect(posixPlugin.name).toBe('trace:forbid-server-imports');
    expect(posixPlugin.enforce).toBe('pre');
  });
});
