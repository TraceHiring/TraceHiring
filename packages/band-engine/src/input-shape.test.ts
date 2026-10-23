// AT-D14 / specs/d1-demo-slice.md §5.1: the band input is identity-free and score-free (rule 1).
// M1 R5-7 / R5-52 e: the input gains `signalSettings` (the pinned ruleset's signal_settings, `{enabled: boolean}` per
// key), so the key set is the four §5.2 keys plus that one.
// The exact key set of BandInput is pinned twice: at compile time with expectTypeOf, and at run time
// from a Record<keyof ...> table that the compiler forces to match the type exactly.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { BandInput, ContextItem, SignalEvent } from './index.js';

/** Words that must never be a key of the band input: quality, score, cutoff and identity. */
const FORBIDDEN = /quality|score|cutoff|identity|candidate|session|email|grade|device|orgid/i;

const bandInputKeys = {
  events: true,
  coverage: true,
  capturedFamilies: true,
  photoMissing: true,
  signalSettings: true,
} satisfies Record<keyof BandInput, true>;

const coverageKeys = { activeMs: true, coveredMs: true } satisfies Record<
  keyof BandInput['coverage'],
  true
>;

const signalSettingKeys = { enabled: true } satisfies Record<
  keyof BandInput['signalSettings'][string],
  true
>;

const signalEventKeys = {
  seq: true,
  atMs: true,
  kind: true,
  durationMs: true,
  attrs: true,
  mediaRef: true,
} satisfies Record<keyof SignalEvent, true>;

describe('BandInput key set (AT-D14, R5-7)', () => {
  it('has exactly the four §5.2 keys plus signalSettings', () => {
    expectTypeOf<keyof BandInput>().toEqualTypeOf<
      'events' | 'coverage' | 'capturedFamilies' | 'photoMissing' | 'signalSettings'
    >();
    expect(Object.keys(bandInputKeys).sort()).toEqual([
      'capturedFamilies',
      'coverage',
      'events',
      'photoMissing',
      'signalSettings',
    ]);
  });

  it('has exactly the two coverage keys', () => {
    expectTypeOf<keyof BandInput['coverage']>().toEqualTypeOf<'activeMs' | 'coveredMs'>();
    expect(Object.keys(coverageKeys).sort()).toEqual(['activeMs', 'coveredMs']);
  });

  it('a signal setting is exactly { enabled: boolean } (R5-52 e)', () => {
    expectTypeOf<BandInput['signalSettings']>().toEqualTypeOf<
      Readonly<Record<string, { enabled: boolean }>>
    >();
    expect(Object.keys(signalSettingKeys)).toEqual(['enabled']);
  });

  it('has exactly the §5.2 SignalEvent keys (attrs is the only free-form bag)', () => {
    expectTypeOf<keyof SignalEvent>().toEqualTypeOf<
      'seq' | 'atMs' | 'kind' | 'durationMs' | 'attrs' | 'mediaRef'
    >();
    expect(Object.keys(signalEventKeys).sort()).toEqual([
      'atMs',
      'attrs',
      'durationMs',
      'kind',
      'mediaRef',
      'seq',
    ]);
  });

  it('marks a switched-off signal on its context item only (R5-7)', () => {
    expectTypeOf<ContextItem['disabledBySettings']>().toEqualTypeOf<true | undefined>();
  });

  it('has no quality, score, cutoff or identity key at any level', () => {
    // The pattern itself must catch the keys the rule forbids.
    for (const bad of ['qualityScore', 'meetsCutoff', 'candidateId', 'sessionId', 'orgId']) {
      expect(FORBIDDEN.test(bad)).toBe(true);
    }
    const all = [
      ...Object.keys(bandInputKeys),
      ...Object.keys(coverageKeys),
      ...Object.keys(signalSettingKeys),
      ...Object.keys(signalEventKeys),
    ];
    expect(all.filter((key) => FORBIDDEN.test(key))).toEqual([]);
  });

  it('rejects a quality key at compile time', () => {
    const input: BandInput = {
      events: [],
      coverage: { activeMs: 1, coveredMs: 1 },
      capturedFamilies: [],
      photoMissing: false,
      signalSettings: {},
      // @ts-expect-error BandInput has no quality key (rule 1)
      qualityScore: 80,
    };
    expect(Object.keys(input)).toContain('events');
  });
});
