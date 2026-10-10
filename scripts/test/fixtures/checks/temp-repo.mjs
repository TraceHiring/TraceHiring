// Test helpers for the check-* script tests: temp directories and throwaway git repositories.
// Synthetic data only. Not a test file itself (Vitest only collects *.test.mjs).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// A test may run inside a git hook, where GIT_DIR / GIT_INDEX_FILE point at the real repository.
// Drop them so every git call below (and in the scripts under test) targets the temp repo only.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key];
}

const created = [];

/** A fresh empty directory under the OS temp dir. Removed by `cleanupTempDirs()`. */
export function makeTempDir(prefix = 'trace-check-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function cleanupTempDirs() {
  while (created.length > 0) {
    const dir = created.pop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** Writes `{ 'rel/path': content }` under `root`, creating directories. Content may be a Buffer. */
export function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

let emptyHooksDir;

/** Runs git in `cwd` with hooks, signing and line-ending conversion turned off. Throws on failure. */
export function git(cwd, ...args) {
  emptyHooksDir ??= makeTempDir('trace-check-hooks-');
  const r = spawnSync(
    'git',
    [
      '-c',
      `core.hooksPath=${emptyHooksDir}`,
      '-c',
      'commit.gpgsign=false',
      '-c',
      'tag.gpgsign=false',
      '-c',
      'core.autocrlf=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
  }
  return r.stdout;
}

/** A new repository on branch `main` with a fixed synthetic identity. */
export function initRepo(dir = makeTempDir('trace-check-repo-')) {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Fixture User');
  git(dir, 'config', 'user.email', 'fixture@example.invalid');
  git(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

/** Stages everything and commits (empty commits allowed). */
export function commitAll(dir, message = 'fixture commit') {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', message);
}
