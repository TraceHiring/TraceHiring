// WCAG 2.x contrast for the design tokens (spec m0-foundations §11, AT-20).
// The pairs below are the ones spec §11 names: text on its backgrounds (AA, 4.5:1), and the colours
// of UI components on a surface (SC 1.4.11, 3:1). `contrast.test.ts` checks every one of them
// against the generated tokens. Thresholds are never lowered to make a pair pass.
//
// Not declared on purpose: `signalFamily.identity` (1.90:1) and `signalFamily.environment` (3.25:1).
// They are legend dots that always sit next to a text label, so the label carries the meaning
// (spec §11).
import { tokens } from './generated/tokens.js';

/** WCAG AA contrast for normal text (SC 1.4.3). */
export const TEXT_MIN = 4.5;
/** WCAG contrast for UI components and graphical objects (SC 1.4.11). */
export const UI_MIN = 3;

/** A foreground and a background, as token paths (`color.text.primary`), and the least ratio. */
export interface ContrastPair {
  readonly fg: string;
  readonly bg: string;
  readonly min: number;
}

const text = (fg: string, bg: string): ContrastPair => ({ fg, bg, min: TEXT_MIN });
const ui = (fg: string, bg: string): ContrastPair => ({ fg, bg, min: UI_MIN });

const TEXT_ON_SURFACES = ['primary', 'secondary', 'tertiary'].flatMap((fg) =>
  ['canvas', 'surface', 'subtle', 'muted'].map((bg) => text(`color.text.${fg}`, `color.bg.${bg}`)),
);

/** Text pairs, at least 4.5:1. */
export const TEXT_PAIRS: readonly ContrastPair[] = [
  // Spec §11 names canvas and surface; subtle and muted are the other page backgrounds.
  ...TEXT_ON_SURFACES,
  // Each band label on its own band background.
  ...(['clear', 'review', 'concern', 'insufficient'] as const).map((band) =>
    text(`color.band.${band}.fg`, `color.band.${band}.bg`),
  ),
  // Text on the primary action (default and hover) and on the dark surfaces.
  text('color.text.inverse', 'color.accent.default'),
  text('color.text.inverse', 'color.accent.hover'),
  text('color.text.inverse', 'color.bg.inverse'),
  text('color.text.onMedia', 'color.bg.media'),
];

/** UI component pairs, at least 3:1. */
export const UI_PAIRS: readonly ContrastPair[] = [
  ui('color.border.input', 'color.bg.surface'),
  ui('color.focus.ring', 'color.bg.surface'),
  ui('color.focus.ring', 'color.bg.canvas'),
];

/** The colour at a token path such as `color.text.primary`; throws unless it is a hex colour. */
export function tokenColor(tokenPath: string): string {
  let node: unknown = tokens;
  for (const key of tokenPath.split('.')) {
    node =
      node !== null && typeof node === 'object'
        ? (node as Record<string, unknown>)[key]
        : undefined;
  }
  if (typeof node !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(node))
    throw new Error(`${tokenPath} is not a hex colour token`);
  return node.toUpperCase();
}

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance of a `#RRGGBB` colour (WCAG 2.x definition). */
export function relativeLuminance(hex: string): number {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** Contrast ratio of two `#RRGGBB` colours, 1 to 21, in either order. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

/** The pairs whose ratio is below their minimum, with the ratio they reach. */
export function failingPairs(
  pairs: readonly ContrastPair[],
): { pair: ContrastPair; ratio: number }[] {
  return pairs
    .map((pair) => ({ pair, ratio: contrastRatio(tokenColor(pair.fg), tokenColor(pair.bg)) }))
    .filter(({ pair, ratio }) => ratio < pair.min);
}
