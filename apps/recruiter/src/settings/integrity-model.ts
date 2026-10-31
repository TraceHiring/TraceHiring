// The integrity settings model of screen 04 (specs/m1-test-authoring.md §6.6, §6.7; R5-23, R5-24): the catalog
// m1-settings-v1 as the recruiter app shows it. Pure functions; the screens only call them. The server holds the truth
// (the database seed, the admin locks and the guard that refuses a locked value); this model only keeps the screen from
// offering what the server would refuse. Every value is one of the catalog's own enumerated values, so nothing here can
// switch a detector into a flag (rule 3): the settings only choose what is recorded and what the candidate is told.
import {
  INTEGRITY_CATALOG_VERSION,
  INTEGRITY_SETTING_VALUES,
  ALWAYS_LOCKED_SETTINGS,
  IntegritySettingsRequest,
  type IntegritySettingsView,
  type PresetKey,
  type SettingKey,
} from '@trace/shared/contracts/m1';
import { renderCandidateSummary } from '@trace/shared';

export type SettingValues = IntegritySettingsRequest['values'];
export type LockKind = 'admin' | 'always';

/** The seeded presets of m1-settings-v1 (integrity_presets v1; a test cross-checks the migration). */
export const INTEGRITY_PRESETS: Readonly<Record<PresetKey, SettingValues>> = {
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

export const PRESET_KEYS: readonly PresetKey[] = ['strict', 'standard', 'open_book'];

export const PRESET_INFO: Readonly<Record<PresetKey, { label: string; description: string }>> = {
  strict: {
    label: 'Strict',
    description: 'Final rounds. Paste blocked on written answers, single screen, explain probe on.',
  },
  standard: {
    label: 'Standard',
    description:
      'Volume screening. Paste allowed and logged, a warning first on leaving full screen.',
  },
  open_book: {
    label: 'Open-book',
    description:
      'Notes and search allowed. Focus, screen, camera and microphone checks off. Paste allowed and recorded; typing provenance and the calibration warm-up stay on.',
  },
};

export interface SettingInfo {
  label: string;
  description: string;
  /** A short extra note, shown beside the label. */
  note?: string;
  /** The first build that runs the setting (integrity_setting_defs.available_from). */
  runsFrom: 'D1' | 'M3b' | 'M4' | 'phase2';
}

export const SETTING_INFO: Readonly<Record<SettingKey, SettingInfo>> = {
  calibration_warmup: {
    label: 'Calibration warm-up',
    description: "Two ungraded 60-second tasks set each candidate's own typing baseline.",
    runsFrom: 'M4',
  },
  typing_provenance: {
    label: 'Typing provenance',
    description:
      'Records input that comes from a script or another program instead of from the candidate.',
    runsFrom: 'D1',
  },
  burst_after_tab: {
    label: 'Burst after leaving the tab',
    description: 'Looks at large text typed quickly after returning to the test.',
    runsFrom: 'M4',
  },
  fullscreen_tab_focus: {
    label: 'Fullscreen and tab focus',
    description:
      'Records when the candidate leaves full screen or the test tab. Used as context only; it never raises a flag on its own.',
    runsFrom: 'D1',
  },
  single_screen: {
    label: 'Single screen',
    description: 'Asks candidates to disconnect extra displays and pauses if one reconnects.',
    note: 'Chrome and Edge only',
    runsFrom: 'M4',
  },
  camera_face_presence: {
    label: 'Camera: face presence',
    description:
      'Counts whether a face is present and for how long. Nothing about identity is inferred.',
    runsFrom: 'M4',
  },
  mic_speech_presence: {
    label: 'Mic: speech presence',
    description:
      'Used on voice questions only. Speech presence is context and never a flag on its own.',
    runsFrom: 'M4',
  },
  explain_probe: {
    label: 'Explain-your-answer probe',
    description:
      'A short follow-up on an answer that reaches review. Used as evidence, never scored.',
    runsFrom: 'M4',
  },
  question_copy: {
    label: 'Question copy check',
    description: 'Looks at question text being copied out of the test.',
    runsFrom: 'M4',
  },
  paste_written: {
    label: 'Paste on written answers',
    description:
      'Whether pasting into written answers is blocked or allowed. Every paste is recorded either way.',
    runsFrom: 'D1',
  },
  integrity_review_scope: {
    label: 'Integrity review scope',
    description: 'Integrity is reviewed only for candidates above your Answer Quality cutoff.',
    runsFrom: 'D1',
  },
  accommodations: {
    label: 'Accommodations',
    description:
      'Candidates can ask for extra time and other support. This cannot be switched off.',
    runsFrom: 'M3b',
  },
  id_verification: {
    label: 'ID verification',
    description: 'An optional add-on that is not available yet.',
    note: 'Add-on',
    runsFrom: 'phase2',
  },
};

/** The settings in the catalog's order. */
export const SETTING_ORDER = Object.keys(INTEGRITY_SETTING_VALUES) as SettingKey[];

const VALUE_LABELS: Readonly<Record<string, string>> = {
  on: 'On',
  off: 'Off',
  warn_first: 'Warn first',
  blocked: 'Blocked, attempts logged',
  allowed_logged: 'Allowed, logged',
};

/** The words for a stored value; the raw review-scope value is never shown (R5-46). */
export function valueLabel(key: SettingKey, value: string): string {
  if (key === 'integrity_review_scope') return 'Candidates above your cutoff only';
  return VALUE_LABELS[value] ?? value;
}

/** A setting that runs after this build is stored and shown, but captures and runs nothing yet (§6.6). */
export const takesEffectLater = (key: SettingKey): boolean => SETTING_INFO[key].runsFrom !== 'D1';

/** The settings an admin may lock: every one that is not always locked. */
export const lockableKeys = (): SettingKey[] =>
  SETTING_ORDER.filter((key) => !ALWAYS_LOCKED_SETTINGS.includes(key));

export interface IntegrityState {
  presetKey: PresetKey | null;
  values: SettingValues;
  locked: IntegritySettingsView['locked'];
}

export function fromIntegrityView(view: IntegritySettingsView): IntegrityState {
  return { presetKey: view.presetKey, values: view.values, locked: view.locked };
}

export const lockOf = (state: IntegrityState, key: SettingKey): LockKind | undefined =>
  state.locked[key];

/** The preset whose values these are exactly, or null (custom). */
export function derivePresetKey(values: SettingValues): PresetKey | null {
  return (
    PRESET_KEYS.find((preset) =>
      SETTING_ORDER.every((k) => values[k] === INTEGRITY_PRESETS[preset][k]),
    ) ?? null
  );
}

function withValues(state: IntegrityState, values: SettingValues): IntegrityState {
  return { ...state, values, presetKey: derivePresetKey(values) };
}

/** Applies a preset to every setting that is not locked; a locked setting keeps its value. */
export function applyPreset(state: IntegrityState, preset: PresetKey): IntegrityState {
  const next = { ...state.values } as Record<SettingKey, string>;
  for (const key of SETTING_ORDER) {
    if (lockOf(state, key) === undefined) next[key] = INTEGRITY_PRESETS[preset][key];
  }
  return withValues(state, next as SettingValues);
}

/** Sets one value; a locked setting or a value outside the catalog leaves the state as it was (same object). */
export function setSetting(state: IntegrityState, key: SettingKey, value: string): IntegrityState {
  if (lockOf(state, key) !== undefined) return state;
  if (!(INTEGRITY_SETTING_VALUES[key] as readonly string[]).includes(value)) return state;
  return withValues(state, { ...state.values, [key]: value } as SettingValues);
}

export type BuiltIntegrity = { ok: true; request: IntegritySettingsRequest } | { ok: false };

export function toIntegrityRequest(state: IntegrityState): BuiltIntegrity {
  const parsed = IntegritySettingsRequest.safeParse({
    presetKey: derivePresetKey(state.values),
    values: state.values,
  });
  return parsed.success ? { ok: true, request: parsed.data } : { ok: false };
}

/** "What candidates will see" for the current values: the shared, versioned renderer (R5-24). */
export const candidatePreview = (state: IntegrityState): string[] =>
  renderCandidateSummary(state.values, INTEGRITY_CATALOG_VERSION).lines;
