// AT-M1-17, band-engine half (specs/m1-test-authoring.md §12, R5-7, R5-23 c, R5-52 e; rule 3). fast-check generates
// rule tables, band inputs and signal settings (the generators mirror band.property.test.ts):
//   (i)   every key enabled (and the empty map) -> output deep-equal to band-engine-1's (the frozen test-only oracle)
//         except engineVersion;
//   (ii)  disabling any set of kinds never gives a band of higher rank
//         (strong_concern 2 > review 1 > clear = insufficient_evidence 0);
//   (iii) for every settings map, the band is never above the band of the same table with its `validated = false`
//         rules removed: switching a signal on never lets an unvalidated rule raise the band.
// Synthetic values only.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeBand,
  type Band,
  type BandInput,
  type Rule,
  type RuleTable,
  type SignalEvent,
} from './index.js';
import { computeBand as computeBandV1 } from './oracle/band-engine-1.js';

const RUNS = { numRuns: 300 };
const FAMILY_POOL = ['fa', 'fb', 'fc', 'fd'] as const;
const KIND_POOL = ['k1', 'k2', 'k3', 'k4', 'k5'] as const;
const EVENT_KINDS = [...KIND_POOL, 'other_kind', 'connectivity_gap', 'constructor'] as const;
/** Setting keys: every event kind plus keys no event carries (accepted, never match). */
const SETTING_KEYS = [...EVENT_KINDS, 'zz_not_a_kind', 'tostring'] as const;

const rank = (band: Band): number =>
  ({ clear: 0, insufficient_evidence: 0, review: 1, strong_concern: 2 })[band];

// ---- Generators (as band.property.test.ts) ----------------------------------------------------------------------------

const arbRule = (families: readonly string[], index: number): fc.Arbitrary<Rule> =>
  fc
    .record({
      kinds: fc.uniqueArray(fc.constantFrom(...KIND_POOL, 'constructor'), {
        minLength: 1,
        maxLength: 3,
      }),
      family: fc.constantFrom(...families),
      tier: fc.constantFrom('T1' as const, 'T2' as const, 'T3' as const),
      severity: fc.constantFrom('soft' as const, 'medium' as const, 'hard' as const),
      validated: fc.boolean(),
      minDurationMs: fc.option(fc.integer({ min: 0, max: 5_000 }), { nil: undefined }),
      where: fc.option(fc.record({ x: fc.constantFrom('a', 'b') }), { nil: undefined }),
      untrusted: fc.option(fc.boolean(), { nil: undefined }),
      rawMedia: fc.option(fc.boolean(), { nil: undefined }),
    })
    .map((r) => {
      const rule: Rule = {
        id: `R${index}`,
        kinds: r.kinds,
        family: r.family,
        tier: r.tier,
        severity: r.severity,
        validated: r.validated,
      };
      if (r.minDurationMs !== undefined) rule.minDurationMs = r.minDurationMs;
      if (r.where !== undefined) rule.where = r.where;
      if (r.tier === 'T3' && r.untrusted !== undefined) rule.untrusted = r.untrusted;
      if (r.tier === 'T3' && r.rawMedia !== undefined) rule.rawMedia = r.rawMedia;
      return rule;
    });

const arbTable: fc.Arbitrary<RuleTable> = fc
  .record({
    floor: fc.integer({ min: 1, max: 1000 }),
    factor: fc.integer({ min: 1, max: 1000 }),
    families: fc.uniqueArray(fc.constantFrom(...FAMILY_POOL), { minLength: 1, maxLength: 4 }),
    ruleCount: fc.integer({ min: 0, max: 6 }),
  })
  .chain(({ floor, factor, families, ruleCount }) =>
    fc.tuple(...Array.from({ length: ruleCount }, (_, i) => arbRule(families, i))).map((rules) => ({
      version: 'gen-v1',
      coverageFloorPermille: floor,
      coveragePhotoMissingFactorPermille: factor,
      families,
      rules,
    })),
  );

const arbEvents: fc.Arbitrary<SignalEvent[]> = fc
  .uniqueArray(fc.integer({ min: 0, max: 10_000 }), { maxLength: 25 })
  .chain((seqs) =>
    fc
      .array(
        fc.record({
          atMs: fc.integer({ min: 0, max: 20_000 }),
          kind: fc.constantFrom<string>(...EVENT_KINDS),
          durationMs: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
          x: fc.option(fc.constantFrom('a', 'b'), { nil: undefined }),
          len: fc.option(fc.integer({ min: 0, max: 500 }), { nil: undefined }),
          mediaRef: fc.option(fc.constantFrom('m-1', 'm-2'), { nil: undefined }),
        }),
        { minLength: seqs.length, maxLength: seqs.length },
      )
      .map((bodies) =>
        bodies.map((b, i): SignalEvent => {
          const attrs: Record<string, string | number | boolean> = {};
          if (b.x !== undefined) attrs['x'] = b.x;
          if (b.len !== undefined) attrs['len'] = b.len;
          const event: SignalEvent = { seq: seqs[i]!, atMs: b.atMs, kind: b.kind, attrs };
          if (b.durationMs !== undefined) event.durationMs = b.durationMs;
          if (b.mediaRef !== undefined) event.mediaRef = b.mediaRef;
          return event;
        }),
      ),
  );

/** The band-engine-1 input (no signalSettings). */
type InputV1 = Omit<BandInput, 'signalSettings'>;
const arbInputV1: fc.Arbitrary<InputV1> = fc.record({
  events: arbEvents,
  coverage: fc
    .record({
      activeMs: fc.integer({ min: 0, max: 3_600_000 }),
      permille: fc.integer({ min: 0, max: 1100 }),
    })
    .map(({ activeMs, permille }) => ({
      activeMs,
      coveredMs: Math.floor((activeMs * permille) / 1000),
    })),
  capturedFamilies: fc.subarray([...FAMILY_POOL, 'other_family']),
  photoMissing: fc.boolean(),
});

/** A settings object built with own data properties (a key like `constructor` is an ordinary own key). */
const settingsOf = (
  entries: readonly (readonly [string, boolean])[],
): BandInput['signalSettings'] => {
  const out: Record<string, { enabled: boolean }> = {};
  for (const [key, enabled] of entries) {
    Object.defineProperty(out, key, { value: { enabled }, enumerable: true });
  }
  return out;
};

/** Every key enabled (or absent), possibly with extra keys no event carries switched off: all kinds enabled. */
const arbAllEnabled = fc
  .tuple(fc.subarray([...EVENT_KINDS]), fc.subarray(['zz_not_a_kind', 'tostring']), fc.boolean())
  .map(([on, extra, extraOn]) =>
    settingsOf([...on.map((k) => [k, true] as const), ...extra.map((k) => [k, extraOn] as const)]),
  );

/** Any settings: each key absent, enabled or disabled. */
const arbSettings = fc
  .array(fc.tuple(fc.constantFrom(...SETTING_KEYS), fc.boolean()), {
    maxLength: SETTING_KEYS.length,
  })
  .map((pairs) => settingsOf([...new Map(pairs)]));

const disabledKinds = (s: BandInput['signalSettings']): Set<string> =>
  new Set(
    Object.keys(s).filter((k) => Object.getOwnPropertyDescriptor(s, k)!.value.enabled === false),
  );

const validatedOnly = (table: RuleTable): RuleTable => ({
  ...table,
  rules: table.rules.filter((rule) => rule.validated),
});

// ---- Properties ---------------------------------------------------------------------------------------------------

describe('AT-M1-17 band-engine properties', () => {
  it('(i) with every kind enabled the output equals band-engine-1 except engineVersion', () => {
    fc.assert(
      fc.property(arbTable, arbInputV1, arbAllEnabled, (table, v1, settings) => {
        const expected = { ...computeBandV1(table, v1), engineVersion: 'band-engine-2' };
        expect(computeBand(table, { ...v1, signalSettings: settings })).toEqual(expected);
        expect(computeBand(table, { ...v1, signalSettings: {} })).toEqual(expected);
      }),
      RUNS,
    );
  });

  it('(ii) disabling any set of kinds never gives a band of higher rank', () => {
    fc.assert(
      fc.property(
        arbTable,
        arbInputV1,
        fc.subarray([...SETTING_KEYS]),
        fc.subarray([...SETTING_KEYS]),
        (table, v1, some, more) => {
          const fewer = settingsOf(some.map((k) => [k, false] as const));
          const most = settingsOf([...new Set([...some, ...more])].map((k) => [k, false] as const));
          const on = computeBand(table, { ...v1, signalSettings: {} });
          const a = computeBand(table, { ...v1, signalSettings: fewer });
          const b = computeBand(table, { ...v1, signalSettings: most });
          expect(rank(a.band)).toBeLessThanOrEqual(rank(on.band));
          expect(rank(b.band)).toBeLessThanOrEqual(rank(a.band));
          // Settings never touch coverage or evidence strength (capturedFamilies is the caller's, R5-23 a).
          expect(b.coveragePermille).toBe(on.coveragePermille);
          expect(b.evidenceStrength).toBe(on.evidenceStrength);
        },
      ),
      RUNS,
    );
  });

  it('(iii) with signals switched on the band is never above the band without the unvalidated rules', () => {
    fc.assert(
      fc.property(arbTable, arbInputV1, arbSettings, (table, v1, settings) => {
        const input = { ...v1, signalSettings: settings };
        const out = computeBand(table, input);
        const strict = computeBand(validatedOnly(table), input);
        expect(rank(out.band)).toBeLessThanOrEqual(rank(strict.band));
        expect(out.band).toBe(strict.band);
        expect(out.flags).toEqual(strict.flags);
        // Nor above the validated-only band with every signal on.
        const allOn = computeBand(validatedOnly(table), { ...v1, signalSettings: {} });
        expect(rank(out.band)).toBeLessThanOrEqual(rank(allOn.band));
      }),
      RUNS,
    );
  });

  it('a disabled event is one marked context item and in no flag; an enabled one is never marked', () => {
    fc.assert(
      fc.property(arbTable, arbInputV1, arbSettings, (table, v1, settings) => {
        const off = disabledKinds(settings);
        const out = computeBand(table, { ...v1, signalSettings: settings });
        const flagged = new Set(out.flags.flatMap((f) => f.signalSeqs));
        for (const e of v1.events) {
          const items = out.context.filter((c) => c.seq === e.seq);
          if (off.has(e.kind)) {
            expect(flagged.has(e.seq)).toBe(false);
            expect(items).toHaveLength(1);
            expect(items[0]!.disabledBySettings).toBe(true);
            expect(items[0]!.ruleId).toBeUndefined();
          } else {
            for (const c of items) expect(c.disabledBySettings).toBeUndefined();
          }
        }
        expect(out.flags.every((f) => f.count > 0)).toBe(true);
      }),
      RUNS,
    );
  });

  it('is deterministic in the settings: a clone or another key order gives the same output', () => {
    fc.assert(
      fc.property(arbTable, arbInputV1, arbSettings, (table, v1, settings) => {
        const a = computeBand(table, { ...v1, signalSettings: settings });
        const reversed = settingsOf(
          Object.keys(settings)
            .reverse()
            .map(
              (k) =>
                [
                  k,
                  Object.getOwnPropertyDescriptor(settings, k)!.value.enabled as boolean,
                ] as const,
            ),
        );
        expect(
          computeBand(structuredClone(table), { ...structuredClone(v1), signalSettings: reversed }),
        ).toEqual(a);
      }),
      RUNS,
    );
  });
});
