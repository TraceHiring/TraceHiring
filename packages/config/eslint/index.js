// Shared ESLint flat config for every Trace workspace (spec specs/m0-foundations.md §10.1).
// - JS + typescript-eslint recommended everywhere
// - React hooks + jsx-a11y recommended for apps/**/*.tsx
// - workspace import boundaries and the rule 1 quality/integrity split (./boundaries.js)
// - custom rules in ./rules: logger events are string literals; Vite `define`/`envPrefix` stay safe
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { boundariesConfig } from './boundaries.js';
import trace from './rules/index.js';

/** Repo root: this file lives at packages/config/eslint/index.js. */
export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/.wrangler/**',
  '.claude/worktrees/**',
  '**/worker-configuration.d.ts',
  '**/src/generated/**',
  'packages/db-types/src/database.ts',
];

const SOURCE_FILES = ['**/*.{js,mjs,cjs,ts,mts,cts,tsx,jsx}'];

/**
 * Builds the Trace config with element patterns anchored at `rootPath`.
 * The fixture tests pass a virtual root; everything else uses the default export.
 * @param {{ rootPath?: string }} [options]
 * @returns {import('eslint').Linter.Config[]}
 */
export function createTraceConfig({ rootPath = repoRoot } = {}) {
  return [
    { ignores },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: ['**/*.{js,mjs,cjs}'],
      languageOptions: { globals: { ...globals.node } },
    },
    {
      // CommonJS files (e.g. ./resolver.cjs, which eslint-module-utils loads with require) must use require.
      files: ['**/*.cjs'],
      languageOptions: { sourceType: 'commonjs' },
      rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
    {
      files: ['apps/**/*.tsx'],
      ...reactHooks.configs.flat.recommended,
    },
    {
      files: ['apps/**/*.tsx'],
      ...jsxA11y.flatConfigs.recommended,
    },
    boundariesConfig(rootPath),
    {
      files: SOURCE_FILES,
      plugins: { trace },
      rules: { 'trace/log-event-literal': 'error' },
    },
    {
      files: ['**/vite.config.{ts,mts,js,mjs}'],
      plugins: { trace },
      rules: { 'trace/vite-config-env': 'error' },
    },
  ];
}

/** @type {import('eslint').Linter.Config[]} */
export const traceConfig = createTraceConfig();

export default traceConfig;
