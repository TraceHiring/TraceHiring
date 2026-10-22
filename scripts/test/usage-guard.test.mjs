// scripts/claude-usage-guard.mjs (PostToolUse hook). Founder rule, 2026-10-12: work until 95% of the
// 5-hour or weekly limit, then start the wrap-up (hand off, log, backup, push, next prompt).
// At 90% the hook only warns: no new agent, task or stream, keep working on the current one.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTempDirs, makeTempDir } from './fixtures/checks/temp-repo.mjs';

afterEach(cleanupTempDirs);

const SCRIPT = fileURLToPath(new URL('../claude-usage-guard.mjs', import.meta.url));

/** Runs the hook in a temp project whose status line recorded `fiveHour` % (weekly 10%). */
function guard(fiveHour, { at = Date.now(), dir = makeTempDir() } = {}) {
  mkdirSync(path.join(dir, '.claude'), { recursive: true });
  writeFileSync(
    path.join(dir, '.claude', 'usage.json'),
    JSON.stringify({
      at,
      five_hour: { used_percentage: fiveHour, resets_at: 'r1' },
      seven_day: { used_percentage: 10, resets_at: 'w1' },
    }),
  );
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: 'utf8',
  });
  return { code: r.status, err: r.stderr, dir };
}

describe('claude-usage-guard', () => {
  it('is silent below 90%', () => {
    expect(guard(89)).toMatchObject({ code: 0, err: '' });
  });

  it('at 90% warns but keeps the session working until 95%', () => {
    const r = guard(91);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/91% of the 5-hour session limit/);
    expect(r.err).toMatch(/do not start a new agent, task or stream/i);
    expect(r.err).toMatch(/keep working.*until 95%/i);
    expect(r.err).not.toMatch(/trace-handoff/);
  });

  it('at 95% starts the wrap-up', () => {
    const r = guard(95);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/STOP starting new work/);
    expect(r.err).toMatch(/trace-handoff/);
    expect(r.err).toMatch(/backup/);
    expect(r.err).toMatch(/push/);
    expect(r.err).toMatch(/next prompt/i);
  });

  it('warns once per level and window', () => {
    const first = guard(91);
    expect(first.code).toBe(2);
    expect(guard(92, { dir: first.dir }).code).toBe(0);
    expect(guard(96, { dir: first.dir }).code).toBe(2);
    expect(guard(97, { dir: first.dir }).code).toBe(0);
  });

  it('ignores a stale usage file (older than 15 minutes)', () => {
    expect(guard(99, { at: Date.now() - 16 * 60 * 1000 }).code).toBe(0);
  });
});
