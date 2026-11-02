// AT-D18 (specs/d1-demo-slice.md §5.3, §6.1): a production-flavour recruiter build contains no demo-outbox
// string. The recruiter includes the outbox only when it is built with VITE_DEMO_OUTBOX=1 and VITE_TRACE_ENV exactly
// dev or staging (e2e-local, the staging deploy); every other build (CI static, local verify, any production build,
// also one that has the flag with another or no VITE_TRACE_ENV) is production-flavour and is checked.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_OUTBOX_PATTERN, findDemoOutbox, runCheck } from '../check-no-demo-outbox.mjs';
import { cleanupTempDirs, makeTempDir, writeFiles } from './fixtures/checks/temp-repo.mjs';

afterEach(cleanupTempDirs);

const SCRIPT = fileURLToPath(new URL('../check-no-demo-outbox.mjs', import.meta.url));
const DIST = 'apps/recruiter/dist';

const repo = (files) => {
  const root = makeTempDir();
  writeFiles(root, files);
  return root;
};

const clean = {
  [`${DIST}/index.html`]: '<!doctype html><script type="module" src="/assets/index.js"></script>',
  [`${DIST}/assets/index.js`]: 'export const routes=["/tests","/reports"];',
  [`${DIST}/_headers`]: '/*\n  X-Content-Type-Options: nosniff\n',
};

describe('the pattern', () => {
  it.each(['demo-outbox', 'Demo outbox', 'DemoOutbox', 'DEMO_OUTBOX', 'demo_outbox', 'demoOutbox'])(
    'matches %s',
    (s) => {
      expect(DEMO_OUTBOX_PATTERN.test(`x ${s} y`)).toBe(true);
    },
  );
  it('does not match unrelated words', () => {
    expect(DEMO_OUTBOX_PATTERN.test('outbox demo tests reports')).toBe(false);
  });
});

describe('findDemoOutbox', () => {
  it('a clean production-flavour dist has no hit', () => {
    expect(findDemoOutbox(repo(clean))).toEqual([]);
  });

  it('names every file under dist/ that mentions the outbox (js, html, maps, nested chunks)', () => {
    const root = repo({
      ...clean,
      [`${DIST}/assets/OutboxPage-abc.js`]: 'fetch(`/v1/orgs/${o}/demo-outbox`)',
      [`${DIST}/assets/index.js.map`]: '{"sources":["../src/outbox/DemoOutbox.tsx"]}',
      [`${DIST}/nested/deep/x.html`]: '<h1>Demo outbox</h1>',
    });
    expect(findDemoOutbox(root).sort()).toEqual([
      `${DIST}/assets/OutboxPage-abc.js`,
      `${DIST}/assets/index.js.map`,
      `${DIST}/nested/deep/x.html`,
    ]);
  });
});

describe('runCheck', () => {
  it('passes a clean build', () => {
    expect(runCheck({ root: repo(clean), env: {} })).toEqual({
      ok: true,
      skipped: false,
      hits: [],
    });
  });

  it('fails a production-flavour build that contains the outbox', () => {
    const root = repo({ ...clean, [`${DIST}/assets/a.js`]: 'const DEMO_OUTBOX=1;' });
    expect(runCheck({ root, env: {} })).toEqual({
      ok: false,
      skipped: false,
      hits: [`${DIST}/assets/a.js`],
    });
  });

  it('fails closed when the recruiter dist is missing', () => {
    expect(runCheck({ root: makeTempDir(), env: {} })).toMatchObject({ ok: false, missing: true });
  });

  // SEC-W2-1: an allow-list that mirrors the app's gate (routes.tsx): skipped only for the flag "1" and
  // VITE_TRACE_ENV exactly "dev" or "staging".
  it('skips only a build made with VITE_DEMO_OUTBOX=1 exactly and VITE_TRACE_ENV exactly dev or staging', () => {
    const root = repo({ ...clean, [`${DIST}/assets/a.js`]: 'demo-outbox' });
    for (const traceEnv of ['staging', 'dev']) {
      const env = { VITE_DEMO_OUTBOX: '1', VITE_TRACE_ENV: traceEnv };
      expect(runCheck({ root, env })).toEqual({ ok: true, skipped: true, hits: [] });
    }
    for (const value of ['0', 'true', 'yes', ' 1', '']) {
      const env = { VITE_DEMO_OUTBOX: value, VITE_TRACE_ENV: 'staging' };
      expect(runCheck({ root, env }).ok).toBe(false);
    }
  });

  it.each([
    ['unset', undefined],
    ['production', 'production'],
    ['prod', 'prod'],
    ['Production', 'Production'],
    ['empty', ''],
    ['Staging', 'Staging'],
    ['DEV', 'DEV'],
    [' dev', ' dev'],
    ['test', 'test'],
  ])('checks a VITE_DEMO_OUTBOX=1 build whose VITE_TRACE_ENV is %s', (_label, traceEnv) => {
    const env = {
      VITE_DEMO_OUTBOX: '1',
      ...(traceEnv === undefined ? {} : { VITE_TRACE_ENV: traceEnv }),
    };
    const dirty = repo({ ...clean, [`${DIST}/assets/a.js`]: 'demo-outbox' });
    expect(runCheck({ root: dirty, env })).toEqual({
      ok: false,
      skipped: false,
      hits: [`${DIST}/assets/a.js`],
    });
    expect(runCheck({ root: repo(clean), env })).toEqual({ ok: true, skipped: false, hits: [] });
    expect(runCheck({ root: makeTempDir(), env })).toMatchObject({ ok: false, missing: true });
  });
});

describe('the CLI', () => {
  const cli = (root, env = {}) => {
    const { VITE_DEMO_OUTBOX: _drop, VITE_TRACE_ENV: _dropEnv, ...rest } = process.env;
    return spawnSync(process.execPath, [SCRIPT, root], {
      encoding: 'utf8',
      env: { ...rest, ...env },
    });
  };

  it('exits 0 on a clean build and 1 with the file names on a hit', () => {
    expect(cli(repo(clean)).status).toBe(0);
    const bad = cli(repo({ ...clean, [`${DIST}/assets/a.js`]: 'Demo outbox' }));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain(`${DIST}/assets/a.js`);
  });

  it('checks a flagged production build: exit 1 on a hit, 0 when clean', () => {
    const env = { VITE_DEMO_OUTBOX: '1', VITE_TRACE_ENV: 'production' };
    const ok = cli(repo(clean), env);
    expect(ok.status).toBe(0);
    expect(ok.stdout).not.toMatch(/skipped/);
    const bad = cli(repo({ ...clean, [`${DIST}/assets/a.js`]: 'demo-outbox' }), env);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain(`${DIST}/assets/a.js`);
  });

  it('checks a flagged build with a mistyped flavour (prod): exit 1 on a hit', () => {
    const env = { VITE_DEMO_OUTBOX: '1', VITE_TRACE_ENV: 'prod' };
    const bad = cli(repo({ ...clean, [`${DIST}/assets/a.js`]: 'demo-outbox' }), env);
    expect(bad.status).toBe(1);
    expect(
      cli(repo({ ...clean, [`${DIST}/assets/a.js`]: 'demo-outbox' }), { VITE_DEMO_OUTBOX: '1' })
        .status,
    ).toBe(1);
  });

  it('exits 0 with a skip notice for a staging or dev demo build', () => {
    for (const traceEnv of ['staging', 'dev']) {
      const r = cli(repo({ ...clean, [`${DIST}/assets/a.js`]: 'demo-outbox' }), {
        VITE_DEMO_OUTBOX: '1',
        VITE_TRACE_ENV: traceEnv,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/skipped/);
    }
  });
});
