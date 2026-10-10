// Git helpers for repo scripts (spec specs/m0-foundations.md §5). No shell is involved, so paths
// with spaces need no quoting. Output paths are repo-relative with forward slashes.
import { spawnSync } from 'node:child_process';

/** Runs git in `cwd`. Never throws on a non-zero exit; returns { code, stdout, stderr }. */
export function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw res.error;
  return { code: res.status ?? 1, stdout: res.stdout, stderr: res.stderr };
}

/** Like git(), but throws with git's stderr on failure and returns trimmed stdout. */
export function gitOut(cwd, args) {
  const res = git(cwd, args);
  if (res.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${res.code}): ${res.stderr.trim()}`);
  }
  return res.stdout.trim();
}

/** The top-level directory of the working tree that contains `cwd`, or null outside a repo. */
export function repoTop(cwd) {
  const res = git(cwd, ['rev-parse', '--show-toplevel']);
  return res.code === 0 ? res.stdout.trim() : null;
}

/** The absolute path of the shared `.git` directory (the same for every linked worktree). */
export function commonDir(cwd) {
  return gitOut(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
}

/** True when `ref` resolves to a commit. */
export function refExists(cwd, ref) {
  return git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).code === 0;
}

/** `git merge-base a b`, or null when either ref is missing or they share no history. */
export function mergeBase(cwd, a, b) {
  if (!refExists(cwd, a) || !refExists(cwd, b)) return null;
  const res = git(cwd, ['merge-base', a, b]);
  return res.code === 0 ? res.stdout.trim() : null;
}

/** Splits NUL-separated git output into paths. */
function splitZ(out) {
  return out.split('\0').filter(Boolean);
}

/**
 * Files that differ between `base` and the working tree (committed, staged or not, deleted, both
 * sides of a rename) plus untracked files that are not ignored. Sorted and de-duplicated.
 */
export function changedFiles(cwd, base) {
  if (!refExists(cwd, base)) throw new Error(`base ref does not resolve: ${base}`);
  const diff = git(cwd, ['diff', '--name-only', '--no-renames', '-z', base, '--']);
  if (diff.code !== 0) throw new Error(`git diff ${base} failed: ${diff.stderr.trim()}`);
  const untracked = git(cwd, ['ls-files', '-o', '--exclude-standard', '-z']);
  if (untracked.code !== 0) throw new Error(`git ls-files failed: ${untracked.stderr.trim()}`);
  return [...new Set([...splitZ(diff.stdout), ...splitZ(untracked.stdout)])].sort();
}
