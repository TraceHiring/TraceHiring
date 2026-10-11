// scripts/db-types.mjs (`pnpm db:types`, spec specs/m0-foundations.md §8.2, §8.3 step 6): regenerates
// packages/db-types/src/database.ts from `supabase gen types typescript --local --schema public`,
// byte for byte. Same injection as the harness tests: a stub `run` (no Docker, no CLI, no database),
// a fake clock, a lock dir under a fresh temp dir and a fake process. Synthetic data only; secret-
// shaped strings are built at runtime.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DOCKER_MESSAGE as DB_TYPES_DOCKER_MESSAGE, main } from '../db-types.mjs';
import {
  DB_TYPES_FILE,
  GEN_TYPES_ARGS,
  RESET_ARGS,
  START_ARGS,
  main as testRls,
} from '../test-rls.mjs';
import { cleanupTempDirs, makeTempDir } from './fixtures/checks/temp-repo.mjs';
import {
  GEN_TYPES,
  PROVE_PASS,
  fakeClock,
  fakeProcess,
  fakeRepo,
  output,
  stubRun,
} from './fixtures/rls/stubs.mjs';

afterEach(cleanupTempDirs);

const ME = 4242;
const fakeDbUrl = () =>
  [
    'postgresql',
    '://',
    'postgres',
    ':',
    `pw${randomBytes(8).toString('hex')}`,
    '@',
    '127.0.0.1:54322/postgres',
  ].join('');

function harness({
  root = fakeRepo({ dbTypes: 'stale\n' }),
  responses = {},
  argv = [],
  alive,
} = {}) {
  const lockDir = makeTempDir('trace-rls-lock-');
  const lockFile = path.join(lockDir, 'trace-supabase-trace.lock');
  const stub = stubRun({ gen: { stdout: GEN_TYPES }, ...responses });
  const clock = fakeClock();
  const fp = fakeProcess();
  const out = output();
  const opts = {
    argv,
    root,
    run: stub.run,
    lockDir,
    tmpDir: makeTempDir('trace-rls-tmp-'),
    now: clock.now,
    sleep: clock.sleep,
    isPidAlive: alive ?? (() => true),
    pid: ME,
    proc: fp.proc,
    exit: fp.exit,
    log: out.log,
    warn: out.warn,
    error: out.error,
  };
  const tracked = () => {
    const file = path.join(root, DB_TYPES_FILE);
    return existsSync(file) ? readFileSync(file) : null;
  };
  return { root, lockDir, lockFile, stub, clock, fp, out, opts, tracked, go: () => main(opts) };
}

describe('db-types: regenerate packages/db-types/src/database.ts', () => {
  it('writes the gen types output byte for byte, after start and reset', async () => {
    const h = harness();
    expect(await h.go()).toBe(0);
    expect(h.tracked().equals(GEN_TYPES)).toBe(true);
    expect(h.stub.keys()).toEqual(['docker', 'start', 'reset', 'gen']);
    expect(h.stub.calls[1].line).toBe(`pnpm ${START_ARGS.join(' ')}`);
    expect(h.stub.calls[2].line).toBe(`pnpm ${RESET_ARGS.join(' ')}`);
    expect(h.stub.calls[3].line).toBe(`pnpm ${GEN_TYPES_ARGS.join(' ')}`);
    expect(h.stub.calls[3].line).toBe(
      'pnpm exec supabase gen types typescript --local --schema public',
    );
    expect(h.out.lines.log.join('\n')).toMatch(/wrote packages\/db-types\/src\/database\.ts/);
  });

  it('writes the output unformatted: CRLF, trailing spaces and no final newline are kept', async () => {
    const odd = Buffer.from('export type Database = {}\r\n  \r\nexport type Json = string  ');
    for (const stdout of [odd, odd.toString('utf8')]) {
      const h = harness({ responses: { gen: { stdout } } });
      expect(await h.go()).toBe(0);
      expect(h.tracked().equals(odd)).toBe(true);
    }
  });

  it('creates the file when it is missing', async () => {
    const h = harness({ root: fakeRepo({ dbTypes: null }) });
    expect(await h.go()).toBe(0);
    expect(h.tracked().equals(GEN_TYPES)).toBe(true);
  });

  it('says when the file was already current', async () => {
    const h = harness({ root: fakeRepo({ dbTypes: GEN_TYPES }) });
    expect(await h.go()).toBe(0);
    expect(h.out.lines.log.join('\n')).toMatch(/unchanged/);
  });

  it('produces exactly what the test-rls drift check expects', async () => {
    const h = harness();
    expect(await h.go()).toBe(0);
    const out = output();
    const stub = stubRun({ test: { stdout: PROVE_PASS }, gen: { stdout: GEN_TYPES } });
    const clock = fakeClock();
    const fp = fakeProcess();
    const code = await testRls({
      ...h.opts,
      run: stub.run,
      now: clock.now,
      sleep: clock.sleep,
      proc: fp.proc,
      exit: fp.exit,
      log: out.log,
      warn: out.warn,
      error: out.error,
    });
    expect(out.all()).not.toMatch(/database\.ts: (differs|missing)/);
    expect(code).toBe(0);
  });
});

describe('db-types: failures never touch the tracked file', () => {
  it.each([
    ['gen types exits non-zero', { status: 1, stderr: 'boom\n' }, /supabase gen types exited 1/],
    ['gen types prints nothing', { stdout: '' }, /supabase gen types printed nothing/],
    [
      'gen types cannot start',
      { status: null, error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) },
      /could not run supabase gen types/,
    ],
  ])('%s: exit 1, file unchanged', async (_label, gen, message) => {
    const h = harness({ responses: { gen } });
    const before = h.tracked();
    expect(await h.go()).toBe(1);
    expect(h.out.all()).toMatch(message);
    expect(h.tracked().equals(before)).toBe(true);
  });

  it('never echoes the stderr of gen types', async () => {
    const url = fakeDbUrl();
    const h = harness({ responses: { gen: { status: 1, stderr: `connect ${url}\n` } } });
    expect(await h.go()).toBe(1);
    expect(h.out.all()).not.toContain(url);
  });

  it('a failed reset stops before gen types', async () => {
    const h = harness({ responses: { reset: { status: 1 } } });
    const before = h.tracked();
    expect(await h.go()).toBe(1);
    expect(h.stub.keys()).toEqual(['docker', 'start', 'reset']);
    expect(h.tracked().equals(before)).toBe(true);
  });

  it('Docker down: exit 1 with a message, no lock, nothing written', async () => {
    const h = harness({ responses: { docker: { status: 1 } } });
    const before = h.tracked();
    expect(await h.go()).toBe(1);
    expect(h.out.lines.error).toContain(DB_TYPES_DOCKER_MESSAGE);
    expect(DB_TYPES_DOCKER_MESSAGE).toMatch(/^Docker is not running/);
    expect(h.stub.keys()).toEqual(['docker']);
    expect(readdirSync(h.lockDir)).toEqual([]);
    expect(h.tracked().equals(before)).toBe(true);
  });

  it('rejects any argument with usage (exit 2) and runs nothing', async () => {
    const h = harness({ argv: ['--check'] });
    expect(await h.go()).toBe(2);
    expect(h.out.lines.error.join('\n')).toMatch(/usage: node scripts\/db-types\.mjs/);
    expect(h.stub.calls).toEqual([]);
  });
});

describe('db-types: the shared lock', () => {
  it('holds the same lock as test-rls while it works, and releases it', async () => {
    let seen = null;
    const h = harness({
      responses: {
        gen: () => {
          seen = JSON.parse(readFileSync(h.lockFile, 'utf8'));
          return { stdout: GEN_TYPES };
        },
      },
    });
    expect(await h.go()).toBe(0);
    expect(seen).toMatchObject({ pid: ME, checkout: h.root });
    expect(existsSync(h.lockFile)).toBe(false);
  });

  it('releases the lock on failure and on a signal', async () => {
    const failed = harness({ responses: { gen: { status: 1 } } });
    await failed.go();
    expect(existsSync(failed.lockFile)).toBe(false);

    let heldAfter = null;
    const signalled = harness({
      responses: {
        reset: () => {
          signalled.fp.proc.emit('SIGINT');
          heldAfter = existsSync(signalled.lockFile);
          return {};
        },
      },
    });
    await signalled.go();
    expect(heldAfter).toBe(false);
    expect(signalled.fp.exits).toEqual([130]);
  });

  it('waits for a running harness and fails after 15 minutes naming it, writing nothing', async () => {
    const h = harness();
    const holder = JSON.stringify({ pid: 777, checkout: '/work/other worktree', token: 'abc' });
    writeFileSync(h.lockFile, holder);
    const before = h.tracked();
    expect(await h.go()).toBe(1);
    expect(h.out.lines.error.join('\n')).toMatch(/PID 777/);
    expect(h.clock.elapsed()).toBeGreaterThanOrEqual(15 * 60_000);
    expect(h.stub.keys()).toEqual(['docker']);
    expect(h.tracked().equals(before)).toBe(true);
  });
});
