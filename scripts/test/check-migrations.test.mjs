// AT-17: scripts/check-migrations.mjs over fixture git repositories (spec §8.4).
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkMigrations,
  parseVersion,
  resolveBase,
  validateEntries,
} from '../check-migrations.mjs';
import {
  cleanupTempDirs,
  commitAll,
  git,
  initRepo,
  writeFiles,
} from './fixtures/checks/temp-repo.mjs';

afterEach(cleanupTempDirs);

const NOW = new Date(Date.UTC(2026, 9, 11, 12, 0, 0)); // 2026-10-11T12:00:00Z
const M1 = '20261010090000_m0a_baseline.sql';
const M2 = '20261011090000_m0b_orgs.sql';
const mig = (name) => `supabase/migrations/${name}`;
const sql = (n) => `-- synthetic fixture migration ${n}\nselect 1;\n`;

/** Repo with config.toml and one migration on main, plus a feature branch checked out. */
function repoWithBaseline() {
  const repo = initRepo();
  writeFiles(repo, { 'supabase/config.toml': 'project_id = "trace"\n', [mig(M1)]: sql(1) });
  commitAll(repo, 'baseline');
  git(repo, 'checkout', '-q', '-b', 'feature');
  return repo;
}

const run = (repo, base = 'main') => checkMigrations({ root: repo, base, now: NOW });
const messages = (r) => r.violations.map((v) => v.message).join('\n');

describe('names, timestamps and uniqueness (checks 1–3)', () => {
  it('parses a real UTC timestamp', () => {
    expect(parseVersion('20261011090000')).toEqual(Date.UTC(2026, 9, 11, 9, 0, 0));
    expect(parseVersion('20261332000000')).toBeNull(); // month 13
    expect(parseVersion('20260230000000')).toBeNull(); // 30 February
    expect(parseVersion('20261011246000')).toBeNull(); // hour 24
  });

  it.each([
    ['README.md', 'file'],
    ['20261011090000_M0B_orgs.sql', 'file'],
    ['20261011090000_orgs.sql', 'file'],
    ['2026101109000_m0b_orgs.sql', 'file'],
    ['20261011090000_m0b_orgs.SQL', 'file'],
    ['20261011090000_m100_x.sql', 'file'],
    ['20261011090000_m0c_x.sql', 'file'],
    ['nested', 'dir'],
    ['.gitkeep', 'file'],
  ])('rejects the entry %s', (name, kind) => {
    const v = validateEntries([{ name, isDirectory: kind === 'dir' }], NOW);
    expect(v).toHaveLength(1);
  });

  it('accepts well-formed names', () => {
    const entries = [M1, M2, '20261011100000_m12_reports_v2.sql', '20261011110000_m3b_x.sql'].map(
      (name) => ({ name, isDirectory: false }),
    );
    expect(validateEntries(entries, NOW)).toEqual([]);
  });

  it('rejects an impossible date and a timestamp later than now + 1 day', () => {
    const v = validateEntries(
      [
        { name: '20261301000000_m1_bad_month.sql', isDirectory: false },
        { name: '20261012120001_m1_future.sql', isDirectory: false },
        { name: '20261012120000_m1_edge.sql', isDirectory: false },
      ],
      NOW,
    );
    expect(v.map((x) => x.path)).toEqual([
      'supabase/migrations/20261301000000_m1_bad_month.sql',
      'supabase/migrations/20261012120001_m1_future.sql',
    ]);
  });

  it('rejects duplicate versions', () => {
    const v = validateEntries(
      [
        { name: '20261011090000_m0b_a.sql', isDirectory: false },
        { name: '20261011090000_m0b_b.sql', isDirectory: false },
      ],
      NOW,
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/duplicate version 20261011090000/);
  });
});

describe('base resolution', () => {
  it('takes --base, then MIGRATIONS_BASE, then main', () => {
    expect(resolveBase(['--base', 'origin/main'], { MIGRATIONS_BASE: 'x' })).toBe('origin/main');
    expect(resolveBase(['--base=topic'], {})).toBe('topic');
    expect(resolveBase([], { MIGRATIONS_BASE: 'origin/main' })).toBe('origin/main');
    expect(resolveBase([], {})).toBe('main');
    expect(() => resolveBase(['--base'], {})).toThrow(/--base needs a ref/);
  });

  it('fails and names the ref when the base does not resolve', () => {
    const repo = repoWithBaseline();
    const r = run(repo, 'origin/main');
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain('origin/main');
  });

  it('fails when there is no merge-base', () => {
    const repo = repoWithBaseline();
    git(repo, 'checkout', '-q', '--orphan', 'unrelated');
    writeFiles(repo, { 'x.txt': 'x\n' });
    commitAll(repo, 'unrelated root');
    git(repo, 'checkout', '-q', 'feature');
    const r = run(repo, 'unrelated');
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/merge-base/);
  });
});

describe('missing supabase/migrations', () => {
  it('passes before config.toml exists (before S1.7), but still needs a base', () => {
    const repo = initRepo();
    writeFiles(repo, { 'README.md': 'x\n' });
    commitAll(repo);
    expect(run(repo).ok).toBe(true);
    expect(run(repo, 'nope').ok).toBe(false);
  });

  it('fails once config.toml exists', () => {
    const repo = initRepo();
    writeFiles(repo, { 'supabase/config.toml': 'project_id = "trace"\n' });
    commitAll(repo);
    const r = run(repo);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/supabase\/migrations\/ is missing/);
  });
});

describe('changes against the base (check 4)', () => {
  it('passes on main itself and on a branch with a new, newer migration', () => {
    const repo = repoWithBaseline();
    expect(run(repo).ok).toBe(true);
    git(repo, 'checkout', '-q', 'main');
    expect(run(repo).ok).toBe(true);
    git(repo, 'checkout', '-q', 'feature');
    writeFiles(repo, { [mig(M2)]: sql(2) });
    commitAll(repo, 'add m2');
    expect(run(repo)).toEqual({ ok: true, violations: [] });
  });

  it('checks an untracked new migration', () => {
    const repo = repoWithBaseline();
    writeFiles(repo, { [mig('20261009000000_m0b_older.sql')]: sql(2) });
    const r = run(repo);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/not newer than .*20261010090000/);
  });

  it('rejects an uncommitted edit to an existing migration', () => {
    const repo = repoWithBaseline();
    writeFiles(repo, { [mig(M1)]: sql(1) + '-- edited\n' });
    const r = run(repo);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/modified/);
  });

  it('rejects a deletion and a rename', () => {
    const repo = repoWithBaseline();
    git(repo, 'mv', mig(M1), mig('20261010090000_m0a_renamed.sql'));
    const r = run(repo);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/deleted/);
  });

  it('rejects a new migration older than the base tip, even if newer than the merge-base', () => {
    const repo = repoWithBaseline();
    // The branch adds 10:00; main later gets 11:00. The branch's migration is now out of order.
    writeFiles(repo, { [mig('20261011100000_m0b_branch.sql')]: sql(3) });
    commitAll(repo, 'branch migration');
    git(repo, 'checkout', '-q', 'main');
    writeFiles(repo, { [mig('20261011110000_m0b_main.sql')]: sql(4) });
    commitAll(repo, 'main migration');
    git(repo, 'checkout', '-q', 'feature');
    const r = run(repo);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/20261011100000.*not newer than .*20261011110000/);
  });
});

describe('frozen set (check 5)', () => {
  it('rejects an edit to a migration frozen by an m*-reviewed tag, even on main', () => {
    const repo = initRepo();
    writeFiles(repo, { 'supabase/config.toml': 'x = 1\n', [mig(M1)]: sql(1) });
    commitAll(repo, 'baseline');
    git(repo, 'tag', 'm0a-reviewed');
    // Someone amends the reviewed migration on main itself (merge-base == HEAD).
    writeFiles(repo, { [mig(M1)]: sql(1) + '-- sneaky\n' });
    commitAll(repo, 'amend');
    const r = run(repo);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/frozen.*m0a-reviewed/);
  });

  it('ignores reviewed tags that are not ancestors of HEAD', () => {
    const repo = repoWithBaseline();
    git(repo, 'checkout', '-q', '-b', 'side', 'main');
    writeFiles(repo, { [mig(M2)]: sql(2) });
    commitAll(repo, 'side');
    git(repo, 'tag', 'm9-reviewed');
    git(repo, 'checkout', '-q', 'feature');
    expect(run(repo).ok).toBe(true);
  });

  it('rejects a branch that is missing a migration present at the base tip', () => {
    const repo = repoWithBaseline();
    git(repo, 'checkout', '-q', 'main');
    writeFiles(repo, { [mig(M2)]: sql(2) });
    commitAll(repo, 'main adds m2');
    git(repo, 'checkout', '-q', 'feature');
    const r = run(repo);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/frozen.*missing/);
  });

  it('compares bytes exactly (CRLF counts as a change)', () => {
    const repo = repoWithBaseline();
    writeFileSync(path.join(repo, 'supabase', 'migrations', M1), sql(1).replace(/\n/g, '\r\n'));
    expect(run(repo).ok).toBe(false);
  });

  it('fails when a frozen migration is deleted from the working tree', () => {
    const repo = repoWithBaseline();
    rmSync(path.join(repo, 'supabase', 'migrations', M1));
    writeFiles(repo, { [mig(M2)]: sql(2) });
    expect(run(repo).ok).toBe(false);
  });
});
