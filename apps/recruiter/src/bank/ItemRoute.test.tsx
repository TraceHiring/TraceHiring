// @vitest-environment happy-dom
// `/bank/items/new` and `/bank/items/:itemId` (specs/m1-test-authoring.md §3.3, §4.1, §6.2, §6.3, §6.11; I-M1-5,
// SEC-M1-1, R5-22): create, edit a draft, submit for review, approve or send back, retire, edit as a new version.
// A reviewer reads and approves but never edits; a library item shows no key and no parameter spec.
import { afterEach, describe, expect, it } from 'vitest';
import { ItemRoute } from './ItemRoute';
import { failure, fakeApi, info, USER_ID, type FakeCall } from './testing/api.test-helpers';
import { mountScreen, pick, type Mounted } from './testing/dom.test-helpers';
import {
  MEDIA_KEY,
  PARAM_SPEC,
  mcqDetail,
  uid,
  writtenDetail,
} from './testing/fixtures.test-helpers';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const ITEM = mcqDetail(1);
const routes = (api: ReturnType<typeof fakeApi>['api'], at: string, roles: string[]) =>
  mountScreen(<ItemRoute />, {
    api,
    info: info(...roles),
    at,
    path: '/bank/items/:itemId',
    extra: [{ path: '/bank/items/new', element: <ItemRoute /> }],
  });
const createRoutes = (api: ReturnType<typeof fakeApi>['api'], roles: string[] = ['recruiter']) =>
  mountScreen(<ItemRoute />, {
    api,
    info: info(...roles),
    at: '/bank/items/new',
    path: '/bank/items/new',
    extra: [{ path: '/bank/items/:itemId', element: <ItemRoute /> }],
  });

const optionInputs = (m: Mounted) => [...m.container.querySelectorAll('input[name="key"]')];

async function fillMcq(m: Mounted): Promise<void> {
  await m.type(m.field('Question'), '[synthetic] Which number is even?');
  await m.type(m.field('Option 1'), '3');
  await m.type(m.field('Option 2'), '4');
  await m.choose(optionInputs(m)[1]!, '');
  await m.type(m.field('Skill'), 'quant');
  await m.type(m.field('Difficulty'), '0.35');
}

describe('creating an item', () => {
  it('shows the heading and an empty MCQ form with a Create draft button', async () => {
    const { api } = fakeApi(() => undefined);
    mounted = await createRoutes(api);
    const text = mounted.text();
    expect(text).toContain('Item');
    expect(mounted.field('Question')).toBeTruthy();
    expect(optionInputs(mounted)).toHaveLength(2);
    expect(mounted.button('Create draft')).toBeTruthy();
    expect(mounted.maybeButton('Submit for review')).toBeNull();
  });

  it('posts the draft and opens the new item', async () => {
    const created = mcqDetail(7);
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'POST' && call.path === '/bank/items')
        return { status: 201, body: created };
      if (call.path === `/bank/items/${created.itemId}`) return { body: created };
      return undefined;
    });
    mounted = await createRoutes(api);
    await fillMcq(mounted);
    await mounted.submit(pick(mounted.container, 'form'));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({
      format: 'mcq',
      stem: '[synthetic] Which number is even?',
      options: [
        { id: 'o1', text: '3' },
        { id: 'o2', text: '4' },
      ],
      key: { optionId: 'o2' },
      skillKey: 'quant',
      difficulty: 0.35,
    });
    expect(calls.some((c) => c.path === `/bank/items/${created.itemId}`)).toBe(true);
    expect(mounted.text()).toContain('[synthetic] What is 7 plus 7?');
  });

  it('names each problem next to its field and sends nothing', async () => {
    const { api, calls } = fakeApi(() => undefined);
    mounted = await createRoutes(api);
    await mounted.submit(pick(mounted.container, 'form'));
    expect(calls).toHaveLength(0);
    const text = mounted.text();
    expect(text).toContain('Write the question (1 to 4000 characters).');
    expect(text).toContain('Choose the correct answer.');
    expect(text).toContain('A skill is lower-case letters, digits and underscores.');
    expect(text).toContain('Difficulty is a number from 0 to 1 in steps of 0.01.');
  });

  it('shows a fixed sentence when the api refuses, never its text', async () => {
    const { api } = fakeApi(() => failure(400, 'bad_request'));
    mounted = await createRoutes(api);
    await fillMcq(mounted);
    await mounted.submit(pick(mounted.container, 'form'));
    expect(mounted.text()).toContain('Some values were not accepted. Check the form.');
  });

  it('adds and removes options within two to six, dropping a removed answer', async () => {
    const { api } = fakeApi(() => undefined);
    mounted = await createRoutes(api);
    for (let i = 0; i < 6; i += 1) await mounted.click(mounted.button('Add option'));
    expect(optionInputs(mounted)).toHaveLength(6);
    expect(mounted.maybeButton('Add option')?.disabled).toBe(true);
    await mounted.choose(optionInputs(mounted)[2]!, '');
    await mounted.click(mounted.button('Remove option 3'));
    expect(optionInputs(mounted)).toHaveLength(5);
    expect(optionInputs(mounted).some((el) => (el as HTMLInputElement).checked)).toBe(false);
  });

  it('switches to a written item: a rubric version id instead of options', async () => {
    const { api, calls } = fakeApi(() => ({ status: 201, body: writtenDetail(8) }));
    mounted = await createRoutes(api);
    await mounted.choose(mounted.field('Written'), '');
    expect(optionInputs(mounted)).toHaveLength(0);
    await mounted.type(mounted.field('Question'), '[synthetic] Describe a polite goodbye.');
    await mounted.type(mounted.field('Rubric version id'), uid(42));
    await mounted.type(mounted.field('Skill'), 'written_communication');
    await mounted.type(mounted.field('Difficulty'), '0.5');
    await mounted.submit(pick(mounted.container, 'form'));
    expect(calls[0]?.body).toEqual({
      format: 'written',
      stem: '[synthetic] Describe a polite goodbye.',
      rubricVersionId: uid(42),
      skillKey: 'written_communication',
      difficulty: 0.5,
    });
  });

  it('takes images by stored key with required alt text', async () => {
    const { api, calls } = fakeApi(() => ({ status: 201, body: mcqDetail(9) }));
    mounted = await createRoutes(api);
    await fillMcq(mounted);
    await mounted.click(mounted.button('Add image'));
    await mounted.type(mounted.field('Image key 1'), MEDIA_KEY);
    await mounted.submit(pick(mounted.container, 'form'));
    expect(calls).toHaveLength(0);
    expect(mounted.text()).toContain('Alt text is required (up to 300 characters).');
    await mounted.type(mounted.field('Alt text 1'), 'A synthetic bar chart');
    await mounted.submit(pick(mounted.container, 'form'));
    expect((calls[0]?.body as { media?: unknown }).media).toEqual([
      { key: MEDIA_KEY, alt: 'A synthetic bar chart' },
    ]);
  });
});

describe('the parameter spec editor (ABH-7)', () => {
  it('appears for a parameterised item, says the api makes the variants, and sends the spec', async () => {
    const { api, calls } = fakeApi(() => ({ status: 201, body: mcqDetail(9) }));
    mounted = await createRoutes(api);
    await fillMcq(mounted);
    expect(mounted.maybeButton('Add parameter')).toBeNull();
    await mounted.choose(mounted.field('Parameterised'), '');
    expect(mounted.text()).toContain('The server makes the variants when the item goes to review.');
    await mounted.click(mounted.button('Copy the question and options into the spec'));
    await mounted.type(mounted.field('Question template'), '[synthetic] Add {{a}} and 1.');
    await mounted.type(mounted.field('Option template 1'), '{{a}}');
    await mounted.type(mounted.field('Option template 2'), '{{a}} plus one');
    await mounted.choose(mounted.container.querySelectorAll('input[name="spec-key"]')[0]!, '');
    await mounted.submit(pick(mounted.container, 'form'));
    expect((calls[0]?.body as { paramSpec?: unknown }).paramSpec).toEqual({
      params: { a: { kind: 'int', min: 1, max: 9, step: 1 } },
      derived: {},
      constraints: [],
      stem: '[synthetic] Add {{a}} and 1.',
      options: [
        { id: 'o1', text: '{{a}}' },
        { id: 'o2', text: '{{a}} plus one' },
      ],
      correctOptionId: 'o1',
      count: 20,
    });
  });

  it('shows validation errors by path and sends nothing until they are fixed', async () => {
    const { api, calls } = fakeApi(() => ({ status: 201, body: mcqDetail(9) }));
    mounted = await createRoutes(api);
    await fillMcq(mounted);
    await mounted.choose(mounted.field('Parameterised'), '');
    await mounted.type(mounted.field('Number of variants'), '3');
    await mounted.submit(pick(mounted.container, 'form'));
    expect(calls).toHaveLength(0);
    const text = mounted.text();
    expect(text).toContain('paramSpec.count');
    expect(text).toContain('Choose between 5 and 200 variants.');
    expect(text).toContain('paramSpec.stem');
  });

  it('adds and removes parameters, derived values and constraints within their caps', async () => {
    const { api } = fakeApi(() => undefined);
    mounted = await createRoutes(api);
    await mounted.choose(mounted.field('Parameterised'), '');
    for (let i = 0; i < 9; i += 1) await mounted.click(mounted.button('Add parameter'));
    expect(mounted.container.querySelectorAll('[data-param-row]')).toHaveLength(8);
    expect(mounted.button('Add parameter').disabled).toBe(true);
    await mounted.click(mounted.button('Add derived value'));
    await mounted.click(mounted.button('Add constraint'));
    expect(mounted.field('Constraint 1')).toBeTruthy();
    await mounted.click(mounted.button('Remove constraint 1'));
    expect(mounted.maybeButton('Remove constraint 1')).toBeNull();
  });

  it('shows a choice parameter as comma-separated values', async () => {
    const { api } = fakeApi(() => undefined);
    mounted = await createRoutes(api);
    await mounted.choose(mounted.field('Parameterised'), '');
    await mounted.choose(mounted.field('Parameter 1 kind'), 'choice');
    expect(mounted.field('Parameter 1 values')).toBeTruthy();
    expect(mounted.container.querySelector('label span')).toBeTruthy();
  });
});

describe('a draft (staff)', () => {
  function draftApi(extra?: (call: FakeCall) => ReturnType<Parameters<typeof fakeApi>[0]>) {
    const state = { current: mcqDetail(1) };
    return {
      state,
      ...fakeApi((call) => {
        const custom = extra?.(call);
        if (custom !== undefined) return custom;
        if (call.method === 'GET' && call.path === `/bank/items/${ITEM.itemId}`) {
          return { body: state.current };
        }
        if (call.method === 'PUT' && call.path === `/bank/items/${ITEM.itemId}`) {
          state.current = mcqDetail(1, {}, { stem: (call.body as { stem: string }).stem });
          return { body: state.current };
        }
        if (call.path === `/bank/item-versions/${ITEM.itemVersionId}/submit`) {
          state.current = mcqDetail(1, { status: 'in_review' });
          return { body: state.current };
        }
        return undefined;
      }),
    };
  }

  it('loads into the editor with the saved values', async () => {
    const { api } = draftApi();
    mounted = await routes(api, `/bank/items/${ITEM.itemId}`, ['recruiter']);
    expect((mounted.field('Question') as HTMLTextAreaElement).value).toBe(
      '[synthetic] What is 1 plus 1?',
    );
    expect((mounted.field('Skill') as HTMLInputElement).value).toBe('quant');
    expect((mounted.field('Difficulty') as HTMLInputElement).value).toBe('0.4');
    expect(mounted.text()).toContain('Draft');
    const checked = optionInputs(mounted).map((el) => (el as HTMLInputElement).checked);
    expect(checked).toEqual([false, true, false]);
  });

  it('saves with PUT, then submits for review once nothing is unsaved', async () => {
    const { api, calls } = draftApi();
    mounted = await routes(api, `/bank/items/${ITEM.itemId}`, ['recruiter']);
    expect(mounted.button('Submit for review').disabled).toBe(false);
    await mounted.type(mounted.field('Question'), '[synthetic] Changed question');
    expect(mounted.button('Submit for review').disabled).toBe(true);
    expect(mounted.text()).toContain('Save your changes before submitting.');
    await mounted.click(mounted.button('Save draft'));
    const put = calls.find((c) => c.method === 'PUT');
    expect((put?.body as { stem: string }).stem).toBe('[synthetic] Changed question');
    expect(put?.body).not.toHaveProperty('workspaceId');
    expect(mounted.text()).toContain('Saved.');
    await mounted.click(mounted.button('Submit for review'));
    expect(calls.some((c) => c.path === `/bank/item-versions/${ITEM.itemVersionId}/submit`)).toBe(
      true,
    );
    expect(mounted.text()).toContain('In review');
    expect(mounted.maybeButton('Save draft')).toBeNull();
  });

  it('shows the fixed sentence when submitting fails', async () => {
    const { api } = draftApi((call) =>
      call.path.endsWith('/submit') ? failure(400, 'variant_generation_failed') : undefined,
    );
    mounted = await routes(api, `/bank/items/${ITEM.itemId}`, ['recruiter']);
    await mounted.click(mounted.button('Submit for review'));
    expect(mounted.text()).toContain(
      'The parameter spec could not produce enough different variants. Widen its ranges.',
    );
  });

  it('is read-only for a reviewer: the content, no form and no save', async () => {
    const { api } = draftApi();
    mounted = await routes(api, `/bank/items/${ITEM.itemId}`, ['reviewer']);
    expect(mounted.text()).toContain('[synthetic] What is 1 plus 1?');
    expect(mounted.container.querySelector('form')).toBeNull();
    expect(mounted.maybeButton('Save draft')).toBeNull();
    expect(mounted.maybeButton('Submit for review')).toBeNull();
    expect(mounted.maybeButton('Approve')).toBeNull();
  });

  it('keeps the heading and a fixed sentence when the item is not found', async () => {
    const { api } = fakeApi(() => undefined);
    mounted = await routes(api, `/bank/items/${ITEM.itemId}`, ['recruiter']);
    expect(mounted.text()).toContain('Item');
    expect(mounted.text()).toContain('Not found, or you do not have access.');
  });

  it('keeps the heading with no signed-in api', async () => {
    mounted = await routes(null as never, `/bank/items/${ITEM.itemId}`, ['recruiter']);
    expect(mounted.text()).toContain('Item');
  });
});

describe('an item in review', () => {
  const inReview = mcqDetail(2, { status: 'in_review', createdBy: uid(55) });
  function reviewApi(detail = inReview) {
    return fakeApi((call) => {
      if (call.method === 'GET') return { body: detail };
      if (call.path === `/bank/item-versions/${detail.itemVersionId}/review`) {
        const decision = (call.body as { decision: string }).decision;
        return {
          body: mcqDetail(2, {
            status: decision === 'approve' ? 'approved' : 'not_approved',
            createdBy: uid(55),
          }),
        };
      }
      return undefined;
    });
  }

  it('lets a reviewer approve, posting the version id and the decision', async () => {
    const { api, calls } = reviewApi();
    mounted = await routes(api, `/bank/items/${inReview.itemId}`, ['reviewer']);
    expect(mounted.text()).toContain('Correct answer');
    await mounted.click(mounted.button('Approve'));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ itemVersionId: inReview.itemVersionId, decision: 'approve' });
    expect(mounted.text()).toContain('Approved');
    expect(mounted.maybeButton('Approve')).toBeNull();
  });

  it('lets an approver send it back', async () => {
    const { api, calls } = reviewApi();
    mounted = await routes(api, `/bank/items/${inReview.itemId}`, ['reviewer']);
    await mounted.click(mounted.button('Send back'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      itemVersionId: inReview.itemVersionId,
      decision: 'not_approved',
    });
    expect(mounted.text()).toContain('Sent back');
  });

  it('says that self-approval is logged when the approver wrote the item', async () => {
    const own = mcqDetail(2, { status: 'in_review', createdBy: USER_ID });
    const { api } = reviewApi(own);
    mounted = await routes(api, `/bank/items/${own.itemId}`, ['recruiter']);
    expect(mounted.text()).toContain('self-approval is logged');
    const other = reviewApi();
    mounted.unmount();
    mounted = await routes(other.api, `/bank/items/${inReview.itemId}`, ['recruiter']);
    expect(mounted.text()).not.toContain('self-approval');
  });

  it('shows the AI draft badge and the origin, never a likeness score or model details', async () => {
    const draft = mcqDetail(3, { status: 'in_review', origin: 'ai_draft', createdBy: uid(55) });
    const { api } = reviewApi(draft);
    mounted = await routes(api, `/bank/items/${draft.itemId}`, ['reviewer']);
    expect(mounted.text()).toContain('AI draft — needs approval');
    expect(mounted.text()).not.toMatch(/model|likeness|score|detect/i);
  });
});

describe('an approved item', () => {
  const approved = mcqDetail(4, { status: 'approved', exposureCount: 12 });
  function approvedApi() {
    return fakeApi((call) => {
      if (call.method === 'GET') return { body: approved };
      if (call.path === `/bank/item-versions/${approved.itemVersionId}/retire`) {
        return { body: mcqDetail(4, { status: 'retired' }) };
      }
      if (call.path === `/bank/items/${approved.itemId}/versions`) {
        return { status: 201, body: mcqDetail(4, { versionNo: 2, status: 'draft' }) };
      }
      return undefined;
    });
  }

  it('shows the content, the key, the approval and the times served to staff with Retire', async () => {
    const { api } = approvedApi();
    mounted = await routes(api, `/bank/items/${approved.itemId}`, ['recruiter']);
    const text = mounted.text();
    expect(text).toContain('Approved');
    expect(text).toContain('Correct answer');
    expect(text).toContain('Times served: 12');
    expect(text).toContain('Version 1');
    expect(mounted.button('Retire')).toBeTruthy();
    expect(mounted.button('Edit as new version')).toBeTruthy();
    expect(mounted.container.querySelector('form')).toBeNull();
  });

  it('retires the version', async () => {
    const { api, calls } = approvedApi();
    mounted = await routes(api, `/bank/items/${approved.itemId}`, ['recruiter']);
    await mounted.click(mounted.button('Retire'));
    expect(calls.some((c) => c.path.endsWith('/retire') && c.method === 'POST')).toBe(true);
    expect(mounted.text()).toContain('Retired');
    expect(mounted.maybeButton('Retire')).toBeNull();
  });

  it('starts a new draft version and opens it in the editor', async () => {
    const { api } = approvedApi();
    mounted = await routes(api, `/bank/items/${approved.itemId}`, ['recruiter']);
    await mounted.click(mounted.button('Edit as new version'));
    expect(mounted.text()).toContain('Version 2');
    expect(mounted.button('Save draft')).toBeTruthy();
  });

  it('shows a reviewer the content with no action', async () => {
    const { api } = approvedApi();
    mounted = await routes(api, `/bank/items/${approved.itemId}`, ['reviewer']);
    expect(mounted.text()).toContain('[synthetic] What is 4 plus 4?');
    for (const label of ['Retire', 'Edit as new version', 'Approve', 'Send back']) {
      expect(mounted.maybeButton(label)).toBeNull();
    }
  });

  it('shows a parameterised item with its parameter spec', async () => {
    const detail = mcqDetail(
      5,
      { status: 'approved', isParameterised: true },
      { paramSpec: PARAM_SPEC },
    );
    const { api } = fakeApi(() => ({ body: detail }));
    mounted = await routes(api, `/bank/items/${detail.itemId}`, ['recruiter']);
    const text = mounted.text();
    expect(text).toContain('Parameterised');
    expect(text).toContain('{{a}}');
    expect(text).toContain('a < b');
    expect(text).toContain('20 variants');
  });

  it('shows images as key and alt text only', async () => {
    const detail = mcqDetail(
      6,
      { status: 'approved' },
      { media: [{ key: MEDIA_KEY, alt: 'A synthetic chart' }] },
    );
    const { api } = fakeApi(() => ({ body: detail }));
    mounted = await routes(api, `/bank/items/${detail.itemId}`, ['recruiter']);
    expect(mounted.text()).toContain('A synthetic chart');
    expect(mounted.text()).toContain(MEDIA_KEY);
    expect(mounted.container.querySelector('img')).toBeNull();
  });
});

describe('a library-sourced item (I-M1-5, SEC-M1-1)', () => {
  const copy = (() => {
    const base = mcqDetail(8, { status: 'approved', origin: 'library', librarySourced: true });
    const content = { ...base.content } as Record<string, unknown>;
    delete content['key'];
    return { ...base, content } as typeof base;
  })();

  it('shows no key and no parameter spec, says why, and offers Retire only', async () => {
    const { api } = fakeApi(() => ({ body: copy }));
    mounted = await routes(api, `/bank/items/${copy.itemId}`, ['recruiter']);
    const text = mounted.text();
    expect(text).toContain('Trace library');
    expect(text).toContain('The answer key and variant settings of library items are not shown.');
    expect(text).not.toContain('Correct answer');
    expect(mounted.button('Retire')).toBeTruthy();
    expect(mounted.maybeButton('Edit as new version')).toBeNull();
  });
});
