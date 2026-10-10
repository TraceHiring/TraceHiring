// Workspace import boundaries and the rule 1 quality/integrity split (spec specs/m0-foundations.md §10.1).
// eslint-plugin-boundaries 7.2.0: elements classify workspaces, files classify quality/integrity/tooling code,
// and `boundaries/dependencies` allows only the listed edges (default: disallow).
import { createRequire } from 'node:module';
import boundaries from 'eslint-plugin-boundaries';

const require = createRequire(import.meta.url);

/** Package name → workspace folder (spec §2). The resolver maps `@trace/*` imports through this. */
export const workspacePackages = {
  '@trace/candidate': 'apps/candidate',
  '@trace/recruiter': 'apps/recruiter',
  '@trace/config': 'packages/config',
  '@trace/shared': 'packages/shared',
  '@trace/ui': 'packages/ui',
  '@trace/vendors': 'packages/vendors',
  '@trace/db-types': 'packages/db-types',
  '@trace/edge': 'workers/edge',
  '@trace/jobs': 'workers/jobs',
  '@trace/api': 'services/api',
};

const resolverPath = require.resolve('./resolver.cjs');
/** @type {{ UNMAPPED_DIR: string }} */
const { UNMAPPED_DIR } = require('./resolver.cjs');

/** Element types, anchored at the repo root (`partialMatch: false`). */
const elements = [
  { type: 'apps', pattern: 'apps/*' },
  { type: 'ui', pattern: 'packages/ui' },
  { type: 'shared', pattern: 'packages/shared' },
  { type: 'vendors', pattern: 'packages/vendors' },
  { type: 'db-types', pattern: 'packages/db-types' },
  { type: 'config', pattern: 'packages/config' },
  { type: 'edge', pattern: 'workers/edge' },
  { type: 'jobs', pattern: 'workers/jobs' },
  { type: 'api', pattern: 'services/api' },
  // An `@trace/*` name missing from `workspacePackages`; no policy allows it.
  { type: 'unmapped-workspace', pattern: `${UNMAPPED_DIR}/*` },
].map((element) => ({ ...element, partialMatch: false }));

/** Rule 1 (CLAUDE.md): the roots under which quality and integrity code must stay apart. */
const RULE1_ROOTS = '{services/api/src/modules,workers/jobs/src}';

const files = [
  { category: 'quality', pattern: `${RULE1_ROOTS}/**/quality/**` },
  { category: 'integrity', pattern: `${RULE1_ROOTS}/**/integrity/**` },
  {
    category: 'tooling',
    pattern: ['eslint.config.js', '*/*/{vite,vitest}.config.ts', '*/*/eslint.config.js'],
  },
];

/** @param {string | string[]} type */
const element = (type) => ({ element: { type } });

const policies = [
  // Files inside one workspace may import each other (checkInternals is on for the rule 1 policy below).
  { allow: { dependency: { relationship: { to: 'internal' } } } },
  { from: element('apps'), allow: { to: element(['ui', 'shared', 'db-types']) } },
  {
    from: element(['edge', 'jobs', 'api']),
    allow: { to: element(['shared', 'vendors', 'db-types']) },
  },
  { from: element('ui'), allow: { to: element('shared') } },
  { from: element('vendors'), allow: { to: element('shared') } },
  // shared, db-types and config import no other workspace. Nothing allows importing an app, Worker or service.
  // Build tooling (vite/vitest/eslint configs) may read the shared config package.
  { from: { file: { categories: 'tooling' } }, allow: { to: element('config') } },
  // Rule 1: quality and integrity never import each other, relative imports included. Last, so it wins.
  {
    from: { file: { categories: 'quality' } },
    disallow: { to: { file: { categories: 'integrity' } } },
    message: 'Rule 1: quality code may not import integrity code.',
  },
  {
    from: { file: { categories: 'integrity' } },
    disallow: { to: { file: { categories: 'quality' } } },
    message: 'Rule 1: integrity code may not import quality code.',
  },
];

/**
 * Flat-config block for the boundary checks.
 * @param {string} rootPath absolute repo root; element and file patterns are relative to it
 * @returns {import('eslint').Linter.Config}
 */
export function boundariesConfig(rootPath) {
  return {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx,jsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': rootPath,
      'boundaries/elements': elements,
      'boundaries/files': files,
      'boundaries/legacy-templates': false,
      'import/resolver': { [resolverPath]: { rootPath, packages: workspacePackages } },
    },
    rules: {
      'boundaries/dependencies': ['error', { default: 'disallow', checkInternals: true, policies }],
    },
  };
}
