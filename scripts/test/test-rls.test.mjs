// AT-3 and AT-23 (local part): scripts/test-rls.mjs, the RLS harness (spec specs/m0-foundations.md
// §8.3, revision 11). Nothing here starts Docker, the Supabase CLI or a database: `run` is a stub,
// the clock and sleep are fake, the lock lives in a fresh temp dir (never the real
// `<os.tmpdir()>/trace-supabase-*.lock`), and signals go to a fake process. The pg_prove and
// gen-types outputs are captured from CLI 2.120.0 (fixtures/rls/). Secret-shaped strings are built
// at runtime, so nothing credential-shaped is committed.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FLOOR_FILES } from '../gen-catalog-tests.mjs';
import {
  DB_TYPES_FILE,
  DOCKER_MESSAGE,
  EXCLUDED_SERVICES,
  FLOORS,
  GEN_TYPES_ARGS,
  LOCK_TIMEOUT_MS,
  RESET_ARGS,
  START_ARGS,
  STOP_ARGS,
  SUPABASE_CONTAINERS,
  TEST_ARGS,
  acquireLock,
  evaluateTestRun,
  installReleaseHandlers,
  listSqlFiles,
  lockPathFor,
  main,
  pidAlive,
  readFloors,
  readProjectId,
  redact,
  spawnRun,
  windowsCommandLine,
} from '../test-rls.mjs';
import { cleanupTempDirs, makeTempDir, writeFiles } from './fixtures/checks/temp-repo.mjs';
import {
  GEN_TYPES,
  PROVE_FAIL_4_OF_4,
  PROVE_MISLEADING_PLAN_COMMENT,
  PROVE_PASS,
  PROVE_UNCOUNTED_NOT_OK,
  fakeClock,
  fakeProcess,
  fakeRepo,
  output,
  passingTap,
  proveOutput,
  stubRun,
} from './fixtures/rls/stubs.mjs';

afterEach(cleanupTempDirs);

const HEX = () => randomBytes(12).toString('hex');
/** A connection URL with a password, the shape the CLI's debug logs and errors can contain. */
const fakeDbUrl = () =>
  ['postgresql', '://', 'postgres', ':', `pw${HEX()}`, '@', '127.0.0.1:54322/postgres'].join('');
/** A Supabase secret key shape (gitleaks rule supabase-secret-key). */
const fakeSecretKey = () => ['sb', '_secret_', HEX(), HEX()].join('');

const ME = 4242;
const MINUTE = 60_000;

/**
 * Wires a harness run with every dependency injected.
 * `onSleep(elapsedMs, ctx)` runs after each fake sleep (ctx has lockDir and lockFile).
 */
function harness({
  root = fakeRepo(),
  responses = {},
  argv = [],
  alive = () => true,
  onSleep,
  projectId = 'trace',
} = {}) {
  const lockDir = makeTempDir('trace-rls-lock-');
  const tmpDir = makeTempDir('trace-rls-tmp-');
  const lockFile = path.join(lockDir, `trace-supabase-${projectId}.lock`);
  const ctx = { lockDir, lockFile, root };
  const stub = stubRun({ test: { stdout: PROVE_PASS }, gen: { stdout: GEN_TYPES }, ...responses });
  const clock = fakeClock({ onSleep: (elapsed) => onSleep?.(elapsed, ctx) });
  const fp = fakeProcess();
  const out = output();
  const opts = {
    argv,
    root,
    run: stub.run,
    lockDir,
    tmpDir,
    now: clock.now,
    sleep: clock.sleep,
    isPidAlive: alive,
    pid: ME,
    proc: fp.proc,
    exit: fp.exit,
    log: out.log,
    warn: out.warn,
    error: out.error,
  };
  return { ...ctx, tmpDir, opts, stub, clock, fp, out, go: () => main(opts) };
}

/** A lock file as another run writes it. */
function writeHolder(lockFile, { pid = 777, checkout = '/work/other worktree' } = {}) {
  const text = JSON.stringify({
    pid,
    checkout,
    token: HEX(),
    startedAt: '2026-10-11T00:00:00.000Z',
  });
  writeFileSync(lockFile, `${text}\n`);
  return text + '\n';
}

describe('§8.3 step 1: Docker', () => {
  it('fails with the exact message, before the lock or any supabase command, when docker info fails', async () => {
    const h = harness({ responses: { docker: { status: 1, stderr: 'error during connect' } } });
    expect(await h.go()).toBe(1);
    expect(h.out.lines.error).toContain(
      'Docker is not running — RLS tests cannot run. Start Docker Desktop. This check never skips.',
    );
    expect(DOCKER_MESSAGE).toBe(
      'Docker is not running — RLS tests cannot run. Start Docker Desktop. This check never skips.',
    );
    expect(h.stub.keys()).toEqual(['docker']);
    expect(readdirSync(h.lockDir)).toEqual([]);
  });

  it('fails the same way when docker is not installed (spawn error) or the check throws', async () => {
    const enoent = Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
    for (const docker of [
      { status: null, error: enoent },
      () => {
        throw enoent;
      },
    ]) {
      const h = harness({ responses: { docker } });
      expect(await h.go()).toBe(1);
      expect(h.out.lines.error).toContain(DOCKER_MESSAGE);
      expect(h.stub.keys()).toEqual(['docker']);
    }
  });

  it('gives docker info a timeout, so a hung engine fails instead of hanging', async () => {
    const h = harness();
    await h.go();
    expect(h.stub.calls[0].opts.timeoutMs).toBeGreaterThan(0);
  });
});

describe('project_id from supabase/config.toml', () => {
  it('reads the top-level project_id (double or single quotes, trailing comment)', () => {
    expect(readProjectId(fakeRepo({ projectId: 'trace' }))).toBe('trace');
    expect(readProjectId(fakeRepo({ config: "project_id = 'trace-b' # local\n" }))).toBe('trace-b');
  });

  it('ignores a project_id inside a table, and rejects a missing file, key or unsafe id', () => {
    expect(() => readProjectId(fakeRepo({ config: '[api]\nproject_id = "x"\n' }))).toThrow(
      /no top-level project_id/,
    );
    expect(() => readProjectId(fakeRepo({ config: null }))).toThrow(/config\.toml is missing/);
    expect(() => readProjectId(fakeRepo({ config: 'project_id = "../evil"\n' }))).toThrow(
      /not a safe file-name part/,
    );
    expect(() => readProjectId(fakeRepo({ config: 'project_id = ""\n' }))).toThrow(
      /not a safe file-name part/,
    );
  });

  it('fails the run (exit 1) without taking a lock when the project_id cannot be read', async () => {
    const h = harness({ root: fakeRepo({ config: '# no id\n' }) });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toMatch(/no top-level project_id/);
    expect(h.stub.keys()).toEqual(['docker']);
    expect(readdirSync(h.lockDir)).toEqual([]);
  });
});

describe('§8.3 step 2: the shared lock', () => {
  it('locks <lockDir>/trace-supabase-<project_id>.lock and records the PID and checkout path', async () => {
    const root = fakeRepo({ projectId: 'trace-fixture' });
    let seen = null;
    const h = harness({
      root,
      projectId: 'trace-fixture',
      responses: {
        reset: () => {
          seen = JSON.parse(readFileSync(lockPathFor(h.lockDir, 'trace-fixture'), 'utf8'));
          return {};
        },
      },
    });
    expect(h.lockFile).toBe(path.join(h.lockDir, 'trace-supabase-trace-fixture.lock'));
    expect(await h.go()).toBe(0);
    expect(seen).toMatchObject({ pid: ME, checkout: root });
    expect(existsSync(h.lockFile)).toBe(false);
  });

  it('a second concurrent run waits for a live holder, names it, then runs once it is released', async () => {
    // The holder releases 30 s before the 15-minute limit: the waiter must still be waiting.
    const releaseAt = LOCK_TIMEOUT_MS - 30_000;
    const h = harness({
      alive: (pid) => pid === 777,
      onSleep: (elapsed, ctx) => {
        if (elapsed >= releaseAt) rmSync(ctx.lockFile, { force: true });
      },
    });
    writeHolder(h.lockFile, { pid: 777, checkout: '/work/other worktree' });
    expect(await h.go()).toBe(0);
    expect(h.clock.elapsed()).toBeGreaterThanOrEqual(releaseAt);
    expect(h.clock.elapsed()).toBeLessThan(LOCK_TIMEOUT_MS);
    expect(h.out.all()).toMatch(/PID 777/);
    expect(h.out.all()).toContain('/work/other worktree');
    expect(h.stub.keys()).toEqual(['docker', 'start', 'reset', 'test', 'gen']);
    expect(existsSync(h.lockFile)).toBe(false);
  });

  it('fails after 15 minutes, naming the holder; it never skips and never touches the holder', async () => {
    const h = harness({ alive: () => true });
    const holder = writeHolder(h.lockFile, { pid: 777, checkout: '/work/other worktree' });
    expect(await h.go()).toBe(1);
    expect(LOCK_TIMEOUT_MS).toBe(15 * MINUTE);
    expect(h.clock.elapsed()).toBeGreaterThanOrEqual(15 * MINUTE);
    expect(h.clock.elapsed()).toBeLessThan(15 * MINUTE + MINUTE);
    const err = h.out.lines.error.join('\n');
    expect(err).toMatch(/15 minutes/);
    expect(err).toMatch(/PID 777/);
    expect(err).toContain('/work/other worktree');
    expect(err).toMatch(/never skips/);
    expect(h.stub.keys()).toEqual(['docker']);
    expect(readFileSync(h.lockFile, 'utf8')).toBe(holder);
  });

  it('takes over a lock whose PID is dead, with a warning', async () => {
    const h = harness({ alive: () => false });
    writeHolder(h.lockFile, { pid: 999_999, checkout: '/work/crashed run' });
    expect(await h.go()).toBe(0);
    const warn = h.out.lines.warn.join('\n');
    expect(warn).toMatch(/PID 999999/);
    expect(warn).toMatch(/not running/);
    expect(warn).toContain('/work/crashed run');
    expect(h.clock.sleeps).toEqual([]);
    expect(existsSync(h.lockFile)).toBe(false);
  });

  it('treats an unreadable lock file as held: it waits, names the file on timeout and never deletes it', async () => {
    const h = harness({ alive: () => false });
    writeFileSync(h.lockFile, 'not json');
    expect(await h.go()).toBe(1);
    expect(h.out.lines.error.join('\n')).toContain(h.lockFile);
    expect(readFileSync(h.lockFile, 'utf8')).toBe('not json');
  });

  it('releases the lock after a passing run and after a failing one', async () => {
    const pass = harness();
    expect(await pass.go()).toBe(0);
    expect(existsSync(pass.lockFile)).toBe(false);

    const fail = harness({ responses: { test: { status: 1, stdout: PROVE_FAIL_4_OF_4 } } });
    expect(await fail.go()).toBe(1);
    expect(existsSync(fail.lockFile)).toBe(false);
  });

  it('releases the lock when a step throws', async () => {
    const h = harness({
      responses: {
        reset: () => {
          throw new Error('synthetic failure');
        },
      },
    });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toMatch(/synthetic failure/);
    expect(existsSync(h.lockFile)).toBe(false);
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ])('releases the lock on %s and exits %i', async (signal, code) => {
    let heldBefore = null;
    let heldAfter = null;
    const h = harness({
      responses: {
        reset: () => {
          heldBefore = existsSync(h.lockFile);
          h.fp.proc.emit(signal);
          heldAfter = existsSync(h.lockFile);
          return {};
        },
      },
    });
    await h.go();
    expect(heldBefore).toBe(true);
    expect(heldAfter).toBe(false);
    expect(h.fp.exits).toEqual([code]);
  });

  it('releases the lock on process exit, and removes its handlers after the run', async () => {
    let heldAfter = null;
    const h = harness({
      responses: {
        test: () => {
          h.fp.proc.emit('exit', 1);
          heldAfter = existsSync(h.lockFile);
          return { stdout: PROVE_PASS };
        },
      },
    });
    await h.go();
    expect(heldAfter).toBe(false);
    for (const event of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
      expect(h.fp.proc.listenerCount(event)).toBe(0);
    }
  });

  it('acquireLock: release is idempotent and never deletes a lock another run holds', async () => {
    const dir = makeTempDir('trace-rls-lock-');
    const file = lockPathFor(dir, 'trace');
    const clock = fakeClock();
    const lock = await acquireLock({
      file,
      pid: ME,
      checkout: '/work/me',
      now: clock.now,
      sleep: clock.sleep,
      isPidAlive: () => true,
      log: () => {},
      warn: () => {},
    });
    expect(lock.ok).toBe(true);
    const other = writeHolder(file, { pid: 778 });
    lock.release();
    lock.release();
    expect(readFileSync(file, 'utf8')).toBe(other);
  });

  it('acquireLock: a lock recording this very PID is stale (left by an earlier process)', async () => {
    const dir = makeTempDir('trace-rls-lock-');
    const file = lockPathFor(dir, 'trace');
    writeHolder(file, { pid: ME });
    const clock = fakeClock();
    const warns = [];
    const lock = await acquireLock({
      file,
      pid: ME,
      checkout: '/work/me',
      now: clock.now,
      sleep: clock.sleep,
      isPidAlive: () => true,
      log: () => {},
      warn: (m) => warns.push(m),
    });
    expect(lock.ok).toBe(true);
    expect(warns.join('\n')).toMatch(/PID 4242/);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ pid: ME, checkout: '/work/me' });
    lock.release();
    expect(existsSync(file)).toBe(false);
  });

  // W2 database review W2-1: two runs taking over the same stale lock at once. The interleaving
  // is injected through acquireLock's `fs`: another run does its whole takeover after this run
  // read the stale lock and before this run removes it.
  const DEAD = 999_999;
  const lockOpts = (file, clock, extra) => ({
    file,
    checkout: '/work/me',
    now: clock.now,
    sleep: clock.sleep,
    isPidAlive: (p) => p !== DEAD,
    log: () => {},
    warn: () => {},
    ...extra,
  });
  /** Real fs ops; `beforeRemove` runs before, `afterRemove` after, this run first moves or deletes the lock file. */
  const interleavedFs = (file, { beforeRemove = () => {}, afterRemove = () => {} }) => ({
    readFileSync,
    writeFileSync,
    unlinkSync: (p) => {
      if (p === file) beforeRemove();
      unlinkSync(p);
      if (p === file) afterRemove();
    },
    renameSync: (from, to) => {
      if (from === file) beforeRemove();
      renameSync(from, to);
      if (from === file) afterRemove();
    },
  });

  it('acquireLock: when another run takes over the same stale lock first, this run waits and never deletes its fresh lock (W2-1)', async () => {
    const dir = makeTempDir('trace-rls-lock-');
    const file = lockPathFor(dir, 'trace');
    writeHolder(file, { pid: DEAD, checkout: '/work/crashed run' });
    const clock = fakeClock();
    let other = null;
    const fs = interleavedFs(file, {
      beforeRemove: () => {
        other ??= acquireLock(lockOpts(file, clock, { pid: 5151, checkout: '/work/b' }));
      },
    });
    const holderWhileWaiting = [];
    const mine = await acquireLock(
      lockOpts(file, clock, {
        pid: ME,
        fs,
        sleep: async () => {
          const b = await other;
          holderWhileWaiting.push(JSON.parse(readFileSync(file, 'utf8')).pid);
          b.release();
        },
      }),
    );
    expect(other).not.toBeNull();
    expect((await other).ok).toBe(true);
    expect(holderWhileWaiting).toEqual([5151]);
    expect(mine.ok).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ pid: ME });
    mine.release();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('acquireLock: a fresh lock moved aside by mistake is put back, never over a newer lock (W2-1)', async () => {
    const dir = makeTempDir('trace-rls-lock-');
    const file = lockPathFor(dir, 'trace');
    writeHolder(file, { pid: DEAD, checkout: '/work/crashed run' });
    const clock = fakeClock();
    let second = null;
    let third = null;
    const fs = interleavedFs(file, {
      beforeRemove: () => {
        second ??= acquireLock(lockOpts(file, clock, { pid: 5151, checkout: '/work/b' }));
      },
      afterRemove: () => {
        third ??= acquireLock(lockOpts(file, clock, { pid: 5252, checkout: '/work/c' }));
      },
    });
    const warns = [];
    const holderWhileWaiting = [];
    const mine = await acquireLock(
      lockOpts(file, clock, {
        pid: ME,
        fs,
        warn: (m) => warns.push(m),
        sleep: async () => {
          const c = await third;
          holderWhileWaiting.push(JSON.parse(readFileSync(file, 'utf8')).pid);
          c.release();
        },
      }),
    );
    expect((await second).ok).toBe(true);
    expect((await third).ok).toBe(true);
    expect(holderWhileWaiting).toEqual([5252]);
    expect(warns.join('\n')).toMatch(/could not be put back/);
    expect(mine.ok).toBe(true);
    (await second).release();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ pid: ME });
    mine.release();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('installReleaseHandlers: uninstall removes every handler it added', () => {
    const fp = fakeProcess();
    const uninstall = installReleaseHandlers({ proc: fp.proc, release: () => {}, exit: fp.exit });
    expect(fp.proc.listenerCount('SIGINT')).toBe(1);
    uninstall();
    expect(fp.proc.eventNames()).toEqual([]);
  });
});

describe('§8.3 steps 3–4: start and reset', () => {
  it('starts the stack without the services M0a does not need (auth stays on), then resets it', async () => {
    const h = harness();
    expect(await h.go()).toBe(0);
    expect(h.stub.keys()).toEqual(['docker', 'start', 'reset', 'test', 'gen']);
    const [, start, reset] = h.stub.calls;
    expect(start.line).toBe(`pnpm ${START_ARGS.join(' ')}`);
    expect(START_ARGS).toEqual(['exec', 'supabase', 'start', '-x', EXCLUDED_SERVICES.join(',')]);
    expect(EXCLUDED_SERVICES).not.toContain('gotrue');
    for (const name of EXCLUDED_SERVICES) expect(SUPABASE_CONTAINERS).toContain(name);
    expect(new Set(EXCLUDED_SERVICES).size).toBe(EXCLUDED_SERVICES.length);
    expect(reset.line).toBe(`pnpm ${RESET_ARGS.join(' ')}`);
    expect(RESET_ARGS.slice(0, 4)).toEqual(['exec', 'supabase', 'db', 'reset']);
    for (const c of h.stub.calls) expect(c.opts.cwd).toBe(h.root);
  });

  it('stops at a failed start: no reset, no tests; prints a redacted tail, never the URL or key', async () => {
    const url = fakeDbUrl();
    const key = fakeSecretKey();
    const h = harness({
      responses: { start: { status: 1, stdout: `DB URL: ${url}`, stderr: `boom\nkey ${key}\n` } },
    });
    expect(await h.go()).toBe(1);
    expect(h.stub.keys()).toEqual(['docker', 'start']);
    const all = h.out.all();
    expect(all).toMatch(/supabase start exited 1/);
    expect(all).toMatch(/boom/);
    expect(all).not.toContain(url);
    expect(all).not.toContain(key);
    expect(all).not.toContain(url.split('@')[0].split(':').pop());
    expect(existsSync(h.lockFile)).toBe(false);
  });

  it('stops at a failed reset: no tests', async () => {
    const h = harness({ responses: { reset: { status: 1, stderr: 'migration failed\n' } } });
    expect(await h.go()).toBe(1);
    expect(h.stub.keys()).toEqual(['docker', 'start', 'reset']);
    expect(h.out.all()).toMatch(/supabase db reset exited 1/);
  });
});

describe('§8.3 step 5: supabase test db --debug', () => {
  it('runs test db with --debug and passes on the captured passing output', async () => {
    const h = harness();
    expect(await h.go()).toBe(0);
    expect(TEST_ARGS).toContain('--debug');
    expect(TEST_ARGS.slice(0, 4)).toEqual(['exec', 'supabase', 'test', 'db']);
    expect(h.stub.calls[3].line).toBe(`pnpm ${TEST_ARGS.join(' ')}`);
    expect(h.out.lines.log.join('\n')).toMatch(/OK/);
    expect(h.out.lines.log.join('\n')).toMatch(/catalog_\* 4/);
  });

  it('never echoes the stderr of test db, on a pass or a failure', async () => {
    for (const status of [0, 1]) {
      const url = fakeDbUrl();
      const stdout = status === 0 ? PROVE_PASS : PROVE_FAIL_4_OF_4;
      const h = harness({ responses: { test: { status, stdout, stderr: `debug: ${url}\n` } } });
      await h.go();
      expect(h.out.all()).not.toContain(url);
      expect(h.out.all()).not.toContain('debug:');
    }
  });

  it('parses TAP from stdout only: TAP-looking lines on stderr never change the result', async () => {
    const noise = proveOutput([{ name: 'rls_ghost.test.sql', tap: ['1..1', 'not ok 1 - ghost'] }]);
    const h = harness({ responses: { test: { stdout: PROVE_PASS, stderr: noise } } });
    expect(await h.go()).toBe(0);
    expect(h.out.all()).not.toContain('ghost');
  });

  // pgTAP's own counters are rolled back by each `rollback to savepoint mt` in catalog_meta, so its
  // finish()/num_failed() diagnostics are wrong. The harness counts `ok N` / `not ok N` lines itself
  // against the `1..N` plan and never reads or requires those diagnostics (lead, W3b finding).
  it('passes when every line matches the plan despite a misleading "# Looks like you planned" comment', async () => {
    expect(PROVE_MISLEADING_PLAN_COMMENT).toContain('# Looks like you planned 67 tests but ran 64');
    const h = harness({
      root: fakeRepo({ tests: { 'catalog_meta.test.sql': '--\n' }, catalogFloor: '67\n' }),
      responses: { test: { stdout: PROVE_MISLEADING_PLAN_COMMENT } },
    });
    expect(await h.go()).toBe(0);
    expect(h.out.lines.log.join('\n')).toMatch(/catalog_\* 67 assertions \(floor 67\)/);
    expect(h.out.all()).not.toMatch(/Looks like/);
  });

  it('fails on a not ok line that the trailing pgTAP diagnostic does not count, even with exit 0', async () => {
    expect(PROVE_UNCOUNTED_NOT_OK).not.toMatch(/Looks like you failed/);
    for (const status of [1, 0]) {
      const h = harness({
        root: fakeRepo({ tests: { 'catalog_meta.test.sql': '--\n' }, catalogFloor: '5\n' }),
        responses: { test: { status, stdout: PROVE_UNCOUNTED_NOT_OK } },
      });
      expect(await h.go()).toBe(1);
      expect(h.out.all()).toContain(
        'catalog_meta.test.sql: not ok 5 - MT-12.global_entry_grants_public: fires',
      );
    }
  });

  it('fails when the counted lines miss the plan, whatever the pgTAP comments claim', async () => {
    const short = PROVE_MISLEADING_PLAN_COMMENT.replace(/^ok 67 - .*\n/m, '').replace(
      '# Looks like you planned 67 tests but ran 64',
      '# all 67 tests ran',
    );
    const h = harness({
      root: fakeRepo({ tests: { 'catalog_meta.test.sql': '--\n' }, catalogFloor: '66\n' }),
      responses: { test: { stdout: short } },
    });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toContain('catalog_meta.test.sql: plan says 67 tests but 66 ran');
  });

  it('fails on the captured 4-of-4 failure, listing every not ok', async () => {
    const h = harness({
      root: fakeRepo({ tests: { 'zz_mutation.test.sql': '-- synthetic\n' } }),
      responses: { test: { status: 1, stdout: PROVE_FAIL_4_OF_4 } },
    });
    expect(await h.go()).toBe(1);
    const err = h.out.lines.error.join('\n');
    for (const n of [1, 2, 3, 4])
      expect(err).toContain(`zz_mutation.test.sql: not ok ${n} - MT-4b`);
  });

  it('fails on a single not ok in a correctly named file', async () => {
    const tap = ['1..2', 'ok 1 - a', 'not ok 2 - b'];
    const h = harness({
      responses: {
        test: { status: 1, stdout: proveOutput([{ name: 'catalog_probe.test.sql', tap }]) },
      },
      root: fakeRepo({ catalogFloor: '1\n' }),
    });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toContain('catalog_probe.test.sql: not ok 2 - b');
  });

  it('fails on a plan mismatch', async () => {
    const tap = ['1..3', 'ok 1 - a', 'ok 2 - b'];
    const h = harness({
      responses: { test: { stdout: proveOutput([{ name: 'catalog_probe.test.sql', tap }]) } },
      root: fakeRepo({ catalogFloor: '2\n' }),
    });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toContain('catalog_probe.test.sql: plan says 3 tests but 2 ran');
  });

  it('fails on a file with zero tests', async () => {
    const files = [
      { name: 'catalog_probe.test.sql', tap: passingTap(4) },
      { name: 'rls_empty.test.sql', tap: ['1..0'] },
    ];
    const h = harness({
      root: fakeRepo({ tests: { 'catalog_probe.test.sql': '--\n', 'rls_empty.test.sql': '--\n' } }),
      responses: { test: { stdout: proveOutput(files) } },
    });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toContain('rls_empty.test.sql: no tests');
  });

  it('fails on a test file not named catalog_* or rls_*', async () => {
    const files = [
      { name: 'catalog_probe.test.sql', tap: passingTap(4) },
      { name: 'misc.test.sql', tap: passingTap(1) },
    ];
    const h = harness({
      root: fakeRepo({ tests: { 'catalog_probe.test.sql': '--\n', 'misc.test.sql': '--\n' } }),
      responses: { test: { stdout: proveOutput(files) } },
    });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toMatch(/misc\.test\.sql: .*catalog_ or rls_/);
  });

  it('fails when the files run differ in number from the .sql files under supabase/tests/ (sub-directories count)', async () => {
    const root = fakeRepo({
      tests: { 'catalog_probe.test.sql': '--\n', 'sub/rls_extra.test.sql': '--\n' },
    });
    expect(listSqlFiles(root)).toEqual(['catalog_probe.test.sql', 'sub/rls_extra.test.sql']);
    const h = harness({ root });
    expect(await h.go()).toBe(1);
    const err = h.out.lines.error.join('\n');
    expect(err).toMatch(/ran 1 test file.*supabase\/tests\/ has 2/);
    expect(err).toContain('sub/rls_extra.test.sql');
  });

  it('ignores files under supabase/tests/ that are not .sql (the floor files)', () => {
    const root = fakeRepo();
    expect(listSqlFiles(root)).toEqual(['catalog_probe.test.sql']);
  });

  it('fails when test db exits non-zero even if the TAP looks clean', async () => {
    const h = harness({ responses: { test: { status: 3, stdout: PROVE_PASS } } });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toMatch(/supabase test db exited 3/);
  });

  it('fails when test db cannot be started at all', async () => {
    const enoent = Object.assign(new Error('spawn pnpm ENOENT'), { code: 'ENOENT' });
    const h = harness({ responses: { test: { status: null, error: enoent } } });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toMatch(/could not run supabase test db/);
  });

  it('fails when the output has no per-assertion TAP (pg_prove without --debug)', async () => {
    const quiet = `/work/trace checkout/supabase/tests/catalog_probe.test.sql .. ok\nAll tests successful.\nResult: PASS\n`;
    const h = harness({ responses: { test: { stdout: quiet } } });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toContain('catalog_probe.test.sql: no tests');
  });

  it('fails when nothing ran at all', async () => {
    const h = harness({ responses: { test: { stdout: '' } } });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toMatch(/no test files/);
  });

  it('fails when catalog_* assertions are below catalog-min-count', async () => {
    const h = harness({ root: fakeRepo({ catalogFloor: '71\n' }) });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toMatch(/catalog_\* assertions: 4 passed, below the floor of 71/);
  });

  it('fails when rls_* assertions are below rls-min-count: catalog assertions never count toward it', async () => {
    const files = [{ name: 'catalog_meta.test.sql', tap: passingTap(80) }];
    const h = harness({
      root: fakeRepo({ tests: { 'catalog_meta.test.sql': '--\n' }, rlsFloor: '50\n' }),
      responses: { test: { stdout: proveOutput(files) } },
    });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toMatch(/rls_\* assertions: 0 passed, below the floor of 50/);
  });

  it('passes when both floors are met exactly', async () => {
    const files = [
      { name: 'catalog_meta.test.sql', tap: passingTap(3) },
      { name: 'rls_orgs.test.sql', tap: passingTap(2) },
    ];
    const h = harness({
      root: fakeRepo({
        tests: { 'catalog_meta.test.sql': '--\n', 'rls_orgs.test.sql': '--\n' },
        catalogFloor: '3\n',
        rlsFloor: '2\n',
      }),
      responses: { test: { stdout: proveOutput(files) } },
    });
    expect(await h.go()).toBe(0);
    expect(h.out.lines.log.join('\n')).toMatch(/catalog_\* 3 .*floor 3.*rls_\* 2 .*floor 2/);
  });

  it('fails when a floor file is missing or is not a single integer', async () => {
    const missing = harness({ root: fakeRepo({ rlsFloor: null }) });
    expect(await missing.go()).toBe(1);
    expect(missing.out.all()).toContain('supabase/tests/rls-min-count: missing');

    const bad = harness({ root: fakeRepo({ catalogFloor: '4 assertions\n' }) });
    expect(await bad.go()).toBe(1);
    expect(bad.out.all()).toContain(
      'supabase/tests/catalog-min-count: must be a single non-negative integer line',
    );
  });

  it('uses the same floor files as gen-catalog-tests (which enforces that floors only go up)', () => {
    expect(Object.values(FLOORS)).toEqual([...FLOOR_FILES]);
    expect(Object.keys(FLOORS)).toEqual(['catalog_', 'rls_']);
    expect(readFloors(fakeRepo({ catalogFloor: '71\n', rlsFloor: '0\n' }))).toEqual({
      floors: { catalog_: 71, rls_: 0 },
      problems: [],
    });
  });

  it('evaluateTestRun: counts only passing assertions, by file prefix', () => {
    const stdout = proveOutput([
      { name: 'catalog_meta.test.sql', tap: passingTap(5) },
      { name: 'rls_a.test.sql', tap: ['1..2', 'ok 1', 'ok 2 # TODO later'] },
    ]);
    const r = evaluateTestRun({
      status: 0,
      stdout,
      sqlFiles: ['catalog_meta.test.sql', 'rls_a.test.sql'],
      floors: { catalog_: 5, rls_: 2 },
    });
    expect(r.counts).toEqual({ catalog_: 5, rls_: 1 });
    expect(r.problems).toContain('rls_a.test.sql: todo 2 (later)');
    expect(r.problems.join('\n')).toMatch(/rls_\* assertions: 1 passed, below the floor of 2/);
  });

  it('evaluateTestRun: a file that ran but is not under supabase/tests/ fails even when the count matches', () => {
    const stdout = proveOutput([{ name: 'catalog_other.test.sql', tap: passingTap(1) }]);
    const r = evaluateTestRun({
      status: 0,
      stdout,
      sqlFiles: ['catalog_meta.test.sql'],
      floors: { catalog_: 0, rls_: 0 },
    });
    expect(r.problems.join('\n')).toMatch(/catalog_other\.test\.sql/);
    expect(r.problems.join('\n')).toMatch(/catalog_meta\.test\.sql/);
  });
});

describe('§8.3 step 6: db-types drift', () => {
  it('passes when the gen types output is byte-identical to the tracked file', async () => {
    const h = harness();
    expect(await h.go()).toBe(0);
    expect(GEN_TYPES_ARGS).toEqual([
      'exec',
      'supabase',
      'gen',
      'types',
      'typescript',
      '--local',
      '--schema',
      'public',
    ]);
    expect(h.stub.calls[4].line).toBe(`pnpm ${GEN_TYPES_ARGS.join(' ')}`);
    expect(DB_TYPES_FILE).toBe('packages/db-types/src/database.ts');
  });

  it('fails when the tracked file differs, and never overwrites it', async () => {
    const stale = Buffer.concat([GEN_TYPES, Buffer.from('// hand edit\n')]);
    const root = fakeRepo({ dbTypes: stale });
    const h = harness({ root });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toMatch(/packages\/db-types\/src\/database\.ts: differs/);
    expect(h.out.all()).toMatch(/pnpm db:types/);
    expect(readFileSync(path.join(root, DB_TYPES_FILE)).equals(stale)).toBe(true);
  });

  it('is byte-exact: CRLF endings or a missing final newline count as drift', async () => {
    const crlf = Buffer.from(GEN_TYPES.toString('utf8').replace(/\n/g, '\r\n'));
    const noFinalNewline = GEN_TYPES.subarray(0, GEN_TYPES.length - 1);
    for (const dbTypes of [crlf, noFinalNewline]) {
      const h = harness({ root: fakeRepo({ dbTypes }) });
      expect(await h.go()).toBe(1);
      expect(h.out.all()).toMatch(/database\.ts: differs/);
    }
  });

  it('names the first differing line', async () => {
    const lines = GEN_TYPES.toString('utf8').split('\n');
    lines[3] = 'export type Database = { changed: true }';
    const h = harness({ root: fakeRepo({ dbTypes: lines.join('\n') }) });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toMatch(/line 4/);
  });

  it('fails when the tracked file is missing, and does not create it', async () => {
    const root = fakeRepo({ dbTypes: null });
    const h = harness({ root });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toMatch(/database\.ts: missing/);
    expect(existsSync(path.join(root, DB_TYPES_FILE))).toBe(false);
  });

  it('fails when gen types fails or prints nothing, without echoing raw stderr', async () => {
    const url = fakeDbUrl();
    const failed = harness({ responses: { gen: { status: 1, stderr: `connect ${url}\n` } } });
    expect(await failed.go()).toBe(1);
    expect(failed.out.all()).toMatch(/supabase gen types exited 1/);
    expect(failed.out.all()).not.toContain(url);

    const empty = harness({ responses: { gen: { stdout: '' } } });
    expect(await empty.go()).toBe(1);
    expect(empty.out.all()).toMatch(/supabase gen types printed nothing/);
  });

  it('writes the output to a temp file under the injected tmp dir and removes it', async () => {
    const h = harness();
    expect(await h.go()).toBe(0);
    expect(readdirSync(h.tmpDir)).toEqual([]);
  });

  it('accepts the CLI output as a string or as bytes', async () => {
    const h = harness({ responses: { gen: { stdout: GEN_TYPES.toString('utf8') } } });
    expect(await h.go()).toBe(0);
  });

  it('still runs when test db fails, so both problems are reported', async () => {
    const root = fakeRepo({ dbTypes: 'stale\n' });
    const h = harness({ root, responses: { test: { status: 1, stdout: '' } } });
    expect(await h.go()).toBe(1);
    expect(h.stub.keys()).toEqual(['docker', 'start', 'reset', 'test', 'gen']);
    expect(h.out.all()).toMatch(/supabase test db exited 1/);
    expect(h.out.all()).toMatch(/database\.ts: differs/);
  });
});

describe('--stop (CI)', () => {
  it('stops the stack after the checks, while still holding the lock', async () => {
    let heldDuringStop = null;
    const h = harness({
      argv: ['--stop'],
      responses: {
        stop: () => {
          heldDuringStop = existsSync(h.lockFile);
          return {};
        },
      },
    });
    expect(await h.go()).toBe(0);
    expect(h.stub.keys()).toEqual(['docker', 'start', 'reset', 'test', 'gen', 'stop']);
    expect(h.stub.calls[5].line).toBe(`pnpm ${STOP_ARGS.join(' ')}`);
    expect(heldDuringStop).toBe(true);
    expect(existsSync(h.lockFile)).toBe(false);
  });

  it('leaves the stack running without --stop', async () => {
    const h = harness();
    await h.go();
    expect(h.stub.keys()).not.toContain('stop');
  });

  it('stops even when the run fails', async () => {
    const h = harness({ argv: ['--stop'], responses: { start: { status: 1 } } });
    expect(await h.go()).toBe(1);
    expect(h.stub.keys()).toEqual(['docker', 'start', 'stop']);
  });

  it('never stops a stack it could not lock', async () => {
    const h = harness({ argv: ['--stop'], alive: () => true });
    writeHolder(h.lockFile);
    expect(await h.go()).toBe(1);
    expect(h.stub.keys()).toEqual(['docker']);
  });

  it('fails the run when the stop fails', async () => {
    const h = harness({ argv: ['--stop'], responses: { stop: { status: 1 } } });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toMatch(/supabase stop exited 1/);
    expect(existsSync(h.lockFile)).toBe(false);
  });
});

describe('CLI and helpers', () => {
  it('rejects an unknown argument with usage (exit 2) and runs nothing', async () => {
    const h = harness({ argv: ['--skip'] });
    expect(await h.go()).toBe(2);
    expect(h.out.lines.error.join('\n')).toMatch(/usage: node scripts\/test-rls\.mjs \[--stop\]/);
    expect(h.stub.calls).toEqual([]);
  });

  it('redact() removes URL credentials, Supabase keys, JWTs and long hex keys', () => {
    const url = fakeDbUrl();
    const key = fakeSecretKey();
    const jwt = ['eyJ', HEX(), '.', 'eyJ', HEX(), '.', HEX()].join('');
    const hex = randomBytes(32).toString('hex');
    const text = redact(`a ${url}\nb ${key}\nc ${jwt}\nS3 Secret Key: ${hex}\n`);
    for (const s of [url.split('@')[0], key, jwt, hex]) expect(text).not.toContain(s);
    expect(text).toContain('127.0.0.1:54322/postgres');
  });

  it('windowsCommandLine() joins safe arguments (commas allowed) and rejects shell metacharacters', () => {
    expect(windowsCommandLine('pnpm', START_ARGS)).toBe(`pnpm ${START_ARGS.join(' ')}`);
    for (const bad of ['a b', 'a&b', 'a"b', 'a|b', '%PATH%', 'a^b', 'a>b']) {
      expect(() => windowsCommandLine('pnpm', ['exec', bad])).toThrow(/unsafe/);
    }
  });

  it('spawnRun() captures stdout and stderr as bytes, with the exit status', async () => {
    const r = await spawnRun(process.execPath, [
      '-e',
      'process.stdout.write("out\\n"); process.stderr.write("err\\n"); process.exit(3)',
    ]);
    expect(r.status).toBe(3);
    expect(Buffer.isBuffer(r.stdout)).toBe(true);
    expect(r.stdout.toString()).toBe('out\n');
    expect(r.stderr.toString()).toBe('err\n');
    expect(r.error).toBe(null);
  });

  it('spawnRun() reports a missing program as an error instead of throwing', async () => {
    const r = await spawnRun(`trace-no-such-program-${HEX()}`, []);
    expect(r.status).toBe(null);
    expect(r.error).toBeInstanceOf(Error);
  });

  it('spawnRun() kills a command that outlives its timeout', async () => {
    const r = await spawnRun(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      timeoutMs: 300,
    });
    expect(r.error?.message).toMatch(/timed out/);
  });

  it('pidAlive() is true for this process and false for one that has exited', () => {
    expect(pidAlive(process.pid)).toBe(true);
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
      encoding: 'utf8',
    });
    expect(pidAlive(Number(child.stdout))).toBe(false);
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-1)).toBe(false);
  });

  it('keeps a bad tests directory from crashing: a missing supabase/tests/ lists no files', () => {
    const root = makeTempDir('trace-rls-repo-');
    writeFiles(root, { 'supabase/config.toml': 'project_id = "trace"\n' });
    expect(listSqlFiles(root)).toEqual([]);
  });
});
