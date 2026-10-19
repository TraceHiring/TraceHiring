// Raw-source guards for the candidate app (CLAUDE.md rule 8, specs/d1-demo-slice.md §4.7 AT-D30, m0-foundations §1,
// §9.2, build-notes Q17). The test reads this app's own production sources as text, so a forbidden name fails here
// even if a build would tree-shake it:
//   (1) `getUserMedia` / `mediaDevices` appear only in src/photo/camera.ts (the one camera module);
//   (2) its one call asks for `audio: false`, and `audio: true` appears nowhere;
//   no screen capture, device listing, recorder, ImageCapture or HTML Media Capture (`capture=`) anywhere;
//   no error reporter, Sentry or analytics; `fetch(` only in src/api.ts;
//   imports: React, local files under src/, the logger, the token stylesheet, and the candidate contracts as a
//   top-level `import type` only (a runtime import would pull zod into the bundle, spec D3).
// The behavioural half of AT-D30 (items 3 and 4: when the camera is asked for and that every track stops) is
// src/camera-flow.test.tsx.
import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import pkg from '../package.json';

const all = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Production sources: everything under src/ except tests and their helpers (which name what is forbidden). */
const sources = Object.entries(all).filter(([file]) => !/\.test(?:-helpers)?\.tsx?$/.test(file));

/** The one module that may touch the camera (§4.7 item 1). */
const CAMERA_MODULE = './photo/camera.ts';

/** Camera access names: allowed only in CAMERA_MODULE. */
const CAMERA_ACCESS = /getUserMedia|mediaDevices/;

/**
 * Media capture that is banned everywhere (rule 8): screen capture, device listing, recording, ImageCapture, and
 * HTML Media Capture (`capture=` / `capture:` on an input or prop, which opens the camera or recorder).
 */
const MEDIA_CAPTURE =
  /getDisplayMedia|enumerateDevices|MediaRecorder|ImageCapture|\bcapture\s*[=:]|['"]capture['"]\s*[,:]/i;

/** Asking for the microphone. */
const AUDIO_TRUE = /\baudio\s*:\s*(?:true|!0|1\b)/;

/** Error reporters, Sentry and analytics or session-replay vendors (spec §9.2, build-notes Q17). */
const REPORTING_OR_ANALYTICS =
  /sentry|bugsnag|rollbar|datadog|logrocket|fullstory|hotjar|posthog|mixpanel|amplitude|gtag|googletagmanager|analytics|ErrorReporter|error-reporter|reportError|captureException/i;

/** A network call. Only the API client may make one. */
const FETCH = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|EventSource/;

/** `from 'x'`, `import 'x'` and `import('x')` specifiers in a source text. */
const specifiers = (text: string): string[] =>
  [...text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');

/** Packages the app may import: React, the logger, the candidate contracts (types only) and the token stylesheet. */
const ALLOWED_PACKAGE =
  /^(?:react|react-dom|react-dom\/client|react\/jsx-runtime|@trace\/shared\/log|@trace\/shared\/contracts\/candidate|@trace\/ui\/tokens\.css)$/;

/** A relative specifier from `file` (like './photo/x.ts') that stays inside src/. */
const insideSrc = (file: string, spec: string): boolean => {
  const parts = file.split('/').slice(1, -1); // drop the leading '.' and the file name
  for (const part of spec.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      if (parts.length === 0) return false;
      parts.pop();
    } else parts.push(part);
  }
  return true;
};

const allowedImport = (file: string, spec: string): boolean =>
  /^\.\.?\//.test(spec) ? insideSrc(file, spec) && !spec.includes('?') : ALLOWED_PACKAGE.test(spec);

/** The contracts module: only as a top-level `import type { … }` (an inline `type` keeps a runtime import). */
const CONTRACTS = /['"]@trace\/shared\/contracts\/candidate['"]/g;
const CONTRACTS_TYPE_IMPORT =
  /(?:^|\n)import\s+type\s*\{[^}]*\}\s*from\s*['"]@trace\/shared\/contracts\/candidate['"]/g;

/** The sources (file names) in which `pattern` occurs. */
const where = (pattern: RegExp): string[] =>
  sources.filter(([, text]) => pattern.test(text)).map(([file]) => file);

describe('candidate sources', () => {
  it('are found (the guards cannot pass on an empty glob)', () => {
    const files = sources.map(([file]) => file);
    expect(files).toEqual(
      expect.arrayContaining(['./App.tsx', './main.tsx', './log.ts', './version.ts', './api.ts']),
    );
    expect(files.some((f) => f.endsWith('.test.ts') || f.endsWith('.test-helpers.ts'))).toBe(false);
  });

  it('(1) name getUserMedia and mediaDevices only in src/photo/camera.ts', () => {
    expect(where(CAMERA_ACCESS).filter((f) => f !== CAMERA_MODULE)).toEqual([]);
  });

  it('(2) ask for the camera exactly once, with audio: false, and never for audio', () => {
    const camera = all[CAMERA_MODULE];
    if (camera !== undefined) {
      const calls = [...camera.matchAll(/getUserMedia\s*\(/g)];
      expect(calls).toHaveLength(1);
      const call = /getUserMedia\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(camera)?.[1] ?? '';
      expect(call).toMatch(/\baudio\s*:\s*false\b/);
      expect(call).toMatch(/\bvideo\s*:/);
    }
    expect(where(AUDIO_TRUE)).toEqual([]);
  });

  it('never capture the screen, list devices, record, or use HTML Media Capture (rule 8)', () => {
    expect(where(MEDIA_CAPTURE)).toEqual([]);
  });

  it('have no error reporter, Sentry or analytics (spec §9.2, build-notes Q17)', () => {
    expect(where(REPORTING_OR_ANALYTICS)).toEqual([]);
  });

  it('call fetch only in src/api.ts', () => {
    expect(where(FETCH)).toEqual(['./api.ts']);
  });

  it('keep index.html free of media capture, camera access, reporters and analytics', () => {
    expect(indexHtml).toContain('<div id="root">');
    expect(indexHtml).not.toMatch(MEDIA_CAPTURE);
    expect(indexHtml).not.toMatch(CAMERA_ACCESS);
    expect(indexHtml).not.toMatch(REPORTING_OR_ANALYTICS);
  });

  it('import @trace/shared only as the logger and the candidate contracts, and no zod', () => {
    const imported = sources.flatMap(([, text]) => specifiers(text));
    const shared = imported.filter((s) => s === '@trace/shared' || s.startsWith('@trace/shared/'));
    expect(new Set(shared)).toEqual(
      new Set(['@trace/shared/log', '@trace/shared/contracts/candidate']),
    );
    expect(imported.filter((s) => /^zod(\/|$)/.test(s))).toEqual([]);
  });

  it('import the candidate contracts only as a top-level `import type { … }`', () => {
    const bad = sources
      .filter(([, text]) => {
        const named = text.match(CONTRACTS)?.length ?? 0;
        const typed = text.match(CONTRACTS_TYPE_IMPORT)?.length ?? 0;
        return named !== typed;
      })
      .map(([file]) => file);
    expect(bad).toEqual([]);
  });

  it('import only React, files under src/, the logger, the contracts and the token stylesheet', () => {
    const bad = sources.flatMap(([file, text]) =>
      specifiers(text)
        .filter((s) => !allowedImport(file, s))
        .map((s) => `${file}: ${s}`),
    );
    expect(bad).toEqual([]);
  });

  it('never import a test helper', () => {
    const bad = sources.flatMap(([file, text]) =>
      specifiers(text)
        .filter((s) => /\.test(?:-helpers)?(?:\.tsx?)?$/.test(s))
        .map((s) => `${file}: ${s}`),
    );
    expect(bad).toEqual([]);
  });
});

describe('guard patterns (negative controls)', () => {
  it('flag camera access outside the camera module', () => {
    for (const bad of [
      'navigator.mediaDevices.getUserMedia({ video: true })',
      'const md = navigator.mediaDevices;',
    ])
      expect(CAMERA_ACCESS.test(bad), bad).toBe(true);
  });

  it('flag media capture', () => {
    for (const bad of [
      'await navigator.mediaDevices.getDisplayMedia()',
      'new MediaRecorder(stream)',
      'navigator.mediaDevices.enumerateDevices()',
      'new ImageCapture(track)',
      '<input type="file" accept="video/*" capture="user">',
      '<input capture = environment>',
      'createElement("input", { capture: "user" })',
      "el.setAttribute('capture', 'user')",
      'h("input", { "capture": "user" })',
      "document.addEventListener('paste', h, { capture: true })",
    ])
      expect(MEDIA_CAPTURE.test(bad), bad).toBe(true);
  });

  it('flag audio: true', () => {
    for (const bad of ['{ video: true, audio: true }', '{audio:!0}', '{ audio : 1 }'])
      expect(AUDIO_TRUE.test(bad), bad).toBe(true);
    for (const ok of ['{ audio: false }', 'audioOff: true', '{ audio: falsey }'])
      expect(AUDIO_TRUE.test(ok), ok).toBe(false);
  });

  it('let ordinary words through the media pattern', () => {
    for (const ok of [
      'const captured = 1;',
      'onClickCapture',
      '<div id="root"></div>',
      'captures',
      "document.addEventListener('paste', h, true)",
      'capture-phase listener',
    ])
      expect(MEDIA_CAPTURE.test(ok), ok).toBe(false);
  });

  it('flag network calls', () => {
    for (const bad of [
      'await fetch(url)',
      'globalThis.fetch(url)',
      'new XMLHttpRequest()',
      'navigator.sendBeacon(u, b)',
      'new WebSocket(u)',
    ])
      expect(FETCH.test(bad), bad).toBe(true);
    expect(FETCH.test('prefetchItem(1)')).toBe(false);
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
      '@trace/shared/contracts/d1',
      '@trace/shared/health',
      '@trace/vendors',
      '@trace/config/vite',
      'zod',
      '../package.json',
      '../../packages/vendors/src/index.ts',
      '@sentry/react',
      './x.css?raw',
    ])
      expect(allowedImport('./App.tsx', bad), bad).toBe(false);
    expect(allowedImport('./test/Test.tsx', '../../package.json')).toBe(false);
    for (const good of [
      'react',
      'react-dom/client',
      './App',
      './index.css',
      '@trace/shared/log',
      '@trace/shared/contracts/candidate',
    ])
      expect(allowedImport('./App.tsx', good), good).toBe(true);
    expect(allowedImport('./test/Test.tsx', '../api')).toBe(true);
  });

  it('accept only a top-level import type from the contracts', () => {
    const count = (text: string) => [
      text.match(CONTRACTS)?.length ?? 0,
      text.match(CONTRACTS_TYPE_IMPORT)?.length ?? 0,
    ];
    expect(count("import type { A } from '@trace/shared/contracts/candidate';")).toEqual([1, 1]);
    expect(count("import { type A } from '@trace/shared/contracts/candidate';")).toEqual([1, 0]);
    expect(count("import { A } from '@trace/shared/contracts/candidate';")).toEqual([1, 0]);
    expect(count("const m = import('@trace/shared/contracts/candidate');")).toEqual([1, 0]);
    expect(count("export type { A } from '@trace/shared/contracts/candidate';")).toEqual([1, 0]);
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
