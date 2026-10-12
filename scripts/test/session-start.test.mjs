// Tests for scripts/claude-session-start.mjs (SessionStart hook). The live handoff is on the newest
// `<milestone>/integration` branch, not on the checkout's branch (founder decision, 2026-10-11).
// Synthetic repositories only.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { commitAll, g, makeRepo, removeDir, writeFiles } from './fixtures/verify/temp-repo.mjs';

const SCRIPT = fileURLToPath(new URL('../claude-session-start.mjs', import.meta.url));
const HANDOFF = 'docs/progress/HANDOFF.md';
const MAX_BYTES = 9000;

const dirs = [];
afterEach(() => {
  while (dirs.length) removeDir(dirs.pop());
});

function repo() {
  const r = makeRepo('trace-session-start');
  dirs.push(r.parent);
  return r.repo;
}

/** Commits everything with a fixed committer date, so "newest" is deterministic. */
function commitAt(cwd, message, isoDate) {
  g(cwd, ['add', '-A']);
  const res = spawnSync(
    'git',
    [
      '-c',
      'user.name=Trace Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '--no-verify',
      '-m',
      message,
    ],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate },
    },
  );
  if (res.status !== 0) throw new Error(`commit failed: ${res.stderr}`);
}

function runHook(cwd, extraEnv = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...extraEnv };
  if (!('TRACE_INTEGRATION_BRANCH' in extraEnv)) delete env.TRACE_INTEGRATION_BRANCH;
  const res = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', env });
  expect(res.status).toBe(0);
  return res.stdout;
}

/** main has a stale handoff; m0a/integration (newer) has the live one; main stays checked out. */
function mainWithIntegration() {
  const r = repo();
  writeFiles(r, { [HANDOFF]: '# HANDOFF\nSTALE MAIN COPY\n' });
  commitAt(r, 'chore: main handoff', '2026-10-01T10:00:00+05:30');
  g(r, ['switch', '-q', '-c', 'm0a/integration']);
  writeFiles(r, { [HANDOFF]: '# HANDOFF\nLIVE INTEGRATION COPY\n' });
  commitAt(r, 'chore: live handoff', '2026-10-02T10:00:00+05:30');
  g(r, ['switch', '-q', 'main']);
  return r;
}

describe('SessionStart hook: handoff source', () => {
  it('shows the handoff from m0a/integration when main is checked out', () => {
    const r = mainWithIntegration();
    const out = runHook(r);
    expect(out).toContain('LIVE INTEGRATION COPY');
    expect(out).not.toContain('STALE MAIN COPY');
    expect(out).toContain('m0a/integration');
    expect(out).toMatch(/Branch: main/);
    // The session is told it is not on the integration branch.
    expect(out).toMatch(/not on `m0a\/integration`/);
  });

  it('does not warn when the integration branch itself is checked out', () => {
    const r = mainWithIntegration();
    g(r, ['switch', '-q', 'm0a/integration']);
    const out = runHook(r);
    expect(out).toContain('LIVE INTEGRATION COPY');
    expect(out).not.toMatch(/not on `/);
  });

  it('picks the integration branch with the newest commit (m0b over m0a)', () => {
    const r = mainWithIntegration();
    g(r, ['switch', '-q', '-c', 'm0b/integration', 'm0a/integration']);
    writeFiles(r, { [HANDOFF]: '# HANDOFF\nM0B LIVE COPY\n' });
    commitAt(r, 'chore: m0b handoff', '2026-10-05T10:00:00+05:30');
    g(r, ['switch', '-q', 'main']);
    const out = runHook(r);
    expect(out).toContain('M0B LIVE COPY');
    expect(out).not.toContain('LIVE INTEGRATION COPY');
  });

  it('finds a remote-tracking integration branch when there is no local one', () => {
    const r = mainWithIntegration();
    const sha = g(r, ['rev-parse', 'm0a/integration']).stdout.trim();
    g(r, ['update-ref', 'refs/remotes/trace/m0a/integration', sha]);
    g(r, ['branch', '-q', '-D', 'm0a/integration']);
    const out = runHook(r);
    expect(out).toContain('LIVE INTEGRATION COPY');
    expect(out).toContain('trace/m0a/integration');
  });

  it('honours TRACE_INTEGRATION_BRANCH', () => {
    const r = mainWithIntegration();
    const out = runHook(r, { TRACE_INTEGRATION_BRANCH: 'main' });
    expect(out).toContain('STALE MAIN COPY');
  });

  it('ignores an override that is not a plain branch name and falls back to the newest one', () => {
    const r = mainWithIntegration();
    const out = runHook(r, { TRACE_INTEGRATION_BRANCH: '--output=x' });
    expect(out).toContain('LIVE INTEGRATION COPY');
  });

  it('falls back to the checkout handoff when no integration branch exists', () => {
    const r = repo();
    writeFiles(r, { [HANDOFF]: '# HANDOFF\nONLY COPY\n' });
    commitAll(r, 'chore: handoff');
    const out = runHook(r);
    expect(out).toContain('ONLY COPY');
  });

  it('says so when there is no handoff anywhere', () => {
    const r = repo();
    writeFiles(r, { 'README.md': 'x\n' });
    commitAll(r, 'chore: init');
    expect(runHook(r)).toMatch(/No docs\/progress\/HANDOFF\.md yet/);
  });
});

describe('SessionStart hook: output size', () => {
  it(`stays within ${MAX_BYTES} bytes and says how to read the rest`, () => {
    const r = repo();
    const long = Array.from({ length: 140 }, (_, i) => `line ${i} — ${'x'.repeat(110)}`).join('\n');
    writeFiles(r, { [HANDOFF]: `# HANDOFF\n${long}\n` });
    commitAt(r, 'chore: big handoff', '2026-10-01T10:00:00+05:30');
    g(r, ['branch', 'm0a/integration']);
    const out = runHook(r);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(MAX_BYTES);
    expect(out).toContain('truncated');
    expect(out).toContain('git show m0a/integration:docs/progress/HANDOFF.md');
    // The closing rules line is never cut off.
    expect(out).toMatch(/RULES: /);
  });
});
