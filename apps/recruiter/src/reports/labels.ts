// Fixed wording for the report page. Everything is derived from the card's own payload; nothing here
// computes a band, a score or a decision (rules 1 and 2).
import type { IntegrityCard } from '@trace/shared/contracts/d1';

export type ReadyIntegrity = Extract<IntegrityCard, { state: 'ready' }>;
export type Family = ReadyIntegrity['signalsByFamily'][number]['family'];
export type SignalKind = ReadyIntegrity['timeline'][number]['signalKind'];
export type Band = ReadyIntegrity['band'];

/** The four signal families in table order. Focus is context only; connectivity is never "Focus". */
export const FAMILIES: readonly Family[] = ['paste', 'input_origin', 'focus', 'connectivity'];

export const FAMILY_LABEL: Readonly<Record<Family, string>> = {
  paste: 'Paste',
  input_origin: 'Input origin',
  focus: 'Focus (context only)',
  connectivity: 'Connectivity',
};

export const SIGNAL_LABEL: Readonly<Record<SignalKind, string>> = {
  paste: 'Paste',
  drop: 'Drop',
  untrusted_input: 'Input from an untrusted source',
  tab_hidden: 'Tab hidden',
  fullscreen_exit: 'Fullscreen exit',
  connectivity_gap: 'Connection gap',
};

export const BAND_LABEL: Readonly<Record<Band, string>> = {
  clear: 'Clear',
  review: 'Review suggested',
  strong_concern: 'Strong concern',
  insufficient_evidence: 'Insufficient evidence',
};

/** The lane a timeline entry sits in: its family, else the family its signal kind belongs to. */
export function laneOf(entry: { family: Family | null; signalKind: SignalKind }): Family {
  if (entry.family !== null) return entry.family;
  switch (entry.signalKind) {
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
}

/**
 * The tier note of a flag (§6.1). Untrusted input is hard evidence; every other T3 flag is client-reported and
 * can reach Review only (rule 3).
 */
export function tierNote(flag: { tier: 'T1' | 'T2' | 'T3'; family: Family }): string {
  if (flag.family === 'input_origin') return 'Untrusted input, hard evidence';
  if (flag.tier === 'T3') return 'Client-reported (T3), can reach Review only';
  if (flag.tier === 'T2') return 'Content-bound (T2)';
  return 'Server-observed (T1)';
}

/** Metadata-only observed values (never pasted content, rule 7 and 8). */
export function observedText(observed: {
  len?: number | undefined;
  durationMs?: number | undefined;
  count?: number | undefined;
}): string {
  const parts: string[] = [];
  if (observed.len !== undefined) parts.push(`${observed.len} characters`);
  if (observed.durationMs !== undefined) {
    parts.push(`${(observed.durationMs / 1000).toFixed(1)} s`);
  }
  if (observed.count !== undefined) parts.push(`Count ${observed.count}`);
  return parts.length === 0 ? 'No value recorded' : parts.join(' · ');
}
