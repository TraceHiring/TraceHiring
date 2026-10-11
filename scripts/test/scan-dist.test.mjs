// AT-16 (local part): scripts/scan-dist.mjs runs gitleaks over every dist/ (spec §5, §7.2 step 2).
// These tests run the real gitleaks (8.30.1, required on every machine and in CI's shared setup);
// they fail, never skip, if it is missing. The fake token is assembled at runtime from random
// bytes, so no secret-shaped string is ever committed.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  INSTALL_HINT,
  STDIN_HEADER,
  distText,
  findDists,
  findHiders,
  scanDist,
} from '../scan-dist.mjs';
import { cleanupTempDirs, makeTempDir, writeFiles } from './fixtures/checks/temp-repo.mjs';

afterEach(cleanupTempDirs);

const SCRIPT = fileURLToPath(new URL('../scan-dist.mjs', import.meta.url));
const REPO_CONFIG = fileURLToPath(new URL('../../.gitleaks.toml', import.meta.url));
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A random string in the shape of a GitHub personal access token (gitleaks rule github-pat). */
const fakeToken = () =>
  ['gh', 'p_', ...[...randomBytes(36)].map((b) => ALNUM[b % ALNUM.length])].join('');

/** A random Supabase-secret-shaped key (the repository rule supabase-secret-key). */
const sbSecret = () =>
  ['sb', 'secret', [...randomBytes(40)].map((b) => ALNUM[b % ALNUM.length]).join('')].join('_');

const pkg = (build = true) =>
  JSON.stringify({ name: 'fixture', private: true, scripts: build ? { build: 'x' } : {} });

/** A built fixture monorepo: two apps and a Worker, each with a clean dist/. */
const cleanRepo = (extra = {}) => {
  const root = makeTempDir();
  writeFiles(root, {
    'apps/candidate/package.json': pkg(),
    'apps/candidate/dist/index.html': '<!doctype html><title>Fixture</title>',
    'apps/candidate/dist/assets/index.js': 'console.log("fixture build output");\n',
    'apps/recruiter/package.json': pkg(),
    'apps/recruiter/dist/index.html': '<!doctype html><title>Fixture</title>',
    'workers/edge/package.json': pkg(),
    'workers/edge/dist/index.js': 'export default { fetch() { return new Response("ok"); } };\n',
    ...extra,
  });
  return root;
};

const run = (root, env = process.env) =>
  spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8', env });

describe('findDists', () => {
  it('lists every dist/ under apps, workers and services, and built workspaces without one', () => {
    const root = cleanRepo({
      'services/api/package.json': pkg(),
      'workers/jobs/package.json': pkg(),
      'packages/ui/package.json': pkg(),
      'packages/ui/dist/x.js': 'x',
      'apps/docs-only/package.json': pkg(false),
      'apps/notes/README.md': 'not a workspace',
    });
    expect(findDists(root)).toEqual({
      dists: ['apps/candidate/dist', 'apps/recruiter/dist', 'workers/edge/dist'],
      missing: ['workers/jobs', 'services/api'],
    });
  });
});

// S1.4 security re-review N8: archives are found by their magic bytes, not only by name.
describe('findHiders', () => {
  it.each([
    ['gzip', '1f8b0800000000000003'],
    ['zip', '504b030414000000'],
    ['bzip2', '425a683931415926'],
    ['xz', 'fd377a585a000004'],
    ['zstd', '28b52ffd2400'],
    ['7z', '377abcaf271c0004'],
    ['rar', '526172211a070100'],
  ])('reports %s bytes in assets/data.dat as an archive', (_label, hex) => {
    const root = cleanRepo({ 'apps/candidate/dist/assets/data.dat': Buffer.from(hex, 'hex') });
    expect(findHiders(root, 'apps/candidate/dist')).toEqual([
      'apps/candidate/dist/assets/data.dat: archive in build output (compressed content cannot be scanned)',
    ]);
  });

  it('does not report text, images or wasm as archives', () => {
    const root = cleanRepo({
      'apps/candidate/dist/assets/a.png': Buffer.from('89504e470d0a1a0a0000', 'hex'),
      'apps/candidate/dist/assets/b.wasm': Buffer.from('0061736d01000000', 'hex'),
      'apps/candidate/dist/assets/c.txt': 'BZ is not bzip2\n',
      'apps/candidate/dist/assets/d.txt': '',
    });
    expect(findHiders(root, 'apps/candidate/dist')).toEqual([]);
  });
});

// S1.4 security re-review N8: the stream that goes through gitleaks stdin.
describe('distText', () => {
  it('starts with a fixed ASCII header longer than the first read gitleaks sniffs', () => {
    expect(STDIN_HEADER.length).toBeGreaterThan(100_000);
    expect(/^(?:scan-dist\n)+$/.test(STDIN_HEADER.toString('latin1'))).toBe(true);
    const root = cleanRepo();
    const text = distText(root, 'apps/candidate/dist');
    expect(text.subarray(0, STDIN_HEADER.length).equals(STDIN_HEADER)).toBe(true);
  });

  it('keeps files with NUL bytes and joins files in sorted path order', () => {
    const root = makeTempDir();
    writeFiles(root, {
      'd/zeta.js': 'marker-zeta\n',
      'd/b/inner.js': 'marker-b-inner\n',
      'd/a.bin': Buffer.from('\0\0marker-a-bin\n', 'latin1'),
      'd/B.js': 'marker-upper-b\n',
    });
    const body = distText(root, 'd').subarray(STDIN_HEADER.length).toString('latin1');
    const order = ['marker-upper-b', 'marker-a-bin', 'marker-b-inner', 'marker-zeta'].map((m) =>
      body.indexOf(m),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });
});

describe('scanDist (real gitleaks)', () => {
  it('passes clean build output', () => {
    const r = scanDist({ root: cleanRepo() });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.scanned).toEqual(['apps/candidate/dist', 'apps/recruiter/dist', 'workers/edge/dist']);
  });

  it.each([
    ['an app bundle', 'apps/recruiter/dist/assets/index.js'],
    ['a Worker bundle', 'workers/edge/dist/index.js'],
    ['a service source map', 'services/api/dist/index.js.map'],
  ])('fails on a fake token in %s, without printing it', (_label, file) => {
    const token = fakeToken();
    const root = cleanRepo({
      'services/api/package.json': pkg(),
      'services/api/dist/index.js': 'export {};\n',
      [file]: `const config = { token: "${token}" };\n`,
    });
    const r = scanDist({ root });
    expect(r.ok).toBe(false);
    const dist = file.split('/').slice(0, 3).join('/');
    expect(r.problems.join('\n')).toMatch(new RegExp(`${dist}: gitleaks found a secret`));
    expect(r.problems.join('\n')).not.toContain(token);
  });

  it('ignores a .gitleaks.toml that a build copied into dist/ (the root config always wins)', () => {
    const root = cleanRepo({
      '.gitleaks.toml': '[extend]\nuseDefault = true\n',
      'apps/candidate/dist/.gitleaks.toml':
        '[extend]\nuseDefault = true\n[allowlist]\npaths = [".*"]\n',
      'apps/candidate/dist/assets/index.js': `const t = "${fakeToken()}";\n`,
    });
    expect(scanDist({ root }).ok).toBe(false);
  });

  it('ignores GITLEAKS_CONFIG in the environment', () => {
    const root = cleanRepo({ 'workers/edge/dist/index.js': `const t = "${fakeToken()}";\n` });
    const allowAll = makeTempDir();
    writeFiles(allowAll, { 'allow.toml': '[allowlist]\npaths = [".*"]\n' });
    const r = scanDist({
      root,
      env: { ...process.env, GITLEAKS_CONFIG: `${allowAll}/allow.toml` },
    });
    expect(r.ok).toBe(false);
  });

  // S1.4 security review M5: `gitleaks dir` honours a .gitleaksignore in the scanned directory
  // and inline allow markers, so build output may carry neither.
  it.each([
    ['a .gitleaksignore at the top of dist/', 'apps/candidate/dist/.gitleaksignore'],
    ['a nested .gitleaksignore', 'workers/edge/dist/a/b/.gitleaksignore'],
    ['a nested .gitleaks.toml', 'apps/recruiter/dist/assets/.gitleaks.toml'],
    ['a .gitleaksbaseline', 'apps/candidate/dist/.gitleaksbaseline'],
    ['a .gitleaksignore in another case', 'apps/candidate/dist/.GitLeaksIgnore'],
  ])('fails on %s, even when the scan is clean', (_label, file) => {
    const r = scanDist({ root: cleanRepo({ [file]: '# fixture\n' }) });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toContain(`${file}: gitleaks ignore/config/baseline file`);
  });

  it('fails on a file that contains the inline allow marker, which would hide a finding', () => {
    const marker = ['gitleaks', 'allow'].join(':');
    const root = cleanRepo({
      'apps/candidate/dist/assets/index.js': `const t = "${fakeToken()}"; // ${marker}\n`,
      'workers/edge/dist/chunk.js': `/* ${marker.toUpperCase()} */\n`,
    });
    const r = scanDist({ root });
    expect(r.ok).toBe(false);
    const p = r.problems.join('\n');
    expect(p).toContain('apps/candidate/dist/assets/index.js: contains the inline allow marker');
    expect(p).toContain('workers/edge/dist/chunk.js: contains the inline allow marker');
  });

  // S1.4 security review M6: gitleaks' default rules miss Supabase secret keys.
  it('finds a Supabase sb_secret_ key with the repository .gitleaks.toml', () => {
    const tail = [...randomBytes(40)].map((b) => ALNUM[b % ALNUM.length]).join('');
    const key = ['sb', 'secret', tail].join('_');
    expect(key).toMatch(/^sb_secret_[A-Za-z0-9]{40}$/);
    const root = cleanRepo({
      '.gitleaks.toml': readFileSync(REPO_CONFIG, 'utf8'),
      'workers/edge/dist/index.js': `x("${key}");\n`,
    });
    const r = scanDist({ root });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/workers\/edge\/dist: gitleaks found a secret/);
    expect(r.problems.join('\n')).not.toContain(key);
  });

  // S1.4 security re-review N5: `gitleaks dir` skips paths on its built-in allowlist
  // (node_modules/, images, lockfiles, anything containing gitleaks.toml), so their content is
  // also streamed through `gitleaks stdin`, which has no path to allowlist.
  it.each([
    'node_modules/pkg/index.js',
    'logo.svg',
    'pnpm-lock.yaml',
    'assets/gitleaks.toml-abc.js',
  ])('finds a key in %s, a path gitleaks dir skips', (file) => {
    const tail = [...randomBytes(40)].map((b) => ALNUM[b % ALNUM.length]).join('');
    const key = ['sb', 'secret', tail].join('_');
    const root = cleanRepo({
      '.gitleaks.toml': readFileSync(REPO_CONFIG, 'utf8'),
      [`apps/candidate/dist/${file}`]: `x("${key}");\n`,
    });
    const r = scanDist({ root });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/apps\/candidate\/dist: gitleaks found a secret/);
    expect(r.problems.join('\n')).not.toContain(key);
  });

  it('fails on an archive in build output, whose content cannot be scanned', () => {
    const root = cleanRepo({ 'apps/candidate/dist/assets/index.js.gz': 'compressed' });
    const r = scanDist({ root });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/assets\/index\.js\.gz: archive in build output/);
  });

  // S1.4 security re-review N8: gitleaks stdin sniffs the type of its first read and skips the
  // whole stream when it looks like application/* (offset 0 such as %PDF, but also tar's `ustar`
  // at byte 257), so the file that sorts first must not decide whether anything is scanned.
  it.each([
    ['a text-only %PDF file', 'assets/a-notice.pdf', '%PDF-1.4\nnotice\n'],
    [
      'a text file that sniffs as tar',
      'assets/a-notes.txt',
      `${'a'.repeat(247)}ustar${'a'.repeat(5)}ustar\n`,
    ],
  ])('finds a key in assets/bootstrap-<hash>.js when %s sorts first', (_label, file, content) => {
    const root = cleanRepo({
      '.gitleaks.toml': readFileSync(REPO_CONFIG, 'utf8'),
      [`apps/candidate/dist/${file}`]: content,
      'apps/candidate/dist/assets/bootstrap-4f2a9c1e.js': `x("${sbSecret()}");\n`,
    });
    const r = scanDist({ root });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/apps\/candidate\/dist: gitleaks found a secret/);
  });

  it.each([
    ['a NUL-containing logo.svg', 'logo.svg', '<svg xmlns="http://www.w3.org/2000/svg">\0\0\0\n'],
    ['a file after a \\0asm header', 'assets/app-9c1e.wasm', '\0asm\x01\0\0\0\n'],
  ])('finds a key in %s', (_label, file, head) => {
    const key = sbSecret();
    const root = cleanRepo({
      '.gitleaks.toml': readFileSync(REPO_CONFIG, 'utf8'),
      [`apps/candidate/dist/${file}`]: Buffer.from(`${head}x("${key}");\n`, 'latin1'),
    });
    const r = scanDist({ root });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/apps\/candidate\/dist: gitleaks found a secret/);
    expect(r.problems.join('\n')).not.toContain(key);
  });

  it('fails on gzip bytes in a file whose name is not an archive name', () => {
    const root = cleanRepo({
      'apps/candidate/dist/assets/data.dat': gzipSync(Buffer.from('fixture build output\n')),
    });
    const r = scanDist({ root });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/assets\/data\.dat: archive in build output/);
  });

  it('keeps the default rules in the repository .gitleaks.toml', () => {
    const root = cleanRepo({
      '.gitleaks.toml': readFileSync(REPO_CONFIG, 'utf8'),
      'apps/candidate/dist/assets/index.js': `const t = "${fakeToken()}";\n`,
    });
    expect(scanDist({ root }).ok).toBe(false);
  });

  it('fails when no dist/ exists at all', () => {
    const root = makeTempDir();
    writeFiles(root, { 'apps/candidate/package.json': pkg(), 'README.md': 'x' });
    const r = scanDist({ root });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/no dist\/ found/);
    const empty = makeTempDir();
    expect(scanDist({ root: empty }).problems.join('\n')).toMatch(/no dist\/ found/);
  });

  it('fails when one built workspace has no dist/ (partial build)', () => {
    const root = cleanRepo({ 'workers/jobs/package.json': pkg() });
    const r = scanDist({ root });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([
      expect.stringMatching(/^workers\/jobs: has a build script but no dist/),
    ]);
  });

  it('fails with an install hint when gitleaks is missing', () => {
    const r = scanDist({ root: cleanRepo(), gitleaks: 'gitleaks-not-installed-fixture' });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([INSTALL_HINT]);
    expect(INSTALL_HINT).toMatch(/winget install Gitleaks\.Gitleaks/);
  });
});

describe('CLI', () => {
  it('exits 0 on clean output and 1 on a finding', () => {
    const ok = run(cleanRepo());
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/scan-dist: OK, no secrets in 3 dist\//);
    const bad = run(cleanRepo({ 'apps/candidate/dist/assets/index.js': `x="${fakeToken()}"` }));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/apps\/candidate\/dist: gitleaks found a secret/);
  });

  it('exits 1 when nothing was built', () => {
    const r = run(makeTempDir());
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no dist\/ found/);
  });

  it('exits 1 with the install hint when gitleaks is not on PATH', () => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^path$/i.test(k)) delete env[k];
    env.PATH = makeTempDir('trace-empty-path-');
    const r = run(cleanRepo(), env);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(INSTALL_HINT);
  });
});
