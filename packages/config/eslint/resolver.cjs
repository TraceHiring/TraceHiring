// Import resolver for eslint-plugin-boundaries (spec specs/m0-foundations.md §10.1).
// Loaded by eslint-module-utils through the `import/resolver` setting (resolver interface v2), so it is CommonJS.
//
// - `@trace/<name>[/sub]` resolves to the workspace folder from the configured map, so boundaries
//   classifies package-name imports by the workspace they point at (no build output, no node_modules).
// - An unknown `@trace/*` name resolves into a reserved folder that matches the `unmapped-workspace`
//   element, which no policy allows: a new workspace fails closed until it is added to the map.
// - Relative imports resolve against the importing file. A directory resolves through its
//   package.json (`exports["."]`, then `main`) or its index file. A missing target still resolves to
//   its best-guess path so the boundary check runs on files that do not exist yet (TypeScript reports
//   missing files; this resolver only classifies them).
// - Fail closed: `#subpath` imports, `..` inside an `@trace/*` subpath, paths through a `node_modules`
//   folder, and bare names whose installed folder really is a directory inside the repo (a `link:`
//   dependency or a workspace symlink) resolve into a reserved folder that matches no element, so
//   `boundaries/no-unknown-dependencies` reports them.
// - Node built-ins and packages installed from the registry are not found: the plugin treats them as
//   external.
'use strict';

const fs = require('node:fs');
const { isBuiltin } = require('node:module');
const path = require('node:path');

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const SCOPE = '@trace/';
const UNMAPPED_DIR = '__unmapped_workspace__';
const UNRESOLVED_DIR = '__unresolved_import__';
const EXPORT_CONDITIONS = ['types', 'import', 'default', 'require', 'node'];

/** @param {string} file */
function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** @param {string} dir */
function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The target of an `exports` entry: a string, or the first matching condition, depth-first.
 * @param {unknown} entry
 * @returns {string | null}
 */
function exportTarget(entry) {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const target = exportTarget(item);
      if (target !== null) return target;
    }
    return null;
  }
  if (entry !== null && typeof entry === 'object') {
    const record = /** @type {Record<string, unknown>} */ (entry);
    for (const condition of EXPORT_CONDITIONS) {
      if (condition in record) {
        const target = exportTarget(record[condition]);
        if (target !== null) return target;
      }
    }
  }
  return null;
}

/**
 * The entry file a directory's package.json points at (`exports["."]`, then `main`), or null.
 * @param {string} dir
 * @returns {string | null}
 */
function packageEntry(dir) {
  /** @type {{ exports?: unknown, main?: unknown }} */
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  /** @type {unknown} */
  let root = pkg.exports;
  if (root !== null && typeof root === 'object' && !Array.isArray(root)) {
    const record = /** @type {Record<string, unknown>} */ (root);
    if (Object.keys(record).some((key) => key.startsWith('.'))) root = record['.'];
  }
  const target = exportTarget(root) ?? (typeof pkg.main === 'string' ? pkg.main : null);
  return target === null ? null : path.resolve(dir, target);
}

/**
 * Picks an existing file for `base` (as-is, with an extension, through a directory's package.json,
 * or its index); falls back to `base`.
 * @param {string} base
 * @param {number} [depth]
 * @returns {string}
 */
function pickFile(base, depth = 0) {
  if (isFile(base)) return base;
  for (const ext of EXTENSIONS) {
    if (isFile(base + ext)) return base + ext;
  }
  if (depth < 3 && isDirectory(base)) {
    const entry = packageEntry(base);
    if (entry !== null && entry !== base) return pickFile(entry, depth + 1);
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

/** @param {string} p */
const caseFold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

/** @param {string} p */
const segmentsOf = (p) => p.split(/[/\\]+/);

/** @param {string} p */
const hasNodeModules = (p) => segmentsOf(p).includes('node_modules');

/**
 * True if `child` is `parent` or inside it.
 * @param {string} child
 * @param {string} parent
 */
function isInside(child, parent) {
  const rel = path.relative(caseFold(parent), caseFold(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** @param {string} p */
function realpathOr(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

/**
 * Reserved, element-less path for an import that must not be trusted.
 * @param {TraceResolverConfig} config
 * @param {string} source
 */
function unresolved(config, source) {
  return {
    found: true,
    path: path.join(
      config.rootPath,
      UNRESOLVED_DIR,
      Buffer.from(source).toString('hex'),
      'index.ts',
    ),
  };
}

/**
 * True if the bare package `source` is installed (in a node_modules folder above `file`) as a
 * directory that really lives inside the repo, outside any node_modules folder.
 * @param {string} source
 * @param {string} file
 * @param {string} rootPath
 */
function landsInRepo(source, file, rootPath) {
  const parts = source.split('/');
  const name = source.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? source);
  const root = realpathOr(rootPath);
  let dir = path.dirname(file);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(candidate)) {
      const real = realpathOr(candidate);
      return isInside(real, root) && !hasNodeModules(path.relative(root, real));
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * @param {string} source
 * @param {string} file
 * @param {TraceResolverConfig} config
 * @returns {{ found: boolean, path?: string | null }}
 */
function resolve(source, file, config) {
  if (source.startsWith('#')) return unresolved(config, source);
  if (source.startsWith('.') || path.isAbsolute(source)) {
    const target = path.resolve(path.dirname(file), source);
    if (hasNodeModules(target)) return unresolved(config, source);
    return { found: true, path: pickFile(target) };
  }
  if (isBuiltin(source)) return { found: false };
  if (source.startsWith(SCOPE)) {
    const rest = source.slice(SCOPE.length);
    const slash = rest.indexOf('/');
    const name = SCOPE + (slash === -1 ? rest : rest.slice(0, slash));
    const sub = slash === -1 ? '' : rest.slice(slash + 1);
    if (segmentsOf(sub).includes('..')) return unresolved(config, source);
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
  if (landsInRepo(source, file, config.rootPath)) return unresolved(config, source);
  return { found: false };
}

module.exports = { interfaceVersion: 2, resolve, UNMAPPED_DIR, UNRESOLVED_DIR };
