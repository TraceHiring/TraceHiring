// "What candidates will see" (specs/m1-test-authoring.md §6.6, §6.7; R2-12, R5-24, R5-39 d; AT-M1-31). Pure,
// versioned, English. The summary is driven by what is captured (the package's `captureSignals`), never by whether a
// captured signal is a band input: an `allowed_logged` paste is recorded as timeline context, so it is listed.
//
// One source of truth for capture: no settings -> captureSignals mapping existed in TypeScript, so this module owns
// it. `SETTING_CAPTURE_SIGNALS` mirrors `integrity_setting_defs.maps_to_signals` of catalog m1-settings-v1 (the test
// cross-checks the seed), and `captureSignalsFor` is the function the publish path (TestPackageV2.captureSignals)
// and the settings view reuse. A mapped signal is captured unless a setting that maps it is `off` (R2-12);
// `allowed_logged` and `blocked` both capture paste/drop (only the band-enabled flag differs, derived in the DB by
// private.derive_signal_settings). A setting switches its mapped signals whatever its "runs from" (R5-39 d); settings
// that map no D1 signal (the M4, M3b and Phase 2 ones) run nothing, so they add no line.
//
// Copy rules: rule 7 terms never appear, nor D1's recruiter guard words (ANYWHERE_WORDS, COMBINED, NEVER_BUILD in
// apps/recruiter/src/d1-guards.test.tsx), because the recruiter integrity step shows these lines too; the summary may over-state but never under-state what is recorded, so every
// captured signal has a line, and the always-on D1 records (start photo, answers and edits, connection signal; see
// apps/candidate/src/copy.ts) are listed whatever the settings. Nothing here claims camera, microphone or identity
// checks. Changing any line, its order or the mapping is a new CANDIDATE_SUMMARY_VERSION.
import {
  INTEGRITY_CATALOG_VERSION,
  IntegritySettingsRequest,
  type SettingKey,
} from './contracts-m1.js';
import { type CatalogSignal, SIGNAL_CATALOG, SIGNAL_CATALOG_VERSION } from './signal-catalog.js';

// candidate-summary-2 (M1-REV-6): with paste allowed the candidate app still blocks drop, so the paste line says so.
export const CANDIDATE_SUMMARY_VERSION = 'candidate-summary-2';

/** One value per setting of catalog m1-settings-v1 (the shape of ruleset_versions.settings). */
export type IntegritySettingValues = IntegritySettingsRequest['values'];

/** The D1 signals each setting captures (integrity_setting_defs.maps_to_signals, §6.6 "switches D1 signals"). */
export const SETTING_CAPTURE_SIGNALS: Readonly<Record<SettingKey, readonly CatalogSignal[]>> =
  Object.freeze({
    calibration_warmup: Object.freeze([]),
    typing_provenance: Object.freeze(['untrusted_input'] as const),
    burst_after_tab: Object.freeze([]),
    fullscreen_tab_focus: Object.freeze(['tab_hidden', 'fullscreen_exit'] as const),
    single_screen: Object.freeze([]),
    camera_face_presence: Object.freeze([]),
    mic_speech_presence: Object.freeze([]),
    explain_probe: Object.freeze([]),
    question_copy: Object.freeze([]),
    paste_written: Object.freeze(['paste', 'drop'] as const),
    integrity_review_scope: Object.freeze([]),
    accommodations: Object.freeze([]),
    id_verification: Object.freeze([]),
  });

export interface CandidateSummaryEntry {
  /** The captured signals this line tells the candidate about (empty for an always-on record or the review line). */
  readonly signals: readonly CatalogSignal[];
  readonly text: string;
}

export interface CandidateSummary {
  readonly version: typeof CANDIDATE_SUMMARY_VERSION;
  readonly catalogVersion: typeof INTEGRITY_CATALOG_VERSION;
  readonly signalCatalogVersion: typeof SIGNAL_CATALOG_VERSION;
  /** What the client records and the DO keeps, in catalog order (TestPackageV2.captureSignals). */
  readonly captureSignals: CatalogSignal[];
  readonly entries: CandidateSummaryEntry[];
  /** `entries[].text` in order (IntegritySettingsView.candidateSummary). */
  readonly lines: string[];
}

const TEXT = {
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

const CATALOG_ORDER = Object.keys(SIGNAL_CATALOG.signals) as CatalogSignal[];

function checked(settings: IntegritySettingValues, catalogVersion: string): IntegritySettingValues {
  if (catalogVersion !== INTEGRITY_CATALOG_VERSION) throw new Error('unknown settings catalog');
  const parsed = IntegritySettingsRequest.shape.values.safeParse(settings);
  if (!parsed.success) throw new Error('invalid integrity settings');
  return parsed.data;
}

function capture(settings: IntegritySettingValues): CatalogSignal[] {
  const off = new Set<CatalogSignal>();
  for (const [key, signals] of Object.entries(SETTING_CAPTURE_SIGNALS) as [
    SettingKey,
    readonly CatalogSignal[],
  ][]) {
    if (settings[key] === 'off') for (const s of signals) off.add(s);
  }
  return CATALOG_ORDER.filter((s) => !off.has(s));
}

/**
 * The signals a session with these settings captures, in catalog order. An unknown catalog or settings outside the
 * catalog (a missing, unknown or wrong-valued key) throw; there is no default.
 */
export function captureSignalsFor(
  settings: IntegritySettingValues,
  catalogVersion: string,
): CatalogSignal[] {
  return capture(checked(settings, catalogVersion));
}

/** "What candidates will see" for these settings (§6.6). Same input, same output; the input is never changed. */
export function renderCandidateSummary(
  settings: IntegritySettingValues,
  catalogVersion: string,
): CandidateSummary {
  const values = checked(settings, catalogVersion);
  const captured = capture(values);
  const has = (s: CatalogSignal) => captured.includes(s);
  const entries: CandidateSummaryEntry[] = [
    { signals: [], text: TEXT.photo },
    { signals: [], text: TEXT.answers },
  ];
  const paste = captured.filter((s) => s === 'paste' || s === 'drop');
  if (paste.length > 0) {
    entries.push({
      signals: paste,
      text: values.paste_written === 'blocked' ? TEXT.pasteBlocked : TEXT.pasteAllowed,
    });
  }
  if (has('untrusted_input')) entries.push({ signals: ['untrusted_input'], text: TEXT.untrusted });
  if (has('tab_hidden')) entries.push({ signals: ['tab_hidden'], text: TEXT.tab });
  if (has('fullscreen_exit')) entries.push({ signals: ['fullscreen_exit'], text: TEXT.fullscreen });
  entries.push({ signals: [], text: TEXT.heartbeat });
  // integrity_review_scope is always shortlist_only (rule 6) and nothing rejects on integrity alone (rule 2).
  entries.push({ signals: [], text: TEXT.review });
  return {
    version: CANDIDATE_SUMMARY_VERSION,
    catalogVersion: INTEGRITY_CATALOG_VERSION,
    signalCatalogVersion: SIGNAL_CATALOG_VERSION,
    captureSignals: captured,
    entries,
    lines: entries.map((e) => e.text),
  };
}
