// The test editor's pure model (specs/d1-demo-slice.md §6.1, L-15): the Answer Quality cutoff is mandatory (default
// 40) and cannot be cleared; at most 10 items; the request always passes the shared contract.
import { UpdateTestDraftRequest } from '@trace/shared/contracts/d1';
import { TestDraftView } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import {
  MAX_ITEMS,
  addCriterion,
  addMcqItem,
  addOption,
  addWrittenItem,
  d1Editable,
  emptyDraft,
  fromDetail,
  isCutoffValid,
  itemCount,
  removeItem,
  removeOption,
  setCutoffInput,
  toRequest,
  type DraftForm,
} from './editor-model';

const filled = (): DraftForm => {
  let form = emptyDraft('Synthetic test');
  form = addMcqItem(form);
  form = addWrittenItem(form);
  const mcq = form.mcq.items[0];
  const written = form.written.items[0];
  if (mcq?.format !== 'mcq' || written?.format !== 'written') throw new Error('fixture');
  form.mcq.items[0] = {
    ...mcq,
    prompt: 'What is 2 + 2?',
    options: [
      { id: 'o1', text: '3' },
      { id: 'o2', text: '4' },
    ],
    correctOptionId: 'o2',
  };
  form.written.items[0] = {
    ...written,
    prompt: 'Explain a queue.',
    criteria: [
      { id: 'c1', label: 'Mentions FIFO', maxPoints: '10', anchors: 'fifo, order', minHits: '1' },
    ],
  };
  return form;
};

describe('cutoff', () => {
  it('starts at the editor default of 40', () => {
    expect(emptyDraft('x').qualityCutoff).toBe('40');
  });

  it('cannot be cleared or set to anything but an integer 0-100', () => {
    expect(setCutoffInput('40', '')).toBe('40');
    expect(setCutoffInput('40', ' ')).toBe('40');
    expect(setCutoffInput('40', 'abc')).toBe('40');
    expect(setCutoffInput('40', '101')).toBe('40');
    expect(setCutoffInput('40', '-1')).toBe('40');
    expect(setCutoffInput('40', '4.5')).toBe('40');
    expect(setCutoffInput('40', '0')).toBe('0');
    expect(setCutoffInput('40', '100')).toBe('100');
    expect(setCutoffInput('40', '55')).toBe('55');
  });

  it('isCutoffValid accepts only integers 0-100', () => {
    for (const ok of ['0', '40', '100']) expect(isCutoffValid(ok)).toBe(true);
    for (const bad of ['', '-1', '101', '4.5', 'x', ' 5']) expect(isCutoffValid(bad)).toBe(false);
  });

  it('no request is built with an invalid or missing cutoff', () => {
    const form = { ...filled(), qualityCutoff: '' };
    expect(toRequest(form).ok).toBe(false);
    expect(toRequest({ ...form, qualityCutoff: '101' }).ok).toBe(false);
  });
});

describe('items', () => {
  it('allows at most 10 items across both sections', () => {
    let form = emptyDraft('x');
    for (let i = 0; i < 20; i += 1) form = i % 2 === 0 ? addMcqItem(form) : addWrittenItem(form);
    expect(itemCount(form)).toBe(MAX_ITEMS);
    expect(MAX_ITEMS).toBe(10);
  });

  it('removing an item frees a slot', () => {
    let form = emptyDraft('x');
    for (let i = 0; i < 10; i += 1) form = addMcqItem(form);
    form = removeItem(form, 'mcq', 0);
    expect(itemCount(form)).toBe(9);
  });

  it('an MCQ item keeps 2 to 6 options', () => {
    let form = addMcqItem(emptyDraft('x'));
    for (let i = 0; i < 10; i += 1) form = addOption(form, 0);
    const item = form.mcq.items[0];
    expect(item?.format === 'mcq' ? item.options.length : 0).toBe(6);
    for (let i = 0; i < 10; i += 1) form = removeOption(form, 0, 0);
    const after = form.mcq.items[0];
    expect(after?.format === 'mcq' ? after.options.length : 0).toBe(2);
  });

  it('a written item keeps at most 8 criteria', () => {
    let form = addWrittenItem(emptyDraft('x'));
    for (let i = 0; i < 12; i += 1) form = addCriterion(form, 0);
    const item = form.written.items[0];
    expect(item?.format === 'written' ? item.criteria.length : 0).toBe(8);
  });
});

describe('toRequest', () => {
  it('builds a request that passes the shared contract', () => {
    const built = toRequest(filled());
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(UpdateTestDraftRequest.safeParse(built.request).success).toBe(true);
      expect(built.request.qualityCutoff).toBe(40);
      expect(built.request.sections.map((s) => s.format)).toEqual(['mcq', 'written']);
    }
  });

  it('an item without a prompt or a key is refused', () => {
    const form = filled();
    const mcq = form.mcq.items[0];
    if (mcq?.format !== 'mcq') throw new Error('fixture');
    form.mcq.items[0] = { ...mcq, correctOptionId: 'missing' };
    expect(toRequest(form).ok).toBe(false);
  });

  it('round-trips a stored draft (the TestDraftView the api answers, R5-53 a)', () => {
    const detail = TestDraftView.parse(view());
    const form = fromDetail(detail);
    expect(form.qualityCutoff).toBe('55');
    expect(form.mcq.weight).toBe('40');
    expect(itemCount(form)).toBe(1);
    expect(toRequest(form).ok).toBe(true);
  });
});

/** A stored draft as `GET …/tests/:testId` answers it (TestDraftView): one inline mcq section, as D1 writes it. */
function view(patch: Record<string, unknown> = {}, sections?: unknown[]) {
  return {
    test: {
      id: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000009',
      name: 'T',
      createdAt: '2026-10-19T10:00:00.000Z',
    },
    version: {
      id: '00000000-0000-4000-8000-000000000002',
      versionNo: 1,
      status: 'draft',
      durationMinutes: 30,
      qualityCutoff: 55,
      publishedAt: null,
      sections: sections ?? [section()],
      ...patch,
    },
  };
}
function section(patch: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    position: 1,
    mode: 'inline',
    name: 'Multiple choice',
    format: 'mcq',
    weight: 40,
    items: [
      {
        id: '00000000-0000-4000-8000-000000000004',
        position: 1,
        format: 'mcq',
        prompt: 'Q?',
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
        correctOptionId: 'a',
      },
    ],
    shuffleItems: false,
    shuffleOptions: false,
    navigation: null,
    ...patch,
  };
}

describe('the D1 editor on the M1 read-model (R5-53 a, A2b fix round 1 #3)', () => {
  it('loads inline sections into the D1 form: names, weights, items, keys and rubrics', () => {
    const written = section({
      id: '00000000-0000-4000-8000-000000000005',
      position: 2,
      name: 'Writing',
      format: 'written',
      weight: 60,
      navigation: 'forward_only',
      pasteRule: 'blocked',
      items: [
        {
          id: '00000000-0000-4000-8000-000000000006',
          position: 1,
          format: 'written',
          prompt: 'Describe it.',
          rubric: {
            criteria: [{ id: 'c1', label: 'Clear', maxPoints: 4, anchors: ['a', 'b'], minHits: 1 }],
          },
        },
      ],
    });
    const detail = TestDraftView.parse(view({}, [section({ navigation: 'free' }), written]));
    const form = fromDetail(detail);
    expect(form.name).toBe('T');
    expect([form.mcq.name, form.mcq.weight, form.written.name, form.written.weight]).toEqual([
      'Multiple choice',
      '40',
      'Writing',
      '60',
    ]);
    expect(form.written.items[0]).toEqual({
      format: 'written',
      prompt: 'Describe it.',
      criteria: [{ id: 'c1', label: 'Clear', maxPoints: '4', anchors: 'a, b', minHits: '1' }],
    });
    expect(toRequest(form)).toMatchObject({ ok: true });
  });

  it('the D1 editor edits only a D1-shaped draft: inline, unshuffled, untimed, one section per format', () => {
    expect(d1Editable(TestDraftView.parse(view()))).toBe(true);
    // R5-63 b: a draft with settings stores the default navigation; still D1-shaped.
    expect(d1Editable(TestDraftView.parse(view({}, [section({ navigation: 'free' })])))).toBe(true);
    for (const other of [
      section({
        mode: 'pool',
        items: [],
        poolId: '00000000-0000-4000-8000-000000000007',
        drawCount: 2,
        navigation: 'free',
      }),
      section({ navigation: 'free', shuffleItems: true }),
      section({ navigation: 'free', timeLimitSeconds: 600 }),
      section({ navigation: 'forward_only' }),
    ]) {
      expect(d1Editable(TestDraftView.parse(view({}, [other])))).toBe(false);
    }
    const twoMcq = view({}, [
      section(),
      section({ id: '00000000-0000-4000-8000-000000000008', position: 2 }),
    ]);
    expect(d1Editable(TestDraftView.parse(twoMcq))).toBe(false);
  });
});
