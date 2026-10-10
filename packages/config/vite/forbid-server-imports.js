// Vite plugin: the apps' bundles may never contain server-side code (spec specs/m0-foundations.md §10.1).
// Build-time backstop for the ESLint boundaries: whatever path a module arrives by (a relative path,
// a glob, an alias, a symlink), if its resolved id is under packages/vendors, packages/config, workers/
// or services/, the build fails. Ids are normalised first: `\0` virtual prefix, query strings, `/@fs/`,
// Windows separators and drive-letter case.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root: this file lives at packages/config/vite/forbid-server-imports.js. */
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Folders (relative to the repo root) whose code must never reach a browser bundle. */
export const FORBIDDEN_DIRS = ['packages/vendors', 'packages/config', 'workers', 'services'];

/** The same code reached by package name or through node_modules. */
const FORBIDDEN_PACKAGES = [
  '@trace/vendors',
  '@trace/config',
  '@trace/edge',
  '@trace/jobs',
  '@trace/api',
];

/**
 * Normalises a Vite module id or a path for comparison.
 * @param {string} id
 * @returns {string}
 */
function normalise(id) {
  let s = id.startsWith('\0') ? id.slice(1) : id;
  s = s.replace(/[?#].*$/s, '');
  if (s.startsWith('/@fs/')) s = s.slice('/@fs'.length);
  s = s.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (/^\/[A-Za-z]:\//.test(s)) s = s.slice(1);
  return s.replace(/\/+$/, '').toLowerCase();
}

/**
 * True if `source` is a forbidden package name or one of its subpaths.
 * @param {string} source
 */
const isForbiddenPackage = (source) =>
  FORBIDDEN_PACKAGES.some((name) => source === name || source.startsWith(`${name}/`));

/**
 * Which forbidden folder or package `id` belongs to, or null.
 * @param {string} id
 * @param {string} root
 * @returns {string | null}
 */
export function forbiddenReason(id, root) {
  const target = normalise(id);
  const base = normalise(root);
  for (const dir of FORBIDDEN_DIRS) {
    const prefix = `${base}/${dir}`;
    if (target === prefix || target.startsWith(`${prefix}/`)) return dir;
  }
  const viaNodeModules = /\/node_modules\/(@trace\/[^/]+)(?:\/|$)/.exec(target);
  if (viaNodeModules && isForbiddenPackage(viaNodeModules[1] ?? ''))
    return viaNodeModules[1] ?? null;
  return null;
}

/**
 * Importer path relative to the repo root, so build errors carry no absolute (user) paths.
 * @param {string} root
 * @param {string | undefined} importer
 */
function relativeTo(root, importer) {
  if (!importer) return '';
  const base = normalise(root);
  const target = normalise(importer);
  return target.startsWith(`${base}/`) ? target.slice(base.length + 1) : '<outside the repo>';
}

/**
 * @param {string} what
 * @param {string} importer
 */
const failure = (what, importer) =>
  new Error(
    `[trace:forbid-server-imports] ${what} is server-side code and may not be bundled into an app` +
      (importer ? ` (imported from ${importer})` : '') +
      '. See specs/m0-foundations.md §10.1.',
  );

/**
 * @param {{ root?: string }} [options] `root` is the repo root (default: derived from this file).
 */
export function forbidServerImports({ root = defaultRoot } = {}) {
  return {
    name: 'trace:forbid-server-imports',
    /** @type {'pre'} */
    enforce: 'pre',
    /**
     * @this {{ resolve(source: string, importer?: string, options?: Record<string, unknown>): Promise<{ id: string } | null> }}
     * @param {string} source
     * @param {string | undefined} importer
     * @param {Record<string, unknown>} options
     */
    async resolveId(source, importer, options) {
      if (isForbiddenPackage(source)) throw failure(source, relativeTo(root, importer));
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved === null) return null;
      const reason = forbiddenReason(resolved.id, root);
      if (reason !== null) throw failure(reason, relativeTo(root, importer));
      return resolved;
    },
    /** @param {string} id */
    load(id) {
      const reason = forbiddenReason(id, root);
      if (reason !== null) throw failure(reason, '');
      return null;
    },
  };
}

export default forbidServerImports;
