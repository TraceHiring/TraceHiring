// AT-19: scripts/gen-catalog-tests.mjs over temp directories and fixture git repositories
// (spec specs/m0-foundations.md §8.5). Synthetic SQL only.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertionCount,
  checkFileProblems,
  fixtureProblems,
  genCatalogTests,
  generate,
  HEADER,
  lexSql,
  loadCatalog,
  main,
  OUTPUT,
  parseFloor,
  validateManifest,
} from '../gen-catalog-tests.mjs';
import {
  cleanupTempDirs,
  commitAll,
  git,
  initRepo,
  makeTempDir,
  writeFiles,
} from './fixtures/checks/temp-repo.mjs';

afterEach(cleanupTempDirs);

const DIR = 'supabase/catalog-checks';
const FX = `${DIR}/fixtures`;
const CAT_FLOOR = 'supabase/tests/catalog-min-count';
const RLS_FLOOR = 'supabase/tests/rls-min-count';

const check = (branch) =>
  `-- synthetic check\nselect '${branch}'::text as branch, 'x'::text as object, 'y'::text as detail\nwhere false;\n`;
const fixture = (name) => `-- synthetic fixture\ncreate table public.${name} (id int);\n`;

const MANIFEST = {
  $comment: 'synthetic test manifest',
  checks: [
    { id: 'MT-1', branches: ['table_without_rls', 'partition_without_rls'] },
    {
      id: 'MT-11',
      branches: [
        'for_all',
        { id: 'insert_without_check', unreachable: 'ERROR:  synthetic error text' },
      ],
    },
  ],
};

/** A valid catalog tree: files keyed by repo-relative path. */
function catalogFiles(manifest = MANIFEST) {
  return {
    [`${DIR}/manifest.json`]: JSON.stringify(manifest, null, 2) + '\n',
    [`${DIR}/MT-1.sql`]: check('table_without_rls'),
    [`${DIR}/MT-11.sql`]: check('for_all').replace(/;\n$/, '\n'),
    [`${FX}/MT-1.table_without_rls.violation.sql`]: fixture('mt_1_a'),
    [`${FX}/MT-1.partition_without_rls.violation.sql`]: fixture('mt_1_b'),
    [`${FX}/MT-11.for_all.violation.sql`]: fixture('mt_11_a'),
    [CAT_FLOOR]: '5\n',
    [RLS_FLOOR]: '0\n',
  };
}

/** A temp dir (no git) holding a valid catalog plus its generated file. */
function catalogDir(extra = {}, remove = []) {
  const root = makeTempDir('trace-gen-');
  writeFiles(root, catalogFiles());
  for (const rel of remove) rmSync(path.join(root, ...rel.split('/')), { force: true });
  writeFiles(root, extra);
  return root;
}

function writeGenerated(root) {
  const r = genCatalogTests({ root, check: false });
  expect(r.problems).toEqual([]);
}

/** Repo with a valid catalog committed on main, then a feature branch checked out. */
function repoWithCatalog(files = catalogFiles()) {
  const repo = initRepo();
  writeFiles(repo, files);
  writeGenerated(repo);
  commitAll(repo, 'catalog');
  git(repo, 'checkout', '-q', '-b', 'feature');
  return repo;
}

const problemsOf = (root) => genCatalogTests({ root, check: false }).problems.join('\n');
const checkRun = (root, base = 'main') => genCatalogTests({ root, check: true, base });

const EXPECTED = [
  HEADER,
  'begin;',
  'select plan(5);',
  '-- MT-1',
  'select is_empty($q$',
  '-- synthetic check',
  "select 'table_without_rls'::text as branch, 'x'::text as object, 'y'::text as detail",
  'where false',
  "$q$, 'MT-1: clean');",
  'savepoint mt;',
  '-- synthetic fixture',
  'create table public.mt_1_a (id int);',
  'reset role;',
  'select isnt_empty($q$',
  'select * from (',
  '-- synthetic check',
  "select 'table_without_rls'::text as branch, 'x'::text as object, 'y'::text as detail",
  'where false',
  ") as v where v.branch = 'table_without_rls'",
  "$q$, 'MT-1.table_without_rls: fires');",
  'rollback to savepoint mt;',
  'savepoint mt;',
  '-- synthetic fixture',
  'create table public.mt_1_b (id int);',
  'reset role;',
  'select isnt_empty($q$',
  'select * from (',
  '-- synthetic check',
  "select 'table_without_rls'::text as branch, 'x'::text as object, 'y'::text as detail",
  'where false',
  ") as v where v.branch = 'partition_without_rls'",
  "$q$, 'MT-1.partition_without_rls: fires');",
  'rollback to savepoint mt;',
  '-- MT-11',
  'select is_empty($q$',
  '-- synthetic check',
  "select 'for_all'::text as branch, 'x'::text as object, 'y'::text as detail",
  'where false',
  "$q$, 'MT-11: clean');",
  'savepoint mt;',
  '-- synthetic fixture',
  'create table public.mt_11_a (id int);',
  'reset role;',
  'select isnt_empty($q$',
  'select * from (',
  '-- synthetic check',
  "select 'for_all'::text as branch, 'x'::text as object, 'y'::text as detail",
  'where false',
  ") as v where v.branch = 'for_all'",
  "$q$, 'MT-11.for_all: fires');",
  'rollback to savepoint mt;',
  'select * from finish();',
  'rollback;',
].join('\n');

describe('generation', () => {
  it('writes the exact pgTAP file: manifest order, branch filter, no unreachable branch', () => {
    const root = catalogDir();
    const r = genCatalogTests({ root, check: false });
    expect(r).toMatchObject({ ok: true, problems: [], count: 5 });
    const text = readFileSync(path.join(root, ...OUTPUT.split('/')), 'utf8');
    expect(text).toBe(EXPECTED + '\n');
    expect(text).not.toContain('\r');
    expect(text).not.toContain('insert_without_check');
  });

  it('is deterministic and normalises CRLF sources to LF', () => {
    const root = catalogDir({
      [`${DIR}/MT-1.sql`]: check('table_without_rls').replace(/\n/g, '\r\n'),
      [`${FX}/MT-1.table_without_rls.violation.sql`]: fixture('mt_1_a').replace(/\n/g, '\r\n'),
    });
    const first = loadCatalog(root);
    expect(first.problems).toEqual([]);
    expect(generate(first.catalog)).toBe(EXPECTED + '\n');
    expect(generate(loadCatalog(root).catalog)).toBe(generate(first.catalog));
  });

  it('counts checks plus reachable branches', () => {
    const { catalog } = loadCatalog(catalogDir());
    expect(assertionCount(catalog)).toBe(5);
  });

  it('does not write the file when validation fails', () => {
    const root = catalogDir({}, [`${DIR}/MT-1.sql`]);
    const r = genCatalogTests({ root, check: false });
    expect(r.ok).toBe(false);
    expect(existsSync(path.join(root, ...OUTPUT.split('/')))).toBe(false);
  });
});

describe('manifest, check and fixture files', () => {
  it('accepts the valid catalog', () => {
    expect(problemsOf(catalogDir())).toBe('');
  });

  it('reports a manifest ID without a check file', () => {
    expect(problemsOf(catalogDir({}, [`${DIR}/MT-11.sql`]))).toMatch(
      /supabase\/catalog-checks\/MT-11\.sql: missing/,
    );
  });

  it('reports a check file that is not in the manifest', () => {
    expect(problemsOf(catalogDir({ [`${DIR}/MT-99.sql`]: check('x') }))).toMatch(
      /MT-99\.sql: not listed in manifest\.json/,
    );
  });

  it('reports a reachable branch without a fixture', () => {
    const p = problemsOf(catalogDir({}, [`${FX}/MT-1.partition_without_rls.violation.sql`]));
    expect(p).toMatch(/MT-1\.partition_without_rls\.violation\.sql: missing/);
  });

  it('reports stray fixtures: unknown branch, unreachable branch, any other file', () => {
    const p = problemsOf(
      catalogDir({
        [`${FX}/MT-1.no_such_branch.violation.sql`]: fixture('mt_1_c'),
        [`${FX}/MT-11.insert_without_check.violation.sql`]: fixture('mt_11_b'),
        [`${FX}/notes.txt`]: 'x\n',
      }),
    );
    expect(p).toMatch(/MT-1\.no_such_branch\.violation\.sql: stray fixture/);
    expect(p).toMatch(/MT-11\.insert_without_check\.violation\.sql: stray fixture/);
    expect(p).toMatch(/fixtures\/notes\.txt: stray fixture/);
  });

  it('collects every problem instead of stopping at the first', () => {
    const p = problemsOf(
      catalogDir({ [`${DIR}/MT-99.sql`]: check('x') }, [
        `${DIR}/MT-11.sql`,
        `${FX}/MT-1.partition_without_rls.violation.sql`,
      ]),
    );
    expect(p.split('\n')).toHaveLength(3);
  });

  it.each([
    ['a ; in the middle', 'select 1; select 2\n', /;/],
    ['a ; in a comment', '-- a; b\nselect 1\n', /;/],
    ['two trailing ;', 'select 1;;\n', /;/],
    ['$q$', 'select $q$x$q$ as branch\n', /\$q\$/],
    ['an empty file', '  \n', /empty/],
    ['a UTF-8 BOM', '\uFEFFselect 1\n', /BOM/],
  ])('rejects a check file with %s', (_label, text, re) => {
    expect(checkFileProblems(text).join('\n')).toMatch(re);
    expect(problemsOf(catalogDir({ [`${DIR}/MT-1.sql`]: text }))).toMatch(/MT-1\.sql: /);
  });

  it('accepts a check with one trailing ; and trailing whitespace, or none', () => {
    expect(checkFileProblems('select 1;  \n\n')).toEqual([]);
    expect(checkFileProblems('select 1')).toEqual([]);
    expect(checkFileProblems("select '^pg_toast$' as x\n")).toEqual([]);
  });

  it.each([
    'begin;',
    'BEGIN TRANSACTION;',
    'commit;',
    'Rollback to savepoint x;',
    'rollback;',
    'savepoint x;',
    'release savepoint x;',
    'end;',
    'abort;',
    'start transaction;',
    'START\n  TRANSACTION isolation level serializable;',
    '/* lead */ commit;',
  ])('rejects transaction control in a fixture: %s', (stmt) => {
    const text = `create table public.mt_1_x (id int);\n${stmt}\n`;
    expect(fixtureProblems(text).join('\n')).toMatch(/transaction control/);
  });

  it('allows begin/end inside a function body, BEGIN ATOMIC and CASE', () => {
    const plpgsql = [
      'create function public.mt_5b_f() returns int language plpgsql as $$',
      'begin',
      '  perform 1;',
      '  return 1;',
      'end',
      '$$;',
    ].join('\n');
    const atomic = [
      'create or replace function public.mt_5b_g() returns int language sql',
      'begin atomic',
      '  select case when true then 1 else 0 end;',
      'end;',
    ].join('\n');
    const tagged =
      'create function public.mt_5b_h() returns int language plpgsql as $fn$ begin return 1; end $fn$;';
    const strings =
      "select 'end; commit;' as a, E'it\\'s; begin' as b, \"end\" as c from (select 1 as \"end\") as t;";
    for (const text of [
      plpgsql,
      atomic,
      tagged,
      strings,
      'create table public.mt_x (begin_at int);',
    ]) {
      expect(fixtureProblems(text)).toEqual([]);
    }
  });

  it.each([
    ['a meta-command line', 'create schema mt_8b_x;\n\\set x 1\n', /meta-command/],
    ['an indented meta-command line', 'create schema mt_8b_x;\n  \\i other.sql\n', /meta-command/],
    ['an inline meta-command', 'select 1 \\gset\n', /meta-command/],
    ['$q$', 'select $q$x$q$;\n', /\$q\$/],
    ['a last statement without ;', 'create schema mt_8b_x;\ncreate schema mt_8b_y\n', /end with ;/],
    ['no statements', '-- only a comment\n', /no statements/],
    ['an unterminated string', "select 'oops;\n", /unterminated/],
    ['an unterminated dollar quote', 'select $$ x;\n', /unterminated/],
  ])('rejects a fixture with %s', (_label, text, re) => {
    expect(fixtureProblems(text).join('\n')).toMatch(re);
  });

  it('reports fixture problems with the fixture path', () => {
    const p = problemsOf(
      catalogDir({ [`${FX}/MT-1.table_without_rls.violation.sql`]: 'commit;\n' }),
    );
    expect(p).toMatch(/MT-1\.table_without_rls\.violation\.sql: .*transaction control/);
  });

  it('lexes statements the way psql splits them', () => {
    const r = lexSql(
      'select 1; create function f() returns int language sql begin atomic select 1; end; commit;',
    );
    expect(r.statements.map((s) => s.tokens[0])).toEqual(['select', 'create', 'commit']);
  });
});

describe('manifest shape', () => {
  const shape = (m) => validateManifest(m).problems.join('\n');

  it('accepts the valid manifest and normalises branches', () => {
    const r = validateManifest(MANIFEST);
    expect(r.problems).toEqual([]);
    expect(r.checks[1].branches).toEqual([
      { id: 'for_all', unreachable: null },
      { id: 'insert_without_check', unreachable: 'ERROR:  synthetic error text' },
    ]);
  });

  it.each([
    ['not an object', [], /object/],
    ['no checks array', { checks: {} }, /checks/],
    ['a bad id', { checks: [{ id: 'MT-x', branches: ['a'] }] }, /MT-x/],
    ['a lowercase id', { checks: [{ id: 'mt-1', branches: ['a'] }] }, /mt-1/],
    [
      'a duplicate id',
      {
        checks: [
          { id: 'MT-1', branches: ['a'] },
          { id: 'MT-1', branches: ['b'] },
        ],
      },
      /duplicate/,
    ],
    ['empty branches', { checks: [{ id: 'MT-1', branches: [] }] }, /branches/],
    ['missing branches', { checks: [{ id: 'MT-1' }] }, /branches/],
    ['a duplicate branch', { checks: [{ id: 'MT-1', branches: ['a', 'a'] }] }, /duplicate/],
    ['a bad branch name', { checks: [{ id: 'MT-1', branches: ['Bad-Name'] }] }, /Bad-Name/],
    [
      'a branch object with an extra key',
      { checks: [{ id: 'MT-11', branches: [{ id: 'for_all', unreachable: 'ERROR: x', x: 1 }] }] },
      /branch/,
    ],
    ['a branch that is a number', { checks: [{ id: 'MT-1', branches: [3] }] }, /branch/],
    ['a check with an extra key', { checks: [{ id: 'MT-1', branches: ['a'], x: 1 }] }, /MT-1/],
  ])('rejects %s', (_label, m, re) => {
    expect(shape(m)).toMatch(re);
  });

  it('reports invalid JSON with the manifest path', () => {
    const p = problemsOf(catalogDir({ [`${DIR}/manifest.json`]: '{ "checks": [ }' }));
    expect(p).toMatch(/manifest\.json: .*JSON/);
  });

  describe('unreachable branches (§8.5)', () => {
    const one = (id, branch, unreachable) => ({
      checks: [{ id, branches: [{ id: branch, unreachable }] }],
    });

    it('are allowed on the two named MT-11 branches with ERROR text', () => {
      expect(shape(one('MT-11', 'insert_without_check', 'ERROR:  x'))).toBe('');
      expect(shape(one('MT-11', 'select_delete_without_using', 'ERROR: y'))).toBe('');
    });

    it.each([
      ['another check', 'MT-1', 'insert_without_check', 'ERROR: x'],
      ['another MT-11 branch', 'MT-11', 'for_all', 'ERROR: x'],
      ['empty error text', 'MT-11', 'insert_without_check', ''],
      ['text without ERROR:', 'MT-11', 'insert_without_check', 'rejected by postgres'],
      ['a non-string', 'MT-11', 'insert_without_check', true],
      ['null', 'MT-11', 'insert_without_check', null],
    ])('are denied on %s', (_label, id, branch, text) => {
      expect(shape(one(id, branch, text))).toMatch(/unreachable/);
    });
  });
});

describe('--check', () => {
  it('passes on a current catalog and reports the assertion count', () => {
    const r = checkRun(repoWithCatalog());
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ ok: true, count: 5 });
  });

  it('never writes the generated file', () => {
    const repo = repoWithCatalog();
    const out = path.join(repo, ...OUTPUT.split('/'));
    rmSync(out);
    const r = checkRun(repo);
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/run node scripts\/gen-catalog-tests\.mjs/);
    expect(existsSync(out)).toBe(false);
  });

  it('fails when the generated file is stale', () => {
    const repo = repoWithCatalog();
    writeFiles(repo, { [`${FX}/MT-1.table_without_rls.violation.sql`]: fixture('mt_1_z') });
    const r = checkRun(repo);
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(
      /catalog_meta\.test\.sql: .*stale.*run node scripts\/gen-catalog-tests\.mjs/,
    );
  });

  it('accepts a committed file that differs only by CRLF', () => {
    const repo = repoWithCatalog();
    const out = path.join(repo, ...OUTPUT.split('/'));
    writeFileSync(out, readFileSync(out, 'utf8').replace(/\n/g, '\r\n'));
    expect(checkRun(repo).problems).toEqual([]);
  });

  it('fails and names the ref when the base does not resolve', () => {
    const r = checkRun(repoWithCatalog(), 'origin/main');
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toContain('origin/main');
  });

  it('runs the file checks in --check mode too', () => {
    const repo = repoWithCatalog();
    writeFiles(repo, { [`${DIR}/MT-99.sql`]: check('x') });
    expect(checkRun(repo).problems.join('\n')).toMatch(/MT-99\.sql: not listed/);
  });

  describe('floors only go up', () => {
    it('fails when a floor is lower than at the base', () => {
      const repo = repoWithCatalog();
      writeFiles(repo, { [CAT_FLOOR]: '4\n' });
      const p = checkRun(repo).problems.join('\n');
      expect(p).toMatch(/catalog-min-count: 4 is lower than 5 at base main/);
    });

    it('accepts an equal or higher floor', () => {
      const repo = repoWithCatalog();
      writeFiles(repo, { [CAT_FLOOR]: '5\n', [RLS_FLOOR]: '50\n' });
      expect(checkRun(repo).problems).toEqual([]);
    });

    it('treats a floor missing at the base as 0', () => {
      const files = catalogFiles();
      delete files[CAT_FLOOR];
      delete files[RLS_FLOOR];
      const repo = initRepo();
      writeFiles(repo, files);
      commitAll(repo, 'no floors yet');
      git(repo, 'checkout', '-q', '-b', 'feature');
      writeFiles(repo, { [CAT_FLOOR]: '0\n', [RLS_FLOOR]: '0\n' });
      writeGenerated(repo);
      expect(checkRun(repo).problems).toEqual([]);
    });

    it('compares against every m*-reviewed tag that is an ancestor of HEAD', () => {
      const repo = repoWithCatalog();
      git(repo, 'checkout', '-q', 'main');
      writeFiles(repo, { [CAT_FLOOR]: '9\n' });
      commitAll(repo, 'raise floor');
      git(repo, 'tag', 'm0a-reviewed');
      writeFiles(repo, { [CAT_FLOOR]: '6\n' });
      commitAll(repo, 'lower floor on main');
      const p = checkRun(repo).problems.join('\n'); // on main: the base tip is HEAD
      expect(p).toMatch(/catalog-min-count: 6 is lower than 9 at tag m0a-reviewed/);
      expect(p).not.toMatch(/at base main/);
    });

    it('ignores an m*-reviewed tag that is not an ancestor of HEAD', () => {
      const repo = repoWithCatalog();
      git(repo, 'checkout', '-q', '-b', 'side', 'main');
      writeFiles(repo, { [CAT_FLOOR]: '99\n' });
      commitAll(repo, 'side floor');
      git(repo, 'tag', 'm9-reviewed');
      git(repo, 'checkout', '-q', 'feature');
      expect(checkRun(repo).problems).toEqual([]);
    });

    it.each([['abc\n'], ['-1\n'], ['1 2\n'], [''], ['5\n6\n'], [' 5\n'], ['5.0\n']])(
      'rejects a malformed floor file %j',
      (text) => {
        const repo = repoWithCatalog();
        writeFiles(repo, { [RLS_FLOOR]: text });
        expect(checkRun(repo).problems.join('\n')).toMatch(
          /rls-min-count: .*single non-negative integer/,
        );
      },
    );

    it('rejects a missing floor file', () => {
      const repo = repoWithCatalog();
      rmSync(path.join(repo, ...RLS_FLOOR.split('/')));
      expect(checkRun(repo).problems.join('\n')).toMatch(/rls-min-count: missing/);
    });

    it('parses floors strictly', () => {
      expect(parseFloor('71\n')).toBe(71);
      expect(parseFloor('0')).toBe(0);
      expect(parseFloor('71\r\n')).toBe(71);
      expect(parseFloor('71\n\n')).toBeNull();
      expect(parseFloor('')).toBeNull();
      expect(parseFloor('99999999999999999999\n')).toBeNull();
    });
  });

  describe('the manifest only grows', () => {
    it('fails when a branch is removed vs the base', () => {
      const repo = repoWithCatalog();
      const m = structuredClone(MANIFEST);
      m.checks[0].branches = ['table_without_rls'];
      writeFiles(repo, { [`${DIR}/manifest.json`]: JSON.stringify(m) });
      rmSync(path.join(repo, ...`${FX}/MT-1.partition_without_rls.violation.sql`.split('/')));
      writeGenerated(repo);
      expect(checkRun(repo).problems.join('\n')).toMatch(
        /MT-1\.partition_without_rls .*base main.*removed/,
      );
    });

    it('fails when a check is removed vs the base', () => {
      const repo = repoWithCatalog();
      const m = structuredClone(MANIFEST);
      m.checks = [m.checks[0]];
      writeFiles(repo, { [`${DIR}/manifest.json`]: JSON.stringify(m) });
      rmSync(path.join(repo, ...`${DIR}/MT-11.sql`.split('/')));
      rmSync(path.join(repo, ...`${FX}/MT-11.for_all.violation.sql`.split('/')));
      writeGenerated(repo);
      expect(checkRun(repo).problems.join('\n')).toMatch(/MT-11 .*base main.*removed/);
    });

    it('fails when a branch is removed vs an ancestor m*-reviewed tag', () => {
      const repo = repoWithCatalog();
      git(repo, 'checkout', '-q', 'main');
      git(repo, 'tag', 'm0a-reviewed');
      const m = structuredClone(MANIFEST);
      m.checks[1].branches = ['for_all'];
      writeFiles(repo, { [`${DIR}/manifest.json`]: JSON.stringify(m) });
      writeGenerated(repo);
      commitAll(repo, 'drop a branch on main');
      expect(checkRun(repo).problems.join('\n')).toMatch(
        /MT-11\.insert_without_check .*tag m0a-reviewed.*removed/,
      );
    });

    it('treats a manifest missing at the base as empty', () => {
      const repo = initRepo();
      writeFiles(repo, { 'README.txt': 'synthetic\n' });
      commitAll(repo, 'no catalog yet');
      git(repo, 'checkout', '-q', '-b', 'feature');
      writeFiles(repo, catalogFiles());
      writeGenerated(repo);
      expect(checkRun(repo).problems).toEqual([]);
    });

    it('accepts a new check and a new branch', () => {
      const repo = repoWithCatalog();
      const m = structuredClone(MANIFEST);
      m.checks[0].branches.push('extra_branch');
      m.checks.push({ id: 'MT-12', branches: ['global_entry_grant'] });
      writeFiles(repo, {
        [`${DIR}/manifest.json`]: JSON.stringify(m),
        [`${DIR}/MT-12.sql`]: check('global_entry_grant'),
        [`${FX}/MT-1.extra_branch.violation.sql`]: fixture('mt_1_e'),
        [`${FX}/MT-12.global_entry_grant.violation.sql`]: fixture('mt_12_a'),
      });
      writeGenerated(repo);
      const r = checkRun(repo);
      expect(r.problems).toEqual([]);
      expect(r.count).toBe(8);
    });

    it('denies unreachable for a branch that is reachable at the base', () => {
      const m = structuredClone(MANIFEST);
      m.checks[1].branches = ['for_all', 'insert_without_check'];
      const files = catalogFiles(m);
      files[`${FX}/MT-11.insert_without_check.violation.sql`] = fixture('mt_11_b');
      const repo = repoWithCatalog(files);
      writeFiles(repo, { [`${DIR}/manifest.json`]: JSON.stringify(MANIFEST) });
      rmSync(path.join(repo, ...`${FX}/MT-11.insert_without_check.violation.sql`.split('/')));
      writeGenerated(repo);
      expect(checkRun(repo).problems.join('\n')).toMatch(
        /MT-11\.insert_without_check .*unreachable.*reachable at base main/,
      );
    });

    it('accepts an unreachable branch becoming reachable', () => {
      const repo = repoWithCatalog();
      const m = structuredClone(MANIFEST);
      m.checks[1].branches = ['for_all', 'insert_without_check'];
      writeFiles(repo, {
        [`${DIR}/manifest.json`]: JSON.stringify(m),
        [`${FX}/MT-11.insert_without_check.violation.sql`]: fixture('mt_11_b'),
      });
      writeGenerated(repo);
      expect(checkRun(repo).problems).toEqual([]);
    });
  });
});

describe('copied blocks stay identical (catalog review D9)', () => {
  const PROBE = 'supabase/tests/catalog_probe.test.sql';
  const block = (name, ids, body = 'with g as (select 1)') =>
    `-- shared:${name} begin (the same text in ${ids})\n-- ${body}\n-- shared:${name} end\n`;
  const probe = (inner, id = 'MT-11') =>
    [
      'begin;',
      'select is_empty(',
      '  $q$',
      '  select * from (',
      `-- ${id} copy begin`,
      inner,
      `-- ${id} copy end`,
      '  ) as v',
      '  $q$,',
      "  'synthetic negative control'",
      ');',
      'rollback;',
      '',
    ].join('\n');
  const mt11 = check('for_all').replace(/;\n$/, '');
  const both = (b1, b11) => ({
    [`${DIR}/MT-1.sql`]: b1 + check('table_without_rls'),
    [`${DIR}/MT-11.sql`]: b11 + check('for_all'),
  });

  it('accepts a shared block that is identical in every check its begin line lists', () => {
    const b = block('graph', 'MT-1 and MT-11');
    expect(problemsOf(catalogDir(both(b, b)))).toBe('');
  });

  it('reports a one-character drift between copies of a shared block', () => {
    const p = problemsOf(
      catalogDir(
        both(
          block('graph', 'MT-1 and MT-11'),
          block('graph', 'MT-1 and MT-11', 'with g as (select 2)'),
        ),
      ),
    );
    expect(p).toMatch(
      /catalog-checks\/MT-11\.sql: shared:graph differs from the copy in supabase\/catalog-checks\/MT-1\.sql/,
    );
  });

  it('reports a shared block missing from a listed check or present in an unlisted one', () => {
    const missing = problemsOf(catalogDir(both(block('graph', 'MT-1 and MT-11'), '')));
    expect(missing).toMatch(
      /shared:graph: the begin line lists MT-1, MT-11 but the block is in MT-1$/m,
    );
    const b = block('graph', 'MT-1');
    const extra = problemsOf(catalogDir(both(b, b)));
    expect(extra).toMatch(
      /shared:graph: the begin line lists MT-1 but the block is in MT-1, MT-11/,
    );
  });

  it('reports a begin line without the list of checks', () => {
    const b = '-- shared:graph begin\n-- x\n-- shared:graph end\n';
    expect(problemsOf(catalogDir(both(b, b)))).toMatch(
      /MT-1\.sql: shared:graph begin line must end with "\(the same text in <IDs>\)"/,
    );
  });

  it.each([
    [
      'a begin without end',
      '-- shared:graph begin (the same text in MT-1)\n',
      /shared:graph: begin on line 1 without end/,
    ],
    ['an end without begin', '-- shared:graph end\n', /shared:graph: end on line 1 without begin/],
    [
      'a second begin before the end',
      '-- shared:graph begin (the same text in MT-1)\n-- shared:graph begin (the same text in MT-1)\n-- shared:graph end\n',
      /shared:graph: begin on line 1 without end/,
    ],
  ])('reports %s', (_label, b, re) => {
    expect(problemsOf(catalogDir(both(b, '')))).toMatch(re);
  });

  it('accepts a probe copy equal to its check, ignoring CRLF and a trailing ;', () => {
    expect(problemsOf(catalogDir({ [PROBE]: probe(mt11) }))).toBe('');
    expect(problemsOf(catalogDir({ [PROBE]: probe(`${mt11};`).replace(/\n/g, '\r\n') }))).toBe('');
  });

  it('reports a one-character drift in a probe copy, naming the file and the check', () => {
    const p = problemsOf(catalogDir({ [PROBE]: probe(mt11.replace('for_all', 'for_alL')) }));
    expect(p).toMatch(
      /supabase\/tests\/catalog_probe\.test\.sql: the MT-11 copy differs from supabase\/catalog-checks\/MT-11\.sql/,
    );
  });

  it('reports a copy of an unknown check and a copy without its end line', () => {
    expect(problemsOf(catalogDir({ [PROBE]: probe('select 1', 'MT-77') }))).toMatch(
      /catalog_probe\.test\.sql: MT-77 copy: no such check in manifest\.json/,
    );
    const open = probe(mt11).replace('-- MT-11 copy end\n', '');
    expect(problemsOf(catalogDir({ [PROBE]: open }))).toMatch(
      /catalog_probe\.test\.sql: MT-11 copy: begin on line 5 without end/,
    );
  });

  it('fails --check on a drifted probe copy', () => {
    const repo = repoWithCatalog({ ...catalogFiles(), [PROBE]: probe(mt11) });
    expect(checkRun(repo).problems).toEqual([]);
    writeFiles(repo, { [PROBE]: probe(mt11.replace('where false', 'where true')) });
    expect(checkRun(repo).problems.join('\n')).toMatch(/the MT-11 copy differs/);
  });
});

describe('main()', () => {
  const io = () => {
    const out = [];
    const err = [];
    return { out, err, log: (l) => out.push(l), error: (l) => err.push(l) };
  };

  it('prints OK with the count in --check mode', () => {
    const repo = repoWithCatalog();
    const s = io();
    expect(main({ argv: ['--check'], env: {}, root: repo, ...s })).toBe(0);
    expect(s.out).toEqual(['gen-catalog-tests: OK (5 assertions)']);
  });

  it('takes the base from MIGRATIONS_BASE, and --base wins', () => {
    const repo = repoWithCatalog();
    const s = io();
    expect(main({ argv: ['--check'], env: { MIGRATIONS_BASE: 'nope' }, root: repo, ...s })).toBe(1);
    expect(s.err.join('\n')).toContain('nope');
    const t = io();
    const argv = ['--check', '--base', 'main'];
    expect(main({ argv, env: { MIGRATIONS_BASE: 'nope' }, root: repo, ...t })).toBe(0);
  });

  it('lists every problem and exits 1', () => {
    const root = catalogDir({ [`${DIR}/MT-99.sql`]: check('x') }, [`${DIR}/MT-11.sql`]);
    const s = io();
    expect(main({ argv: [], env: {}, root, ...s })).toBe(1);
    expect(s.err.filter((l) => l.includes('MT-'))).toHaveLength(2);
  });

  it('writes the file and reports the count', () => {
    const root = catalogDir();
    const s = io();
    expect(main({ argv: [], env: {}, root, ...s })).toBe(0);
    expect(s.out.join('\n')).toMatch(
      /wrote supabase\/tests\/catalog_meta\.test\.sql \(5 assertions\)/,
    );
  });

  it('rejects an unknown argument', () => {
    const s = io();
    expect(main({ argv: ['--chek'], env: {}, root: catalogDir(), ...s })).toBe(2);
  });
});
