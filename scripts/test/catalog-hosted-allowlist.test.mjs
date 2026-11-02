// MT-9 hosted allow-list (spec specs/m0-foundations.md §8.5 MT-9 and specs/d1-demo-slice.md revision 4m).
// Hosted Supabase (staging dispatch 4, run 39376946373) owns three pre-installed extensions by postgres
// and has the Supabase CLI's idempotency index in supabase_migrations; locally none of them is
// postgres-owned, so no pgTAP fixture can reach the allow-list. These tests pin the exact text; the
// predicates run for real in scripts/test-catalog-hosted-local.mjs (test:rls step 5e), which makes the
// local stack look hosted inside a rolled-back superuser transaction. The positive controls that other
// postgres-owned extensions and hand-made system-schema objects still fail are the fixtures
// MT-9.extension_owner (lo), MT-9.handmade_in_system_schema, MT-9.extension_added_member and
// MT-9.extension_other_member.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');

const MT9 = read('supabase/catalog-checks/MT-9.sql');
const MT7 = read('supabase/catalog-checks/MT-7.sql');

/** The body of the CTE `<name> (...) as (` … up to the closing `),` / `)` line at column 0. */
function cteBody(sql, name) {
  const start = sql.search(new RegExp(`^${name}\\b[^\\n]*\\bas \\($`, 'm'));
  expect(start, `CTE ${name} not found`).toBeGreaterThanOrEqual(0);
  const rest = sql.slice(start);
  const end = rest.search(/^\)/m);
  expect(end, `CTE ${name} has no closing line`).toBeGreaterThan(0);
  return rest.slice(0, end);
}

/** Every `('a', 'b', …)` tuple of string literals in a VALUES body (casts stripped). */
function tuples(body) {
  return [...body.matchAll(/^\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\),?\s*$/gm)].map((m) =>
    [...m[1].matchAll(/'((?:[^']|'')*)'(?:::[a-z_]+)?/g)].map((v) => v[1]),
  );
}

describe('MT-9 hosted_extension allow-list', () => {
  const body = cteBody(MT9, 'hosted_extension');

  it('is exactly the three hosted extensions, in schema extensions, owned by postgres', () => {
    expect(tuples(body)).toEqual([
      ['pg_stat_statements', 'extensions', 'postgres'],
      ['uuid-ossp', 'extensions', 'postgres'],
      ['pgcrypto', 'extensions', 'postgres'],
    ]);
  });

  it('is a literal VALUES list, nothing pattern-based', () => {
    expect(body).toMatch(/\bvalues\b/);
    expect(body).not.toMatch(/\blike\b|\bilike\b|~|similar to|regexp|\bselect\b/i);
  });

  it('extension_owner skips an extension only when name, schema and owner all match', () => {
    const branch = MT9.slice(MT9.indexOf("'extension_owner'::text"));
    const where = branch.slice(0, branch.indexOf('union all'));
    expect(where).toMatch(/pg_has_role\('postgres', e\.extowner, 'MEMBER'\)/);
    expect(where).toMatch(/h\.extname = e\.extname/);
    expect(where).toMatch(/h\.schema_name = n\.nspname/);
    expect(where).toMatch(/h\.owner_name = pg_get_userbyid\(e\.extowner\)/);
  });
});

describe('supabase_object list (the same in MT-7 and MT-9)', () => {
  const entry = [
    'relation',
    'supabase_migrations',
    'schema_migrations_idempotency_key_key',
    'i',
    'postgres',
  ];

  it('lists the Supabase CLI idempotency index in both checks', () => {
    expect(tuples(cteBody(MT9, 'supabase_object'))).toContainEqual(entry);
    expect(tuples(cteBody(MT7, 'supabase_object'))).toContainEqual(entry);
  });

  it('pins every relation entry to its relkind, and MT-9 matches on it', () => {
    for (const [kind, , , relkind] of tuples(cteBody(MT9, 'supabase_object'))) {
      expect(kind === 'function' ? relkind === '' : /^[riS]$/.test(relkind)).toBe(true);
    }
    expect(MT9).toMatch(/and o\.relkind = so\.relkind/);
  });

  it('is identical in MT-7 and MT-9', () => {
    expect(cteBody(MT7, 'supabase_object')).toBe(cteBody(MT9, 'supabase_object'));
    expect(cteBody(MT7, 'supabase_owner')).toBe(cteBody(MT9, 'supabase_owner'));
  });
});

describe('MT-9 extension_added_member (no allow-listed extension can hide an object)', () => {
  it('is a manifest branch with a fixture that adds a postgres-owned function to a postgres-owned extension', () => {
    const manifest = JSON.parse(read('supabase/catalog-checks/manifest.json'));
    const mt9 = manifest.checks.find((c) => c.id === 'MT-9');
    expect(mt9.branches).toContain('extension_added_member');
    const fixture = read(
      'supabase/catalog-checks/fixtures/MT-9.extension_added_member.violation.sql',
    );
    expect(fixture).toMatch(/alter extension lo add function extensions\.mt_9_/);
  });

  it('flags any member not owned by a Supabase service role, unless it is a hosted_member', () => {
    const branch = MT9.slice(MT9.indexOf("'extension_added_member'::text"));
    const where = branch.slice(0, branch.indexOf('union all'));
    expect(where).toMatch(/em\.owner_oid not in \(select sr\.oid from supabase_owner as sr\)/);
    expect(where).toMatch(/from hosted_member as hm/);
  });

  it('hosted_member trusts only C functions from the extension library and the two pg_stat_statements views', () => {
    const body = cteBody(MT9, 'hosted_member');
    expect(body).toMatch(/l\.lanname = 'c'/);
    expect(body).toMatch(/p\.probin = '\$libdir\/' \|\| he\.extname/);
    expect(body).toMatch(/not p\.prosecdef/);
    expect(body).toMatch(/p\.proconfig is null/);
    expect(body).toMatch(/p\.pronamespace = he\.extnamespace/);
    expect(cteBody(MT9, 'hosted_view')).toMatch(
      /c\.relname in \('pg_stat_statements', 'pg_stat_statements_info'\)/,
    );
  });

  it('extension_other_member has a fixture outside pg_class, pg_proc and pg_type', () => {
    const manifest = JSON.parse(read('supabase/catalog-checks/manifest.json'));
    expect(manifest.checks.find((c) => c.id === 'MT-9').branches).toContain(
      'extension_other_member',
    );
    const fixture = read(
      'supabase/catalog-checks/fixtures/MT-9.extension_other_member.violation.sql',
    );
    expect(fixture).toMatch(/alter extension lo add text search configuration extensions\.mt_9_/);
  });
});
