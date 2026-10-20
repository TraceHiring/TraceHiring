// MT-9 hosted allow-list (spec specs/m0-foundations.md §8.5 MT-9, revision 17; specs/d1-demo-slice.md
// revision 4m). Hosted Supabase (staging dispatch 4, run 39376946373) owns three pre-installed extensions
// by postgres and has the Supabase CLI's idempotency index in supabase_migrations; locally none of them is
// postgres-owned, so no pgTAP fixture can reach the allow-list. These tests pin the exact text instead:
// names only, schema and owner pinned, nothing pattern-based. The positive controls that other
// postgres-owned extensions and hand-made system-schema objects still fail are the existing fixtures
// MT-9.extension_owner (lo) and MT-9.handmade_in_system_schema, plus MT-9.extension_added_member.
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
    'postgres',
  ];

  it('lists the Supabase CLI idempotency index in both checks', () => {
    expect(tuples(cteBody(MT9, 'supabase_object'))).toContainEqual(entry);
    expect(tuples(cteBody(MT7, 'supabase_object'))).toContainEqual(entry);
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
});
