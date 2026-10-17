// @trace/band-engine public surface (specs/d1-demo-slice.md §5.2): pure TypeScript, no I/O, no clock, no randomness,
// no imports outside this package.
export type {
  Band,
  BandInput,
  BandOutput,
  ContextItem,
  Flag,
  Observed,
  Rule,
  RuleTable,
  Severity,
  SignalEvent,
  Tier,
} from './types.js';
export type { BandInputErrorCode } from './band.js';
export type { RuleTableErrorCode } from './rules/parse.js';
export { BAND_ENGINE_VERSION, BandInputError, computeBand } from './band.js';
export { canonicalJson } from './canonical-json.js';
export { RuleTableError, parseRuleTable } from './rules/parse.js';
