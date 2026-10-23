// computeBand (specs/d1-demo-slice.md §5.2): deterministic, integer arithmetic only, no I/O, no clock, no randomness.
// Order (founder 2026-10-14, "evidence wins", R-3): flags first, coverage only blocks Clear.
//   0. (band-engine-2, M1 R5-7, R5-23 b, R5-52 e) An event whose kind `signalSettings` switches off (key present with
//      `enabled: false`) is context only, marked `disabledBySettings`, and never matches a rule. With every kind
//      enabled the output equals band-engine-1's except engineVersion (AT-M1-17).
//   1. Only validated rules produce flags; a match of an unvalidated rule is context.
//   2. strong_concern if a flag is T1/T2, or `untrusted`, or T3 `rawMedia` with an event carrying a mediaRef.
//   3. else review if a T3 flag is medium/hard, or the validated T3 flags span two or more families.
//   4. else insufficient_evidence (reason low_coverage) if activeMs <= 0 or coverage is below the floor.
//   5. else clear.
// The input is identity-free and score-free (rule 1): an unknown key anywhere in it is refused, not ignored.
import {
  CONNECTIVITY_FAMILY,
  CONNECTIVITY_KIND,
  isPlainObject,
  parseRuleTable,
} from './rules/parse.js';
import type {
  Band,
  BandInput,
  BandOutput,
  ContextItem,
  Flag,
  Observed,
  Rule,
  RuleTable,
  SignalEvent,
} from './types.js';

export const BAND_ENGINE_VERSION = 'band-engine-2';

/** At most this many gseq values are kept per flag (§5.2). */
export const MAX_SIGNAL_SEQS = 50;

/** At most this many reasons are returned (the integrity card contract's maximum). */
export const MAX_REASONS = 10;

/** Coverage times above this would lose integer precision in `coveredMs · 1000` (about 285 years). */
const MAX_COVERAGE_MS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);

export type BandInputErrorCode =
  | 'not_object'
  | 'unknown_key'
  | 'missing_key'
  | 'bad_coverage'
  | 'bad_photo_missing'
  | 'bad_captured_families'
  | 'bad_events'
  | 'bad_event'
  | 'duplicate_seq'
  /** A signalSettings map or value that is not exactly `{enabled: boolean}` (R5-52 e). */
  | 'bad_input';

export class BandInputError extends Error {
  readonly code: BandInputErrorCode;
  constructor(code: BandInputErrorCode, path: string) {
    super(`band input: ${code} at ${path}`);
    this.name = 'BandInputError';
    this.code = code;
  }
}

const INPUT_KEYS = [
  'events',
  'coverage',
  'capturedFamilies',
  'photoMissing',
  'signalSettings',
] as const;
const COVERAGE_KEYS = ['activeMs', 'coveredMs'] as const;
const EVENT_REQUIRED = ['seq', 'atMs', 'kind', 'attrs'] as const;
const EVENT_OPTIONAL = ['durationMs', 'mediaRef'] as const;

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function checkKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(record)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new BandInputError('unknown_key', path);
    }
  }
  for (const key of required) {
    if (record[key] === undefined) throw new BandInputError('missing_key', `${path}.${key}`);
  }
}

interface CheckedInput {
  events: SignalEvent[];
  activeMs: number;
  coveredMs: number;
  capturedFamilies: string[];
  photoMissing: boolean;
  /** Kinds switched off by signalSettings. A Set of own keys: no kind resolves through Object.prototype. */
  disabled: Set<string>;
}

/** signalSettings: a plain object whose every own value is exactly `{enabled: boolean}`; returns the disabled kinds. */
function checkSignalSettings(raw: unknown): Set<string> {
  const path = '$.signalSettings';
  if (!isPlainObject(raw)) throw new BandInputError('bad_input', path);
  const disabled = new Set<string>();
  for (const key of Object.keys(raw)) {
    const value: unknown = Object.getOwnPropertyDescriptor(raw, key)?.value;
    if (!isPlainObject(value)) throw new BandInputError('bad_input', path);
    const keys = Object.keys(value);
    const enabled: unknown = Object.getOwnPropertyDescriptor(value, 'enabled')?.value;
    if (keys.length !== 1 || keys[0] !== 'enabled' || typeof enabled !== 'boolean') {
      throw new BandInputError('bad_input', path);
    }
    if (!enabled) disabled.add(key);
  }
  return disabled;
}

function checkEvent(raw: unknown, path: string): SignalEvent {
  if (!isPlainObject(raw)) throw new BandInputError('bad_event', path);
  checkKeys(raw, EVENT_REQUIRED, EVENT_OPTIONAL, path);
  const { seq, atMs, kind, attrs, durationMs, mediaRef } = raw;
  if (!isCount(seq) || !isCount(atMs)) throw new BandInputError('bad_event', path);
  if (typeof kind !== 'string' || kind.length === 0 || kind.length > 64) {
    throw new BandInputError('bad_event', path);
  }
  if (!isPlainObject(attrs)) throw new BandInputError('bad_event', `${path}.attrs`);
  const attrCopy: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(attrs)) {
    const v = attrs[key];
    if (
      typeof v !== 'string' &&
      typeof v !== 'boolean' &&
      !(typeof v === 'number' && Number.isFinite(v))
    ) {
      throw new BandInputError('bad_event', `${path}.attrs`);
    }
    Object.defineProperty(attrCopy, key, { value: v, enumerable: true });
  }
  const event: SignalEvent = { seq, atMs, kind, attrs: attrCopy };
  if (durationMs !== undefined) {
    if (!isCount(durationMs)) throw new BandInputError('bad_event', `${path}.durationMs`);
    event.durationMs = durationMs;
  }
  if (mediaRef !== undefined) {
    if (typeof mediaRef !== 'string' || mediaRef.length === 0) {
      throw new BandInputError('bad_event', `${path}.mediaRef`);
    }
    event.mediaRef = mediaRef;
  }
  return event;
}

function checkInput(raw: unknown): CheckedInput {
  if (!isPlainObject(raw)) throw new BandInputError('not_object', '$');
  checkKeys(raw, INPUT_KEYS, [], '$');
  const { events, coverage, capturedFamilies, photoMissing, signalSettings } = raw;
  if (!isPlainObject(coverage)) throw new BandInputError('bad_coverage', '$.coverage');
  checkKeys(coverage, COVERAGE_KEYS, [], '$.coverage');
  const { activeMs, coveredMs } = coverage;
  if (
    !isCount(activeMs) ||
    !isCount(coveredMs) ||
    activeMs > MAX_COVERAGE_MS ||
    coveredMs > MAX_COVERAGE_MS
  ) {
    throw new BandInputError('bad_coverage', '$.coverage');
  }
  if (typeof photoMissing !== 'boolean') {
    throw new BandInputError('bad_photo_missing', '$.photoMissing');
  }
  // Index loops, never map/some: those skip the holes of a sparse array, and a hole must fail (review L4).
  if (!Array.isArray(capturedFamilies)) {
    throw new BandInputError('bad_captured_families', '$.capturedFamilies');
  }
  const families: string[] = [];
  for (let i = 0; i < capturedFamilies.length; i += 1) {
    const family: unknown = capturedFamilies[i];
    if (typeof family !== 'string') {
      throw new BandInputError('bad_captured_families', '$.capturedFamilies');
    }
    families.push(family);
  }
  if (!Array.isArray(events)) throw new BandInputError('bad_events', '$.events');
  const seen = new Set<number>();
  const checked: SignalEvent[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const e = checkEvent(events[i], `$.events[${i}]`);
    if (seen.has(e.seq)) throw new BandInputError('duplicate_seq', `$.events[${i}].seq`);
    seen.add(e.seq);
    checked.push(e);
  }
  return {
    events: checked,
    activeMs,
    coveredMs,
    capturedFamilies: families,
    photoMissing,
    disabled: checkSignalSettings(signalSettings),
  };
}

/** Total order on events: (atMs, seq, kind). seq (gseq) is unique, so the order never depends on input order. */
function compareEvents(a: SignalEvent, b: SignalEvent): number {
  if (a.atMs !== b.atMs) return a.atMs - b.atMs;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
}

function matches(rule: Rule, event: SignalEvent): boolean {
  if (!rule.kinds.includes(event.kind)) return false;
  if (rule.minDurationMs !== undefined) {
    if (event.durationMs === undefined || event.durationMs < rule.minDurationMs) return false;
  }
  if (rule.where !== undefined) {
    for (const key of Object.keys(rule.where)) {
      if (!Object.hasOwn(event.attrs, key) || event.attrs[key] !== rule.where[key]) return false;
    }
  }
  return true;
}

function observedOf(events: readonly SignalEvent[]): Observed {
  let len: number | undefined;
  let count: number | undefined;
  let durationMs: number | undefined;
  for (const e of events) {
    const l = Object.hasOwn(e.attrs, 'len') ? e.attrs['len'] : undefined;
    if (isCount(l)) len = (len ?? 0) + l;
    const c = Object.hasOwn(e.attrs, 'count') ? e.attrs['count'] : undefined;
    if (isCount(c)) count = (count ?? 0) + c;
    if (e.durationMs !== undefined) durationMs = (durationMs ?? 0) + e.durationMs;
  }
  const observed: Observed = {};
  if (len !== undefined) observed.len = len;
  if (durationMs !== undefined) observed.durationMs = durationMs;
  if (count !== undefined) observed.count = count;
  return observed;
}

/** round-half-up of 100·n/d, as hundredths in [0, 1]. Integer arithmetic; d > 0. */
function hundredths(n: number, d: number): number {
  return Math.floor((200 * n + d) / (2 * d)) / 100;
}

/** Computes the integrity band. Throws RuleTableError / BandInputError on a malformed table or input. */
export function computeBand(table: RuleTable, input: BandInput): BandOutput {
  const rules = parseRuleTable(table);
  const checked = checkInput(input);
  const events = [...checked.events].sort(compareEvents);

  // Step 1: validated matches become flags; everything else is context.
  const matched = new Map<string, SignalEvent[]>();
  const context: ContextItem[] = [];
  for (const event of events) {
    // Step 0: a switched-off kind is the context item of an event that matches no rule, marked (R5-52 e).
    if (checked.disabled.has(event.kind)) {
      const item: ContextItem = {
        kind: event.kind,
        seq: event.seq,
        atMs: event.atMs,
        observed: observedOf([event]),
      };
      if (event.kind === CONNECTIVITY_KIND) item.family = CONNECTIVITY_FAMILY;
      if (event.durationMs !== undefined) item.durationMs = event.durationMs;
      item.disabledBySettings = true;
      context.push(item);
      continue;
    }
    let flagged = false;
    let firstUnvalidated: Rule | undefined;
    for (const rule of rules.rules) {
      if (!matches(rule, event)) continue;
      if (rule.validated) {
        flagged = true;
        const list = matched.get(rule.id) ?? [];
        list.push(event);
        matched.set(rule.id, list);
      } else {
        firstUnvalidated ??= rule;
      }
    }
    if (flagged) continue;
    const item: ContextItem = {
      kind: event.kind,
      seq: event.seq,
      atMs: event.atMs,
      observed: observedOf([event]),
    };
    if (event.kind === CONNECTIVITY_KIND) {
      item.family = CONNECTIVITY_FAMILY;
    } else if (firstUnvalidated !== undefined) {
      item.family = firstUnvalidated.family;
      item.ruleId = firstUnvalidated.id;
    }
    if (event.durationMs !== undefined) item.durationMs = event.durationMs;
    context.push(item);
  }

  const flagged: { rule: Rule; events: SignalEvent[] }[] = [];
  for (const rule of rules.rules) {
    const list = matched.get(rule.id);
    if (list !== undefined) flagged.push({ rule, events: list });
  }
  const flags: Flag[] = flagged.map(({ rule, events: list }) => ({
    ruleId: rule.id,
    family: rule.family,
    tier: rule.tier,
    severity: rule.severity,
    count: list.length,
    firstAtMs: list[0]!.atMs,
    signalSeqs: list.slice(0, MAX_SIGNAL_SEQS).map((e) => e.seq),
    observed: observedOf(list),
  }));

  // Coverage (R-11): the photo factor lowers covered time before the floor check. coveredMs above activeMs is capped.
  const activeMs = checked.activeMs;
  let coveredMs = Math.min(checked.coveredMs, activeMs);
  if (checked.photoMissing) {
    coveredMs = Math.floor((coveredMs * rules.coveragePhotoMissingFactorPermille) / 1000);
  }
  const coveragePermille = activeMs > 0 ? Math.floor((1000 * coveredMs) / activeMs) : 0;
  const lowCoverage = activeMs <= 0 || coveredMs * 1000 < rules.coverageFloorPermille * activeMs;

  // Steps 2-5.
  const strongReasons: string[] = [];
  for (const { rule, events: list } of flagged) {
    if (rule.tier === 'T1' || rule.tier === 'T2') {
      strongReasons.push(`tier_${rule.tier.toLowerCase()}:${rule.id}`);
    } else if (rule.untrusted === true) {
      strongReasons.push(`untrusted:${rule.id}`);
    } else if (rule.rawMedia === true && list.some((e) => e.mediaRef !== undefined)) {
      strongReasons.push(`raw_media:${rule.id}`);
    }
  }
  let band: Band;
  let reasons: string[];
  if (strongReasons.length > 0) {
    band = 'strong_concern';
    reasons = strongReasons;
  } else {
    const t3 = flagged.filter(({ rule }) => rule.tier === 'T3');
    const reviewReasons = t3
      .filter(({ rule }) => rule.severity === 'medium' || rule.severity === 'hard')
      .map(({ rule }) => `t3_severity:${rule.id}`);
    const t3Families = [...new Set(t3.map(({ rule }) => rule.family))].sort();
    if (t3Families.length >= 2) reviewReasons.push(`t3_families:${t3Families.join('+')}`);
    if (reviewReasons.length > 0) {
      band = 'review';
      reasons = reviewReasons;
    } else if (lowCoverage) {
      band = 'insufficient_evidence';
      reasons = ['low_coverage'];
    } else {
      band = 'clear';
      reasons = [];
    }
  }

  const captured = new Set(checked.capturedFamilies);
  const usable = rules.families.filter((family) => captured.has(family)).length;

  return {
    band,
    // Reasons are in rule-table order (the t3_families reason last); the card contract keeps at most 10.
    reasons: reasons.slice(0, MAX_REASONS),
    evidenceStrength: hundredths(usable, rules.families.length),
    coveragePermille,
    flags,
    context,
    ruleTableVersion: rules.version,
    engineVersion: BAND_ENGINE_VERSION,
  };
}
