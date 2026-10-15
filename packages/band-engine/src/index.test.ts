import { describe, expect, expectTypeOf, it } from 'vitest';
import * as engine from './index.js';
import type { Band, BandInput, BandOutput, Rule, RuleTable, Severity, Tier } from './index.js';

describe('@trace/band-engine contract skeleton', () => {
  it('exports the version constant and nothing else at runtime', () => {
    expect(Object.keys(engine)).toEqual(['BAND_ENGINE_VERSION']);
    expect(engine.BAND_ENGINE_VERSION).toBe('band-engine-1');
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
