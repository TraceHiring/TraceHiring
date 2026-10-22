// Workspace import boundaries and the rule 1 quality/integrity split (spec specs/m0-foundations.md §10.1).
// eslint-plugin-boundaries 7.2.0: elements classify folders, files classify quality/integrity/tooling code,
// and `boundaries/dependencies` allows only the listed edges (default: disallow).
// Fail closed: every linted file must be classified (`no-unknown-files`) and every local import must
// land in a known element (`no-unknown-dependencies`), so a directory import, an import of a root file,
// a `#subpath` or a path through node_modules can never slip past as "unknown".
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
  '@trace/workers-http': 'packages/workers-http',
  '@trace/edge': 'workers/edge',
  '@trace/jobs': 'workers/jobs',
  '@trace/api': 'services/api',
};

const resolverPath = require.resolve('./resolver.cjs');
/** @type {{ UNMAPPED_DIR: string }} */
const { UNMAPPED_DIR } = require('./resolver.cjs');

/** Element types (folders), anchored at the repo root (`partialMatch: false`). */
const elements = [
  { type: 'apps', pattern: 'apps/*' },
  { type: 'ui', pattern: 'packages/ui' },
  { type: 'shared', pattern: 'packages/shared' },
  { type: 'vendors', pattern: 'packages/vendors' },
  { type: 'db-types', pattern: 'packages/db-types' },
  // Workers-only HTTP helpers (specs/m0b-tenancy.md §1.1 item 9b): never imported by an app or a package.
  { type: 'workers-http', pattern: 'packages/workers-http' },
  { type: 'config', pattern: 'packages/config' },
  { type: 'edge', pattern: 'workers/edge' },
  { type: 'jobs', pattern: 'workers/jobs' },
  { type: 'api', pattern: 'services/api' },
  { type: 'scripts', pattern: 'scripts' },
  { type: 'supabase', pattern: 'supabase' },
  // An `@trace/*` name missing from `workspacePackages`; no policy allows it.
  { type: 'unmapped-workspace', pattern: `${UNMAPPED_DIR}/*` },
].map((element) => ({ ...element, partialMatch: false }));

/** Every element type except config: what a tooling config may never import. */
const NOT_CONFIG = elements.map((e) => e.type).filter((type) => type !== 'config');

/** Rule 1 (CLAUDE.md): the roots under which quality and integrity code must stay apart. */
const RULE1_ROOTS = '{services/api/src/modules,workers/jobs/src}';

const CONFIG_EXT = '{,.{js,mjs,cjs,ts,mts,cts}}';

const files = [
  { category: 'quality', pattern: `${RULE1_ROOTS}/**/quality/**` },
  { category: 'integrity', pattern: `${RULE1_ROOTS}/**/integrity/**` },
  // Build tooling: root config files (classified only by this category; elements match folders)
  // and each workspace's vite/vitest/eslint config.
  {
    category: 'tooling',
    pattern: [`*.config${CONFIG_EXT}`, `*/*/{vite,vitest,eslint}.config${CONFIG_EXT}`],
  },
];

/** @param {string | string[]} type */
const element = (type) => ({ element: { type } });
/** @param {string} category */
const fileIn = (category) => ({ file: { categories: category } });
const internal = { relationship: { to: 'internal' } };

/**
 * Rule 1 for one side: files in `side` may import only files of the same side in the same host,
 * plus shared/vendors/db-types and npm/Node packages (externals are never checked). Any other local
 * file, including neutral code in the same module tree, could re-export the other side (a bridge).
 * @param {'quality' | 'integrity'} side
 */
const rule1 = (side) => [
  {
    from: fileIn(side),
    disallow: { to: element(['api', 'jobs']) },
    message: `Rule 1: ${side} code may import only other ${side} files and shared packages.`,
  },
  {
    from: fileIn(side),
    allow: { to: fileIn(side), dependency: internal },
  },
];

const policies = [
  // Files inside one element may import each other (checkInternals is on for rule 1).
  { allow: { dependency: internal } },
  { from: element('apps'), allow: { to: element(['ui', 'shared', 'db-types']) } },
  {
    from: element(['edge', 'jobs', 'api']),
    allow: { to: element(['shared', 'vendors', 'db-types', 'workers-http']) },
  },
  { from: element('workers-http'), allow: { to: element('shared') } },
  { from: element('ui'), allow: { to: element('shared') } },
  { from: element('vendors'), allow: { to: element('shared') } },
  // shared, db-types, config, scripts and supabase import no other element.
  // Nothing allows importing an app, a Worker or a service.
  ...rule1('quality'),
  ...rule1('integrity'),
  // Tooling configs may import only @trace/config and their own workspace's tooling files. Last, so it wins.
  {
    from: fileIn('tooling'),
    disallow: { to: element(NOT_CONFIG) },
    message: 'Tooling configs may import only @trace/config.',
  },
  { from: fileIn('tooling'), allow: { to: element('config') } },
  { from: fileIn('tooling'), allow: { to: fileIn('tooling'), dependency: internal } },
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
      'boundaries/no-unknown-dependencies': ['error', { require: 'element' }],
      'boundaries/no-unknown-files': 'error',
    },
  };
}
