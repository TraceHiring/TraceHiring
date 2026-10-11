// Raw-source guards for the candidate app (CLAUDE.md rule 8, spec m0-foundations §1, §9.2,
// build-notes Q17). The candidate shell has no camera or microphone access, no error reporter, no
// Sentry and no analytics, and it imports only the logger from @trace/shared (never the package
// root, which pulls the zod contracts into the bundle, spec D3). The test reads this app's own
// production sources as text, so a forbidden name fails here even if a build would tree-shake it.
import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import pkg from '../package.json';

const all = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Production sources: everything under src/ except the tests (which name what is forbidden). */
const sources = Object.entries(all).filter(([file]) => !/\.test\.tsx?$/.test(file));

/**
 * Media capture (rule 8): none of these may appear in the candidate app in M0a. `capture=` / `capture:`
 * is HTML Media Capture (an <input capture> or a `capture` prop), which opens the camera or recorder.
 */
const MEDIA_CAPTURE =
  /getUserMedia|getDisplayMedia|mediaDevices|enumerateDevices|MediaRecorder|ImageCapture|\bcapture\s*[=:]/i;

/** Error reporters, Sentry and analytics or session-replay vendors (spec §9.2, build-notes Q17). */
const REPORTING_OR_ANALYTICS =
  /sentry|bugsnag|rollbar|datadog|logrocket|fullstory|hotjar|posthog|mixpanel|amplitude|gtag|googletagmanager|analytics|ErrorReporter|error-reporter|reportError|captureException/i;

/** `from 'x'`, `import 'x'` and `import('x')` specifiers in a source text. */
const specifiers = (text: string): string[] =>
  [...text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');

/** What the shell may import: React, its own files, the logger and the token stylesheet. */
const ALLOWED_IMPORT =
  /^(?:react|react-dom|react-dom\/client|react\/jsx-runtime|\.\/[^'"]*|@trace\/shared\/log|@trace\/ui\/tokens\.css)$/;

/** The sources (file names) in which `pattern` occurs. */
const where = (pattern: RegExp): string[] =>
  sources.filter(([, text]) => pattern.test(text)).map(([file]) => file);

describe('candidate sources', () => {
  it('are found (the guards cannot pass on an empty glob)', () => {
    const files = sources.map(([file]) => file);
    expect(files).toEqual(
      expect.arrayContaining(['./App.tsx', './main.tsx', './log.ts', './version.ts']),
    );
  });

  it('never ask for the camera, microphone or screen (rule 8)', () => {
    expect(where(MEDIA_CAPTURE)).toEqual([]);
  });

  it('have no error reporter, Sentry or analytics (spec §9.2, build-notes Q17)', () => {
    expect(where(REPORTING_OR_ANALYTICS)).toEqual([]);
  });

  it('keep index.html free of media capture, reporters and analytics', () => {
    expect(indexHtml).toContain('<div id="root">');
    expect(indexHtml).not.toMatch(MEDIA_CAPTURE);
    expect(indexHtml).not.toMatch(REPORTING_OR_ANALYTICS);
  });

  it('import @trace/shared only as @trace/shared/log, and no zod', () => {
    const imported = sources.flatMap(([, text]) => specifiers(text));
    const shared = imported.filter((s) => s === '@trace/shared' || s.startsWith('@trace/shared/'));
    expect(shared.length).toBeGreaterThan(0);
    expect(new Set(shared)).toEqual(new Set(['@trace/shared/log']));
    expect(imported.filter((s) => /^zod(\/|$)/.test(s))).toEqual([]);
  });

  it('import only React, local files, the logger and the token stylesheet', () => {
    const imported = sources.flatMap(([, text]) => specifiers(text));
    expect(imported.filter((s) => !ALLOWED_IMPORT.test(s))).toEqual([]);
  });
});

describe('guard patterns (negative controls)', () => {
  it('flag media capture', () => {
    for (const bad of [
      'navigator.mediaDevices.getUserMedia({ video: true })',
      'await navigator.mediaDevices.getDisplayMedia()',
      'new MediaRecorder(stream)',
      'navigator.mediaDevices.enumerateDevices()',
      'new ImageCapture(track)',
      '<input type="file" accept="video/*" capture="user">',
      '<input capture = environment>',
      'createElement("input", { capture: "user" })',
    ])
      expect(MEDIA_CAPTURE.test(bad), bad).toBe(true);
  });

  it('let ordinary words through the media pattern', () => {
    for (const ok of ['const captured = 1;', 'onClickCapture', '<div id="root"></div>', 'captures'])
      expect(MEDIA_CAPTURE.test(ok), ok).toBe(false);
  });

  it('flag a bad index.html (the same patterns catch markup)', () => {
    const bad = [
      '<input type="file" capture="user">',
      '<script src="https://cdn.example.test/analytics.js"></script>',
      '<script>window.Sentry = {}</script>',
    ];
    expect(MEDIA_CAPTURE.test(bad[0] ?? '')).toBe(true);
    expect(REPORTING_OR_ANALYTICS.test(bad[1] ?? '')).toBe(true);
    expect(REPORTING_OR_ANALYTICS.test(bad[2] ?? '')).toBe(true);
  });

  it('flag reporters and analytics', () => {
    for (const bad of [
      "import * as Sentry from '@sentry/react';",
      "import posthog from 'posthog-js';",
      "window.gtag('event', 'x')",
      "import { noopErrorReporter } from '@trace/shared/log';",
      'reportError(reporter, err)',
      'import { track } from "analytics";',
    ])
      expect(REPORTING_OR_ANALYTICS.test(bad), bad).toBe(true);
  });

  it('list the specifiers that the import check inspects', () => {
    const text = [
      "import { a } from 'x-one';",
      "import 'x-two';",
      "export { b } from 'x-three';",
      "const c = await import('x-four');",
      'import { d } from "x-five";',
    ].join('\n');
    expect(specifiers(text)).toEqual(['x-one', 'x-two', 'x-three', 'x-four', 'x-five']);
  });

  it('reject imports outside the allow-list', () => {
    for (const bad of [
      '@trace/shared',
      '@trace/shared/contracts',
      '@trace/shared/health',
      '@trace/vendors',
      '@trace/config/vite',
      'zod',
      '../package.json',
      '../../packages/vendors/src/index.ts',
      '@sentry/react',
    ])
      expect(ALLOWED_IMPORT.test(bad), bad).toBe(false);
    for (const good of ['react', 'react-dom/client', './App', './index.css', '@trace/shared/log'])
      expect(ALLOWED_IMPORT.test(good), good).toBe(true);
  });
});

describe('candidate package.json', () => {
  it('lists only react, react-dom and the two workspace packages as dependencies', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@trace/shared',
      '@trace/ui',
      'react',
      'react-dom',
    ]);
  });

  it('has no Sentry, analytics or zod package anywhere', () => {
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(
      names.filter((n) => /sentry|analytics|posthog|mixpanel|amplitude|segment|zod/i.test(n)),
    ).toEqual([]);
  });
});
