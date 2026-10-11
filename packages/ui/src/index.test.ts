import { describe, expect, it } from 'vitest';
import { TEXT_PAIRS, UI_PAIRS, UI_PACKAGE, contrastRatio, tokenColor, tokens } from './index.js';
import type { Band } from './index.js';

describe('@trace/ui', () => {
  it('names the package', () => {
    expect(UI_PACKAGE).toBe('@trace/ui');
  });

  it('exports the generated tokens and the contrast helpers', () => {
    expect(tokens.color.bg.canvas).toBe('#F6F6F3');
    expect(tokens.color.focus.ring).toBe(tokens.color.accent.default);
    expect(TEXT_PAIRS.length).toBeGreaterThan(0);
    expect(UI_PAIRS.length).toBeGreaterThan(0);
    expect(
      contrastRatio(tokenColor('color.text.primary'), tokenColor('color.bg.surface')),
    ).toBeGreaterThan(4.5);
  });

  it('has a colour pair for every Band', () => {
    const bands: Band[] = ['clear', 'review', 'concern', 'insufficient'];
    expect(Object.keys(tokens.color.band).sort()).toEqual([...bands].sort());
  });
});
