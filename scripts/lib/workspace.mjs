// Workspace map for repo scripts (spec specs/m0-foundations.md §5, verify:fast step 5).
// Reads the `packages:` globs from pnpm-workspace.yaml and each package.json, and computes the
// dependents of a package. Supported glob segments: literal names and a bare `*` (one directory
// level), optionally negated with a leading `!`. Anything else throws, so a new glob form can never
// silently drop a package from verify:fast.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

function unquote(s) {
  const t = s.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  return t;
}

function assertSupportedGlob(glob) {
  const body = glob.startsWith('!') ? glob.slice(1) : glob;
  const ok =
    body.length > 0 &&
    body.split('/').every((seg) => seg === '*' || (seg.length > 0 && !/[*?[\]{}!]/.test(seg)));
  if (!ok) throw new Error(`unsupported workspace glob in pnpm-workspace.yaml: ${glob}`);
}

/** The `packages:` list of a pnpm-workspace.yaml file. */
export function parseWorkspaceGlobs(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^packages:\s*(#.*)?$/.test(l));
  if (start < 0) throw new Error('pnpm-workspace.yaml has no top-level packages: list');
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue; // blank or comment
    if (/^\S/.test(line)) break; // next top-level key
    const m = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (!m) throw new Error(`cannot read pnpm-workspace.yaml packages entry: ${line.trim()}`);
    const value = unquote(m[1].replace(/\s+#.*$/, ''));
    assertSupportedGlob(value);
    globs.push(value);
  }
  if (globs.length === 0) throw new Error('pnpm-workspace.yaml packages: list is empty');
  return globs;
}

/** True when the repo-relative directory `dir` matches `glob` (no negation). */
export function matchesWorkspaceGlob(glob, dir) {
  const g = glob.split('/');
  const d = dir.split('/');
  return g.length === d.length && g.every((seg, i) => seg === '*' || seg === d[i]);
}

function expandGlob(root, glob) {
  let dirs = [''];
  for (const seg of glob.split('/')) {
    const next = [];
    for (const base of dirs) {
      const abs = join(root, base);
      if (seg === '*') {
        if (!existsSync(abs)) continue;
        for (const entry of readdirSync(abs, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
            next.push(base ? `${base}/${entry.name}` : entry.name);
          }
        }
      } else {
        const rel = base ? `${base}/${seg}` : seg;
        if (existsSync(join(root, rel)) && statSync(join(root, rel)).isDirectory()) next.push(rel);
      }
    }
    dirs = next;
  }
  return dirs;
}

/**
 * Every workspace package under `root`: `{ dir, name, deps }`, where `dir` is repo-relative with
 * forward slashes and `deps` lists only workspace-internal package names. Sorted by `dir`.
 */
export function loadWorkspaces(root) {
  const globs = parseWorkspaceGlobs(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'));
  const include = globs.filter((g) => !g.startsWith('!'));
  const exclude = globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1));
  const dirs = new Set();
  for (const glob of include) {
    for (const dir of expandGlob(root, glob)) {
      if (exclude.some((x) => matchesWorkspaceGlob(x, dir))) continue;
      if (existsSync(join(root, dir, 'package.json'))) dirs.add(dir);
    }
  }
  const manifests = [...dirs].sort().map((dir) => ({
    dir,
    pkg: JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')),
  }));
  const names = new Set(manifests.map((m) => m.pkg.name));
  return manifests.map(({ dir, pkg }) => {
    if (typeof pkg.name !== 'string' || !pkg.name) {
      throw new Error(`${dir}/package.json has no name`);
    }
    const deps = new Set();
    for (const field of DEP_FIELDS) {
      for (const dep of Object.keys(pkg[field] ?? {})) {
        if (names.has(dep) && dep !== pkg.name) deps.add(dep);
      }
    }
    return { dir, name: pkg.name, deps: [...deps].sort() };
  });
}

/** `names` plus every package that depends on any of them, directly or transitively. Sorted. */
export function dependentsClosure(workspaces, names) {
  const dependents = new Map(workspaces.map((w) => [w.name, []]));
  for (const w of workspaces) {
    for (const dep of w.deps) dependents.get(dep)?.push(w.name);
  }
  const seen = new Set();
  const queue = [...names];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    queue.push(...(dependents.get(name) ?? []));
  }
  return [...seen].sort();
}

/** The workspace whose directory contains the repo-relative `file`, or null. */
export function packageForFile(workspaces, file) {
  let best = null;
  for (const w of workspaces) {
    if (
      (file === w.dir || file.startsWith(`${w.dir}/`)) &&
      (!best || w.dir.length > best.dir.length)
    ) {
      best = w;
    }
  }
  return best;
}
