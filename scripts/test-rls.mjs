#!/usr/bin/env node
// RLS harness (spec specs/m0-foundations.md §8.3, revision 11; AT-2, AT-3, AT-23).
//   node scripts/test-rls.mjs          (pnpm test:rls) leaves the local stack running afterwards
//   node scripts/test-rls.mjs --stop   CI: stops the stack at the end
// Steps, in order. Every failure exits 1; nothing here ever skips.
//   1. Docker: `docker info` must succeed, else the exact message in DOCKER_MESSAGE.
//   2. Lock: every checkout (worktrees, clean clones) shares one local stack, keyed by the
//      project_id in supabase/config.toml. An exclusive lock file in the OS temp dir records the
//      PID and checkout path. A live holder is waited for up to 15 minutes, then named in the
//      failure; a holder whose PID is dead is taken over with a warning (the stale file is moved
//      aside by an atomic rename and checked, so two runs taking it over at once never delete
//      each other's fresh lock). The lock is released on exit, on failure and on a signal.
//   3. `pnpm exec supabase start -x <services not needed>`; gotrue, kong, postgrest, mailpit stay on.
//   4. `pnpm exec supabase db reset --local` rebuilds the database from zero.
//   5. `pnpm exec supabase test db --local --debug`: --debug makes pg_prove print every
//      assertion. The TAP is parsed from stdout. It fails on any `not ok` (or TODO/SKIP), a plan
//      mismatch, a file with zero tests, a file not named catalog_* or rls_*, or a set of files
//      that differs from the .sql files under supabase/tests/. Passing assertions are counted by
//      file prefix against supabase/tests/catalog-min-count and rls-min-count. The `ok N` /
//      `not ok N` lines are counted here against each file's `1..N` plan; pgTAP's own finish() and
//      num_failed() diagnostics (`# Looks like …`) are never read: catalog_meta's
//      `rollback to savepoint` rolls back pgTAP's counters too, so they are wrong there.
//   5b. `node scripts/test-auth-local.mjs` (specs/m0b-tenancy.md AT-B8): local org sign-in end to end
//      through kong, PostgREST and mailpit, which step 3 keeps on. Only its `test-auth-local: `
//      stdout lines are printed on failure; its stderr never is.
//   5c. `node scripts/test-concurrency-local.mjs` (M0b review M0B-DB-5): two connections demote the two
//      owners of one org at once, under READ COMMITTED and REPEATABLE READ; the second must be refused.
//      Only its `test-concurrency-local: ` stdout lines are printed on failure; its stderr never is.
//   6. db-types drift: `supabase gen types typescript --local --schema public` goes to a temp
//      file, compared byte for byte with packages/db-types/src/database.ts (never overwritten;
//      `pnpm db:types` regenerates it on purpose).
//   7. With --stop, `pnpm exec supabase stop`; then the lock is released.
// stderr of the Supabase CLI is never echoed raw: with --debug it can hold a connection URL.
// stderr of `test db` and `gen types` is never printed at all; a failed start, reset or stop
// prints a short redacted tail of its output.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFloor } from './gen-catalog-tests.mjs';
import { isEntryPoint } from './lib/cli.mjs';
import { countAssertionsByPrefix, parseProve } from './lib/tap.mjs';

export const DOCKER_MESSAGE =
  'Docker is not running — RLS tests cannot run. Start Docker Desktop. This check never skips.';

/** Containers `supabase start -x` accepts on CLI 2.120.0 (spec §8.2 day-one results, revision 11). */
export const SUPABASE_CONTAINERS = Object.freeze([
  'gotrue',
  'realtime',
  'storage-api',
  'imgproxy',
  'kong',
  'mailpit',
  'postgrest',
  'postgres-meta',
  'studio',
  'edge-runtime',
  'logflare',
  'vector',
  'supavisor',
]);
/**
 * Services the harness keeps on: auth (gotrue) for the `auth` schema the RLS tests rely on (spec
 * §8.3 step 3), and, from M0b, the API gateway (kong), PostgREST and the mail catcher (mailpit)
 * that the local org sign-in test needs (specs/m0b-tenancy.md AT-B8 [S3]). Everything else stays
 * off. `gen types --local` works without postgres-meta (revision 11 day-one result).
 */
export const KEPT_SERVICES = Object.freeze(['gotrue', 'kong', 'postgrest', 'mailpit']);
export const EXCLUDED_SERVICES = Object.freeze(
  SUPABASE_CONTAINERS.filter((c) => !KEPT_SERVICES.includes(c)),
);
/** AT-B8: local org sign-in end to end, run with node from the repository root after pgTAP. */
export const AUTH_TEST_ARGS = Object.freeze(['scripts/test-auth-local.mjs']);
/** M0B-DB-5: two connections demote an org's two owners at once, run with node after AT-B8. */
export const CONCURRENCY_TEST_ARGS = Object.freeze(['scripts/test-concurrency-local.mjs']);
/** d1 AT-D16 (stream R2): the jobs stages against the real schema, grants and card guard (Node, local DB). */
export const JOBS_DB_TEST_ARGS = Object.freeze([
  '--filter',
  '@trace/jobs',
  'exec',
  'vitest',
  'run',
  '-c',
  'vitest.db.config.ts',
]);

export const START_ARGS = Object.freeze([
  'exec',
  'supabase',
  'start',
  '-x',
  EXCLUDED_SERVICES.join(','),
]);
export const RESET_ARGS = Object.freeze(['exec', 'supabase', 'db', 'reset', '--local']);
export const TEST_ARGS = Object.freeze(['exec', 'supabase', 'test', 'db', '--local', '--debug']);
export const GEN_TYPES_ARGS = Object.freeze([
  'exec',
  'supabase',
  'gen',
  'types',
  'typescript',
  '--local',
  '--schema',
  'public',
]);
export const STOP_ARGS = Object.freeze(['exec', 'supabase', 'stop']);

export const CONFIG_FILE = 'supabase/config.toml';
export const TESTS_DIR = 'supabase/tests';
export const DB_TYPES_FILE = 'packages/db-types/src/database.ts';
/** Floor file per test-file prefix (the same files gen-catalog-tests keeps from going down). */
export const FLOORS = Object.freeze({
  catalog_: 'supabase/tests/catalog-min-count',
  rls_: 'supabase/tests/rls-min-count',
});
export const PREFIXES = Object.freeze(Object.keys(FLOORS));

export const LOCK_TIMEOUT_MS = 15 * 60 * 1000;
export const LOCK_POLL_MS = 2000;
const DOCKER_TIMEOUT_MS = 2 * 60 * 1000;
const TAIL_LINES = 15;
const USAGE = 'usage: node scripts/test-rls.mjs [--stop]';
const GEN_TYPES_COMMAND = `supabase ${GEN_TYPES_ARGS.slice(2).join(' ')}`;

const toBuffer = (x) => (Buffer.isBuffer(x) ? x : Buffer.from(x ?? '', 'utf8'));
const toText = (x) => (Buffer.isBuffer(x) ? x.toString('utf8') : String(x ?? ''));
const basename = (file) => file.split(/[\\/]/).pop();
const abs = (root, rel) => path.join(root, ...rel.split('/'));

// ---------- output hygiene ----------

/** Removes credentials from CLI text before it is printed. Synthetic patterns only, no values. */
export function redact(text) {
  return (
    text
      // userinfo in a URL: scheme://user:password@host
      .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
      // Supabase API keys
      .replace(/\bsb_(secret|publishable)_[A-Za-z0-9_-]+/g, 'sb_$1_[REDACTED]')
      // JWTs
      .replace(/\beyJ[\w-]*\.[\w-]+\.[\w-]+/g, '[REDACTED_JWT]')
      // key/secret/password/token values: "Secret Key: …", "password=…"
      .replace(/\b(password|passwd|pwd|secret|token|key)(\s*[=:]\s*)\S+/gi, '$1$2[REDACTED]')
      // long hex strings (S3 keys, raw tokens)
      .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[REDACTED_HEX]')
  );
}

/** The last lines of a command's output, redacted, indented for the report. */
function redactedTail(...texts) {
  const lines = texts
    .map(toText)
    .join('\n')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-TAIL_LINES);
  return lines.map((l) => `  | ${redact(l)}`);
}

// ---------- process running ----------

/** A Windows command line for `shell: true`, refusing anything cmd.exe could interpret. */
export function windowsCommandLine(cmd, args) {
  for (const a of [cmd, ...args]) {
    if (!/^[\w@./:=+,-]+$/.test(a))
      throw new Error(`unsafe argument for a shell command line: ${a}`);
  }
  return [cmd, ...args].join(' ');
}

/**
 * Runs a command and captures its output as bytes. Never throws and never rejects. `env`, when
 * given, is merged over the parent's environment (the child keeps PATH and the rest).
 * @returns {Promise<{ status: number|null, stdout: Buffer, stderr: Buffer, error: Error|null }>}
 */
export function spawnRun(cmd, args, { cwd, timeoutMs, env } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let timer = null;
    const out = [];
    const err = [];
    const finish = (status, error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status, stdout: Buffer.concat(out), stderr: Buffer.concat(err), error });
    };
    let child;
    const childEnv = env === undefined ? {} : { env: { ...process.env, ...env } };
    try {
      // pnpm is a .cmd shim on Windows, which Node only starts through a shell.
      child =
        process.platform === 'win32' && cmd === 'pnpm'
          ? spawn(windowsCommandLine(cmd, args), {
              cwd,
              shell: true,
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
              ...childEnv,
            })
          : spawn(cmd, args, {
              cwd,
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
              ...childEnv,
            });
    } catch (e) {
      resolve({ status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: e });
      return;
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
    }
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) =>
      finish(code, timedOut ? new Error(`${cmd} timed out after ${timeoutMs} ms`) : null),
    );
  });
}

/** True when a process with this PID exists (signal 0 tests existence, also on Windows). */
export function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists, owned by someone else
  }
}

// ---------- config, files and floors ----------

/** The top-level `project_id` of supabase/config.toml, safe to use in a file name. */
export function readProjectId(root) {
  const file = abs(root, CONFIG_FILE);
  if (!existsSync(file)) {
    throw new Error(`${CONFIG_FILE} is missing (the lock is keyed by its project_id)`);
  }
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break; // the first table ends the top-level keys
    const m = /^\s*project_id\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$/.exec(line);
    if (!m) continue;
    const id = m[1] ?? m[2];
    if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(id)) {
      throw new Error(
        `${CONFIG_FILE}: project_id ${JSON.stringify(id)} is not a safe file-name part`,
      );
    }
    return id;
  }
  throw new Error(`${CONFIG_FILE} has no top-level project_id = "<id>"`);
}

/** Every .sql file under supabase/tests/, recursively (supabase test db runs them all), POSIX-relative. */
export function listSqlFiles(root) {
  const out = [];
  const walk = (dir, rel) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), childRel);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.sql')) out.push(childRel);
    }
  };
  walk(abs(root, TESTS_DIR), '');
  return out.sort();
}

/** The floor per prefix (null when its file is missing or invalid, with a problem). */
export function readFloors(root) {
  const floors = {};
  const problems = [];
  for (const [prefix, rel] of Object.entries(FLOORS)) {
    floors[prefix] = null;
    const file = abs(root, rel);
    if (!existsSync(file)) {
      problems.push(`${rel}: missing`);
      continue;
    }
    const value = parseFloor(readFileSync(file, 'utf8'));
    if (value === null) problems.push(`${rel}: must be a single non-negative integer line`);
    else floors[prefix] = value;
  }
  return { floors, problems };
}

// ---------- step 5: evaluating the pg_prove output ----------

/**
 * Checks one `supabase test db --debug` run (spec §8.3 step 5).
 * @param {{ status: number|null, stdout: string, sqlFiles: string[],
 *           floors: Record<string, number|null> }} input
 * @returns {{ problems: string[], files: object[], counts: Record<string, number> }}
 */
export function evaluateTestRun({ status, stdout, sqlFiles, floors }) {
  const problems = [];
  const files = parseProve(stdout);
  if (status !== 0) problems.push(`supabase test db exited ${status}`);
  if (files.length === 0) {
    problems.push(
      'supabase test db printed no test files (pg_prove output with per-assertion TAP is required, spec §8.3 step 5)',
    );
  }

  const badNames = new Set();
  for (const name of [...sqlFiles.map(basename), ...files.map((f) => basename(f.file))]) {
    if (!PREFIXES.some((p) => name.startsWith(p))) badNames.add(name);
  }
  for (const name of badNames) {
    problems.push(`${name}: a test file name must start with catalog_ or rls_ (spec §8.3)`);
  }

  for (const f of files) {
    for (const p of f.problems) problems.push(`${basename(f.file)}: ${p}`);
  }

  // The files that ran must be exactly the .sql files under supabase/tests/ (compared by name).
  if (files.length !== sqlFiles.length) {
    problems.push(
      `supabase test db ran ${files.length} test file(s), but ${TESTS_DIR}/ has ${sqlFiles.length} .sql file(s)`,
    );
  }
  const unmatched = [...sqlFiles];
  const extra = [];
  for (const f of files) {
    const i = unmatched.findIndex((rel) => basename(rel) === basename(f.file));
    if (i === -1) extra.push(basename(f.file));
    else unmatched.splice(i, 1);
  }
  for (const rel of unmatched) problems.push(`${TESTS_DIR}/${rel}: did not run`);
  for (const name of extra)
    problems.push(`${name}: ran, but is not a .sql file under ${TESTS_DIR}/`);

  const counts = countAssertionsByPrefix(files, PREFIXES);
  for (const prefix of PREFIXES) {
    const floor = floors[prefix];
    if (floor === null || floor === undefined) continue; // reported by readFloors
    if (counts[prefix] < floor) {
      problems.push(
        `${prefix}* assertions: ${counts[prefix]} passed, below the floor of ${floor} in ${FLOORS[prefix]}`,
      );
    }
  }
  return { problems, files, counts };
}

// ---------- step 2: the lock ----------

export function lockPathFor(lockDir, projectId) {
  return path.join(lockDir, `trace-supabase-${projectId}.lock`);
}

/** The file operations the lock uses (tests inject an interleaving through them). */
const NODE_FS = Object.freeze({ readFileSync, writeFileSync, renameSync, unlinkSync });

/** @returns {{ raw: string, holder: {pid: number, checkout: string, token: string} | null } | null} */
function readLock(fs, file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  try {
    const v = JSON.parse(raw);
    if (
      Number.isSafeInteger(v?.pid) &&
      typeof v.checkout === 'string' &&
      typeof v.token === 'string'
    ) {
      return { raw, holder: { pid: v.pid, checkout: v.checkout, token: v.token } };
    }
  } catch {
    // unreadable: treated as held by an unknown run
  }
  return { raw, holder: null };
}

/** Creates the lock file only if it does not exist. */
function tryCreate(fs, file, content) {
  try {
    fs.writeFileSync(file, content, { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
}

/**
 * Removes the lock file only if it still holds exactly `raw`, never another run's fresh lock
 * (W2 database review W2-1). The file is first renamed to `aside`, a name only this run uses:
 * the rename is atomic, so when two runs take over the same stale lock only one moves it. If
 * what was moved is not `raw` (another run removed the stale lock and created its own first),
 * it is put back with an exclusive create, never over a lock a third run took meanwhile.
 * @returns {boolean} false when a moved lock could not be put back
 */
function removeIfUnchanged(fs, file, raw, aside) {
  try {
    fs.renameSync(file, aside);
  } catch (e) {
    if (e.code === 'ENOENT') return true;
    throw e;
  }
  const moved = fs.readFileSync(aside, 'utf8');
  const restored = moved === raw || tryCreate(fs, file, moved);
  try {
    fs.unlinkSync(aside);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return restored;
}

const describeHolder = (h) => `PID ${h.pid} (checkout: ${h.checkout})`;

/**
 * Takes the exclusive lock, waiting for a live holder up to `timeoutMs`.
 * @returns {Promise<{ ok: true, release: () => void } | { ok: false, message: string }>}
 */
export async function acquireLock({
  file,
  pid,
  checkout,
  now,
  sleep,
  isPidAlive,
  log,
  warn,
  timeoutMs = LOCK_TIMEOUT_MS,
  pollMs = LOCK_POLL_MS,
  fs = NODE_FS,
}) {
  const token = randomBytes(8).toString('hex');
  const content = `${JSON.stringify({ pid, checkout, token, startedAt: new Date(now()).toISOString() })}\n`;
  const aside = `${file}.${token}.aside`;
  const started = now();
  let lastSeen = null;
  for (;;) {
    if (tryCreate(fs, file, content)) {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        const cur = readLock(fs, file);
        if (cur?.holder?.token === token) removeIfUnchanged(fs, file, cur.raw, aside);
      };
      return { ok: true, release };
    }
    const cur = readLock(fs, file);
    if (cur === null) continue; // released between our attempt and the read: try again
    const { holder } = cur;
    if (holder && (holder.pid === pid || !isPidAlive(holder.pid))) {
      warn(
        holder.pid === pid
          ? `taking over the stale lock ${file}: it records this process's PID ${pid} (checkout: ${holder.checkout}), left by an earlier run`
          : `taking over the stale lock ${file}: ${describeHolder(holder)} is not running`,
      );
      if (!removeIfUnchanged(fs, file, cur.raw, aside)) {
        warn(
          `while taking over the stale lock ${file}, another run's new lock was moved aside and could not be put back ` +
            `because a third run took the lock meanwhile; those two runs may share the local stack`,
        );
      }
      continue;
    }
    const who = holder ? describeHolder(holder) : `an unreadable lock file ${file}`;
    const elapsed = now() - started;
    if (elapsed >= timeoutMs) {
      return {
        ok: false,
        message:
          `timed out after ${Math.round(timeoutMs / 60000)} minutes waiting for the local Supabase stack lock ${file}, held by ${who}. ` +
          `Let that run finish or stop it (delete the lock file only if no run is active), then run again. This check never skips.`,
      };
    }
    if (cur.raw !== lastSeen) {
      lastSeen = cur.raw;
      log(
        `the local Supabase stack is in use by ${who}; waiting up to ${Math.round(timeoutMs / 60000)} minutes for ${file}`,
      );
    }
    await sleep(Math.min(pollMs, timeoutMs - elapsed));
  }
}

const SIGNAL_EXIT_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGBREAK: 149 });

/**
 * Releases the lock on process exit and on a signal (then exits 128 + signal number).
 * @returns {() => void} removes the handlers again
 */
export function installReleaseHandlers({ proc, release, exit }) {
  const handlers = [['exit', () => release()]];
  for (const [signal, code] of Object.entries(SIGNAL_EXIT_CODES)) {
    handlers.push([
      signal,
      () => {
        release();
        exit(code);
      },
    ]);
  }
  for (const [event, fn] of handlers) proc.on(event, fn);
  return () => {
    for (const [event, fn] of handlers) proc.off(event, fn);
  };
}

// ---------- steps 1, 3, 4, 7 shared with db-types.mjs ----------

async function dockerRunning(run, root) {
  try {
    const r = await run('docker', ['info'], { cwd: root, timeoutMs: DOCKER_TIMEOUT_MS });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

/** Runs one `pnpm exec supabase …` step; returns problems (empty on success). */
async function supabaseStep(run, root, args, label) {
  const r = await run('pnpm', args, { cwd: root });
  if (r.error && r.status === null) {
    return [`could not run ${label} (${r.error.code ?? redact(r.error.message)})`];
  }
  if (r.error || r.status !== 0) {
    return [
      `${label} exited ${r.status}${r.error ? ` (${redact(r.error.message)})` : ''}; last output, redacted:`,
      ...redactedTail(r.stdout, r.stderr),
    ];
  }
  return [];
}

/**
 * Docker check, lock, start, reset, then `body()` (which returns problems); then, with `stop`,
 * `supabase stop`; the lock is always released.
 * @returns {Promise<{ docker: boolean, problems: string[] }>}
 */
export async function withLocalStack(deps, { stop = false }, body) {
  const { root, run, lockDir, now, sleep, isPidAlive, pid, proc, exit, log, warn, tool } = deps;
  if (!(await dockerRunning(run, root))) return { docker: false, problems: [] };
  let projectId;
  try {
    projectId = readProjectId(root);
  } catch (e) {
    return { docker: true, problems: [e.message] };
  }
  const file = lockPathFor(lockDir, projectId);
  let lock;
  try {
    lock = await acquireLock({
      file,
      pid,
      checkout: root,
      now,
      sleep,
      isPidAlive,
      log: (m) => log(`${tool}: ${m}`),
      warn: (m) => warn(`${tool}: warning: ${m}`),
    });
  } catch (e) {
    return { docker: true, problems: [`could not take the lock ${file}: ${e.message}`] };
  }
  if (!lock.ok) return { docker: true, problems: [lock.message] };
  const uninstall = installReleaseHandlers({ proc, release: lock.release, exit });
  const problems = [];
  try {
    log(
      `${tool}: starting the local Supabase stack (the first run pulls images; this can take minutes)`,
    );
    const started = await supabaseStep(run, root, START_ARGS, 'supabase start');
    problems.push(...started);
    if (started.length === 0) {
      log(`${tool}: resetting the local database from the migrations`);
      const reset = await supabaseStep(run, root, RESET_ARGS, 'supabase db reset');
      problems.push(...reset);
      if (reset.length === 0) problems.push(...(await body()));
    }
  } catch (e) {
    problems.push(`unexpected error: ${redact(e.message)}`);
  } finally {
    if (stop) {
      try {
        log(`${tool}: stopping the local Supabase stack (--stop)`);
        problems.push(...(await supabaseStep(run, root, STOP_ARGS, 'supabase stop')));
      } catch (e) {
        problems.push(`supabase stop failed: ${redact(e.message)}`);
      }
    }
    lock.release();
    uninstall();
  }
  return { docker: true, problems };
}

/**
 * Runs `supabase gen types typescript --local --schema public`.
 * @returns {Promise<{ bytes: Buffer|null, problems: string[] }>}
 */
export async function generateTypes(run, root) {
  const r = await run('pnpm', GEN_TYPES_ARGS, { cwd: root });
  if (r.error && r.status === null) {
    return {
      bytes: null,
      problems: [`could not run ${GEN_TYPES_COMMAND} (${r.error.code ?? 'error'})`],
    };
  }
  if (r.error || r.status !== 0) {
    // stderr is not shown even redacted: it is the CLI's error, often holding the connection.
    return {
      bytes: null,
      problems: [
        `supabase gen types exited ${r.status}; run \`pnpm exec ${GEN_TYPES_COMMAND}\` by hand to see why`,
      ],
    };
  }
  const bytes = toBuffer(r.stdout);
  if (bytes.length === 0) return { bytes: null, problems: ['supabase gen types printed nothing'] };
  return { bytes, problems: [] };
}

/** 1-based line of the first byte where two buffers differ. */
function firstDifferentLine(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  let line = 1;
  for (let k = 0; k < i; k++) if (b[k] === 0x0a) line++;
  return line;
}

/** Step 6: the drift check. Writes the CLI output to a temp file; never touches the tracked file. */
export async function checkDbTypes({ root, run, tmpDir }) {
  const { bytes, problems } = await generateTypes(run, root);
  if (!bytes) return problems;
  const dir = mkdtempSync(path.join(tmpDir, 'trace-db-types-'));
  try {
    const generated = path.join(dir, 'database.ts');
    writeFileSync(generated, bytes);
    const tracked = abs(root, DB_TYPES_FILE);
    if (!existsSync(tracked)) {
      return [`${DB_TYPES_FILE}: missing; generate it with pnpm db:types and commit it`];
    }
    const want = readFileSync(generated);
    const have = readFileSync(tracked);
    if (!want.equals(have)) {
      return [
        `${DB_TYPES_FILE}: differs from the output of ${GEN_TYPES_COMMAND} (first difference on line ${firstDifferentLine(want, have)}); regenerate it with pnpm db:types and commit it`,
      ];
    }
    return [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- CLI ----------

/** Every dependency, with the real ones as defaults (tests inject all of them). */
export function defaultDeps(overrides) {
  return {
    run: spawnRun,
    lockDir: tmpdir(),
    tmpDir: tmpdir(),
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    isPidAlive: pidAlive,
    pid: process.pid,
    proc: process,
    exit: (code) => process.exit(code),
    log: console.log,
    warn: console.error,
    error: console.error,
    ...overrides,
  };
}

/** CLI body; resolves to the exit code. */
export async function main(options) {
  const deps = { ...defaultDeps(options), tool: 'test-rls' };
  const { argv = [], root, run, tmpDir, log, error } = deps;
  if (!argv.every((a) => a === '--stop')) {
    error(USAGE);
    return 2;
  }
  const stop = argv.includes('--stop');

  let summary = null;
  const result = await withLocalStack(deps, { stop }, async () => {
    const problems = [];
    log('test-rls: running supabase test db --debug');
    const r = await run('pnpm', TEST_ARGS, { cwd: root });
    const { floors, problems: floorProblems } = readFloors(root);
    problems.push(...floorProblems);
    if (r.error && r.status === null) {
      problems.push(`could not run supabase test db (${r.error.code ?? 'error'})`);
    } else {
      // Only stdout is read; stderr can hold a connection URL and is never printed.
      const sqlFiles = listSqlFiles(root);
      const evaluation = evaluateTestRun({
        status: r.status,
        stdout: toText(r.stdout),
        sqlFiles,
        floors,
      });
      problems.push(...evaluation.problems);
      summary = { files: evaluation.files.length, counts: evaluation.counts, floors };
    }
    // AT-B8: its stdout holds only fixed messages and HTTP statuses; stderr is never printed.
    log('test-rls: running the local org sign-in test (AT-B8)');
    const auth = await run('node', AUTH_TEST_ARGS, { cwd: root });
    if (auth.status !== 0) {
      const lines = toText(auth.stdout)
        .split(/\r?\n/)
        .filter((l) => l.startsWith('test-auth-local: '))
        .map((l) => `  | ${redact(l)}`);
      problems.push(
        `the local org sign-in test failed (AT-B8${auth.error ? `, ${auth.error.code ?? 'error'}` : ''})`,
        ...lines,
      );
    }
    // M0B-DB-5: its stdout holds only fixed messages; stderr is never printed.
    log('test-rls: running the two-connection owner-demotion test (M0B-DB-5)');
    const conc = await run('node', CONCURRENCY_TEST_ARGS, { cwd: root });
    if (conc.status !== 0) {
      const lines = toText(conc.stdout)
        .split(/\r?\n/)
        .filter((l) => l.startsWith('test-concurrency-local: '))
        .map((l) => `  | ${redact(l)}`);
      problems.push(
        `the two-connection owner-demotion test failed (M0B-DB-5${conc.error ? `, ${conc.error.code ?? 'error'}` : ''})`,
        ...lines,
      );
    }
    // d1 AT-D16: only vitest's summary lines are printed (redacted); a stack could name a connection URL.
    log('test-rls: running the jobs real-database tests (d1 AT-D16)');
    const jobs = await run('pnpm', JOBS_DB_TEST_ARGS, { cwd: root });
    if (jobs.status !== 0) {
      const lines = toText(jobs.stdout)
        .split(/\r?\n/)
        .filter((l) => /^\s*(?:Test Files|Tests|FAIL)\b/.test(l))
        .map((l) => `  | ${redact(l)}`);
      problems.push(
        `the jobs real-database tests failed (d1 AT-D16${jobs.error ? `, ${jobs.error.code ?? 'error'}` : ''})`,
        ...lines,
      );
    }
    log('test-rls: checking packages/db-types against supabase gen types');
    problems.push(...(await checkDbTypes({ root, run, tmpDir })));
    return problems;
  });

  if (!result.docker) {
    error(DOCKER_MESSAGE);
    return 1;
  }
  if (result.problems.length > 0) {
    for (const p of result.problems) error(p.startsWith('  | ') ? p : `test-rls: ${p}`);
    error('test-rls: FAILED (spec §8.3)');
    return 1;
  }
  const counts = PREFIXES.map(
    (p) => `${p}* ${summary.counts[p]} assertions (floor ${summary.floors[p]})`,
  ).join(', ');
  log(`test-rls: OK: ${summary.files} test files; ${counts}; ${DB_TYPES_FILE} is current`);
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  main({ argv: process.argv.slice(2), root }).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`test-rls: ${redact(String(e?.message ?? e))}`);
      process.exitCode = 1;
    },
  );
}
