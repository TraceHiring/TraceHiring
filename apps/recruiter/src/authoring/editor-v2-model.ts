// The v2 test editor's form state and its rules (specs/m1-test-authoring.md §6.5; R5-53 b, R5-54 a). Pure functions:
// the screens only call them. `fromDraftView` reads the M1 draft read-model (TestDraftView) and `toSaveTestDraftRequest`
// builds the `PUT …/tests/:testId/draft` body (SaveTestDraftRequest); the two round-trip, including a D1 section whose
// navigation is null (package v1: inline, unshuffled, no paste rule), which is saved back exactly as it was while the
// whole draft is package v1. Once the draft is package v2 (integrity settings saved, or any section uses an M1 feature:
// the publish guard's own test, `20261023020000_m1_tests.sql`), every section is saved with a navigation (its format's
// default if it had none) and every written section with the test's `paste_written` as its paste rule: the guard
// refuses a v2 version otherwise, and the candidate's paste rules text and the band input come from that one setting
// (rule 3, DB-M1-1). Inline items are carried as they are (their editor is D1's); this model owns the section rules:
// pool or inline, the draw count and strata quotas (which add up to it), navigation (a written section is forward-only),
// a per-section timer and shuffle flags, plus the v2 publish rules it can show early (weights add up to 100, timers on
// every section or none). D1's own editor model (editor-model.ts) is not touched: the live editor keeps D1's load and
// save until A2 switches the api and the editor together.
import {
  SaveTestDraftRequest,
  type IntegritySettingsView,
  type TestDraftView,
} from '@trace/shared/contracts/m1';

export const MAX_SECTIONS = 10;
const MAX_STRATA = 20;

type SectionRequest = SaveTestDraftRequest['sections'][number];
/** One inline item as the save request carries it (D1's shape: no id, no position). */
export type DraftItem = SectionRequest['items'][number];
export type SectionMode = 'inline' | 'pool';
export type SectionFormat = 'mcq' | 'written';
export type Navigation = 'free' | 'forward_only';
export type PasteRule = 'blocked' | 'allowed_logged';

export interface StratumForm {
  skillKey: string;
  /** The difficulty level of the stratum, 0 to 4. */
  level: number;
  count: string;
}

export interface SectionForm {
  /** A stable key for the screen: the stored section id, or one made here. */
  key: string;
  mode: SectionMode;
  format: SectionFormat;
  name: string;
  weight: string;
  items: DraftItem[];
  poolId: string;
  drawCount: string;
  strata: StratumForm[];
  shuffleItems: boolean;
  shuffleOptions: boolean;
  /** null is a D1 section; it stays null on save only while the whole draft is package v1. */
  navigation: Navigation | null;
  // No paste rule here: a written section always takes the test's paste_written (pasteRuleOf).
  timeLimitSeconds: number | null;
}

export interface EditorV2Form {
  testId: string;
  workspaceId: string;
  versionId: string;
  versionNo: number;
  status: TestDraftView['version']['status'];
  name: string;
  durationMinutes: string;
  qualityCutoff: string;
  /**
   * The test's `paste_written` integrity setting, which every written section of a v2 draft takes as its paste rule;
   * null while the draft has no integrity settings stored (a D1 draft).
   */
  pasteWritten: PasteRule | null;
  sections: SectionForm[];
}

/** The stored integrity values the editor needs (from `GET …/tests/:testId/integrity` or a saved `PUT`). */
export type StoredIntegrity = Pick<IntegritySettingsView['values'], 'paste_written'>;

/** A section's navigation when it has none of its own (M1-11): written is one-way, multiple choice allows going back. */
const defaultNavigation = (format: SectionFormat): Navigation =>
  format === 'written' ? 'forward_only' : 'free';

// ---- reading a stored draft -------------------------------------------------------------------------------------

type ViewItem = TestDraftView['version']['sections'][number]['items'][number];

/** An inline item without its id and position: the save request's own shape. */
function draftItem(item: ViewItem): DraftItem {
  return item.format === 'mcq'
    ? {
        format: 'mcq',
        prompt: item.prompt,
        options: item.options.map((o) => ({ ...o })),
        correctOptionId: item.correctOptionId,
      }
    : { format: 'written', prompt: item.prompt, rubric: structuredClone(item.rubric) };
}

/**
 * The form of a stored draft. `integrity` is the test's stored integrity settings, or null while its ruleset has none
 * (a D1 draft: then a D1 draft stays D1). Without it, the paste rule a v2 draft's written sections already carry is
 * kept (the guard made them equal to the settings at the last save).
 */
export function fromDraftView(
  view: TestDraftView,
  integrity: StoredIntegrity | null = null,
): EditorV2Form {
  const ordered = [...view.version.sections].sort((a, b) => a.position - b.position);
  const storedRule = ordered.find((s) => s.format === 'written' && s.pasteRule !== undefined);
  const sections = ordered.map((s): SectionForm => ({
    key: s.id,
    mode: s.mode,
    format: s.format,
    name: s.name,
    weight: String(s.weight),
    items: s.items.map(draftItem),
    poolId: s.poolId ?? '',
    drawCount: s.drawCount === undefined ? '' : String(s.drawCount),
    strata: (s.blueprint?.strata ?? []).map((t) => ({
      skillKey: t.skillKey,
      level: t.difficultyBand,
      count: String(t.count),
    })),
    shuffleItems: s.shuffleItems,
    shuffleOptions: s.shuffleOptions,
    navigation: s.navigation,
    timeLimitSeconds: s.timeLimitSeconds ?? null,
  }));
  return {
    testId: view.test.id,
    workspaceId: view.test.workspaceId,
    versionId: view.version.id,
    versionNo: view.version.versionNo,
    status: view.version.status,
    name: view.test.name,
    durationMinutes: String(view.version.durationMinutes),
    qualityCutoff: String(view.version.qualityCutoff),
    pasteWritten: integrity?.paste_written ?? storedRule?.pasteRule ?? null,
    sections,
  };
}

// ---- package v1 or v2 (the publish guard's test, mirrored) ------------------------------------------------------

/** A section that uses an M1 feature: the guard's list (pool, navigation, shuffle, paste rule, blueprint). */
const usesM1Feature = (s: SectionForm): boolean =>
  s.mode === 'pool' ||
  s.navigation !== null ||
  s.shuffleItems ||
  s.shuffleOptions ||
  s.strata.length > 0;

/**
 * True once the draft is package v2: integrity settings are stored, or any section uses an M1 feature. Then the guard
 * wants every section's navigation and every written section's paste rule equal to `paste_written`. False only for a
 * D1 draft, which is saved exactly as D1 saved it.
 */
export const isPackageV2 = (form: EditorV2Form): boolean =>
  form.pasteWritten !== null || form.sections.some(usesM1Feature);

/**
 * The paste rule every written section of a v2 draft takes: the test's `paste_written`. Before any integrity settings
 * are saved it is `blocked`, D1's behaviour, so the candidate is never told paste is allowed while paste could still be
 * a band input (rule 3); the guard refuses publish until the settings are saved and the sections follow them.
 */
export const pasteRuleOf = (form: EditorV2Form): PasteRule => form.pasteWritten ?? 'blocked';

/** The test's paste setting changed (the integrity step saved it): every written section follows it. */
export function setPasteWritten(form: EditorV2Form, rule: PasteRule): EditorV2Form {
  return form.pasteWritten === rule ? form : { ...form, pasteWritten: rule };
}

// ---- building the save request ------------------------------------------------------------------------------------

const toInt = (text: string): number =>
  /^[0-9]{1,9}$/.test(text.trim()) ? Number(text) : Number.NaN;
const CUTOFF_TEXT = /^(?:0|[1-9][0-9]?|100)$/;
export const isCutoffValid = (text: string): boolean => CUTOFF_TEXT.test(text);

/** `v2Paste` is the paste rule of a v2 draft's written sections, or null for a D1 (package v1) draft. */
function sectionRequest(s: SectionForm, v2Paste: PasteRule | null): Record<string, unknown> {
  const out: Record<string, unknown> = {
    mode: s.mode,
    format: s.format,
    name: s.name.trim(),
    weight: toInt(s.weight),
    items: s.items,
    shuffleItems: s.shuffleItems,
    shuffleOptions: s.shuffleOptions,
    // A v2 version needs every section's navigation (publish guard v2): a D1 section takes its format's default.
    navigation: v2Paste === null ? s.navigation : (s.navigation ?? defaultNavigation(s.format)),
  };
  if (s.mode === 'pool') {
    out.poolId = s.poolId;
    out.drawCount = toInt(s.drawCount);
    if (s.strata.length > 0) {
      out.blueprint = {
        strata: s.strata.map((t) => ({
          skillKey: t.skillKey,
          difficultyBand: t.level,
          count: toInt(t.count),
        })),
      };
    }
  }
  // Rule 3 (DB-M1-1): a written v2 section's paste rule is the test's paste_written, never a value of its own.
  if (s.format === 'written' && v2Paste !== null) out.pasteRule = v2Paste;
  if (s.timeLimitSeconds !== null) out.timeLimitSeconds = s.timeLimitSeconds;
  return out;
}

export type BuiltV2 =
  { ok: true; request: SaveTestDraftRequest } | { ok: false; reason: 'cutoff' | 'invalid' };

/** The `PUT …/draft` body, parsed with the shared contract; never built without a valid cutoff. */
export function toSaveTestDraftRequest(form: EditorV2Form): BuiltV2 {
  if (!isCutoffValid(form.qualityCutoff)) return { ok: false, reason: 'cutoff' };
  const v2Paste = isPackageV2(form) ? pasteRuleOf(form) : null;
  const parsed = SaveTestDraftRequest.safeParse({
    name: form.name.trim(),
    durationMinutes: toInt(form.durationMinutes),
    qualityCutoff: Number(form.qualityCutoff),
    sections: form.sections.map((s) => sectionRequest(s, v2Paste)),
  });
  return parsed.success ? { ok: true, request: parsed.data } : { ok: false, reason: 'invalid' };
}

// ---- what the screen tells the recruiter ------------------------------------------------------------------------

export type SectionIssueCode =
  | 'name'
  | 'weight'
  | 'pool_missing'
  | 'draw_count'
  | 'strata_skill'
  | 'strata_count'
  | 'strata_sum'
  | 'strata_duplicate'
  | 'time_limit'
  // Test-wide publish rules of a v2 draft (section null): R2-13 and M1-11.
  | 'weights_sum'
  | 'timers_mixed';

const SKILL = /^[a-z][a-z0-9_]{1,40}$/;
const inRange = (n: number, min: number, max: number): boolean =>
  Number.isInteger(n) && n >= min && n <= max;

export const strataSum = (section: SectionForm): number =>
  section.strata.reduce((sum, s) => {
    const n = toInt(s.count);
    return sum + (Number.isNaN(n) ? 0 : n);
  }, 0);

/** The sum of the section weights (a weight that is not a whole number counts 0). */
export const weightSum = (form: EditorV2Form): number =>
  form.sections.reduce((sum, s) => {
    const n = toInt(s.weight);
    return sum + (Number.isNaN(n) ? 0 : n);
  }, 0);

/** An issue of one section (its index), or of the whole test (`section` null). */
export interface SectionIssue {
  section: number | null;
  code: SectionIssueCode;
}

/**
 * Why the draft cannot be saved or published yet, in screen order: each section's own issues, then the publish rules
 * of a v2 draft that the guard enforces (section weights add up to 100, R2-13; a time limit on every section or on
 * none, M1-11). A D1 (package v1) draft keeps D1's rules. A half-written section (no items yet) is not an issue.
 */
export function sectionIssues(form: EditorV2Form): SectionIssue[] {
  const out: SectionIssue[] = [];
  form.sections.forEach((s, section) => {
    const add = (code: SectionIssueCode) => out.push({ section, code });
    if (s.name.trim() === '') add('name');
    if (!inRange(toInt(s.weight), 1, 100)) add('weight');
    if (s.timeLimitSeconds !== null && !inRange(s.timeLimitSeconds, 60, 7200)) add('time_limit');
    if (s.mode !== 'pool') return;
    if (s.poolId === '') add('pool_missing');
    const draw = toInt(s.drawCount);
    const drawOk = inRange(draw, 1, 100);
    if (!drawOk) add('draw_count');
    if (s.strata.length === 0) return;
    if (s.strata.some((t) => !SKILL.test(t.skillKey))) add('strata_skill');
    if (s.strata.some((t) => !inRange(toInt(t.count), 1, 100))) add('strata_count');
    const pairs = s.strata.map((t) => `${t.skillKey}:${t.level}`);
    if (new Set(pairs).size !== pairs.length) add('strata_duplicate');
    if (drawOk && strataSum(s) !== draw) add('strata_sum');
  });
  if (isPackageV2(form) && form.sections.length > 0) {
    if (weightSum(form) !== 100) out.push({ section: null, code: 'weights_sum' });
    const timed = form.sections.filter((s) => s.timeLimitSeconds !== null).length;
    if (timed !== 0 && timed !== form.sections.length) {
      out.push({ section: null, code: 'timers_mixed' });
    }
  }
  return out;
}

/** How many more approved items a pool needs: to publish (the draw count) and for drives (ten times it, §6.5). */
export function poolGap(
  approvedCount: number,
  drawCount: number,
): { forPublish: number; forDrives: number } {
  return {
    forPublish: Math.max(0, drawCount - approvedCount),
    forDrives: Math.max(0, 10 * drawCount - approvedCount),
  };
}

// ---- editing sections ------------------------------------------------------------------------------------------

let made = 0;

export function newSection(mode: SectionMode, format: SectionFormat): SectionForm {
  made += 1;
  return {
    key: `new-${made}`,
    mode,
    format,
    name: format === 'mcq' ? 'Multiple choice' : 'Written answers',
    weight: '10',
    items: [],
    poolId: '',
    drawCount: '',
    strata: [],
    shuffleItems: false,
    shuffleOptions: false,
    navigation: defaultNavigation(format),
    timeLimitSeconds: null,
  };
}

export function addSection(
  form: EditorV2Form,
  mode: SectionMode,
  format: SectionFormat,
): EditorV2Form {
  if (form.sections.length >= MAX_SECTIONS) return form;
  return { ...form, sections: [...form.sections, newSection(mode, format)] };
}

export function removeSection(form: EditorV2Form, index: number): EditorV2Form {
  return { ...form, sections: form.sections.filter((_, i) => i !== index) };
}

export function moveSection(form: EditorV2Form, index: number, by: -1 | 1): EditorV2Form {
  const to = index + by;
  const a = form.sections[index];
  const b = form.sections[to];
  if (a === undefined || b === undefined) return form;
  const sections = [...form.sections];
  sections[index] = b;
  sections[to] = a;
  return { ...form, sections };
}

/** Using an M1 feature on a D1 section (navigation null) makes it a v2 section with the format's default. */
const upgraded = (s: SectionForm): SectionForm =>
  s.navigation === null ? { ...s, navigation: defaultNavigation(s.format) } : s;

export function setMode(section: SectionForm, mode: SectionMode): SectionForm {
  if (section.mode === mode) return section;
  if (mode === 'pool') {
    // The items would be lost: the section has to be emptied first.
    if (section.items.length > 0) return section;
    return { ...upgraded(section), mode: 'pool', poolId: '', drawCount: '', strata: [] };
  }
  return { ...section, mode: 'inline', poolId: '', drawCount: '', strata: [] };
}

export function setFormat(section: SectionForm, format: SectionFormat): SectionForm {
  if (section.format === format || section.items.length > 0) return section;
  return {
    ...section,
    format,
    poolId: '',
    strata: [],
    navigation:
      section.navigation === null
        ? null
        : format === 'written'
          ? 'forward_only'
          : section.navigation,
    shuffleOptions: format === 'written' ? false : section.shuffleOptions,
  };
}

/** A written section is forward-only: it never takes free navigation. */
export function setNavigation(section: SectionForm, navigation: Navigation): SectionForm {
  const target = section.format === 'written' ? 'forward_only' : navigation;
  return target === section.navigation ? section : { ...section, navigation: target };
}

export function setShuffle(
  section: SectionForm,
  which: 'items' | 'options',
  on: boolean,
): SectionForm {
  if (which === 'options' && section.format === 'written') return section;
  const current = which === 'items' ? section.shuffleItems : section.shuffleOptions;
  if (current === on) return section;
  const next =
    which === 'items' ? { ...section, shuffleItems: on } : { ...section, shuffleOptions: on };
  return on ? upgraded(next) : next;
}

const MINUTES = /^[1-9][0-9]{0,2}$/;
/** Whole minutes 1 to 120, or empty for no timer; any other text leaves the section as it was. */
export function setTimeLimitMinutes(section: SectionForm, text: string): SectionForm {
  if (text === '')
    return section.timeLimitSeconds === null ? section : { ...section, timeLimitSeconds: null };
  if (!MINUTES.test(text) || Number(text) > 120) return section;
  return upgraded({ ...section, timeLimitSeconds: Number(text) * 60 });
}

export function setPool(section: SectionForm, poolId: string): SectionForm {
  return section.mode === 'pool' ? { ...section, poolId } : section;
}

const DRAW = /^(?:[1-9][0-9]?|100)$/;
/** A whole number 1 to 100, or empty while typing; anything else leaves the section as it was. */
export function setDrawCount(section: SectionForm, text: string): SectionForm {
  if (section.mode !== 'pool' || (text !== '' && !DRAW.test(text))) return section;
  return { ...section, drawCount: text };
}

export function addStratum(section: SectionForm, skillKey = ''): SectionForm {
  if (section.mode !== 'pool' || section.strata.length >= MAX_STRATA) return section;
  return { ...section, strata: [...section.strata, { skillKey, level: 0, count: '1' }] };
}

export function removeStratum(section: SectionForm, index: number): SectionForm {
  return { ...section, strata: section.strata.filter((_, i) => i !== index) };
}

const SKILL_PARTIAL = /^[a-z][a-z0-9_]{0,40}$/;
const COUNT_PARTIAL = /^(?:[0-9]{1,3})?$/;
export function updateStratum(
  section: SectionForm,
  index: number,
  patch: Partial<StratumForm>,
): SectionForm {
  const old = section.strata[index];
  if (old === undefined) return section;
  if (patch.skillKey !== undefined && patch.skillKey !== '' && !SKILL_PARTIAL.test(patch.skillKey))
    return section;
  if (patch.level !== undefined && !inRange(patch.level, 0, 4)) return section;
  if (patch.count !== undefined && !COUNT_PARTIAL.test(patch.count)) return section;
  return {
    ...section,
    strata: section.strata.map((t, i) => (i === index ? { ...old, ...patch } : t)),
  };
}
