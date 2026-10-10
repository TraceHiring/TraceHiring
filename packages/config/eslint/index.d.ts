// Types for `@trace/config/eslint` (./index.js), so TypeScript consumers resolve the entry.
import type { Linter } from 'eslint';

/** Absolute repo root that element patterns are anchored at. */
export declare const repoRoot: string;

/** Paths every workspace ignores. */
export declare const ignores: string[];

/** Builds the Trace config with element patterns anchored at `rootPath` (default: the repo root). */
export declare function createTraceConfig(options?: { rootPath?: string }): Linter.Config[];

/** The shared flat config; the root eslint.config.js re-exports it. */
export declare const traceConfig: Linter.Config[];

export default traceConfig;
