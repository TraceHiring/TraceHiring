import { describe, expect, expectTypeOf, it } from 'vitest';
import * as engine from './index.js';
import type { Band, BandInput, BandOutput, Rule, RuleTable, Severity, Tier } from './index.js';

describe('@trace/band-engine contract skeleton', () => {
  it('exports exactly the §5.2 runtime names', () => {
    expect(Object.keys(engine).sort()).toEqual([
      'BAND_ENGINE_VERSION',
      'BandInputError',
      'RuleTableError',
      'canonicalJson',
      'computeBand',
      'parseRuleTable',
    ]);
    expect(engine.BAND_ENGINE_VERSION).toBe('band-engine-2');
  });

  it('exports the §5.2 vocabulary types', () => {
    expectTypeOf<Tier>().toEqualTypeOf<'T1' | 'T2' | 'T3'>();
    expectTypeOf<Severity>().toEqualTypeOf<'soft' | 'medium' | 'hard'>();
    expectTypeOf<Band>().toEqualTypeOf<
      'clear' | 'review' | 'strong_concern' | 'insufficient_evidence'
    >();
    expectTypeOf<RuleTable['rules']>().toEqualTypeOf<readonly Rule[]>();
    expectTypeOf<BandOutput['ruleTableVersion']>().toEqualTypeOf<string>();
    expectTypeOf<BandInput['photoMissing']>().toEqualTypeOf<boolean>();
  });
});
