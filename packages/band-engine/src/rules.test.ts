// Table-driven examples of the band engine (specs/d1-demo-slice.md §5.2; AT-D4, AT-D5, AT-D6).
// Part 1: parseRuleTable is strict (P9 has the generated cases in band.property.test.ts).
// Part 2: the D1 examples on rule table v1 (rules/d1-v1.json, the single source the migration seeds).
// Synthetic values only.
import { describe, expect, it } from 'vitest';
import d1v1 from './rules/d1-v1.json' with { type: 'json' };
import {
  BAND_ENGINE_VERSION,
  BandInputError,
  RuleTableError,
  computeBand,
  parseRuleTable,
} from './index.js';
import type { BandInput, SignalEvent } from './index.js';

const clone = <T>(value: T): T => structuredClone(value);
type Raw = Record<string, unknown> & { rules: Record<string, unknown>[] };
const rawTable = (): Raw => clone(d1v1) as unknown as Raw;

function expectRuleTableError(raw: unknown, code: string): void {
  let caught: unknown;
  try {
    parseRuleTable(raw);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(RuleTableError);
  expect((caught as RuleTableError).code).toBe(code);
}

describe('parseRuleTable (strict, hand-written)', () => {
  it('accepts rule table v1 and returns an equal, independent, frozen copy', () => {
    const raw = rawTable();
    const table = parseRuleTable(raw);
    expect(table).toEqual(d1v1);
    expect(table).not.toBe(raw);
    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.isFrozen(table.rules)).toBe(true);
    expect(Object.isFrozen(table.rules[0])).toBe(true);
    raw.rules[0]!['validated'] = false;
    expect(table.rules[0]!.validated).toBe(true);
  });

  it('pins the v1 values of §5.2', () => {
    const table = parseRuleTable(rawTable());
    expect(table.version).toBe('d1-v1');
    expect(table.coverageFloorPermille).toBe(700);
    expect(table.coveragePhotoMissingFactorPermille).toBe(750);
    expect(table.families).toEqual(['paste', 'input_origin', 'focus']);
    expect(
      table.rules.map((r) => [
        r.id,
        r.family,
        r.tier,
        r.severity,
        r.validated,
        r.untrusted ?? false,
      ]),
    ).toEqual([
      ['D1-PASTE', 'paste', 'T3', 'medium', true, false],
      ['D1-UNTRUSTED-INPUT', 'input_origin', 'T3', 'hard', true, true],
      ['D1-TAB-HIDDEN', 'focus', 'T3', 'soft', false, false],
      ['D1-FULLSCREEN-EXIT', 'focus', 'T3', 'soft', false, false],
    ]);
    expect(table.rules.find((r) => r.id === 'D1-TAB-HIDDEN')!.minDurationMs).toBe(3000);
    expect(table.rules.some((r) => r.rawMedia === true)).toBe(false);
  });

  it.each<[string, (t: Raw) => unknown, string]>([
    ['not an object', () => 'd1-v1', 'not_object'],
    ['null', () => null, 'not_object'],
    ['an array', () => [], 'not_object'],
    ['an unknown top-level key', (t) => ({ ...t, extra: 1 }), 'unknown_key'],
    [
      'a __proto__ key',
      (t) => JSON.parse(JSON.stringify(t).replace('{', '{"__proto__":{},')),
      'unknown_key',
    ],
    ['a missing key', (t) => ({ ...t, families: undefined }), 'missing_key'],
    ['an empty version', (t) => ({ ...t, version: '' }), 'bad_version'],
    ['a long version', (t) => ({ ...t, version: 'v'.repeat(33) }), 'bad_version'],
    ['a version with a space', (t) => ({ ...t, version: 'd1 v1' }), 'bad_version'],
    ['floor 0', (t) => ({ ...t, coverageFloorPermille: 0 }), 'bad_permille'],
    ['floor 1001', (t) => ({ ...t, coverageFloorPermille: 1001 }), 'bad_permille'],
    ['floor 700.5', (t) => ({ ...t, coverageFloorPermille: 700.5 }), 'bad_permille'],
    ['floor as a string', (t) => ({ ...t, coverageFloorPermille: '700' }), 'bad_permille'],
    ['factor 0', (t) => ({ ...t, coveragePhotoMissingFactorPermille: 0 }), 'bad_permille'],
    ['factor 1001', (t) => ({ ...t, coveragePhotoMissingFactorPermille: 1001 }), 'bad_permille'],
    ['empty families', (t) => ({ ...t, families: [] }), 'bad_families'],
    ['duplicate families', (t) => ({ ...t, families: ['paste', 'paste'] }), 'bad_families'],
    [
      'a family named connectivity',
      (t) => ({ ...t, families: [...(t['families'] as string[]), 'connectivity'] }),
      'connectivity_reserved',
    ],
    ['rules not an array', (t) => ({ ...t, rules: {} }), 'bad_rules'],
  ])('rejects %s', (_label, edit, code) => {
    expectRuleTableError(edit(rawTable()), code);
  });

  const ruleEdit =
    (patch: Record<string, unknown>, index = 0) =>
    (t: Raw): Raw => {
      t.rules[index] = { ...t.rules[index], ...patch };
      return t;
    };

  it.each<[string, (t: Raw) => unknown, string]>([
    ['a rule that is not an object', (t) => ({ ...t, rules: ['D1-PASTE'] }), 'bad_rule'],
    ['an unknown rule key', ruleEdit({ policy: 'allowed' }), 'unknown_key'],
    ['a missing rule key', ruleEdit({ validated: undefined }), 'missing_key'],
    ['a duplicate rule id', ruleEdit({ id: 'D1-PASTE' }, 1), 'duplicate_rule_id'],
    ['an empty rule id', ruleEdit({ id: '' }), 'bad_rule'],
    ['a rule id with a space', ruleEdit({ id: 'D1 PASTE' }), 'bad_rule'],
    ['empty kinds', ruleEdit({ kinds: [] }), 'bad_rule'],
    ['duplicate kinds', ruleEdit({ kinds: ['paste', 'paste'] }), 'bad_rule'],
    ['a kind that is not snake case', ruleEdit({ kinds: ['Paste'] }), 'bad_rule'],
    [
      'a rule on connectivity_gap',
      ruleEdit({ kinds: ['connectivity_gap'] }),
      'connectivity_reserved',
    ],
    ['a family outside the table', ruleEdit({ family: 'not_a_family' }), 'unknown_family'],
    ['an unknown tier', ruleEdit({ tier: 'T4' }), 'bad_rule'],
    ['an unknown severity', ruleEdit({ severity: 'critical' }), 'bad_rule'],
    ['validated as a string', ruleEdit({ validated: 'true' }), 'bad_rule'],
    ['untrusted as a string', ruleEdit({ untrusted: 'yes' }), 'bad_rule'],
    ['rawMedia as a number', ruleEdit({ rawMedia: 1 }), 'bad_rule'],
    ['untrusted on T1', ruleEdit({ tier: 'T1', untrusted: true }), 'escalation_on_non_t3'],
    ['untrusted false on T2', ruleEdit({ tier: 'T2', untrusted: false }), 'escalation_on_non_t3'],
    ['rawMedia on T2', ruleEdit({ tier: 'T2', rawMedia: true }), 'escalation_on_non_t3'],
    ['a negative minDurationMs', ruleEdit({ minDurationMs: -1 }), 'bad_rule'],
    ['a fractional minDurationMs', ruleEdit({ minDurationMs: 1.5 }), 'bad_rule'],
    ['where not an object', ruleEdit({ where: ['x'] }), 'bad_rule'],
    ['a where value that is an object', ruleEdit({ where: { dt: { a: 1 } } }), 'bad_rule'],
    ['a where value that is null', ruleEdit({ where: { dt: null } }), 'bad_rule'],
    ['a where key that is empty', ruleEdit({ where: { '': 'x' } }), 'bad_rule'],
    [
      'a where key __proto__',
      (t) =>
        JSON.parse(
          JSON.stringify(ruleEdit({ where: { a: 1 } })(t)).replace(
            '"where":{',
            '"where":{"__proto__":1,',
          ),
        ),
      'bad_rule',
    ],
  ])('rejects %s', (_label, edit, code) => {
    expectRuleTableError(edit(rawTable()), code);
  });

  it('accepts the optional keys where they are allowed', () => {
    const t = rawTable();
    t.rules.push({
      id: 'X-HARD',
      kinds: ['some_kind'],
      where: { dt: 'files', n: 2, b: true },
      minDurationMs: 0,
      family: 'focus',
      tier: 'T1',
      severity: 'hard',
      validated: false,
    });
    t.rules.push({
      id: 'X-MEDIA',
      kinds: ['other_kind'],
      family: 'focus',
      tier: 'T3',
      severity: 'hard',
      validated: false,
      rawMedia: true,
      untrusted: false,
    });
    const table = parseRuleTable(t);
    expect(table.rules).toHaveLength(6);
    expect(table.rules[4]!.where).toEqual({ dt: 'files', n: 2, b: true });
  });

  it('accepts an empty rule list', () => {
    expect(parseRuleTable({ ...rawTable(), rules: [] }).rules).toEqual([]);
  });

  it('never echoes a value in its error message', () => {
    const marker = 'zz-synthetic-marker';
    try {
      parseRuleTable({ ...rawTable(), version: `${marker} with space` });
    } catch (error) {
      expect((error as Error).message).not.toContain(marker);
    }
  });
});

// ---- D1 examples (§5.2) --------------------------------------------------------------------------------------------

const TABLE = parseRuleTable(d1v1);
const FAMILIES = ['paste', 'input_origin', 'focus'];
let nextSeq = 1;
const ev = (kind: string, atMs: number, extra: Partial<SignalEvent> = {}): SignalEvent => ({
  seq: nextSeq++,
  atMs,
  kind,
  attrs: { item: 1 },
  ...extra,
});
const input = (
  events: SignalEvent[],
  coverage: { activeMs: number; coveredMs: number } = { activeMs: 1_200_000, coveredMs: 1_200_000 },
  photoMissing = false,
): BandInput => ({
  events,
  coverage,
  capturedFamilies: FAMILIES,
  photoMissing,
  signalSettings: {},
});

describe('computeBand on rule table v1 (D1 examples, AT-D5, AT-D6)', () => {
  it('no event, full coverage -> clear', () => {
    const out = computeBand(TABLE, input([]));
    expect(out.band).toBe('clear');
    expect(out.flags).toEqual([]);
    expect(out.context).toEqual([]);
    expect(out.coveragePermille).toBe(1000);
    expect(out.evidenceStrength).toBe(1);
    expect(out.ruleTableVersion).toBe('d1-v1');
    expect(out.engineVersion).toBe(BAND_ENGINE_VERSION);
  });

  it('one paste -> review (T3 cap), with a flag carrying time, rule, observed value and gseq', () => {
    const out = computeBand(
      TABLE,
      input([{ seq: 7, atMs: 61_000, kind: 'paste', attrs: { item: 2, len: 120 } }]),
    );
    expect(out.band).toBe('review');
    expect(out.reasons).toEqual(['t3_severity:D1-PASTE']);
    expect(out.flags).toEqual([
      {
        ruleId: 'D1-PASTE',
        family: 'paste',
        tier: 'T3',
        severity: 'medium',
        count: 1,
        firstAtMs: 61_000,
        signalSeqs: [7],
        observed: { len: 120 },
      },
    ]);
  });

  it('one drop -> review (same rule as paste)', () => {
    const out = computeBand(
      TABLE,
      input([ev('drop', 5_000, { attrs: { item: 1, len: 3, dt: 'files' } })]),
    );
    expect(out.band).toBe('review');
    expect(out.flags.map((f) => f.ruleId)).toEqual(['D1-PASTE']);
  });

  it('one untrusted_input -> strong_concern', () => {
    const out = computeBand(
      TABLE,
      input([ev('untrusted_input', 9_000, { attrs: { item: 1, via: 'keydown', count: 4 } })]),
    );
    expect(out.band).toBe('strong_concern');
    expect(out.reasons).toEqual(['untrusted:D1-UNTRUSTED-INPUT']);
    expect(out.flags[0]!.observed).toEqual({ count: 4 });
  });

  it('50 tab_hidden -> clear (context only, never counted)', () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      ev('tab_hidden', 10_000 * (i + 1), { durationMs: 5_000 }),
    );
    const out = computeBand(TABLE, input(events));
    expect(out.band).toBe('clear');
    expect(out.flags).toEqual([]);
    expect(out.context).toHaveLength(50);
    expect(out.context[0]).toEqual({
      kind: 'tab_hidden',
      seq: events[0]!.seq,
      atMs: 10_000,
      family: 'focus',
      ruleId: 'D1-TAB-HIDDEN',
      durationMs: 5_000,
      observed: { durationMs: 5_000 },
    });
  });

  it('fullscreen_exit -> clear (context only)', () => {
    const out = computeBand(TABLE, input([ev('fullscreen_exit', 1_000)]));
    expect(out.band).toBe('clear');
    expect(out.context.map((c) => c.ruleId)).toEqual(['D1-FULLSCREEN-EXIT']);
  });

  it('a tab_hidden under 3 s matches no rule and is unmatched context', () => {
    const out = computeBand(TABLE, input([ev('tab_hidden', 1_000, { durationMs: 2_999 })]));
    expect(out.band).toBe('clear');
    expect(out.context).toEqual([
      {
        kind: 'tab_hidden',
        seq: expect.any(Number),
        atMs: 1_000,
        durationMs: 2_999,
        observed: { durationMs: 2_999 },
      },
    ]);
  });

  it('paste plus untrusted -> strong_concern', () => {
    const out = computeBand(TABLE, input([ev('paste', 1_000), ev('untrusted_input', 2_000)]));
    expect(out.band).toBe('strong_concern');
    expect(out.flags.map((f) => f.ruleId)).toEqual(['D1-PASTE', 'D1-UNTRUSTED-INPUT']);
  });

  it('coverage 50% with a paste -> review (evidence wins)', () => {
    const out = computeBand(
      TABLE,
      input([ev('paste', 1_000)], { activeMs: 1_000_000, coveredMs: 500_000 }),
    );
    expect(out.band).toBe('review');
    expect(out.coveragePermille).toBe(500);
  });

  it('coverage 50% with no event -> insufficient_evidence, reason low_coverage', () => {
    const out = computeBand(TABLE, input([], { activeMs: 1_000_000, coveredMs: 500_000 }));
    expect(out.band).toBe('insufficient_evidence');
    expect(out.reasons).toEqual(['low_coverage']);
  });

  it('coverage 50% with only context events -> insufficient_evidence, events stay as context', () => {
    const out = computeBand(
      TABLE,
      input([ev('tab_hidden', 1_000, { durationMs: 9_000 })], { activeMs: 1_000, coveredMs: 500 }),
    );
    expect(out.band).toBe('insufficient_evidence');
    expect(out.context).toHaveLength(1);
  });

  it('real coverage 90% with no event and photoMissing (effective 675) -> insufficient_evidence', () => {
    const out = computeBand(TABLE, input([], { activeMs: 1_000_000, coveredMs: 900_000 }, true));
    expect(out.coveragePermille).toBe(675);
    expect(out.band).toBe('insufficient_evidence');
  });

  it('the same with a paste -> review', () => {
    const out = computeBand(
      TABLE,
      input([ev('paste', 1_000)], { activeMs: 1_000_000, coveredMs: 900_000 }, true),
    );
    expect(out.coveragePermille).toBe(675);
    expect(out.band).toBe('review');
  });

  it('coverage exactly at the floor is not low (700 of 1000 -> clear)', () => {
    expect(computeBand(TABLE, input([], { activeMs: 1_000, coveredMs: 700 })).band).toBe('clear');
    expect(computeBand(TABLE, input([], { activeMs: 1_000, coveredMs: 699 })).band).toBe(
      'insufficient_evidence',
    );
  });

  it('coverage uses integer arithmetic: 699.9 permille is low, never rounded up', () => {
    const out = computeBand(TABLE, input([], { activeMs: 10_000, coveredMs: 6_999 }));
    expect(out.coveragePermille).toBe(699);
    expect(out.band).toBe('insufficient_evidence');
  });

  it('activeMs 0 -> insufficient_evidence with coverage 0', () => {
    const out = computeBand(TABLE, input([], { activeMs: 0, coveredMs: 0 }));
    expect(out.band).toBe('insufficient_evidence');
    expect(out.coveragePermille).toBe(0);
  });

  it('coveredMs above activeMs is capped at 1000 permille', () => {
    expect(
      computeBand(TABLE, input([], { activeMs: 1_000, coveredMs: 1_500 })).coveragePermille,
    ).toBe(1000);
  });

  it('connectivity gaps are context labelled connectivity, never focus, and never raise the band', () => {
    const out = computeBand(
      TABLE,
      input([ev('connectivity_gap', 30_000, { durationMs: 20_000, attrs: {} })]),
    );
    expect(out.band).toBe('clear');
    expect(out.context).toEqual([
      {
        kind: 'connectivity_gap',
        seq: expect.any(Number),
        atMs: 30_000,
        family: 'connectivity',
        durationMs: 20_000,
        observed: { durationMs: 20_000 },
      },
    ]);
  });

  it('an unknown kind is unmatched context', () => {
    const out = computeBand(TABLE, input([ev('some_future_signal', 1_000)]));
    expect(out.band).toBe('clear');
    expect(out.context).toEqual([
      { kind: 'some_future_signal', seq: expect.any(Number), atMs: 1_000, observed: {} },
    ]);
  });

  it('evidenceStrength counts captured table families (2 of 3 -> 0.67, none -> 0)', () => {
    const base = input([]);
    expect(
      computeBand(TABLE, { ...base, capturedFamilies: ['paste', 'focus'] }).evidenceStrength,
    ).toBe(0.67);
    expect(computeBand(TABLE, { ...base, capturedFamilies: ['paste'] }).evidenceStrength).toBe(
      0.33,
    );
    expect(computeBand(TABLE, { ...base, capturedFamilies: [] }).evidenceStrength).toBe(0);
    expect(
      computeBand(TABLE, { ...base, capturedFamilies: ['not_a_family', 'paste', 'paste'] })
        .evidenceStrength,
    ).toBe(0.33);
  });

  it('several pastes make one flag: count, first time, ≤ 50 gseq values in time order, summed length', () => {
    const events = Array.from({ length: 60 }, (_, i) => ({
      seq: 1000 - i,
      atMs: 1_000 * (60 - i),
      kind: 'paste',
      attrs: { item: 1, len: 2 },
    }));
    const out = computeBand(TABLE, input(events));
    expect(out.flags).toHaveLength(1);
    const flag = out.flags[0]!;
    expect(flag.count).toBe(60);
    expect(flag.firstAtMs).toBe(1_000);
    expect(flag.signalSeqs).toHaveLength(50);
    expect(flag.signalSeqs[0]).toBe(941);
    expect(flag.observed).toEqual({ len: 120 });
  });

  it('a paste after a reload on a second stream keeps its own session-global gseq', () => {
    // Stream 1 had seq 1..3; after a reload stream 2 restarts at 1, but the engine sees gseq only (L-14).
    const events: SignalEvent[] = [
      { seq: 1, atMs: 1_000, kind: 'tab_hidden', durationMs: 4_000, attrs: { item: 1 } },
      { seq: 2, atMs: 2_000, kind: 'fullscreen_exit', attrs: { item: 1 } },
      { seq: 4, atMs: 9_000, kind: 'paste', attrs: { item: 2, len: 10 } },
    ];
    const out = computeBand(TABLE, input(events));
    expect(out.band).toBe('review');
    expect(out.flags[0]!.signalSeqs).toEqual([4]);
  });

  it('two events with one gseq cannot occur: the engine refuses them', () => {
    expect(() =>
      computeBand(
        TABLE,
        input([
          { seq: 1, atMs: 1, kind: 'paste', attrs: {} },
          { seq: 1, atMs: 2, kind: 'paste', attrs: {} },
        ]),
      ),
    ).toThrow(BandInputError);
  });

  it('does not mutate its input', () => {
    const events = [ev('paste', 2_000), ev('tab_hidden', 1_000, { durationMs: 4_000 })];
    const given = input(events);
    const before = clone(given);
    computeBand(TABLE, given);
    expect(given).toEqual(before);
  });
});

describe('computeBand refuses malformed input (fail closed)', () => {
  const ok = input([]);
  it.each<[string, unknown]>([
    ['a non-object input', 'x'],
    ['an extra input key (no quality, score or identity may enter)', { ...ok, qualityScore: 80 }],
    ['a missing input key', { events: [], coverage: ok.coverage, capturedFamilies: [] }],
    ['an extra coverage key', { ...ok, coverage: { ...ok.coverage, extra: 1 } }],
    ['a negative activeMs', { ...ok, coverage: { activeMs: -1, coveredMs: 0 } }],
    ['a fractional coveredMs', { ...ok, coverage: { activeMs: 10, coveredMs: 1.5 } }],
    ['photoMissing as a string', { ...ok, photoMissing: 'no' }],
    ['capturedFamilies with a number', { ...ok, capturedFamilies: [1] }],
    ['events not an array', { ...ok, events: {} }],
    [
      'an event with an extra key',
      { ...ok, events: [{ seq: 1, atMs: 1, kind: 'paste', attrs: {}, text: 'x' }] },
    ],
    ['an event without attrs', { ...ok, events: [{ seq: 1, atMs: 1, kind: 'paste' }] }],
    [
      'an event with a negative seq',
      { ...ok, events: [{ seq: -1, atMs: 1, kind: 'paste', attrs: {} }] },
    ],
    [
      'an event with a fractional atMs',
      { ...ok, events: [{ seq: 1, atMs: 1.5, kind: 'paste', attrs: {} }] },
    ],
    ['an event with an empty kind', { ...ok, events: [{ seq: 1, atMs: 1, kind: '', attrs: {} }] }],
    [
      'an event with an object attr',
      { ...ok, events: [{ seq: 1, atMs: 1, kind: 'paste', attrs: { a: {} } }] },
    ],
    [
      'an event with an empty mediaRef',
      { ...ok, events: [{ seq: 1, atMs: 1, kind: 'paste', attrs: {}, mediaRef: '' }] },
    ],
    [
      'an event with a negative durationMs',
      { ...ok, events: [{ seq: 1, atMs: 1, kind: 'paste', attrs: {}, durationMs: -5 }] },
    ],
  ])('refuses %s', (_label, raw) => {
    expect(() => computeBand(TABLE, raw as BandInput)).toThrow(BandInputError);
  });

  it('refuses a table that does not parse', () => {
    const bad = { ...clone(d1v1), coverageFloorPermille: 0 };
    expect(() => computeBand(bad as never, ok)).toThrow(RuleTableError);
  });
});

// ---- Escalation branches on small synthetic tables (rule 3; review M1) -----------------------------------------------

const synth = (rules: Record<string, unknown>[], families: string[] = ['a', 'b']) =>
  parseRuleTable({
    version: 'synth-v1',
    coverageFloorPermille: 700,
    coveragePhotoMissingFactorPermille: 750,
    families,
    rules,
  });
const synthRule = (id: string, kind: string, patch: Record<string, unknown> = {}) => ({
  id,
  kinds: [kind],
  family: 'a',
  tier: 'T3',
  severity: 'soft',
  validated: true,
  ...patch,
});
const full = (events: SignalEvent[]): BandInput => ({
  events,
  coverage: { activeMs: 1_000, coveredMs: 1_000 },
  capturedFamilies: ['a', 'b'],
  signalSettings: {},
  photoMissing: false,
});
const sev = (seq: number, kind: string, extra: Partial<SignalEvent> = {}): SignalEvent => ({
  seq,
  atMs: 100 * seq,
  kind,
  attrs: {},
  ...extra,
});

describe('computeBand escalation branches (synthetic tables)', () => {
  it('a validated T1 rule -> strong_concern [tier_t1:X]', () => {
    const out = computeBand(synth([synthRule('X', 'k1', { tier: 'T1' })]), full([sev(1, 'k1')]));
    expect(out.band).toBe('strong_concern');
    expect(out.reasons).toEqual(['tier_t1:X']);
  });

  it('a validated T2 rule -> strong_concern [tier_t2:X]', () => {
    const out = computeBand(synth([synthRule('X', 'k1', { tier: 'T2' })]), full([sev(1, 'k1')]));
    expect(out.band).toBe('strong_concern');
    expect(out.reasons).toEqual(['tier_t2:X']);
  });

  it('a T3 rawMedia rule whose event carries a mediaRef -> strong_concern [raw_media:X]', () => {
    const table = synth([synthRule('X', 'k1', { rawMedia: true })]);
    const out = computeBand(table, full([sev(1, 'k1', { mediaRef: 'clip-1' })]));
    expect(out.band).toBe('strong_concern');
    expect(out.reasons).toEqual(['raw_media:X']);
  });

  it('the same rawMedia event without a mediaRef stays under the T3 cap (soft -> clear, medium -> review)', () => {
    const soft = computeBand(
      synth([synthRule('X', 'k1', { rawMedia: true })]),
      full([sev(1, 'k1')]),
    );
    expect(soft.band).toBe('clear');
    expect(soft.flags).toHaveLength(1);
    const medium = computeBand(
      synth([synthRule('X', 'k1', { rawMedia: true, severity: 'medium' })]),
      full([sev(1, 'k1')]),
    );
    expect(medium.band).toBe('review');
    expect(medium.reasons).toEqual(['t3_severity:X']);
  });

  it('validated soft T3 flags in two families -> review [t3_families:a+b]', () => {
    const table = synth([synthRule('X', 'k1'), synthRule('Y', 'k2', { family: 'b' })]);
    const out = computeBand(table, full([sev(1, 'k1'), sev(2, 'k2')]));
    expect(out.band).toBe('review');
    expect(out.reasons).toEqual(['t3_families:a+b']);
  });

  it('two soft flags in ONE family -> clear', () => {
    const table = synth([synthRule('X', 'k1'), synthRule('Y', 'k2')]);
    const out = computeBand(table, full([sev(1, 'k1'), sev(2, 'k2')]));
    expect(out.flags).toHaveLength(2);
    expect(out.band).toBe('clear');
    expect(out.reasons).toEqual([]);
  });

  it('an untrusted rule that is not validated -> context only, not strong_concern', () => {
    const table = synth([
      synthRule('X', 'k1', { untrusted: true, severity: 'hard', validated: false }),
    ]);
    const out = computeBand(table, full([sev(1, 'k1')]));
    expect(out.band).toBe('clear');
    expect(out.flags).toEqual([]);
    expect(out.context.map((c) => c.ruleId)).toEqual(['X']);
  });
});

describe('BandOutput.reasons is capped at 10 (card contract; review L3)', () => {
  it('keeps the first 10 reasons in rule-table order', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `R${String(i).padStart(2, '0')}`);
    const table = synth(ids.map((id) => synthRule(id, 'k1', { tier: 'T1' })));
    const out = computeBand(table, full([sev(1, 'k1')]));
    expect(out.band).toBe('strong_concern');
    expect(out.flags).toHaveLength(12);
    expect(out.reasons).toEqual(ids.slice(0, 10).map((id) => `tier_t1:${id}`));
  });
});

describe('sparse arrays are refused (review L4)', () => {
  const holey = <T>(items: T[], at: number): T[] => {
    const arr = [...items];
    arr.length = Math.max(arr.length, at + 1);
    delete arr[at];
    return arr;
  };

  it('a hole in rules -> bad_rule', () => {
    expectRuleTableError({ ...rawTable(), rules: holey(rawTable().rules, 1) }, 'bad_rule');
  });

  it('a hole in families -> bad_families', () => {
    expectRuleTableError(
      { ...rawTable(), families: holey(['paste', 'input_origin', 'focus'], 1) },
      'bad_families',
    );
  });

  it('a hole in a rule kinds list -> bad_rule', () => {
    const t = rawTable();
    t.rules[0]!['kinds'] = holey(['paste', 'drop'], 0);
    expectRuleTableError(t, 'bad_rule');
  });

  const expectInputError = (raw: unknown, code: string) => {
    let caught: unknown;
    try {
      computeBand(TABLE, raw as BandInput);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BandInputError);
    expect((caught as BandInputError).code).toBe(code);
  };

  it('a hole in events -> bad_event', () => {
    expectInputError({ ...input([]), events: holey([ev('paste', 1)], 1) }, 'bad_event');
    expectInputError(
      { ...input([]), events: holey([ev('paste', 1), ev('paste', 2)], 0) },
      'bad_event',
    );
  });

  it('a hole in capturedFamilies -> bad_captured_families', () => {
    expectInputError(
      { ...input([]), capturedFamilies: holey(['paste', 'focus'], 0) },
      'bad_captured_families',
    );
  });
});
