// The edge Worker has no secrets, no database credential and no error reporter (spec §3 D6, §9.2,
// build-notes Q17). The compile-time checks below run in `pnpm typecheck`: they stop compiling if a
// binding, a secret or a reporter key is added. The source scan covers what the types cannot: an
// import of the reporter from @trace/shared/log or of a Sentry package into any non-test file.
import { env } from 'cloudflare:workers';
import { describe, expect, inject, it } from 'vitest';
import { type AppDeps } from './app.js';

// The pool name each vitest project provides (vitest.config.ts).
declare module 'vitest' {
  export interface ProvidedContext {
    bindingPool: 'top' | 'do';
  }
}

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

/**
 * The edge Env holds only the D1 bindings of specs/d1-demo-slice.md §4.2 and public vars: no
 * TRACE_ENV (L-11), no secret and no database credential (L-10). Adding a key fails this type.
 */
export type EnvHoldsOnlyD1Bindings = Assert<
  Equal<
    keyof Env,
    | 'VERSION'
    | 'CANDIDATE_TOKEN_PUBLIC_JWK'
    | 'CANDIDATE_APP_ORIGIN'
    | 'MIRROR_TRANSPORT'
    | 'SESSION'
    | 'OTP'
    | 'PACKAGES'
    | 'EVIDENCE'
    // M1 R5-10: item images, get/head only (check-boundaries rule 11).
    | 'ITEM_MEDIA'
    | 'MIRROR_QUEUE'
    | 'API'
    | 'LINK_LIMITER'
  >
>;
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

/**
 * The exact binding set of each test pool (vitest.config.ts; never deployed). `edge` is the top level of wrangler.jsonc;
 * `edge-do` adds the local miniflare bindings the real SessionDO and InviteOtpDO need, plus the local LINK_LIMITER rate
 * limiter (OPEN-13), and nothing else.
 */
const POOL_BINDINGS: Record<'top' | 'do', string[]> = {
  top: ['VERSION'],
  do: [
    'EVIDENCE',
    'ITEM_MEDIA',
    'LINK_LIMITER',
    'MIRROR_QUEUE',
    'MIRROR_TRANSPORT',
    'OTP',
    'PACKAGES',
    'SESSION',
    'VERSION',
  ],
};

describe('edge Worker has no secrets and no error reporter', () => {
  it('each test pool (never deployed) is bound to exactly its listed set', () => {
    // The test pool adds its own __VITEST_POOL_WORKERS_* services to env; they are not in the config. The
    // deployed dev/staging blocks are pinned by the type assertion above and scripts/test/wrangler-bindings.test.mjs;
    // each pool expects its exact key set here, never a looser one (security review F1). The pool name comes from
    // the config (`provide`), never from env, and an unknown name fails.
    const pool = inject('bindingPool');
    const bindings = Object.keys(env).filter((name) => !name.startsWith('__VITEST_POOL_WORKERS_'));

    expect(Object.keys(POOL_BINDINGS)).toContain(pool);
    expect(bindings.sort()).toEqual(POOL_BINDINGS[pool]);
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
