// DC-D9 (specs/d1-demo-slice.md §7.1, §8): scripts/e2e-local.mjs starts the local stack, runs
// Playwright and always tears down. Every process, the network, Docker and the clock are fakes;
// nothing starts a real server. Synthetic data only.
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILD_ARGS,
  E2E_ENV,
  LIMIT_MS,
  LOG_DIR,
  MANIFEST,
  READY_TIMEOUT_MS,
  main,
  stackProcesses,
} from '../e2e-local.mjs';
import { cleanupTempDirs, makeTempDir, writeFiles } from './fixtures/checks/temp-repo.mjs';

afterEach(cleanupTempDirs);

const ok = { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: null };
const STATE = '/tmp/trace-e2e-state';

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
} = {}) {
  const root = makeTempDir('trace-e2e-root-');
  writeFiles(root, { 'supabase/config.toml': 'project_id = "trace-e2e-test"\n' });
  const h = {
    clock: 0,
    calls: [],
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
    run: async (cmd, args) => {
      h.calls.push([cmd, ...args].join(' '));
      return answer(cmd, args, h);
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
      const code = exitEarly[spec.name] ?? null;
      return {
        name: spec.name,
        output: () => outputs[spec.name] ?? `${spec.names.join('\n')}\nReady`,
        exitCode: () => code,
        exited: Promise.resolve(code),
        stop: async () => {
          h.stopped.push(spec.name);
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
      h.pw = { cmd, args, opts };
      onPlaywright(h);
      return playwright;
    },
    makeStateDir: () => STATE,
    removeDir: (dir) => h.removed.push(dir),
    writeFile: (file, text) => {
      h.written[path.relative(root, file).split(path.sep).join('/')] = text;
    },
    env: { GITHUB_SHA: 'a'.repeat(40) },
  };
  return h;
}

const manifestOf = (h) => JSON.parse(h.written[MANIFEST]);

describe('stackProcesses', () => {
  it('runs api alone, then edge with jobs, under wrangler dev --env dev with one shared state folder', () => {
    const [api, edge, candidate, recruiter] = stackProcesses(STATE);
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
    ]);
    // edge first, so the edge is the session's HTTP Worker; jobs consumes the mirror Queue in-process.
    expect(edge.args).toEqual([
      'dev',
      '-c',
      'workers/edge/wrangler.jsonc',
      '-c',
      'workers/jobs/wrangler.jsonc',
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

  it('gives Playwright only local origins (no secret, no staging host)', () => {
    expect(E2E_ENV).toEqual({
      E2E_LOCAL: '1',
      E2E_CANDIDATE_URL: 'http://localhost:5173',
      E2E_RECRUITER_URL: 'http://localhost:5174',
      E2E_EDGE_URL: 'http://127.0.0.1:8787',
      E2E_API_URL: 'http://127.0.0.1:8788',
    });
  });
});

describe('main', () => {
  it('rejects unknown arguments', async () => {
    const h = harness({ argv: ['--yes'] });
    expect(await main(h.deps)).toBe(2);
    expect(h.calls).toEqual([]);
  });

  it('starts Supabase, resets, builds, starts the stack, runs Playwright, then stops everything', async () => {
    const h = harness();
    expect(await main(h.deps)).toBe(0);
    expect(h.calls[0]).toBe('docker info');
    expect(h.calls[1]).toMatch(/^pnpm exec supabase start -x /);
    expect(h.calls[2]).toBe('pnpm exec supabase db reset --local');
    expect(h.calls[3]).toBe(`pnpm ${BUILD_ARGS.join(' ')}`);
    expect(h.started.map((s) => s.name)).toEqual(['api', 'edge+jobs', 'candidate', 'recruiter']);
    expect(h.calls[4]).toMatch(/^playwright test$/);
    expect(h.pw.opts.env).toEqual(E2E_ENV);
    expect(h.pw.opts.cwd).toBe(path.join(h.root, 'e2e'));
    expect(h.stopped.sort()).toEqual(['api', 'candidate', 'edge+jobs', 'recruiter']);
    expect(h.removed).toEqual([STATE]);
    // No supabase stop without --stop.
    expect(h.calls.some((c) => /supabase stop/.test(c))).toBe(false);
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
    expect(Object.keys(m.phases)).toEqual(['supabase_ms', 'build_ms', 'stack_ms', 'playwright_ms']);
  });

  it('writes each process log, redacted, under the test results', async () => {
    const h = harness({
      outputs: { api: 'trace-api-dev\nkey: sb_secret_abcdefghijklmnop\nReady' },
    });
    expect(await main(h.deps)).toBe(0);
    const log = h.written[`${LOG_DIR}/api.log`];
    expect(log).toContain('trace-api-dev');
    expect(log).not.toContain('sb_secret_abcdefghijklmnop');
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

  it('starts no process when the app build fails', async () => {
    const h = harness({
      answer: (cmd, args) =>
        args.includes('build') ? { ...ok, status: 1, stderr: Buffer.from('boom') } : ok,
    });
    expect(await main(h.deps)).toBe(1);
    expect(h.started).toEqual([]);
    expect(h.lines.join('\n')).toMatch(/the app build exited 1/);
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
