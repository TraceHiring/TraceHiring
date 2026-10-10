// Shared ESLint flat config for every Trace workspace (spec specs/m0-foundations.md §10.1).
// S1.1 base: JS + typescript-eslint recommended. The boundary and custom rules are added on top of this file.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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

/** @type {import('eslint').Linter.Config[]} */
export const traceConfig = [
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
];

export default traceConfig;
