// Import resolver for eslint-plugin-boundaries (spec specs/m0-foundations.md §10.1).
// Loaded by eslint-module-utils through the `import/resolver` setting (resolver interface v2), so it is CommonJS.
//
// - `@trace/<name>[/sub]` resolves to the workspace folder from the configured map, so boundaries
//   classifies package-name imports by the workspace they point at (no build output, no node_modules).
// - An unknown `@trace/*` name resolves into a reserved folder that matches the `unmapped-workspace`
//   element, which no policy allows: a new workspace fails closed until it is added to the map.
// - Relative imports resolve against the importing file. A missing target still resolves to its
//   best-guess path so the boundary check runs on files that do not exist yet (TypeScript reports
//   missing files; this resolver only classifies them).
// - Everything else is not found, so the plugin treats it as an external package.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const SCOPE = '@trace/';
const UNMAPPED_DIR = '__unmapped_workspace__';

/** @param {string} file */
function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Picks an existing file for `base` (as-is, with an extension, or its index); falls back to `base`.
 * @param {string} base
 * @returns {string}
 */
function pickFile(base) {
  if (isFile(base)) return base;
  for (const ext of EXTENSIONS) {
    if (isFile(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONS) {
    const index = path.join(base, `index${ext}`);
    if (isFile(index)) return index;
  }
  // Rewrite a `.js` specifier to its TypeScript source when that exists (bundler resolution).
  const tsSource = base.replace(/\.(m|c)?js$/, '.$1ts');
  if (tsSource !== base && isFile(tsSource)) return tsSource;
  return base;
}

/**
 * @typedef {{ rootPath: string, packages: Record<string, string> }} TraceResolverConfig
 */

/**
 * @param {string} source
 * @param {string} file
 * @param {TraceResolverConfig} config
 * @returns {{ found: boolean, path?: string | null }}
 */
function resolve(source, file, config) {
  if (source.startsWith('.') || path.isAbsolute(source)) {
    return { found: true, path: pickFile(path.resolve(path.dirname(file), source)) };
  }
  if (source.startsWith(SCOPE)) {
    const rest = source.slice(SCOPE.length);
    const slash = rest.indexOf('/');
    const name = SCOPE + (slash === -1 ? rest : rest.slice(0, slash));
    const sub = slash === -1 ? '' : rest.slice(slash + 1);
    const dir = config.packages[name];
    if (dir === undefined) {
      return { found: true, path: path.join(config.rootPath, UNMAPPED_DIR, rest, 'index.ts') };
    }
    const base = path.join(config.rootPath, dir);
    return {
      found: true,
      path: sub === '' ? path.join(base, 'src', 'index.ts') : pickFile(path.join(base, sub)),
    };
  }
  return { found: false };
}

module.exports = { interfaceVersion: 2, resolve, UNMAPPED_DIR };
