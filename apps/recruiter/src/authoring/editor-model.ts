// The test editor's form state and its rules (specs/d1-demo-slice.md §6.1). Pure functions: the screen only calls
// them. The Answer Quality cutoff is mandatory (editor default 40, L-15): `setCutoffInput` refuses any text that is
// not an integer 0-100, so the field can never be cleared, and no request is built without a valid cutoff. There is
// no paste-policy setting anywhere (any paste or drop is a D1-PASTE event).
import { UpdateTestDraftRequest } from '@trace/shared/contracts/d1';
import type { TestDraftView } from '@trace/shared/contracts/m1';

export const MAX_ITEMS = 10;
export const DEFAULT_CUTOFF = '40';
const MAX_OPTIONS = 6;
const MIN_OPTIONS = 2;
const MAX_CRITERIA = 8;

export interface OptionForm {
  id: string;
  text: string;
}
export interface McqItemForm {
  format: 'mcq';
  prompt: string;
  options: OptionForm[];
  correctOptionId: string;
}
export interface CriterionForm {
  id: string;
  label: string;
  maxPoints: string;
  /** Comma-separated anchors. */
  anchors: string;
  minHits: string;
}
export interface WrittenItemForm {
  format: 'written';
  prompt: string;
  criteria: CriterionForm[];
}
export interface SectionForm<I> {
  name: string;
  weight: string;
  items: I[];
}
export interface DraftForm {
  name: string;
  durationMinutes: string;
  qualityCutoff: string;
  mcq: SectionForm<McqItemForm | WrittenItemForm>;
  written: SectionForm<McqItemForm | WrittenItemForm>;
}

export type SectionKey = 'mcq' | 'written';

export function emptyDraft(name: string): DraftForm {
  return {
    name,
    durationMinutes: '30',
    qualityCutoff: DEFAULT_CUTOFF,
    mcq: { name: 'Multiple choice', weight: '50', items: [] },
    written: { name: 'Written answers', weight: '50', items: [] },
  };
}

const CUTOFF_TEXT = /^(?:0|[1-9][0-9]?|100)$/;

export const isCutoffValid = (text: string): boolean => CUTOFF_TEXT.test(text);

/** The new cutoff text, or the previous one when the input is empty or not an integer 0-100. */
export const setCutoffInput = (previous: string, next: string): string =>
  isCutoffValid(next) ? next : previous;

export const itemCount = (form: DraftForm): number =>
  form.mcq.items.length + form.written.items.length;

const nextId = (prefix: string, used: readonly string[]): string => {
  for (let n = 1; ; n += 1) if (!used.includes(`${prefix}${n}`)) return `${prefix}${n}`;
};

export function addMcqItem(form: DraftForm): DraftForm {
  if (itemCount(form) >= MAX_ITEMS) return form;
  const item: McqItemForm = {
    format: 'mcq',
    prompt: '',
    options: [
      { id: 'o1', text: '' },
      { id: 'o2', text: '' },
    ],
    correctOptionId: 'o1',
  };
  return { ...form, mcq: { ...form.mcq, items: [...form.mcq.items, item] } };
}

export function addWrittenItem(form: DraftForm): DraftForm {
  if (itemCount(form) >= MAX_ITEMS) return form;
  const item: WrittenItemForm = {
    format: 'written',
    prompt: '',
    criteria: [{ id: 'c1', label: '', maxPoints: '10', anchors: '', minHits: '1' }],
  };
  return { ...form, written: { ...form.written, items: [...form.written.items, item] } };
}

export function removeItem(form: DraftForm, section: SectionKey, index: number): DraftForm {
  const target = form[section];
  return { ...form, [section]: { ...target, items: target.items.filter((_, i) => i !== index) } };
}

export function updateItem(
  form: DraftForm,
  section: SectionKey,
  index: number,
  item: McqItemForm | WrittenItemForm,
): DraftForm {
  const target = form[section];
  return {
    ...form,
    [section]: { ...target, items: target.items.map((old, i) => (i === index ? item : old)) },
  };
}

const mcqAt = (form: DraftForm, index: number): McqItemForm | null => {
  const item = form.mcq.items[index];
  return item?.format === 'mcq' ? item : null;
};
const writtenAt = (form: DraftForm, index: number): WrittenItemForm | null => {
  const item = form.written.items[index];
  return item?.format === 'written' ? item : null;
};

export function addOption(form: DraftForm, itemIndex: number): DraftForm {
  const item = mcqAt(form, itemIndex);
  if (item === null || item.options.length >= MAX_OPTIONS) return form;
  const id = nextId(
    'o',
    item.options.map((o) => o.id),
  );
  return updateItem(form, 'mcq', itemIndex, {
    ...item,
    options: [...item.options, { id, text: '' }],
  });
}

export function removeOption(form: DraftForm, itemIndex: number, optionIndex: number): DraftForm {
  const item = mcqAt(form, itemIndex);
  if (item === null || item.options.length <= MIN_OPTIONS) return form;
  const options = item.options.filter((_, i) => i !== optionIndex);
  const key = options.some((o) => o.id === item.correctOptionId)
    ? item.correctOptionId
    : (options[0]?.id ?? '');
  return updateItem(form, 'mcq', itemIndex, { ...item, options, correctOptionId: key });
}

export function addCriterion(form: DraftForm, itemIndex: number): DraftForm {
  const item = writtenAt(form, itemIndex);
  if (item === null || item.criteria.length >= MAX_CRITERIA) return form;
  const id = nextId(
    'c',
    item.criteria.map((c) => c.id),
  );
  return updateItem(form, 'written', itemIndex, {
    ...item,
    criteria: [...item.criteria, { id, label: '', maxPoints: '10', anchors: '', minHits: '1' }],
  });
}

export function removeCriterion(
  form: DraftForm,
  itemIndex: number,
  criterionIndex: number,
): DraftForm {
  const item = writtenAt(form, itemIndex);
  if (item === null || item.criteria.length <= 1) return form;
  return updateItem(form, 'written', itemIndex, {
    ...item,
    criteria: item.criteria.filter((_, i) => i !== criterionIndex),
  });
}

const toInt = (text: string): number =>
  /^[0-9]{1,9}$/.test(text.trim()) ? Number(text) : Number.NaN;

export type BuiltRequest =
  { ok: true; request: UpdateTestDraftRequest } | { ok: false; reason: 'cutoff' | 'invalid' };

/** The `PUT` body, parsed with the shared contract; never built without a valid cutoff. */
export function toRequest(form: DraftForm): BuiltRequest {
  if (!isCutoffValid(form.qualityCutoff)) return { ok: false, reason: 'cutoff' };
  const section = (key: SectionKey) => ({
    format: key,
    name: form[key].name.trim(),
    weight: toInt(form[key].weight),
    items: form[key].items.map((item) =>
      item.format === 'mcq'
        ? {
            format: 'mcq' as const,
            prompt: item.prompt.trim(),
            options: item.options.map((o) => ({ id: o.id, text: o.text.trim() })),
            correctOptionId: item.correctOptionId,
          }
        : {
            format: 'written' as const,
            prompt: item.prompt.trim(),
            rubric: {
              criteria: item.criteria.map((c) => ({
                id: c.id,
                label: c.label.trim(),
                maxPoints: toInt(c.maxPoints),
                anchors: c.anchors
                  .split(',')
                  .map((a) => a.trim())
                  .filter((a) => a !== ''),
                minHits: toInt(c.minHits),
              })),
            },
          },
    ),
  });
  const parsed = UpdateTestDraftRequest.safeParse({
    name: form.name.trim(),
    durationMinutes: toInt(form.durationMinutes),
    qualityCutoff: Number(form.qualityCutoff),
    sections: [section('mcq'), section('written')],
  });
  return parsed.success ? { ok: true, request: parsed.data } : { ok: false, reason: 'invalid' };
}

type ViewSection = TestDraftView['version']['sections'][number];

/** The navigation a draft with settings stores for a section that names none (R5-63 b); D1's PUT keeps it. */
const D1_NAVIGATION: Record<SectionKey, 'free' | 'forward_only'> = {
  mcq: 'free',
  written: 'forward_only',
};

/**
 * Whether D1's editor can show and save this version without losing anything (R5-53 a): every section inline,
 * unshuffled, untimed, without a blueprint, with no navigation or the default one, and at most one section per format.
 * D1's PUT rewrites every section that way, so any other draft is shown read-only here.
 */
export function d1Editable(detail: TestDraftView): boolean {
  const sections = detail.version.sections;
  const formats = new Set(sections.map((s) => s.format));
  return (
    formats.size === sections.length &&
    sections.every(
      (s: ViewSection) =>
        s.mode === 'inline' &&
        !s.shuffleItems &&
        !s.shuffleOptions &&
        s.timeLimitSeconds === undefined &&
        s.blueprint === undefined &&
        (s.navigation === null || s.navigation === D1_NAVIGATION[s.format]),
    )
  );
}

/**
 * The editor form for a stored draft (or the read-only view of a published version), adapted from the M1 read-model
 * (R5-53 a): the inline sections only, the first of each format by position, as D1 writes them.
 */
export function fromDetail(detail: TestDraftView): DraftForm {
  const form = emptyDraft(detail.test.name);
  form.durationMinutes = String(detail.version.durationMinutes);
  form.qualityCutoff = String(detail.version.qualityCutoff);
  const seen = new Set<SectionKey>();
  const inline = [...detail.version.sections]
    .filter((s) => s.mode === 'inline')
    .sort((a, b) => a.position - b.position);
  for (const section of inline) {
    if (seen.has(section.format)) continue;
    seen.add(section.format);
    form[section.format] = {
      name: section.name,
      weight: String(section.weight),
      items: section.items.map((item) =>
        item.format === 'mcq'
          ? {
              format: 'mcq' as const,
              prompt: item.prompt,
              options: item.options.map((o) => ({ ...o })),
              correctOptionId: item.correctOptionId,
            }
          : {
              format: 'written' as const,
              prompt: item.prompt,
              criteria: item.rubric.criteria.map((c) => ({
                id: c.id,
                label: c.label,
                maxPoints: String(c.maxPoints),
                anchors: c.anchors.join(', '),
                minHits: String(c.minHits),
              })),
            },
      ),
    };
  }
  return form;
}
