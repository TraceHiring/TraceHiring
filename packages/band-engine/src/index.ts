// @trace/band-engine public surface (specs/d1-demo-slice.md §5.2): pure TypeScript, no I/O, no clock, no randomness,
// no imports outside this package.
export type {
  Band,
  BandInput,
  BandOutput,
  ContextItem,
  Flag,
  Rule,
  RuleTable,
  Severity,
  SignalEvent,
  Tier,
} from './types.js';
export { canonicalJson } from './canonical-json.js';

export const BAND_ENGINE_VERSION = 'band-engine-1';
