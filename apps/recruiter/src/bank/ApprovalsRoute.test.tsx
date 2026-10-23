// @vitest-environment happy-dom
// `/bank/approvals` (specs/m1-test-authoring.md §6.2, §6.4, R5-22, R5-40; AT-M1-09): the queue of versions in review
// for staff and reviewers, an AI draft marked "AI draft — needs approval", "Approve" or "Send back" per item,
// self-approval logged. It concerns items only: no candidate appears and nothing here can touch a candidate.
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalsRoute } from './ApprovalsRoute';
import { failure, fakeApi, info, USER_ID } from './testing/api.test-helpers';
import { mountScreen, type Mounted } from './testing/dom.test-helpers';
import { cursorFor, mcqDetail, summary } from './testing/fixtures.test-helpers';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const QUEUE = [
  summary(1, { status: 'in_review', stemPreview: '[synthetic] First waiting item' }),
  summary(2, {
    status: 'in_review',
    origin: 'ai_draft',
    stemPreview: '[synthetic] Drafted waiting item',
  }),
];

function setup(options: { createdBy?: string; next?: typeof QUEUE | null } = {}) {
  let queue: typeof QUEUE = [...QUEUE];
  const api = fakeApi((call) => {
    if (call.method === 'GET' && call.path === '/bank/items') {
      return call.query['cursor'] === undefined
        ? { body: { items: queue, nextCursor: queue.length > 0 ? cursorFor(2) : null } }
        : { body: { items: [summary(3, { status: 'in_review' })], nextCursor: null } };
    }
    for (const n of [1, 2]) {
      const detail = mcqDetail(n, {
        status: 'in_review',
        origin: n === 2 ? 'ai_draft' : 'human',
        createdBy: options.createdBy ?? '00000000-0000-4000-8000-0000000000aa',
      });
      if (call.method === 'GET' && call.path === `/bank/items/${detail.itemId}`) {
        return { body: detail };
      }
      if (call.path === `/bank/item-versions/${detail.itemVersionId}/review`) {
        queue = queue.filter((q) => q.itemVersionId !== detail.itemVersionId);
        const decision = (call.body as { decision: string }).decision;
        return {
          body: mcqDetail(n, { status: decision === 'approve' ? 'approved' : 'not_approved' }),
        };
      }
    }
    return undefined;
  });
  return api;
}

const mountQueue = (api: ReturnType<typeof fakeApi>['api'], role = 'reviewer') =>
  mountScreen(<ApprovalsRoute />, { api, info: info(role) });

describe('ApprovalsRoute', () => {
  it('asks the api for versions in review and lists them', async () => {
    const { api, calls } = setup();
    mounted = await mountQueue(api);
    expect(calls[0]?.query).toEqual({ status: 'in_review' });
    const text = mounted.text();
    expect(text).toContain('Item approvals');
    expect(text).toContain('[synthetic] First waiting item');
    expect(text).toContain('[synthetic] Drafted waiting item');
    expect(mounted.container.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('marks an AI draft as needing approval and shows no model detail or likeness score', async () => {
    const { api } = setup();
    mounted = await mountQueue(api);
    const rows = [...mounted.container.querySelectorAll('tbody tr')];
    expect(rows[1]?.textContent).toContain('AI draft — needs approval');
    expect(rows[0]?.textContent).not.toContain('AI draft');
    expect(mounted.text()).not.toMatch(/model|likeness|score/i);
  });

  it('opens an item with its content, its key and the two actions', async () => {
    const { api } = setup();
    mounted = await mountQueue(api);
    await mounted.click(mounted.button(/^Open: \[synthetic\] First waiting item/));
    const text = mounted.text();
    expect(text).toContain('[synthetic] What is 1 plus 1?');
    expect(text).toContain('Correct answer');
    expect(mounted.button('Approve')).toBeTruthy();
    expect(mounted.button('Send back')).toBeTruthy();
  });

  it('approves: posts the version id and the decision, then drops it from the queue', async () => {
    const { api, calls } = setup();
    mounted = await mountQueue(api);
    await mounted.click(mounted.button(/^Open: \[synthetic\] First waiting item/));
    await mounted.click(mounted.button('Approve'));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({
      itemVersionId: mcqDetail(1).itemVersionId,
      decision: 'approve',
    });
    expect(mounted.text()).toContain('Approved.');
    expect(mounted.text()).not.toContain('[synthetic] First waiting item');
    expect(mounted.text()).toContain('[synthetic] Drafted waiting item');
    expect(mounted.maybeButton('Approve')).toBeNull();
  });

  it('sends back with the not_approved decision', async () => {
    const { api, calls } = setup();
    mounted = await mountQueue(api);
    await mounted.click(mounted.button(/^Open: \[synthetic\] Drafted waiting item/));
    expect(mounted.text()).toContain('AI draft — needs approval');
    await mounted.click(mounted.button('Send back'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      itemVersionId: mcqDetail(2).itemVersionId,
      decision: 'not_approved',
    });
    expect(mounted.text()).toContain('Sent back.');
  });

  it('says that self-approval is logged when the approver wrote the item', async () => {
    const { api } = setup({ createdBy: USER_ID });
    mounted = await mountQueue(api, 'recruiter');
    await mounted.click(mounted.button(/^Open: \[synthetic\] First waiting item/));
    expect(mounted.text()).toContain('self-approval is logged');
  });

  it('shows a fixed sentence when the decision fails and keeps the item open', async () => {
    const { api } = fakeApi((call) => {
      if (call.path === '/bank/items') return { body: { items: QUEUE, nextCursor: null } };
      if (call.method === 'GET') {
        return { body: mcqDetail(1, { status: 'in_review', createdBy: USER_ID }) };
      }
      return failure(409, 'conflict');
    });
    mounted = await mountQueue(api);
    await mounted.click(mounted.button(/^Open: \[synthetic\] First waiting item/));
    await mounted.click(mounted.button('Approve'));
    expect(mounted.text()).toContain('That change is no longer possible. Reload the page.');
    expect(mounted.button('Approve')).toBeTruthy();
  });

  it('pages the queue with the cursor', async () => {
    const { api, calls } = setup();
    mounted = await mountQueue(api);
    await mounted.click(mounted.button('Load more'));
    expect(calls.filter((c) => c.path === '/bank/items')[1]?.query['cursor']).toBe(cursorFor(2));
    expect(mounted.container.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('says so when nothing waits', async () => {
    const { api } = fakeApi(() => ({ body: { items: [], nextCursor: null } }));
    mounted = await mountQueue(api);
    expect(mounted.text()).toContain('Nothing is waiting for approval.');
  });

  it('keeps the heading when the queue cannot be read', async () => {
    const { api } = fakeApi(() => failure(500, 'internal_error'));
    mounted = await mountQueue(api);
    expect(mounted.text()).toContain('Item approvals');
    expect(mounted.text()).toContain('Something went wrong. Try again.');
  });

  it('keeps the heading while loading and with no api', async () => {
    mounted = await mountScreen(<ApprovalsRoute />, { api: null, info: info('reviewer') });
    expect(mounted.text()).toContain('Item approvals');
  });
});
