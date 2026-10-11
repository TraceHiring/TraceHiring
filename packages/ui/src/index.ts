// @trace/ui: design tokens and shared UI (spec §11).
// The stylesheet is imported separately as `@trace/ui/tokens.css`; these are the same tokens as TS.
export const UI_PACKAGE = '@trace/ui';
export {
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
export { tokens, type Band } from './generated/tokens.js';
