// AT-6: the pre-commit hook blocks a staged secret. AT-6c: a --no-verify commit that holds a secret
// makes `pnpm lint` fail. Both read the real commands from config (lefthook.yml, root package.json),
// run them in throwaway repositories, and use a fake key whose shape is generated at test time.
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { findSh } from '../lib/sh.mjs';
import { commitAll, g, makeRepo, removeDir, writeFiles } from './fixtures/verify/temp-repo.mjs';
import { copyGitleaksConfig } from './fixtures/gitleaks-config.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LEFTHOOK = readFileSync(join(ROOT, 'lefthook.yml'), 'utf8');
const ROOT_PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** Reads `<hook>.commands.<name>.run` from lefthook.yml (block YAML, as lefthook.yml uses). */
function lefthookRun(yaml, hook, name) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `${hook}:`);
  if (start < 0) throw new Error(`lefthook.yml has no ${hook} hook`);
  let inCommand = false;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // next top-level key
    if (new RegExp(`^ {4}${name}:\\s*$`).test(line)) inCommand = true;
    else if (/^ {4}\S/.test(line)) inCommand = false;
    const m = inCommand && /^ {6}run:\s*(.+?)\s*$/.exec(line);
    if (m) return unquoteYamlScalar(m[1]);
  }
  throw new Error(`lefthook.yml has no ${hook}.commands.${name}.run`);
}

function unquoteYamlScalar(s) {
  if (s.startsWith('"')) return JSON.parse(s);
  if (s.startsWith("'")) return s.slice(1, -1).replaceAll("''", "'");
  return s;
}

/** The `gitleaks git ...` segment of the root `lint` script. */
function lintGitleaksCommand(pkg) {
  const segment = pkg.scripts.lint
    .split('&&')
    .map((s) => s.trim())
    .find((s) => s.startsWith('gitleaks git'));
  if (!segment) throw new Error('root package.json scripts.lint has no `gitleaks git` command');
  return segment;
}

/**
 * A GitHub-token-shaped string, assembled at runtime so no literal key exists in the repo. `word`
 * (default none) replaces the middle of the 36-character body.
 */
function fakeGithubToken(word = '') {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let body = '';
  for (let i = 0; i < 36 - word.length; i++) body += alphabet[randomInt(alphabet.length)];
  const mid = Math.floor(body.length / 2);
  return ['g', 'h', 'p', '_'].join('') + body.slice(0, mid) + word + body.slice(mid);
}

let SH;
beforeAll(() => {
  SH = findSh();
  // Fail, never skip: the hooks are sh commands, so without sh nothing here can be checked.
  if (!SH) throw new Error('sh not found on PATH or in Git for Windows usr/bin');
});

const cleanup = [];
afterEach(() => {
  while (cleanup.length) removeDir(cleanup.pop());
});

function repoWithRealConfig() {
  const { parent, repo } = makeRepo('trace hooks');
  cleanup.push(parent);
  copyGitleaksConfig(repo); // .gitleaks.toml and the default rules it extends (path is relative to cwd)
  writeFiles(repo, { 'README.md': '# temp\n' });
  commitAll(repo, 'base');
  return repo;
}

function runSh(cwd, command, env = process.env) {
  const res = spawnSync(SH, ['-c', command], { cwd, env, encoding: 'utf8' });
  if (res.error) throw res.error;
  return { code: res.status, out: `${res.stdout}\n${res.stderr}` };
}

/** process.env with PATH replaced (Windows keys are case-insensitive, so drop every variant). */
function envWithPath(path) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'),
  );
  env.PATH = path;
  return env;
}

describe('config the tests read', () => {
  it('pre-commit runs gitleaks on the staged changes', () => {
    const cmd = lefthookRun(LEFTHOOK, 'pre-commit', 'gitleaks');
    expect(cmd).toMatch(/gitleaks git --pre-commit --staged/);
  });

  it('lint scans the full history (no --staged, no --pre-commit)', () => {
    const cmd = lintGitleaksCommand(ROOT_PKG);
    expect(cmd).toMatch(/^gitleaks git\b/);
    expect(cmd).not.toMatch(/--staged|--pre-commit/);
  });
});

describe('AT-6: pre-commit gitleaks command', () => {
  const command = lefthookRun(LEFTHOOK, 'pre-commit', 'gitleaks');

  it('blocks a staged secret', () => {
    const repo = repoWithRealConfig();
    writeFiles(repo, { 'settings.txt': `token=${fakeGithubToken()}\n` });
    g(repo, ['add', 'settings.txt']);
    const res = runSh(repo, command);
    expect(res.code, res.out).not.toBe(0);
    expect(res.out).toMatch(/leaks found/i);
  });

  it('passes a clean staged change (control)', () => {
    const repo = repoWithRealConfig();
    writeFiles(repo, { 'settings.txt': 'colour=blue\n' });
    g(repo, ['add', 'settings.txt']);
    const res = runSh(repo, command);
    expect(res.code, res.out).toBe(0);
    expect(res.out).toMatch(/no leaks found/i);
  });

  it.each(['false', 'fAlSe'])('blocks a staged key that contains "%s"', (word) => {
    // gitleaks' unanchored default allowlist regex used to drop any secret that contains "false".
    const repo = repoWithRealConfig();
    writeFiles(repo, { 'settings.txt': `token=${fakeGithubToken(word)}\n` });
    g(repo, ['add', 'settings.txt']);
    const res = runSh(repo, command);
    expect(res.code, res.out).not.toBe(0);
    expect(res.out).toMatch(/leaks found/i);
  });

  it('passes a staged change that only holds the words true, false and null', () => {
    const repo = repoWithRealConfig();
    writeFiles(repo, { 'settings.txt': 'enabled=true\nretired=false\nowner=null\n' });
    g(repo, ['add', 'settings.txt']);
    const res = runSh(repo, command);
    expect(res.code, res.out).toBe(0);
    expect(res.out).toMatch(/no leaks found/i);
  });

  it('fails, never skips, when gitleaks is missing', () => {
    const repo = repoWithRealConfig();
    writeFiles(repo, { 'settings.txt': 'colour=blue\n' });
    g(repo, ['add', 'settings.txt']);
    const res = runSh(repo, command, envWithPath(dirname(SH)));
    expect(res.code).not.toBe(0);
    expect(res.out).toMatch(/gitleaks is not installed/);
  });
});

describe('AT-6c: a --no-verify commit with a secret fails the lint gitleaks scan', () => {
  const command = lintGitleaksCommand(ROOT_PKG);

  it('finds the secret in history', () => {
    const repo = repoWithRealConfig();
    writeFiles(repo, { 'deploy/notes.txt': `key: ${fakeGithubToken()}\n` });
    commitAll(repo, 'commit that skipped the hook'); // commitAll uses --no-verify
    const res = runSh(repo, command);
    expect(res.code, res.out).not.toBe(0);
    expect(res.out).toMatch(/leaks found/i);
  });

  it('finds a committed key that contains "false"', () => {
    const repo = repoWithRealConfig();
    writeFiles(repo, { 'deploy/notes.txt': `key: ${fakeGithubToken('false')}\n` });
    commitAll(repo, 'commit that skipped the hook');
    const res = runSh(repo, command);
    expect(res.code, res.out).not.toBe(0);
    expect(res.out).toMatch(/leaks found/i);
  });

  it('finds a secret that was committed and then deleted', () => {
    const repo = repoWithRealConfig();
    writeFiles(repo, { 'leak.txt': `key: ${fakeGithubToken()}\n` });
    commitAll(repo, 'leak');
    g(repo, ['rm', '-q', 'leak.txt']);
    commitAll(repo, 'remove leak');
    const res = runSh(repo, command);
    expect(res.code, res.out).not.toBe(0);
  });

  it('finds a secret that exists only on another branch', () => {
    const repo = repoWithRealConfig();
    g(repo, ['switch', '-q', '-c', 'other-stream']);
    writeFiles(repo, { 'leak.txt': `key: ${fakeGithubToken()}\n` });
    commitAll(repo, 'leak on another ref');
    g(repo, ['switch', '-q', 'main']);
    const res = runSh(repo, command);
    expect(res.code, res.out).not.toBe(0);
  });

  it('passes a clean history (control)', () => {
    const repo = repoWithRealConfig();
    const res = runSh(repo, command);
    expect(res.code, res.out).toBe(0);
  });
});
