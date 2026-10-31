// Property tests P1-P10 of the band engine (specs/d1-demo-slice.md §5.2; AT-D4, AT-D5, AT-D6). fast-check generates
// valid rule tables (any tier, severity, validated flag, where/minDurationMs, untrusted/rawMedia on T3 only) and
// band inputs with unique gseq values. Synthetic values only.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RuleTableError, canonicalJson, computeBand, parseRuleTable } from './index.js';
import type { Band, BandInput, BandOutput, Rule, RuleTable, SignalEvent } from './index.js';

const RUNS = { numRuns: 300 };
const FAMILY_POOL = ['fa', 'fb', 'fc', 'fd'] as const;
const KIND_POOL = ['k1', 'k2', 'k3', 'k4', 'k5'] as const;
const EVENT_KINDS = [...KIND_POOL, 'other_kind', 'connectivity_gap'] as const;

const rank = (band: Band): number =>
  ({ clear: 0, insufficient_evidence: 1, review: 2, strong_concern: 3 })[band];

// ---- Generators --------------------------------------------------------------------------------------------------

const arbRule = (families: readonly string[], index: number): fc.Arbitrary<Rule> =>
  fc
    .record({
      kinds: fc.uniqueArray(fc.constantFrom(...KIND_POOL), { minLength: 1, maxLength: 3 }),
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

const arbEventBody = fc.record({
  atMs: fc.integer({ min: 0, max: 20_000 }),
  kind: fc.constantFrom<string>(...EVENT_KINDS),
  durationMs: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
  x: fc.option(fc.constantFrom('a', 'b'), { nil: undefined }),
  len: fc.option(fc.integer({ min: 0, max: 500 }), { nil: undefined }),
  count: fc.option(fc.integer({ min: 0, max: 20 }), { nil: undefined }),
  mediaRef: fc.option(fc.constantFrom('m-1', 'm-2'), { nil: undefined }),
});

type BodyT = typeof arbEventBody extends fc.Arbitrary<infer T> ? T : never;

function toEvent(seq: number, b: BodyT): SignalEvent {
  const attrs: Record<string, string | number | boolean> = {};
  if (b.x !== undefined) attrs['x'] = b.x;
  if (b.len !== undefined) attrs['len'] = b.len;
  if (b.count !== undefined) attrs['count'] = b.count;
  const event: SignalEvent = { seq, atMs: b.atMs, kind: b.kind, attrs };
  if (b.durationMs !== undefined) event.durationMs = b.durationMs;
  if (b.mediaRef !== undefined) event.mediaRef = b.mediaRef;
  return event;
}

const arbEvents: fc.Arbitrary<SignalEvent[]> = fc
  .uniqueArray(fc.integer({ min: 0, max: 10_000 }), { maxLength: 25 })
  .chain((seqs) =>
    fc
      .array(arbEventBody, { minLength: seqs.length, maxLength: seqs.length })
      .map((bodies) => bodies.map((b, i) => toEvent(seqs[i]!, b))),
  );

const arbCoverage = fc
  .record({
    activeMs: fc.integer({ min: 0, max: 3_600_000 }),
    permille: fc.integer({ min: 0, max: 1100 }),
  })
  .map(({ activeMs, permille }) => ({
    activeMs,
    coveredMs: Math.floor((activeMs * permille) / 1000),
  }));

const arbInput: fc.Arbitrary<BandInput> = fc.record({
  events: arbEvents,
  coverage: arbCoverage,
  capturedFamilies: fc.subarray([...FAMILY_POOL, 'other_family']),
  photoMissing: fc.boolean(),
  // Every kind enabled (R5-23 b): P1-P10 keep their band-engine-1 meaning; settings.property.test.ts varies them.
  signalSettings: fc.constant({}),
});

const withoutContext = (out: BandOutput): Partial<BandOutput> => {
  const rest: Partial<BandOutput> = { ...out };
  delete rest.context;
  return rest;
};
const freshSeq = (events: readonly SignalEvent[]): number =>
  events.reduce((max, e) => Math.max(max, e.seq), 0) + 1;

/** Effective coverage is low exactly as step 4 of §5.2 decides it. */
function isLowCoverage(table: RuleTable, input: BandInput): boolean {
  const { activeMs } = input.coverage;
  let covered = Math.min(input.coverage.coveredMs, activeMs);
  if (input.photoMissing)
    covered = Math.floor((covered * table.coveragePhotoMissingFactorPermille) / 1000);
  return activeMs <= 0 || covered * 1000 < table.coverageFloorPermille * activeMs;
}

// ---- Properties ---------------------------------------------------------------------------------------------------

describe('band engine properties', () => {
  it('P1: same input gives deep-equal output and identical canonicalJson (also after clone and re-parse)', () => {
    fc.assert(
      fc.property(arbTable, arbInput, (table, input) => {
        const a = computeBand(table, input);
        const b = computeBand(structuredClone(table), structuredClone(input));
        const reparsed = parseRuleTable(JSON.parse(canonicalJson(table)));
        const c = computeBand(reparsed, JSON.parse(JSON.stringify(input)) as BandInput);
        expect(b).toEqual(a);
        expect(c).toEqual(a);
        expect(canonicalJson(b)).toBe(canonicalJson(a));
        expect(canonicalJson(c)).toBe(canonicalJson(a));
      }),
      RUNS,
    );
  });

  it('P2: any permutation of events gives the same output', () => {
    fc.assert(
      fc.property(
        arbTable,
        arbInput.chain((input) =>
          fc
            .shuffledSubarray([...input.events], {
              minLength: input.events.length,
              maxLength: input.events.length,
            })
            .map((shuffled) => [input, { ...input, events: shuffled }] as const),
        ),
        (table, [input, permuted]) => {
          expect(canonicalJson(computeBand(table, permuted))).toBe(
            canonicalJson(computeBand(table, input)),
          );
        },
      ),
      RUNS,
    );
  });

  it('P3: a table of T3 rules without untrusted or rawMedia never gives strong_concern', () => {
    fc.assert(
      fc.property(arbTable, arbInput, (table, input) => {
        const t3: RuleTable = {
          ...table,
          rules: table.rules.map((rule) => {
            const t3Rule: Rule = { ...rule, tier: 'T3' };
            delete t3Rule.untrusted;
            delete t3Rule.rawMedia;
            return t3Rule;
          }),
        };
        expect(computeBand(t3, input).band).not.toBe('strong_concern');
      }),
      RUNS,
    );
  });

  it('P4: unvalidating any subset of rules never raises the band; all unvalidated gives clear or insufficient', () => {
    fc.assert(
      fc.property(
        arbTable,
        arbInput,
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        (table, input, mask) => {
          const before = computeBand(table, input);
          const partly: RuleTable = {
            ...table,
            rules: table.rules.map((rule, i) => (mask[i] ? { ...rule, validated: false } : rule)),
          };
          expect(rank(computeBand(partly, input).band)).toBeLessThanOrEqual(rank(before.band));
          const none: RuleTable = {
            ...table,
            rules: table.rules.map((rule) => ({ ...rule, validated: false })),
          };
          const out = computeBand(none, input);
          expect(['clear', 'insufficient_evidence']).toContain(out.band);
          expect(out.flags).toEqual([]);
        },
      ),
      RUNS,
    );
  });

  it('P5: coverage below the floor never gives clear; evidence still wins over low coverage', () => {
    fc.assert(
      fc.property(arbTable, arbInput, (table, input) => {
        fc.pre(isLowCoverage(table, input));
        const out = computeBand(table, input);
        expect(out.band).not.toBe('clear');
        if (out.flags.length === 0) expect(out.band).toBe('insufficient_evidence');
        const full = computeBand(table, {
          ...input,
          coverage: { activeMs: 1_000, coveredMs: 1_000 },
          photoMissing: false,
        });
        if (full.band === 'review' || full.band === 'strong_concern') {
          expect(out.band).toBe(full.band);
        } else {
          expect(out.band).toBe('insufficient_evidence');
          expect(out.reasons).toEqual(['low_coverage']);
        }
      }),
      RUNS,
    );
  });

  it('P6: events of unmatched kinds change nothing but context', () => {
    fc.assert(
      fc.property(
        arbTable,
        arbInput,
        fc.array(arbEventBody, { maxLength: 8 }),
        (table, input, extra) => {
          const start = freshSeq(input.events);
          const added = extra.map((b, i) => toEvent(start + i, { ...b, kind: 'unmatched_kind' }));
          const before = computeBand(table, input);
          const after = computeBand(table, { ...input, events: [...input.events, ...added] });
          expect(withoutContext(after)).toEqual(withoutContext(before));
          expect(after.context.length).toBe(before.context.length + added.length);
        },
      ),
      RUNS,
    );
  });

  it('P7: adding a matching validated event never lowers the band rank at fixed coverage', () => {
    fc.assert(
      fc.property(
        arbTable,
        arbInput,
        fc.nat(),
        fc.integer({ min: 0, max: 20_000 }),
        (table, input, pick, atMs) => {
          const validated = table.rules.filter((rule) => rule.validated);
          fc.pre(validated.length > 0);
          const rule = validated[pick % validated.length]!;
          const event: SignalEvent = {
            seq: freshSeq(input.events),
            atMs,
            kind: rule.kinds[0]!,
            attrs: { ...rule.where },
            durationMs: rule.minDurationMs ?? 0,
          };
          const before = computeBand(table, input);
          const after = computeBand(table, { ...input, events: [...input.events, event] });
          expect(after.flags.some((f) => f.ruleId === rule.id)).toBe(true);
          expect(rank(after.band)).toBeGreaterThanOrEqual(rank(before.band));
        },
      ),
      RUNS,
    );
  });

  it('P8: evidenceStrength is in [0, 1] with at most 2 decimals', () => {
    fc.assert(
      fc.property(arbTable, arbInput, (table, input) => {
        const { evidenceStrength: s } = computeBand(table, input);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
        expect(Math.round(s * 100) / 100).toBe(s);
      }),
      RUNS,
    );
  });

  describe('P9: parseRuleTable rejects', () => {
    const expectCode = (raw: unknown, code: string) => {
      try {
        parseRuleTable(raw);
      } catch (error) {
        expect(error).toBeInstanceOf(RuleTableError);
        expect((error as RuleTableError).code).toBe(code);
        return;
      }
      throw new Error('parseRuleTable accepted an invalid table');
    };
    const mutable = (table: RuleTable) =>
      structuredClone(table) as unknown as Record<string, unknown> & {
        rules: Record<string, unknown>[];
      };

    it('duplicate ids', () => {
      fc.assert(
        fc.property(arbTable, fc.nat(), fc.nat(), (table, a, b) => {
          fc.pre(table.rules.length >= 2);
          const raw = mutable(table);
          const i = a % raw.rules.length;
          let j = b % raw.rules.length;
          if (j === i) j = (i + 1) % raw.rules.length;
          raw.rules[j]!['id'] = raw.rules[i]!['id'];
          expectCode(raw, 'duplicate_rule_id');
        }),
        RUNS,
      );
    });

    it('unknown keys on the table or on a rule', () => {
      const knownTable = [
        'version',
        'coverageFloorPermille',
        'coveragePhotoMissingFactorPermille',
        'families',
        'rules',
      ];
      const knownRule = [
        'id',
        'kinds',
        'family',
        'tier',
        'severity',
        'validated',
        'where',
        'minDurationMs',
        'untrusted',
        'rawMedia',
      ];
      fc.assert(
        fc.property(
          arbTable,
          fc
            .string({ minLength: 1, maxLength: 12 })
            .filter((k) => !knownTable.includes(k) && !knownRule.includes(k)),
          fc.boolean(),
          fc.jsonValue(),
          (table, key, onRule, value) => {
            const raw = mutable(table);
            if (onRule && raw.rules.length > 0) {
              Object.defineProperty(raw.rules[0], key, { value: value ?? 0, enumerable: true });
            } else {
              Object.defineProperty(raw, key, { value: value ?? 0, enumerable: true });
            }
            expectCode(raw, 'unknown_key');
          },
        ),
        RUNS,
      );
    });

    it('a floor or factor outside 1-1000', () => {
      fc.assert(
        fc.property(
          arbTable,
          fc.oneof(
            fc.integer({ max: 0 }),
            fc.integer({ min: 1001 }),
            fc.double({ min: 1.01, max: 999.99, noInteger: true }),
          ),
          fc.boolean(),
          (table, bad, onFloor) => {
            const raw = mutable(table);
            raw[onFloor ? 'coverageFloorPermille' : 'coveragePhotoMissingFactorPermille'] = bad;
            expectCode(raw, 'bad_permille');
          },
        ),
        RUNS,
      );
    });

    it('untrusted or rawMedia on a non-T3 tier', () => {
      fc.assert(
        fc.property(
          arbTable,
          fc.nat(),
          fc.constantFrom('T1', 'T2'),
          fc.constantFrom('untrusted', 'rawMedia'),
          fc.boolean(),
          (table, pick, tier, key, value) => {
            fc.pre(table.rules.length > 0);
            const raw = mutable(table);
            const rule = raw.rules[pick % raw.rules.length]!;
            rule['tier'] = tier;
            rule[key] = value;
            expectCode(raw, 'escalation_on_non_t3');
          },
        ),
        RUNS,
      );
    });
  });

  it('P10: photoMissing never changes flags and only moves the band between clear and insufficient_evidence', () => {
    fc.assert(
      fc.property(arbTable, arbInput, (table, input) => {
        const without = computeBand(table, { ...input, photoMissing: false });
        const withMissing = computeBand(table, { ...input, photoMissing: true });
        expect(withMissing.flags).toEqual(without.flags);
        expect(withMissing.context).toEqual(without.context);
        expect(withMissing.coveragePermille).toBeLessThanOrEqual(without.coveragePermille);
        if (withMissing.band !== without.band) {
          expect(without.band).toBe('clear');
          expect(withMissing.band).toBe('insufficient_evidence');
        }
      }),
      RUNS,
    );
  });
});
