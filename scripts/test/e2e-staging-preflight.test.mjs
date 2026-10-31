// scripts/e2e-staging-preflight.mjs (specs/d1-demo-slice.md §7.1, §7.3 step 1; AT-D1, AT-D2): the
// e2e-staging contract check, the deployed-commit check and the `--record` launcher. Fakes only: an
// injected fetch and spawn, no network, no process. Synthetic values only; key-shaped strings are
// built at run time (the pre-commit gitleaks hook rejects secret-shaped literals).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  E2E_STAGING_PLAYWRIGHT_ENV,
  E2E_STAGING_PREFLIGHT_CMD,
  E2E_STAGING_PREFLIGHT_ENV,
} from '../check-workflows.mjs';
import {
  CONTRACT,
  CREDENTIALS,
  MANIFEST_FILE,
  PLAYWRIGHT_CLI,
  RECORDED_MS_MAX,
  RECORDED_MS_MIN,
  SLICE_SPEC,
  STAGING_ORIGINS,
  checkContract,
  checkRecordedManifest,
  checkStack,
  main,
} from '../e2e-staging-preflight.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SHA = 'c'.repeat(40);
const OTHER_SHA = 'd'.repeat(40);
const TIME = '2026-10-19T00:00:00.000Z';
const enc = (s) => Buffer.from(s).toString('base64url');
const PUBLISHABLE = `sb_publishable_${enc('synthetic-publishable-key-value')}`;
const SECRET_KEY = `sb_secret_${enc('synthetic-secret-key-value')}`;
const SUPABASE = `https://${'a'.repeat(20)}.supabase.co`;
const PASSWORD = `${enc('synthetic-e2e-password')}-Aa1`;

const env = (over = {}) => ({
  ...STAGING_ORIGINS,
  E2E_SUPABASE_URL: SUPABASE,
  E2E_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  E2E_SHA: SHA,
  ...over,
});
const credentials = () => ({
  E2E_RECRUITER_EMAIL: 'smoke+staging@example.com',
  E2E_RECRUITER_PASSWORD: PASSWORD,
  E2E_RECRUITER_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
  E2E_REVIEWER_EMAIL: 'smoke-reviewer+staging@example.com',
  E2E_REVIEWER_PASSWORD: PASSWORD,
  E2E_REVIEWER_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
});

const jsonResponse = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** A fake staging stack: every endpoint serves `sha` unless `over` replaces a URL's response. */
function fakeFetch({ sha = SHA, over = {} } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (Object.hasOwn(over, url)) {
      const r = over[url];
      return typeof r === 'function' ? r() : r;
    }
    const health = {
      [`${STAGING_ORIGINS.E2E_API_URL}/health`]: 'api',
      [`${STAGING_ORIGINS.E2E_EDGE_URL}/health`]: 'edge',
    };
    const apps = {
      [`${STAGING_ORIGINS.E2E_CANDIDATE_URL}/version.json`]: 'candidate',
      [`${STAGING_ORIGINS.E2E_RECRUITER_URL}/version.json`]: 'recruiter',
    };
    if (health[url])
      return jsonResponse(200, { status: 'ok', service: health[url], version: sha, time: TIME });
    if (apps[url]) return jsonResponse(200, { app: apps[url], version: sha });
    throw new Error(`unexpected request ${url}`);
  };
  return { fetch, calls };
}

/** The launch clock main reads, and a fresh record-mode manifest written after it (AT-D2, D1-SPEC-2). */
const LAUNCH_MS = Date.parse('2026-10-21T10:00:00.000Z');
const now = () => LAUNCH_MS;
const manifestOf = (over = {}) => ({
  spec: 'd1-slice',
  project: 'staging',
  sha: SHA,
  runId: 'run-1',
  record: true,
  startedAt: '2026-10-21T10:00:05.000Z',
  durationMs: 360_000,
  recordedMs: 300_000,
  steps: [],
  time_to_ready_ms: {},
  ciRunId: null,
  ...over,
});
/** A manifest reader that records the path it was asked for. */
const reader = (manifest) => {
  const paths = [];
  return { paths, readManifest: (file) => (paths.push(file), manifest) };
};

function io() {
  const out = [];
  const err = [];
  return {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    stdout: () => out.join('\n'),
    stderr: () => err.join('\n'),
    all: () => [...out, ...err].join('\n'),
  };
}

describe('the contract (d1 §7.1, lead decision R5)', () => {
  it('names exactly the public half of the e2e-staging env, the same set check-workflows pins', () => {
    expect(STAGING_ORIGINS).toEqual({
      E2E_CANDIDATE_URL: 'https://trace-candidate-staging.pages.dev',
      E2E_RECRUITER_URL: 'https://trace-recruiter-staging.pages.dev',
      E2E_API_URL: 'https://trace-api-staging.abhayraj.workers.dev',
      E2E_EDGE_URL: 'https://trace-edge-staging.abhayraj.workers.dev',
    });
    expect([...CONTRACT].sort()).toEqual(Object.keys(E2E_STAGING_PREFLIGHT_ENV).sort());
    for (const [name, origin] of Object.entries(STAGING_ORIGINS))
      expect(E2E_STAGING_PREFLIGHT_ENV[name]).toBe(origin);
    expect([...CREDENTIALS].sort()).toEqual(
      Object.keys(E2E_STAGING_PLAYWRIGHT_ENV)
        .filter((n) => /_(EMAIL|PASSWORD|TOTP_SECRET)$/.test(n))
        .sort(),
    );
    expect(SLICE_SPEC).toBe('tests/d1-slice.spec.ts');
    expect(PLAYWRIGHT_CLI).toBe('e2e/node_modules/@playwright/test/cli.js');
  });

  it('accepts the full contract, and a Supabase URL with a trailing slash', () => {
    expect(checkContract(env())).toEqual([]);
    expect(checkContract(env({ E2E_SUPABASE_URL: `${SUPABASE}/` }))).toEqual([]);
  });

  it.each(CONTRACT)('names %s when it is missing or empty', (name) => {
    for (const value of [undefined, '', '   ']) {
      const e = env();
      if (value === undefined) delete e[name];
      else e[name] = value;
      const problems = checkContract(e);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(new RegExp(`^${name}: is not set`));
    }
  });

  it.each([
    ['E2E_API_URL', 'https://trace-api-staging.other.workers.dev'],
    ['E2E_API_URL', 'https://trace-api-staging.abhayraj.workers.dev/'],
    ['E2E_EDGE_URL', 'http://trace-edge-staging.abhayraj.workers.dev'],
    ['E2E_CANDIDATE_URL', 'https://abc123.trace-candidate-staging.pages.dev'],
    ['E2E_RECRUITER_URL', 'http://localhost:5174'],
    ['E2E_SUPABASE_URL', 'http://aaaaaaaaaaaaaaaaaaaa.supabase.co'],
    ['E2E_SUPABASE_URL', 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/rest/v1'],
    ['E2E_SUPABASE_URL', 'https://example.test'],
    ['E2E_SUPABASE_URL', 'http://127.0.0.1:54321'],
    ['E2E_SUPABASE_PUBLISHABLE_KEY', SECRET_KEY],
    ['E2E_SUPABASE_PUBLISHABLE_KEY', `${enc('{"alg":"HS256"}')}.${enc('{"role":"anon"}')}.sig`],
    ['E2E_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_short'],
    ['E2E_SHA', 'c'.repeat(39)],
    ['E2E_SHA', 'C'.repeat(40)],
    ['E2E_SHA', 'dev'],
  ])('names %s when it is malformed, never printing the value', (name, value) => {
    const problems = checkContract(env({ [name]: value }));
    expect(problems).toHaveLength(1);
    expect(problems[0].startsWith(`${name}: `)).toBe(true);
    expect(problems[0]).not.toContain(value.trim());
  });

  it('prints the expected origin (public) but never a received value', () => {
    const [p] = checkContract(env({ E2E_API_URL: 'https://evil.example.test' }));
    expect(p).toBe(`E2E_API_URL: must be exactly ${STAGING_ORIGINS.E2E_API_URL}`);
    // exact: surrounding whitespace is a different value
    expect(
      checkContract(env({ E2E_RECRUITER_URL: ` ${STAGING_ORIGINS.E2E_RECRUITER_URL}` })),
    ).toEqual([`E2E_RECRUITER_URL: must be exactly ${STAGING_ORIGINS.E2E_RECRUITER_URL}`]);
  });
});

describe('the deployed stack (health and versions at E2E_SHA)', () => {
  it('passes when api and edge /health and both /version.json serve E2E_SHA', async () => {
    const f = fakeFetch();
    expect(await checkStack({ env: env(), fetch: f.fetch })).toEqual([]);
    expect(f.calls.map((c) => c.url).sort()).toEqual(
      [
        `${STAGING_ORIGINS.E2E_API_URL}/health`,
        `${STAGING_ORIGINS.E2E_EDGE_URL}/health`,
        `${STAGING_ORIGINS.E2E_CANDIDATE_URL}/version.json`,
        `${STAGING_ORIGINS.E2E_RECRUITER_URL}/version.json`,
      ].sort(),
    );
    for (const c of f.calls) {
      expect(c.init.method).toBe('GET');
      expect(c.init.redirect).toBe('manual');
      expect(c.init.signal).toBeInstanceOf(AbortSignal);
      // no credential of any kind is ever sent
      expect(c.init.headers?.authorization).toBeUndefined();
      expect(c.init.headers?.apikey).toBeUndefined();
    }
  });

  it('reports every endpoint on another commit, by name', async () => {
    const problems = await checkStack({ env: env(), fetch: fakeFetch({ sha: OTHER_SHA }).fetch });
    expect(problems).toEqual([
      `api /health: version is ${OTHER_SHA}, expected ${SHA} (E2E_SHA)`,
      `edge /health: version is ${OTHER_SHA}, expected ${SHA} (E2E_SHA)`,
      `candidate /version.json: version is ${OTHER_SHA}, expected ${SHA} (E2E_SHA)`,
      `recruiter /version.json: version is ${OTHER_SHA}, expected ${SHA} (E2E_SHA)`,
    ]);
  });

  it.each([
    ['a 503', () => jsonResponse(503, { error: 'unavailable' }), /api \/health: HTTP 503/],
    [
      'a redirect',
      () => new Response(null, { status: 302, headers: { location: 'https://x.example.test' } }),
      /api \/health: redirect \(HTTP 302\)/,
    ],
    [
      'another service',
      () => jsonResponse(200, { status: 'ok', service: 'jobs', version: SHA, time: TIME }),
      /api \/health: service is jobs, expected api/,
    ],
    [
      'an extra key',
      () =>
        jsonResponse(200, { status: 'ok', service: 'api', version: SHA, time: TIME, x: PASSWORD }),
      /api \/health: body does not match HealthResponse/,
    ],
    ['not JSON', () => new Response('<html>', { status: 200 }), /api \/health: body is not JSON/],
    [
      'a network error',
      () => {
        throw new TypeError(`connect failed ${PASSWORD}`);
      },
      /api \/health: request failed \(TypeError\)/,
    ],
    [
      'a body over the cap',
      () => new Response('x'.repeat(70_000), { status: 200 }),
      /api \/health: body is larger than 65536 bytes/,
    ],
  ])('reports %s on api /health without its body', async (_label, response, message) => {
    const f = fakeFetch({ over: { [`${STAGING_ORIGINS.E2E_API_URL}/health`]: response } });
    const problems = await checkStack({ env: env(), fetch: f.fetch });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(message);
    expect(problems[0]).not.toContain(PASSWORD);
  });

  it('reports a version file for the wrong app', async () => {
    const f = fakeFetch({
      over: {
        [`${STAGING_ORIGINS.E2E_RECRUITER_URL}/version.json`]: jsonResponse(200, {
          app: 'candidate',
          version: SHA,
        }),
      },
    });
    expect(await checkStack({ env: env(), fetch: f.fetch })).toEqual([
      'recruiter /version.json: app is candidate, expected recruiter',
    ]);
  });
});

describe('main (pnpm e2e:staging:preflight)', () => {
  it('is the root script, and e2e:record is its --record mode', () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    expect(pkg.scripts['e2e:staging:preflight']).toBe('node scripts/e2e-staging-preflight.mjs');
    expect(`pnpm ${'e2e:staging:preflight'}`).toBe(E2E_STAGING_PREFLIGHT_CMD);
    expect(pkg.scripts['e2e:record']).toBe('node scripts/e2e-staging-preflight.mjs --record');
  });

  it('prints OK with the commit and exits 0', async () => {
    const o = io();
    const code = await main({ argv: [], env: env(), fetch: fakeFetch().fetch, ...o });
    expect(code).toBe(0);
    expect(o.stdout()).toBe(
      `e2e-staging-preflight: OK (api, edge, candidate, recruiter serve ${SHA})`,
    );
    expect(o.stderr()).toBe('');
  });

  it('stops before any request when the contract is broken, printing names only', async () => {
    const o = io();
    const f = fakeFetch();
    const code = await main({
      argv: [],
      env: env({ E2E_SUPABASE_PUBLISHABLE_KEY: SECRET_KEY, E2E_SHA: '' }),
      fetch: f.fetch,
      ...o,
    });
    expect(code).toBe(1);
    expect(f.calls).toHaveLength(0);
    expect(o.stderr()).toMatch(/E2E_SUPABASE_PUBLISHABLE_KEY: /);
    expect(o.stderr()).toMatch(/E2E_SHA: is not set/);
    expect(o.all()).not.toContain(SECRET_KEY);
  });

  it('exits 1 when the stack serves another commit', async () => {
    const o = io();
    const code = await main({
      argv: [],
      env: env(),
      fetch: fakeFetch({ sha: OTHER_SHA }).fetch,
      ...o,
    });
    expect(code).toBe(1);
    expect(o.stderr()).toMatch(/4 problem\(s\)/);
  });

  it('never needs or prints a credential, even when one is set', async () => {
    const o = io();
    const code = await main({
      argv: [],
      env: env(credentials()),
      fetch: fakeFetch().fetch,
      ...o,
    });
    expect(code).toBe(0);
    for (const value of Object.values(credentials())) expect(o.all()).not.toContain(value);
  });

  it('refuses an unknown argument (exit 2) without echoing it', async () => {
    const o = io();
    const f = fakeFetch();
    expect(await main({ argv: ['--sha=abc'], env: env(), fetch: f.fetch, ...o })).toBe(2);
    expect(o.stderr()).not.toContain('abc');
    expect(f.calls).toHaveLength(0);
  });
});

describe('main --record (pnpm e2e:record, d1 §7.3)', () => {
  const spawnFake = (code = 0) => {
    const calls = [];
    return {
      calls,
      spawn: async (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return code;
      },
    };
  };

  it('on staging: runs the preflight, then the slice spec with E2E_RECORD=1 and E2E_STAGING=1', async () => {
    const o = io();
    const s = spawnFake(0);
    const code = await main({
      argv: ['--record'],
      env: env(credentials()),
      fetch: fakeFetch().fetch,
      spawn: s.spawn,
      readManifest: reader(manifestOf({ project: 'staging' })).readManifest,
      now,
      root: REPO,
      ...o,
    });
    expect(code).toBe(0);
    expect(s.calls).toHaveLength(1);
    const [c] = s.calls;
    expect(c.cmd).toBe(process.execPath);
    expect(c.args).toEqual([
      path.join(REPO, PLAYWRIGHT_CLI),
      'test',
      SLICE_SPEC,
      '--project',
      'staging',
    ]);
    expect(c.opts.cwd).toBe(path.join(REPO, 'e2e'));
    expect(c.opts.env).toMatchObject({ E2E_RECORD: '1', E2E_STAGING: '1', E2E_SHA: SHA });
    expect(c.opts.env.E2E_TRACE).toBeUndefined();
    // the credentials reach Playwright through the environment only, never an argument or output
    expect(c.opts.env.E2E_RECRUITER_PASSWORD).toBe(PASSWORD);
    expect(JSON.stringify(c.args)).not.toContain(PASSWORD);
    expect(o.all()).not.toContain(PASSWORD);
  });

  it('passes on Playwright’s exit code', async () => {
    const s = spawnFake(3);
    const code = await main({
      argv: ['--record'],
      env: env(credentials()),
      fetch: fakeFetch().fetch,
      spawn: s.spawn,
      root: REPO,
      ...io(),
    });
    expect(code).toBe(3);
  });

  it('does not start Playwright when the preflight fails or a credential is missing', async () => {
    for (const [e, f] of [
      [env(credentials()), fakeFetch({ sha: OTHER_SHA }).fetch],
      [env({ ...credentials(), E2E_REVIEWER_TOTP_SECRET: '' }), fakeFetch().fetch],
    ]) {
      const o = io();
      const s = spawnFake(0);
      expect(
        await main({ argv: ['--record'], env: e, fetch: f, spawn: s.spawn, root: REPO, ...o }),
      ).toBe(1);
      expect(s.calls).toHaveLength(0);
      expect(o.all()).not.toContain(PASSWORD);
    }
    const o = io();
    await main({
      argv: ['--record'],
      env: env({ ...credentials(), E2E_REVIEWER_TOTP_SECRET: '' }),
      fetch: fakeFetch().fetch,
      spawn: spawnFake(0).spawn,
      root: REPO,
      ...o,
    });
    expect(o.stderr()).toMatch(/E2E_REVIEWER_TOTP_SECRET: is not set/);
  });

  it('with E2E_LOCAL=1: runs the local project, no staging preflight, no E2E_STAGING', async () => {
    const s = spawnFake(0);
    const f = fakeFetch();
    const code = await main({
      argv: ['--record'],
      env: { E2E_LOCAL: '1', E2E_STAGING: '1', E2E_RECRUITER_URL: 'http://localhost:5174' },
      fetch: f.fetch,
      spawn: s.spawn,
      readManifest: reader(manifestOf({ project: 'local' })).readManifest,
      now,
      root: REPO,
      ...io(),
    });
    expect(code).toBe(0);
    expect(f.calls).toHaveLength(0);
    expect(s.calls[0].args.slice(-2)).toEqual(['--project', 'local']);
    expect(s.calls[0].opts.env.E2E_RECORD).toBe('1');
    expect(s.calls[0].opts.env.E2E_STAGING).toBeUndefined();
  });
});

describe('main --record: the AT-D2 recorded span (d1 §7.3, D1-SPEC-2)', () => {
  const record = async (manifest, { code = 0, envOver = {} } = {}) => {
    const o = io();
    const r = reader(manifest);
    const calls = [];
    const exit = await main({
      argv: ['--record'],
      env: { ...env(credentials()), ...envOver },
      fetch: fakeFetch().fetch,
      spawn: async (...args) => (calls.push(args), code),
      readManifest: r.readManifest,
      now,
      root: REPO,
      ...o,
    });
    return { exit, o, paths: r.paths, calls };
  };

  it('pins the window at 270 000-330 000 ms and the manifest path Playwright writes', () => {
    expect([RECORDED_MS_MIN, RECORDED_MS_MAX]).toEqual([270_000, 330_000]);
    expect(MANIFEST_FILE).toBe('e2e/test-results/d1-manifest.json');
  });

  it('exits 0 and prints recordedMs when the recorded span is inside the window (both bounds included)', async () => {
    for (const recordedMs of [270_000, 300_000, 330_000]) {
      const { exit, o, paths } = await record(manifestOf({ recordedMs }));
      expect(exit).toBe(0);
      expect(paths).toEqual([path.join(REPO, MANIFEST_FILE)]);
      expect(o.stdout()).toContain(`recordedMs ${recordedMs}`);
    }
  });

  it('exits 1 when recordedMs is outside the window, null, missing or not an integer', async () => {
    for (const recordedMs of [269_999, 330_001, 0, null, undefined, 300_000.5, '300000']) {
      const m = manifestOf({ recordedMs });
      if (recordedMs === undefined) delete m.recordedMs;
      const { exit, o } = await record(m);
      expect(exit, String(recordedMs)).toBe(1);
      expect(o.stderr()).toMatch(/recordedMs/);
    }
  });

  it('exits 1 when the manifest is missing, stale, not a record run or of another project', async () => {
    for (const [m, why] of [
      [null, /d1-manifest\.json: missing or not JSON/],
      [manifestOf({ startedAt: '2026-10-21T09:59:59.000Z' }), /older than this run/],
      [manifestOf({ startedAt: 'not a date' }), /older than this run/],
      [manifestOf({ record: false }), /not a record-mode run/],
      [manifestOf({ project: 'local' }), /project/],
    ]) {
      const { exit, o } = await record(m);
      expect(exit).toBe(1);
      expect(o.stderr()).toMatch(why);
    }
  });

  it('passes on a failed Playwright exit code without reading the manifest', async () => {
    const { exit, paths } = await record(manifestOf(), { code: 2 });
    expect(exit).toBe(2);
    expect(paths).toHaveLength(0);
  });

  it('checkRecordedManifest names each problem and never echoes a value other than recordedMs', () => {
    expect(
      checkRecordedManifest(manifestOf(), { project: 'staging', launchedAtMs: LAUNCH_MS }),
    ).toEqual([]);
    const problems = checkRecordedManifest(
      manifestOf({ recordedMs: 400_000, record: false, project: 'local' }),
      { project: 'staging', launchedAtMs: LAUNCH_MS },
    );
    expect(problems).toHaveLength(3);
    expect(problems.join(' ')).not.toContain(SHA);
  });
});
