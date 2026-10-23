// TEST-ONLY ORACLE. NEVER IMPORT THIS FROM PRODUCTION CODE. A frozen copy of src/types.ts at 240f102 (the
// band-engine-1 contract, without signalSettings) for oracle/band-engine-1.ts (AT-M1-17). Do not edit.
//
// Band engine contract (specs/d1-demo-slice.md §5.2). Types only: pure TypeScript, no I/O, no clock,
// no randomness, no imports. The names are binding; shapes may gain optional fields in BUILD.
// BandInput carries no session, candidate, org, quality, score, cutoff or identity field (rules 1 and 6):
// the integrity band is computed without ever seeing an Answer Quality result.

export type Tier = 'T1' | 'T2' | 'T3';
export type Severity = 'soft' | 'medium' | 'hard';
export type Band = 'clear' | 'review' | 'strong_concern' | 'insufficient_evidence';

/** A rule row as stored in `integrity.band_rule_versions.rules` (jsonb). */
export interface Rule {
  id: string;
  kinds: readonly string[];
  where?: Record<string, string | number | boolean>;
  minDurationMs?: number;
  family: string;
  tier: Tier;
  severity: Severity;
  validated: boolean;
  /** `untrusted` and `rawMedia` are the only two ways a T3 rule can reach `strong_concern` (rule 3). */
  untrusted?: boolean;
  rawMedia?: boolean;
}

/** The one rule-table schema; stored as jsonb in `integrity.band_rule_versions`. */
export interface RuleTable {
  version: string;
  coverageFloorPermille: number;
  coveragePhotoMissingFactorPermille: number;
  families: readonly string[];
  rules: readonly Rule[];
}

/** One client or server signal. `seq` is the session-global `gseq` (L-14), never a per-stream number. */
export interface SignalEvent {
  seq: number;
  atMs: number;
  kind: string;
  durationMs?: number;
  attrs: Record<string, string | number | boolean>;
  mediaRef?: string;
}

/** Identity-free and score-free input of `computeBand`. */
export interface BandInput {
  events: readonly SignalEvent[];
  coverage: { activeMs: number; coveredMs: number };
  capturedFamilies: readonly string[];
  photoMissing: boolean;
}

/**
 * The observed value of a flag or context item: metadata only, never content (§4.6). The keys mirror the
 * `observed` object of the D1 card contract (`@trace/shared/contracts/d1`): `len` sums the numeric `attrs.len`
 * (paste/drop length), `count` sums the numeric `attrs.count` (coalesced untrusted input), `durationMs` sums the
 * events' `durationMs`. A key is present only when at least one event carried it.
 */
export interface Observed {
  len?: number;
  durationMs?: number;
  count?: number;
}

/**
 * A flag from a validated rule: timestamp, rule, observed value and evidence refs (plan §5 F).
 * One flag per validated rule that matched; `count` events matched it, the first at `firstAtMs`.
 * `signalSeqs` holds at most 50 `gseq` values, in event order.
 */
export interface Flag {
  ruleId: string;
  family: string;
  tier: Tier;
  severity: Severity;
  count: number;
  firstAtMs: number;
  signalSeqs: readonly number[];
  observed: Observed;
}

/**
 * An unvalidated or unmatched signal, or a connectivity gap: shown on the timeline, never counted.
 * One item per event. `ruleId` and `family` name the first unvalidated rule the event matched (table order);
 * an unmatched event has neither; a `connectivity_gap` has family `connectivity` (never `focus`, D1-6).
 */
export interface ContextItem {
  kind: string;
  seq: number;
  atMs: number;
  family?: string;
  ruleId?: string;
  durationMs?: number;
  observed: Observed;
}

export interface BandOutput {
  band: Band;
  reasons: readonly string[];
  /** 0..1 with at most 2 decimals. */
  evidenceStrength: number;
  /** Effective coverage after the photo factor. */
  coveragePermille: number;
  flags: readonly Flag[];
  context: readonly ContextItem[];
  ruleTableVersion: string;
  engineVersion: string;
}
