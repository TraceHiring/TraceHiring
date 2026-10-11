// The edge Worker has no secrets, no database credential and no ErrorReporter (spec §3 D6, §9.2,
// build-notes Q17). The compile-time checks below run in `pnpm typecheck`: they stop compiling if a
// binding, a secret or a reporter key is added. The runtime checks cover what the types cannot.
import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from './app.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

/** The only var the edge Worker is configured with is the public build version. */
export type EnvHoldsOnlyVersion = Assert<Equal<keyof Env, 'VERSION'>>;
/** The app factory accepts a clock and a log sink, and no reporter. */
export type DepsHaveNoReporter = Assert<Equal<keyof AppDeps, 'now' | 'sink'>>;

describe('edge Worker has no secrets and no ErrorReporter', () => {
  it('is bound to nothing but the VERSION var', () => {
    // The test pool adds its own __VITEST_POOL_WORKERS_* services to env; they are not in the config.
    const bindings = Object.keys(env).filter((name) => !name.startsWith('__VITEST_POOL_WORKERS_'));

    expect(bindings).toEqual(['VERSION']);
  });

  it('never calls a reporter that is passed in anyway', async () => {
    const capture = vi.fn();
    const app = createApp({
      // @ts-expect-error the edge app's deps have no `reporter` key (spec §9.2)
      reporter: { capture },
      now: () => {
        throw new Error('synthetic clock failure');
      },
      sink: () => {},
    });

    const response = await app.request('https://edge.test/health', undefined, { VERSION: 'dev' });

    expect(response.status).toBe(500);
    expect(capture).not.toHaveBeenCalled();
  });
});
