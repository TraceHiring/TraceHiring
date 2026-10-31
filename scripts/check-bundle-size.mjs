#!/usr/bin/env node
// Candidate app bundle budget (spec specs/m0-foundations.md §3 D3, AT-21): initial JS ≤ 150 kB gzip.
// "Initial JS" is every script the first page load fetches before the app can run:
//   - each <script src> and <link rel="modulepreload"> / <link rel="preload" as="script"> in
//     apps/candidate/dist/index.html, plus the text of any inline <script>
//   - every chunk those files and inline module scripts (resolved from the dist root) import
//     statically (`import … from "./x.js"`, `import "./x.js"`, `export … from "./x.js"`),
//     transitively. Dynamic import() chunks load later and do not count.
// Each file is gzipped on its own (zlib default level), since each is a separate request, and the
// sizes are summed. 1 kB = 1,000 bytes, as Vite reports it. Over-counting fails closed.
// Fails (exit 1) when the budget is exceeded, dist/index.html is missing, it names no script, a
// referenced file is missing or outside dist/, or a script is loaded from another origin.
// The start-photo code is one lazy chunk, PhotoStep-<hash>.js, ≤ 60 kB gzip with its own static
// imports, and the only place camera code appears (specs/d1-demo-slice.md §7.1; checkPhotoChunk).
// The recruiter app has no budget in the spec; its size is printed for information only.
// No environment variables. Optional argument: the repository root (default: this script's repo).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** D3: 150 kB gzip. Changing it is a founder decision (spec §3). */
export const CANDIDATE_BUDGET_BYTES = 150 * 1000;
/** d1 §7.1 (inference there): the lazy start-photo chunk, 60 kB gzip. */
export const PHOTO_CHUNK_BUDGET_BYTES = 60 * 1000;
export const BUDGETED_APP = 'candidate';
export const INFO_APPS = ['recruiter'];

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};

/** Scripts index.html loads up front: { files: string[] (URL paths), inline: string[], external: string[] }. */
export function htmlEntries(html) {
  const files = [];
  const inline = [];
  const external = [];
  const add = (url) => {
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) || /^[a-z][a-z0-9+.-]*:/i.test(url))
      external.push(url);
    else files.push(url);
  };
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const src = attr(m[1], 'src');
    if (src !== null) add(src);
    else if (
      m[2].trim() !== '' &&
      !/type\s*=\s*["']?(?:application\/(?:ld\+)?json|importmap)/i.test(m[1])
    )
      inline.push(m[2]);
  }
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const rel = (attr(m[1], 'rel') ?? '').toLowerCase().split(/\s+/);
    const as = (attr(m[1], 'as') ?? '').toLowerCase();
    const href = attr(m[1], 'href');
    if (href === null) continue;
    if (rel.includes('modulepreload') || (rel.includes('preload') && as === 'script')) add(href);
  }
  return { files, inline, external };
}

/** Relative or root-relative specifiers a module imports statically (`//host` is another origin). */
export function staticImports(code) {
  const out = [];
  const re =
    /(?:^|[^\w$.])(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?["']((?:\.{1,2}\/|\/(?!\/))[^"'\s]*)["']/g;
  for (const m of code.matchAll(re)) out.push(m[1]);
  return out;
}

/**
 * Specifiers a module imports from another origin: a scheme (`https:`, `data:` …) or `//host`.
 * They are never counted toward the budget, so they are reported instead (S1.4 re-review N7).
 */
export function crossOriginImports(code) {
  const out = [];
  const re =
    /(?:^|[^\w$.])(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?["']((?:\/\/|[a-zA-Z][a-zA-Z0-9+.-]*:)[^"'\s]*)["']/g;
  for (const m of code.matchAll(re)) out.push(m[1]);
  return out;
}

const fmt = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
const crossOriginError = (url) => `a script imports from another origin: ${url}`;

/**
 * Measures one app's initial JS in `distDir`.
 * @returns {{ total: number, files: { file: string, gzip: number }[], errors: string[] }}
 */
export function measureInitialJs(distDir) {
  const errors = [];
  const files = [];
  const htmlPath = path.join(distDir, 'index.html');
  if (!existsSync(htmlPath))
    return { total: 0, files, errors: ['dist/index.html is missing (build the app first)'] };
  const { files: entries, inline, external } = htmlEntries(readFileSync(htmlPath, 'utf8'));
  for (const url of external) errors.push(`index.html loads a script from another origin: ${url}`);
  if (entries.length === 0 && inline.length === 0) errors.push('index.html loads no script');
  let total = 0;
  inline.forEach((code, i) => {
    const gzip = gzipSync(Buffer.from(code)).length;
    files.push({ file: `index.html <script> #${i + 1}`, gzip });
    total += gzip;
  });
  const queue = entries.map((url) => ({ url, from: null }));
  // An inline module's static imports load up front too; they resolve against index.html, the
  // dist root (`from: null`). A classic script cannot import, so counting every inline script's
  // imports only over-counts, which fails closed (S1.4 security review L8).
  for (const code of inline) {
    for (const url of crossOriginImports(code)) errors.push(crossOriginError(url));
    for (const url of staticImports(code)) queue.push({ url, from: null });
  }
  const walked = staticClosure(distDir, queue, new Set());
  return {
    total: total + walked.total,
    files: [...files, ...walked.files],
    errors: [...errors, ...walked.errors],
  };
}

/**
 * Follows `queue` ({url, from}) and every static import, transitively, once each, skipping the
 * dist-relative paths in `exclude`. Returns { total, files: {file, gzip}[], errors }.
 */
function staticClosure(distDir, queue, exclude) {
  const errors = [];
  const files = [];
  let total = 0;
  const root = path.resolve(distDir);
  const seen = new Set();
  while (queue.length > 0) {
    const { url, from } = queue.shift();
    const clean = decodeURIComponent(url.replace(/[?#].*$/, ''));
    const abs = clean.startsWith('/')
      ? path.resolve(root, `.${clean}`)
      : path.resolve(from ? path.dirname(from) : root, clean);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (rel.startsWith('../') || path.isAbsolute(rel)) {
      errors.push(`script ${url} resolves outside dist/`);
      continue;
    }
    if (seen.has(abs) || exclude.has(rel)) continue;
    seen.add(abs);
    if (!existsSync(abs)) {
      errors.push(`script ${rel} is referenced but missing`);
      continue;
    }
    const buf = readFileSync(abs);
    const gzip = gzipSync(buf).length;
    files.push({ file: rel, gzip });
    total += gzip;
    const code = buf.toString('utf8');
    for (const url of crossOriginImports(code)) errors.push(crossOriginError(url));
    for (const spec of staticImports(code)) queue.push({ url: spec, from: abs });
  }
  return { total, files, errors };
}

/** Every .js file under `dir`, dist-relative with `/` separators. */
function jsFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(abs, base);
    return e.name.endsWith('.js') ? [path.relative(base, abs).split(path.sep).join('/')] : [];
  });
}

/**
 * d1 §7.1: the start-photo code (camera, canvas blur, oval guide) is one dynamic import, the
 * `PhotoStep-<hash>.js` chunk Rollup names after `src/photo/PhotoStep.tsx`, at most 60 kB gzip
 * with the static imports the initial JS does not already load. Camera code (`getUserMedia`, a
 * DOM name minifiers keep) must be in that chunk's own files: never in the initial JS, never in
 * another chunk. No camera code and no chunk passes (an app without a photo step).
 * @returns {{ violations: string[], report: string[] }}
 */
export function checkPhotoChunk(distDir, initial, budget = PHOTO_CHUNK_BUDGET_BYTES) {
  const violations = [];
  const report = [];
  const label = `apps/${BUDGETED_APP}`;
  const initialFiles = new Set(initial.files.map((f) => f.file));
  const all = jsFiles(distDir);
  const chunks = all.filter((f) => /(?:^|\/)PhotoStep-[\w-]+\.js$/.test(f));
  const camera = all.filter((f) =>
    readFileSync(path.join(distDir, ...f.split('/')), 'utf8').includes('getUserMedia'),
  );
  for (const f of camera.filter((c) => initialFiles.has(c)))
    violations.push(`${label}: camera code (getUserMedia) is in the initial JS: ${f}`);
  if (chunks.length > 1) {
    violations.push(`${label}: more than one start-photo chunk: ${chunks.join(', ')}`);
    return { violations, report };
  }
  let own = new Set();
  if (chunks.length === 1) {
    const m = staticClosure(distDir, [{ url: `/${chunks[0]}`, from: null }], initialFiles);
    for (const e of m.errors) violations.push(`${label}: ${e}`);
    own = new Set(m.files.map((f) => f.file));
    const line = `${label} start-photo chunk ${chunks[0]} ${fmt(m.total)} gzip (budget ${fmt(budget)}, ${m.files.length} file(s))`;
    if (m.total > budget) violations.push(`${line} is over budget (d1 §7.1)`);
    else report.push(line);
  } else if (camera.length === 0) report.push(`${label}: no start-photo chunk and no camera code`);
  for (const f of camera.filter((c) => !initialFiles.has(c) && !own.has(c)))
    violations.push(`${label}: camera code (getUserMedia) is outside the start-photo chunk: ${f}`);
  return { violations, report };
}

/** Runs the D3 budget over `root`. Returns { violations: string[], report: string[] }. */
export function runChecks(root, budget = CANDIDATE_BUDGET_BYTES) {
  const violations = [];
  const report = [];
  const c = measureInitialJs(path.join(root, 'apps', BUDGETED_APP, 'dist'));
  for (const e of c.errors) violations.push(`apps/${BUDGETED_APP}: ${e}`);
  if (c.errors.length === 0) {
    const line = `apps/${BUDGETED_APP} initial JS ${fmt(c.total)} gzip (budget ${fmt(budget)}, ${c.files.length} file(s))`;
    if (c.total > budget) {
      violations.push(`${line} is over budget (spec §3 D3)`);
      for (const f of [...c.files].sort((a, b) => b.gzip - a.gzip))
        violations.push(`  ${f.file}: ${fmt(f.gzip)}`);
    } else report.push(line);
    const photo = checkPhotoChunk(path.join(root, 'apps', BUDGETED_APP, 'dist'), c);
    violations.push(...photo.violations);
    report.push(...photo.report);
  }
  for (const app of INFO_APPS) {
    const r = measureInitialJs(path.join(root, 'apps', app, 'dist'));
    report.push(
      r.errors.length > 0
        ? `apps/${app}: not measured (${r.errors[0]})`
        : `apps/${app} initial JS ${fmt(r.total)} gzip (no budget; information only)`,
    );
  }
  return { violations, report };
}

function isMain() {
  if (!process.argv[1]) return false;
  const a = path.resolve(process.argv[1]);
  const b = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isMain()) {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { violations, report } = runChecks(root);
  for (const line of report) console.log(`check-bundle-size: ${line}`);
  for (const line of violations) console.error(`check-bundle-size: ${line}`);
  if (violations.length > 0) process.exit(1);
  console.log('check-bundle-size: OK');
}
