// AT-22-local (spec m0-foundations §9.3, §9.4, §13): the build emits dist/version.json as
// { app, version }, and it parses as AppVersionFile. The version is VITE_APP_VERSION when that is a
// commit SHA, else "dev". Both the plugin (hook level) and a real build are checked.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppVersionFile, Version } from '@trace/shared/contracts';
import { build } from 'vite';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { versionFilePlugin } from '../vite.config';

const APP = 'recruiter';
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Values a CI variable might hold: valid SHAs, "dev", and things that must fall back to "dev". */
const VALUES: (string | undefined)[] = [
  undefined,
  '',
  'dev',
  'DEV',
  'abcdef1',
  'abcdef',
  'ABCDEF1',
  '0123456789abcdef0123456789abcdef01234567',
  '0123456789abcdef0123456789abcdef012345678',
  'abcdef1\n',
  ' abcdef1',
  'abcdeg1',
  'v1.2.3',
  '0.0.0',
];
const expected = (value: string | undefined): string =>
  Version.safeParse(value).success ? (value as string) : 'dev';

/** Runs the plugin's hooks the way Rollup does, and returns the asset it emitted. */
function emitted(env: Record<string, unknown>): { fileName: string; source: string }[] {
  const plugin = versionFilePlugin(APP);
  const assets: { fileName: string; source: string }[] = [];
  const configResolved = plugin.configResolved as (config: { env: unknown }) => void;
  const generateBundle = plugin.generateBundle as (this: {
    emitFile(file: { type: string; fileName: string; source: string }): void;
  }) => void;
  configResolved({ env });
  generateBundle.call({ emitFile: (file) => assets.push(file) });
  return assets;
}

describe(`${APP} version.json plugin`, () => {
  it('emits exactly one asset, dist/version.json', () => {
    const assets = emitted({});
    expect(assets.map((a) => a.fileName)).toEqual(['version.json']);
  });

  it.each(VALUES.map((v) => [JSON.stringify(v), v] as const))(
    'VITE_APP_VERSION=%s gives a valid AppVersionFile',
    (_name, value) => {
      const [asset] = emitted(value === undefined ? {} : { VITE_APP_VERSION: value });
      const parsed: unknown = JSON.parse(asset?.source ?? '');
      const file = AppVersionFile.parse(parsed);
      expect(file).toEqual({ app: APP, version: expected(value) });
    },
  );

  it('ignores a non-string value and any other variable', () => {
    for (const env of [
      { VITE_APP_VERSION: 123 },
      { VITE_APP_VERSION: null },
      { APP_VERSION: 'abcdef1' },
    ]) {
      const [asset] = emitted(env);
      expect(AppVersionFile.parse(JSON.parse(asset?.source ?? ''))).toEqual({
        app: APP,
        version: 'dev',
      });
    }
  });

  it('writes nothing but the two fields and ends with a newline', () => {
    const [asset] = emitted({ VITE_APP_VERSION: 'abcdef1' });
    expect(asset?.source).toBe(`{"app":"${APP}","version":"abcdef1"}\n`);
  });
});

/** One built file: its name, whether it is JS or an asset, and its text. */
interface BuiltFile {
  fileName: string;
  type: 'chunk' | 'asset';
  text: string;
}

/** A real `vite build` of this app with the repo's config; nothing is written to disk. */
async function buildApp(version: string | undefined): Promise<BuiltFile[]> {
  if (version === undefined) delete process.env['VITE_APP_VERSION'];
  else process.env['VITE_APP_VERSION'] = version;
  const result = await build({
    root: appDir,
    configFile: path.join(appDir, 'vite.config.ts'),
    logLevel: 'silent',
    build: { write: false },
  });
  const outputs = Array.isArray(result)
    ? result.flatMap((r) => r.output)
    : 'output' in result
      ? result.output
      : [];
  return outputs.map((o): BuiltFile => {
    if (o.type === 'chunk') return { fileName: o.fileName, type: 'chunk', text: o.code };
    const source: string | Uint8Array = o.source;
    const text = typeof source === 'string' ? source : Buffer.from(source).toString('utf8');
    return { fileName: o.fileName, type: 'asset', text };
  });
}

describe(`${APP} production build`, () => {
  const saved = process.env['VITE_APP_VERSION'];
  afterEach(() => {
    if (saved === undefined) delete process.env['VITE_APP_VERSION'];
    else process.env['VITE_APP_VERSION'] = saved;
  });

  async function builtVersionFile(version: string | undefined): Promise<unknown> {
    const asset = (await buildApp(version)).find((o) => o.fileName === 'version.json');
    expect(asset?.type).toBe('asset');
    return JSON.parse(asset?.text ?? '');
  }

  it('produces dist/version.json with the commit SHA', async () => {
    const file = AppVersionFile.parse(await builtVersionFile('abcdef0123456789'));
    expect(file).toEqual({ app: APP, version: 'abcdef0123456789' });
  }, 60_000);

  it('falls back to "dev" when the variable is unset or not a SHA', async () => {
    expect(AppVersionFile.parse(await builtVersionFile(undefined))).toEqual({
      app: APP,
      version: 'dev',
    });
    expect(AppVersionFile.parse(await builtVersionFile('not a sha'))).toEqual({
      app: APP,
      version: 'dev',
    });
  }, 60_000);
});

/** A script tag without a src: its body is inline code, which `script-src 'self'` blocks (§10.3). */
const INLINE_SCRIPT_TAG = /<script\b(?![^>]*\ssrc\s*=)[^>]*>/i;
/** An inline stylesheet or a `style=` attribute, both blocked by `style-src 'self'`. */
const INLINE_STYLE = /<style[\s>]|\sstyle\s*=/i;
/** A font embedded in CSS as a data: URL (Vite inlines small assets) and so blocked by font-src. */
const DATA_FONT = /url\(\s*['"]?data:(?:font|application\/(?:font|x-font|vnd\.ms-fontobject))/i;
/** An absolute URL in emitted CSS: another origin for a font, image or @import. */
const ABSOLUTE_URL = /https?:\/\//i;

describe(`${APP} built output (CSP hygiene, spec §10.3)`, () => {
  let files: BuiltFile[] = [];
  beforeAll(async () => {
    files = await buildApp(undefined);
  }, 60_000);

  const named = (pattern: RegExp): BuiltFile[] => files.filter((f) => pattern.test(f.fileName));

  it('emits index.html, JS and CSS (the checks below cannot pass on an empty build)', () => {
    expect(named(/^index\.html$/)).toHaveLength(1);
    expect(files.some((f) => f.type === 'chunk')).toBe(true);
    expect(named(/\.css$/).length).toBeGreaterThan(0);
  });

  it('has no inline script, <style> or style= attribute in index.html', () => {
    const html = named(/^index\.html$/)[0]?.text ?? '';
    expect(html).toContain('<script');
    expect(html).not.toMatch(INLINE_SCRIPT_TAG);
    expect(html).not.toMatch(INLINE_STYLE);
  });

  it('has no data: font and no absolute URL in the emitted CSS', () => {
    for (const css of named(/\.css$/)) {
      expect(css.text, css.fileName).not.toMatch(DATA_FONT);
      expect(css.text, css.fileName).not.toMatch(ABSOLUTE_URL);
    }
  });
});

describe('built-output patterns (negative controls)', () => {
  it('INLINE_SCRIPT_TAG flags a script without src and not one with src', () => {
    for (const bad of ['<script>run()</script>', '<script type="module">run()</script>'])
      expect(INLINE_SCRIPT_TAG.test(bad), bad).toBe(true);
    for (const ok of [
      '<script type="module" crossorigin src="/assets/index-a1b2c3.js"></script>',
      '<script src="/a.js"></script>',
    ])
      expect(INLINE_SCRIPT_TAG.test(ok), ok).toBe(false);
  });

  it('INLINE_STYLE flags <style> and style=', () => {
    for (const bad of ['<style>a{}</style>', '<div style="color:red">', '<style media="x">'])
      expect(INLINE_STYLE.test(bad), bad).toBe(true);
    expect(INLINE_STYLE.test('<link rel="stylesheet" href="/assets/a.css">')).toBe(false);
  });

  it('DATA_FONT and ABSOLUTE_URL flag what the CSP forbids', () => {
    for (const bad of [
      'src:url(data:font/woff2;base64,AAAA)',
      "src: url( 'data:application/font-woff;base64,AAAA')",
      'src:url("data:application/x-font-ttf;base64,AAAA")',
    ])
      expect(DATA_FONT.test(bad), bad).toBe(true);
    expect(DATA_FONT.test('background:url(data:image/svg+xml;base64,AAAA)')).toBe(false);
    for (const bad of ['@import "https://x.test/a.css"', 'src:url(http://x.test/a.woff2)'])
      expect(ABSOLUTE_URL.test(bad), bad).toBe(true);
    expect(ABSOLUTE_URL.test('src:url(/assets/a.woff2)')).toBe(false);
  });
});
