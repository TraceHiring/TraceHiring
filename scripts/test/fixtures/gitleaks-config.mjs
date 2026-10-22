// Test helpers for the repository's gitleaks config: the files a throwaway repository needs to scan like the
// real one, and secrets that gitleaks' upstream allowlist regex used to hide. Secret-shaped strings are
// assembled at run time from random bytes, so none is committed.
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const randomAlnum = (n) => [...randomBytes(n)].map((b) => ALNUM[b % ALNUM.length]).join('');

/** A ghp_ token (36 body characters) with `word` spliced into the middle of the random body. */
export const tokenWith = (word = '') =>
  ['gh', 'p_', randomAlnum(15), word, randomAlnum(21 - word.length)].join('');

/** The `[extend] path` of the repository's .gitleaks.toml (comment lines ignored), repo-relative POSIX. */
export function extendPath(root = REPO_ROOT) {
  const toml = readFileSync(join(root, '.gitleaks.toml'), 'utf8');
  const m = /^[ \t]*path[ \t]*=[ \t]*"([^"\r\n]+)"[ \t]*$/m.exec(toml);
  if (!m) throw new Error('.gitleaks.toml has no [extend] path');
  return m[1];
}

/**
 * Copies .gitleaks.toml and the default-rules file it extends into `destRoot`. gitleaks resolves
 * `extend.path` from its working directory, so a throwaway repository needs both files.
 */
export function copyGitleaksConfig(destRoot) {
  for (const rel of ['.gitleaks.toml', extendPath()]) {
    const to = join(destRoot, ...rel.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(REPO_ROOT, ...rel.split('/')), to);
  }
}

/**
 * Secrets that gitleaks' default global allowlist regex `(?i)^true|false|null$` hid before the vendored
 * copy anchored it (starts with "true", contains "false", ends in "null", any case).
 * @returns {{ label: string, secret: string, line: string }[]} `line` is a source line that holds `secret`
 */
export function upstreamAllowlistVictims() {
  const asConst = (s) => `const t = "${s}";`;
  const sb = (mid) => ['sb', 'secret', mid].join('_');
  return [
    ['a ghp_ token containing "false"', tokenWith('false'), asConst],
    ['a ghp_ token containing "fAlSe"', tokenWith('fAlSe'), asConst],
    [
      'an sb_secret_ key containing "false"',
      sb(`${randomAlnum(14)}false${randomAlnum(14)}`),
      asConst,
    ],
    ['an sb_secret_ key ending in "NULL"', sb(`${randomAlnum(30)}NULL`), asConst],
    ['an api_key value starting with "true"', `true${randomAlnum(30)}`, (s) => `api_key = "${s}"`],
  ].map(([label, secret, wrap]) => ({ label, secret, line: wrap(secret) }));
}
