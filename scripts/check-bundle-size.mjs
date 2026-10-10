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
// The recruiter app has no budget in the spec; its size is printed for information only.
// No environment variables. Optional argument: the repository root (default: this script's repo).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** D3: 150 kB gzip. Changing it is a founder decision (spec §3). */
export const CANDIDATE_BUDGET_BYTES = 150 * 1000;
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

/** Relative or root-relative specifiers a module imports statically. */
export function staticImports(code) {
  const out = [];
  const re =
    /(?:^|[^\w$.])(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?["']((?:\.{1,2})?\/[^"'\s]*)["']/g;
  for (const m of code.matchAll(re)) out.push(m[1]);
  return out;
}

const fmt = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

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
  const root = path.resolve(distDir);
  const seen = new Set();
  const queue = entries.map((url) => ({ url, from: null }));
  // An inline module's static imports load up front too; they resolve against index.html, the
  // dist root (`from: null`). A classic script cannot import, so counting every inline script's
  // imports only over-counts, which fails closed (S1.4 security review L8).
  for (const code of inline) for (const url of staticImports(code)) queue.push({ url, from: null });
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
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (!existsSync(abs)) {
      errors.push(`script ${rel} is referenced but missing`);
      continue;
    }
    const buf = readFileSync(abs);
    const gzip = gzipSync(buf).length;
    files.push({ file: rel, gzip });
    total += gzip;
    for (const spec of staticImports(buf.toString('utf8'))) queue.push({ url: spec, from: abs });
  }
  return { total, files, errors };
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
