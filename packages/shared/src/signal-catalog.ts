// The versioned client-signal catalog (spec §4.6, §5.2). The client sends neither tier nor validated: the integrity
// job stamps each signal from the catalog of the message's signalCatalogVersion, and `capturedFamilies` is the
// catalog's family list minus each family whose every kind the ruleset's signal settings switch off (M1 R5-23 a,
// R5-52 f; D1 rulesets switch none off). Every client signal is T3 (rule 3). `validated` mirrors rule table v1
// (docs/progress/d1-wave0-drafts/m3/d1-v1.json): only paste/drop and untrusted_input can raise the band;
// tab_hidden and fullscreen_exit are context only (D1-6). A test cross-checks both against the rule table and the
// ClientSignal contract.

export const SIGNAL_CATALOG_VERSION = 'd1-signals-v1';

type SignalEntry = Readonly<{
  family: 'paste' | 'input_origin' | 'focus';
  tier: 'T3';
  validated: boolean;
}>;
const entry = (family: SignalEntry['family'], validated: boolean): SignalEntry =>
  Object.freeze({ family, tier: 'T3', validated });

export const SIGNAL_CATALOG = Object.freeze({
  version: SIGNAL_CATALOG_VERSION,
  families: Object.freeze(['paste', 'input_origin', 'focus'] as const),
  signals: Object.freeze({
    paste: entry('paste', true),
    drop: entry('paste', true),
    untrusted_input: entry('input_origin', true),
    tab_hidden: entry('focus', false),
    fullscreen_exit: entry('focus', false),
  }),
});
export type SignalCatalog = typeof SIGNAL_CATALOG;
export type CatalogSignal = keyof SignalCatalog['signals'];

/** The catalog of a mirror message's signalCatalogVersion; an unknown version is an error, never a default. */
export function signalCatalog(version: string): SignalCatalog {
  if (version !== SIGNAL_CATALOG_VERSION) throw new Error('unknown signal catalog version');
  return SIGNAL_CATALOG;
}
