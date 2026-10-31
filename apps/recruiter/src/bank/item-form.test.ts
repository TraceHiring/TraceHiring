// The item editor's model (specs/m1-test-authoring.md §6.2, §6.3; contracts BankItemDraft, ParamSpec): a form of text
// fields becomes a BankItemDraft or a list of problems by path. The app never generates variants; the api does.
import { describe, expect, it } from 'vitest';
import {
  addMedia,
  addOption,
  addParam,
  emptyItemForm,
  errorAt,
  formFromDetail,
  nextOptionId,
  removeOption,
  seedSpecFromItem,
  toDraft,
  type ItemForm,
} from './item-form';
import { MEDIA_KEY, PARAM_SPEC, mcqDetail, writtenDetail } from './testing/fixtures.test-helpers';

function filled(patch: Partial<ItemForm> = {}): ItemForm {
  return {
    ...emptyItemForm('mcq'),
    stem: '[synthetic] Which number is even?',
    options: [
      { id: 'o1', text: '3' },
      { id: 'o2', text: '4' },
    ],
    keyOptionId: 'o2',
    skillKey: 'quant',
    difficulty: '0.35',
    ...patch,
  };
}

describe('emptyItemForm', () => {
  it('starts an MCQ with two empty options and no answer chosen', () => {
    const form = emptyItemForm('mcq');
    expect(form.options.map((o) => o.id)).toEqual(['o1', 'o2']);
    expect(form.keyOptionId).toBe('');
    expect(form.parameterised).toBe(false);
    expect(form.media).toEqual([]);
  });
});

describe('toDraft', () => {
  it('builds an MCQ draft with a numeric difficulty and no optional parts', () => {
    expect(toDraft(filled())).toEqual({
      ok: true,
      draft: {
        format: 'mcq',
        stem: '[synthetic] Which number is even?',
        options: [
          { id: 'o1', text: '3' },
          { id: 'o2', text: '4' },
        ],
        key: { optionId: 'o2' },
        skillKey: 'quant',
        difficulty: 0.35,
      },
    });
  });

  it('builds a written draft from its rubric version', () => {
    const result = toDraft({
      ...emptyItemForm('written'),
      stem: '[synthetic] Describe a polite way to end a call.',
      rubricVersionId: '00000000-0000-4000-8000-000000000042',
      skillKey: 'written_communication',
      difficulty: '0.5',
    });
    expect(result).toEqual({
      ok: true,
      draft: {
        format: 'written',
        stem: '[synthetic] Describe a polite way to end a call.',
        rubricVersionId: '00000000-0000-4000-8000-000000000042',
        skillKey: 'written_communication',
        difficulty: 0.5,
      },
    });
  });

  it('carries images by key with their alt text', () => {
    const result = toDraft(filled({ media: [{ key: MEDIA_KEY, alt: 'A synthetic chart' }] }));
    expect(result.ok && result.draft.media).toEqual([{ key: MEDIA_KEY, alt: 'A synthetic chart' }]);
  });

  it('names each problem by path with a fixed sentence', () => {
    const result = toDraft(
      filled({
        stem: '',
        keyOptionId: '',
        difficulty: '1.5',
        skillKey: 'Not A Key',
        options: [
          { id: 'o1', text: '3' },
          { id: 'o2', text: '' },
        ],
        media: [{ key: 'item-media/bad', alt: '' }],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(errorAt(result.errors, 'stem')).toBe('Write the question (1 to 4000 characters).');
    expect(errorAt(result.errors, 'key.optionId')).toBe('Choose the correct answer.');
    expect(errorAt(result.errors, 'difficulty')).toBe(
      'Difficulty is a number from 0 to 1 in steps of 0.01.',
    );
    expect(errorAt(result.errors, 'skillKey')).toBe(
      'A skill is lower-case letters, digits and underscores.',
    );
    expect(errorAt(result.errors, 'options.1.text')).toBe(
      'Each option needs text (up to 500 characters).',
    );
    expect(errorAt(result.errors, 'media.0.key')).toBe(
      'An image key looks like item-media/<org id>/<sha-256>.png (or jpg, webp).',
    );
    expect(errorAt(result.errors, 'media.0.alt')).toBe(
      'Alt text is required (up to 300 characters).',
    );
  });

  it('refuses text that is not a number as a difficulty without throwing', () => {
    const result = toDraft(filled({ difficulty: 'hard' }));
    expect(result.ok).toBe(false);
  });

  it('refuses a written item with a malformed rubric version id', () => {
    const result = toDraft({
      ...emptyItemForm('written'),
      stem: 'x',
      rubricVersionId: 'nope',
      skillKey: 'quant',
      difficulty: '0.1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(errorAt(result.errors, 'rubricVersionId')).toBe(
        'A rubric version id looks like 00000000-0000-4000-8000-000000000001.',
      );
    }
  });
});

describe('the parameter spec (ABH-7)', () => {
  const base = (): ItemForm => formFromDetail(mcqDetail(1, {}, { paramSpec: PARAM_SPEC }));

  it('round-trips a detail with a parameter spec into the same draft content', () => {
    const detail = mcqDetail(1, { isParameterised: true }, { paramSpec: PARAM_SPEC });
    const form = formFromDetail(detail);
    expect(form.parameterised).toBe(true);
    const result = toDraft(form);
    expect(result.ok).toBe(true);
    if (result.ok && result.draft.format === 'mcq') {
      expect(result.draft.paramSpec).toEqual(PARAM_SPEC);
    }
  });

  it('builds choice parameters from comma-separated values, whole numbers as numbers', () => {
    const form = base();
    form.spec.params = [
      ...form.spec.params,
      { name: 'unit', kind: 'choice', min: '', max: '', step: '', values: '3, 5, apples' },
    ];
    const result = toDraft(form);
    expect(
      result.ok && result.draft.format === 'mcq' && result.draft.paramSpec?.params['unit'],
    ).toEqual({
      kind: 'choice',
      values: [3, 5, 'apples'],
    });
  });

  it('names a spec problem by its path', () => {
    const form = base();
    form.spec.count = '3';
    const result = toDraft(form);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(errorAt(result.errors, 'paramSpec.count')).toBe('Choose between 5 and 200 variants.');
  });

  it('names a parameter whose minimum is above its maximum', () => {
    const form = base();
    form.spec.params = form.spec.params.map((p) => (p.name === 'a' ? { ...p, min: '20' } : p));
    const result = toDraft(form);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(errorAt(result.errors, 'paramSpec.params.a')).toBe('min must not exceed max');
  });

  it('names an unknown correct option and a derived value that repeats a parameter', () => {
    const form = base();
    form.spec.correctOptionId = 'zz';
    form.spec.derived = [{ name: 'a', expr: 'a + 1' }];
    const result = toDraft(form);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(errorAt(result.errors, 'paramSpec.correctOptionId')).toBe('unknown option');
    expect(errorAt(result.errors, 'paramSpec.derived')).toBe('a derived name repeats a param');
  });

  it('names a repeated parameter name before the contract can merge the rows', () => {
    const form = base();
    form.spec.params = [...form.spec.params, ...form.spec.params.slice(0, 1)];
    const result = toDraft(form);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(errorAt(result.errors, 'paramSpec.params.a')).toBe('Each name can be used once.');
  });

  it('refuses a reserved parameter name', () => {
    const form = base();
    form.spec.params = [{ ...form.spec.params[0]!, name: 'constructor' }];
    const result = toDraft(form);
    expect(result.ok).toBe(false);
  });

  it('is left out of the draft while the item is fixed', () => {
    const form = { ...base(), parameterised: false };
    const result = toDraft(form);
    expect(result.ok && 'paramSpec' in result.draft).toBe(false);
  });
});

describe('formFromDetail', () => {
  it('reads a written item with its rubric version id', () => {
    const form = formFromDetail(writtenDetail(2));
    expect(form.format).toBe('written');
    expect(form.rubricVersionId).toBe('00000000-0000-4000-8000-000000009002');
  });

  it('reads a library-sourced MCQ, whose key and spec the api never sends, as having none', () => {
    const detail = mcqDetail(3, { origin: 'library', librarySourced: true, status: 'approved' });
    const content = { ...detail.content } as Record<string, unknown>;
    delete content['key'];
    const form = formFromDetail({ ...detail, content } as typeof detail);
    expect(form.keyOptionId).toBe('');
    expect(form.parameterised).toBe(false);
  });
});

describe('editing steps', () => {
  it('numbers new options after the ones in use and stops at six', () => {
    let form = emptyItemForm('mcq');
    expect(nextOptionId(form.options)).toBe('o3');
    for (let i = 0; i < 10; i += 1) form = addOption(form);
    expect(form.options).toHaveLength(6);
    expect(new Set(form.options.map((o) => o.id)).size).toBe(6);
  });

  it('removing the chosen option clears the answer, and two options always remain', () => {
    let form = { ...filled(), options: [...filled().options, { id: 'o3', text: 'x' }] };
    form = removeOption(form, 'o2');
    expect(form.keyOptionId).toBe('');
    expect(form.options.map((o) => o.id)).toEqual(['o1', 'o3']);
    expect(removeOption(form, 'o1').options).toHaveLength(2);
  });

  it('allows up to four images and eight parameters', () => {
    let form = emptyItemForm('mcq');
    for (let i = 0; i < 6; i += 1) form = addMedia(form);
    expect(form.media).toHaveLength(4);
    for (let i = 0; i < 10; i += 1) form = addParam(form);
    expect(form.spec.params).toHaveLength(8);
    expect(new Set(form.spec.params.map((p) => p.name)).size).toBe(8);
  });

  it('copies the stem, options and answer into the spec as a starting point', () => {
    const form = seedSpecFromItem(filled());
    expect(form.spec.stem).toBe('[synthetic] Which number is even?');
    expect(form.spec.options).toEqual([
      { id: 'o1', text: '3' },
      { id: 'o2', text: '4' },
    ]);
    expect(form.spec.correctOptionId).toBe('o2');
  });
});
