// @vitest-environment happy-dom
// `/library` (specs/m1-test-authoring.md M1-4, §6.2, E7, E8; I-M1-5, SEC-M1-1; LibraryItemCard): browse the Trace
// library as cards (stem, options, skill, difficulty; never a key), filter, page, build a copy list one click at a
// time and copy it into the bank. The daily cap and the rate limit show fixed sentences.
import { afterEach, describe, expect, it } from 'vitest';
import { failure, fakeApi, info } from '../bank/testing/api.test-helpers';
import { mountScreen, pick, type Mounted } from '../bank/testing/dom.test-helpers';
import { cursorFor, libraryCard, uid } from '../bank/testing/fixtures.test-helpers';
import { LibraryRoute } from './LibraryRoute';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const CARDS = [
  libraryCard(1),
  libraryCard(2, { format: 'written', options: undefined, skillKey: 'written_communication' }),
  libraryCard(3, { isParameterised: true, skillKey: 'quant', difficulty: 0.65 }),
];

function libraryApi(copy?: (ids: string[]) => ReturnType<Parameters<typeof fakeApi>[0]>) {
  return fakeApi((call) => {
    if (call.method === 'GET' && call.path === '/library/items') {
      return call.query['cursor'] === undefined
        ? { body: { items: CARDS, nextCursor: cursorFor(3) } }
        : { body: { items: [libraryCard(4)], nextCursor: null } };
    }
    if (call.method === 'POST' && call.path === '/library/copy') {
      const ids = (call.body as { libraryItemVersionIds: string[] }).libraryItemVersionIds;
      return (
        copy?.(ids) ?? { status: 201, body: { itemVersionIds: ids.map((_, i) => uid(8000 + i)) } }
      );
    }
    return undefined;
  });
}
const mountLibrary = (api: ReturnType<typeof fakeApi>['api']) =>
  mountScreen(<LibraryRoute />, { api, info: info('recruiter') });
const addButton = (m: Mounted, n: number) =>
  m.button(`Add to copy list: [synthetic] Library stem ${String(n)}`);

describe('browsing', () => {
  it('shows each library item as a card with its stem, options, skill and difficulty', async () => {
    const { api } = libraryApi();
    mounted = await mountLibrary(api);
    const text = mounted.text();
    expect(text).toContain('Library');
    expect(text).toContain('[synthetic] Library stem 1');
    expect(text).toContain('Option one');
    expect(text).toContain('verbal');
    expect(text).toContain('0.30');
    expect(text).toContain('Written');
    expect(text).toContain('Parameterised');
  });

  it('never shows an answer key, a correct-answer mark or a parameter spec', async () => {
    const { api } = libraryApi();
    mounted = await mountLibrary(api);
    const text = mounted.text();
    expect(text).not.toMatch(/correct answer|\bkey\b|spec\b/i);
    expect(text).toContain('Answer keys are never shown for library items.');
    expect(
      mounted.container.querySelector('input[type="radio"], input[type="checkbox"]'),
    ).toBeNull();
  });

  it('pages with the cursor', async () => {
    const { api, calls } = libraryApi();
    mounted = await mountLibrary(api);
    await mounted.click(mounted.button('Load more'));
    expect(calls.filter((c) => c.path === '/library/items')[1]?.query['cursor']).toBe(cursorFor(3));
    expect(mounted.text()).toContain('[synthetic] Library stem 4');
    expect(mounted.maybeButton('Load more')).toBeNull();
  });

  it('applies the filters as a query and resets them', async () => {
    const { api, calls } = libraryApi();
    mounted = await mountLibrary(api);
    await mounted.choose(mounted.field('Format'), 'mcq');
    await mounted.type(mounted.field('Skill'), 'verbal');
    await mounted.type(mounted.field('Difficulty to'), '0.5');
    await mounted.submit(pick(mounted.container, 'form[aria-label="Filters"]'));
    const last = () => calls.filter((c) => c.path === '/library/items').at(-1);
    expect(last()?.query).toEqual({ format: 'mcq', skillKey: 'verbal', difficultyMax: '0.5' });
    await mounted.click(mounted.button('Reset filters'));
    expect(last()?.query).toEqual({});
  });

  it('names a bad value and sends no request', async () => {
    const { api, calls } = libraryApi();
    mounted = await mountLibrary(api);
    const before = calls.length;
    await mounted.type(mounted.field('Difficulty from'), '2');
    await mounted.submit(pick(mounted.container, 'form[aria-label="Filters"]'));
    expect(mounted.text()).toContain('Difficulty must be a number from 0 to 1.');
    expect(calls.length).toBe(before);
  });

  it('shows fixed sentences for an empty page, the rate limit and a failure', async () => {
    const empty = fakeApi(() => ({ body: { items: [], nextCursor: null } }));
    mounted = await mountLibrary(empty.api);
    expect(mounted.text()).toContain('No library items match.');
    mounted.unmount();
    const limited = fakeApi(() => failure(429, 'rate_limited'));
    mounted = await mountLibrary(limited.api);
    expect(mounted.text()).toContain('Library');
    expect(mounted.text()).toContain('Too many requests. Wait a moment and try again.');
  });

  it('keeps the heading with no api', async () => {
    mounted = await mountScreen(<LibraryRoute />, { api: null, info: info('recruiter') });
    expect(mounted.text()).toContain('Library');
  });
});

describe('copying to the bank', () => {
  it('builds the copy list one item at a time, in a visible list, with no selection control', async () => {
    const { api } = libraryApi();
    mounted = await mountLibrary(api);
    expect(mounted.text()).toContain('The copy list is empty.');
    await mounted.click(addButton(mounted, 1));
    await mounted.click(addButton(mounted, 3));
    const list = pick(mounted.container, '[aria-label="Copy list"]');
    expect(list.textContent).toContain('[synthetic] Library stem 1');
    expect(list.textContent).toContain('[synthetic] Library stem 3');
    expect(list.textContent).toContain('2 items');
    expect(mounted.container.querySelector('input[type="checkbox"], [aria-selected]')).toBeNull();
    await mounted.click(mounted.button('Remove from copy list: [synthetic] Library stem 1'));
    expect(pick(mounted.container, '[aria-label="Copy list"]').textContent).not.toContain('stem 1');
  });

  it('posts the ids in order, then reports how many items were copied and empties the list', async () => {
    const { api, calls } = libraryApi();
    mounted = await mountLibrary(api);
    await mounted.click(addButton(mounted, 2));
    await mounted.click(addButton(mounted, 1));
    await mounted.click(mounted.button('Copy to bank'));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ libraryItemVersionIds: [uid(5002), uid(5001)] });
    expect(mounted.text()).toContain('Copied 2 items to your bank.');
    expect(mounted.links()).toContain('/bank');
    expect(mounted.text()).toContain('The copy list is empty.');
  });

  it('has nothing to send when the list is empty', async () => {
    const { api, calls } = libraryApi();
    mounted = await mountLibrary(api);
    expect(mounted.button('Copy to bank').disabled).toBe(true);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('says the daily limit was reached, keeping the list', async () => {
    const { api } = libraryApi(() => failure(429, 'library_cap'));
    mounted = await mountLibrary(api);
    await mounted.click(addButton(mounted, 1));
    await mounted.click(mounted.button('Copy to bank'));
    expect(mounted.text()).toContain(
      'The daily limit for copying library items was reached. Try again tomorrow.',
    );
    expect(pick(mounted.container, '[aria-label="Copy list"]').textContent).toContain('stem 1');
  });

  it('keeps the list when the filters change', async () => {
    const { api } = libraryApi();
    mounted = await mountLibrary(api);
    await mounted.click(addButton(mounted, 1));
    await mounted.type(mounted.field('Skill'), 'quant');
    await mounted.submit(pick(mounted.container, 'form[aria-label="Filters"]'));
    expect(pick(mounted.container, '[aria-label="Copy list"]').textContent).toContain('stem 1');
  });
});
