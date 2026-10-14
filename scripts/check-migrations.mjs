#!/usr/bin/env node
// Migration rules (spec specs/m0-foundations.md §8.4, AT-17).
//   node scripts/check-migrations.mjs [--base <ref>]     (else $MIGRATIONS_BASE, else `main`)
// 1. every entry in supabase/migrations/ is a file named ^\d{14}_(m\d{1,2}[ab]?|d1)_[a-z0-9_]+\.sql$
//    (d1 = the demo slice between M0b and M1, docs/build-order.md, specs/d1-demo-slice.md §3.1)
//    (a missing directory counts as "no migrations" only while supabase/config.toml is also missing)
// 2. the 14 digits are a real UTC timestamp, no later than now + 1 day
// 3. versions are unique
// 4. against `git merge-base <base> HEAD` and the working tree (plus untracked files): no existing
//    migration is modified or deleted, and every new version is newer than the newest at the base tip
// 5. frozen set: migrations at the base tip and at every m*-reviewed tag that is an ancestor of HEAD
//    are byte-identical in the working tree
// A base that does not resolve, or a missing merge-base, fails (exit 1); the script never passes vacuously.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = 'supabase/migrations';
export const NAME_RE = /^(\d{14})_(?:m\d{1,2}[ab]?|d1)_[a-z0-9_]+\.sql$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const violation = (p, message) => ({ path: p, message });
const rel = (name) => `${MIGRATIONS_DIR}/${name}`;

/** `YYYYMMDDHHMMSS` → epoch ms (UTC), or null if it is not a real date and time. */
export function parseVersion(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  const dt = new Date(t);
  const same =
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d &&
    dt.getUTCHours() === h &&
    dt.getUTCMinutes() === mi &&
    dt.getUTCSeconds() === s;
  return same ? t : null;
}

/** Checks 1–3 over directory entries `{ name, isDirectory }`. */
export function validateEntries(entries, now = new Date()) {
  const out = [];
  const seen = new Map();
  for (const { name, isDirectory } of entries) {
    if (isDirectory) {
      out.push(violation(rel(name), 'sub-directories are not allowed in supabase/migrations/'));
      continue;
    }
    const m = NAME_RE.exec(name);
    if (!m) {
      out.push(
        violation(
          rel(name),
          'name must match <14-digit UTC timestamp>_m<N>[a|b]_<snake_case>.sql or _d1_<snake_case>.sql (create it with `pnpm exec supabase migration new`)',
        ),
      );
      continue;
    }
    const version = m[1];
    const t = parseVersion(version);
    if (t === null) {
      out.push(violation(rel(name), `version ${version} is not a real UTC date and time`));
      continue;
    }
    if (t > now.getTime() + DAY_MS) {
      out.push(violation(rel(name), `version ${version} is later than now + 1 day`));
    }
    if (seen.has(version)) {
      out.push(
        violation(rel(name), `duplicate version ${version} (also ${rel(seen.get(version))})`),
      );
    } else {
      seen.set(version, name);
    }
  }
  return out;
}

/** --base <ref> | --base=<ref>, else MIGRATIONS_BASE, else main. */
export function resolveBase(argv, env) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) throw new Error('--base needs a ref');
      return v;
    }
    if (a.startsWith('--base=')) {
      const v = a.slice('--base='.length);
      if (!v) throw new Error('--base needs a ref');
      return v;
    }
  }
  return env.MIGRATIONS_BASE || 'main';
}

function git(root, args, { buffer = false } = {}) {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: buffer ? 'buffer' : 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    ok: !r.error && r.status === 0,
    out: r.stdout,
    err: r.error?.message ?? String(r.stderr),
  };
}

function mustGit(root, args, opts) {
  const r = git(root, args, opts);
  if (!r.ok) throw new Error(`git ${args.join(' ')} failed: ${r.err.trim()}`);
  return r.out;
}

/** Migrations at a ref: Map name → blob sha. */
function migrationsAt(root, ref) {
  const out = mustGit(root, ['ls-tree', '-z', ref, '--', `${MIGRATIONS_DIR}/`]);
  const map = new Map();
  for (const entry of out.split('\0')) {
    if (!entry) continue;
    const tab = entry.indexOf('\t');
    const [, type, sha] = entry.slice(0, tab).split(' ');
    const p = entry.slice(tab + 1);
    if (type === 'blob') map.set(path.posix.basename(p), sha);
  }
  return map;
}

const versionOf = (name) => NAME_RE.exec(name)?.[1] ?? null;

/**
 * Runs every check for the repository at `root` against `base`.
 * @returns {{ ok: boolean, violations: {path: string, message: string}[] }}
 */
export function checkMigrations({ root, base, now = new Date() }) {
  const fail = (p, message) => ({ ok: false, violations: [violation(p, message)] });

  const resolved = git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  if (!resolved.ok) {
    return fail(
      base,
      `base ref "${base}" does not resolve (create it, e.g. \`git branch main origin/main\`, or pass --base)`,
    );
  }
  const baseSha = resolved.out.trim();
  const mb = git(root, ['merge-base', baseSha, 'HEAD']);
  if (!mb.ok) return fail(base, `git merge-base ${base} HEAD failed: no common ancestor`);
  const mergeBase = mb.out.trim();

  const dir = path.join(root, ...MIGRATIONS_DIR.split('/'));
  const violations = [];
  let entries = [];
  if (existsSync(dir)) {
    entries = readdirSync(dir, { withFileTypes: true }).map((d) => ({
      name: d.name,
      isDirectory: d.isDirectory(),
    }));
  } else if (existsSync(path.join(root, 'supabase', 'config.toml'))) {
    violations.push(
      violation(MIGRATIONS_DIR, 'supabase/migrations/ is missing but supabase/config.toml exists'),
    );
  }

  // Checks 1–3.
  violations.push(...validateEntries(entries, now));

  // Check 4: changes since the merge-base, in the working tree.
  const diff = mustGit(root, [
    'diff',
    '--no-renames',
    '--name-status',
    '-z',
    mergeBase,
    '--',
    `${MIGRATIONS_DIR}/`,
  ]).split('\0');
  const added = new Set();
  for (let i = 0; i + 1 < diff.length; i += 2) {
    const status = diff[i];
    const p = diff[i + 1];
    if (!status) break;
    const name = path.posix.basename(p);
    if (status === 'A') added.add(name);
    else if (status === 'D')
      violations.push(violation(p, 'existing migration was deleted (or renamed)'));
    else
      violations.push(
        violation(
          p,
          `existing migration was modified (status ${status}); fix forward with a new migration`,
        ),
      );
  }
  for (const p of mustGit(root, [
    'ls-files',
    '-z',
    '-o',
    '--exclude-standard',
    '--',
    `${MIGRATIONS_DIR}/`,
  ]).split('\0')) {
    if (p) added.add(path.posix.basename(p));
  }
  const atTip = migrationsAt(root, baseSha);
  const tipVersions = [...atTip.keys()].map(versionOf).filter(Boolean).sort();
  const newestAtTip = tipVersions.at(-1);
  if (newestAtTip) {
    for (const name of [...added].sort()) {
      if (atTip.has(name)) continue;
      const v = versionOf(name);
      if (v && v <= newestAtTip) {
        violations.push(
          violation(
            rel(name),
            `new version ${v} is not newer than ${newestAtTip}, the newest migration at the base tip (${base}); recreate it with \`pnpm exec supabase migration new\``,
          ),
        );
      }
    }
  }

  // Check 5: frozen set.
  const frozen = new Map(); // name → { sha, source }
  for (const [name, sha] of atTip) frozen.set(name, { sha, source: `base tip ${base}` });
  const tags = mustGit(root, ['tag', '--list', 'm*-reviewed'])
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .sort();
  for (const tag of tags) {
    const anc = spawnSync('git', ['merge-base', '--is-ancestor', `${tag}^{commit}`, 'HEAD'], {
      cwd: root,
    });
    if (anc.status === 1) continue;
    if (anc.status !== 0) throw new Error(`git merge-base --is-ancestor ${tag} HEAD failed`);
    for (const [name, sha] of migrationsAt(root, tag)) {
      if (!frozen.has(name)) frozen.set(name, { sha, source: `tag ${tag}` });
      else if (frozen.get(name).sha !== sha) {
        violations.push(
          violation(
            rel(name),
            `frozen migration differs between ${frozen.get(name).source} and tag ${tag}`,
          ),
        );
      }
    }
  }
  for (const [name, { sha, source }] of [...frozen].sort(([a], [b]) => a.localeCompare(b))) {
    const abs = path.join(dir, name);
    if (!existsSync(abs)) {
      violations.push(
        violation(rel(name), `frozen migration (${source}) is missing from the working tree`),
      );
      continue;
    }
    const expected = mustGit(root, ['cat-file', 'blob', sha], { buffer: true });
    if (!readFileSync(abs).equals(expected)) {
      violations.push(
        violation(
          rel(name),
          `frozen migration (${source}) is not byte-identical in the working tree`,
        ),
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

function isMain() {
  if (!process.argv[1]) return false;
  const a = path.resolve(process.argv[1]);
  const b = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isMain()) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const base = resolveBase(process.argv.slice(2), process.env);
    const { ok, violations } = checkMigrations({ root, base });
    for (const v of violations) console.error(`check-migrations: ${v.path}: ${v.message}`);
    if (!ok) {
      console.error(`check-migrations: ${violations.length} violation(s) (spec §8.4)`);
      process.exit(1);
    }
    const dirExists = existsSync(path.join(root, ...MIGRATIONS_DIR.split('/')));
    console.log(
      `check-migrations: OK against ${base}${dirExists ? '' : ' (no supabase/ yet: allowed before S1.7)'}`,
    );
  } catch (err) {
    console.error(`check-migrations: ${err.message}`);
    process.exit(1);
  }
}
