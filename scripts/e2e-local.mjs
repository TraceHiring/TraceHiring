#!/usr/bin/env node
// The local E2E stack (specs/d1-demo-slice.md §7.1, §7.2; day-one checks DC-D9 and the Linux half
// of DC-D6, §8). Lead-only: it starts and resets the shared local Supabase stack.
//   node scripts/e2e-local.mjs [--ci] [--stop]
// 1. Docker check, the test-rls lock, `supabase start -x …` and `supabase db reset` (withLocalStack).
// 2. Builds both apps (`pnpm --filter @trace/candidate --filter @trace/recruiter build`).
// 3. Starts two `wrangler dev` sessions with one shared --persist-to folder (R2, Queue, DO state):
//    services/api alone on 8788, and workers/edge with workers/jobs on 8787. One multi-config
//    session serves only its first Worker on the port, so it cannot give both the candidate app
//    (edge) and the recruiter app (api) an HTTP origin; edge and jobs share a session because the
//    mirror Queue's producer and consumer must, and edge reaches api's CandidateRpc through the
//    local dev registry (lead, 2026-10-17; spec §8 DC-D9). Then `vite preview` for the candidate
//    app (5173) and the recruiter app (5174), the ports the Workers' dev origins name.
// 4. Waits for each /health or /version.json, checks that each session started its Workers, and
//    runs Playwright (`e2e/`, E2E_LOCAL=1) against the stack.
// 5. Always stops every process it started and removes the state folder; writes the per-phase
//    timings to e2e/test-results/dc-d9.json and the redacted process logs next to it. Fails when a
//    step fails or the whole run takes longer than the 25-minute CI job limit.
// Every value is local and synthetic; nothing reads a secret. Child output is redacted before it
// is printed or written (it can hold the local stack's keys or a connection URL).
// --ci marks the run as the CI job's in the manifest; --stop runs `supabase stop` at the end.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/cli.mjs';
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
const WRANGLER = 'node_modules/wrangler/bin/wrangler.js';
const VITE = (app) => `apps/${app}/node_modules/vite/bin/vite.js`;
const USAGE = 'usage: node scripts/e2e-local.mjs [--ci] [--stop]';
const TAIL_LINES = 20;
const TOOL = 'e2e-local';

/**
 * The long-running processes, in start order. `script` is repo-relative and runs under the current
 * node (no shell, so stopping the process stops what it started). `names` are the Worker names a
 * wrangler session must report starting.
 */
export function stackProcesses(persistDir) {
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
      ]),
      ready: `${E2E_ENV.E2E_API_URL}/health`,
      // A one-config session prints "Your Worker has access to…", not the name (wrangler 4.149).
      names: [],
    },
    {
      name: 'edge+jobs',
      cwd: '.',
      script: WRANGLER,
      args: ['dev', '-c', 'workers/edge/wrangler.jsonc', '-c', 'workers/jobs/wrangler.jsonc']
        .concat(common)
        .concat(['--port', '8787', '--inspector-port', '9230']),
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
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', DO_NOT_TRACK: '1' },
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
  return { name: spec.name, output: () => output, exited, stop, exitCode: () => exitedWith };
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
  const ci = argv.includes('--ci');
  const t0 = now();
  const phases = {};
  let playwright = null;

  const result = await withLocalStack(deps, { stop: argv.includes('--stop') }, async () => {
    phases.supabase_ms = now() - t0;
    log(`${TOOL}: building the candidate and recruiter apps`);
    const tb = now();
    const built = await run('pnpm', BUILD_ARGS, { cwd: root });
    phases.build_ms = now() - tb;
    if (built.error || built.status !== 0) {
      return [
        `the app build exited ${built.status}; last output, redacted:`,
        ...tail(`${built.stdout}\n${built.stderr}`),
      ];
    }

    const stateDir = deps.makeStateDir();
    const handles = [];
    const problems = [];
    try {
      const ts = now();
      const specs = stackProcesses(stateDir.split(path.sep).join('/'));
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
          env: { ...E2E_ENV },
        },
      );
      phases.playwright_ms = now() - tp;
      if (playwright !== 0) problems.push(`Playwright exited ${playwright}`);
      return problems;
    } finally {
      await Promise.all(handles.map((h) => h.stop()));
      for (const h of handles) {
        const file = path.join(root, ...LOG_DIR.split('/'), `${h.name.replace(/\W/g, '-')}.log`);
        deps.writeFile(file, redact(h.output()));
      }
      deps.removeDir(stateDir);
    }
  });

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
