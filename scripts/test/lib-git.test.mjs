// Unit tests for scripts/lib/git.mjs over throwaway repositories (spec §5 verify:fast steps 1–2).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changedFiles, git, mergeBase, refExists, repoTop } from '../lib/git.mjs';
import { commitAll, g, makeRepo, removeDir, writeFiles } from './fixtures/verify/temp-repo.mjs';

const cleanup = [];
afterEach(() => {
  while (cleanup.length) removeDir(cleanup.pop());
});

function repoWithMain() {
  const { parent, repo } = makeRepo('trace lib-git');
  cleanup.push(parent);
  writeFiles(repo, {
    '.gitignore': 'ignored/\n',
    'a.txt': 'a\n',
    'dir with space/b.txt': 'b\n',
    'gone.txt': 'gone\n',
    'old-name.txt': 'rename me\n',
  });
  commitAll(repo, 'base');
  return repo;
}

describe('git()', () => {
  it('returns code, stdout and stderr without throwing on failure', () => {
    const repo = repoWithMain();
    const ok = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(ok.code).toBe(0);
    expect(ok.stdout.trim()).toBe('main');
    const bad = git(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/nope']);
    expect(bad.code).not.toBe(0);
  });
});

describe('repoTop()', () => {
  it('finds the top level from a sub-directory whose path has spaces', () => {
    const repo = repoWithMain();
    const top = repoTop(join(repo, 'dir with space'));
    expect(top.replace(/\\/g, '/').toLowerCase()).toBe(repo.replace(/\\/g, '/').toLowerCase());
  });

  it('returns null outside a repository', () => {
    const { parent } = makeRepo('trace lib-git-outside');
    cleanup.push(parent);
    const outside = join(parent, 'not-a-repo');
    mkdirSync(outside);
    expect(repoTop(outside)).toBeNull();
  });
});

describe('refExists() and mergeBase()', () => {
  it('returns the fork point of HEAD and main', () => {
    const repo = repoWithMain();
    const forkPoint = g(repo, ['rev-parse', 'HEAD']).stdout.trim();
    g(repo, ['switch', '-q', '-c', 'feature']);
    writeFiles(repo, { 'c.txt': 'c\n' });
    commitAll(repo, 'feature work');
    g(repo, ['switch', '-q', 'main']);
    writeFiles(repo, { 'd.txt': 'd\n' });
    commitAll(repo, 'main moves on');
    g(repo, ['switch', '-q', 'feature']);

    expect(refExists(repo, 'main')).toBe(true);
    expect(refExists(repo, 'no-such-branch')).toBe(false);
    expect(mergeBase(repo, 'HEAD', 'main')).toBe(forkPoint);
  });

  it('returns null when main does not exist', () => {
    const repo = repoWithMain();
    g(repo, ['branch', '-m', 'main', 'trunk']);
    expect(refExists(repo, 'main')).toBe(false);
    expect(mergeBase(repo, 'HEAD', 'main')).toBeNull();
  });

  it('returns null when there are no common commits', () => {
    const repo = repoWithMain();
    g(repo, ['switch', '-q', '--orphan', 'island']);
    writeFiles(repo, { 'island.txt': 'x\n' });
    commitAll(repo, 'unrelated root');
    expect(mergeBase(repo, 'HEAD', 'main')).toBeNull();
  });
});

describe('changedFiles()', () => {
  it('lists committed, staged, unstaged, deleted, renamed and untracked paths against the base', () => {
    const repo = repoWithMain();
    const base = g(repo, ['rev-parse', 'HEAD']).stdout.trim();
    g(repo, ['switch', '-q', '-c', 'feature']);
    writeFiles(repo, { 'committed.txt': 'c\n' });
    commitAll(repo, 'committed change');
    writeFileSync(join(repo, 'a.txt'), 'a changed\n'); // unstaged
    writeFiles(repo, { 'staged.txt': 's\n' });
    g(repo, ['add', 'staged.txt']);
    rmSync(join(repo, 'gone.txt'));
    g(repo, ['mv', 'old-name.txt', 'new-name.txt']);
    writeFiles(repo, {
      'dir with space/untracked file.txt': 'u\n',
      'ignored/skip.txt': 'ignored\n',
    });

    expect(changedFiles(repo, base)).toEqual([
      'a.txt',
      'committed.txt',
      'dir with space/untracked file.txt',
      'gone.txt',
      'new-name.txt',
      'old-name.txt',
      'staged.txt',
    ]);
  });

  it('returns an empty list when nothing changed', () => {
    const repo = repoWithMain();
    expect(changedFiles(repo, 'HEAD')).toEqual([]);
  });

  it('throws when the base does not resolve', () => {
    const repo = repoWithMain();
    expect(() => changedFiles(repo, 'no-such-ref')).toThrow(/no-such-ref/);
  });
});
