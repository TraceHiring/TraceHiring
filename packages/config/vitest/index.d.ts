// Types for `@trace/config/vitest` (./index.js), so workspaces' vitest.config.ts typecheck.
import type { ViteUserConfig } from 'vitest/config';

/** Shared Vitest `test` settings; workspaces spread them into their own config. */
export declare const baseTest: NonNullable<ViteUserConfig['test']>;
