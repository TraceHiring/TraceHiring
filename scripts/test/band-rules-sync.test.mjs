// AT-D4 (specs/d1-demo-slice.md §5.2, §3 integrity.band_rule_versions): the band-engine rule table
// packages/band-engine/src/rules/d1-v1.json is the single source of the v1 rule table. The results migration seeds the
// same table into integrity.band_rule_versions (rules jsonb + content_sha256). This test keeps the two from drifting:
// the SHA-256 of the canonical JSON of the whole table must equal the hash seeded in the migration, and the jsonb
// `rules` literal in the migration must parse to the table's rules array.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const readRepoFile = (rel) => readFileSync(`${root}${rel}`, 'utf8');

const RULES_PATH = 'packages/band-engine/src/rules/d1-v1.json';
const MIGRATION_PATH = 'supabase/migrations/20261014151833_d1_results.sql';

/**
 * Canonical JSON (sorted keys, no whitespace). A local copy of packages/shared/src/canonical-json.ts and of the
 * band-engine's own canonicalJson (§5.2): scripts import no workspace code (check-boundaries / ESLint boundaries),
 * so the algorithm is repeated here. Same rules: keys sorted by UTF-16 code unit, arrays in order, primitives as
 * JSON.stringify writes them.
 */
function canonicalJson(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
      const parts = Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
      return `{${parts.join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: cannot serialise ${typeof value}`);
  }
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Concatenates the single-quoted SQL string literals of `v_rules jsonb := '…' || '…' …;` and unescapes `''`. */
function rulesLiteralFromMigration(sql) {
  const m = /v_rules\s+jsonb\s*:=\s*((?:'(?:[^']|'')*'\s*(?:\|\|\s*)?)+);/.exec(sql);
  if (!m) throw new Error('v_rules jsonb literal not found in the results migration');
  const pieces = [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((p) => p[1].replaceAll("''", "'"));
  return pieces.join('');
}

/** The hash seeded for the v1 rule table: the literal that follows `rules, content_sha256)` in the seed insert. */
function seededHashFromMigration(sql) {
  const m =
    /insert into integrity\.band_rule_versions[\s\S]*?\bv_rules\s*,\s*'([0-9a-f]{64})'\s*\)/.exec(
      sql,
    );
  if (!m) throw new Error('seeded content_sha256 not found in the results migration');
  return m[1];
}

const table = JSON.parse(readRepoFile(RULES_PATH));
const migration = readRepoFile(MIGRATION_PATH);

describe('band rule table single source (AT-D4)', () => {
  it('the table is the v1 table of §5.2', () => {
    expect(table.version).toBe('d1-v1');
    expect(table.coverageFloorPermille).toBe(700);
    expect(table.coveragePhotoMissingFactorPermille).toBe(750);
    expect(table.families).toEqual(['paste', 'input_origin', 'focus']);
    expect(table.rules.map((r) => r.id)).toEqual([
      'D1-PASTE',
      'D1-UNTRUSTED-INPUT',
      'D1-TAB-HIDDEN',
      'D1-FULLSCREEN-EXIT',
    ]);
  });

  it('SHA-256 of the canonical JSON equals the hash seeded in the migration', () => {
    expect(sha256(canonicalJson(table))).toBe(seededHashFromMigration(migration));
  });

  it('the seeded hash is the one the spec records', () => {
    expect(seededHashFromMigration(migration)).toBe(
      'c862bf653c6284fbb4d2319c923cd1c8aa28bcc40a2a61ccbc10d6e6af96ca0e',
    );
  });

  it('the jsonb rules literal in the migration parses to the table rules array', () => {
    const seeded = JSON.parse(rulesLiteralFromMigration(migration));
    expect(seeded).toEqual(table.rules);
    expect(canonicalJson(seeded)).toBe(canonicalJson(table.rules));
  });

  it('the seeded scalar columns equal the table (families, floor, photo factor)', () => {
    const m =
      /insert into integrity\.band_rule_versions[\s\S]*?\bvalues\s*\(\s*p_org_id\s*,\s*1\s*,\s*array\[([^\]]*)\]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*v_rules/.exec(
        migration,
      );
    expect(m, 'seed insert values not found').not.toBeNull();
    const families = [...m[1].matchAll(/'([^']*)'/g)].map((f) => f[1]);
    expect(families).toEqual(table.families);
    expect(Number(m[2])).toBe(table.coverageFloorPermille);
    expect(Number(m[3])).toBe(table.coveragePhotoMissingFactorPermille);
  });

  it('a one-key change to the table changes the hash (the comparison is not vacuous)', () => {
    const edited = structuredClone(table);
    edited.rules[0].validated = !edited.rules[0].validated;
    expect(sha256(canonicalJson(edited))).not.toBe(seededHashFromMigration(migration));
  });

  it('canonicalJson sorts keys and drops whitespace', () => {
    expect(canonicalJson({ b: [1, { z: 1, a: 'x' }], a: null })).toBe(
      '{"a":null,"b":[1,{"a":"x","z":1}]}',
    );
  });
});
