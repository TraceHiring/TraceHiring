// AT-M1-17 (spec m1 R3-9, R5-7, R5-23, R5-52 f; rule 3) in the integrity stage: a captured paste whose kinds the
// pinned ruleset switches off is stored as a timeline context entry only, and the band equals the band of the same
// session without it. Also: package v2 messages give the same integrity result as their v1 twin, the result never
// depends on quality data other than meets_cutoff (rule 1), and a D1 job whose stored result is under band-engine-1
// is never overwritten on re-delivery (R5-52 f; today it fails with integrity_input_changed).
import { canonicalJson } from '@trace/band-engine';
import type { SessionMirrorMessageV2 } from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import { callBand, ruleTableOf, signalSettingsOf } from './band-call.js';
import { inTx, integrityHandlers, table, type FakeDb } from './fake-db.test-helpers.js';
import { runIntegrity } from './handler.js';
import { loadSignals } from './load.js';
import { SQL } from './store.js';
import {
  ALL_SIGNALS_ENABLED,
  D1_RULES,
  IDS,
  addQualityCard,
  heartbeat,
  integrityWorld,
  paste,
  type IntegrityWorld,
} from './world.test-helpers.js';

const run = (
  w: IntegrityWorld,
  message: IntegrityWorld['message'] | SessionMirrorMessageV2 = w.message,
) =>
  inTx(w.db, message.orgId, integrityHandlers, (tx) =>
    runIntegrity(message, { tx, evidence: w.evidence }),
  );

/** The Standard preset's paste rule (`paste_written = allowed_logged`): paste and drop captured, not band inputs. */
const PASTE_ALLOWED = {
  ...ALL_SIGNALS_ENABLED,
  paste: { enabled: false },
  drop: { enabled: false },
};

const outcome = (db: FakeDb) => {
  const r = table(db, 'results')[0];
  const c = table(db, 'integrity_cards')[0];
  return {
    band: r?.['band'],
    evidenceStrength: r?.['evidence_strength'],
    coverage: r?.['coverage_permille'],
    cardBand: c?.['band'],
    flags: table(db, 'flags').length,
  };
};

describe('AT-M1-17: a band-disabled paste is context only (R3-9)', () => {
  it('the paste is stored as a signal and a timeline context entry, and the band equals the band without it', async () => {
    const withPaste = await integrityWorld({
      lines: [heartbeat(1, 10_000), paste(2, 20_000), heartbeat(3, 30_000)],
      signalSettings: PASTE_ALLOWED,
    });
    await run(withPaste);
    const without = await integrityWorld({
      lines: [heartbeat(1, 10_000), heartbeat(3, 30_000)],
      signalSettings: PASTE_ALLOWED,
    });
    await run(without);

    expect(outcome(withPaste.db)).toEqual(outcome(without.db));
    expect(outcome(withPaste.db)).toMatchObject({ band: 'clear', flags: 0 });
    expect(table(withPaste.db, 'signals').map((s) => s['kind'])).toEqual(['paste']);
    expect(table(withPaste.db, 'timeline')).toEqual([
      expect.objectContaining({
        entry_kind: 'context',
        signal_kind: 'paste',
        rule_id: null,
        tier: null,
        flag_state: null,
      }),
    ]);
  });

  it('many band-disabled pastes still never raise the band', async () => {
    const lines = [heartbeat(1, 5_000)];
    for (let g = 2; g < 40; g += 1) lines.push(paste(g, g * 1_000));
    const w = await integrityWorld({ lines, signalSettings: PASTE_ALLOWED });
    await run(w);
    expect(outcome(w.db)).toMatchObject({ band: 'clear', flags: 0 });
    expect(table(w.db, 'timeline').every((t) => t['entry_kind'] === 'context')).toBe(true);
  });

  it('with paste blocked (every kind on) the same paste raises Review: the switch alone decides', async () => {
    const w = await integrityWorld({
      lines: [heartbeat(1, 10_000), paste(2, 20_000), heartbeat(3, 30_000)],
    });
    await run(w);
    expect(outcome(w.db)).toMatchObject({ band: 'review', flags: 1 });
  });

  it('capturedFamilies leaves out the paste family once paste and drop are off (R5-23 a), from the stored settings only', async () => {
    const table1 = ruleTableOf({
      id: 'r',
      version_no: 1,
      families: JSON.stringify(D1_RULES.families),
      coverage_floor_permille: D1_RULES.coverageFloorPermille,
      coverage_photo_missing_factor_permille: D1_RULES.coveragePhotoMissingFactorPermille,
      rules: JSON.stringify(D1_RULES.rules),
      signal_settings: JSON.stringify(PASTE_ALLOWED),
    });
    const band = await callBand(
      table1,
      [],
      { activeMs: 60_000, coveredMs: 60_000 },
      'd1-signals-v1',
      false,
      PASTE_ALLOWED,
    );
    expect(band.input.capturedFamilies).not.toContain('paste');
  });
});

const asV2 = (m: IntegrityWorld['message']): SessionMirrorMessageV2 => ({
  ...m,
  v: 2,
  served: [],
  poolSectionIds: [],
  draws: [],
});

describe('package v2 messages (spec m1 R5-8)', () => {
  it('a v2 message gives the same integrity rows as its v1 twin', async () => {
    const v1 = await integrityWorld();
    await run(v1);
    const v2 = await integrityWorld();
    await run(v2, asV2(v2.message));
    expect(v2.db.tables).toEqual(v1.db.tables);
    expect(outcome(v2.db)).toMatchObject({ band: 'review', flags: 1 });
  });

  it('a v2 re-delivery stores nothing new', async () => {
    const w = await integrityWorld();
    await run(w, asV2(w.message));
    const before = structuredClone(w.db.tables);
    await run(w, asV2(w.message));
    expect(w.db.tables).toEqual(before);
  });

  it('rule 1: the v2 result depends on meets_cutoff only, never on a quality score', async () => {
    const low = await integrityWorld();
    table(low.db, 'scores').push({ org_id: IDS.org, session_id: IDS.session, score: 41 });
    await run(low, asV2(low.message));
    const high = await integrityWorld();
    table(high.db, 'scores').push({ org_id: IDS.org, session_id: IDS.session, score: 99 });
    await run(high, asV2(high.message));
    expect(outcome(high.db)).toEqual(outcome(low.db));
  });
});

describe('a D1 job stored under band-engine-1 is never overwritten on re-delivery (R5-52 f)', () => {
  it('an awaiting card whose result is band-engine-1 fails the flip with integrity_input_changed and changes nothing', async () => {
    const w = await integrityWorld({ meetsCutoff: null });
    await run(w);
    const stored = table(w.db, 'results')[0];
    if (stored === undefined) throw new Error('no result');
    // What a D1 deploy stored before A1: engine band-engine-1, input hashed without signalSettings.
    const { signalSettings: _s, ...d1Input } = (
      await callBand(
        ruleTableOf({
          id: 'r',
          version_no: 1,
          families: JSON.stringify(D1_RULES.families),
          coverage_floor_permille: D1_RULES.coverageFloorPermille,
          coverage_photo_missing_factor_permille: D1_RULES.coveragePhotoMissingFactorPermille,
          rules: JSON.stringify(D1_RULES.rules),
          signal_settings: JSON.stringify(ALL_SIGNALS_ENABLED),
        }),
        await loadSignals(w.evidence, w.message),
        w.message.coverage,
        'd1-signals-v1',
        false,
        ALL_SIGNALS_ENABLED,
      )
    ).input;
    void _s;
    stored['engine_version'] = 'band-engine-1';
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonicalJson(d1Input)),
    );
    stored['input_hash'] = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    addQualityCard(w.db, true);
    const before = structuredClone(w.db.tables);

    await expect(run(w)).rejects.toThrow(/^integrity_input_changed$/);

    expect(w.db.tables).toEqual(before);
    expect(table(w.db, 'results')[0]).toMatchObject({
      engine_version: 'band-engine-1',
      band: 'review',
    });
    expect(table(w.db, 'integrity_cards')[0]?.['review_state']).toBe('awaiting_quality');
  });

  it('a final D1 card (reviewed under band-engine-1) is left alone: the key is present, nothing runs', async () => {
    const w = await integrityWorld();
    await run(w);
    const stored = table(w.db, 'results')[0];
    if (stored === undefined) throw new Error('no result');
    stored['engine_version'] = 'band-engine-1';
    const before = structuredClone(w.db.tables);
    await run(w);
    expect(w.db.tables).toEqual(before);
  });
});

describe('mock/real parity of the pinned settings (R5-52 f)', () => {
  it('the fake hands a SQL null signal_settings over as null, as the driver does, and the stage fails closed', async () => {
    const w = await integrityWorld();
    const rs = table(w.db, 'ruleset_versions')[0];
    if (rs === undefined) throw new Error('no ruleset');
    rs['signal_settings'] = null;
    w.db.jobOrg = IDS.org;
    const handler = integrityHandlers[SQL.ruleTable];
    if (handler === undefined) throw new Error('no handler');
    expect(handler(w.db, [IDS.org, IDS.ruleset])[0]?.['signal_settings']).toBeNull();
    w.db.jobOrg = null;
    await expect(run(w)).rejects.toThrow(/^integrity_bad_signal_settings$/);
  });

  it('signalSettingsOf refuses null, an array and a scalar', () => {
    const row = {
      id: 'r',
      version_no: 1,
      families: '[]',
      coverage_floor_permille: 600,
      coverage_photo_missing_factor_permille: 750,
      rules: '[]',
    };
    for (const value of [null, '[]', '1', '"x"', 'not json']) {
      expect(() =>
        signalSettingsOf({ ...row, signal_settings: value as unknown as string }),
      ).toThrow(/^integrity_bad_signal_settings$/);
    }
  });

  it('capturedFamilies is derived from the ruleset settings, never from the package captureSignals', () => {
    // The package's captureSignals is what the client records; the band reads the ruleset's signal_settings only.
    expect(SQL.ruleTable).toContain('signal_settings');
    expect(Object.values(SQL).some((s) => s.includes('capture'))).toBe(false);
  });
});
