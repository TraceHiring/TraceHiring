// AT-11 / AT-22-staging (local proxies): scripts/smoke-staging.mjs checks the deployed staging
// Workers and apps (spec §7.2 step 8, §9.3, §9.4, §10.3). Wrangler's output file is a synthetic
// recorded-shape fixture, and an injected fetch stands in for the network; nothing leaves this
// machine.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  APP_PROJECTS,
  DEFAULTS,
  MAX_BODY_BYTES,
  WORKER_NAMES,
  checkAppUrl,
  checkWorkerUrl,
  main,
  parseWranglerOutput,
  runSmoke,
  smokeApp,
  smokeWorker,
} from '../smoke-staging.mjs';

const OUTPUT = readFileSync(
  fileURLToPath(new URL('./fixtures/staging/wrangler-output.ndjson', import.meta.url)),
  'utf8',
);
const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/staging/${name}`, import.meta.url)), 'utf8');
const PREVIEW_OUTPUT = fixture('wrangler-output-preview.ndjson');
const WRONG_BRANCH_OUTPUT = fixture('wrangler-output-wrong-branch.ndjson');
const SMOKE_SCRIPT = fileURLToPath(new URL('../smoke-staging.mjs', import.meta.url));
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const TIME = '2026-10-12T00:00:00.000Z';

const WORKER_URLS = {
  edge: 'https://trace-edge-staging.fixture-sub.workers.dev',
  jobs: 'https://trace-jobs-staging.fixture-sub.workers.dev',
  api: 'https://trace-api-staging.fixture-sub.workers.dev',
};
const APP_URLS = {
  candidate: 'https://0a1b2c3d.trace-candidate-staging.pages.dev',
  recruiter: 'https://4e5f6a7b.trace-recruiter-staging.pages.dev',
};

/** The production alias of each project (the project's pages.dev origin). */
const ALIAS_URLS = {
  candidate: 'https://trace-candidate-staging.pages.dev',
  recruiter: 'https://trace-recruiter-staging.pages.dev',
};

/** The §10.3 headers as the apps' _headers files set them (candidate connect-src: §10.3 extra). */
const securityHeaders = (app) => ({
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'" +
    (app === 'candidate' ? ' https://trace-edge-staging.fixture-sub.workers.dev' : '') +
    "; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy':
    app === 'candidate'
      ? 'camera=(self), microphone=(self), geolocation=()'
      : 'camera=(), microphone=(), geolocation=()',
});

const json = (body, headers = {}, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * A fake staging: every endpoint healthy at `sha`, unless `override(url)` returns a Response.
 * Records each call's URL and init.
 */
function fakeStaging({ sha = SHA, override = () => undefined } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const o = override(String(url));
    if (o !== undefined) return typeof o === 'function' ? o() : o;
    const u = new URL(url);
    for (const [service, base] of Object.entries(WORKER_URLS)) {
      if (u.origin === base && u.pathname === '/health')
        return json(
          { status: 'ok', service, version: sha, time: TIME },
          { 'cache-control': 'no-store' },
        );
    }
    for (const [app, base] of Object.entries(APP_URLS)) {
      if (u.origin !== base && u.origin !== ALIAS_URLS[app]) continue;
      if (u.pathname === '/version.json') return json({ app, version: sha }, securityHeaders(app));
      if (u.pathname === '/')
        return new Response('<!doctype html><title>Trace</title>', {
          status: 200,
          headers: { 'content-type': 'text/html', ...securityHeaders(app) },
        });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

const noSleep = async () => {};

describe('names', () => {
  it('are the staging Worker names (wrangler.jsonc env.staging) and the §7.2 Pages projects', () => {
    expect(WORKER_NAMES).toEqual({
      edge: 'trace-edge-staging',
      jobs: 'trace-jobs-staging',
      api: 'trace-api-staging',
    });
    expect(APP_PROJECTS).toEqual({
      candidate: 'trace-candidate-staging',
      recruiter: 'trace-recruiter-staging',
    });
  });
});

describe('parseWranglerOutput', () => {
  it('reads the Worker and Pages URLs from the deploy and pages-deploy entries', () => {
    const r = parseWranglerOutput(OUTPUT);
    expect(r.problems).toEqual([]);
    expect(r.workers).toEqual(WORKER_URLS);
    expect(r.apps).toEqual(APP_URLS);
    expect(r.aliases).toEqual(ALIAS_URLS);
  });

  it('derives the production alias from a suffixed project host too', () => {
    const suffixed = OUTPUT.replaceAll(
      '0a1b2c3d.trace-candidate-staging.pages.dev',
      '0a1b2c3d.trace-candidate-staging-7xq.pages.dev',
    );
    const r = parseWranglerOutput(suffixed);
    expect(r.problems).toEqual([]);
    expect(r.aliases.candidate).toBe('https://trace-candidate-staging-7xq.pages.dev');
    expect(r.aliases.recruiter).toBe(ALIAS_URLS.recruiter);
  });

  it('fails a preview-environment deploy (the production alias would still serve the old build)', () => {
    const r = parseWranglerOutput(PREVIEW_OUTPUT);
    expect(r.problems.join('\n')).toMatch(
      /trace-candidate-staging: deployed to the preview environment, not production/,
    );
    expect(r.apps.candidate).toBeUndefined();
    expect(r.aliases.candidate).toBeUndefined();
    expect(r.apps.recruiter).toBe(APP_URLS.recruiter);
  });

  it('fails a project whose production branch is not main', () => {
    const r = parseWranglerOutput(WRONG_BRANCH_OUTPUT);
    expect(r.problems.join('\n')).toMatch(
      /trace-recruiter-staging: production branch is trunk, expected main/,
    );
    expect(r.apps.recruiter).toBeUndefined();
  });

  it('needs exactly one pages-deploy-detailed entry per project, for the same deployment', () => {
    const noDetail = OUTPUT.split('\n').filter(
      (l) =>
        !(l.includes('"type":"pages-deploy-detailed"') && l.includes('trace-candidate-staging')),
    );
    expect(parseWranglerOutput(noDetail.join('\n')).problems.join('\n')).toMatch(
      /no pages-deploy-detailed entry for trace-candidate-staging/,
    );
    const dup = OUTPUT.split('\n').filter((l) => l.includes('"type":"pages-deploy-detailed"'));
    expect(parseWranglerOutput([OUTPUT, ...dup].join('\n')).problems.join('\n')).toMatch(
      /2 pages-deploy-detailed entries for trace-recruiter-staging/,
    );
    const otherDeployment = OUTPUT.replace(
      '"pages-deploy-detailed","version":1,"pages_project":"trace-candidate-staging","deployment_id":"00000000-0000-4000-8000-00000000000a"',
      '"pages-deploy-detailed","version":1,"pages_project":"trace-candidate-staging","deployment_id":"00000000-0000-4000-8000-0000000000ff"',
    );
    expect(parseWranglerOutput(otherDeployment).problems.join('\n')).toMatch(
      /trace-candidate-staging: pages-deploy-detailed is for another deployment than pages-deploy/,
    );
  });

  it('ignores other entry types and blank lines, and accepts CRLF', () => {
    const extra = `\n${JSON.stringify({ type: 'version-upload', version: 1 })}\r\n\r\n`;
    const r = parseWranglerOutput(OUTPUT.replace(/\n/g, '\r\n') + extra);
    expect(r.problems).toEqual([]);
    expect(r.workers.api).toBe(WORKER_URLS.api);
  });

  it('fails on a line that is not JSON, without echoing it', () => {
    const r = parseWranglerOutput(`${OUTPUT}not json secret-ish\n`);
    expect(r.problems.join('\n')).toMatch(/line 13: not a JSON object/);
    expect(r.problems.join('\n')).not.toMatch(/secret-ish/);
  });

  it('fails when a Worker or app was not deployed (empty output file too)', () => {
    const lines = OUTPUT.split('\n').filter(
      (l) => !l.includes('"trace-jobs-staging"') && !l.includes('"trace-recruiter-staging"'),
    );
    const text = parseWranglerOutput(lines.join('\n')).problems.join('\n');
    expect(text).toMatch(/no deploy entry for trace-jobs-staging/);
    expect(text).toMatch(/no pages-deploy entry for trace-recruiter-staging/);
    expect(parseWranglerOutput('').problems).toHaveLength(5);
  });

  it('fails on two deploys of one Worker or project (ambiguous)', () => {
    const dup = OUTPUT.split('\n').filter((l) => l.includes('"trace-edge-staging"'));
    const dupPages = OUTPUT.split('\n').filter((l) => l.includes('"type":"pages-deploy"'));
    const text = parseWranglerOutput([OUTPUT, ...dup, ...dupPages].join('\n')).problems.join('\n');
    expect(text).toMatch(/2 deploy entries for trace-edge-staging/);
    expect(text).toMatch(/2 pages-deploy entries for trace-candidate-staging/);
  });

  it('fails on a deploy of an unexpected Worker or project, or outside env staging', () => {
    const entries = [
      { type: 'deploy', worker_name: 'trace-edge', targets: [], wrangler_environment: undefined },
      { type: 'pages-deploy', pages_project: 'someone-else', url: 'https://x.pages.dev' },
    ];
    const text = parseWranglerOutput(
      [OUTPUT, ...entries.map((e) => JSON.stringify(e))].join('\n'),
    ).problems.join('\n');
    expect(text).toMatch(/unexpected deploy entry for Worker trace-edge/);
    expect(text).toMatch(/unexpected pages-deploy entry for project someone-else/);
    const wrongEnv = OUTPUT.replace(
      '"worker_name":"trace-api-staging","worker_tag":"fixturetag0003","version_id":"00000000-0000-4000-8000-000000000003","targets":["https://trace-api-staging.fixture-sub.workers.dev"],"wrangler_environment":"staging"',
      '"worker_name":"trace-api-staging","worker_tag":"fixturetag0003","version_id":"00000000-0000-4000-8000-000000000003","targets":["https://trace-api-staging.fixture-sub.workers.dev"],"wrangler_environment":"dev"',
    );
    expect(parseWranglerOutput(wrongEnv).problems.join('\n')).toMatch(
      /trace-api-staging was deployed with --env dev, not staging/,
    );
  });

  it('fails when a deploy has no workers.dev target or more than one', () => {
    const none = OUTPUT.replace(
      '"targets":["https://trace-edge-staging.fixture-sub.workers.dev"]',
      '"targets":["schedule: */5 * * * *"]',
    );
    expect(parseWranglerOutput(none).problems.join('\n')).toMatch(
      /trace-edge-staging: expected exactly one workers\.dev target \(found 0\)/,
    );
    const two = OUTPUT.replace(
      '"targets":["https://trace-edge-staging.fixture-sub.workers.dev"]',
      '"targets":["https://trace-edge-staging.fixture-sub.workers.dev","https://trace-edge-staging.other.workers.dev"]',
    );
    expect(parseWranglerOutput(two).problems.join('\n')).toMatch(/found 2/);
  });

  it('fails when a URL is not on the expected host', () => {
    const evil = OUTPUT.replace(
      'https://0a1b2c3d.trace-candidate-staging.pages.dev',
      'https://trace-candidate-staging.pages.dev.example.invalid',
    );
    expect(parseWranglerOutput(evil).problems.join('\n')).toMatch(
      /trace-candidate-staging: .*is not https:\/\/\[<deployment>\.\]trace-candidate-staging\[-<suffix>\]\.pages\.dev/,
    );
  });
});

describe('checkWorkerUrl / checkAppUrl', () => {
  it('accept the workers.dev and pages.dev origins wrangler reports', () => {
    expect(checkWorkerUrl('edge', WORKER_URLS.edge)).toBeNull();
    expect(checkAppUrl('candidate', APP_URLS.candidate)).toBeNull();
    expect(checkAppUrl('candidate', 'https://trace-candidate-staging.pages.dev')).toBeNull();
    expect(checkAppUrl('recruiter', 'https://trace-recruiter-staging-7xq.pages.dev')).toBeNull();
  });

  it('reject http, other hosts, credentials, ports, paths, queries and the wrong Worker', () => {
    const bad = [
      'http://trace-edge-staging.fixture-sub.workers.dev',
      'https://trace-edge-staging.fixture-sub.workers.dev.example.invalid',
      'https://user:pw@trace-edge-staging.fixture-sub.workers.dev',
      'https://trace-edge-staging.fixture-sub.workers.dev:8443',
      'https://trace-edge-staging.fixture-sub.workers.dev/x',
      'https://trace-edge-staging.fixture-sub.workers.dev/?a=1',
      'https://trace-api-staging.fixture-sub.workers.dev',
      'https://evil.trace-edge-staging.fixture-sub.workers.dev',
      'not a url',
    ];
    for (const u of bad) expect(checkWorkerUrl('edge', u), u).not.toBeNull();
    expect(
      checkAppUrl('candidate', 'https://0a1b2c3d.trace-recruiter-staging.pages.dev'),
    ).not.toBeNull();
    expect(
      checkAppUrl('candidate', 'https://a.b.trace-candidate-staging.pages.dev'),
    ).not.toBeNull();
    expect(checkAppUrl('candidate', WORKER_URLS.edge)).not.toBeNull();
  });
});

describe('smokeWorker', () => {
  it('passes a schema-valid /health at the expected SHA, fetched without following redirects', async () => {
    const { fetch, calls } = fakeStaging();
    expect(await smokeWorker({ service: 'edge', url: WORKER_URLS.edge, sha: SHA, fetch })).toEqual(
      [],
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${WORKER_URLS.edge}/health`);
    expect(calls[0].init.redirect).toBe('manual');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('fails on another version, the wrong service, a bad body or a missing no-store', async () => {
    const cases = [
      [
        { status: 'ok', service: 'edge', version: OTHER_SHA, time: TIME },
        /version is b{40}, expected a{40}/,
      ],
      [{ status: 'ok', service: 'api', version: SHA, time: TIME }, /service is api, expected edge/],
      [
        { status: 'ok', service: 'edge', version: SHA, time: TIME, extra: 1 },
        /does not match HealthResponse/,
      ],
      [
        { status: 'down', service: 'edge', version: SHA, time: TIME },
        /does not match HealthResponse \(status:/,
      ],
      [
        { status: 'ok', service: 'edge', version: 'dev', time: TIME },
        /version is dev, expected a{40}/,
      ],
    ];
    for (const [body, re] of cases) {
      const { fetch } = fakeStaging({
        override: (u) =>
          u.endsWith('/health') ? json(body, { 'cache-control': 'no-store' }) : undefined,
      });
      const p = await smokeWorker({ service: 'edge', url: WORKER_URLS.edge, sha: SHA, fetch });
      expect(p.join('\n')).toMatch(re);
    }
    const { fetch } = fakeStaging({
      override: (u) =>
        u.endsWith('/health')
          ? json({ status: 'ok', service: 'edge', version: SHA, time: TIME })
          : undefined,
    });
    const p = await smokeWorker({ service: 'edge', url: WORKER_URLS.edge, sha: SHA, fetch });
    expect(p.join('\n')).toMatch(/cache-control must include no-store/);
  });

  it('fails on a redirect, an error status, a non-JSON or oversized body, without dumping the body', async () => {
    const cases = [
      [
        () =>
          new Response(null, { status: 302, headers: { location: 'https://example.invalid/' } }),
        /redirect \(HTTP 302\); redirects are not followed/,
      ],
      [() => new Response('internal detail', { status: 500 }), /HTTP 500/],
      [
        () =>
          new Response('internal detail', {
            status: 200,
            headers: { 'cache-control': 'no-store' },
          }),
        /body is not JSON/,
      ],
      [
        () =>
          new Response('x'.repeat(70_000), {
            status: 200,
            headers: { 'cache-control': 'no-store' },
          }),
        /body is larger than 65536 bytes/,
      ],
    ];
    for (const [res, re] of cases) {
      const { fetch } = fakeStaging({ override: () => res });
      const p = (
        await smokeWorker({ service: 'jobs', url: WORKER_URLS.jobs, sha: SHA, fetch })
      ).join('\n');
      expect(p).toMatch(re);
      expect(p).not.toMatch(/internal detail|example\.invalid/);
    }
  });

  it('fails on a network error or timeout', async () => {
    const fetch = async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };
    const p = await smokeWorker({ service: 'api', url: WORKER_URLS.api, sha: SHA, fetch });
    expect(p.join('\n')).toMatch(/request failed \(TimeoutError\)/);
  });

  // S3B-3: the cap is enforced while streaming, not after the whole body is in memory.
  const endlessBody = () => {
    const state = { pulls: 0, cancelled: false };
    const chunk = new Uint8Array(8_192).fill(120);
    const body = new ReadableStream(
      {
        pull(controller) {
          state.pulls++;
          controller.enqueue(chunk);
        },
        cancel() {
          state.cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    return { state, body };
  };

  it('cancels an endless body once it is over the cap, after reading about the cap only', async () => {
    const { state, body } = endlessBody();
    const { fetch } = fakeStaging({
      override: () => new Response(body, { status: 200, headers: { 'cache-control': 'no-store' } }),
    });
    const p = await smokeWorker({ service: 'edge', url: WORKER_URLS.edge, sha: SHA, fetch });
    expect(p.join('\n')).toMatch(/body is larger than 65536 bytes/);
    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBeLessThanOrEqual(Math.ceil(MAX_BODY_BYTES / 8_192) + 2);
  });

  it('rejects early on a content-length over the cap without reading the body', async () => {
    const { state, body } = endlessBody();
    const { fetch } = fakeStaging({
      override: () =>
        new Response(body, {
          status: 200,
          headers: { 'cache-control': 'no-store', 'content-length': String(MAX_BODY_BYTES + 1) },
        }),
    });
    const p = await smokeWorker({ service: 'edge', url: WORKER_URLS.edge, sha: SHA, fetch });
    expect(p.join('\n')).toMatch(/body is larger than 65536 bytes/);
    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBe(0);
  });

  it('still reads a normal body in several chunks', async () => {
    const text = JSON.stringify({ status: 'ok', service: 'edge', version: SHA, time: TIME });
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 10));
        controller.enqueue(bytes.slice(10));
        controller.close();
      },
    });
    const { fetch } = fakeStaging({
      override: () => new Response(body, { status: 200, headers: { 'cache-control': 'no-store' } }),
    });
    expect(await smokeWorker({ service: 'edge', url: WORKER_URLS.edge, sha: SHA, fetch })).toEqual(
      [],
    );
  });
});

describe('the script under plain Node (S3B-7)', () => {
  it('loads its module graph, including the .ts contracts import, and prints the usage line', () => {
    const r = spawnSync(process.execPath, [SMOKE_SCRIPT, '--sha', 'bad'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/smoke-staging: --wrangler-output <file> is required/);
    expect(r.stderr).toMatch(
      /smoke-staging: usage: node scripts\/smoke-staging\.mjs --wrangler-output <file> --sha <sha>/,
    );
    expect(r.stderr).not.toMatch(/ERR_|SyntaxError|Cannot find/);
  });
});

describe('smokeApp', () => {
  it('passes /version.json at the expected SHA with the §10.3 headers on it and on /', async () => {
    const { fetch, calls } = fakeStaging();
    for (const app of ['candidate', 'recruiter']) {
      expect(await smokeApp({ app, url: APP_URLS[app], sha: SHA, fetch })).toEqual([]);
    }
    expect(calls.map((c) => c.url)).toEqual([
      `${APP_URLS.candidate}/version.json`,
      `${APP_URLS.candidate}/`,
      `${APP_URLS.recruiter}/version.json`,
      `${APP_URLS.recruiter}/`,
    ]);
    for (const c of calls) expect(c.init.redirect).toBe('manual');
  });

  it('fails on another version, the wrong app, or a body that is not AppVersionFile', async () => {
    const cases = [
      [{ app: 'candidate', version: OTHER_SHA }, /version is b{40}, expected a{40}/],
      [{ app: 'recruiter', version: SHA }, /app is recruiter, expected candidate/],
      [{ app: 'candidate', version: SHA, extra: true }, /does not match AppVersionFile/],
    ];
    for (const [body, re] of cases) {
      const { fetch } = fakeStaging({
        override: (u) =>
          u.endsWith('/version.json') ? json(body, securityHeaders('candidate')) : undefined,
      });
      const p = await smokeApp({ app: 'candidate', url: APP_URLS.candidate, sha: SHA, fetch });
      expect(p.join('\n')).toMatch(re);
    }
  });

  it('fails when a §10.3 header is missing or wrong on either response', async () => {
    const without = (h, name) => Object.fromEntries(Object.entries(h).filter(([k]) => k !== name));
    const { fetch } = fakeStaging({
      override: (u) =>
        u === `${APP_URLS.recruiter}/`
          ? new Response('<!doctype html>', {
              status: 200,
              headers: {
                ...without(securityHeaders('recruiter'), 'strict-transport-security'),
                'referrer-policy': 'strict-origin-when-cross-origin',
              },
            })
          : undefined,
    });
    const p = (await smokeApp({ app: 'recruiter', url: APP_URLS.recruiter, sha: SHA, fetch })).join(
      '\n',
    );
    expect(p).toMatch(/recruiter \/: missing header strict-transport-security/);
    expect(p).toMatch(/recruiter \/: referrer-policy must be "no-referrer"/);

    const { fetch: f2 } = fakeStaging({
      override: (u) =>
        u.endsWith('/version.json')
          ? json(
              { app: 'candidate', version: SHA },
              {
                ...securityHeaders('candidate'),
                'content-security-policy': 'default-src *',
                'permissions-policy': 'camera=*',
              },
            )
          : undefined,
    });
    const p2 = (
      await smokeApp({ app: 'candidate', url: APP_URLS.candidate, sha: SHA, fetch: f2 })
    ).join('\n');
    expect(p2).toMatch(/candidate \/version\.json: CSP/);
    expect(p2).toMatch(/permissions-policy must be/);
  });

  it('rejects a connect-src origin that is not on the app allow-list (the §10.3 rules are reused)', async () => {
    const { fetch } = fakeStaging({
      override: (u) =>
        u === `${APP_URLS.recruiter}/`
          ? new Response('<!doctype html>', {
              status: 200,
              headers: {
                ...securityHeaders('recruiter'),
                'content-security-policy': securityHeaders('recruiter')[
                  'content-security-policy'
                ].replace("connect-src 'self'", "connect-src 'self' https://example.invalid"),
              },
            })
          : undefined,
    });
    const p = await smokeApp({ app: 'recruiter', url: APP_URLS.recruiter, sha: SHA, fetch });
    expect(p.join('\n')).toMatch(
      /connect-src source https:\/\/example\.invalid is not on the recruiter allow-list/,
    );
  });
});

describe('runSmoke', () => {
  const targets = { workers: WORKER_URLS, apps: APP_URLS, aliases: ALIAS_URLS };

  it('reports every endpoint ok when staging serves the SHA', async () => {
    const { fetch } = fakeStaging();
    const r = await runSmoke({ targets, sha: SHA, fetch, sleep: noSleep });
    expect(r.violations).toEqual([]);
    expect(r.report).toEqual([
      'edge /health: ok',
      'jobs /health: ok',
      'api /health: ok',
      'candidate /version.json and headers: ok',
      'recruiter /version.json and headers: ok',
      'candidate production alias /version.json and headers: ok',
      'recruiter production alias /version.json and headers: ok',
    ]);
  });

  it('retries a stale endpoint and passes once it serves the new SHA', async () => {
    let n = 0;
    const { fetch } = fakeStaging({
      override: (u) => {
        if (!u.endsWith('/health') || !u.includes('trace-api')) return undefined;
        n++;
        const version = n < 3 ? OTHER_SHA : SHA;
        return json(
          { status: 'ok', service: 'api', version, time: TIME },
          { 'cache-control': 'no-store' },
        );
      },
    });
    const sleeps = [];
    const r = await runSmoke({
      targets,
      sha: SHA,
      fetch,
      sleep: async (ms) => sleeps.push(ms),
      attempts: 5,
      delayMs: 7,
    });
    expect(r.violations).toEqual([]);
    expect(n).toBe(3);
    expect(sleeps).toEqual([7, 7]);
  });

  it("fails after the last attempt with that attempt's problems", async () => {
    const { fetch } = fakeStaging({ sha: OTHER_SHA });
    const r = await runSmoke({ targets, sha: SHA, fetch, sleep: noSleep, attempts: 2 });
    expect(r.violations).toHaveLength(7);
    expect(r.violations[0]).toMatch(
      /^edge \/health: version is b{40}, expected a{40} \(after 2 attempts\)$/,
    );
  });

  it('fails when only the production alias serves an old build (a preview deploy)', async () => {
    const { fetch } = fakeStaging({
      override: (u) =>
        u === `${ALIAS_URLS.candidate}/version.json`
          ? json({ app: 'candidate', version: OTHER_SHA }, securityHeaders('candidate'))
          : undefined,
    });
    const r = await runSmoke({ targets, sha: SHA, fetch, sleep: noSleep, attempts: 2 });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatch(
      /^candidate alias \/version\.json: version is b{40}, expected a{40} \(after 2 attempts\)$/,
    );
  });

  it('stops retrying at the overall deadline and reports the rest as not run', async () => {
    let t = 1_000;
    const { fetch, calls } = fakeStaging({ sha: OTHER_SHA });
    const r = await runSmoke({
      targets,
      sha: SHA,
      fetch,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      attempts: 1000,
      delayMs: 1_000,
      deadlineMs: 5_000,
    });
    expect(r.violations).toHaveLength(7);
    expect(r.violations[0]).toMatch(/^edge \/health: .*\(smoke deadline of 5 s exceeded\)$/);
    for (const v of r.violations.slice(1)) expect(v).toMatch(/not run: smoke deadline of 5 s/);
    expect(calls.length).toBeLessThan(10);
  });

  it('has a default overall deadline of six minutes', () => {
    expect(DEFAULTS.deadlineMs).toBe(360_000);
  });

  // Dispatch 8 (run 39559543112): the recruiter's fresh per-deployment host did not resolve within 12 attempts
  // (`request failed (TypeError)`) while its production alias was already fine. A new <deployment>.<project>.pages.dev
  // name can take minutes to appear, so the per-deployment checks get their own, larger budget within the deadline.
  it('gives a per-deployment app URL four minutes of retries by default (a new pages.dev host resolves late)', () => {
    expect(DEFAULTS.deploymentAttempts).toBe(48);
    expect(DEFAULTS.deploymentAttempts * DEFAULTS.delayMs).toBe(240_000);
    expect(DEFAULTS.deploymentAttempts * DEFAULTS.delayMs).toBeLessThan(DEFAULTS.deadlineMs);
  });

  it('keeps retrying the recruiter deployment URL past the Worker budget until it resolves', async () => {
    let t = 0;
    let failures = 0;
    const { fetch } = fakeStaging({
      override: (u) => {
        if (!u.startsWith(APP_URLS.recruiter) || failures >= 40) return undefined;
        failures++;
        throw new TypeError('fetch failed');
      },
    });
    const r = await runSmoke({
      targets,
      sha: SHA,
      fetch,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    expect(r.violations).toEqual([]);
    expect(failures).toBe(40);
    expect(r.report).toContain('recruiter /version.json and headers: ok');
  });

  it('a per-deployment URL that never resolves fails after its own attempts', async () => {
    const { fetch } = fakeStaging({
      override: (u) => {
        if (u.startsWith(APP_URLS.recruiter)) throw new TypeError('fetch failed');
        return undefined;
      },
    });
    const r = await runSmoke({
      targets,
      sha: SHA,
      fetch,
      sleep: noSleep,
      attempts: 2,
      deploymentAttempts: 3,
    });
    expect(r.violations).toEqual([
      expect.stringMatching(
        /^recruiter \/version\.json: request failed \(TypeError\).*\(after 3 attempts\)$/,
      ),
    ]);
  });
});

describe('main', () => {
  const capture = () => {
    const lines = { out: [], err: [] };
    return { lines, out: (s) => lines.out.push(s), err: (s) => lines.err.push(s) };
  };
  const readFile = (p) => {
    if (p !== '/runner/tmp/wrangler-output.ndjson') throw new Error('ENOENT');
    return OUTPUT;
  };

  it('reads the wrangler output file and passes on a healthy staging', async () => {
    const c = capture();
    const { fetch } = fakeStaging();
    const code = await main({
      argv: ['--wrangler-output', '/runner/tmp/wrangler-output.ndjson', '--sha', SHA],
      readFile,
      fetch,
      sleep: noSleep,
      out: c.out,
      err: c.err,
    });
    expect(c.lines.err).toEqual([]);
    expect(code).toBe(0);
    expect(c.lines.out.at(-1)).toBe(`smoke-staging: OK (7 endpoints at ${SHA})`);
  });

  it('exits 1 on a bad or missing --sha, a missing file or unknown arguments, before any request', async () => {
    const bad = [
      ['--wrangler-output', '/runner/tmp/wrangler-output.ndjson', '--sha', 'abc1234'],
      ['--wrangler-output', '/runner/tmp/wrangler-output.ndjson', '--sha', 'A'.repeat(40)],
      ['--wrangler-output', '/runner/tmp/wrangler-output.ndjson'],
      ['--wrangler-output', '/elsewhere.ndjson', '--sha', SHA],
      ['--sha', SHA],
      ['--wrangler-output', '/runner/tmp/wrangler-output.ndjson', '--sha', SHA, '--follow'],
    ];
    for (const argv of bad) {
      const c = capture();
      const { fetch, calls } = fakeStaging();
      expect(
        await main({ argv, readFile, fetch, sleep: noSleep, out: c.out, err: c.err }),
        argv.join(' '),
      ).toBe(1);
      expect(calls).toHaveLength(0);
      expect(c.lines.err.length).toBeGreaterThan(0);
    }
  });

  it('exits 1 and names the endpoint when staging serves another SHA', async () => {
    const c = capture();
    const { fetch } = fakeStaging({ sha: OTHER_SHA });
    const code = await main({
      argv: ['--wrangler-output', '/runner/tmp/wrangler-output.ndjson', '--sha', SHA],
      readFile,
      fetch,
      sleep: noSleep,
      out: c.out,
      err: c.err,
    });
    expect(code).toBe(1);
    expect(c.lines.err.join('\n')).toMatch(
      /smoke-staging: candidate \/version\.json: version is b{40}/,
    );
  });
});
