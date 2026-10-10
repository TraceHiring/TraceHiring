// Test helpers: throwaway git repositories in the OS temp dir (synthetic data only).
// Directory names contain a space on purpose, so every caller must quote paths correctly.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// A test may run inside a git hook, where GIT_DIR / GIT_INDEX_FILE point at the real repository.
// Drop them so every git call (here and in the scripts under test) targets the temp repo only.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key];
}

const IDENTITY = [
  '-c',
  'user.name=Trace Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'tag.gpgsign=false',
  '-c',
  'core.autocrlf=false',
];

/** Runs git in `cwd`; throws with stderr on failure unless `allowFail`. */
export function g(cwd, args, { allowFail = false } = {}) {
  const res = spawnSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8' });
  if (res.error) throw res.error;
  if (res.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed (${res.status}): ${res.stderr}`);
  }
  return res;
}

/** Creates `<tmp>/<prefix> XXXXXX/` and returns its path. */
export function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix} `));
}

/** Creates an empty repository on branch `main` inside a fresh temp dir. */
export function makeRepo(prefix = 'trace-test') {
  const parent = makeTempDir(prefix);
  const repo = join(parent, 'repo');
  mkdirSync(repo);
  g(repo, ['init', '-q', '-b', 'main']);
  return { parent, repo };
}

/** Writes files (`{ 'a/b.txt': 'text' }`) relative to `root`, creating directories. */
export function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
}

/** Stages everything and commits with `--no-verify` (temp repos have no hooks of their own). */
export function commitAll(repo, message) {
  g(repo, ['add', '-A']);
  g(repo, ['commit', '-q', '--no-verify', '-m', message]);
}

export function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
