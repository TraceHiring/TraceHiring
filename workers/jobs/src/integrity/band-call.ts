// The band-engine call of the integrity stage (spec d1 §5.2, D1-6, D1-7; rules 3 and 6) and the rows derived from
// its output. The input is identity-free and score-free (BandInput has no quality key); the output's flags become
// integrity.flags rows in the state rule 6 requires, and, for a reviewed card only, timeline entries.
import {
  canonicalJson,
  computeBand,
  parseRuleTable,
  type BandInput,
  type BandOutput,
  type Observed,
  type RuleTable,
} from '@trace/band-engine';
import { signalCatalog } from '@trace/shared/signal-catalog';
import type { LoadedSignal } from './load.js';

/** At most this many timeline entries per card (position is a smallint); flags always fit, context is cut. */
export const MAX_TIMELINE_ENTRIES = 1000;
/** timeline `count` is a smallint. */
const MAX_COUNT = 32767;

const fail = (code: string): never => {
  throw new Error(code);
};

export interface RuleTableRow {
  id: string;
  version_no: number;
  families: string;
  coverage_floor_permille: number;
  coverage_photo_missing_factor_permille: number;
  rules: string;
  /** The pinned ruleset's `signal_settings` (jsonb as text; M1 R5-52 f): handed to the engine as stored. */
  signal_settings: string;
}

export type SignalSettings = Readonly<Record<string, { enabled: boolean }>>;

/**
 * The pinned ruleset's signal settings as stored (R5-52 f; never `{}` in place of them). Anything but a JSON object
 * fails closed; the values are checked by the engine (`{enabled: boolean}` only, else bad input).
 */
export const signalSettingsOf = (row: RuleTableRow): SignalSettings => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.signal_settings) as unknown;
  } catch {
    return fail('integrity_bad_signal_settings');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('integrity_bad_signal_settings');
  }
  return parsed as SignalSettings;
};

/** A kind is enabled unless its key is present with `enabled: false` (R5-23 b). */
const isDisabled = (settings: SignalSettings, kind: string): boolean =>
  Object.hasOwn(settings, kind) && settings[kind]?.enabled === false;

/** The rule table of integrity.band_rule_versions as the engine's RuleTable; label `d1-v<n>` (L-7). */
export const ruleTableOf = (row: RuleTableRow): RuleTable => {
  try {
    return parseRuleTable({
      version: `d1-v${row.version_no}`,
      coverageFloorPermille: row.coverage_floor_permille,
      coveragePhotoMissingFactorPermille: row.coverage_photo_missing_factor_permille,
      families: JSON.parse(row.families) as unknown,
      rules: JSON.parse(row.rules) as unknown,
    });
  } catch {
    return fail('integrity_bad_rule_table');
  }
};

export interface BandCall {
  input: BandInput;
  output: BandOutput;
  /** SHA-256 of canonicalJson(input): integrity.results.input_hash. */
  inputHash: string;
}

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

export const callBand = async (
  table: RuleTable,
  signals: readonly LoadedSignal[],
  coverage: { activeMs: number; coveredMs: number },
  signalCatalogVersion: string,
  photoMissing: boolean,
  signalSettings: SignalSettings,
): Promise<BandCall> => {
  let catalog: ReturnType<typeof signalCatalog>;
  try {
    catalog = signalCatalog(signalCatalogVersion);
  } catch {
    return fail('integrity_unknown_catalog');
  }
  // R5-23 a: evidence strength never counts a family whose every catalog kind the settings switch off.
  const kinds = Object.entries(catalog.signals);
  const families = catalog.families.filter((family) =>
    kinds.some(([kind, entry]) => entry.family === family && !isDisabled(signalSettings, kind)),
  );
  const input: BandInput = {
    events: signals.map((s) => s.event),
    coverage: { activeMs: coverage.activeMs, coveredMs: coverage.coveredMs },
    capturedFamilies: families,
    photoMissing,
    signalSettings,
  };
  let output: BandOutput;
  try {
    output = computeBand(table, input);
  } catch {
    return fail('integrity_bad_band_input');
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(input)),
  );
  return { input, output, inputHash: hex(digest) };
};

export interface FlagRow {
  rule_id: string;
  family: string;
  tier: string;
  severity: string;
  untrusted: boolean;
  raw_media: boolean;
  count: number;
  first_offset_ms: number;
  signal_seqs: number[];
}

/** integrity.flags rows for the output's flags (validated rules only). The state is chosen by the caller. */
export const flagRows = (table: RuleTable, output: BandOutput): FlagRow[] =>
  output.flags.map((f) => {
    const rule = table.rules.find((r) => r.id === f.ruleId);
    if (rule === undefined) return fail('integrity_bad_rule_table');
    return {
      rule_id: f.ruleId,
      family: f.family,
      tier: f.tier,
      severity: f.severity,
      untrusted: rule.untrusted === true,
      raw_media: rule.rawMedia === true,
      count: f.count,
      first_offset_ms: f.firstAtMs,
      signal_seqs: [...f.signalSeqs],
    };
  });

export interface TimelineRow {
  position: number;
  entry_kind: 'flag' | 'context';
  signal_kind: string;
  family: string | null;
  rule_id: string | null;
  tier: string | null;
  offset_ms: number;
  count: number;
  observed: { len?: number; duration_ms?: number; count?: number };
  flag_state: 'pending' | null;
  signal_seqs: number[];
}

const observedOf = (o: Observed): TimelineRow['observed'] => {
  const out: TimelineRow['observed'] = {};
  if (o.len !== undefined) out.len = o.len;
  if (o.durationMs !== undefined) out.duration_ms = o.durationMs;
  if (o.count !== undefined) out.count = o.count;
  return out;
};

/**
 * Timeline entries of a reviewed card (L-3: flag_state `pending` only; never content). One entry per flag and one
 * per context item, ordered by offset then gseq. Past MAX_TIMELINE_ENTRIES the latest context items are left out;
 * flags are always kept. A flag's signal kind is the kind of its first matched event.
 */
export const timelineRows = (
  output: BandOutput,
  signals: readonly LoadedSignal[],
): TimelineRow[] => {
  const kindOf = new Map(signals.map((s) => [s.seq, s.kind]));
  type Draft = Omit<TimelineRow, 'position'> & { firstSeq: number };
  const flags: Draft[] = output.flags.map((f) => {
    const first = f.signalSeqs[0];
    const kind = first === undefined ? undefined : kindOf.get(first);
    if (first === undefined || kind === undefined) return fail('integrity_bad_band_output');
    return {
      entry_kind: 'flag',
      signal_kind: kind,
      family: f.family,
      rule_id: f.ruleId,
      tier: f.tier,
      offset_ms: f.firstAtMs,
      count: Math.min(f.count, MAX_COUNT),
      observed: observedOf(f.observed),
      flag_state: 'pending',
      signal_seqs: [...f.signalSeqs],
      firstSeq: first,
    };
  });
  const order = (a: Draft, b: Draft) => a.offset_ms - b.offset_ms || a.firstSeq - b.firstSeq;
  const context: Draft[] = output.context
    .map((c): Draft => ({
      entry_kind: 'context',
      signal_kind: c.kind,
      family: c.family ?? null,
      rule_id: null,
      tier: null,
      offset_ms: c.atMs,
      count: 1,
      observed: observedOf(c.observed),
      flag_state: null,
      signal_seqs: [c.seq],
      firstSeq: c.seq,
    }))
    .sort(order)
    .slice(0, Math.max(0, MAX_TIMELINE_ENTRIES - flags.length));
  return [...flags, ...context].sort(order).map(({ firstSeq: _firstSeq, ...row }, index) => {
    void _firstSeq;
    return { ...row, position: index + 1 };
  });
};
