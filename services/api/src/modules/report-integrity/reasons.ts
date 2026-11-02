// The card's reasons (spec §6.2): derived by the api from the band and the timeline entries, because no column holds
// them. Plain, neutral wording: signals are observations, not proof. Connectivity is always "Connectivity", never
// focus (D1-6). The first line is the card's one-line reason. Nothing here reads or names a quality value (rule 1).
import type { IntegrityCardRow, IntegrityTimelineEntryRow } from '@trace/shared/contracts/d1';

const MAX_REASONS = 10;

const events = (n: number) => (n === 1 ? '1 event' : `${String(n)} events`);
const sum = (entries: readonly IntegrityTimelineEntryRow[]) =>
  entries.reduce((n, e) => n + e.count, 0);
const pct = (permille: number) => `${String(permille / 10)}%`;

const headline = (
  band: IntegrityCardRow['band'],
  flags: readonly IntegrityTimelineEntryRow[],
): string => {
  switch (band) {
    case 'strong_concern':
      return flags.some((f) => f.signal_kind === 'untrusted_input')
        ? 'Input events not produced by the keyboard were recorded.'
        : 'A hard-evidence rule matched during the session.';
    case 'review':
      return 'Client-reported events were recorded that a person should look at.';
    case 'clear':
      return 'No validated rule matched during the session.';
    case 'insufficient_evidence':
      return 'Not assessed: session coverage was below the floor, so the band cannot be Clear.';
  }
};

/** At most ten lines: the headline, one line per flag rule, then context and coverage notes. */
export const reasonsFor = (
  card: IntegrityCardRow,
  entries: readonly IntegrityTimelineEntryRow[],
): string[] => {
  const flags = entries.filter((e) => e.entry_kind === 'flag');
  const context = entries.filter((e) => e.entry_kind === 'context');
  const lines = [headline(card.band, flags)];

  const byRule = new Map<string, IntegrityTimelineEntryRow[]>();
  for (const f of flags) {
    const key = f.rule_id ?? '';
    byRule.set(key, [...(byRule.get(key) ?? []), f]);
  }
  for (const [ruleId, group] of [...byRule.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const first = group[0];
    if (first === undefined) continue;
    if (first.signal_kind === 'untrusted_input') {
      lines.push(`Untrusted input, hard evidence: ${events(sum(group))} (rule ${ruleId}).`);
    } else if (first.family === 'paste') {
      lines.push(
        `Paste or drop: ${events(sum(group))} (rule ${ruleId}; client-reported, T3, can reach Review only).`,
      );
    } else {
      lines.push(`${events(sum(group))} matched rule ${ruleId} (tier ${first.tier ?? 'T3'}).`);
    }
  }

  const focus = context.filter(
    (e) => e.signal_kind === 'tab_hidden' || e.signal_kind === 'fullscreen_exit',
  );
  if (focus.length > 0) {
    lines.push(
      `Tab or fullscreen changes: ${events(sum(focus))} (context only, not used for the band).`,
    );
  }
  const gaps = context.filter((e) => e.signal_kind === 'connectivity_gap');
  if (gaps.length > 0) {
    lines.push(`Connectivity gaps: ${events(sum(gaps))} (context only).`);
  }
  const other = context.filter(
    (e) =>
      e.signal_kind !== 'tab_hidden' &&
      e.signal_kind !== 'fullscreen_exit' &&
      e.signal_kind !== 'connectivity_gap',
  );
  if (other.length > 0) {
    lines.push(`Other recorded events: ${events(sum(other))} (context only, not validated).`);
  }

  if (
    card.band !== 'insufficient_evidence' &&
    card.coverage_permille < card.coverage_floor_permille
  ) {
    lines.push(
      `Coverage was ${pct(card.coverage_permille)}, below the ${pct(card.coverage_floor_permille)} floor; the band rests on the recorded events.`,
    );
  }
  if (card.photo_missing) lines.push('No start photo, so coverage was lowered.');

  return lines.slice(0, MAX_REASONS);
};
