import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClientSignal } from './contracts-candidate.js';
import { SIGNAL_CATALOG, SIGNAL_CATALOG_VERSION, signalCatalog } from './signal-catalog.js';

interface RuleJson {
  id: string;
  kinds: string[];
  family: string;
  tier: string;
  validated: boolean;
}
interface RuleTableJson {
  families: string[];
  rules: RuleJson[];
}
const ruleTable = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../..', 'docs/progress/d1-wave0-drafts/m3/d1-v1.json'),
    'utf8',
  ),
) as RuleTableJson;

describe('SIGNAL_CATALOG (spec §4.6, §5.2)', () => {
  it('is versioned and the version resolves to the catalog', () => {
    expect(SIGNAL_CATALOG_VERSION).toBe('d1-signals-v1');
    expect(SIGNAL_CATALOG.version).toBe(SIGNAL_CATALOG_VERSION);
    expect(signalCatalog('d1-signals-v1')).toBe(SIGNAL_CATALOG);
    expect(() => signalCatalog('d1-signals-v0')).toThrow();
  });

  it('lists exactly the sig values the client contract can send', () => {
    const sigs = ClientSignal.options.map((o) => o.shape.sig.value).sort();
    expect(Object.keys(SIGNAL_CATALOG.signals).sort()).toEqual(sigs);
  });

  it('stamps every signal T3 (client-reported, rule 3)', () => {
    for (const s of Object.values(SIGNAL_CATALOG.signals)) expect(s.tier).toBe('T3');
  });

  it('agrees with rule table v1 on families, family per signal and validated per signal', () => {
    expect([...SIGNAL_CATALOG.families].sort()).toEqual([...ruleTable.families].sort());
    for (const rule of ruleTable.rules) {
      for (const kind of rule.kinds) {
        const entry = SIGNAL_CATALOG.signals[kind as keyof typeof SIGNAL_CATALOG.signals];
        expect(entry, kind).toBeDefined();
        expect(entry.family).toBe(rule.family);
        expect(entry.validated).toBe(rule.validated);
      }
    }
  });

  it('keeps tab_hidden and fullscreen_exit as context only (D1-6)', () => {
    expect(SIGNAL_CATALOG.signals.tab_hidden.validated).toBe(false);
    expect(SIGNAL_CATALOG.signals.fullscreen_exit.validated).toBe(false);
    expect(SIGNAL_CATALOG.signals.paste.validated).toBe(true);
    expect(SIGNAL_CATALOG.signals.untrusted_input.validated).toBe(true);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SIGNAL_CATALOG)).toBe(true);
    expect(Object.isFrozen(SIGNAL_CATALOG.signals)).toBe(true);
    expect(Object.isFrozen(SIGNAL_CATALOG.signals.paste)).toBe(true);
  });
});
