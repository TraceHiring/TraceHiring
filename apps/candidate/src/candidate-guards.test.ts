// @vitest-environment happy-dom
// AT-D30 (CLAUDE.md rules 8 and 9, specs/d1-demo-slice.md §4.7, m0-foundations §1, §9.2, build-notes Q17).
// Raw-source guards read this app's own production sources as text, so a forbidden name fails here even if a build
// would tree-shake it:
//   (1) `getUserMedia` / `mediaDevices` appear only in src/photo/camera.ts (the one camera module);
//   (2) its one call asks for `audio: false`, and `audio: true` appears nowhere;
//   no screen capture, device listing, recorder, ImageCapture or HTML Media Capture (`capture=`) anywhere;
//   no error reporter, Sentry or analytics; `fetch(` only in src/api.ts;
//   imports: React, local files under src/, the logger, the token stylesheet, and the candidate contracts as a
//   top-level `import type` only (a runtime import would pull zod into the bundle, spec D3).
// A behavioural walk of the real App (happy-dom, mocked fetch, camera, canvas and media element) then checks
//   (3) the camera is never asked for before the consent call answered success, exactly once on the photo step, and
//       never on the rules or test steps; (4) every track stops as soon as the shot is taken and on unmount; plus
//   the camera-denied skip path and the under-18 path (no consent, no camera).
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../index.html?raw';
import pkg from '../package.json';
import { App } from './App';
import type { Boot } from './boot';
import { COPY } from './copy';
import {
  buttonByText,
  CANVAS_JPEG,
  click,
  deferred,
  fakeCamera,
  fakeCanvasAndVideo,
  h1Text,
  mockFetch,
  mount,
  nextOrder,
  settle,
  sha256HexOf,
  typeInto,
  waitFor,
  waitForButton,
  type Mounted,
} from './dom.test-helpers';
import {
  json,
  LINK_TOKEN,
  LOBBY_TOKEN,
  MCQ_ITEM,
  NOTICE,
  SESSION_TOKEN,
  viewAt,
  WRITTEN_ITEM,
} from './fixtures.test-helpers';
import { SESSION_KEY } from './session-store';

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

/** A specifier that names a test or a test helper (any script extension, or none). */
const TEST_IMPORT = /\.test(?:-helpers)?(?:\.[cm]?[jt]sx?)?$/;

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
    // SR-9: the camera module must exist; the check cannot pass on a missing file.
    const camera = all[CAMERA_MODULE] ?? '';
    expect(all[CAMERA_MODULE]).toBeDefined();
    const calls = [...camera.matchAll(/getUserMedia\s*\(/g)];
    expect(calls).toHaveLength(1);
    const call = /getUserMedia\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(camera)?.[1] ?? '';
    expect(call).toMatch(/\baudio\s*:\s*false\b/);
    expect(call).toMatch(/\bvideo\s*:/);
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
        .filter((s) => TEST_IMPORT.test(s))
        .map((s) => `${file}: ${s}`),
    );
    expect(bad).toEqual([]);
  });
});

describe('guard patterns (negative controls)', () => {
  it('flag an import of a test or test helper, with or without an extension (SEC-4)', () => {
    for (const bad of [
      './x.test',
      './x.test.ts',
      './x.test-helpers',
      './x.test-helpers.ts',
      './x.test-helpers.js',
      '../x.test.mjs',
      './x.test-helpers.tsx',
    ])
      expect(TEST_IMPORT.test(bad), bad).toBe(true);
    for (const ok of ['./test/Test', './testing', './latest', './x.tested.ts'])
      expect(TEST_IMPORT.test(ok), ok).toBe(false);
  });

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

// ---- (3) and (4): the camera in the real App ---------------------------------------------------------------------

const ORIGIN = 'https://trace-edge-staging.example-sub.workers.dev';
const BOOT: Boot = { linkToken: LINK_TOKEN, badLink: false, stored: null, origin: ORIGIN };

/** The edge as the walk needs it; `consent` can be held back to prove the camera waits for it. */
const edgeRoutes = (opts: { consent?: Promise<Response> } = {}) => {
  const now = Date.now();
  return mockFetch({
    'POST /v1/invite/resolve': () =>
      json(200, { state: 'sent', title: 'Synthetic aptitude test', durationMinutes: 30 }),
    'POST /v1/otp/request': () =>
      json(200, { resendAfterSeconds: 30, expiresInSeconds: 600, channel: 'email' }),
    'POST /v1/otp/verify': () =>
      json(200, {
        lobbyToken: LOBBY_TOKEN,
        expiresAt: new Date(now + 1_800_000).toISOString(),
        next: 'age',
      }),
    'POST /v1/lobby/age': (req) =>
      (req.body as { adult: boolean }).adult
        ? json(200, { ok: true })
        : json(403, { error: 'not_eligible' }),
    'GET /v1/lobby/notice': () => json(200, NOTICE),
    'POST /v1/lobby/consent': () => opts.consent ?? json(200, { ok: true }),
    'PUT /v1/lobby/photo': (req) =>
      json(200, { sha256: req.headers['x-photo-sha256'], bytes: (req.body as Uint8Array).length }),
    'POST /v1/session/start': () =>
      json(200, {
        sessionToken: SESSION_TOKEN,
        expiresAt: new Date(now + 5_400_000).toISOString(),
        view: viewAt(now),
      }),
    'GET /v1/session/items/:pos': (req) =>
      json(200, req.path.endsWith('/1') ? MCQ_ITEM : WRITTEN_ITEM),
    'POST /v1/session/events': () =>
      json(200, {
        ackSeq: 0,
        serverNow: new Date().toISOString(),
        deadlineAt: new Date(now + 1_800_000).toISOString(),
        state: 'in_progress',
      }),
  });
};

describe(
  'AT-D30 behaviour: the camera only after consent, once, and always stopped',
  { timeout: 20_000 },
  () => {
    let app: Mounted | undefined;

    beforeEach(() => {
      sessionStorage.removeItem(SESSION_KEY);
      fakeCanvasAndVideo();
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });
    afterEach(async () => {
      await app?.unmount();
      app = undefined;
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    /** Link → OTP → 18+; stops on the consent screen with the box ticked. */
    const toConsent = async (container: HTMLElement) => {
      await click(await waitForButton(container, COPY.otp.send));
      const input = await waitFor(
        () => container.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]'),
        'code input',
      );
      await typeInto(input, '123456');
      await click(await waitForButton(container, COPY.otp.verify));
      await click(await waitForButton(container, COPY.age.adult));
      const notice = await waitFor(
        () => container.querySelector('[data-testid="notice-text"]'),
        'notice',
      );
      expect(notice.textContent).toBe(NOTICE.bodyText);
      await click(
        await waitFor(
          () => container.querySelector<HTMLInputElement>('input[type="checkbox"]'),
          'agree box',
        ),
      );
    };

    it('walks consent → photo → rules → test: camera after consent, once, tracks stopped at the shot', async () => {
      const camera = fakeCamera();
      const held = deferred<Response>();
      const edge = edgeRoutes({ consent: held.promise });
      app = await mount(createElement(App, { boot: BOOT }));
      const { container } = app;
      await toConsent(container);
      await click(await waitForButton(container, COPY.consent.agree));
      // The consent call is in flight: no photo step, no camera.
      await settle(50);
      expect(edge.paths()).toContain('POST /v1/lobby/consent');
      expect(h1Text(container)).toBe(COPY.consent.title);
      expect(camera.getUserMedia).not.toHaveBeenCalled();
      const consentAnsweredAt = nextOrder();
      held.resolve(json(200, { ok: true }));

      // The photo step loads, but the camera waits for the candidate.
      const turnOn = await waitForButton(container, COPY.photo.start);
      expect(h1Text(container)).toBe(COPY.photo.title);
      expect(camera.getUserMedia).not.toHaveBeenCalled();
      await click(turnOn);
      const take = await waitForButton(container, COPY.photo.take);
      expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
      expect(camera.calls[0]?.order).toBeGreaterThan(consentAnsweredAt);
      expect(camera.calls[0]?.constraints).toEqual({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      expect(camera.tracks[0]?.stop).not.toHaveBeenCalled();
      // No video element is ever on screen; the preview is the canvas.
      expect(container.querySelector('video')).toBeNull();
      expect(container.querySelector('canvas')).not.toBeNull();

      await click(take);
      // (4) the track stops as soon as the shot is taken.
      expect(camera.tracks[0]?.stop).toHaveBeenCalled();
      await click(await waitForButton(container, COPY.photo.use));
      await waitFor(() => h1Text(container) === COPY.rules.title, 'rules');

      // Only the processed, APP0-only JPEG left the device, with the hash of exactly those bytes (rev 4i).
      const upload = edge.calls.find((c) => c.method === 'PUT');
      const body = upload?.body as Uint8Array;
      expect(upload?.headers['content-type']).toBe('image/jpeg');
      expect(body.length).toBeLessThan(CANVAS_JPEG.length);
      expect([...body].some((b, k) => b === 0xff && body[k + 1] === 0xe2)).toBe(false);
      expect(upload?.headers['x-photo-sha256']).toBe(await sha256HexOf(body));

      await click(
        container.querySelector<HTMLInputElement>('input[type="checkbox"]') as HTMLInputElement,
      );
      await click(await waitForButton(container, COPY.rules.start));
      await waitFor(() => h1Text(container) === 'Synthetic aptitude test', 'test screen');
      await waitFor(() => container.querySelector('input[type="radio"]'), 'first item');
      const start = edge.calls.find((c) => c.path === '/v1/session/start');
      expect(start?.body).toEqual({
        rulesAcknowledged: true,
        photo: { sha256: upload?.headers['x-photo-sha256'] },
      });
      // Never again on the rules or the test step.
      expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
      // Every request went to the edge origin, and the only binary body was the photo.
      expect(edge.fn.mock.calls.every(([url]) => String(url).startsWith(`${ORIGIN}/v1/`))).toBe(
        true,
      );
      expect(edge.calls.filter((c) => c.body instanceof Uint8Array)).toHaveLength(1);
    });

    it('(4) stops every track when the photo step unmounts with the camera on', async () => {
      const camera = fakeCamera();
      edgeRoutes();
      app = await mount(createElement(App, { boot: BOOT }));
      const { container } = app;
      await toConsent(container);
      await click(await waitForButton(container, COPY.consent.agree));
      await click(await waitForButton(container, COPY.photo.start));
      await waitForButton(container, COPY.photo.take);
      expect(camera.tracks).toHaveLength(1);
      expect(camera.tracks[0]?.stop).not.toHaveBeenCalled();
      await app.unmount();
      app = undefined;
      expect(camera.tracks[0]?.stop).toHaveBeenCalled();
    });

    it('stops the tracks when the candidate leaves the live camera with "Continue without a photo"', async () => {
      const camera = fakeCamera();
      const edge = edgeRoutes();
      app = await mount(createElement(App, { boot: BOOT }));
      const { container } = app;
      await toConsent(container);
      await click(await waitForButton(container, COPY.consent.agree));
      await click(await waitForButton(container, COPY.photo.start));
      await waitForButton(container, COPY.photo.take);
      await click(buttonByText(container, COPY.photo.skip) as HTMLButtonElement);
      expect(camera.tracks[0]?.stop).toHaveBeenCalled();
      await waitFor(() => h1Text(container) === COPY.rules.title, 'rules');
      expect(edge.calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    it('camera denied: a plain-language screen, then "Continue without a photo" starts with camera_denied', async () => {
      const camera = fakeCamera('NotAllowedError');
      const edge = edgeRoutes();
      app = await mount(createElement(App, { boot: BOOT }));
      const { container } = app;
      await toConsent(container);
      await click(await waitForButton(container, COPY.consent.agree));
      await click(await waitForButton(container, COPY.photo.start));
      await waitFor(() => h1Text(container) === COPY.photo.deniedTitle, 'denied screen');
      expect(container.textContent).toContain(COPY.photo.denied);
      expect(buttonByText(container, COPY.photo.retry)).toBeDefined();
      await click(await waitForButton(container, COPY.photo.skip));
      await waitFor(() => h1Text(container) === COPY.rules.title, 'rules');
      await click(
        container.querySelector<HTMLInputElement>('input[type="checkbox"]') as HTMLInputElement,
      );
      await click(await waitForButton(container, COPY.rules.start));
      await waitFor(() => h1Text(container) === 'Synthetic aptitude test', 'test screen');
      const start = edge.calls.find((c) => c.path === '/v1/session/start');
      expect(start?.body).toEqual({
        rulesAcknowledged: true,
        photo: { skippedReason: 'camera_denied' },
      });
      expect(edge.calls.some((c) => c.method === 'PUT')).toBe(false);
      expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
      expect(camera.tracks).toHaveLength(0);
    });

    it('no camera: "Continue without a photo" starts with no_camera', async () => {
      fakeCamera('NotFoundError');
      const edge = edgeRoutes();
      app = await mount(createElement(App, { boot: BOOT }));
      const { container } = app;
      await toConsent(container);
      await click(await waitForButton(container, COPY.consent.agree));
      await click(await waitForButton(container, COPY.photo.start));
      await waitFor(() => h1Text(container) === COPY.photo.noneTitle, 'no-camera screen');
      await click(await waitForButton(container, COPY.photo.skip));
      await waitFor(() => h1Text(container) === COPY.rules.title, 'rules');
      await click(
        container.querySelector<HTMLInputElement>('input[type="checkbox"]') as HTMLInputElement,
      );
      await click(await waitForButton(container, COPY.rules.start));
      await waitFor(() => edge.calls.find((c) => c.path === '/v1/session/start'), 'start');
      expect(edge.calls.find((c) => c.path === '/v1/session/start')?.body).toEqual({
        rulesAcknowledged: true,
        photo: { skippedReason: 'no_camera' },
      });
    });

    it('under 18 (rule 9): blocked with neutral copy; no notice, consent, photo or camera', async () => {
      const camera = fakeCamera();
      const edge = edgeRoutes();
      app = await mount(createElement(App, { boot: BOOT }));
      const { container } = app;
      await click(await waitForButton(container, COPY.otp.send));
      const input = await waitFor(
        () => container.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]'),
        'code input',
      );
      await typeInto(input, '123456');
      await click(await waitForButton(container, COPY.otp.verify));
      await click(await waitForButton(container, COPY.age.minor));
      await waitFor(() => h1Text(container) === COPY.blocked.title, 'blocked');
      await settle(50);
      expect(edge.calls.find((c) => c.path === '/v1/lobby/age')?.body).toEqual({ adult: false });
      expect(edge.paths().filter((p) => /notice|consent|photo|session/.test(p))).toEqual([]);
      expect(camera.getUserMedia).not.toHaveBeenCalled();
      expect(container.querySelectorAll('button')).toHaveLength(0);
    });
  },
);
