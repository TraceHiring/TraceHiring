// AT-M1-31 "Candidate summary follows the settings" (specs/m1-test-authoring.md §6.6, §6.7, §12; R2-12, R2-20,
// R5-24, R5-39 d). Pins renderCandidateSummary per preset and proves the summary follows what is captured
// (captureSignals), never under-states it, and never uses a rule-7 term. Synthetic values only.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_SUMMARY_VERSION,
  type CandidateSummary,
  captureSignalsFor,
  type IntegritySettingValues,
  renderCandidateSummary,
  SETTING_CAPTURE_SIGNALS,
} from './candidate-summary.js';
import * as Root from './index.js';
import {
  INTEGRITY_CATALOG_VERSION,
  INTEGRITY_SETTING_VALUES,
  IntegritySettingsView,
  type PresetKey,
  SettingKey,
} from './contracts-m1.js';
import { type CatalogSignal, SIGNAL_CATALOG, SIGNAL_CATALOG_VERSION } from './signal-catalog.js';

const CATALOG = 'm1-settings-v1';

// The catalog's preset values (§6.6 table; seeded as integrity_presets v1, cross-checked against the seed below).
const PRESETS: Readonly<Record<PresetKey, IntegritySettingValues>> = {
  strict: {
    calibration_warmup: 'on',
    typing_provenance: 'on',
    burst_after_tab: 'on',
    fullscreen_tab_focus: 'on',
    single_screen: 'on',
    camera_face_presence: 'on',
    mic_speech_presence: 'on',
    explain_probe: 'on',
    question_copy: 'on',
    paste_written: 'blocked',
    integrity_review_scope: 'shortlist_only',
    accommodations: 'on',
    id_verification: 'off',
  },
  standard: {
    calibration_warmup: 'on',
    typing_provenance: 'on',
    burst_after_tab: 'on',
    fullscreen_tab_focus: 'warn_first',
    single_screen: 'off',
    camera_face_presence: 'on',
    mic_speech_presence: 'off',
    explain_probe: 'off',
    question_copy: 'on',
    paste_written: 'allowed_logged',
    integrity_review_scope: 'shortlist_only',
    accommodations: 'on',
    id_verification: 'off',
  },
  open_book: {
    calibration_warmup: 'on',
    typing_provenance: 'on',
    burst_after_tab: 'off',
    fullscreen_tab_focus: 'off',
    single_screen: 'off',
    camera_face_presence: 'off',
    mic_speech_presence: 'off',
    explain_probe: 'off',
    question_copy: 'off',
    paste_written: 'allowed_logged',
    integrity_review_scope: 'shortlist_only',
    accommodations: 'on',
    id_verification: 'off',
  },
};

const with_ = (
  preset: PresetKey,
  patch: Partial<Record<SettingKey, string>>,
): IntegritySettingValues => ({ ...PRESETS[preset], ...patch }) as IntegritySettingValues;

// The pinned copy of candidate-summary-2. Changing any of it is a new CANDIDATE_SUMMARY_VERSION. Version 2 (M1-REV-6):
// with paste allowed the candidate app still blocks drop (TestV2.test.tsx), so the line says drop is turned off.
const T = {
  photo: 'We ask for one start photo before the test begins. You can continue without one.',
  answers: 'We record your answers and every edit, with the time of each change.',
  pasteBlocked:
    'Pasting and dropping text into written answers are blocked. We record each attempt.',
  pasteAllowed:
    'You may paste text into written answers. Dropping text is turned off. We record each paste and each drop attempt.',
  untrusted: 'We record input that comes from a script or another program instead of from you.',
  tab: 'We record when you leave the test tab or window.',
  fullscreen: 'We record when you leave full screen.',
  heartbeat: 'We record a regular signal that the page is still connected.',
  review:
    "A person looks at these records only if your answers score above the employer's cutoff. " +
    'A record never decides your result by itself.',
} as const;

const ALL_SIGNALS: readonly CatalogSignal[] = [
  'paste',
  'drop',
  'untrusted_input',
  'tab_hidden',
  'fullscreen_exit',
];

// Found by suffix: R5-30 re-timestamps the M1-b migration at the D1 CLOSE merge.
const migrationsDir = resolve(import.meta.dirname, '../../..', 'supabase/migrations');
const m1Tests = readdirSync(migrationsDir).filter((f) => f.endsWith('_m1_tests.sql'));
if (m1Tests.length !== 1) throw new Error('expected exactly one *_m1_tests.sql migration');
const migration = readFileSync(resolve(migrationsDir, m1Tests[0] as string), 'utf8');

/** Every combination of the three settings that map D1 signals, over every preset. */
function* allCombinations(): Generator<IntegritySettingValues> {
  for (const preset of Object.keys(PRESETS) as PresetKey[]) {
    for (const paste_written of INTEGRITY_SETTING_VALUES.paste_written) {
      for (const fullscreen_tab_focus of INTEGRITY_SETTING_VALUES.fullscreen_tab_focus) {
        for (const typing_provenance of INTEGRITY_SETTING_VALUES.typing_provenance) {
          yield with_(preset, { paste_written, fullscreen_tab_focus, typing_provenance });
        }
      }
    }
  }
}

describe('versions', () => {
  it('is candidate-summary-2 on settings catalog m1-settings-v1 and signal catalog d1-signals-v1', () => {
    expect(CANDIDATE_SUMMARY_VERSION).toBe('candidate-summary-2');
    expect(INTEGRITY_CATALOG_VERSION).toBe(CATALOG);
    const s = renderCandidateSummary(PRESETS.standard, CATALOG);
    expect(s.version).toBe('candidate-summary-2');
    expect(s.catalogVersion).toBe(CATALOG);
    expect(s.signalCatalogVersion).toBe(SIGNAL_CATALOG_VERSION);
  });

  it('refuses an unknown settings catalog (no silent fallback)', () => {
    expect(() => renderCandidateSummary(PRESETS.standard, 'm1-settings-v0')).toThrow(
      'unknown settings catalog',
    );
    expect(() => renderCandidateSummary(PRESETS.standard, '')).toThrow('unknown settings catalog');
    expect(() => captureSignalsFor(PRESETS.standard, 'm1-settings-v2')).toThrow(
      'unknown settings catalog',
    );
  });

  it('is exported from the package root (@trace/shared)', () => {
    expect(Root.renderCandidateSummary).toBe(renderCandidateSummary);
    expect(Root.captureSignalsFor).toBe(captureSignalsFor);
    expect(Root.CANDIDATE_SUMMARY_VERSION).toBe(CANDIDATE_SUMMARY_VERSION);
  });
});

describe('the settings to captureSignals mapping (§6.6 "switches D1 signals", R2-12, R5-39 d)', () => {
  it('mirrors integrity_setting_defs.maps_to_signals of the seed', () => {
    const row =
      /\(v_lib, 'm1-settings-v1', '([a-z_]+)', '[a-z_]+', '\{[^}]*\}', '[a-z_]+', (?:true|false), '[A-Za-z0-9]+',\s*'\{([^}]*)\}'\)/g;
    const seeded: Record<string, string[]> = {};
    for (const m of migration.matchAll(row)) {
      const [, key, signals] = m as unknown as [string, string, string];
      seeded[key] = signals === '' ? [] : signals.split(',');
    }
    expect(Object.keys(seeded).sort()).toEqual([...SettingKey.options].sort());
    const ours = Object.fromEntries(
      Object.entries(SETTING_CAPTURE_SIGNALS).map(([k, v]) => [k, [...v].sort()]),
    );
    const theirs = Object.fromEntries(Object.entries(seeded).map(([k, v]) => [k, [...v].sort()]));
    expect(ours).toEqual(theirs);
  });

  it('pins the mapping: only typing_provenance, fullscreen_tab_focus and paste_written capture anything', () => {
    const mapped = Object.entries(SETTING_CAPTURE_SIGNALS)
      .filter(([, v]) => v.length > 0)
      .map(([k, v]) => `${k}:${v.join(',')}`)
      .sort();
    expect(mapped).toEqual([
      'fullscreen_tab_focus:tab_hidden,fullscreen_exit',
      'paste_written:paste,drop',
      'typing_provenance:untrusted_input',
    ]);
  });

  it('the test presets are the seeded integrity_presets v1', () => {
    const row = /\(v_lib, '(strict|standard|open_book)', 1, 'm1-settings-v1', '(\{[^']*\})'\)/g;
    const seeded: Record<string, unknown> = {};
    for (const m of migration.matchAll(row)) {
      const [, key, json] = m as unknown as [string, string, string];
      seeded[key] = JSON.parse(json);
    }
    expect(seeded).toEqual(PRESETS);
  });

  it('captures a mapped signal unless its setting is off; allowed_logged and blocked both capture paste', () => {
    expect(captureSignalsFor(PRESETS.strict, CATALOG)).toEqual(ALL_SIGNALS);
    expect(captureSignalsFor(PRESETS.standard, CATALOG)).toEqual(ALL_SIGNALS);
    expect(captureSignalsFor(PRESETS.open_book, CATALOG)).toEqual([
      'paste',
      'drop',
      'untrusted_input',
    ]);
    expect(captureSignalsFor(with_('strict', { typing_provenance: 'off' }), CATALOG)).toEqual([
      'paste',
      'drop',
      'tab_hidden',
      'fullscreen_exit',
    ]);
  });

  it('returns catalog-ordered, unique catalog signals (a valid TestPackageV2.captureSignals)', () => {
    const order = Object.keys(SIGNAL_CATALOG.signals);
    for (const settings of allCombinations()) {
      const got = captureSignalsFor(settings, CATALOG);
      expect(new Set(got).size).toBe(got.length);
      for (const s of got) expect(order).toContain(s);
      expect([...got].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(got);
      expect(got.length).toBeLessThanOrEqual(5);
    }
  });
});

describe('pinned summary per preset (R2-20)', () => {
  const pinned = (captureSignals: readonly CatalogSignal[], lines: readonly string[]) => ({
    version: 'candidate-summary-2',
    catalogVersion: CATALOG,
    signalCatalogVersion: SIGNAL_CATALOG_VERSION,
    captureSignals,
    lines,
  });
  const view = (s: CandidateSummary) => ({
    version: s.version,
    catalogVersion: s.catalogVersion,
    signalCatalogVersion: s.signalCatalogVersion,
    captureSignals: s.captureSignals,
    lines: s.lines,
  });

  it('Strict', () => {
    expect(view(renderCandidateSummary(PRESETS.strict, CATALOG))).toEqual(
      pinned(ALL_SIGNALS, [
        T.photo,
        T.answers,
        T.pasteBlocked,
        T.untrusted,
        T.tab,
        T.fullscreen,
        T.heartbeat,
        T.review,
      ]),
    );
  });

  it('Standard', () => {
    expect(view(renderCandidateSummary(PRESETS.standard, CATALOG))).toEqual(
      pinned(ALL_SIGNALS, [
        T.photo,
        T.answers,
        T.pasteAllowed,
        T.untrusted,
        T.tab,
        T.fullscreen,
        T.heartbeat,
        T.review,
      ]),
    );
  });

  it('Open-book', () => {
    expect(view(renderCandidateSummary(PRESETS.open_book, CATALOG))).toEqual(
      pinned(
        ['paste', 'drop', 'untrusted_input'],
        [T.photo, T.answers, T.pasteAllowed, T.untrusted, T.heartbeat, T.review],
      ),
    );
  });
});

describe('the summary follows the settings (§6.7)', () => {
  const lines = (settings: IntegritySettingValues) =>
    renderCandidateSummary(settings, CATALOG).lines;

  it('paste blocked says blocked and logged; allowed_logged is captured and shown as recorded (R5-24)', () => {
    const blocked = lines(with_('standard', { paste_written: 'blocked' }));
    const allowed = lines(with_('strict', { paste_written: 'allowed_logged' }));
    expect(blocked).toContain(T.pasteBlocked);
    expect(blocked).not.toContain(T.pasteAllowed);
    expect(allowed).toContain(T.pasteAllowed);
    expect(allowed).not.toContain(T.pasteBlocked);
    // Driven by capture, not by the band-enabled flag: an allowed paste is not a band input but is recorded.
    const s = renderCandidateSummary(PRESETS.standard, CATALOG);
    expect(s.captureSignals).toEqual(expect.arrayContaining(['paste', 'drop']));
  });

  it('fullscreen_tab_focus off removes the tab and full-screen lines; warn_first and on list them', () => {
    for (const preset of Object.keys(PRESETS) as PresetKey[]) {
      const off = renderCandidateSummary(with_(preset, { fullscreen_tab_focus: 'off' }), CATALOG);
      expect(off.lines).not.toContain(T.tab);
      expect(off.lines).not.toContain(T.fullscreen);
      expect(off.captureSignals).not.toContain('tab_hidden');
      expect(off.captureSignals).not.toContain('fullscreen_exit');
      const warn = lines(with_(preset, { fullscreen_tab_focus: 'warn_first' }));
      const on = lines(with_(preset, { fullscreen_tab_focus: 'on' }));
      expect(warn).toEqual(expect.arrayContaining([T.tab, T.fullscreen]));
      expect(on).toEqual(warn);
    }
  });

  it('typing_provenance off drops untrusted_input and its line', () => {
    const s = renderCandidateSummary(with_('strict', { typing_provenance: 'off' }), CATALOG);
    expect(s.captureSignals).not.toContain('untrusted_input');
    expect(s.lines).not.toContain(T.untrusted);
    expect(lines(PRESETS.strict)).toContain(T.untrusted);
  });

  it('settings that run from M4, M3b or Phase 2 (or map no D1 signal) add, remove and change nothing', () => {
    const inert = SettingKey.options.filter((k) => SETTING_CAPTURE_SIGNALS[k].length === 0);
    expect([...inert].sort()).toEqual([
      'accommodations',
      'burst_after_tab',
      'calibration_warmup',
      'camera_face_presence',
      'explain_probe',
      'id_verification',
      'integrity_review_scope',
      'mic_speech_presence',
      'question_copy',
      'single_screen',
    ]);
    for (const preset of Object.keys(PRESETS) as PresetKey[]) {
      const base = renderCandidateSummary(PRESETS[preset], CATALOG);
      for (const key of inert) {
        for (const value of INTEGRITY_SETTING_VALUES[key]) {
          expect(renderCandidateSummary(with_(preset, { [key]: value }), CATALOG)).toEqual(base);
        }
      }
      // Every M4 setting on at once still gives no new line.
      const allOn = with_(preset, {
        calibration_warmup: 'on',
        burst_after_tab: 'on',
        single_screen: 'on',
        camera_face_presence: 'on',
        mic_speech_presence: 'on',
        explain_probe: 'on',
        question_copy: 'on',
      });
      expect(renderCandidateSummary(allOn, CATALOG)).toEqual(base);
    }
  });
});

describe('never under-states what is recorded', () => {
  it('every captured signal has a line, and no line claims a signal that is not captured', () => {
    for (const settings of allCombinations()) {
      const s = renderCandidateSummary(settings, CATALOG);
      expect(s.captureSignals).toEqual(captureSignalsFor(settings, CATALOG));
      const covered = new Set(s.entries.flatMap((e) => e.signals));
      expect([...covered].sort()).toEqual([...s.captureSignals].sort());
      for (const e of s.entries)
        for (const sig of e.signals) expect(s.captureSignals).toContain(sig);
      expect(s.lines).toEqual(s.entries.map((e) => e.text));
      // The constant lines are always present: the start photo, the answers and edits, the connection signal.
      expect(s.lines).toEqual(expect.arrayContaining([T.photo, T.answers, T.heartbeat, T.review]));
    }
  });

  it('maps every catalog signal to a line when captured', () => {
    const full = renderCandidateSummary(PRESETS.strict, CATALOG);
    const covered = new Set(full.entries.flatMap((e) => e.signals));
    expect([...covered].sort()).toEqual(Object.keys(SIGNAL_CATALOG.signals).sort());
  });

  it('fits IntegritySettingsView.candidateSummary (at most 20 lines of 1-300 characters)', () => {
    for (const settings of allCombinations()) {
      const s = renderCandidateSummary(settings, CATALOG);
      const locked = {
        integrity_review_scope: 'always',
        accommodations: 'always',
        id_verification: 'always',
      };
      expect(() =>
        IntegritySettingsView.parse({
          presetKey: null,
          values: settings,
          locked,
          candidateSummary: s.lines,
          stored: true,
        }),
      ).not.toThrow();
    }
  });
});

// Copied from apps/recruiter/src/d1-guards.test.tsx (the same source as e2e/support/report.ts NEVER_BUILD_TEXT).
const ANYWHERE_WORDS =
  /\b(?:reject\w*|decline\w*|shortlist\w*|overturn\w*|appeal\w*|confirm\w*)\b/i;
const COMBINED = /\b(?:overall|combined|total|trust|honesty|composite)\b/i;
const GAZE_ASN_IP =
  /\b(?:gaze|ASN|IPv?[46]?)\b|\bIP[\s _-]*address(?:es)?\b|\b(?:\d{1,3}\.){3}\d{1,3}\b/i;
const NEVER_BUILD = new RegExp(
  `${GAZE_ASN_IP.source}|\\bemotion|face.?match|\\bdevice\\b|\\bpersonality\\b|voiceprint|biometric|likeness`,
  'i',
);

describe('copy rules (CLAUDE.md rule 7; never claims camera, microphone or identity checks at M1)', () => {
  const forbidden: readonly RegExp[] = [
    /emotion/i,
    /stress/i,
    /personality/i,
    /mood/i,
    /gaze/i,
    /\beyes?\b/i,
    /\bAI\b/,
    /artificial/i,
    /machine/i,
    /biometric/i,
    /voiceprint/i,
    /\bvoice\b/i,
    /\bIP\b/,
    /\bASN\b/,
    /network/i,
    /\blocation\b/i,
    /camera/i,
    /webcam/i,
    /micro?phone/i,
    /\bmic\b/i,
    /video/i,
    /audio/i,
    /sound/i,
    /\bfaces?\b/i,
    /identity/i,
    /\bID\b/,
    /verif/i,
    /screen ?(record|shar|captur)/i,
    /\bdevice\b/i,
    // D1's recruiter guards (apps/recruiter/src/d1-guards.test.tsx; R5-22, AT-M1-24, R5-46): A5 renders this summary
    // on the recruiter integrity step, so its lines obey ANYWHERE_WORDS, COMBINED and NEVER_BUILD too. Copied, not
    // imported across packages; keep them in step with that file.
    ANYWHERE_WORDS,
    COMBINED,
    NEVER_BUILD,
  ];

  it('no rendered line uses a forbidden term, under any setting combination', () => {
    const seen = new Set<string>();
    for (const settings of allCombinations()) {
      for (const line of renderCandidateSummary(settings, CATALOG).lines) seen.add(line);
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const line of seen) for (const re of forbidden) expect(line).not.toMatch(re);
  });
});

describe('purity', () => {
  it('is deterministic and does not mutate its input', () => {
    for (const settings of allCombinations()) {
      const before = structuredClone(settings);
      const frozen = Object.freeze({ ...settings });
      const a = renderCandidateSummary(frozen, CATALOG);
      const b = renderCandidateSummary(structuredClone(settings), CATALOG);
      expect(a).toEqual(b);
      expect(settings).toEqual(before);
      expect(captureSignalsFor(frozen, CATALOG)).toEqual(captureSignalsFor(settings, CATALOG));
    }
  });

  it('returns fresh arrays, so a caller cannot change a later result', () => {
    const a = renderCandidateSummary(PRESETS.standard, CATALOG);
    (a.lines as string[]).push('changed');
    (a.captureSignals as CatalogSignal[]).pop();
    expect(renderCandidateSummary(PRESETS.standard, CATALOG).lines).not.toContain('changed');
    expect(renderCandidateSummary(PRESETS.standard, CATALOG).captureSignals).toEqual(ALL_SIGNALS);
  });

  it('refuses settings outside the catalog (missing, unknown or wrong-valued keys)', () => {
    const missing: Partial<IntegritySettingValues> = { ...PRESETS.standard };
    delete missing.paste_written;
    const bad: unknown[] = [
      missing,
      { ...PRESETS.standard, lab_mode: 'off' },
      { ...PRESETS.standard, paste_written: 'allowed' },
      { ...PRESETS.standard, fullscreen_tab_focus: 'warn' },
      { ...PRESETS.standard, id_verification: 'on' },
      null,
    ];
    for (const settings of bad) {
      expect(() => renderCandidateSummary(settings as IntegritySettingValues, CATALOG)).toThrow(
        'invalid integrity settings',
      );
      expect(() => captureSignalsFor(settings as IntegritySettingValues, CATALOG)).toThrow(
        'invalid integrity settings',
      );
    }
  });
});
