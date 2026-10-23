// The v2 test editor's form state and its rules (specs/m1-test-authoring.md §6.5; R5-53 b, R5-54 a). Pure functions:
// the screens only call them. `fromDraftView` reads the M1 draft read-model (TestDraftView) and `toSaveTestDraftRequest`
// builds the `PUT …/tests/:testId/draft` body (SaveTestDraftRequest); the two round-trip, including a D1 section whose
// navigation is null (package v1: inline, unshuffled, no paste rule), which is saved back exactly as it was until the
// recruiter uses an M1 feature on it. Inline items are carried as they are (their editor is D1's); this model owns the
// section rules: pool or inline, the draw count and strata quotas (which add up to it), navigation (a written section is
// forward-only), a per-section timer, shuffle flags and the paste rule. D1's own editor model (editor-model.ts) is not
// touched: the live editor keeps D1's load and save until A2 switches the api and the editor together.
import { SaveTestDraftRequest, type TestDraftView } from '@trace/shared/contracts/m1';

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
  /** null is a D1 section (package v1). */
  navigation: Navigation | null;
  /** null follows the test's paste setting. */
  pasteRule: PasteRule | null;
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
  sections: SectionForm[];
}

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

export function fromDraftView(view: TestDraftView): EditorV2Form {
  const sections = [...view.version.sections]
    .sort((a, b) => a.position - b.position)
    .map((s): SectionForm => ({
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
      pasteRule: s.pasteRule ?? null,
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
    sections,
  };
}

// ---- building the save request ------------------------------------------------------------------------------------

const toInt = (text: string): number =>
  /^[0-9]{1,9}$/.test(text.trim()) ? Number(text) : Number.NaN;
const CUTOFF_TEXT = /^(?:0|[1-9][0-9]?|100)$/;
export const isCutoffValid = (text: string): boolean => CUTOFF_TEXT.test(text);

function sectionRequest(s: SectionForm): Record<string, unknown> {
  const out: Record<string, unknown> = {
    mode: s.mode,
    format: s.format,
    name: s.name.trim(),
    weight: toInt(s.weight),
    items: s.items,
    shuffleItems: s.shuffleItems,
    shuffleOptions: s.shuffleOptions,
    navigation: s.navigation,
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
  if (s.pasteRule !== null) out.pasteRule = s.pasteRule;
  if (s.timeLimitSeconds !== null) out.timeLimitSeconds = s.timeLimitSeconds;
  return out;
}

export type BuiltV2 =
  { ok: true; request: SaveTestDraftRequest } | { ok: false; reason: 'cutoff' | 'invalid' };

/** The `PUT …/draft` body, parsed with the shared contract; never built without a valid cutoff. */
export function toSaveTestDraftRequest(form: EditorV2Form): BuiltV2 {
  if (!isCutoffValid(form.qualityCutoff)) return { ok: false, reason: 'cutoff' };
  const parsed = SaveTestDraftRequest.safeParse({
    name: form.name.trim(),
    durationMinutes: toInt(form.durationMinutes),
    qualityCutoff: Number(form.qualityCutoff),
    sections: form.sections.map(sectionRequest),
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
  | 'time_limit';

const SKILL = /^[a-z][a-z0-9_]{1,40}$/;
const inRange = (n: number, min: number, max: number): boolean =>
  Number.isInteger(n) && n >= min && n <= max;

export const strataSum = (section: SectionForm): number =>
  section.strata.reduce((sum, s) => {
    const n = toInt(s.count);
    return sum + (Number.isNaN(n) ? 0 : n);
  }, 0);

/** Why a section cannot be saved yet, in screen order. A half-written section (no items yet) is not an issue. */
export function sectionIssues(form: EditorV2Form): { section: number; code: SectionIssueCode }[] {
  const out: { section: number; code: SectionIssueCode }[] = [];
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
const defaultNavigation = (format: SectionFormat): Navigation =>
  format === 'written' ? 'forward_only' : 'free';

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
    pasteRule: null,
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
    pasteRule: format === 'mcq' ? null : section.pasteRule,
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

/** Only a written section has a paste rule; null follows the test's paste setting. */
export function setPasteRule(section: SectionForm, rule: PasteRule | null): SectionForm {
  if (section.format !== 'written' || section.pasteRule === rule) return section;
  const next = { ...section, pasteRule: rule };
  return rule === null ? next : upgraded(next);
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
