// scripts/ops/candidate-token-key.mjs (specs/d1-demo-slice.md §4.3, ADR-030, FOUNDER-QUEUE "D1:
// candidate-token key pair"). Real WebCrypto and real files, but only in throwaway directories under
// os.tmpdir(); nothing touches the repo, the network or a database. Every key is generated at run time
// (the pre-commit gitleaks hook rejects secret-shaped literals), so no key is written in this file.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { isValidKid, main, parsePreviousPublic } from '../ops/candidate-token-key.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'ops', 'candidate-token-key.mjs');
const { subtle } = globalThis.crypto;
const P256 = { name: 'ECDSA', namedCurve: 'P-256' };
const ES256 = { name: 'ECDSA', hash: 'SHA-256' };
const KID = 'd1-2026-10';
const PREV_KID = 'd1-2026-09';
const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];

// --- the deploy guard's checks, replicated -------------------------------------------------------------
// scripts/check-deploy-vars.mjs (agent commit b0d2c8c, "ci: d1 staging deploy order, vars, jwk guard")
// is not on this branch, so its validation of CANDIDATE_TOKEN_PUBLIC_JWK and CANDIDATE_TOKEN_KID is
// copied here from `git show b0d2c8c:scripts/check-deploy-vars.mjs` (parseJwkSet, PRIVATE_MEMBERS and the
// kid checks of checkDeployVars). It returns the violations; an empty list means the guard accepts.
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function guardParseJwkSet(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'is not valid JSON' };
  }
  let keys;
  if (Array.isArray(value)) keys = value;
  else if (isObj(value) && Object.hasOwn(value, 'keys')) keys = value.keys;
  else if (isObj(value)) keys = [value];
  else return { error: 'must be one JWK object or a list of JWK objects' };
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 2)
    return { error: 'must hold one key, or two during rotation' };
  if (!keys.every(isObj)) return { error: 'must hold JWK objects only' };
  return { keys };
}

function guardViolations(kidVar, jwkVar) {
  const out = [];
  if (kidVar.trim() === '') out.push('CANDIDATE_TOKEN_KID is empty');
  if (jwkVar.trim() === '') return [...out, 'CANDIDATE_TOKEN_PUBLIC_JWK is empty'];
  const parsed = guardParseJwkSet(jwkVar);
  if (parsed.error) return [...out, `CANDIDATE_TOKEN_PUBLIC_JWK ${parsed.error}`];
  const kids = [];
  let sound = true;
  parsed.keys.forEach((key, i) => {
    if (typeof key.kid !== 'string' || key.kid.trim() === '') {
      out.push(`key ${i} has no kid`);
      sound = false;
    } else if (kids.includes(key.kid)) {
      out.push(`key ${i} has a duplicate kid`);
      sound = false;
    } else kids.push(key.kid);
    for (const member of PRIVATE_MEMBERS) {
      if (Object.hasOwn(key, member)) {
        out.push(`key ${i} has a private member "${member}"`);
        sound = false;
      }
    }
  });
  if (sound && !kids.includes(kidVar.trim())) out.push('CANDIDATE_TOKEN_KID names no key');
  return out;
}

// --- harness -------------------------------------------------------------------------------------------
const made = [];
const guardedPaths = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  // a broken in-repo refusal must not leave directories behind in the working tree
  for (const p of guardedPaths.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** Registers the two key files of KID in `dir` for removal, should a regression ever write them. */
const strayKeyFiles = (dir) => {
  guardedPaths.push(join(dir, names(KID).priv), join(dir, names(KID).pub));
};

/** A fresh directory under os.tmpdir() (real path, so printed paths compare equal). */
function tempDir() {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'trace-ctk-')));
  made.push(dir);
  return dir;
}

async function run(argv, extra = {}) {
  const out = [];
  const err = [];
  const deps = {
    platform: process.platform,
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
    ...extra,
  };
  const code = await main({ argv, deps });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

const names = (kid) => ({
  priv: `candidate-token-${kid}.private.jwk.json`,
  pub: `candidate-token-${kid}.public.json`,
});
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Runs a successful generation into `dir` and returns the parsed files and the run. */
async function generate(dir, kid = KID, more = [], extra = {}) {
  const r = await run(['--kid', kid, '--out-dir', dir, ...more], extra);
  expect(r.stderr, 'stderr of a good run').toBe('');
  expect(r.code).toBe(0);
  const n = names(kid);
  return {
    ...r,
    privFile: join(dir, n.priv),
    pubFile: join(dir, n.pub),
    priv: readJson(join(dir, n.priv)),
    pubText: readFileSync(join(dir, n.pub), 'utf8'),
    pub: readJson(join(dir, n.pub)),
  };
}

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');

describe('kid validation', () => {
  it.each(['d1-2026-01', 'd1-2026-10', 'd1-2026-12', 'd1-2030-09', 'd1-2099-11'])(
    'accepts %s',
    async (kid) => {
      expect(isValidKid(kid)).toBe(true);
      const dir = tempDir();
      const r = await run(['--kid', kid, '--out-dir', dir]);
      expect(r.code).toBe(0);
      expect(readdirSync(dir).sort()).toEqual([names(kid).priv, names(kid).pub].sort());
    },
  );

  it.each([
    'd1-2026-13', // not a month
    'd1-2026-00',
    'd1-2026-1',
    'd1-2026-100',
    'd1-26-10',
    'd1-20266-10',
    'D1-2026-10',
    'd2-2026-10',
    'd1_2026_10',
    'd1-2026-10-extra',
    'd1-2026-10\n',
    ' d1-2026-10',
    'd1-2026-10 ',
    'd1-2o26-10',
    '../d1-2026-10', // the kid becomes part of two file names
    'd1-2026-10/../../x',
    'staging',
    '',
  ])('rejects %j with exit 2, without echoing it, and writes nothing', async (kid) => {
    expect(isValidKid(kid)).toBe(false);
    const dir = tempDir();
    const r = await run(['--kid', kid, '--out-dir', dir]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('candidate-token-key: invalid argument(s): kid');
    expect(r.stderr).toContain('d1-YYYY-MM');
    if (kid.trim() !== '') expect(r.stderr).not.toContain(kid.trim());
    expect(r.stdout).toBe('');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('is not a valid kid when it is not a string', () => {
    for (const v of [undefined, null, 20261, {}, ['d1-2026-10']]) expect(isValidKid(v)).toBe(false);
  });
});

describe('arguments (exit 2, nothing written)', () => {
  it('names every missing required argument', async () => {
    const r = await run([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('kid');
    expect(r.stderr).toContain('out-dir');
    expect(r.stdout).toBe('');
  });

  it.each([
    [['--kid', KID]],
    [['--out-dir', '.']],
    [['--kid', KID, '--out-dir', '']],
    [['--kid', KID, '--out-dir', '   ']],
  ])('requires both --kid and --out-dir: %j', async (argv) => {
    const r = await run(argv);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
  });

  it.each([
    [['--kid', KID, '--out-dir', 'x', '--private-out', 'y']],
    [['--kid', KID, '--out-dir', 'x', 'stray']],
    [['--kid']],
  ])('rejects an unknown or malformed argument: %j', async (argv) => {
    const r = await run(argv);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('candidate-token-key: unknown or malformed argument\n');
    expect(r.stderr).not.toContain('private-out');
    expect(r.stderr).not.toContain('stray');
  });

  it('accepts --flag=value', async () => {
    const dir = tempDir();
    const r = await run([`--kid=${KID}`, `--out-dir=${dir}`]);
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, names(KID).priv))).toBe(true);
  });
});

describe('the generated key pair', () => {
  it('writes exactly the two files and prints exit 0', async () => {
    const dir = tempDir();
    const g = await generate(dir);
    expect(readdirSync(dir).sort()).toEqual([names(KID).priv, names(KID).pub].sort());
    expect(g.pubText).toBe(JSON.stringify(g.pub)); // one compact line: it becomes a deploy variable value
    expect(g.pubText).not.toMatch(/\s/);
  });

  it('has the documented members, and no others', async () => {
    const g = await generate(tempDir());
    expect(Object.keys(g.priv).sort()).toEqual(['alg', 'crv', 'd', 'kid', 'kty', 'use', 'x', 'y']);
    expect(Object.keys(g.pub).sort()).toEqual(['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
    for (const jwk of [g.priv, g.pub]) {
      expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: KID });
    }
    // P-256 coordinates and scalar are 32 bytes: 43 base64url characters, no padding
    for (const m of ['x', 'y']) expect(g.pub[m]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(g.priv.d).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect({ x: g.priv.x, y: g.priv.y }).toEqual({ x: g.pub.x, y: g.pub.y });
  });

  it('puts no private or symmetric member in the public value', async () => {
    const g = await generate(tempDir());
    for (const member of PRIVATE_MEMBERS) expect(Object.hasOwn(g.pub, member)).toBe(false);
    expect(g.pubText).not.toContain(g.priv.d);
  });

  it('gives the public value to the deploy guard (single key) and it accepts', async () => {
    const g = await generate(tempDir());
    expect(guardViolations(KID, g.pubText)).toEqual([]);
    // the guard compares the kid variable with the kids in the value
    expect(guardViolations('d1-2026-11', g.pubText)).toEqual(['CANDIDATE_TOKEN_KID names no key']);
  });

  it('keeps the private and the public key a pair: a signature made with the private JWK verifies', async () => {
    const g = await generate(tempDir());
    const signKey = await subtle.importKey('jwk', g.priv, P256, false, ['sign']);
    const verifyKey = await subtle.importKey('jwk', g.pub, P256, false, ['verify']);
    const header = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: KID }));
    const payload = b64u(JSON.stringify({ typ: 'lobby', iat: 1, exp: 2 }));
    const input = new TextEncoder().encode(`${header}.${payload}`);
    const sig = new Uint8Array(await subtle.sign(ES256, signKey, input));
    expect(sig.byteLength).toBe(64); // IEEE-P1363 r||s, the raw JWS form (not DER)
    expect(await subtle.verify(ES256, verifyKey, sig, input)).toBe(true);
    const tampered = new TextEncoder().encode(`${header}.${b64u(JSON.stringify({ typ: 'x' }))}`);
    expect(await subtle.verify(ES256, verifyKey, sig, tampered)).toBe(false);
  });

  it('does not let the public key sign', async () => {
    const g = await generate(tempDir());
    await expect(subtle.importKey('jwk', g.pub, P256, false, ['sign'])).rejects.toThrow();
  });

  it('generates a different key at each run', async () => {
    const a = await generate(tempDir(), KID);
    const b = await generate(tempDir(), KID);
    expect(a.priv.d).not.toBe(b.priv.d);
    expect(a.pub.x).not.toBe(b.pub.x);
  });
});

describe('output files', () => {
  it('writes the private file with mode 0600 on POSIX (Windows uses ACLs and says so)', async () => {
    const dir = tempDir();
    const g = await generate(dir);
    if (process.platform === 'win32') {
      // Mode bits do not apply: the file inherits the folder's ACL. The run says so instead.
      expect(statSync(g.privFile).isFile()).toBe(true);
      expect(g.stdout).toContain('Windows');
      expect(g.stdout).toContain('ACL');
    } else {
      expect(statSync(g.privFile).mode & 0o777).toBe(0o600);
      expect(statSync(g.pubFile).mode & 0o777).toBe(0o644);
      expect(g.stdout).not.toContain('ACL');
    }
  });

  it('asks for an exclusive create with mode 0600 (private) and 0644 (public) on every platform', async () => {
    // The file-system assertion above only bites on POSIX; this one pins the request itself.
    const calls = [];
    const spy = (file, data, opts) => {
      calls.push({ file, opts });
      return writeFileSync(file, data, opts);
    };
    await generate(tempDir(), KID, [], { writeFileSync: spy });
    const optsOf = (suffix) => calls.find((c) => c.file.endsWith(suffix))?.opts;
    expect(optsOf('.private.jwk.json')).toEqual({ flag: 'wx', mode: 0o600 });
    expect(optsOf('.public.json')).toEqual({ flag: 'wx', mode: 0o644 });
    expect(calls).toHaveLength(2);
  });

  it('prints the Windows ACL note when the platform is win32 and not otherwise', async () => {
    const win = await run(['--kid', KID, '--out-dir', tempDir()], { platform: 'win32' });
    expect(win.stdout).toContain('ACL');
    const linux = await run(['--kid', KID, '--out-dir', tempDir()], { platform: 'linux' });
    expect(linux.stdout).not.toContain('ACL');
  });

  it('creates a missing out-dir (private to the user on POSIX)', async () => {
    const parent = tempDir();
    const dir = join(parent, 'new', 'keys');
    const r = await run(['--kid', KID, '--out-dir', dir]);
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, names(KID).priv))).toBe(true);
    if (process.platform !== 'win32') expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('refuses to overwrite an existing private file and changes nothing', async () => {
    const dir = tempDir();
    const file = join(dir, names(KID).priv);
    writeFileSync(file, 'SENTINEL');
    const r = await run(['--kid', KID, '--out-dir', dir]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('refusing to overwrite');
    expect(r.stdout).toBe('');
    expect(readFileSync(file, 'utf8')).toBe('SENTINEL');
    expect(readdirSync(dir)).toEqual([names(KID).priv]); // the public file was not created either
  });

  it('refuses to overwrite an existing public file and creates no private file', async () => {
    const dir = tempDir();
    const file = join(dir, names(KID).pub);
    writeFileSync(file, 'SENTINEL');
    const r = await run(['--kid', KID, '--out-dir', dir]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('refusing to overwrite');
    expect(readFileSync(file, 'utf8')).toBe('SENTINEL');
    expect(readdirSync(dir)).toEqual([names(KID).pub]);
  });

  it('refuses a second run with the same kid in the same directory', async () => {
    const dir = tempDir();
    const first = await generate(dir);
    const second = await run(['--kid', KID, '--out-dir', dir]);
    expect(second.code).toBe(2);
    expect(readJson(first.privFile)).toEqual(first.priv);
  });

  it('refuses an out-dir that is a file', async () => {
    const dir = tempDir();
    const file = join(dir, 'a-file');
    writeFileSync(file, 'x');
    for (const target of [file, join(file, 'sub')]) {
      const r = await run(['--kid', KID, '--out-dir', target]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('--out-dir');
    }
  });
});

describe('a directory inside the git working tree is refused (exit 2, nothing created)', () => {
  it('refuses a path under this repository, with the default repo root', async () => {
    // node_modules is ignored by git; the directory must never be created.
    const target = join(REPO_ROOT, 'node_modules', 'trace-ctk-refused-dir');
    guardedPaths.push(target);
    const r = await run(['--kid', KID, '--out-dir', target]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('inside the git working tree');
    expect(r.stdout).toBe('');
    expect(existsSync(target)).toBe(false);
  });

  it('refuses an existing directory of this repository', async () => {
    const existing = join(REPO_ROOT, 'node_modules'); // ignored by git, so a regression cannot dirty the tree
    strayKeyFiles(existing);
    const r = await run(['--kid', KID, '--out-dir', existing]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('inside the git working tree');
    expect(existsSync(join(existing, names(KID).priv))).toBe(false);
  });

  it('refuses a relative path and a path with .. segments that resolve into the repository', async () => {
    const inside = join(REPO_ROOT, 'node_modules', 'trace-ctk-refused-rel');
    guardedPaths.push(inside);
    const rel = await run(['--kid', KID, '--out-dir', relative(process.cwd(), inside)]);
    expect(rel.code).toBe(2);
    const dots = join(REPO_ROOT, 'node_modules', '..', 'node_modules', 'trace-ctk-refused-dots');
    guardedPaths.push(join(REPO_ROOT, 'node_modules', 'trace-ctk-refused-dots'));
    expect((await run(['--kid', KID, '--out-dir', dots])).code).toBe(2);
  });

  it('refuses any directory under an injected repo root, existing or not', async () => {
    const repo = tempDir();
    mkdirSync(join(repo, 'secrets'));
    for (const sub of [repo, join(repo, 'secrets'), join(repo, 'a', 'b', 'c')]) {
      const r = await run(['--kid', KID, '--out-dir', sub], { repoRoot: repo });
      expect(r.code, sub).toBe(2);
      expect(r.stderr).toContain('inside the git working tree');
    }
    expect(readdirSync(repo).sort()).toEqual(['secrets']);
    expect(readdirSync(join(repo, 'secrets'))).toEqual([]);
  });

  it('allows a sibling directory whose name starts like the repo root', async () => {
    const parent = tempDir();
    const repo = join(parent, 'repo');
    const sibling = join(parent, 'repo-keys');
    mkdirSync(repo);
    const r = await run(['--kid', KID, '--out-dir', sibling], { repoRoot: repo });
    expect(r.code).toBe(0);
    expect(existsSync(join(sibling, names(KID).priv))).toBe(true);
  });

  it('resolves symlinks first: a link that points into the repo is refused', async () => {
    const parent = tempDir();
    const repo = join(parent, 'repo');
    mkdirSync(join(repo, 'keys'), { recursive: true });
    const link = join(parent, 'link');
    symlinkSync(join(repo, 'keys'), link, 'junction'); // a junction needs no privilege on Windows
    const r = await run(['--kid', KID, '--out-dir', join(link, 'nested')], { repoRoot: repo });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('inside the git working tree');
    expect(readdirSync(join(repo, 'keys'))).toEqual([]);
  });

  it('refuses a directory inside any other git working tree (a .git entry above it)', async () => {
    const outer = tempDir();
    mkdirSync(join(outer, '.git')); // an empty marker is enough: no git command runs
    const r = await run(['--kid', KID, '--out-dir', join(outer, 'sub', 'keys')]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('inside the git working tree');
    expect(existsSync(join(outer, 'sub'))).toBe(false);
  });

  it('refuses when .git is a file, as in a linked worktree', async () => {
    const outer = tempDir();
    writeFileSync(join(outer, '.git'), 'gitdir: elsewhere\n');
    const r = await run(['--kid', KID, '--out-dir', join(outer, 'keys')]);
    expect(r.code).toBe(2);
  });
});

describe('--previous-public (rotation)', () => {
  /** A previous key made by this script, in its own directory. */
  async function previous(kid = PREV_KID) {
    return generate(tempDir(), kid);
  }

  it('merges the previous key after the new one and the guard accepts the set', async () => {
    const prev = await previous();
    const g = await generate(tempDir(), KID, ['--previous-public', prev.pubFile]);
    expect(Array.isArray(g.pub)).toBe(true);
    expect(g.pub.map((k) => k.kid)).toEqual([KID, PREV_KID]); // new first
    expect(g.pub[1]).toEqual(prev.pub); // the previous key is carried over unchanged
    expect(g.pubText).toBe(JSON.stringify(g.pub));
    expect(guardViolations(KID, g.pubText)).toEqual([]);
    for (const k of g.pub) for (const m of PRIVATE_MEMBERS) expect(Object.hasOwn(k, m)).toBe(false);
    // the private file holds the new key only, and the new key is the one that verifies
    expect(g.priv.kid).toBe(KID);
    expect(Object.keys(g.priv)).not.toContain('keys');
    const signKey = await subtle.importKey('jwk', g.priv, P256, false, ['sign']);
    const verifyKey = await subtle.importKey('jwk', g.pub[0], P256, false, ['verify']);
    const msg = new TextEncoder().encode('rotation');
    expect(await subtle.verify(ES256, verifyKey, await subtle.sign(ES256, signKey, msg), msg)).toBe(
      true,
    );
    // the stdout value is the merged one, and the new kid is what the guard's kid variable names
    expect(g.stdout).toContain(g.pubText);
    expect(g.stdout).toContain(`--body ${KID}`);
  });

  it('accepts a previous file written as a list or as a { keys } set', async () => {
    const prev = await previous();
    const dir = tempDir();
    for (const [name, body] of [
      ['list.json', [prev.pub]],
      ['set.json', { keys: [prev.pub] }],
    ]) {
      const file = join(dir, name);
      writeFileSync(file, JSON.stringify(body));
      const g = await generate(tempDir(), KID, ['--previous-public', file]);
      expect(g.pub.map((k) => k.kid)).toEqual([KID, PREV_KID]);
    }
  });

  it('refuses a previous key with a private member, names it, and never echoes the value', async () => {
    const prev = await previous();
    for (const member of PRIVATE_MEMBERS) {
      const dir = tempDir();
      const file = join(dir, 'prev.json');
      const secretValue = b64u(globalThis.crypto.getRandomValues(new Uint8Array(32)));
      writeFileSync(file, JSON.stringify({ ...prev.pub, [member]: secretValue }));
      const out = tempDir();
      const r = await run(['--kid', KID, '--out-dir', out, '--previous-public', file]);
      expect(r.code, member).toBe(2);
      expect(r.stderr).toContain('private member');
      expect(r.stderr).not.toContain(secretValue);
      expect(r.stdout).toBe('');
      expect(readdirSync(out)).toEqual([]);
    }
  });

  it("refuses the previous run's private file, and does not echo any of it", async () => {
    const prev = await previous();
    const out = tempDir();
    const r = await run(['--kid', KID, '--out-dir', out, '--previous-public', prev.privFile]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('private member');
    expect(r.stderr + r.stdout).not.toContain(prev.priv.d);
    expect(readdirSync(out)).toEqual([]);
  });

  it('refuses a private member inside a list or set too', async () => {
    const prev = await previous();
    const other = await previous('d1-2026-08');
    const dir = tempDir();
    const file = join(dir, 'mixed.json');
    writeFileSync(file, JSON.stringify({ keys: [prev.pub, other.priv] }));
    const r = await run(['--kid', KID, '--out-dir', tempDir(), '--previous-public', file]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('private member');
    expect(r.stderr).not.toContain(other.priv.d);
  });

  it('refuses a previous key with the same kid as the new one', async () => {
    const prev = await previous(KID);
    const out = tempDir();
    const r = await run(['--kid', KID, '--out-dir', out, '--previous-public', prev.pubFile]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('duplicate kid');
    expect(readdirSync(out)).toEqual([]);
  });

  it('refuses two previous keys with one kid', async () => {
    const a = await previous(PREV_KID);
    const b = await previous(PREV_KID);
    const file = join(tempDir(), 'dup.json');
    writeFileSync(file, JSON.stringify([a.pub, b.pub]));
    const r = await run(['--kid', KID, '--out-dir', tempDir(), '--previous-public', file]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('duplicate kid');
  });

  it('refuses a result of more than two keys (the deploy guard allows one, or two in rotation)', async () => {
    const a = await previous('d1-2026-08');
    const b = await previous('d1-2026-09');
    const file = join(tempDir(), 'two.json');
    writeFileSync(file, JSON.stringify([a.pub, b.pub]));
    const out = tempDir();
    const r = await run(['--kid', KID, '--out-dir', out, '--previous-public', file]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('at most two keys');
    expect(readdirSync(out)).toEqual([]);
  });

  it('refuses a missing file, bad JSON and shapes that hold no key', async () => {
    const dir = tempDir();
    const cases = [
      ['missing.json', null],
      ['empty.json', ''],
      ['text.json', 'not json'],
      ['number.json', '42'],
      ['null.json', 'null'],
      ['string.json', '"abc"'],
      ['empty-list.json', '[]'],
      ['empty-set.json', '{"keys":[]}'],
      ['nested.json', '[[1]]'],
      ['scalars.json', '[1,2]'],
    ];
    for (const [name, body] of cases) {
      const file = join(dir, name);
      if (body !== null) writeFileSync(file, body);
      const out = tempDir();
      const r = await run(['--kid', KID, '--out-dir', out, '--previous-public', file]);
      expect(r.code, name).toBe(2);
      expect(r.stderr, name).toContain('--previous-public');
      expect(readdirSync(out), name).toEqual([]);
    }
  });

  it('refuses a previous key that is malformed', async () => {
    const prev = await previous();
    const dir = tempDir();
    const bad = {
      'no-kid': (k) => ({ ...k, kid: undefined }),
      'empty-kid': (k) => ({ ...k, kid: '' }),
      'wrong-form-kid': (k) => ({ ...k, kid: 'staging-key' }),
      'wrong-kty': (k) => ({ ...k, kty: 'RSA' }),
      'wrong-crv': (k) => ({ ...k, crv: 'P-384' }),
      'wrong-alg': (k) => ({ ...k, alg: 'RS256' }),
      'wrong-use': (k) => ({ ...k, use: 'enc' }),
      'no-x': (k) => ({ ...k, x: undefined }),
      'x-number': (k) => ({ ...k, x: 5 }),
      'unexpected-member': (k) => ({ ...k, key_ops: ['verify'] }),
      'point-off-curve': (k) => ({ ...k, y: k.x }),
    };
    for (const [name, mutate] of Object.entries(bad)) {
      const file = join(dir, `${name}.json`);
      writeFileSync(file, JSON.stringify(mutate(prev.pub)));
      const out = tempDir();
      const r = await run(['--kid', KID, '--out-dir', out, '--previous-public', file]);
      expect(r.code, name).toBe(2);
      expect(r.stderr, name).toContain('--previous-public');
      expect(readdirSync(out), name).toEqual([]);
    }
  });

  it('checks the previous file before it generates anything', async () => {
    const out = tempDir();
    const calls = [];
    const spy = {
      generateKey: (...a) => (calls.push('generateKey'), subtle.generateKey(...a)),
      importKey: (...a) => subtle.importKey(...a),
    };
    const r = await run(
      ['--kid', KID, '--out-dir', out, '--previous-public', join(out, 'nope.json')],
      { subtle: spy },
    );
    expect(r.code).toBe(2);
    expect(calls).toEqual([]);
  });
});

describe('the private key never leaves the two files', () => {
  /** Everything a run can show, checked against the private scalar and the whole private file. */
  function expectNoPrivateMaterial(r, g) {
    const all = `${r.stdout}\n${r.stderr}`;
    expect(all).not.toContain(g.priv.d);
    expect(all).not.toContain(readFileSync(g.privFile, 'utf8'));
    expect(all).not.toMatch(/"d"\s*:/);
    expect(all).not.toMatch(/\\"d\\"/);
  }

  it('keeps it out of stdout and stderr on success', async () => {
    const g = await generate(tempDir());
    expectNoPrivateMaterial(g, g);
    expect(g.stderr).toBe('');
  });

  it('keeps it out of stdout and stderr on success with a previous key', async () => {
    const prev = await generate(tempDir(), PREV_KID);
    const g = await generate(tempDir(), KID, ['--previous-public', prev.pubFile]);
    expectNoPrivateMaterial(g, g);
    expect(g.stdout + g.stderr).not.toContain(prev.priv.d);
  });

  it('prints the kid, the public value and the three commands, with the private file as input only', async () => {
    const dir = tempDir();
    const g = await generate(dir);
    const lines = g.stdout.split('\n');
    expect(lines).toContain(`gh variable set CANDIDATE_TOKEN_KID --env staging --body ${KID}`);
    expect(lines).toContain(
      `gh variable set CANDIDATE_TOKEN_PUBLIC_JWK --env staging < "${g.pubFile}"`,
    );
    expect(lines).toContain(
      `pnpm exec wrangler secret put CANDIDATE_TOKEN_PRIVATE_JWK --env staging < "${g.privFile}"`,
    );
    expect(g.stdout).toContain(g.pubText);
    expect(g.stdout).toContain('services/api');
    expect(g.stdout).toMatch(/delete the private file/i);
    // the private file's *path* appears (in the wrangler command and the note), its content does not
    expect(g.stdout.split(g.privFile).length - 1).toBeGreaterThanOrEqual(1);
  });

  it('prints fixed messages for a failing key generation, never the underlying error', async () => {
    const canary = b64u(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    const dir = tempDir();
    const broken = {
      generateKey: () => Promise.reject(new Error(`boom ${canary}`)),
      importKey: subtle.importKey.bind(subtle),
    };
    const r = await run(['--kid', KID, '--out-dir', dir], { subtle: broken });
    expect(r.code).toBe(1);
    expect(r.stderr).toBe('candidate-token-key: generating the key pair failed\n');
    expect(r.stdout).toBe('');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('prints a fixed message when exporting fails, never the exported key', async () => {
    const canary = b64u(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    const dir = tempDir();
    const broken = {
      generateKey: subtle.generateKey.bind(subtle),
      exportKey: () => Promise.reject(new Error(`export ${canary}`)),
      importKey: subtle.importKey.bind(subtle),
    };
    const r = await run(['--kid', KID, '--out-dir', dir], { subtle: broken });
    expect(r.code).toBe(1);
    expect(r.stderr + r.stdout).not.toContain(canary);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('writes nothing and exits 1 when the exported pair fails its own sign-and-verify check', async () => {
    const dir = tempDir();
    const lying = {
      generateKey: subtle.generateKey.bind(subtle),
      exportKey: subtle.exportKey.bind(subtle),
      importKey: subtle.importKey.bind(subtle),
      sign: subtle.sign.bind(subtle),
      verify: () => Promise.resolve(false),
    };
    const r = await run(['--kid', KID, '--out-dir', dir], { subtle: lying });
    expect(r.code).toBe(1);
    expect(r.stderr).toBe('candidate-token-key: the generated key pair failed its self-test\n');
    expect(r.stdout).toBe('');
    expect(readdirSync(dir)).toEqual([]);
  });

  it("writes nothing when the exported public key is not the private key's partner", async () => {
    const dir = tempDir();
    const other = await subtle.generateKey(P256, true, ['sign', 'verify']);
    let exports = 0;
    const swapped = {
      generateKey: subtle.generateKey.bind(subtle),
      // the second export (the public key) comes from a different pair
      exportKey: (format, key) => subtle.exportKey(format, ++exports === 2 ? other.publicKey : key),
      importKey: subtle.importKey.bind(subtle),
      sign: subtle.sign.bind(subtle),
      verify: subtle.verify.bind(subtle),
    };
    const r = await run(['--kid', KID, '--out-dir', dir], { subtle: swapped });
    expect(r.code).toBe(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('writes nothing when the verifier accepts a tampered message', async () => {
    const dir = tempDir();
    const gullible = {
      generateKey: subtle.generateKey.bind(subtle),
      exportKey: subtle.exportKey.bind(subtle),
      importKey: subtle.importKey.bind(subtle),
      sign: subtle.sign.bind(subtle),
      verify: () => Promise.resolve(true),
    };
    const r = await run(['--kid', KID, '--out-dir', dir], { subtle: gullible });
    expect(r.code).toBe(1);
    expect(r.stderr).toBe('candidate-token-key: the generated key pair failed its self-test\n');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('prints a fixed message with the error code when a write fails, and leaves no file', async () => {
    const canary = b64u(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    for (const failAt of [1, 2]) {
      const dir = tempDir();
      let n = 0;
      const flaky = (file, data, opts) => {
        n += 1;
        if (n === failAt) throw Object.assign(new Error(`disk ${canary}`), { code: 'ENOSPC' });
        return writeFileSync(file, data, opts);
      };
      const r = await run(['--kid', KID, '--out-dir', dir], { writeFileSync: flaky });
      expect(r.code, `write ${failAt}`).toBe(1);
      expect(r.stderr).toBe('candidate-token-key: writing the key files failed (ENOSPC)\n');
      expect(r.stdout).toBe('');
      expect(readdirSync(dir)).toEqual([]);
    }
  });

  it('refuses a directory standing where a key file must go', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, names(KID).pub));
    const r = await run(['--kid', KID, '--out-dir', dir]);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(existsSync(join(dir, names(KID).priv))).toBe(false);
  });
});

describe('as a real process (isEntryPoint, real stdout and stderr)', () => {
  const node = (args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', shell: false });

  it('exits 0, prints the commands, and leaks nothing to either stream', () => {
    const dir = tempDir();
    const res = node(['--kid', KID, '--out-dir', dir]);
    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    const priv = readJson(join(dir, names(KID).priv));
    const all = res.stdout + res.stderr;
    expect(all).not.toContain(priv.d);
    expect(all).not.toMatch(/"d"\s*:/);
    expect(res.stdout).toContain('gh variable set CANDIDATE_TOKEN_KID --env staging --body');
    expect(res.stdout).toContain(readFileSync(join(dir, names(KID).pub), 'utf8'));
  });

  it('exits 2 on a bad kid and 2 on no arguments, with nothing on stdout', () => {
    const dir = tempDir();
    const bad = node(['--kid', 'd1-2026-13', '--out-dir', dir]);
    expect(bad.status).toBe(2);
    expect(bad.stdout).toBe('');
    expect(readdirSync(dir)).toEqual([]);
    expect(node([]).status).toBe(2);
  });

  it('exits 2 for an out-dir inside this repository', () => {
    const target = join(REPO_ROOT, 'node_modules', 'trace-ctk-refused-proc');
    guardedPaths.push(target);
    const res = node(['--kid', KID, '--out-dir', target]);
    expect(res.status).toBe(2);
    expect(existsSync(target)).toBe(false);
  });
});

describe('parsePreviousPublic', () => {
  it('returns the keys of a bare object, a list or a set, and an error for anything else', () => {
    const key = { kty: 'EC', crv: 'P-256', x: 'a', y: 'b', kid: PREV_KID };
    expect(parsePreviousPublic(JSON.stringify(key)).keys).toHaveLength(1);
    expect(parsePreviousPublic(JSON.stringify([key])).keys).toHaveLength(1);
    expect(parsePreviousPublic(JSON.stringify({ keys: [key] })).keys).toHaveLength(1);
    expect(parsePreviousPublic('nope').error).toBeTypeOf('string');
    expect(parsePreviousPublic('[]').error).toBeTypeOf('string');
  });
});
