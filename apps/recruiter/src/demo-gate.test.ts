// The demo outbox gate (d1 spec §7.1, AT-D18; security review finding 2): the route and nav item exist only
// when the build sets VITE_DEMO_OUTBOX=1 AND it is not a production build (VITE_TRACE_ENV). The real route
// table is re-evaluated under each combination of the two variables.
import type { RouteObject } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function paths(rs: RouteObject[]): string[] {
  return rs.flatMap((r) => [...(r.path === undefined ? [] : [r.path]), ...paths(r.children ?? [])]);
}

async function tablePaths(
  flag: string | undefined,
  traceEnv: string | undefined,
): Promise<string[]> {
  vi.resetModules();
  vi.stubEnv('VITE_DEMO_OUTBOX', flag);
  vi.stubEnv('VITE_TRACE_ENV', traceEnv);
  const { routes } = await import('./routes');
  return paths(routes);
}

describe('the demo outbox gate', () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it('registers the route with the flag "1" and a non-production environment', async () => {
    expect(await tablePaths('1', 'staging')).toContain('demo-outbox');
    expect(await tablePaths('1', undefined)).toContain('demo-outbox');
  });

  it('drops the route in a production environment even with the flag set', async () => {
    expect(await tablePaths('1', 'production')).not.toContain('demo-outbox');
  });

  it('drops the route without the flag, in any environment', async () => {
    expect(await tablePaths(undefined, 'staging')).not.toContain('demo-outbox');
    expect(await tablePaths('0', 'staging')).not.toContain('demo-outbox');
    expect(await tablePaths(undefined, 'production')).not.toContain('demo-outbox');
  });
});
