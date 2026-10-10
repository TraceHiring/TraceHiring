// AT-21: scripts/check-bundle-size.mjs keeps the candidate app's initial JS ≤ 150 kB gzip (spec §3 D3).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CANDIDATE_BUDGET_BYTES,
  htmlEntries,
  measureInitialJs,
  runChecks,
  staticImports,
} from '../check-bundle-size.mjs';
import { cleanupTempDirs, makeTempDir, writeFiles } from './fixtures/checks/temp-repo.mjs';

afterEach(cleanupTempDirs);

const SCRIPT = fileURLToPath(new URL('../check-bundle-size.mjs', import.meta.url));

/** Incompressible JS text of about `gzipBytes` gzipped (random base64 in a string literal). */
const heavy = (gzipBytes) => `export const blob="${randomBytes(gzipBytes).toString('base64')}";\n`;
const gz = (s) => gzipSync(Buffer.from(s)).length;

const html = (head) =>
  `<!doctype html>\n<html lang="en">\n  <head>\n    <title>Fixture</title>\n${head}\n  </head>\n  <body><div id="root"></div></body>\n</html>\n`;

const repo = (files) => {
  const root = makeTempDir();
  writeFiles(root, files);
  return root;
};

describe('htmlEntries', () => {
  it('finds module scripts, modulepreloads, script preloads and inline scripts', () => {
    const e = htmlEntries(
      html(
        [
          '<script type="module" crossorigin src="/assets/index-a.js"></script>',
          "<link rel='modulepreload' crossorigin href='/assets/vendor-b.js'>",
          '<link rel="preload" as="script" href=/assets/c.js>',
          '<link rel="preload" as="style" href="/assets/x.css">',
          '<link rel="stylesheet" href="/assets/x.css">',
          '<script>window.a=1</script>',
          '<script type="application/ld+json">{"a":1}</script>',
        ].join('\n'),
      ),
    );
    expect(e).toEqual({
      files: ['/assets/index-a.js', '/assets/vendor-b.js', '/assets/c.js'],
      inline: ['window.a=1'],
      external: [],
    });
  });

  it('reports scripts from another origin', () => {
    expect(
      htmlEntries(
        html(
          '<script src="https://cdn.example.invalid/x.js"></script><script src="//x.invalid/y.js"></script>',
        ),
      ).external,
    ).toEqual(['https://cdn.example.invalid/x.js', '//x.invalid/y.js']);
  });
});

describe('staticImports', () => {
  it('follows static imports and re-exports but not dynamic import()', () => {
    const code = [
      'import{a as b}from"./vendor-1.js";',
      'import "./side-2.js";',
      "export{c}from'../shared-3.js';",
      'export * from "/assets/all-4.js";',
      'const lazy=()=>import("./lazy-5.js");',
      'import x from "react";',
      'obj.import("./not-6.js");',
    ].join('\n');
    expect(staticImports(code)).toEqual([
      './vendor-1.js',
      './side-2.js',
      '../shared-3.js',
      '/assets/all-4.js',
    ]);
  });
});

describe('measureInitialJs', () => {
  it('sums the gzip size of the entry, its static imports (transitively, once each) and inline scripts', () => {
    const entry = 'import"./a.js";import{x}from"./b.js";const l=()=>import("./lazy.js");';
    const a = 'import{y}from"./b.js";export const a=1;';
    const b = 'export const x=2,y=3;';
    const root = repo({
      'dist/index.html': html(
        '<script type="module" src="/assets/index.js"></script><script>1</script>',
      ),
      'dist/assets/index.js': entry,
      'dist/assets/a.js': a,
      'dist/assets/b.js': b,
      'dist/assets/lazy.js': heavy(50_000),
    });
    const r = measureInitialJs(`${root}/dist`);
    expect(r.errors).toEqual([]);
    expect(r.files.map((f) => f.file).sort()).toEqual([
      'assets/a.js',
      'assets/b.js',
      'assets/index.js',
      'index.html <script> #1',
    ]);
    expect(r.total).toBe(gz(entry) + gz(a) + gz(b) + gz('1'));
  });

  // S1.4 security review L8: an inline module's static imports load up front too, resolved
  // against index.html (the dist root).
  it('counts the static imports of an inline module script, resolved from the dist root', () => {
    const vendor = heavy(1_000);
    const shared = 'export const s=1;';
    const inline = 'import"./assets/vendor.js";import{s}from"/assets/shared.js";';
    const root = repo({
      'dist/index.html': html(`<script type="module">${inline}</script>`),
      'dist/assets/vendor.js': vendor,
      'dist/assets/shared.js': shared,
    });
    const r = measureInitialJs(`${root}/dist`);
    expect(r.errors).toEqual([]);
    expect(r.files.map((f) => f.file).sort()).toEqual([
      'assets/shared.js',
      'assets/vendor.js',
      'index.html <script> #1',
    ]);
    expect(r.total).toBe(gz(inline) + gz(vendor) + gz(shared));
  });

  it('fails when an inline module imports a missing chunk or one outside dist/', () => {
    const missing = repo({
      'dist/index.html': html('<script type="module">import "./assets/gone.js";</script>'),
    });
    expect(measureInitialJs(`${missing}/dist`).errors.join('\n')).toMatch(
      /assets\/gone\.js is referenced but missing/,
    );
    const escape = repo({
      'dist/index.html': html('<script type="module">import "../escape.js";</script>'),
    });
    expect(measureInitialJs(`${escape}/dist`).errors.join('\n')).toMatch(/outside dist/);
  });

  it('pushes the candidate over budget through an inline module import', () => {
    const root = repo({
      'apps/candidate/dist/index.html': html(
        '<script type="module">import "./assets/vendor.js";</script>',
      ),
      'apps/candidate/dist/assets/vendor.js': heavy(160_000),
    });
    expect(runChecks(root).violations[0]).toMatch(/over budget/);
  });

  it.each([
    ['no index.html', { 'dist/assets/x.js': 'x' }, /index\.html is missing/],
    ['no script', { 'dist/index.html': html('') }, /loads no script/],
    [
      'a missing entry',
      { 'dist/index.html': html('<script type="module" src="/assets/gone.js"></script>') },
      /assets\/gone\.js is referenced but missing/,
    ],
    [
      'a missing static import',
      {
        'dist/index.html': html('<script type="module" src="/assets/i.js"></script>'),
        'dist/assets/i.js': 'import"./gone.js";',
      },
      /assets\/gone\.js is referenced but missing/,
    ],
    [
      'an import outside dist/',
      {
        'dist/index.html': html('<script type="module" src="/assets/i.js"></script>'),
        'dist/assets/i.js': 'import"../../escape.js";',
      },
      /outside dist/,
    ],
    [
      'a script from another origin',
      { 'dist/index.html': html('<script src="https://cdn.example.invalid/x.js"></script>') },
      /another origin/,
    ],
  ])('fails on %s', (_label, files, re) => {
    const r = measureInitialJs(`${repo(files)}/dist`);
    expect(r.errors.join('\n')).toMatch(re);
  });
});

describe('runChecks and the CLI', () => {
  const app = (entryJs, extra = {}) => ({
    'apps/candidate/dist/index.html': html(
      '<script type="module" src="/assets/index.js"></script>',
    ),
    'apps/candidate/dist/assets/index.js': entryJs,
    ...extra,
  });
  const run = (root) => spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });

  it('budget is 150 kB (D3)', () => {
    expect(CANDIDATE_BUDGET_BYTES).toBe(150_000);
  });

  it('passes under budget and reports the recruiter size without enforcing it', () => {
    const root = repo({
      ...app('import"./vendor.js";', { 'apps/candidate/dist/assets/vendor.js': heavy(100_000) }),
      'apps/recruiter/dist/index.html': html('<script type="module" src="/assets/r.js"></script>'),
      'apps/recruiter/dist/assets/r.js': heavy(200_000),
    });
    const { violations, report } = runChecks(root);
    expect(violations).toEqual([]);
    expect(report.join('\n')).toMatch(/apps\/candidate initial JS .* gzip \(budget 150\.0 kB/);
    expect(report.join('\n')).toMatch(/apps\/recruiter initial JS .* information only/);
    const r = run(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/check-bundle-size: OK/);
  });

  it('fails when a statically imported chunk pushes the candidate over budget', () => {
    const root = repo(
      app('import"./vendor.js";', { 'apps/candidate/dist/assets/vendor.js': heavy(160_000) }),
    );
    const { violations } = runChecks(root);
    expect(violations[0]).toMatch(/over budget/);
    expect(violations.join('\n')).toMatch(/assets\/vendor\.js/);
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/over budget \(spec §3 D3\)/);
  });

  it('does not count a lazily imported chunk', () => {
    const root = repo(
      app('const l=()=>import("./lazy.js");', {
        'apps/candidate/dist/assets/lazy.js': heavy(160_000),
      }),
    );
    expect(runChecks(root).violations).toEqual([]);
  });

  it('fails when the candidate app has not been built', () => {
    const r = run(repo({ 'README.md': 'x' }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/apps\/candidate: dist\/index\.html is missing/);
  });
});
