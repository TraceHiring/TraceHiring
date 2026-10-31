// The api's mirror of the recruiter editor's `d1Editable` (apps/recruiter/src/authoring/editor-model.ts; spec m1 R5-70
// b): a draft D1's PUT may overwrite has every section inline, unshuffled, untimed, without a blueprint, with no
// navigation or its format's default, and at most one section per format. A paste rule (stored settings) is allowed.
import { describe, expect, it } from 'vitest';
import { d1Shaped, type ShapeSection } from './d1-shape.js';

const mcq: ShapeSection = {
  mode: 'inline',
  format: 'mcq',
  shuffleItems: false,
  shuffleOptions: false,
  navigation: null,
};
const written: ShapeSection = { ...mcq, format: 'written' };

describe('d1Shaped', () => {
  it('accepts D1 sections, none, and the defaults a draft with settings stores', () => {
    expect(d1Shaped([])).toBe(true);
    expect(d1Shaped([mcq, written])).toBe(true);
    expect(d1Shaped([written])).toBe(true);
    expect(
      d1Shaped([
        { ...mcq, navigation: 'free' },
        { ...written, navigation: 'forward_only', pasteRule: 'allowed_logged' },
      ]),
    ).toBe(true);
  });

  it('refuses what D1 cannot express', () => {
    for (const bad of [
      [{ ...mcq, mode: 'pool' as const }],
      [{ ...mcq, shuffleItems: true }],
      [{ ...mcq, shuffleOptions: true }],
      [{ ...mcq, timeLimitSeconds: 600 }],
      [{ ...mcq, blueprint: { strata: [] } }],
      [{ ...mcq, navigation: 'forward_only' as const }],
      [mcq, mcq],
      [written, { ...written }],
    ]) {
      expect(d1Shaped(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
