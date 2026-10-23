// TEST-ONLY ORACLE. NEVER IMPORT THIS FROM PRODUCTION CODE. A frozen copy of src/rules/parse.ts at 240f102 for the
// band-engine-1 oracle (oracle/band-engine-1.ts, AT-M1-17). Do not edit.
//
// Strict, hand-written rule-table validator (specs/d1-demo-slice.md §5.2: the engine imports nothing, so no zod).
// It rejects unknown keys, duplicate rule ids, a floor or factor outside 1..1000, and `untrusted`/`rawMedia` on a
// tier other than T3 (the two ways a T3 rule may reach strong_concern, rule 3). It returns a deep-frozen copy that
// holds only the known keys, so a caller can neither smuggle extra data in nor change the table afterwards.
// Error messages name the failed check and a structural path, never an input value.
import type { Rule, RuleTable, Severity, Tier } from './types-1.js';

export type RuleTableErrorCode =
  | 'not_object'
  | 'unknown_key'
  | 'missing_key'
  | 'bad_version'
  | 'bad_permille'
  | 'bad_families'
  | 'bad_rules'
  | 'bad_rule'
  | 'duplicate_rule_id'
  | 'unknown_family'
  | 'escalation_on_non_t3'
  | 'connectivity_reserved';

export class RuleTableError extends Error {
  readonly code: RuleTableErrorCode;
  constructor(code: RuleTableErrorCode, path: string) {
    super(`rule table: ${code} at ${path}`);
    this.name = 'RuleTableError';
    this.code = code;
  }
}

/** Connectivity gaps are context labelled "Connectivity", never a flag and never focus (D1-6). */
export const CONNECTIVITY_KIND = 'connectivity_gap';
export const CONNECTIVITY_FAMILY = 'connectivity';

const TABLE_KEYS = [
  'version',
  'coverageFloorPermille',
  'coveragePhotoMissingFactorPermille',
  'families',
  'rules',
] as const;
const RULE_REQUIRED = ['id', 'kinds', 'family', 'tier', 'severity', 'validated'] as const;
const RULE_OPTIONAL = ['where', 'minDurationMs', 'untrusted', 'rawMedia'] as const;
const TIERS: readonly Tier[] = ['T1', 'T2', 'T3'];
const SEVERITIES: readonly Severity[] = ['soft', 'medium', 'hard'];

const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const RULE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const ATTR_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** A plain JSON-like object: not null, not an array, prototype Object.prototype or null. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function checkKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(record)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new RuleTableError('unknown_key', path);
    }
  }
  for (const key of required) {
    if (record[key] === undefined) throw new RuleTableError('missing_key', `${path}.${key}`);
  }
}

const isPermille = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000;

function parseNameList(value: unknown, path: string, code: RuleTableErrorCode): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new RuleTableError(code, path);
  const names: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item: unknown = value[i]; // a hole reads as undefined and fails
    if (typeof item !== 'string' || !NAME_RE.test(item) || names.includes(item)) {
      throw new RuleTableError(code, path);
    }
    names.push(item);
  }
  return names;
}

function parseWhere(value: unknown, path: string): Record<string, string | number | boolean> {
  if (!isPlainObject(value)) throw new RuleTableError('bad_rule', path);
  const where: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (
      !ATTR_KEY_RE.test(key) ||
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype'
    ) {
      throw new RuleTableError('bad_rule', path);
    }
    if (
      typeof v !== 'string' &&
      typeof v !== 'boolean' &&
      !(typeof v === 'number' && Number.isFinite(v))
    ) {
      throw new RuleTableError('bad_rule', path);
    }
    where[key] = v;
  }
  return Object.freeze(where) as Record<string, string | number | boolean>;
}

function parseRule(raw: unknown, families: readonly string[], path: string): Rule {
  if (!isPlainObject(raw)) throw new RuleTableError('bad_rule', path);
  checkKeys(raw, RULE_REQUIRED, RULE_OPTIONAL, path);
  const { id, kinds, family, tier, severity, validated } = raw;
  if (typeof id !== 'string' || !RULE_ID_RE.test(id))
    throw new RuleTableError('bad_rule', `${path}.id`);
  const kindList = parseNameList(kinds, `${path}.kinds`, 'bad_rule');
  if (kindList.includes(CONNECTIVITY_KIND)) {
    throw new RuleTableError('connectivity_reserved', `${path}.kinds`);
  }
  if (typeof family !== 'string') throw new RuleTableError('bad_rule', `${path}.family`);
  if (!families.includes(family)) throw new RuleTableError('unknown_family', `${path}.family`);
  if (typeof tier !== 'string' || !TIERS.includes(tier as Tier)) {
    throw new RuleTableError('bad_rule', `${path}.tier`);
  }
  if (typeof severity !== 'string' || !SEVERITIES.includes(severity as Severity)) {
    throw new RuleTableError('bad_rule', `${path}.severity`);
  }
  if (typeof validated !== 'boolean') throw new RuleTableError('bad_rule', `${path}.validated`);

  const rule: Rule = {
    id,
    kinds: Object.freeze(kindList),
    family,
    tier: tier as Tier,
    severity: severity as Severity,
    validated,
  };
  if (raw['where'] !== undefined) rule.where = parseWhere(raw['where'], `${path}.where`);
  if (raw['minDurationMs'] !== undefined) {
    const min = raw['minDurationMs'];
    if (typeof min !== 'number' || !Number.isSafeInteger(min) || min < 0) {
      throw new RuleTableError('bad_rule', `${path}.minDurationMs`);
    }
    rule.minDurationMs = min;
  }
  for (const key of ['untrusted', 'rawMedia'] as const) {
    const flag = raw[key];
    if (flag === undefined) continue;
    if (typeof flag !== 'boolean') throw new RuleTableError('bad_rule', `${path}.${key}`);
    // Strict: the key may not appear at all on T1/T2 (P9), whatever its value.
    if (rule.tier !== 'T3') throw new RuleTableError('escalation_on_non_t3', `${path}.${key}`);
    rule[key] = flag;
  }
  return Object.freeze(rule);
}

/** Parses a stored rule table (jsonb of `integrity.band_rule_versions`). Strict; throws RuleTableError. */
export function parseRuleTable(raw: unknown): RuleTable {
  if (!isPlainObject(raw)) throw new RuleTableError('not_object', '$');
  checkKeys(raw, TABLE_KEYS, [], '$');
  const { version, coverageFloorPermille, coveragePhotoMissingFactorPermille, families, rules } =
    raw;
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    throw new RuleTableError('bad_version', '$.version');
  }
  if (!isPermille(coverageFloorPermille)) {
    throw new RuleTableError('bad_permille', '$.coverageFloorPermille');
  }
  if (!isPermille(coveragePhotoMissingFactorPermille)) {
    throw new RuleTableError('bad_permille', '$.coveragePhotoMissingFactorPermille');
  }
  const familyList = parseNameList(families, '$.families', 'bad_families');
  if (familyList.includes(CONNECTIVITY_FAMILY)) {
    throw new RuleTableError('connectivity_reserved', '$.families');
  }
  if (!Array.isArray(rules)) throw new RuleTableError('bad_rules', '$.rules');
  const ids = new Set<string>();
  // An index loop, never map: map skips the holes of a sparse array, and a hole must fail as bad_rule (review L4).
  const ruleList: Rule[] = [];
  for (let index = 0; index < rules.length; index += 1) {
    const parsed = parseRule(rules[index], familyList, `$.rules[${index}]`);
    if (ids.has(parsed.id)) throw new RuleTableError('duplicate_rule_id', `$.rules[${index}].id`);
    ids.add(parsed.id);
    ruleList.push(parsed);
  }
  return Object.freeze({
    version,
    coverageFloorPermille,
    coveragePhotoMissingFactorPermille,
    families: Object.freeze(familyList),
    rules: Object.freeze(ruleList),
  });
}
