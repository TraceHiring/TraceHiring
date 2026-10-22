#!/usr/bin/env node
// The local E2E stack (specs/d1-demo-slice.md §7.1, §7.2; day-one checks DC-D9 and the Linux half
// of DC-D6, §8). Lead-only: it starts and resets the shared local Supabase stack.
//   node scripts/e2e-local.mjs [--ci] [--stop]
// 1. Docker check, the test-rls lock, `supabase start -x …` and `supabase db reset` (withLocalStack).
// 2. Reads the local stack's URLs and publishable key (`supabase status`) and builds both apps
//    (`pnpm --filter @trace/candidate --filter @trace/recruiter build`) with the demo outbox on
//    (VITE_DEMO_OUTBOX=1, VITE_TRACE_ENV=dev; spec rev 4f) and the local edge origin for the
//    candidate app (VITE_EDGE_ORIGIN). For the recruiter app it also passes the stack's API URL
//    (VITE_SUPABASE_URL), its publishable key (VITE_SUPABASE_PUBLISHABLE_KEY) and the local api
//    Worker origin (VITE_API_ORIGIN, port 8788); the recruiter's headers plugin accepts those
//    loopback origins because VITE_TRACE_ENV is exactly dev (spec rev 4i). Only that call carries
//    these; the root `pnpm build` (check-no-demo-outbox) is not run.
// 2b. Local-only values for the real flow (spec review r3a #1), generated now, never in git, never
//    printed: random passwords for the operator logins api_login and jobs_{mirror,quality,
//    integrity}_login (recreated as postgres, one `inherit false, set true` grant each), a fresh
//    ES256 candidate-token pair (kid d1-YYYY-MM) and a media-link HMAC key. They reach the Workers
//    through files in the temporary state folder: `--env-file` for api and for edge (the public
//    key list only), and `.dev.vars` beside a copy of the jobs config there, because wrangler 4
//    hands --env-file only to a session's first Worker. Then the synthetic users
//    (e2e-*@example.test, one generated password), the org and its members through the operator
//    scripts; Playwright gets the emails, the password and the org id in its env only.
// 3. Starts two `wrangler dev` sessions with one shared --persist-to folder (R2, Queue, DO state):
//    services/api alone on 8788, and workers/edge with workers/jobs on 8787. One multi-config
//    session serves only its first Worker on the port, so it cannot give both the candidate app
//    (edge) and the recruiter app (api) an HTTP origin; edge and jobs share a session because the
//    mirror Queue's producer and consumer must, and edge reaches api's CandidateRpc through the
//    local dev registry (lead, 2026-10-17; spec §8 DC-D9). Then `vite preview` for the candidate
//    app (5173) and the recruiter app (5174), the ports the Workers' dev origins name.
// 4. Waits for each /health or /version.json, checks that each session started its Workers, and
//    runs Playwright (`e2e/`, E2E_LOCAL=1) against the stack.
// 5. Always stops every process it started, drops the four login roles and removes the state
//    folder (with the generated files); writes the per-phase
//    timings to e2e/test-results/dc-d9.json and the redacted process logs next to it. Fails when a
//    step fails or the whole run takes longer than the 25-minute CI job limit.
// Every value is local and synthetic; nothing reads a repository secret. Child output is redacted
// before it is printed or written (it can hold the local stack's keys or a connection URL).
// --ci marks the run as the CI job's in the manifest; --stop runs `supabase stop` at the end.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/cli.mjs';
import {
  LOGIN_ROLES,
  candidateTokenKeys,
  dotenvText,
  dropLoginRolesSql,
  jobsDevConfig,
  kidFor,
  loginRolesSql,
  workerSecrets,
} from './lib/e2e-local-secrets.mjs';
import { main as addMember } from './ops/add-member.mjs';
import { main as createOrg } from './ops/create-org.mjs';
import { main as enrolSmokeUser } from './ops/enrol-smoke-user.mjs';
import {
  DB_URL_ENV,
  LOCAL_DB_CONTAINER,
  isUuid,
  localStackEnv,
  realDeps,
  runSql,
} from './ops/lib.mjs';
import { defaultDeps as stackDefaults, redact, withLocalStack } from './test-rls.mjs';

export const LIMIT_MS = 25 * 60 * 1000;
export const READY_TIMEOUT_MS = 3 * 60 * 1000;
export const POLL_MS = 500;
export const STOP_GRACE_MS = 10 * 1000;
export const MANIFEST = 'e2e/test-results/dc-d9.json';
export const LOG_DIR = 'e2e/test-results/stack-logs';
export const BUILD_ARGS = Object.freeze([
  '--filter',
  '@trace/candidate',
  '--filter',
  '@trace/recruiter',
  'build',
]);
export const PLAYWRIGHT_CLI = 'e2e/node_modules/@playwright/test/cli.js';
/** What the Playwright specs read (e2e/tests/*.spec.ts); all local origins. */
export const E2E_ENV = Object.freeze({
  E2E_LOCAL: '1',
  E2E_CANDIDATE_URL: 'http://localhost:5173',
  E2E_RECRUITER_URL: 'http://localhost:5174',
  E2E_EDGE_URL: 'http://127.0.0.1:8787',
  E2E_API_URL: 'http://127.0.0.1:8788',
});
/**
 * The synthetic users of the local stack (`key` names their E2E_<key>_EMAIL variable). The owner
 * owns the org; the others are members. STORE_RECRUITER is the real-flow spec's own recruiter
 * (e2e/tests/candidate-store.spec.ts enrols its TOTP), so the slice spec's recruiter stays new;
 * UI_RECRUITER is e2e/tests/candidate-ui.spec.ts's own, because GoTrue refuses a second TOTP
 * enrolment below aal2 (422).
 */
export const USERS = Object.freeze(
  [
    { key: 'OWNER', email: 'e2e-owner@example.test', roles: null, name: 'E2E owner' },
    {
      key: 'RECRUITER',
      email: 'e2e-recruiter@example.test',
      roles: 'recruiter',
      name: 'E2E recruiter',
    },
    {
      key: 'REVIEWER',
      email: 'e2e-reviewer@example.test',
      roles: 'reviewer',
      name: 'E2E reviewer',
    },
    {
      key: 'STORE_RECRUITER',
      email: 'e2e-store-recruiter@example.test',
      roles: 'recruiter',
      name: 'E2E store recruiter',
    },
    {
      key: 'UI_RECRUITER',
      email: 'e2e-ui-recruiter@example.test',
      roles: 'recruiter',
      name: 'E2E UI recruiter',
    },
  ].map((u) => Object.freeze(u)),
);
/**
 * Every wrangler and vite child gets these over the parent environment: no telemetry; .env loading
 * on (else --env-file is ignored); process.env never copied into the bindings (it would give the
 * edge every variable of this process).
 */
export const WRANGLER_CHILD_ENV = Object.freeze({
  WRANGLER_SEND_METRICS: 'false',
  DO_NOT_TRACK: '1',
  CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'true',
});
const WRANGLER = 'node_modules/wrangler/bin/wrangler.js';
const VITE = (app) => `apps/${app}/node_modules/vite/bin/vite.js`;
const USAGE = 'usage: node scripts/e2e-local.mjs [--ci] [--stop]';
const TAIL_LINES = 20;
const TOOL = 'e2e-local';

const toPosix = (p) => String(p).split(path.sep).join('/');

/** The generated files of one run, all under `<state folder>/config/` (removed with it). */
export function configPaths(stateDir) {
  const base = `${toPosix(stateDir)}/config`;
  return {
    apiEnvFile: `${base}/api.env`,
    edgeEnvFile: `${base}/edge.env`,
    jobsConfig: `${base}/jobs/wrangler.jsonc`,
    jobsDevVars: `${base}/jobs/.dev.vars`,
  };
}

/**
 * The long-running processes, in start order. `script` is repo-relative and runs under the current
 * node (no shell, so stopping the process stops what it started). `names` are the Worker names a
 * wrangler session must report starting. `config` is configPaths() of the run.
 */
export function stackProcesses(persistDir, config) {
  const common = ['--env', 'dev', '--ip', '127.0.0.1', '--persist-to', persistDir];
  return [
    {
      name: 'api',
      cwd: '.',
      script: WRANGLER,
      args: ['dev', '-c', 'services/api/wrangler.jsonc', ...common].concat([
        '--port',
        '8788',
        '--inspector-port',
        '9231',
        '--env-file',
        config.apiEnvFile,
      ]),
      ready: `${E2E_ENV.E2E_API_URL}/health`,
      // A one-config session prints "Your Worker has access to…", not the name (wrangler 4.149).
      names: [],
    },
    {
      name: 'edge+jobs',
      cwd: '.',
      script: WRANGLER,
      args: ['dev', '-c', 'workers/edge/wrangler.jsonc', '-c', config.jobsConfig]
        .concat(common)
        .concat(['--port', '8787', '--inspector-port', '9230', '--env-file', config.edgeEnvFile]),
      ready: `${E2E_ENV.E2E_EDGE_URL}/health`,
      names: ['trace-edge-dev', 'trace-jobs-dev'],
    },
    {
      name: 'candidate',
      cwd: 'apps/candidate',
      script: VITE('candidate'),
      args: ['preview'],
      ready: `${E2E_ENV.E2E_CANDIDATE_URL}/version.json`,
      names: [],
    },
    {
      name: 'recruiter',
      cwd: 'apps/recruiter',
      script: VITE('recruiter'),
      args: ['preview'],
      ready: `${E2E_ENV.E2E_RECRUITER_URL}/version.json`,
      names: [],
    },
  ];
}

const tail = (text) =>
  String(text)
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-TAIL_LINES)
    .map((l) => `  | ${redact(l)}`);

/**
 * Starts one process; returns a handle: `output()` (all output so far), `exited` (resolves to the
 * exit code or signal name) and `stop()` (stops the whole process tree).
 */
export function startProcess(spec, root) {
  let output = '';
  let exitedWith = null;
  const child = spawn(process.execPath, [path.join(root, spec.script), ...spec.args], {
    cwd: path.join(root, spec.cwd),
    env: { ...process.env, ...WRANGLER_CHILD_ENV },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // Its own process group on POSIX, so stop() reaches workerd and esbuild too.
    detached: process.platform !== 'win32',
  });
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const exited = new Promise((resolve) => {
    child.on('error', (e) => resolve((exitedWith = `error ${e.code ?? 'spawn'}`)));
    child.on('exit', (code, signal) => resolve((exitedWith = code ?? signal ?? 'unknown')));
  });
  const stop = async () => {
    if (exitedWith !== null || child.pid === undefined) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already gone
      }
      const late = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }, STOP_GRACE_MS);
      await exited;
      clearTimeout(late);
      return;
    }
    await exited;
  };
  /** Synchronous kill of the whole tree, for a signal handler that exits right after it. */
  const killNow = () => {
    if (exitedWith !== null || child.pid === undefined) return;
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } else {
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch {
      // already gone
    }
  };
  return {
    name: spec.name,
    output: () => output,
    exited,
    stop,
    killNow,
    exitCode: () => exitedWith,
  };
}

/** Runs a command with inherited output (Playwright's progress shows in the CI log). */
export function runInherit(cmd, args, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', () => resolve(null));
    child.on('exit', (code) => resolve(code));
  });
}

/** True when `url` answers 200 now (one try, short timeout). */
async function answers(fetch, url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).status === 200;
  } catch {
    return false;
  }
}

/** Polls `url` until it answers 200, the process exits, or the time runs out; returns '' or a problem. */
export async function waitReady(handle, url, { fetch, now, sleep, timeoutMs = READY_TIMEOUT_MS }) {
  const start = now();
  for (;;) {
    if (handle.exitCode() !== null) {
      return `${handle.name} exited (${handle.exitCode()}) before ${url} answered`;
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.status === 200) return '';
    } catch {
      // not listening yet
    }
    if (now() - start >= timeoutMs) {
      return `${handle.name} did not answer 200 on ${url} within ${Math.round(timeoutMs / 1000)} s`;
    }
    await sleep(POLL_MS);
  }
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * The local stack's values from `supabase status -o env` (localStackEnv), or a problem: the API URL
 * must be on 127.0.0.1 and the publishable key and database URL present. No value is printed.
 * @returns {{ ok: true, stack: { apiUrl: string, publishableKey: string, dbUrl: string } } | { ok: false, problem: string }}
 */
export function readStack(raw) {
  const bad = {
    ok: false,
    problem:
      'could not read `supabase status` of the local stack (an API URL on 127.0.0.1, the publishable key and the database URL)',
  };
  if (raw === null || typeof raw !== 'object') return bad;
  const apiUrl = String(raw.API_URL ?? '').replace(/\/+$/, '');
  const publishableKey = String(raw.PUBLISHABLE_KEY ?? '');
  const dbUrl = String(raw.DB_URL ?? '');
  let host = '';
  let dbHost = '';
  try {
    host = new URL(apiUrl).hostname;
    dbHost = new URL(dbUrl).hostname;
  } catch {
    return bad;
  }
  if (host !== '127.0.0.1' || !LOCAL_HOSTS.has(dbHost) || publishableKey === '') return bad;
  return { ok: true, stack: { apiUrl, publishableKey, dbUrl } };
}

/**
 * The environment of the one app-build call (spec §7.1, rev 4f, rev 4i): the recruiter registers the
 * demo outbox route only with VITE_DEMO_OUTBOX=1 and a VITE_TRACE_ENV other than production (set
 * here, so a parent value cannot turn it off); the candidate app reaches the local edge. The
 * recruiter app gets the local stack's API URL (VITE_SUPABASE_URL), its publishable key
 * (VITE_SUPABASE_PUBLISHABLE_KEY) and the local api Worker origin (VITE_API_ORIGIN), so its UI can
 * sign in and call the api locally. The recruiter's headers plugin
 * (packages/config/vite/headers-template.js) accepts those loopback origins only because
 * VITE_TRACE_ENV is exactly `dev`. `stack` is readStack()'s checked result; nothing here is
 * generated, written or printed.
 * @param {{ apiUrl: string, publishableKey: string }} stack
 */
export function buildEnv(stack) {
  return {
    VITE_DEMO_OUTBOX: '1',
    VITE_TRACE_ENV: 'dev',
    VITE_EDGE_ORIGIN: E2E_ENV.E2E_EDGE_URL,
    VITE_SUPABASE_URL: stack.apiUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
    VITE_API_ORIGIN: E2E_ENV.E2E_API_URL,
  };
}

class StepFailure extends Error {}

/** A file-system error code, safe to print; a message (which can hold a path) is never used. */
const codeOf = (e) =>
  typeof e?.code === 'string' && /^[A-Z0-9_]{2,20}$/.test(e.code) ? e.code : 'error';

/**
 * Security review SEC-E1: the operator scripts prefer TRACE_OPERATOR_DB_URL (the staging operator
 * variable) over the local stack (scripts/ops/lib.mjs resolveDbUrl). A non-local value in the
 * parent environment stops the run before anything touches a database; the message names the
 * variable only, never the value.
 */
export function operatorUrlProblem(...envs) {
  for (const env of envs) {
    const raw = env?.[DB_URL_ENV];
    if (raw === undefined || String(raw).trim() === '') continue;
    let host = '';
    try {
      host = new URL(String(raw).trim()).hostname.toLowerCase();
    } catch {
      // reported below
    }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
      return `${DB_URL_ENV} is set to a database that is not a local one; unset it before running the local stack (it would point the operator scripts away from the local stack)`;
    }
  }
  return null;
}

/**
 * The environment without TRACE_OPERATOR_DB_URL: an operator script then reads the local stack's
 * own database URL from `supabase status` (the same URL readStack checked). Even a loopback value
 * is dropped (it can be a tunnel to another database, B0-SEC2), and the docker-exec fallback of
 * scripts/ops/lib.mjs runSql (no psql installed) works only without it.
 */
export const withoutOperatorUrl = (env) => {
  const copy = { ...env };
  delete copy[DB_URL_ENV];
  return copy;
};

/**
 * Runs an operator script's main() with captured output; returns the one id it prints. A failure
 * names the step, the exit code and the script's first stderr line (fixed messages and a SQLSTATE
 * or HTTP status only, never a value), redacted.
 */
async function operator(deps, step, run, argv, extraEnv = {}) {
  const out = [];
  const err = [];
  const code = await run({
    argv,
    deps: {
      ...deps.opsDeps,
      env: { ...withoutOperatorUrl(deps.opsDeps.env), ...extraEnv },
      stdout: { write: (s) => out.push(String(s)) },
      stderr: { write: (s) => err.push(String(s)) },
    },
  });
  const id = out.join('').trim();
  if (code !== 0 || !isUuid(id)) {
    const why = err.join('').trim().split(/\r?\n/)[0] ?? '';
    throw new StepFailure(`${step} failed (exit ${code}${why ? `; ${redact(why)}` : ''})`);
  }
  return id.toLowerCase();
}

/**
 * Step 2b: the login-role passwords, the keys, the Worker files and the synthetic users and org.
 * Writes only into the state folder (`config`, configPaths()). Returns the extra Playwright env.
 * @returns {Promise<{ ok: true, playwrightEnv: Record<string, string> } | { ok: false, problems: string[] }>}
 */
export async function prepareLocal(deps, { stack, config, root }) {
  try {
    const passwords = Object.fromEntries(
      LOGIN_ROLES.map(({ login }) => [login, deps.randomHex(24)]),
    );
    const roles = deps.runSql({ url: stack.dbUrl, sql: loginRolesSql(passwords), vars: {} });
    if (!roles.ok) {
      throw new StepFailure(
        `setting up the local login roles failed (${roles.sqlstate ? `SQLSTATE ${roles.sqlstate}` : 'no SQLSTATE'})`,
      );
    }
    const keys = await candidateTokenKeys(deps.subtle, kidFor(deps.now()));
    const secrets = workerSecrets({ stack, passwords, keys, hmacKey: deps.randomHex(32) });
    const jobsDir = path.join(root, 'workers', 'jobs');
    const jobsConfig = jobsDevConfig(
      deps.readText(path.join(jobsDir, 'wrangler.jsonc')),
      path.join(jobsDir, 'src', 'index.ts'),
    );
    deps.writeSecret(config.apiEnvFile, dotenvText(secrets.api));
    deps.writeSecret(config.edgeEnvFile, dotenvText(secrets.edge));
    deps.writeSecret(config.jobsConfig, jobsConfig);
    deps.writeSecret(config.jobsDevVars, dotenvText(secrets.jobs));

    // The synthetic users, the org and its members (prior art: scripts/test-auth-local.mjs).
    const password = `E2e${deps.randomHex(12)}9`;
    const { enrolSmokeUser: enrol, createOrg: create, addMember: add } = deps.operators;
    const ids = {};
    for (const u of USERS) {
      ids[u.key] = await operator(
        deps,
        `enrol-smoke-user (${u.email})`,
        enrol,
        ['--env', 'local', '--email', u.email],
        { SMOKE_PASSWORD: password },
      );
    }
    const owner = USERS.find((u) => u.roles === null);
    const orgId = await operator(deps, 'create-org', create, [
      '--name',
      'E2E local',
      '--slug',
      'e2e-local',
      '--kind',
      'customer',
      '--owner-user-id',
      ids[owner.key],
      '--display-name',
      owner.name,
      '--request-id',
      randomUUID(),
    ]);
    for (const u of USERS.filter((x) => x.roles !== null)) {
      await operator(deps, `add-member (${u.email})`, add, [
        '--org-id',
        orgId,
        '--user-id',
        ids[u.key],
        '--roles',
        u.roles,
        '--display-name',
        u.name,
        '--request-id',
        randomUUID(),
      ]);
    }
    return {
      ok: true,
      playwrightEnv: {
        E2E_SUPABASE_URL: stack.apiUrl,
        E2E_SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
        E2E_DB_CONTAINER: LOCAL_DB_CONTAINER,
        E2E_ORG_ID: orgId,
        E2E_USER_PASSWORD: password,
        ...Object.fromEntries(USERS.map((u) => [`E2E_${u.key}_EMAIL`, u.email])),
      },
    };
  } catch (e) {
    // The helpers' own messages name a step or a variable, never a value; anything else is redacted.
    return { ok: false, problems: [redact(String(e?.message ?? e))] };
  }
}

/** Every dependency, with the real ones as defaults (tests inject all of them). */
export function defaultDeps(overrides) {
  return {
    ...stackDefaults({}),
    start: startProcess,
    runInherit,
    fetch: globalThis.fetch,
    makeStateDir: () => mkdtempSync(path.join(tmpdir(), 'trace-e2e-')),
    removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
    writeFile: (file, text) => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    },
    env: process.env,
    stackEnv: () => localStackEnv(realDeps()),
    // The URL is always the checked local one; without TRACE_OPERATOR_DB_URL the docker-exec
    // fallback (no psql installed) is allowed too (SEC-E1).
    runSql: (args) => runSql(args, { ...realDeps(), env: withoutOperatorUrl(process.env) }),
    operators: { enrolSmokeUser, createOrg, addMember },
    opsDeps: realDeps(),
    subtle: globalThis.crypto.subtle,
    randomHex: (bytes) => randomBytes(bytes).toString('hex'),
    readText: (file) => readFileSync(file, 'utf8'),
    // Owner-only on POSIX; never overwrites (the state folder is new for every run).
    writeSecret: (file, text) => {
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
    },
    ...overrides,
  };
}

/** CLI body; resolves to the exit code. */
export async function main(options) {
  const deps = { ...defaultDeps(options), tool: TOOL };
  const { argv = [], root, run, now, sleep, log, error, start, fetch, env } = deps;
  if (!argv.every((a) => a === '--ci' || a === '--stop')) {
    error(USAGE);
    return 2;
  }
  // SEC-E1: nothing runs (no Docker check, no role SQL, no operator) with a non-local operator URL.
  const urlProblem = operatorUrlProblem(env, deps.opsDeps?.env);
  if (urlProblem !== null) {
    error(`${TOOL}: ${urlProblem}`);
    error(`${TOOL}: FAILED`);
    return 1;
  }
  const ci = argv.includes('--ci');
  const t0 = now();
  const phases = {};
  let playwright = null;
  // Security review 2026-10-17 L2: the lock's signal handler exits at once, so the finally below
  // never runs on Ctrl+C, and on POSIX the detached process groups would survive. This handler is
  // registered first, so it runs first: it kills every process tree, removes the state folder and
  // (security review SEC-E2) drops the login roles once they were set, best effort and synchronous.
  const live = { handles: [], stateDir: null, rolesDbUrl: null };
  const onSignal = () => {
    for (const h of live.handles) h.killNow();
    if (live.stateDir !== null) deps.removeDir(live.stateDir);
    if (live.rolesDbUrl !== null) {
      try {
        deps.runSql({ url: live.rolesDbUrl, sql: dropLoginRolesSql(), vars: {} });
      } catch {
        // best effort: the next run recreates the roles
      }
    }
  };
  const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];
  for (const s of SIGNALS) deps.proc.on(s, onSignal);

  const result = await withLocalStack(deps, { stop: argv.includes('--stop') }, async () => {
    phases.supabase_ms = now() - t0;
    const read = readStack(deps.stackEnv());
    if (!read.ok) return [read.problem];
    const { stack } = read;
    log(`${TOOL}: building the candidate and recruiter apps (demo outbox on, local edge origin)`);
    const tb = now();
    const built = await run('pnpm', BUILD_ARGS, { cwd: root, env: buildEnv(stack) });
    phases.build_ms = now() - tb;
    if (built.error || built.status !== 0) {
      return [
        `the app build exited ${built.status}; last output, redacted:`,
        ...tail(`${built.stdout}\n${built.stderr}`),
      ];
    }

    const stateDir = deps.makeStateDir();
    live.stateDir = stateDir;
    const handles = live.handles;
    const problems = [];
    const config = configPaths(stateDir);
    let rolesTouched = false;
    try {
      const specs = stackProcesses(toPosix(stateDir), config);
      // An earlier, interrupted run may still hold a port: then the new process (strictPort)
      // would fail while the old one answers, and the run would test a stale build (L2).
      for (const spec of specs) {
        if (await answers(fetch, spec.ready)) {
          problems.push(
            `${spec.ready} already answers before ${spec.name} started (an earlier stack may still be running; stop it first)`,
          );
        }
      }
      if (problems.length > 0) return problems;

      log(`${TOOL}: setting up the local logins, keys, users and org`);
      const tl = now();
      rolesTouched = true;
      live.rolesDbUrl = stack.dbUrl;
      const local = await prepareLocal(deps, { stack, config, root });
      phases.setup_ms = now() - tl;
      if (!local.ok) return local.problems;

      const ts = now();
      for (const spec of specs) {
        log(`${TOOL}: starting ${spec.name}`);
        handles.push(start(spec, root));
      }
      const waits = await Promise.all(
        specs.map((spec, i) => waitReady(handles[i], spec.ready, { fetch, now, sleep })),
      );
      specs.forEach((spec, i) => {
        const out = handles[i].output();
        const missing = spec.names.filter((n) => !out.includes(n));
        if (waits[i] !== '') problems.push(waits[i], ...tail(out));
        else if (missing.length > 0) {
          problems.push(`${spec.name} did not report starting ${missing.join(', ')}`, ...tail(out));
        }
      });
      phases.stack_ms = now() - ts;
      if (problems.length > 0) return problems;

      log(`${TOOL}: the stack is up; running Playwright`);
      const tp = now();
      playwright = await deps.runInherit(
        process.execPath,
        [path.join(root, PLAYWRIGHT_CLI), 'test'],
        {
          cwd: path.join(root, 'e2e'),
          env: { ...E2E_ENV, ...local.playwrightEnv },
        },
      );
      phases.playwright_ms = now() - tp;
      if (playwright !== 0) problems.push(`Playwright exited ${playwright}`);
      return problems;
    } finally {
      await Promise.all(handles.map((h) => h.stop()));
      // Security review SEC-E3: the state folder (with the generated env files) goes first, in its
      // own try, so nothing after it can leave those files behind. The warning has no path.
      try {
        deps.removeDir(stateDir);
      } catch (e) {
        deps.warn(
          `${TOOL}: warning: could not remove the temporary state folder (${codeOf(e)}); delete the trace-e2e-* folder in the OS temp directory by hand`,
        );
      }
      live.stateDir = null;
      // The Workers are stopped, so nothing uses the logins any more; a later run recreates them.
      if (rolesTouched) {
        let dropped;
        try {
          dropped = deps.runSql({ url: stack.dbUrl, sql: dropLoginRolesSql(), vars: {} });
        } catch {
          dropped = { ok: false, sqlstate: null };
        }
        if (!dropped.ok) {
          const why = dropped.sqlstate ? `SQLSTATE ${dropped.sqlstate}` : 'no SQLSTATE';
          deps.warn(
            `${TOOL}: warning: could not drop the local login roles (${why}); the next run recreates them`,
          );
        }
        live.rolesDbUrl = null;
      }
      for (const h of handles) {
        const file = path.join(root, ...LOG_DIR.split('/'), `${h.name.replace(/\W/g, '-')}.log`);
        try {
          deps.writeFile(file, redact(h.output()));
        } catch (e) {
          deps.warn(`${TOOL}: warning: could not write the ${h.name} process log (${codeOf(e)})`);
        }
      }
    }
  });
  for (const s of SIGNALS) deps.proc.off(s, onSignal);

  const totalMs = now() - t0;
  const problems = [...result.problems];
  if (!result.docker)
    problems.unshift(
      'Docker is not running: the local E2E stack cannot start. Start Docker Desktop.',
    );
  if (totalMs > LIMIT_MS) {
    problems.push(
      `the run took ${Math.round(totalMs / 1000)} s, over the ${LIMIT_MS / 60000}-minute CI job limit (DC-D9)`,
    );
  }
  const manifest = {
    check: 'DC-D9',
    ci,
    sha: env.GITHUB_SHA ?? null,
    platform: process.platform,
    node: process.version,
    phases,
    total_ms: totalMs,
    limit_ms: LIMIT_MS,
    within_limit: totalMs <= LIMIT_MS,
    playwright_exit: playwright,
    result: problems.length === 0 ? 'pass' : 'fail',
  };
  deps.writeFile(path.join(root, ...MANIFEST.split('/')), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`${TOOL}: ${JSON.stringify(manifest)}`);
  if (problems.length > 0) {
    for (const p of problems) error(p.startsWith('  | ') ? p : `${TOOL}: ${p}`);
    error(`${TOOL}: FAILED`);
    return 1;
  }
  log(`${TOOL}: OK in ${Math.round(totalMs / 1000)} s`);
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  main({ argv: process.argv.slice(2), root }).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`${TOOL}: ${redact(String(e?.message ?? e))}`);
      process.exitCode = 1;
    },
  );
}
