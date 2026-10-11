// AT-22-local (spec m0-foundations §9.3, §9.4, §13): the build emits dist/version.json as
// { app, version }, and it parses as AppVersionFile. The version is VITE_APP_VERSION when that is a
// commit SHA, else "dev". Both the plugin (hook level) and a real build are checked.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppVersionFile, Version } from '@trace/shared/contracts';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { versionFilePlugin } from '../vite.config';

const APP = 'candidate';
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

describe(`${APP} production build`, () => {
  const saved = process.env['VITE_APP_VERSION'];
  afterEach(() => {
    if (saved === undefined) delete process.env['VITE_APP_VERSION'];
    else process.env['VITE_APP_VERSION'] = saved;
  });

  /** A real `vite build` of this app with the repo's config; nothing is written to disk. */
  async function builtVersionFile(version: string | undefined): Promise<unknown> {
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
    const asset = outputs.find((o) => o.fileName === 'version.json');
    expect(asset?.type).toBe('asset');
    return JSON.parse(String(asset && 'source' in asset ? asset.source : ''));
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
