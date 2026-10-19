// DC-D9 (specs/d1-demo-slice.md §7.1, §8): scripts/e2e-local.mjs starts the local stack, runs
// Playwright and always tears down. Every process, the network, Docker, the database, the operator
// scripts and the clock are fakes; nothing starts a real server. Synthetic data only; the
// secret-shaped values are made at run time, so nothing credential-shaped is committed.
// Spec review r3a #1: the run also sets local-only login-role passwords, generates the
// candidate-token keys and the media-link key, hands them to the Workers through files in the
// temporary state folder, and creates the synthetic users and org the real-flow spec signs in with.
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCheck } from '../check-no-demo-outbox.mjs';
import {
  BUILD_ARGS,
  E2E_ENV,
  LIMIT_MS,
  LOG_DIR,
  MANIFEST,
  READY_TIMEOUT_MS,
  USERS,
  WRANGLER_CHILD_ENV,
  buildEnv,
  configPaths,
  main,
  readStack,
  stackProcesses,
} from '../e2e-local.mjs';
import { LOGIN_ROLES, dropLoginRolesSql } from '../lib/e2e-local-secrets.mjs';
import { cleanupTempDirs, makeTempDir, writeFiles } from './fixtures/checks/temp-repo.mjs';

afterEach(cleanupTempDirs);

const ok = { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: null };
const STATE = '/tmp/trace-e2e-state';
const CONFIG = configPaths(STATE);
const hex = (n) => randomBytes(n).toString('hex');
/** What `supabase status -o env` prints on the local stack; secret-shaped values are made here. */
const fakeStack = () => {
  const db = new URL(`${['postgres', 'ql'].join('')}://127.0.0.1:54322/postgres`);
  db.username = 'postgres';
  db.password = hex(4);
  return {
    API_URL: 'http://127.0.0.1:54321',
    DB_URL: db.toString(),
    PUBLISHABLE_KEY: `sb_publishable_${hex(8)}`,
  };
};
const JOBS_CONFIG = '{\n  "name": "trace-jobs",\n  "main": "src/index.ts",\n}\n';
/** Parses one env file written by the run (NAME='value' lines). */
const envFile = (text) =>
  Object.fromEntries(
    text
      .trim()
      .split('\n')
      .map((line) => {
        const m = /^([A-Z][A-Z0-9_]*)='(.*)'$/.exec(line);
        if (!m) throw new Error('not an env-file line');
        return [m[1], m[2]];
      }),
  );

/** A fake stack. `ready(url)` says whether a URL answers 200; `exitEarly[name]` makes a process die. */
function harness({
  argv = ['--ci'],
  answer = () => ok,
  ready = () => true,
  outputs = {},
  exitEarly = {},
  playwright = 0,
  occupied = [],
  onPlaywright = () => {},
  stack = fakeStack(),
  sqlAnswer = () => ({ ok: true, out: '' }),
  operatorCode = () => 0,
} = {}) {
  const root = makeTempDir('trace-e2e-root-');
  writeFiles(root, {
    'supabase/config.toml': 'project_id = "trace-e2e-test"\n',
    'workers/jobs/wrangler.jsonc': JOBS_CONFIG,
  });
  const h = {
    clock: 0,
    calls: [],
    runOpts: [],
    events: [],
    sql: [],
    operators: [],
    secrets: {},
    started: [],
    stopped: [],
    written: {},
    removed: [],
    killed: [],
    lines: [],
    pw: null,
    exitAt: null,
    root,
  };
  h.deps = {
    argv,
    root,
    lockDir: makeTempDir('trace-e2e-lock-'),
    tmpDir: makeTempDir('trace-e2e-tmp-'),
    run: async (cmd, args, opts) => {
      h.calls.push([cmd, ...args].join(' '));
      h.runOpts.push(opts);
      h.events.push(args.includes('build') ? 'build' : `run ${cmd}`);
      return answer(cmd, args, h);
    },
    stackEnv: () => stack,
    runSql: ({ url, sql, vars }) => {
      h.sql.push({ url, sql, vars });
      h.events.push(sql.includes('create role') ? 'sql create' : 'sql drop');
      return sqlAnswer(sql);
    },
    operators: Object.fromEntries(
      ['enrolSmokeUser', 'createOrg', 'addMember'].map((name) => [
        name,
        async ({ argv: args, deps }) => {
          h.operators.push({ name, argv: args, password: deps.env.SMOKE_PASSWORD });
          h.events.push(`operator ${name}`);
          const code = operatorCode(name, args);
          if (code === 0) deps.stdout.write(`${randomUUID()}\n`);
          else deps.stderr.write(`${name}: the database call failed (SQLSTATE 42501)\n`);
          return code;
        },
      ]),
    ),
    opsDeps: { env: { PATH: 'x' } },
    readText: (file) => {
      h.events.push(`read ${path.relative(root, file).split(path.sep).join('/')}`);
      return JOBS_CONFIG;
    },
    writeSecret: (file, text) => {
      h.secrets[file.split(path.sep).join('/')] = text;
      h.events.push(`secret ${path.basename(file)}`);
    },
    now: () => h.clock,
    sleep: async (ms) => {
      h.clock += ms;
    },
    isPidAlive: () => false,
    pid: 4242,
    proc: new EventEmitter(),
    // The lock's signal handler calls exit(); record what was already cleaned up at that moment.
    exit: (code) => {
      h.exitAt = { code, killed: [...h.killed], removed: [...h.removed] };
    },
    log: (m) => h.lines.push(m),
    warn: (m) => h.lines.push(m),
    error: (m) => h.lines.push(m),
    start: (spec) => {
      h.started.push(spec);
      h.events.push(`start ${spec.name}`);
      const code = exitEarly[spec.name] ?? null;
      return {
        name: spec.name,
        output: () => outputs[spec.name] ?? `${spec.names.join('\n')}\nReady`,
        exitCode: () => code,
        exited: Promise.resolve(code),
        stop: async () => {
          h.stopped.push(spec.name);
          h.events.push(`stop ${spec.name}`);
        },
        killNow: () => {
          h.killed.push(spec.name);
        },
      };
    },
    // A URL answers once its process has started (or when something else already holds the port).
    fetch: async (url) => ({
      status:
        occupied.includes(url) || (ready(url) && h.started.some((s) => s.ready === url))
          ? 200
          : 503,
    }),
    runInherit: async (cmd, args, opts) => {
      h.calls.push(`playwright ${args.slice(1).join(' ')}`);
      h.events.push('playwright');
      h.pw = { cmd, args, opts };
      onPlaywright(h);
      return playwright;
    },
    makeStateDir: () => STATE,
    removeDir: (dir) => {
      h.removed.push(dir);
      h.events.push('remove state');
    },
    writeFile: (file, text) => {
      h.written[path.relative(root, file).split(path.sep).join('/')] = text;
    },
    env: { GITHUB_SHA: 'a'.repeat(40) },
  };
  return h;
}

const manifestOf = (h) => JSON.parse(h.written[MANIFEST]);
const secretOf = (h, file) => h.secrets[file];

describe('stackProcesses', () => {
  it('runs api alone, then edge with jobs, under wrangler dev --env dev with one shared state folder', () => {
    const [api, edge, candidate, recruiter] = stackProcesses(STATE, CONFIG);
    const wrangler = 'node_modules/wrangler/bin/wrangler.js';
    expect(api).toMatchObject({
      name: 'api',
      cwd: '.',
      script: wrangler,
      // A one-config session prints "Your Worker has access to…", not its name (seen on wrangler
      // 4.149), so only the multi-config session is checked by name; api's /health names it.
      names: [],
    });
    expect(api.args).toEqual([
      'dev',
      '-c',
      'services/api/wrangler.jsonc',
      '--env',
      'dev',
      '--ip',
      '127.0.0.1',
      '--persist-to',
      STATE,
      '--port',
      '8788',
      '--inspector-port',
      '9231',
      // The api's local-only values: a file in the state folder, not .dev.vars in the repository.
      '--env-file',
      CONFIG.apiEnvFile,
    ]);
    // edge first, so the edge is the session's HTTP Worker; jobs consumes the mirror Queue in-process.
    // wrangler 4 gives --env-file to the first Worker only, so jobs runs from a copy of its config in
    // the state folder, whose .dev.vars holds the jobs logins.
    expect(edge.args).toEqual([
      'dev',
      '-c',
      'workers/edge/wrangler.jsonc',
      '-c',
      CONFIG.jobsConfig,
      '--env',
      'dev',
      '--ip',
      '127.0.0.1',
      '--persist-to',
      STATE,
      '--port',
      '8787',
      '--inspector-port',
      '9230',
      '--env-file',
      CONFIG.edgeEnvFile,
    ]);
    expect(edge.names).toEqual(['trace-edge-dev', 'trace-jobs-dev']);
    expect(candidate).toMatchObject({
      cwd: 'apps/candidate',
      script: 'apps/candidate/node_modules/vite/bin/vite.js',
      args: ['preview'],
      ready: 'http://localhost:5173/version.json',
    });
    expect(recruiter).toMatchObject({
      cwd: 'apps/recruiter',
      args: ['preview'],
      ready: 'http://localhost:5174/version.json',
    });
    expect(api.ready).toBe('http://127.0.0.1:8788/health');
    expect(edge.ready).toBe('http://127.0.0.1:8787/health');
  });

  it('keeps every generated file inside the state folder', () => {
    for (const file of Object.values(CONFIG))
      expect(file.startsWith(`${STATE}/config/`)).toBe(true);
    expect(CONFIG.jobsDevVars).toBe(`${path.posix.dirname(CONFIG.jobsConfig)}/.dev.vars`);
  });

  it('gives Playwright only local origins (no secret, no staging host)', () => {
    expect(E2E_ENV).toEqual({
      E2E_LOCAL: '1',
      E2E_CANDIDATE_URL: 'http://localhost:5173',
      E2E_RECRUITER_URL: 'http://localhost:5174',
      E2E_EDGE_URL: 'http://127.0.0.1:8787',
      E2E_API_URL: 'http://127.0.0.1:8788',
    });
  });

  it('starts wrangler with .env loading on and process.env kept out of the bindings', () => {
    // CLOUDFLARE_INCLUDE_PROCESS_ENV would turn every variable of the parent into a binding of the
    // edge; CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false would make wrangler ignore --env-file.
    expect(WRANGLER_CHILD_ENV).toEqual({
      WRANGLER_SEND_METRICS: 'false',
      DO_NOT_TRACK: '1',
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'true',
    });
  });
});

describe('readStack and buildEnv', () => {
  it('reads the local API URL, publishable key and database URL', () => {
    const s = fakeStack();
    expect(readStack(s)).toEqual({
      ok: true,
      stack: { apiUrl: s.API_URL, publishableKey: s.PUBLISHABLE_KEY, dbUrl: s.DB_URL },
    });
    const anon = { ...s, PUBLISHABLE_KEY: '', ANON_KEY: `anon_${hex(4)}` };
    expect(readStack(anon).stack.publishableKey).toBe(anon.ANON_KEY);
  });

  it('refuses a stack that is not running, not on 127.0.0.1 or missing a value', () => {
    expect(readStack(null).ok).toBe(false);
    expect(readStack({ ...fakeStack(), API_URL: 'https://x.supabase.co' }).ok).toBe(false);
    expect(readStack({ ...fakeStack(), PUBLISHABLE_KEY: '' }).ok).toBe(false);
    expect(readStack({ ...fakeStack(), DB_URL: '' }).ok).toBe(false);
  });

  it('builds with the demo outbox on, a non-production flavour and the local edge origin only', () => {
    expect(buildEnv()).toEqual({
      // spec rev 4f: the recruiter registers the outbox route only for VITE_DEMO_OUTBOX=1 and a
      // VITE_TRACE_ENV other than production (set explicitly, so a parent value cannot win).
      VITE_DEMO_OUTBOX: '1',
      VITE_TRACE_ENV: 'dev',
      // The candidate app reads the edge origin; it has no headers plugin.
      VITE_EDGE_ORIGIN: 'http://127.0.0.1:8787',
    });
  });

  it('gives the build no local api or Supabase origin (the recruiter headers plugin refuses them)', () => {
    // Lead, first real run of 2a257c7: packages/config/vite/headers-template.js accepts only the
    // staging forms of VITE_SUPABASE_URL and VITE_API_ORIGIN at build time, so neither is passed.
    const env = buildEnv();
    for (const name of ['VITE_API_ORIGIN', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) {
      expect(env).not.toHaveProperty(name);
    }
  });
});

describe('main', () => {
  it('rejects unknown arguments', async () => {
    const h = harness({ argv: ['--yes'] });
    expect(await main(h.deps)).toBe(2);
    expect(h.calls).toEqual([]);
  });

  it('starts Supabase, resets, builds, prepares, starts the stack, runs Playwright, then stops everything', async () => {
    const h = harness();
    expect(await main(h.deps)).toBe(0);
    expect(h.calls[0]).toBe('docker info');
    expect(h.calls[1]).toMatch(/^pnpm exec supabase start -x /);
    expect(h.calls[2]).toBe('pnpm exec supabase db reset --local');
    expect(h.calls[3]).toBe(`pnpm ${BUILD_ARGS.join(' ')}`);
    expect(h.started.map((s) => s.name)).toEqual(['api', 'edge+jobs', 'candidate', 'recruiter']);
    expect(h.calls[4]).toMatch(/^playwright test$/);
    expect(h.pw.opts.cwd).toBe(path.join(h.root, 'e2e'));
    expect(h.stopped.sort()).toEqual(['api', 'candidate', 'edge+jobs', 'recruiter']);
    expect(h.removed).toEqual([STATE]);
    // No supabase stop without --stop.
    expect(h.calls.some((c) => /supabase stop/.test(c))).toBe(false);
  });

  it('runs the logins, keys and users after the reset and before any Worker, and cleans up after the stop', async () => {
    const h = harness();
    expect(await main(h.deps)).toBe(0);
    const e = h.events;
    const at = (name) => e.indexOf(name);
    expect(at('build')).toBeLessThan(at('sql create'));
    expect(at('sql create')).toBeLessThan(at('secret api.env'));
    expect(at('secret .dev.vars')).toBeLessThan(at('operator enrolSmokeUser'));
    expect(e.filter((x) => x.startsWith('operator ')).at(-1)).toBe('operator addMember');
    expect(e.lastIndexOf('operator addMember')).toBeLessThan(at('start api'));
    // Teardown: every process stops, then the login roles go, then the state folder (and its files).
    expect(e.lastIndexOf('stop recruiter')).toBeLessThan(at('sql drop'));
    expect(at('sql drop')).toBeLessThan(at('remove state'));
    expect(h.sql.at(-1).sql).toBe(dropLoginRolesSql());
    expect(h.sql.every((q) => q.url === h.deps.stackEnv().DB_URL)).toBe(true);
  });

  it('builds both apps with exactly the demo-outbox env, on that one call only', async () => {
    const h = harness();
    const before = process.env.VITE_DEMO_OUTBOX;
    expect(await main(h.deps)).toBe(0);
    const i = h.calls.indexOf(`pnpm ${BUILD_ARGS.join(' ')}`);
    expect(h.runOpts[i]).toEqual({
      cwd: h.root,
      env: {
        VITE_DEMO_OUTBOX: '1',
        VITE_TRACE_ENV: 'dev',
        VITE_EDGE_ORIGIN: 'http://127.0.0.1:8787',
      },
    });
    // The Supabase steps run without it; this process's own environment is not changed.
    h.runOpts.forEach((opts, k) => {
      if (k !== i) expect(opts?.env).toBeUndefined();
    });
    expect(process.env.VITE_DEMO_OUTBOX).toBe(before);
  });

  it("leaves the root build's check-no-demo-outbox as it is (a different command and environment)", async () => {
    const h = harness();
    await main(h.deps);
    // The run builds only the two apps, through --filter, never the root `build` script whose last
    // steps include check-no-demo-outbox.
    expect(BUILD_ARGS).toEqual([
      '--filter',
      '@trace/candidate',
      '--filter',
      '@trace/recruiter',
      'build',
    ]);
    expect(h.calls.filter((c) => /^pnpm (-r )?(run )?build\b/.test(c))).toEqual([]);
    // The check still fails a demo build when its own environment does not say VITE_DEMO_OUTBOX=1,
    // as in `pnpm build` after an e2e-local run left a demo dist behind.
    const repo = makeTempDir('trace-e2e-dist-');
    writeFiles(repo, { 'apps/recruiter/dist/assets/app.js': 'route("/demo-outbox")' });
    expect(runCheck({ root: repo, env: {} })).toMatchObject({ ok: false, skipped: false });
  });

  it('recreates the four login roles with fresh hex passwords as postgres on the local stack', async () => {
    const h = harness();
    await main(h.deps);
    const create = h.sql[0];
    expect(create.vars).toEqual({});
    for (const { login, role } of LOGIN_ROLES) {
      expect(create.sql).toMatch(
        new RegExp(`create role ${login} login noinherit password '[0-9a-f]{48}';`),
      );
      expect(create.sql).toContain(`grant ${role} to ${login} with inherit false, set true;`);
    }
    const again = harness();
    await main(again.deps);
    expect(again.sql[0].sql).not.toBe(create.sql);
  });

  it('hands each Worker its values through files in the state folder (api, edge, jobs)', async () => {
    const h = harness();
    await main(h.deps);
    expect(Object.keys(h.secrets).sort()).toEqual(
      [CONFIG.apiEnvFile, CONFIG.edgeEnvFile, CONFIG.jobsConfig, CONFIG.jobsDevVars].sort(),
    );
    const api = envFile(secretOf(h, CONFIG.apiEnvFile));
    const edge = envFile(secretOf(h, CONFIG.edgeEnvFile));
    const jobs = envFile(secretOf(h, CONFIG.jobsDevVars));
    expect(Object.keys(api).sort()).toEqual([
      'API_DB_URL',
      'CANDIDATE_TOKEN_KID',
      'CANDIDATE_TOKEN_PRIVATE_JWK',
      'CANDIDATE_TOKEN_PUBLIC_JWK',
      'MEDIA_LINK_HMAC_KEY',
      'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_URL',
    ]);
    expect(api.CANDIDATE_TOKEN_KID).toMatch(/^d1-\d{4}-\d{2}$/);
    expect(api.SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(new URL(api.API_DB_URL).username).toBe('api_login');
    // The edge gets the public list only, the same one the api verifies with.
    expect(edge).toEqual({ CANDIDATE_TOKEN_PUBLIC_JWK: api.CANDIDATE_TOKEN_PUBLIC_JWK });
    expect(JSON.parse(edge.CANDIDATE_TOKEN_PUBLIC_JWK)[0]).not.toHaveProperty('d');
    expect(Object.keys(jobs).sort()).toEqual([
      'JOBS_INTEGRITY_DB_URL',
      'JOBS_MIRROR_DB_URL',
      'JOBS_QUALITY_DB_URL',
    ]);
    // Each login's password is the one the SQL set.
    for (const [file, name, login] of [
      [api, 'API_DB_URL', 'api_login'],
      [jobs, 'JOBS_MIRROR_DB_URL', 'jobs_mirror_login'],
      [jobs, 'JOBS_QUALITY_DB_URL', 'jobs_quality_login'],
      [jobs, 'JOBS_INTEGRITY_DB_URL', 'jobs_integrity_login'],
    ]) {
      const u = new URL(file[name]);
      expect(u.username).toBe(login);
      expect(h.sql[0].sql).toContain(
        `create role ${login} login noinherit password '${u.password}';`,
      );
    }
    // The jobs copy of the config points at the real entry file.
    const main_ = path.join(h.root, 'workers', 'jobs', 'src', 'index.ts').split(path.sep).join('/');
    expect(secretOf(h, CONFIG.jobsConfig)).toContain(`"main": ${JSON.stringify(main_)}`);
    expect(h.events).toContain('read workers/jobs/wrangler.jsonc');
  });

  it('creates the synthetic users, the org and the members through the operator scripts', async () => {
    const h = harness();
    await main(h.deps);
    const enrol = h.operators.filter((o) => o.name === 'enrolSmokeUser');
    expect(enrol.map((o) => o.argv)).toEqual(
      USERS.map((u) => ['--env', 'local', '--email', u.email]),
    );
    // One generated password for every user, from SMOKE_PASSWORD only (never an argument).
    const pw = enrol[0].password;
    expect(pw).toMatch(/^E2e[0-9a-f]{24}9$/);
    expect(enrol.every((o) => o.password === pw)).toBe(true);
    expect(h.operators.flatMap((o) => o.argv).includes(pw)).toBe(false);
    for (const u of USERS) expect(u.email).toMatch(/^e2e-[a-z-]+@example\.test$/);
    expect(USERS.map((u) => u.key)).toEqual(['OWNER', 'RECRUITER', 'REVIEWER', 'STORE_RECRUITER']);
    const org = h.operators.find((o) => o.name === 'createOrg');
    expect(org.argv).toEqual(expect.arrayContaining(['--slug', 'e2e-local', '--kind', 'customer']));
    const members = h.operators.filter((o) => o.name === 'addMember');
    const rolesOf = (o) => o.argv[o.argv.indexOf('--roles') + 1];
    expect(members.map(rolesOf)).toEqual(['recruiter', 'reviewer', 'recruiter']);
  });

  it('gives Playwright the local origins, the user emails, the password and the org, and no Worker secret', async () => {
    const h = harness();
    await main(h.deps);
    const env = h.pw.opts.env;
    const stack = h.deps.stackEnv();
    expect(env).toMatchObject(E2E_ENV);
    expect(env).toMatchObject({
      E2E_SUPABASE_URL: stack.API_URL,
      E2E_SUPABASE_PUBLISHABLE_KEY: stack.PUBLISHABLE_KEY,
      E2E_DB_CONTAINER: 'supabase_db_trace',
      E2E_USER_PASSWORD: h.operators[0].password,
    });
    for (const u of USERS) expect(env[`E2E_${u.key}_EMAIL`]).toBe(u.email);
    expect(env.E2E_ORG_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(env).sort()).toEqual(
      [
        ...Object.keys(E2E_ENV),
        'E2E_SUPABASE_URL',
        'E2E_SUPABASE_PUBLISHABLE_KEY',
        'E2E_DB_CONTAINER',
        'E2E_ORG_ID',
        'E2E_USER_PASSWORD',
        ...USERS.map((u) => `E2E_${u.key}_EMAIL`),
      ].sort(),
    );
    // No login URL, private key or HMAC key reaches the browser-test process.
    const api = envFile(secretOf(h, CONFIG.apiEnvFile));
    const all = JSON.stringify(env);
    for (const name of ['API_DB_URL', 'CANDIDATE_TOKEN_PRIVATE_JWK', 'MEDIA_LINK_HMAC_KEY']) {
      expect(all).not.toContain(api[name]);
    }
  });

  it('prints no generated value', async () => {
    const h = harness();
    await main(h.deps);
    const printed = [...h.lines, ...Object.values(h.written)].join('\n');
    const api = envFile(secretOf(h, CONFIG.apiEnvFile));
    const jobs = envFile(secretOf(h, CONFIG.jobsDevVars));
    const values = [
      h.operators[0].password,
      api.MEDIA_LINK_HMAC_KEY,
      JSON.parse(api.CANDIDATE_TOKEN_PRIVATE_JWK).d,
      ...[api.API_DB_URL, ...Object.values(jobs)].map((u) => new URL(u).password),
    ];
    for (const v of values) expect(printed).not.toContain(v);
  });

  it('writes the DC-D9 manifest with the per-phase timings and the limit', async () => {
    const h = harness();
    await main(h.deps);
    const m = manifestOf(h);
    expect(m).toMatchObject({
      check: 'DC-D9',
      ci: true,
      sha: 'a'.repeat(40),
      limit_ms: LIMIT_MS,
      within_limit: true,
      playwright_exit: 0,
      result: 'pass',
    });
    expect(Object.keys(m.phases)).toEqual([
      'supabase_ms',
      'build_ms',
      'setup_ms',
      'stack_ms',
      'playwright_ms',
    ]);
  });

  it('writes each process log, redacted, under the test results', async () => {
    const h = harness({
      outputs: { api: `trace-api-dev\nkey: sb_secret_${hex(8)}\nReady` },
    });
    expect(await main(h.deps)).toBe(0);
    const log = h.written[`${LOG_DIR}/api.log`];
    expect(log).toContain('trace-api-dev');
    expect(log).not.toMatch(/sb_secret_[0-9a-f]{16}/);
    expect(Object.keys(h.written).filter((k) => k.startsWith(LOG_DIR))).toHaveLength(4);
  });

  it('runs supabase stop at the end with --stop', async () => {
    const h = harness({ argv: ['--stop'] });
    expect(await main(h.deps)).toBe(0);
    expect(h.calls.at(-1)).toBe('pnpm exec supabase stop');
    expect(manifestOf(h).ci).toBe(false);
  });

  it('fails without starting anything when Docker is not running', async () => {
    const h = harness({
      answer: (cmd) => (cmd === 'docker' ? { ...ok, status: 1 } : ok),
    });
    expect(await main(h.deps)).toBe(1);
    expect(h.started).toEqual([]);
    expect(h.lines.join('\n')).toMatch(/Docker is not running/);
    expect(manifestOf(h).result).toBe('fail');
  });

  it('builds nothing when the local stack status cannot be read', async () => {
    const h = harness({ stack: null });
    expect(await main(h.deps)).toBe(1);
    expect(h.events).not.toContain('build');
    expect(h.started).toEqual([]);
    expect(h.lines.join('\n')).toMatch(/supabase status/);
  });

  it('starts no process when the app build fails', async () => {
    const h = harness({
      answer: (cmd, args) =>
        args.includes('build') ? { ...ok, status: 1, stderr: Buffer.from('boom') } : ok,
    });
    expect(await main(h.deps)).toBe(1);
    expect(h.started).toEqual([]);
    expect(h.lines.join('\n')).toMatch(/the app build exited 1/);
  });

  it('starts no process and still removes the roles and the state folder when the login SQL fails', async () => {
    const h = harness({
      sqlAnswer: (sql) =>
        sql.includes('create role')
          ? { ok: false, why: 'the database call failed', sqlstate: '42501' }
          : { ok: true, out: '' },
    });
    expect(await main(h.deps)).toBe(1);
    expect(h.started).toEqual([]);
    expect(h.operators).toEqual([]);
    expect(h.lines.join('\n')).toMatch(/login roles .*SQLSTATE 42501/);
    expect(h.sql.at(-1).sql).toBe(dropLoginRolesSql());
    expect(h.removed).toEqual([STATE]);
  });

  it('starts no process when an operator script fails, and names the step', async () => {
    const h = harness({ operatorCode: (name) => (name === 'createOrg' ? 1 : 0) });
    expect(await main(h.deps)).toBe(1);
    expect(h.started).toEqual([]);
    expect(h.lines.join('\n')).toMatch(
      /create-org failed \(exit 1; create[Oo]rg: the database call failed/,
    );
    expect(h.sql.at(-1).sql).toBe(dropLoginRolesSql());
  });

  it('warns but does not fail a green run when the roles cannot be dropped afterwards', async () => {
    const h = harness({
      sqlAnswer: (sql) =>
        sql.includes('create role') ? { ok: true, out: '' } : { ok: false, sqlstate: '2BP01' },
    });
    expect(await main(h.deps)).toBe(0);
    expect(h.lines.join('\n')).toMatch(/warning: .*login roles.*2BP01/);
  });

  it('fails, names the process and still stops everything when one never answers', async () => {
    const h = harness({ ready: (url) => !url.includes(':8787') });
    expect(await main(h.deps)).toBe(1);
    const text = h.lines.join('\n');
    expect(text).toMatch(
      new RegExp(`edge\\+jobs did not answer 200 .*${READY_TIMEOUT_MS / 1000} s`),
    );
    expect(h.calls.some((c) => c.startsWith('playwright'))).toBe(false);
    expect(h.stopped).toHaveLength(4);
    expect(h.removed).toEqual([STATE]);
  });

  it('fails when a process exits before it is ready', async () => {
    const h = harness({ exitEarly: { recruiter: 1 }, ready: (url) => !url.includes(':5174') });
    expect(await main(h.deps)).toBe(1);
    expect(h.lines.join('\n')).toMatch(/recruiter exited \(1\) before/);
    expect(h.stopped).toHaveLength(4);
  });

  it('fails when a wrangler session does not report one of its Workers', async () => {
    const h = harness({ outputs: { 'edge+jobs': 'trace-edge-dev\nReady' } });
    expect(await main(h.deps)).toBe(1);
    expect(h.lines.join('\n')).toMatch(/edge\+jobs did not report starting trace-jobs-dev/);
  });

  it('fails when Playwright fails, and still tears down', async () => {
    const h = harness({ playwright: 1 });
    expect(await main(h.deps)).toBe(1);
    expect(h.lines.join('\n')).toMatch(/Playwright exited 1/);
    expect(h.stopped).toHaveLength(4);
    expect(h.sql.at(-1).sql).toBe(dropLoginRolesSql());
    expect(manifestOf(h)).toMatchObject({ playwright_exit: 1, result: 'fail' });
  });

  // Security review 2026-10-17 L2: an orphaned stack from an interrupted run must not be tested.
  it('refuses to start when a port already answers (an earlier stack is still running)', async () => {
    const h = harness({ occupied: ['http://127.0.0.1:8787/health'] });
    expect(await main(h.deps)).toBe(1);
    expect(h.started).toEqual([]);
    expect(h.lines.join('\n')).toMatch(
      /http:\/\/127\.0\.0\.1:8787\/health already answers before edge\+jobs started/,
    );
  });

  it('on a signal, kills every process tree and removes the state folder before the lock handler exits', async () => {
    const h = harness({ onPlaywright: (state) => state.deps.proc.emit('SIGINT') });
    await main(h.deps);
    expect(h.exitAt.code).toBe(130);
    expect(h.exitAt.killed.sort()).toEqual(['api', 'candidate', 'edge+jobs', 'recruiter']);
    expect(h.exitAt.removed).toEqual([STATE]);
  });

  it('leaves no signal handler behind', async () => {
    const h = harness();
    await main(h.deps);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK', 'exit']) {
      expect(h.deps.proc.listenerCount(signal), signal).toBe(0);
    }
  });

  it('fails when the whole run is over the 25-minute CI job limit', async () => {
    const h = harness({
      answer: (cmd, args, state) => {
        if (args.includes('build')) state.clock += LIMIT_MS + 1;
        return ok;
      },
    });
    expect(await main(h.deps)).toBe(1);
    expect(h.lines.join('\n')).toMatch(/over the 25-minute CI job limit/);
    expect(manifestOf(h).within_limit).toBe(false);
  });
});
