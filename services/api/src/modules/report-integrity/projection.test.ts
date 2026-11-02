// AT-D14 (rule 6; D1-10, L-15, L-28; spec §6.3): the projection maps what the caller can read and compares no scores.
// Band, strength, flags and timeline appear only for a `reviewed` card with `meets_cutoff = true`; `meets_cutoff =
// false` is `not_used_below_cutoff`; a missing quality card is `pending`. There is no null-cutoff branch: the input
// is a boolean or "no card visible", never a cutoff number.
import { IntegrityCard } from '@trace/shared/contracts/d1';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { contextEntry, entryRow, integrityCardRow, keysDeep } from './integrity.test-helpers.js';
import { projectIntegrityCard, type IntegrityInputs } from './projection.js';

const EVIDENCE_KEYS = [
  'band',
  'evidenceStrength',
  'coveragePct',
  'photoMissing',
  'reasons',
  'flags',
  'timeline',
  'signalsByFamily',
  'ruleTableVersion',
  'engineVersion',
];

const evidenceKeys = (value: unknown) => keysDeep(value).filter((k) => EVIDENCE_KEYS.includes(k));

describe('projectIntegrityCard (AT-D14)', () => {
  const entries = [entryRow(), contextEntry({ position: 2 })];

  it.each(['awaiting_quality', 'not_reviewed_below_cutoff'] as const)(
    'a %s card has no band, strength, flags or timeline keys (pending)',
    (state) => {
      const out = projectIntegrityCard({
        meetsCutoff: true,
        card: integrityCardRow({ review_state: state }),
        entries,
      });
      expect(out).toStrictEqual({ state: 'pending' });
      expect(evidenceKeys(out)).toEqual([]);
    },
  );

  it('meets_cutoff = false is not_used_below_cutoff, whatever card the caller could see', () => {
    for (const card of [
      null,
      integrityCardRow(),
      integrityCardRow({ review_state: 'not_reviewed_below_cutoff' }),
    ]) {
      const out = projectIntegrityCard({ meetsCutoff: false, card, entries });
      expect(out).toStrictEqual({ state: 'not_used_below_cutoff' });
      expect(Object.keys(out)).toEqual(['state']);
    }
  });

  it('a missing quality card is pending, even with a reviewed card visible (never released early)', () => {
    const out = projectIntegrityCard({ meetsCutoff: null, card: integrityCardRow(), entries });
    expect(out).toStrictEqual({ state: 'pending' });
  });

  it('at or above the cutoff with no visible card is pending', () => {
    expect(projectIntegrityCard({ meetsCutoff: true, card: null, entries: [] })).toStrictEqual({
      state: 'pending',
    });
  });

  it('at or above the cutoff with a reviewed card is the full card', () => {
    const out = projectIntegrityCard({ meetsCutoff: true, card: integrityCardRow(), entries });
    expect(IntegrityCard.parse(out)).toStrictEqual(out);
    expect(out.state).toBe('ready');
    if (out.state !== 'ready') return;
    expect(out.band).toBe('review');
    expect(out.evidenceStrength).toBe(0.75);
    expect(out.coveragePct).toBe(96.5);
    expect(out.ruleTableVersion).toBe('d1-v1');
    expect(out.engineVersion).toBe('band-engine-1');
    expect(out.flags).toHaveLength(1);
    expect(out.timeline).toHaveLength(2);
    expect(out.reasons.length).toBeGreaterThan(0);
  });

  it('takes no score, cutoff or other quality value: the input type has exactly three keys', () => {
    expectTypeOf<keyof IntegrityInputs>().toEqualTypeOf<'meetsCutoff' | 'card' | 'entries'>();
    expectTypeOf<IntegrityInputs['meetsCutoff']>().toEqualTypeOf<boolean | null>();
  });

  it('ignores timeline entries of another card or session', () => {
    const out = projectIntegrityCard({
      meetsCutoff: true,
      card: integrityCardRow(),
      entries: [
        entryRow(),
        entryRow({ position: 2, integrity_card_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
        entryRow({ position: 3, session_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
      ],
    });
    expect(out.state === 'ready' ? out.timeline.map((e) => e.position) : null).toEqual([1]);
  });

  it('is deterministic and orders the timeline by position', () => {
    const input = {
      meetsCutoff: true,
      card: integrityCardRow(),
      entries: [
        contextEntry({ position: 3 }),
        entryRow({ position: 1 }),
        contextEntry({ position: 2 }),
      ],
    };
    const a = projectIntegrityCard(input);
    const b = projectIntegrityCard(input);
    expect(a).toStrictEqual(b);
    expect(a.state === 'ready' ? a.timeline.map((e) => e.position) : null).toEqual([1, 2, 3]);
  });
});
