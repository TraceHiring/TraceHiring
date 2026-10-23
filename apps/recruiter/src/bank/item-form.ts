// The item editor's model (specs/m1-test-authoring.md §6.2, §6.3). A form of text fields becomes a BankItemDraft, or
// a list of problems by path. The parameter spec is only described here: the api parses its expressions and
// generates the variants; this app never evaluates one.
import { BankItemDraft, type BankItemDetail, type ItemFormat } from '@trace/shared/contracts/m1';

export interface OptionRow {
  id: string;
  text: string;
}
export interface MediaRow {
  key: string;
  alt: string;
}
export interface ParamRow {
  name: string;
  kind: 'int' | 'choice';
  min: string;
  max: string;
  step: string;
  /** Comma-separated; whole numbers become numbers (choice only). */
  values: string;
}
export interface DerivedRow {
  name: string;
  expr: string;
}
export interface SpecForm {
  params: ParamRow[];
  derived: DerivedRow[];
  constraints: string[];
  stem: string;
  options: OptionRow[];
  correctOptionId: string;
  count: string;
}
export interface ItemForm {
  format: ItemFormat;
  stem: string;
  options: OptionRow[];
  keyOptionId: string;
  rubricVersionId: string;
  skillKey: string;
  difficulty: string;
  media: MediaRow[];
  parameterised: boolean;
  spec: SpecForm;
}

export interface FieldError {
  path: string;
  message: string;
}
export type DraftResult = { ok: true; draft: BankItemDraft } | { ok: false; errors: FieldError[] };

export const MAX_OPTIONS = 6;
export const MIN_OPTIONS = 2;
export const MAX_MEDIA = 4;
export const MAX_PARAMS = 8;
export const MAX_DERIVED = 8;
export const MAX_CONSTRAINTS = 8;

const twoOptions = (): OptionRow[] => [
  { id: 'o1', text: '' },
  { id: 'o2', text: '' },
];

export function emptySpec(): SpecForm {
  return {
    params: [{ name: 'a', kind: 'int', min: '1', max: '9', step: '1', values: '' }],
    derived: [],
    constraints: [],
    stem: '',
    options: twoOptions(),
    correctOptionId: '',
    count: '20',
  };
}

export function emptyItemForm(format: ItemFormat = 'mcq'): ItemForm {
  return {
    format,
    stem: '',
    options: twoOptions(),
    keyOptionId: '',
    rubricVersionId: '',
    skillKey: '',
    difficulty: '',
    media: [],
    parameterised: false,
    spec: emptySpec(),
  };
}

/** The form for a stored version. A key or spec the api did not send (library items) leaves those fields empty. */
export function formFromDetail(detail: BankItemDetail): ItemForm {
  const content = detail.content;
  const base: ItemForm = {
    ...emptyItemForm(content.format),
    stem: content.stem,
    skillKey: content.skillKey,
    difficulty: String(content.difficulty),
    media: (content.media ?? []).map((m) => ({ key: m.key, alt: m.alt })),
  };
  if (content.format === 'written') return { ...base, rubricVersionId: content.rubricVersionId };
  const spec = content.paramSpec;
  return {
    ...base,
    options: content.options.map((o) => ({ id: o.id, text: o.text })),
    keyOptionId: content.key?.optionId ?? '',
    parameterised: spec !== undefined,
    spec:
      spec === undefined
        ? emptySpec()
        : {
            params: Object.entries(spec.params).map(([name, def]) =>
              def.kind === 'int'
                ? {
                    name,
                    kind: 'int' as const,
                    min: String(def.min),
                    max: String(def.max),
                    step: String(def.step),
                    values: '',
                  }
                : {
                    name,
                    kind: 'choice' as const,
                    min: '',
                    max: '',
                    step: '',
                    values: def.values.map(String).join(', '),
                  },
            ),
            derived: Object.entries(spec.derived).map(([name, expr]) => ({ name, expr })),
            constraints: [...spec.constraints],
            stem: spec.stem,
            options: spec.options.map((o) => ({ id: o.id, text: o.text })),
            correctOptionId: spec.correctOptionId,
            count: String(spec.count),
          },
  };
}

// ---- Form to draft --------------------------------------------------------------------------------------------------

const WHOLE = /^-?\d+$/;
/** A whole number as a number; anything else stays text, so the contract names it. */
const wholeOrText = (value: string): number | string =>
  WHOLE.test(value.trim()) ? Number(value.trim()) : value;
const DECIMAL = /^\d*\.?\d+$/;
const decimalOrText = (value: string): number | string =>
  DECIMAL.test(value.trim()) ? Number(value.trim()) : value;

function specToWire(spec: SpecForm, errors: FieldError[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const row of spec.params) {
    if (Object.hasOwn(params, row.name)) {
      errors.push({ path: `paramSpec.params.${row.name}`, message: 'Each name can be used once.' });
      continue;
    }
    params[row.name] =
      row.kind === 'int'
        ? {
            kind: 'int',
            min: wholeOrText(row.min),
            max: wholeOrText(row.max),
            step: wholeOrText(row.step),
          }
        : {
            kind: 'choice',
            values: row.values
              .split(',')
              .map((v) => v.trim())
              .filter((v) => v !== '')
              .map(wholeOrText),
          };
  }
  const derived: Record<string, string> = {};
  for (const row of spec.derived) {
    if (Object.hasOwn(derived, row.name)) {
      errors.push({
        path: `paramSpec.derived.${row.name}`,
        message: 'Each name can be used once.',
      });
      continue;
    }
    derived[row.name] = row.expr;
  }
  return {
    params,
    derived,
    constraints: [...spec.constraints],
    stem: spec.stem,
    options: spec.options.map((o) => ({ id: o.id, text: o.text })),
    correctOptionId: spec.correctOptionId,
    count: wholeOrText(spec.count),
  };
}

function wire(form: ItemForm, errors: FieldError[]): Record<string, unknown> {
  const common = {
    format: form.format,
    stem: form.stem,
    skillKey: form.skillKey.trim(),
    difficulty: decimalOrText(form.difficulty),
    ...(form.media.length > 0
      ? { media: form.media.map((m) => ({ key: m.key.trim(), alt: m.alt })) }
      : {}),
  };
  if (form.format === 'written') {
    return { ...common, rubricVersionId: form.rubricVersionId.trim() };
  }
  return {
    ...common,
    options: form.options.map((o) => ({ id: o.id, text: o.text })),
    key: { optionId: form.keyOptionId },
    ...(form.parameterised ? { paramSpec: specToWire(form.spec, errors) } : {}),
  };
}

const MESSAGES: readonly (readonly [RegExp, string])[] = [
  [/^stem$/, 'Write the question (1 to 4000 characters).'],
  [/^key(\.|$)/, 'Choose the correct answer.'],
  [/^difficulty$/, 'Difficulty is a number from 0 to 1 in steps of 0.01.'],
  [/^skillKey$/, 'A skill is lower-case letters, digits and underscores.'],
  [/^rubricVersionId$/, 'A rubric version id looks like 00000000-0000-4000-8000-000000000001.'],
  [/^options\.\d+\.text$/, 'Each option needs text (up to 500 characters).'],
  [/^options$/, 'Give between 2 and 6 options.'],
  [
    /^media\.\d+\.key$/,
    'An image key looks like item-media/<org id>/<sha-256>.png (or jpg, webp).',
  ],
  [/^media\.\d+\.alt$/, 'Alt text is required (up to 300 characters).'],
  [/^media$/, 'Use between 1 and 4 images.'],
  [/^paramSpec\.count$/, 'Choose between 5 and 200 variants.'],
  [/^paramSpec\.stem$/, 'Write the question template (1 to 4000 characters).'],
  [/^paramSpec\.options$/, 'Give between 2 and 6 option templates.'],
  [/^paramSpec\.options\.\d+\.text$/, 'Each option template needs text (up to 500 characters).'],
  [/^paramSpec\.correctOptionId$/, 'Choose the correct option template.'],
  [/^paramSpec\.params\.[^.]+$/, 'Check the range or values of this parameter.'],
  [/^paramSpec\.params\.[^.]+\.(min|max|step)$/, 'Use a whole number (step at least 1).'],
  [/^paramSpec\.params\.[^.]+\.values(\.|$)/, 'Give 1 to 20 values (whole numbers or short text).'],
  [/^paramSpec\.derived\.[^.]+$/, 'Write an expression of at most 200 characters.'],
  [/^paramSpec\.constraints(\.|$)/, 'Write expressions of at most 200 characters (up to 8).'],
];

const BY_CODE: Readonly<Record<string, string>> = {
  invalid_type: 'This is required, or is the wrong kind of value.',
  too_small: 'This is too short or too small.',
  too_big: 'This is too long or too large.',
  invalid_format: 'This is not in the expected format.',
  not_multiple_of: 'Use steps of 0.01.',
  invalid_value: 'This is not an accepted value.',
  invalid_union: 'Check this part of the form.',
  unrecognized_keys: 'Check this part of the form.',
};
/** Sentences the contract wrote for a person (superRefine and refine messages), shown as they are. */
const CONTRACT_SENTENCES: ReadonlySet<string> = new Set([
  'min must not exceed max',
  'unknown option',
  'a derived name repeats a param',
  'option ids must be unique',
  'option ids must be unique and the key must be one of them',
  '1 to 8 params',
  'at most 8 derived values',
]);
const CUSTOM: Readonly<Record<string, string>> = {
  unstorable_text: 'This contains a character that cannot be stored.',
  'reserved name': 'That name is reserved. Use another.',
};

function messageFor(path: string, code: string, message: string): string {
  if (code === 'custom') {
    const fixed = CUSTOM[message];
    if (fixed !== undefined) return fixed;
    if (CONTRACT_SENTENCES.has(message)) return message;
  }
  for (const [pattern, text] of MESSAGES) if (pattern.test(path)) return text;
  return BY_CODE[code] ?? 'Check this value.';
}

/** The draft for the form, or every problem by dotted path (`stem`, `options.1.text`, `paramSpec.count`). */
export function toDraft(form: ItemForm): DraftResult {
  const errors: FieldError[] = [];
  const candidate = wire(form, errors);
  const parsed = BankItemDraft.safeParse(candidate);
  if (parsed.success && errors.length === 0) return { ok: true, draft: parsed.data };
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join('.');
      errors.push({ path, message: messageFor(path, issue.code, issue.message) });
    }
  }
  return { ok: false, errors };
}

/** The first problem at a path. */
export const errorAt = (errors: readonly FieldError[], path: string): string | undefined =>
  errors.find((e) => e.path === path)?.message;

/** Problems at a path or below it, for a block of the form. */
export const errorsUnder = (errors: readonly FieldError[], prefix: string): FieldError[] =>
  errors.filter((e) => e.path === prefix || e.path.startsWith(`${prefix}.`));

// ---- Editing steps ----------------------------------------------------------------------------------------------------

export function nextOptionId(rows: readonly OptionRow[]): string {
  const used = new Set(rows.map((r) => r.id));
  for (let n = 1; ; n += 1) if (!used.has(`o${String(n)}`)) return `o${String(n)}`;
}

export function addOption(form: ItemForm): ItemForm {
  if (form.options.length >= MAX_OPTIONS) return form;
  return { ...form, options: [...form.options, { id: nextOptionId(form.options), text: '' }] };
}

export function removeOption(form: ItemForm, id: string): ItemForm {
  if (form.options.length <= MIN_OPTIONS) return form;
  return {
    ...form,
    options: form.options.filter((o) => o.id !== id),
    keyOptionId: form.keyOptionId === id ? '' : form.keyOptionId,
  };
}

export function addMedia(form: ItemForm): ItemForm {
  if (form.media.length >= MAX_MEDIA) return form;
  return { ...form, media: [...form.media, { key: '', alt: '' }] };
}

const NAMES = 'abcdefghijklmnopqrstuvwxyz';
const freeName = (used: readonly string[]): string =>
  [...NAMES].find((c) => !used.includes(c)) ?? `p${String(used.length)}`;

export function addParam(form: ItemForm): ItemForm {
  if (form.spec.params.length >= MAX_PARAMS) return form;
  const name = freeName([
    ...form.spec.params.map((p) => p.name),
    ...form.spec.derived.map((d) => d.name),
  ]);
  return {
    ...form,
    spec: {
      ...form.spec,
      params: [
        ...form.spec.params,
        { name, kind: 'int', min: '1', max: '9', step: '1', values: '' },
      ],
    },
  };
}

export function addDerived(form: ItemForm): ItemForm {
  if (form.spec.derived.length >= MAX_DERIVED) return form;
  const name = `d${String(form.spec.derived.length + 1)}`;
  return {
    ...form,
    spec: { ...form.spec, derived: [...form.spec.derived, { name, expr: '' }] },
  };
}

export function addConstraint(form: ItemForm): ItemForm {
  if (form.spec.constraints.length >= MAX_CONSTRAINTS) return form;
  return { ...form, spec: { ...form.spec, constraints: [...form.spec.constraints, ''] } };
}

export function addSpecOption(form: ItemForm): ItemForm {
  if (form.spec.options.length >= MAX_OPTIONS) return form;
  return {
    ...form,
    spec: {
      ...form.spec,
      options: [...form.spec.options, { id: nextOptionId(form.spec.options), text: '' }],
    },
  };
}

export function removeSpecOption(form: ItemForm, id: string): ItemForm {
  if (form.spec.options.length <= MIN_OPTIONS) return form;
  return {
    ...form,
    spec: {
      ...form.spec,
      options: form.spec.options.filter((o) => o.id !== id),
      correctOptionId: form.spec.correctOptionId === id ? '' : form.spec.correctOptionId,
    },
  };
}

/** Starts the templates from the item's own stem, options and answer; the author then adds `{{name}}` places. */
export function seedSpecFromItem(form: ItemForm): ItemForm {
  return {
    ...form,
    spec: {
      ...form.spec,
      stem: form.stem,
      options: form.options.map((o) => ({ ...o })),
      correctOptionId: form.keyOptionId,
    },
  };
}
