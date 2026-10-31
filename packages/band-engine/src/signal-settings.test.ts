// Per-signal settings in the band engine (specs/m1-test-authoring.md R5-7, R5-23 b, R5-52 e, §6.7, AT-M1-17): a
// kind is enabled unless its key is present with `enabled: false`; a disabled kind's event becomes the context item
// an unmatched event would be, plus `disabledBySettings: true`, and never matches a rule; a value that is not
// exactly `{enabled: boolean}` is `bad_input`; a key that is not an event kind is accepted and never matches.
// Examples on the D1 rule table v1 (rules/d1-v1.json). Synthetic values only.
import { describe, expect, it } from 'vitest';
import d1v1 from './rules/d1-v1.json' with { type: 'json' };
import { BAND_ENGINE_VERSION, BandInputError, computeBand, parseRuleTable } from './index.js';
import type { BandInput, SignalEvent } from './index.js';

const TABLE = parseRuleTable(d1v1);
const ALL_ON = {
  paste: { enabled: true },
  drop: { enabled: true },
  tab_hidden: { enabled: true },
  fullscreen_exit: { enabled: true },
  untrusted_input: { enabled: true },
};
/** paste_written = allowed_logged (§6.7, Q-M1-1 default): paste and drop are captured but are not band inputs. */
const ALLOWED_LOGGED = { ...ALL_ON, paste: { enabled: false }, drop: { enabled: false } };

const ev = (seq: number, kind: string, extra: Partial<SignalEvent> = {}): SignalEvent => ({
  seq,
  atMs: 1_000 * seq,
  kind,
  attrs: { item: 1 },
  ...extra,
});
const input = (
  events: SignalEvent[],
  signalSettings: BandInput['signalSettings'] = {},
): BandInput => ({
  events,
  coverage: { activeMs: 1_200_000, coveredMs: 1_200_000 },
  capturedFamilies: ['paste', 'input_origin', 'focus'],
  photoMissing: false,
  signalSettings,
});

const codeOf = (raw: unknown): string => {
  try {
    computeBand(TABLE, raw as BandInput);
  } catch (error) {
    expect(error).toBeInstanceOf(BandInputError);
    return (error as BandInputError).code;
  }
  return 'accepted';
};

describe('signalSettings on the D1 table', () => {
  it('the engine is band-engine-2', () => {
    expect(BAND_ENGINE_VERSION).toBe('band-engine-2');
    expect(computeBand(TABLE, input([])).engineVersion).toBe('band-engine-2');
  });

  it('allowed_logged: pastes are context only and the band equals the band without them', () => {
    const pastes = [ev(1, 'paste', { attrs: { item: 1, len: 40 } }), ev(2, 'drop')];
    const others = [ev(3, 'tab_hidden', { durationMs: 4_000 })];
    expect(computeBand(TABLE, input([...pastes, ...others], ALL_ON)).band).toBe('review');

    const out = computeBand(TABLE, input([...pastes, ...others], ALLOWED_LOGGED));
    const without = computeBand(TABLE, input(others, ALLOWED_LOGGED));
    expect(out.band).toBe('clear');
    expect(out.band).toBe(without.band);
    expect(out.reasons).toEqual(without.reasons);
    expect(out.flags).toEqual([]);
    expect(out.context).toEqual([
      { kind: 'paste', seq: 1, atMs: 1_000, observed: { len: 40 }, disabledBySettings: true },
      { kind: 'drop', seq: 2, atMs: 2_000, observed: {}, disabledBySettings: true },
      ...without.context,
    ]);
  });

  it('typing_provenance off: untrusted input never reaches strong_concern', () => {
    const events = [ev(1, 'untrusted_input', { attrs: { count: 3 } })];
    expect(computeBand(TABLE, input(events)).band).toBe('strong_concern');
    const off = computeBand(TABLE, input(events, { untrusted_input: { enabled: false } }));
    expect(off.band).toBe('clear');
    expect(off.context).toEqual([
      {
        kind: 'untrusted_input',
        seq: 1,
        atMs: 1_000,
        observed: { count: 3 },
        disabledBySettings: true,
      },
    ]);
  });

  it('a disabled unvalidated kind loses its rule match, keeps the band, and is marked', () => {
    const events = [ev(1, 'tab_hidden', { durationMs: 5_000 })];
    const on = computeBand(TABLE, input(events));
    expect(on.context).toEqual([
      {
        kind: 'tab_hidden',
        seq: 1,
        atMs: 1_000,
        durationMs: 5_000,
        observed: { durationMs: 5_000 },
        family: 'focus',
        ruleId: 'D1-TAB-HIDDEN',
      },
    ]);
    const off = computeBand(TABLE, input(events, { tab_hidden: { enabled: false } }));
    expect(off.band).toBe(on.band);
    expect(off.context).toEqual([
      {
        kind: 'tab_hidden',
        seq: 1,
        atMs: 1_000,
        durationMs: 5_000,
        observed: { durationMs: 5_000 },
        disabledBySettings: true,
      },
    ]);
  });

  it('a disabled connectivity gap keeps its connectivity family', () => {
    const out = computeBand(
      TABLE,
      input([ev(1, 'connectivity_gap')], { connectivity_gap: { enabled: false } }),
    );
    expect(out.context).toEqual([
      {
        kind: 'connectivity_gap',
        seq: 1,
        atMs: 1_000,
        observed: {},
        family: 'connectivity',
        disabledBySettings: true,
      },
    ]);
  });

  it('a missing key, an enabled key and a key that is not an event kind change nothing', () => {
    const events = [ev(1, 'paste'), ev(2, 'untrusted_input'), ev(3, 'fullscreen_exit')];
    const base = computeBand(TABLE, input(events));
    expect(computeBand(TABLE, input(events, ALL_ON))).toEqual(base);
    expect(
      computeBand(
        TABLE,
        input(events, { not_a_kind: { enabled: false }, other: { enabled: true } }),
      ),
    ).toEqual(base);
    expect(base.context.some((c) => 'disabledBySettings' in c)).toBe(false);
  });

  it('a key named like an Object.prototype member is an ordinary kind', () => {
    const events = [ev(1, 'constructor'), ev(2, 'paste')];
    const base = computeBand(TABLE, input(events));
    expect(base.context.map((c) => c.kind)).toEqual(['constructor']);
    expect(base.context[0]).not.toHaveProperty('disabledBySettings');
    const off = computeBand(TABLE, input(events, { constructor: { enabled: false } }));
    expect(off.flags).toEqual(base.flags);
    expect(off.context[0]).toMatchObject({ kind: 'constructor', disabledBySettings: true });
    const parsed = JSON.parse('{"__proto__": {"enabled": false}}') as BandInput['signalSettings'];
    const proto = computeBand(TABLE, input([ev(1, '__proto__'), ev(2, 'paste')], parsed));
    expect(proto.context[0]).toMatchObject({ kind: '__proto__', disabledBySettings: true });
    expect(proto.band).toBe('review');
  });

  it('does not mutate its input', () => {
    const given = input([ev(1, 'paste')], ALLOWED_LOGGED);
    const before = structuredClone(given);
    computeBand(TABLE, given);
    expect(given).toEqual(before);
  });
});

describe('signalSettings refusals (fail closed)', () => {
  const ok = input([]);
  it('a missing signalSettings is missing_key', () => {
    const { signalSettings: _drop, ...rest } = ok;
    void _drop;
    expect(codeOf(rest)).toBe('missing_key');
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['an array', []],
    ['a string', 'paste'],
    ['a class instance', new Map()],
    ['a value that is a boolean', { paste: false }],
    ['a value that is null', { paste: null }],
    ['a value that is an array', { paste: [] }],
    ['a value without enabled', { paste: {} }],
    ['enabled as a string', { paste: { enabled: 'false' } }],
    ['enabled as a number', { paste: { enabled: 0 } }],
    ['an extra key beside enabled', { paste: { enabled: false, locked: true } }],
    ['a value with a prototype', { paste: Object.create({ enabled: false }) as unknown }],
  ])('refuses %s as bad_input', (_label, signalSettings) => {
    expect(codeOf({ ...ok, signalSettings })).toBe('bad_input');
  });
});
