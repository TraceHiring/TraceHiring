// Shared Vitest settings (spec §4). Workspaces spread these into their own vitest.config.ts.
/** @type {import('vitest/config').ViteUserConfig['test']} */
export const baseTest = {
  include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx,mjs}'],
  exclude: ['**/node_modules/**', '**/dist/**', '.claude/worktrees/**'],
  passWithNoTests: false,
};
