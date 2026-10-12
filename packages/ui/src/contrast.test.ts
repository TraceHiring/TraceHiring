// AT-20 (spec m0-foundations §13, §11): the declared text and UI colour pairs meet WCAG contrast.
// Thresholds are the WCAG 2.x AA values (4.5:1 text, 3:1 UI components, SC 1.4.3 and 1.4.11) and
// are never lowered to make a pair pass: a failing pair is a design problem to report.
import { describe, expect, it } from 'vitest';
import {
  TEXT_MIN,
  TEXT_PAIRS,
  UI_MIN,
  UI_PAIRS,
  contrastRatio,
  failingPairs,
  relativeLuminance,
  tokenColor,
  type ContrastPair,
} from './contrast.js';

const label = (p: ContrastPair): string => `${p.fg} on ${p.bg}`;

describe('contrastRatio (WCAG 2.x)', () => {
  it('matches the reference values', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 6);
    expect(contrastRatio('#123456', '#123456')).toBe(1);
    // The well-known boundary around 4.5:1 on white.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(4.5);
    // Spec D4: border.input on white is 3.25:1.
    expect(contrastRatio('#8A8F98', '#FFFFFF')).toBeCloseTo(3.25, 2);
  });

  it('is symmetric and accepts lower-case hex', () => {
    expect(contrastRatio('#8a8f98', '#ffffff')).toBe(contrastRatio('#FFFFFF', '#8A8F98'));
  });

  it('rejects anything that is not a 6-digit hex colour', () => {
    for (const bad of ['red', '#FFF', '#GGGGGG', '', 'rgb(0,0,0)'])
      expect(() => relativeLuminance(bad), bad).toThrow();
  });
});

describe('declared pairs', () => {
  it('resolve to hex colours in the generated tokens', () => {
    for (const p of [...TEXT_PAIRS, ...UI_PAIRS]) {
      expect(tokenColor(p.fg), label(p)).toMatch(/^#[0-9A-F]{6}$/);
      expect(tokenColor(p.bg), label(p)).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(() => tokenColor('color.text.nope')).toThrow(/color\.text\.nope/);
    expect(() => tokenColor('color.text')).toThrow(/color\.text/);
  });

  it('use the AA thresholds', () => {
    expect(TEXT_MIN).toBe(4.5);
    expect(UI_MIN).toBe(3);
    for (const p of TEXT_PAIRS) expect(p.min, label(p)).toBe(TEXT_MIN);
    for (const p of UI_PAIRS) expect(p.min, label(p)).toBe(UI_MIN);
  });

  it('include every pair spec §11 names', () => {
    const declared = new Set([...TEXT_PAIRS, ...UI_PAIRS].map(label));
    const named = [
      ...['primary', 'secondary', 'tertiary'].flatMap((t) =>
        ['canvas', 'surface'].map((b) => `color.text.${t} on color.bg.${b}`),
      ),
      ...['clear', 'review', 'concern', 'insufficient'].map(
        (band) => `color.band.${band}.fg on color.band.${band}.bg`,
      ),
      'color.text.inverse on color.accent.default',
      'color.border.input on color.bg.surface',
      'color.focus.ring on color.bg.surface',
    ];
    for (const pair of named) expect(declared.has(pair), pair).toBe(true);
  });

  it('keep the legend dots out: they always sit next to a text label (spec §11)', () => {
    const declared = [...TEXT_PAIRS, ...UI_PAIRS].flatMap((p) => [p.fg, p.bg]);
    expect(declared).not.toContain('color.signalFamily.identity');
    expect(declared).not.toContain('color.signalFamily.environment');
  });
});

describe('contrast (AT-20)', () => {
  it.each(TEXT_PAIRS.map((p) => [label(p), p] as const))(
    'text: %s is at least 4.5:1',
    (_name, p) => {
      expect(contrastRatio(tokenColor(p.fg), tokenColor(p.bg))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(UI_PAIRS.map((p) => [label(p), p] as const))('ui: %s is at least 3:1', (_name, p) => {
    expect(contrastRatio(tokenColor(p.fg), tokenColor(p.bg))).toBeGreaterThanOrEqual(3);
  });

  it('failingPairs reports none for the declared pairs', () => {
    expect(failingPairs([...TEXT_PAIRS, ...UI_PAIRS])).toEqual([]);
  });

  it('failingPairs does catch a failing pair (negative control)', () => {
    // 1.90:1, documented in spec §11 as legend-only.
    const weak: ContrastPair = {
      fg: 'color.signalFamily.identity',
      bg: 'color.bg.surface',
      min: UI_MIN,
    };
    const result = failingPairs([...UI_PAIRS, weak]);
    expect(result.map((r) => label(r.pair))).toEqual([label(weak)]);
    expect(result[0]?.ratio).toBeCloseTo(1.9, 1);
  });
});
