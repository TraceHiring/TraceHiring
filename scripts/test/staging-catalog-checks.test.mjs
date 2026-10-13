// AT-18 (local proxy): scripts/staging-catalog-checks.mjs runs every catalog check against staging
// inside a read-only transaction and fails on any output line or non-zero exit (spec §7.2 step 4,
// §8.5). A fake psql runner stands in for the database; no connection is ever made. Every
// connection string here is synthetic and built at run time.
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DB_URL_ENV,
  PSQL_ARGS,
  main,
  planChecks,
  psqlRunner,
  redactor,
  runCatalogChecks,
  wrapCheck,
} from '../staging-catalog-checks.mjs';
import { cleanupTempDirs, makeTempDir, writeFiles } from './fixtures/checks/temp-repo.mjs';

afterEach(cleanupTempDirs);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// A synthetic connection string, assembled so no credential-shaped literal sits in the source.
const PASSWORD = ['fixture', 'pw', 'Q9z'].join('-');
const DB_BASE = ['postgresql://postgres', `:${PASSWORD}@db.example.invalid:5432/postgres`].join('');
const DB_URL = `${DB_BASE}?sslmode=require`;

const ok = (stdout = '') => ({ status: 0, signal: null, stdout, stderr: '' });

/** A fake psql that records each call and answers from `answer(call)` (default: clean). */
function fakeRunner(answer = () => ok()) {
  const calls = [];
  const run = (call) => {
    calls.push(call);
    return answer(call);
  };
  return { run, calls };
}

/** A minimal valid catalog under a temp root: `ids` checks, one branch each. */
function tempCatalog(ids = ['MT-1', 'MT-2'], extra = {}) {
  const root = makeTempDir('trace-staging-cat-');
  const files = {
    'supabase/catalog-checks/manifest.json': JSON.stringify({
      checks: ids.map((id) => ({ id, branches: ['fires'] })),
    }),
  };
  for (const id of ids) {
    files[`supabase/catalog-checks/${id}.sql`] =
      `-- ${id} synthetic check\nselect 'fires'::text as branch, 'x'::text as object, 'y'::text as detail\nwhere false\n`;
    files[`supabase/catalog-checks/fixtures/${id}.fires.violation.sql`] =
      `create table public.mt_${id.toLowerCase().replace('-', '_')} (id int);\n`;
  }
  writeFiles(root, { ...files, ...extra });
  return root;
}

describe('wrapCheck', () => {
  it('wraps one check in a read-only transaction with a 60 s statement timeout that always rolls back', () => {
    expect(wrapCheck('select 1')).toBe(
      "begin;\nset transaction read only;\nset local statement_timeout = '60s';\nselect 1\n;\nrollback;\n",
    );
  });
});

describe('PSQL_ARGS', () => {
  it('are the §7.2 step 4 flags plus -q (no psqlrc, stop on error, unaligned tuples only)', () => {
    expect(PSQL_ARGS).toEqual(['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-At']);
  });
});

describe('planChecks', () => {
  it('plans every MT-*.sql of the real catalog, in manifest order, and the count equals the manifest', () => {
    const { plan, problems, manifestCount } = planChecks(REPO);
    expect(problems).toEqual([]);
    expect(manifestCount).toBe(18);
    expect(plan.map((p) => p.id)).toEqual([
      'MT-1',
      'MT-2',
      'MT-3',
      'MT-4',
      'MT-5a',
      'MT-5b',
      'MT-5c',
      'MT-5d',
      'MT-6',
      'MT-7',
      'MT-8',
      'MT-8b',
      'MT-9',
      'MT-10',
      'MT-11',
      'MT-12',
      'MT-13',
      'MT-14',
    ]);
    for (const p of plan) {
      expect(p.file).toBe(`supabase/catalog-checks/${p.id}.sql`);
      expect(p.input.startsWith('begin;\nset transaction read only;\n')).toBe(true);
      expect(p.input.endsWith('\n;\nrollback;\n')).toBe(true);
    }
  });

  it('sends exactly the check file (trimmed, one trailing ";" dropped) and never a positive-control fixture', () => {
    const { plan } = planChecks(REPO);
    const dir = path.join(REPO, 'supabase', 'catalog-checks');
    const fixtures = readdirSync(path.join(dir, 'fixtures')).map((n) =>
      readFileSync(path.join(dir, 'fixtures', n), 'utf8')
        .replace(/\r\n/g, '\n')
        .trim(),
    );
    expect(fixtures.length).toBeGreaterThan(0);
    for (const p of plan) {
      expect(p.file).not.toMatch(/fixtures/);
      const text = readFileSync(path.join(REPO, ...p.file.split('/')), 'utf8')
        .replace(/\r\n/g, '\n')
        .trim()
        .replace(/;$/, '')
        .trimEnd();
      expect(p.input).toBe(wrapCheck(text));
      for (const f of fixtures) expect(p.input.includes(f)).toBe(false);
    }
  });

  it('strips one trailing ";" from a check', () => {
    const root = tempCatalog(['MT-1'], {
      'supabase/catalog-checks/MT-1.sql':
        "select 'fires'::text as branch, 'x'::text as object, 'y'::text as detail where false;\n",
    });
    const { plan, problems } = planChecks(root);
    expect(problems).toEqual([]);
    expect(plan[0].input).toBe(
      wrapCheck(
        "select 'fires'::text as branch, 'x'::text as object, 'y'::text as detail where false",
      ),
    );
  });

  it('fails when a check file listed in the manifest is missing', () => {
    const root = tempCatalog(['MT-1', 'MT-2']);
    rmSync(path.join(root, 'supabase', 'catalog-checks', 'MT-2.sql'));
    const { problems } = planChecks(root);
    expect(problems.join('\n')).toMatch(/MT-2\.sql: missing/);
  });

  it('fails when an MT-*.sql file is not in the manifest (the count differs)', () => {
    const root = tempCatalog(['MT-1'], {
      'supabase/catalog-checks/MT-9.sql': "select 'a'::text, 'b'::text, 'c'::text where false\n",
    });
    const { problems } = planChecks(root);
    const text = problems.join('\n');
    expect(text).toMatch(/MT-9\.sql: not listed in manifest\.json/);
    expect(text).toMatch(/2 MT-\*\.sql file\(s\) but manifest\.json lists 1/);
  });

  it('fails when the manifest is missing', () => {
    const root = makeTempDir('trace-staging-cat-');
    const { plan, problems } = planChecks(root);
    expect(plan).toEqual([]);
    expect(problems.join('\n')).toMatch(/manifest\.json: missing/);
  });

  it('fails on a second statement (a ";" inside the check could end the read-only transaction)', () => {
    const root = tempCatalog(['MT-1'], {
      'supabase/catalog-checks/MT-1.sql':
        "commit; select 'fires'::text as branch, 'x'::text as object, 'y'::text as detail\n",
    });
    expect(planChecks(root).problems.join('\n')).toMatch(/MT-1\.sql: contains a ";"/);
  });

  it('fails on a psql meta-command (it would run on the CI runner, not in the database)', () => {
    const root = tempCatalog(['MT-1'], {
      'supabase/catalog-checks/MT-1.sql':
        "select 'fires'::text as branch, 'x'::text as object, 'y'::text as detail\n\\o out.txt\n",
    });
    expect(planChecks(root).problems.join('\n')).toMatch(/MT-1\.sql: has a psql meta-command/);
  });

  it('accepts a backslash inside a string literal (LIKE escapes, as in MT-3)', () => {
    const root = tempCatalog(['MT-1'], {
      'supabase/catalog-checks/MT-1.sql':
        "select 'fires'::text as branch, 'x'::text as object, 'y'::text as detail where 'a_b' like '%a\\_b%' and false\n",
    });
    expect(planChecks(root).problems).toEqual([]);
  });
});

describe('redactor', () => {
  it('removes the connection string, its password (raw and URL-encoded) and any other postgres URL', () => {
    const encoded = ['p%40ss', 'word', '9'].join('');
    const url = `postgresql://postgres:${encoded}@db.example.invalid:6543/postgres`;
    const redact = redactor(url);
    const out = redact(
      `failed: ${url} / pw ${decodeURIComponent(encoded)} / raw ${encoded} / other postgres://u:v@h/d`,
    );
    expect(out).not.toContain(url);
    expect(out).not.toContain(encoded);
    expect(out).not.toContain(decodeURIComponent(encoded));
    expect(out).not.toContain('u:v@h');
    expect(out).toContain('[REDACTED]');
  });

  it('is a no-op on text without the secret', () => {
    expect(redactor(DB_URL)('MT-1: clean')).toBe('MT-1: clean');
  });
});

describe('runCatalogChecks', () => {
  it('runs one psql per check with the planned flags, the URL via -d and the wrapped SQL on stdin', () => {
    const { run, calls } = fakeRunner();
    const r = runCatalogChecks({ root: REPO, dbUrl: DB_URL, run });
    expect(r.violations).toEqual([]);
    expect(calls).toHaveLength(18);
    for (const c of calls) {
      expect(c.args).toEqual([...PSQL_ARGS, '-d', DB_URL]);
      expect(c.input.startsWith('begin;\nset transaction read only;\n')).toBe(true);
      expect(c.input.endsWith('rollback;\n')).toBe(true);
    }
    expect(r.report.at(-1)).toBe('18 check(s) run, 18 in manifest.json, all clean');
  });

  it('fails on any output line and prints the rows (redacted), not the URL', () => {
    const { run } = fakeRunner((c) =>
      c.id === 'MT-8' ? ok(`schema_missing|integrity|reserved schema does not exist\n`) : ok(),
    );
    const r = runCatalogChecks({ root: REPO, dbUrl: DB_URL, run });
    const text = r.violations.join('\n');
    expect(text).toMatch(/MT-8: 1 output line\(s\) \(violations\)/);
    expect(text).toMatch(/schema_missing\|integrity\|reserved schema does not exist/);
    expect(text).not.toContain(PASSWORD);
  });

  it('fails on stderr output even with exit 0 (any output line fails)', () => {
    const { run } = fakeRunner(() => ({ ...ok(), stderr: 'WARNING:  something\n' }));
    const r = runCatalogChecks({ root: REPO, dbUrl: DB_URL, run });
    expect(r.violations.filter((v) => /: 1 output line\(s\)/.test(v))).toHaveLength(18);
    expect(r.violations).toContain('  WARNING:  something');
  });

  it('fails on a non-zero exit and redacts the connection string from the error', () => {
    const { run } = fakeRunner(() => ({
      status: 2,
      signal: null,
      stdout: '',
      stderr: `psql: error: connection to ${DB_URL} failed: password ${PASSWORD} rejected\n`,
    }));
    const r = runCatalogChecks({ root: REPO, dbUrl: DB_URL, run });
    const text = r.violations.join('\n');
    expect(text).toMatch(/MT-1: psql failed \(exit 2\)/);
    expect(text).not.toContain(DB_URL);
    expect(text).not.toContain(PASSWORD);
  });

  it('fails on a killed or unstartable psql', () => {
    const killed = runCatalogChecks({
      root: REPO,
      dbUrl: DB_URL,
      run: () => ({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' }),
    });
    expect(killed.violations[0]).toMatch(/psql failed \(signal SIGTERM\)/);
    const missing = runCatalogChecks({
      root: REPO,
      dbUrl: DB_URL,
      run: () => {
        throw new Error(`spawn psql ENOENT ${DB_URL}`);
      },
    });
    expect(missing.violations[0]).toMatch(/psql failed \(spawn psql ENOENT \[REDACTED\]\)/);
  });

  it('runs nothing when the plan has problems', () => {
    const root = tempCatalog(['MT-1'], {
      'supabase/catalog-checks/MT-2.sql': "select 'a'::text, 'b'::text, 'c'::text where false\n",
    });
    const { run, calls } = fakeRunner();
    const r = runCatalogChecks({ root, dbUrl: DB_URL, run });
    expect(calls).toHaveLength(0);
    expect(r.violations.join('\n')).toMatch(/not listed in manifest\.json/);
  });
});

describe('main', () => {
  const capture = () => {
    const lines = { out: [], err: [] };
    return { lines, out: (s) => lines.out.push(s), err: (s) => lines.err.push(s) };
  };

  it('--list prints the plan without connecting and needs no connection string', () => {
    const c = capture();
    const { run, calls } = fakeRunner();
    const code = main({ argv: ['--list'], env: {}, root: REPO, run, out: c.out, err: c.err });
    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    const text = c.lines.out.join('\n');
    expect(text).toMatch(/18 check\(s\), manifest\.json lists 18/);
    expect(text).toMatch(
      /MT-12: psql -X -v ON_ERROR_STOP=1 -q -At -d "\$SUPABASE_STAGING_DB_URL" < begin; set transaction read only; supabase\/catalog-checks\/MT-12\.sql; rollback;/,
    );
  });

  it('fails closed when the connection string is missing or empty', () => {
    for (const env of [{}, { [DB_URL_ENV]: '' }, { [DB_URL_ENV]: '   ' }]) {
      const c = capture();
      const { run, calls } = fakeRunner();
      expect(main({ argv: [], env, root: REPO, run, out: c.out, err: c.err })).toBe(1);
      expect(calls).toHaveLength(0);
      expect(c.lines.err.join('\n')).toMatch(/SUPABASE_STAGING_DB_URL is not set/);
    }
  });

  it('exits 0 when every check is clean and never prints the connection string', () => {
    const c = capture();
    const { run } = fakeRunner();
    const code = main({
      argv: [],
      env: { [DB_URL_ENV]: DB_URL },
      root: REPO,
      run,
      out: c.out,
      err: c.err,
    });
    expect(code).toBe(0);
    const all = [...c.lines.out, ...c.lines.err].join('\n');
    expect(all).toMatch(/staging-catalog-checks: OK/);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain('example.invalid');
  });

  it('exits 1 on a violation row', () => {
    const c = capture();
    const { run } = fakeRunner((call) => (call.id === 'MT-12' ? ok('a|b|c\n') : ok()));
    const code = main({
      argv: [],
      env: { [DB_URL_ENV]: DB_URL },
      root: REPO,
      run,
      out: c.out,
      err: c.err,
    });
    expect(code).toBe(1);
    expect(c.lines.err.join('\n')).toMatch(/MT-12: 1 output line/);
  });

  it('refuses a connection string whose sslmode is missing or weak, before any psql, naming only the parameter (S3B-6)', () => {
    const bad = [
      DB_BASE,
      `${DB_BASE}?sslmode=prefer`,
      `${DB_BASE}?sslmode=disable`,
      `${DB_BASE}?sslmode=allow`,
      `${DB_BASE}?sslmode=`,
      `${DB_BASE}?connect_timeout=5`,
      `${DB_BASE}?sslmode=require&sslmode=disable`,
      `${DB_BASE}?sslmode=REQUIRE`,
      `${DB_BASE}?sslmode=prefer&sslmode=require`,
      `${DB_BASE}?options=sslmode%3Drequire`,
    ];
    for (const url of bad) {
      const c = capture();
      const { run, calls } = fakeRunner();
      expect(main({ argv: [], env: { [DB_URL_ENV]: url }, root: REPO, run, ...c }), url).toBe(1);
      expect(calls).toHaveLength(0);
      const all = [...c.lines.out, ...c.lines.err].join('\n');
      expect(all).toMatch(/sslmode must be require, verify-ca or verify-full/);
      expect(all).not.toContain(PASSWORD);
      expect(all).not.toContain('example.invalid');
    }
  });

  it('accepts require, verify-ca and verify-full (also among other parameters)', () => {
    for (const q of [
      '?sslmode=require',
      '?sslmode=verify-ca',
      '?sslmode=verify-full',
      '?connect_timeout=5&sslmode=verify-full',
      '?sslmode=require&application_name=trace',
    ]) {
      const c = capture();
      const { run, calls } = fakeRunner();
      const env = { [DB_URL_ENV]: `${DB_BASE}${q}` };
      expect(main({ argv: [], env, root: REPO, run, ...c }), q).toBe(0);
      expect(calls).toHaveLength(18);
    }
  });

  it('--list needs no connection string, so it also ignores sslmode', () => {
    const c = capture();
    const { run } = fakeRunner();
    expect(main({ argv: ['--list'], env: {}, root: REPO, run, ...c })).toBe(0);
  });

  it('rejects unknown arguments', () => {
    const c = capture();
    expect(main({ argv: ['--nope'], env: {}, root: REPO, run: () => ok(), ...c })).toBe(1);
  });
});

describe('psqlRunner', () => {
  it('spawns psql without a shell, feeds stdin, drops the connection-string variable and sets a timeout', () => {
    const seen = [];
    const spawn = (cmd, args, opts) => {
      seen.push({ cmd, args, opts });
      return ok();
    };
    const run = psqlRunner({ spawn, env: { PATH: '/bin', [DB_URL_ENV]: DB_URL } });
    run({ args: ['-X'], input: 'select 1' });
    expect(seen).toHaveLength(1);
    const { cmd, args, opts } = seen[0];
    expect(cmd).toBe('psql');
    expect(args).toEqual(['-X']);
    expect(opts.shell).toBe(false);
    expect(opts.input).toBe('select 1');
    expect(opts.encoding).toBe('utf8');
    expect(opts.timeout).toBeGreaterThan(0);
    expect(opts.env[DB_URL_ENV]).toBeUndefined();
    expect(opts.env.PATH).toBe('/bin');
    expect(opts.env.PGCONNECT_TIMEOUT).toBe('15');
  });
});
