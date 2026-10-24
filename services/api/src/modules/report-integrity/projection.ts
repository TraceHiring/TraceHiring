// The integrity card projection (spec §6.2, §6.3; rule 6, AT-D14). Neutral: it compares no scores and takes no
// quality number, only the boolean `quality_cards.meets_cutoff` of the session (or null when no quality card is
// visible). It maps what the caller can read:
//   - meets_cutoff = false                      -> not_used_below_cutoff (nothing else, whatever card exists)
//   - meets_cutoff = true and a `reviewed` card -> ready (band, strength, flags, timeline, reasons)
//   - anything else (no quality card, no card, a card not `reviewed`) -> pending
// The evidence keys are absent unless the card is `reviewed` (§6.3: absent, not hidden). RLS returns only `reviewed`
// cards and entries already; this check holds without it.
import type {
  IntegrityCard,
  IntegrityCardRow,
  IntegrityTimelineEntryRow,
} from '@trace/shared/contracts/d1';
import { reasonsFor } from './reasons.js';

export interface IntegrityInputs {
  /** `quality_cards.meets_cutoff` of the session; null when the caller can see no quality card. */
  meetsCutoff: boolean | null;
  /** The integrity card the report points at, as the caller can see it; null when none is visible. */
  card: IntegrityCardRow | null;
  /** That card's timeline entries, as the caller can see them. */
  entries: readonly IntegrityTimelineEntryRow[];
}

type Ready = Extract<IntegrityCard, { state: 'ready' }>;
type Family = Ready['signalsByFamily'][number]['family'];
type FlagFamily = Ready['flags'][number]['family'];
type Observed = Ready['timeline'][number]['observed'];

const FAMILIES: readonly Family[] = ['paste', 'input_origin', 'focus', 'connectivity'];

const familyOfKind = (kind: IntegrityTimelineEntryRow['signal_kind']): Family => {
  switch (kind) {
    case 'paste':
    case 'drop':
      return 'paste';
    case 'untrusted_input':
      return 'input_origin';
    case 'tab_hidden':
    case 'fullscreen_exit':
      return 'focus';
    case 'connectivity_gap':
      return 'connectivity';
  }
};

const observed = (o: IntegrityTimelineEntryRow['observed']): Observed => ({
  ...(o.len === undefined ? {} : { len: o.len }),
  ...(o.duration_ms === undefined ? {} : { durationMs: o.duration_ms }),
  ...(o.count === undefined ? {} : { count: o.count }),
});

const isFlagFamily = (f: Family | null): f is FlagFamily => f !== null && f !== 'connectivity';

const ready = (card: IntegrityCardRow, all: readonly IntegrityTimelineEntryRow[]): Ready => {
  const entries = all
    .filter((e) => e.integrity_card_id === card.id && e.session_id === card.session_id)
    .sort((a, b) => a.position - b.position);

  const flags: Ready['flags'] = [];
  for (const e of entries) {
    if (e.entry_kind !== 'flag' || e.rule_id === null || e.tier === null) continue;
    if (!isFlagFamily(e.family)) continue;
    flags.push({
      ruleId: e.rule_id,
      family: e.family,
      tier: e.tier,
      atMs: e.offset_ms,
      count: e.count,
      observed: observed(e.observed),
      signalSeqs: [...e.signal_seqs],
      state: 'pending',
    });
  }

  const signalsByFamily = FAMILIES.map((family) => {
    const own = entries.filter((e) => (e.family ?? familyOfKind(e.signal_kind)) === family);
    const count = (kind: 'flag' | 'context') =>
      own.filter((e) => e.entry_kind === kind).reduce((n, e) => n + e.count, 0);
    return { family, flagCount: count('flag'), contextCount: count('context') };
  });

  return {
    state: 'ready',
    band: card.band,
    evidenceStrength: card.evidence_strength,
    coveragePct: card.coverage_permille / 10,
    photoMissing: card.photo_missing,
    reasons: reasonsFor(card, entries),
    flags,
    timeline: entries.map((e) => ({
      position: e.position,
      entryKind: e.entry_kind,
      signalKind: e.signal_kind,
      family: e.family,
      ruleId: e.rule_id,
      tier: e.tier,
      atMs: e.offset_ms,
      count: e.count,
      observed: observed(e.observed),
      flagState: e.flag_state,
      signalSeqs: [...e.signal_seqs],
    })),
    signalsByFamily,
    ruleTableVersion: card.rule_table_version,
    engineVersion: card.engine_version,
  };
};

export const projectIntegrityCard = (input: IntegrityInputs): IntegrityCard => {
  if (input.meetsCutoff === false) return { state: 'not_used_below_cutoff' };
  if (input.meetsCutoff !== true || input.card === null || input.card.review_state !== 'reviewed') {
    return { state: 'pending' };
  }
  return ready(input.card, input.entries);
};
