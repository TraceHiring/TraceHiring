// @trace/band-engine public surface (specs/d1-demo-slice.md §5.2). Wave 0 skeleton: the contract types and
// the version constant only. `parseRuleTable`, `computeBand` and `canonicalJson` arrive with stream R1.
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

export const BAND_ENGINE_VERSION = 'band-engine-1';
