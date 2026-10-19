// Browser-security hygiene for the candidate app (spec m0-foundations §10.3, AT-22-local).
// The CSP is `script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'`, so the app
// may have no inline script or style, no `style=` attribute, no eval, and no external font or
// stylesheet. These tests read the app's own files (public/_headers, index.html, src/) as text.
// The exact header values stay with `scripts/check-headers.mjs`, which checks the built dist/.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP = 'candidate';
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]): string => readFileSync(path.join(appDir, ...parts), 'utf8');

/** Production files under src/ (no tests), as [relative path, text]. */
const sources: [string, string][] = (
  readdirSync(path.join(appDir, 'src'), { recursive: true, encoding: 'utf8' }) as string[]
)
  .map((file) => file.split(path.sep).join('/'))
  .filter((file) => /\.(?:ts|tsx|css)$/.test(file) && !/\.test(?:-helpers)?\.tsx?$/.test(file))
  .map((file) => [file, read('src', file)]);

/** Inline style or script in markup or code. */
const INLINE_CODE =
  /\sstyle\s*=|<style[\s>]|dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(|setAttribute\(\s*['"]style['"]|javascript:/;

/** A script tag that carries code instead of a src (the closing tag alone does not count). */
const INLINE_SCRIPT = /<script\b[^>]*>\s*(?!<\/script)\S/i;

/** A font or stylesheet fetched from another origin (CSS or markup). */
const EXTERNAL_ASSET =
  /@import|url\(\s*['"]?(?:https?:)?\/\/|(?:href|src)\s*=\s*['"]?(?:https?:)?\/\/|fonts\.googleapis|fonts\.gstatic|use\.typekit|cdnjs|jsdelivr|unpkg/i;

/** A rule in `_headers`: the unindented, non-comment lines. */
const rulesOf = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#') && !/^\s/.test(line))
    .map((line) => line.trim());

describe(`${APP} public/_headers`, () => {
  const text = read('public', '_headers');
  const csp = /^\s+Content-Security-Policy:\s*(.+)$/im.exec(text)?.[1] ?? '';
  const directives = new Map(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0] !== undefined && d[0] !== '')
      .map((d) => [d[0] as string, d.slice(1)] as const),
  );

  it('has exactly one rule, /*', () => {
    expect(rulesOf(text)).toEqual(['/*']);
  });

  it('sets the Content-Security-Policy once', () => {
    expect(text.match(/^\s+Content-Security-Policy:/gim)).toHaveLength(1);
    expect(directives.size).toBeGreaterThanOrEqual(10);
  });

  it('allows no inline script or style, eval, or wildcard source', () => {
    for (const [name, sources] of directives)
      for (const source of sources) {
        expect(source, `${name} ${source}`).not.toMatch(/unsafe-|^\*$|^https?:$|\*/);
        if (['script-src', 'style-src', 'font-src', 'default-src'].includes(name))
          expect(source, `${name} ${source}`).toMatch(/^'self'$/);
      }
  });

  it("limits connect-src to 'self' until the staging edge origin is known (H4)", () => {
    expect(directives.get('connect-src')).toEqual(["'self'"]);
    expect(text).toContain('TODO(H4)');
  });
});

describe(`${APP} index.html`, () => {
  const html = read('index.html');

  it('loads its one script as an external module and has no inline script', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatch(/\ssrc=["']\/src\/main\.tsx["']/);
    expect(html).not.toMatch(INLINE_SCRIPT);
  });

  it('has no inline style, event-handler attribute or external asset', () => {
    expect(html).not.toMatch(INLINE_CODE);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(EXTERNAL_ASSET);
  });
});

describe(`${APP} sources`, () => {
  it('are found', () => {
    expect(sources.map(([file]) => file)).toEqual(
      expect.arrayContaining(['App.tsx', 'App.module.css', 'index.css', 'main.tsx']),
    );
  });

  it('have no inline style or script (no style= attribute, no eval)', () => {
    expect(sources.filter(([, code]) => INLINE_CODE.test(code)).map(([file]) => file)).toEqual([]);
  });

  it('load no font or stylesheet from another origin (fonts are self-hosted in M3b)', () => {
    expect(sources.filter(([, code]) => EXTERNAL_ASSET.test(code)).map(([file]) => file)).toEqual(
      [],
    );
  });
});

describe('hygiene patterns (negative controls)', () => {
  it('flag inline style and script', () => {
    for (const bad of [
      '<div style="color:red">',
      '<div style={{ color: "red" }}>',
      '<style>body{}</style>',
      '<div dangerouslySetInnerHTML={{ __html: x }} />',
      'el.innerHTML = x',
      'eval("1")',
      'new Function("return 1")',
      "el.setAttribute('style', 'x')",
      '<a href="javascript:void(0)">',
    ])
      expect(INLINE_CODE.test(bad), bad).toBe(true);
  });

  it('flag external fonts and stylesheets', () => {
    for (const bad of [
      '@import url("x.css");',
      'src: url(https://fonts.gstatic.com/a.woff2)',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2">',
      '<script src="//cdn.example.test/a.js">',
      "@import 'x';",
    ])
      expect(EXTERNAL_ASSET.test(bad), bad).toBe(true);
  });

  it('flag a script tag that carries code, and not one that has a src', () => {
    expect(INLINE_SCRIPT.test('<script>run()</script>')).toBe(true);
    expect(INLINE_SCRIPT.test('<script type="module">\nrun()</script>')).toBe(true);
    expect(INLINE_SCRIPT.test('<script type="module" src="/src/main.tsx"></script>')).toBe(false);
  });

  it('let local assets through', () => {
    for (const ok of ['src: url("/fonts/a.woff2")', '<script type="module" src="/src/main.tsx">'])
      expect(EXTERNAL_ASSET.test(ok) || INLINE_CODE.test(ok), ok).toBe(false);
  });
});
