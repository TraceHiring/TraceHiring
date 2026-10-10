// AT-24: scripts/backup.sh writes a bundle that `git bundle verify` accepts, holds every branch and
// tag, and keeps only the newest 10. Runs the real script with `sh` against a throwaway repository.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { findSh } from '../lib/sh.mjs';
import { commitAll, g, makeRepo, removeDir, writeFiles } from './fixtures/verify/temp-repo.mjs';

const BACKUP = fileURLToPath(new URL('../backup.sh', import.meta.url));
const DAY = 24 * 60 * 60;

let SH;
beforeAll(() => {
  SH = findSh();
  // Fail, never skip (spec §13 AT-24).
  if (!SH) throw new Error('sh not found on PATH or in Git for Windows usr/bin; AT-24 cannot run');
});

const cleanup = [];
afterEach(() => {
  while (cleanup.length) removeDir(cleanup.pop());
});

function repoWithRefs() {
  const { parent, repo } = makeRepo('trace backup');
  cleanup.push(parent);
  writeFiles(repo, { 'a.txt': 'a\n' });
  commitAll(repo, 'first');
  g(repo, ['tag', 'v-light']);
  g(repo, ['switch', '-q', '-c', 'feature/x']);
  writeFiles(repo, { 'b.txt': 'b\n' });
  commitAll(repo, 'second');
  g(repo, ['tag', '-a', 'v-annotated', '-m', 'annotated tag']);
  g(repo, ['switch', '-q', 'main']);
  return { parent, repo };
}

/** 12 dummy bundles, oldest first, with mtimes 1..12 days in the past (index 0 is the oldest). */
function seedDummies(dest) {
  mkdirSync(dest, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  const names = [];
  for (let i = 0; i < 12; i++) {
    const name = `trace-20200101-0000${String(i).padStart(2, '0')}-dummy${i}.bundle`;
    const file = join(dest, name);
    writeFileSync(file, 'not a real bundle\n');
    const t = now - (12 - i) * DAY;
    utimesSync(file, t, t);
    names.push(name);
  }
  writeFileSync(join(dest, 'notes.txt'), 'unrelated file\n');
  return names;
}

function runBackup(cwd) {
  const res = spawnSync(SH, [BACKUP], { cwd, encoding: 'utf8' });
  if (res.error) throw res.error;
  return res;
}

const bundlesIn = (dest) => readdirSync(dest).filter((f) => /^trace-.*\.bundle$/.test(f));

describe('AT-24: scripts/backup.sh', () => {
  it('writes a verified bundle with every branch and tag and keeps only the newest 10', () => {
    const { parent, repo } = repoWithRefs();
    const dest = join(parent, 'trace-backups');
    const dummies = seedDummies(dest);

    const res = runBackup(repo);
    expect(res.status, res.stdout + res.stderr).toBe(0);

    const created = bundlesIn(dest).filter((f) => !f.includes('dummy'));
    expect(created).toHaveLength(1);
    const bundle = join(dest, created[0]);
    expect(res.stdout).toContain(created[0]);

    const verify = g(repo, ['bundle', 'verify', bundle], { allowFail: true });
    expect(verify.status, verify.stderr).toBe(0);

    const heads = g(repo, ['bundle', 'list-heads', bundle]).stdout;
    const refs = g(repo, [
      'for-each-ref',
      '--format=%(objectname) %(refname)',
      'refs/heads',
      'refs/tags',
    ])
      .stdout.trim()
      .split('\n');
    expect(refs.length).toBe(4); // main, feature/x, v-light, v-annotated
    for (const ref of refs) expect(heads).toContain(ref);

    // Newest 10 kept: the new bundle plus the 9 newest dummies; the 3 oldest are gone.
    const left = bundlesIn(dest);
    expect(left).toHaveLength(10);
    for (const old of dummies.slice(0, 3)) expect(left).not.toContain(old);
    for (const kept of dummies.slice(3)) expect(left).toContain(kept);
    expect(existsSync(join(dest, 'notes.txt'))).toBe(true);
  });

  it('from a linked worktree, writes next to the main checkout so all worktrees share one folder', () => {
    const { parent, repo } = repoWithRefs();
    const wt = join(parent, 'repo', '.wt', 'linked tree');
    g(repo, ['worktree', 'add', '-q', wt, 'feature/x']);
    const res = runBackup(wt);
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(bundlesIn(join(parent, 'trace-backups'))).toHaveLength(1);
    expect(existsSync(join(parent, 'repo', '.wt', 'trace-backups'))).toBe(false);
  });

  it('fails outside a git repository', () => {
    const { parent } = makeRepo('trace backup-outside');
    cleanup.push(parent);
    const res = runBackup(parent);
    expect(res.status).not.toBe(0);
  });
});
