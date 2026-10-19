// The demo outbox gate (d1 spec §7.1, AT-D18; security review finding 2): the route and nav item exist only
// when the build sets VITE_DEMO_OUTBOX=1 AND VITE_TRACE_ENV is exactly "dev" or "staging" (an allow-list, SEC-W2-1).
// The real route table is re-evaluated under each combination of the two variables.
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

  it('registers the route only with the flag "1" and VITE_TRACE_ENV exactly "dev" or "staging"', async () => {
    expect(await tablePaths('1', 'staging')).toContain('demo-outbox');
    expect(await tablePaths('1', 'dev')).toContain('demo-outbox');
  });

  // SEC-W2-1: an allow-list, so a mistyped or unset flavour never ships the outbox.
  it.each(['production', 'prod', 'Production', 'PRODUCTION', 'Dev', 'Staging', ' dev', '', 'test'])(
    'drops the route with the flag set and VITE_TRACE_ENV=%j',
    async (traceEnv) => {
      expect(await tablePaths('1', traceEnv)).not.toContain('demo-outbox');
    },
  );

  it('drops the route with the flag set and VITE_TRACE_ENV unset', async () => {
    expect(await tablePaths('1', undefined)).not.toContain('demo-outbox');
  });

  it('drops the route without the flag, in any environment', async () => {
    expect(await tablePaths(undefined, 'staging')).not.toContain('demo-outbox');
    expect(await tablePaths('0', 'staging')).not.toContain('demo-outbox');
    expect(await tablePaths(undefined, 'production')).not.toContain('demo-outbox');
  });
});
