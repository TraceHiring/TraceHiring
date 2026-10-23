// The pinned ruleset's per-signal settings in the integrity stage (M1 R5-7, R5-23 a/b, R5-52 e/f; rule 3): the band
// engine gets ruleset_versions.signal_settings as stored (never `{}`), a switched-off kind is context only, and
// capturedFamilies leaves out a family whose every catalog kind is switched off.
import { describe, expect, it } from 'vitest';
import { callBand, ruleTableOf } from './band-call.js';
import { inTx, integrityHandlers, table } from './fake-db.test-helpers.js';
import { runIntegrity } from './handler.js';
import { SQL } from './store.js';
import {
  ALL_SIGNALS_ENABLED,
  D1_RULES,
  heartbeat,
  integrityWorld,
  paste,
  untrusted,
  type IntegrityWorld,
} from './world.test-helpers.js';

const run = (w: IntegrityWorld) =>
  inTx(w.db, w.message.orgId, integrityHandlers, (tx) =>
    runIntegrity(w.message, { tx, evidence: w.evidence }),
  );

const settings = (off: readonly string[]): Record<string, { enabled: boolean }> =>
  Object.fromEntries(
    Object.keys(ALL_SIGNALS_ENABLED).map((k) => [k, { enabled: !off.includes(k) }]),
  );

const table1 = ruleTableOf({
  id: 'r',
  version_no: 1,
  families: JSON.stringify(D1_RULES.families),
  coverage_floor_permille: D1_RULES.coverageFloorPermille,
  coverage_photo_missing_factor_permille: D1_RULES.coveragePhotoMissingFactorPermille,
  rules: JSON.stringify(D1_RULES.rules),
  signal_settings: JSON.stringify(ALL_SIGNALS_ENABLED),
});
const FULL = { activeMs: 60_000, coveredMs: 60_000 };

describe('callBand passes the pinned signal settings (R5-52 f)', () => {
  it('hands the engine the settings as given and every catalog family when all are on', async () => {
    const band = await callBand(table1, [], FULL, 'd1-signals-v1', false, settings([]));
    expect(band.input.signalSettings).toEqual(settings([]));
    expect(band.input.capturedFamilies).toEqual(['paste', 'input_origin', 'focus']);
    expect(band.output.engineVersion).toBe('band-engine-2');
  });

  it('leaves out a family only when every one of its kinds is off (R5-23 a)', async () => {
    const pasteOnly = await callBand(table1, [], FULL, 'd1-signals-v1', false, settings(['paste']));
    expect(pasteOnly.input.capturedFamilies).toEqual(['paste', 'input_origin', 'focus']);
    const both = await callBand(
      table1,
      [],
      FULL,
      'd1-signals-v1',
      false,
      settings(['paste', 'drop']),
    );
    expect(both.input.capturedFamilies).toEqual(['input_origin', 'focus']);
    const focus = await callBand(
      table1,
      [],
      FULL,
      'd1-signals-v1',
      false,
      settings(['tab_hidden', 'fullscreen_exit', 'untrusted_input']),
    );
    expect(focus.input.capturedFamilies).toEqual(['paste']);
  });

  it('a different settings map gives a different input hash', async () => {
    const on = await callBand(table1, [], FULL, 'd1-signals-v1', false, settings([]));
    const off = await callBand(table1, [], FULL, 'd1-signals-v1', false, settings(['paste']));
    expect(off.inputHash).not.toBe(on.inputHash);
  });
});

describe('the integrity stage reads signal_settings from the pinned ruleset', () => {
  it('the rule-table query reads ruleset_versions.signal_settings', () => {
    expect(SQL.ruleTable).toContain('r.signal_settings::text as signal_settings');
  });

  it('a paste whose kinds are switched off is context only: Clear, no flag, one unmatched context entry', async () => {
    const w = await integrityWorld({ signalSettings: settings(['paste', 'drop']) });
    await run(w);
    expect(table(w.db, 'integrity_cards')[0]).toMatchObject({
      band: 'clear',
      review_state: 'reviewed',
    });
    expect(table(w.db, 'flags')).toHaveLength(0);
    const timeline = table(w.db, 'timeline');
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      entry_kind: 'context',
      signal_kind: 'paste',
      rule_id: null,
    });
  });

  it('switched-off untrusted input never gives Strong concern', async () => {
    const w = await integrityWorld({
      lines: [heartbeat(1, 10_000), untrusted(2, 20_000), heartbeat(3, 30_000)],
      signalSettings: settings(['untrusted_input']),
    });
    await run(w);
    expect(table(w.db, 'integrity_cards')[0]?.['band']).toBe('clear');
    expect(table(w.db, 'flags')).toHaveLength(0);
  });

  it('with every kind on, a paste is still Review (band-engine-1 behaviour)', async () => {
    const w = await integrityWorld({
      lines: [heartbeat(1, 10_000), paste(2, 20_000), heartbeat(3, 30_000)],
    });
    await run(w);
    expect(table(w.db, 'integrity_cards')[0]?.['band']).toBe('review');
    expect(table(w.db, 'results')[0]?.['engine_version']).toBe('band-engine-2');
  });

  it('stored settings that are not a JSON object fail closed and store nothing', async () => {
    const w = await integrityWorld();
    const rs = table(w.db, 'ruleset_versions')[0];
    if (rs === undefined) throw new Error('no ruleset');
    rs['signal_settings'] = null;
    await expect(run(w)).rejects.toThrow(/^integrity_bad_signal_settings$/);
    expect(table(w.db, 'integrity_cards')).toHaveLength(0);
  });

  it('a stored value other than {enabled: boolean} is refused by the engine (bad input)', async () => {
    const w = await integrityWorld({
      signalSettings: { ...settings([]), paste: { enabled: 'no' as unknown as boolean } },
    });
    await expect(run(w)).rejects.toThrow(/^integrity_bad_band_input$/);
    expect(table(w.db, 'integrity_cards')).toHaveLength(0);
  });
});
