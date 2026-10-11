// The edge Worker has no secrets, no database credential and no error reporter (spec §3 D6, §9.2,
// build-notes Q17). The compile-time checks below run in `pnpm typecheck`: they stop compiling if a
// binding, a secret or a reporter key is added. The source scan covers what the types cannot: an
// import of the reporter from @trace/shared/log or of a Sentry package into any non-test file.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { type AppDeps } from './app.js';

// Vite's compile-time glob is not in this package's types (no vite/client), so declare the one
// shape used here.
declare global {
  interface ImportMeta {
    glob(
      patterns: string[],
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>;
  }
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

/** The only var the edge Worker is configured with is the public build version. */
export type EnvHoldsOnlyVersion = Assert<Equal<keyof Env, 'VERSION'>>;
/** The app factory accepts a clock and a log sink, and no reporter. */
export type DepsHaveNoReporter = Assert<Equal<keyof AppDeps, 'now' | 'sink'>>;

const FORBIDDEN = /reportError|noopErrorReporter|ErrorReporter|@sentry\//;

/** The paths of the sources that mention the reporter or a Sentry package. */
const findReporterReferences = (sources: Record<string, string>): string[] =>
  Object.entries(sources)
    .filter(([, text]) => FORBIDDEN.test(text))
    .map(([path]) => path)
    .sort();

// Every non-test source file of this Worker, as raw text. The repo's static-module-paths rule
// allows only patterns that start with './', so test files are filtered out after the glob.
const allSources = import.meta.glob(['./**/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const edgeSources: Record<string, string> = Object.fromEntries(
  Object.entries(allSources).filter(([path]) => !path.endsWith('.test.ts')),
);

describe('edge Worker has no secrets and no error reporter', () => {
  it('is bound to nothing but the VERSION var', () => {
    // The test pool adds its own __VITEST_POOL_WORKERS_* services to env; they are not in the config.
    const bindings = Object.keys(env).filter((name) => !name.startsWith('__VITEST_POOL_WORKERS_'));

    expect(bindings).toEqual(['VERSION']);
  });

  it('finds a reporter reference in a synthetic source, so the scan can fail', () => {
    const sentry = ['@sentry', 'cloudflare'].join('/');
    const clean = 'export const answer = 42;';
    const sources = {
      './clean.ts': clean,
      './named.ts': "import { reportError } from '@trace/shared/log';",
      './noop.ts': 'const reporter = noopErrorReporter;',
      './type.ts': 'let reporter: ErrorReporter;',
      './sentry.ts': `import * as Sentry from '${sentry}';`,
    };

    expect(findReporterReferences(sources)).toEqual([
      './named.ts',
      './noop.ts',
      './sentry.ts',
      './type.ts',
    ]);
    expect(findReporterReferences({ './clean.ts': clean })).toEqual([]);
  });

  it('scans the real sources, and none of them mentions a reporter or Sentry', () => {
    // Guards the glob itself: an empty scan would pass for the wrong reason.
    expect(Object.keys(edgeSources)).toEqual(expect.arrayContaining(['./app.ts', './index.ts']));
    expect(Object.keys(edgeSources).some((path) => path.endsWith('.test.ts'))).toBe(false);

    expect(findReporterReferences(edgeSources)).toEqual([]);
  });
});
