// The integrity settings model (specs/m1-test-authoring.md §6.6, §6.7; AT-M1-15, AT-M1-16, AT-M1-17 as far as the
// recruiter app can show them): presets equal the seeded catalog, admin locks and always-locked settings cannot be
// edited, every request is a value of the catalog, and no setting can turn an unvalidated detector into a flag.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALWAYS_LOCKED_SETTINGS,
  INTEGRITY_CATALOG_VERSION,
  INTEGRITY_SETTING_VALUES,
  IntegritySettingsRequest,
  IntegritySettingsView,
  type SettingKey,
} from '@trace/shared/contracts/m1';
import { renderCandidateSummary } from '@trace/shared';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IntegrityStepView } from '../authoring/IntegrityStep';
import {
  INTEGRITY_PRESETS,
  PRESET_INFO,
  PRESET_KEYS,
  SETTING_INFO,
  SETTING_ORDER,
  applyPreset,
  candidatePreview,
  derivePresetKey,
  fromIntegrityView,
  lockOf,
  lockableKeys,
  setSetting,
  takesEffectLater,
  toIntegrityRequest,
  valueLabel,
} from './integrity-model';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const migrationsDir = path.join(root, 'supabase/migrations');
const m1Tests = readdirSync(migrationsDir).filter((f) => f.endsWith('_m1_tests.sql'));
const migration = readFileSync(path.join(migrationsDir, m1Tests[0] ?? ''), 'utf8');

const viewOf = (
  values: IntegritySettingsRequest['values'],
  locked: Partial<Record<SettingKey, 'admin'>> = {},
) =>
  IntegritySettingsView.parse({
    presetKey: null,
    values,
    locked: {
      ...locked,
      integrity_review_scope: 'always',
      accommodations: 'always',
      id_verification: 'always',
    },
    candidateSummary: renderCandidateSummary(values, INTEGRITY_CATALOG_VERSION).lines,
  });

describe('presets (AT-M1-15)', () => {
  it('are the seeded integrity_presets v1 of m1-settings-v1', () => {
    expect(m1Tests).toHaveLength(1);
    const row = /\(v_lib, '(strict|standard|open_book)', 1, 'm1-settings-v1', '(\{[^']*\})'\)/g;
    const seeded: Record<string, unknown> = {};
    for (const m of migration.matchAll(row)) {
      const [, key, json] = m as unknown as [string, string, string];
      seeded[key] = JSON.parse(json);
    }
    expect(seeded).toEqual(INTEGRITY_PRESETS);
  });

  it('every preset is a valid request, and derivePresetKey names it back', () => {
    for (const key of PRESET_KEYS) {
      expect(
        IntegritySettingsRequest.safeParse({ presetKey: key, values: INTEGRITY_PRESETS[key] })
          .success,
      ).toBe(true);
      expect(derivePresetKey(INTEGRITY_PRESETS[key])).toBe(key);
    }
  });

  it('describes each preset as it is: paste is recorded under Open-book, and its warm-up stays on', () => {
    for (const key of PRESET_KEYS) {
      const { description } = PRESET_INFO[key];
      const values = INTEGRITY_PRESETS[key];
      // Paste is recorded under every preset (blocked attempts or allowed pastes), so every description says how.
      expect(description, key).toMatch(/paste/i);
      if (values.paste_written === 'allowed_logged') {
        expect(description, key).toMatch(/paste[^.]*(?:allowed|recorded|logged)/i);
      }
    }
    const open = PRESET_INFO.open_book.description;
    expect(INTEGRITY_PRESETS.open_book.calibration_warmup).toBe('on');
    expect(open).toMatch(/warm-up/i);
    expect(open).not.toMatch(/\bonly\b/i);
  });

  it('a changed value is custom (preset null)', () => {
    expect(derivePresetKey({ ...INTEGRITY_PRESETS.standard, single_screen: 'on' })).toBeNull();
  });
});

describe('the catalog the screens show', () => {
  it('has a label and a description for every setting, in catalog order', () => {
    expect(SETTING_ORDER).toEqual(Object.keys(INTEGRITY_SETTING_VALUES));
    for (const key of SETTING_ORDER) {
      expect(SETTING_INFO[key].label.length).toBeGreaterThan(2);
      expect(SETTING_INFO[key].description.length).toBeGreaterThan(10);
    }
  });

  it('knows from the seed which settings run today (runs from D1) and which take effect later', () => {
    const defs = [
      ...migration.matchAll(
        /'m1-settings-v1', '([a-z_]+)', '[a-z_]+', '\{[^}]*\}', '[a-z_]+', (?:true|false), '([A-Za-z0-9]+)'/g,
      ),
    ];
    expect(defs).toHaveLength(SETTING_ORDER.length);
    for (const [, key, from] of defs as unknown as [string, SettingKey, string][]) {
      expect(SETTING_INFO[key].runsFrom, key).toBe(from);
      expect(takesEffectLater(key), key).toBe(from !== 'D1');
    }
  });

  it('labels every value of every setting, and never shows the raw scope value', () => {
    for (const key of SETTING_ORDER) {
      for (const value of INTEGRITY_SETTING_VALUES[key]) {
        expect(valueLabel(key, value).length, `${key}=${value}`).toBeGreaterThan(1);
      }
    }
    expect(valueLabel('integrity_review_scope', 'shortlist_only')).toBe(
      'Candidates above your cutoff only',
    );
    expect(valueLabel('integrity_review_scope', 'shortlist_only')).not.toMatch(/_/);
  });

  it('lists the lockable settings: every one but the always-locked', () => {
    expect(lockableKeys()).toEqual(
      SETTING_ORDER.filter((k) => !ALWAYS_LOCKED_SETTINGS.includes(k)),
    );
  });
});

describe('editing', () => {
  const state = fromIntegrityView(
    viewOf(INTEGRITY_PRESETS.standard, { typing_provenance: 'admin' }),
  );

  it('reads the view as it is', () => {
    expect(state.values).toEqual(INTEGRITY_PRESETS.standard);
    expect(lockOf(state, 'typing_provenance')).toBe('admin');
    expect(lockOf(state, 'accommodations')).toBe('always');
    expect(lockOf(state, 'single_screen')).toBeUndefined();
  });

  it('sets an unlocked setting and turns the preset into custom', () => {
    const next = setSetting(state, 'single_screen', 'on');
    expect(next.values.single_screen).toBe('on');
    expect(next.presetKey).toBeNull();
  });

  it('refuses a admin-locked setting, an always-locked one and a value outside the catalog', () => {
    expect(setSetting(state, 'typing_provenance', 'off')).toBe(state);
    expect(setSetting(state, 'accommodations', 'off')).toBe(state);
    expect(setSetting(state, 'integrity_review_scope', 'anything')).toBe(state);
    expect(setSetting(state, 'single_screen', 'maybe')).toBe(state);
  });

  it('a preset leaves locked settings as they are and keeps the rest of the preset', () => {
    const locked = fromIntegrityView(
      viewOf(INTEGRITY_PRESETS.standard, { paste_written: 'admin' }),
    );
    const strict = applyPreset(locked, 'strict');
    expect(strict.values.paste_written).toBe('allowed_logged');
    expect(strict.values.single_screen).toBe('on');
    expect(strict.presetKey).toBeNull();
    const open = applyPreset(state, 'open_book');
    expect(open.values.typing_provenance).toBe('on');
    expect(open.values.fullscreen_tab_focus).toBe('off');
    const free = applyPreset(fromIntegrityView(viewOf(INTEGRITY_PRESETS.standard)), 'strict');
    expect(free.presetKey).toBe('strict');
    expect(free.values).toEqual(INTEGRITY_PRESETS.strict);
  });

  it('builds the request from the state, and only from valid values', () => {
    const built = toIntegrityRequest(
      applyPreset(fromIntegrityView(viewOf(INTEGRITY_PRESETS.standard)), 'open_book'),
    );
    expect(built.ok && built.request.presetKey).toBe('open_book');
    const bad = { ...state, values: { ...state.values, single_screen: 'maybe' } } as never;
    expect(toIntegrityRequest(bad).ok).toBe(false);
  });

  it('never changes the input state', () => {
    const before = JSON.stringify(state);
    setSetting(state, 'single_screen', 'on');
    applyPreset(state, 'strict');
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('what candidates will see follows the shared renderer (R5-24)', () => {
  it('previews exactly renderCandidateSummary of the current values', () => {
    for (const key of PRESET_KEYS) {
      const s = applyPreset(fromIntegrityView(viewOf(INTEGRITY_PRESETS.standard)), key);
      expect(candidatePreview(s)).toEqual(
        renderCandidateSummary(s.values, INTEGRITY_CATALOG_VERSION).lines,
      );
    }
    const s = fromIntegrityView(viewOf(INTEGRITY_PRESETS.strict));
    expect(candidatePreview(setSetting(s, 'paste_written', 'allowed_logged'))).toContain(
      'You may paste or drop text into written answers. We record each paste and drop.',
    );
  });
});

describe('rule 3: no setting can make an unvalidated detector raise a flag', () => {
  // A value that would turn a signal into a flag (none exists in m1-settings-v1; this pins that the screens never add one).
  const FLAG_VALUE = /flag|raise|concern|review|reject|band|score/i;

  it('the flag matcher is not vacuous', () => {
    for (const bad of ['raise_flag', 'review_on', 'strong_concern', 'band_input']) {
      expect(bad).toMatch(FLAG_VALUE);
    }
    for (const ok of ['on', 'off', 'warn_first', 'blocked', 'allowed_logged']) {
      expect(ok).not.toMatch(FLAG_VALUE);
    }
  });

  it('describes the focus signals as context only', () => {
    expect(SETTING_INFO.fullscreen_tab_focus.description.toLowerCase()).toContain('context');
  });

  it('the integrity step offers exactly the catalog values for every setting, and no flag value', () => {
    const states = [
      fromIntegrityView(viewOf(INTEGRITY_PRESETS.standard)),
      fromIntegrityView(viewOf(INTEGRITY_PRESETS.strict, { paste_written: 'admin' })),
    ];
    for (const state of states) {
      const html = renderToString(
        createElement(IntegrityStepView, {
          state,
          readOnly: false,
          busy: false,
          message: null,
          onPreset: () => undefined,
          onSet: () => undefined,
          onSave: () => undefined,
        }),
      );
      const selects = [...html.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/g)];
      // One select per setting, in catalog order, each offering that setting's own values and nothing else.
      expect(selects).toHaveLength(SETTING_ORDER.length);
      selects.forEach((m, i) => {
        const key = SETTING_ORDER[i] as SettingKey;
        const offered = [...(m[1] ?? '').matchAll(/<option\b[^>]*value="([^"]*)"/g)].map(
          (o) => o[1],
        );
        expect(offered, key).toEqual([...INTEGRITY_SETTING_VALUES[key]]);
        for (const value of offered) expect(value, key).not.toMatch(FLAG_VALUE);
      });
      // The only other inputs are the three preset radios; there is no free-text value anywhere.
      const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
      expect(inputs).toHaveLength(PRESET_KEYS.length);
      expect(inputs.every((t) => /type="radio"/.test(t))).toBe(true);
    }
  });

  it('every preset and every single edit leaves only catalog values, none of them a flag value', () => {
    const base = fromIntegrityView(viewOf(INTEGRITY_PRESETS.standard));
    const reached = [
      ...PRESET_KEYS.map((preset) => applyPreset(base, preset)),
      ...SETTING_ORDER.flatMap((key) =>
        [...INTEGRITY_SETTING_VALUES[key], 'raise_flag', 'review_on'].map((value) =>
          setSetting(base, key, value),
        ),
      ),
    ];
    for (const state of reached) {
      for (const key of SETTING_ORDER) {
        const value = state.values[key];
        expect(INTEGRITY_SETTING_VALUES[key] as readonly string[], key).toContain(value);
        expect(value, key).not.toMatch(FLAG_VALUE);
      }
    }
  });

  it('every state reachable by one edit is a valid request of the catalog', () => {
    const base = fromIntegrityView(viewOf(INTEGRITY_PRESETS.standard));
    for (const key of SETTING_ORDER) {
      for (const value of INTEGRITY_SETTING_VALUES[key]) {
        const built = toIntegrityRequest(setSetting(base, key, value));
        expect(built.ok, `${key}=${value}`).toBe(true);
      }
    }
  });
});
