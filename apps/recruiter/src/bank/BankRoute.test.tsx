// @vitest-environment happy-dom
// The item bank list (specs/m1-test-authoring.md §6.2, §6.3, §6.11; R5-54 a): filters of BankItemListQuery, keyset
// paging, an exposure column, the ABH-7 share metric, and role gating inside the screen (a reviewer reads only).
import { afterEach, describe, expect, it } from 'vitest';
import { BankRoute } from './BankRoute';
import { failure, fakeApi, info } from './testing/api.test-helpers';
import { mountScreen, pick, type Mounted } from './testing/dom.test-helpers';
import { STATS, cursorFor, summary } from './testing/fixtures.test-helpers';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const PAGE_ONE = [
  summary(1),
  summary(2, { status: 'in_review', origin: 'ai_draft', stemPreview: '[synthetic] Drafted stem' }),
  summary(3, { format: 'written', skillKey: 'written_communication', difficulty: null }),
  summary(4, { isParameterised: true, exposureCount: 12 }),
];

function bankApi(extra?: (path: string, query: Record<string, string>) => unknown) {
  return fakeApi((call) => {
    if (call.path === '/bank/stats') return { body: STATS };
    if (call.path === '/bank/items') {
      const custom = extra?.(call.path, call.query);
      if (custom !== undefined) return { body: custom };
      return call.query['cursor'] === undefined
        ? { body: { items: PAGE_ONE, nextCursor: cursorFor(4) } }
        : { body: { items: [summary(5)], nextCursor: null } };
    }
    return undefined;
  });
}

describe('BankRoute', () => {
  it('lists the items with format, skill, difficulty, status, origin, versions and times served', async () => {
    const { api } = bankApi();
    mounted = await mountScreen(<BankRoute />, { api, info: info('recruiter') });
    const text = mounted.text();
    expect(text).toContain('Item bank');
    expect(text).toContain('[synthetic] Stem preview 1');
    expect(text).toContain('Multiple choice');
    expect(text).toContain('Written');
    expect(text).toContain('0.40');
    expect(text).toContain('Written by hand');
    expect(text).toContain('Approved');
    expect(text).toContain('Times served');
    const rows = [...mounted.container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(4);
    expect(rows[3]?.textContent).toContain('12');
    expect(rows[3]?.textContent).toContain('Parameterised');
  });

  it('links each row to its item and offers the staff actions', async () => {
    const { api } = bankApi();
    mounted = await mountScreen(<BankRoute />, { api, info: info('recruiter') });
    const links = mounted.links();
    expect(links).toContain(`/bank/items/${summary(1).itemId}`);
    expect(links).toEqual(
      expect.arrayContaining([
        '/bank/items/new',
        '/bank/import',
        '/bank/ai-drafts',
        '/bank/pools',
        '/library',
      ]),
    );
  });

  it('shows the AI draft badge on a draft that waits for approval, and plain origin otherwise', async () => {
    const { api } = bankApi();
    mounted = await mountScreen(<BankRoute />, { api, info: info('recruiter') });
    const rows = [...mounted.container.querySelectorAll('tbody tr')];
    expect(rows[1]?.textContent).toContain('AI draft — needs approval');
    expect(rows[0]?.textContent).not.toContain('AI draft');
  });

  it('shows a reviewer the list without any create or import link', async () => {
    const { api } = bankApi();
    mounted = await mountScreen(<BankRoute />, { api, info: info('reviewer') });
    expect(mounted.text()).toContain('[synthetic] Stem preview 1');
    const links = mounted.links();
    for (const staffOnly of ['/bank/items/new', '/bank/import', '/bank/ai-drafts', '/bank/pools']) {
      expect(links).not.toContain(staffOnly);
    }
  });

  it('shows the parameterised share of approved quant items for the org and the library', async () => {
    const { api } = bankApi();
    mounted = await mountScreen(<BankRoute />, { api, info: info('recruiter') });
    const text = mounted.text();
    expect(text).toContain('4 of 10 approved quant items are parameterised (40%)');
    expect(text).toContain('Trace library: 3 of 20 (15%)');
    expect(text).toContain('Target: at least 40%');
  });

  it('says so when no quant item is approved yet, and tolerates a missing library', async () => {
    const { api } = fakeApi((call) => {
      if (call.path === '/bank/stats') {
        return {
          body: {
            org: { quantItemsApproved: 0, quantItemsParameterised: 0, share: null },
            library: null,
          },
        };
      }
      return { body: { items: [], nextCursor: null } };
    });
    mounted = await mountScreen(<BankRoute />, { api, info: info('recruiter') });
    expect(mounted.text()).toContain('No approved quant items yet');
    expect(mounted.text()).not.toContain('Trace library:');
    expect(mounted.text()).toContain('No items match.');
  });

  it('loads the next page with the cursor and appends it', async () => {
    const { api, calls } = bankApi();
    mounted = await mountScreen(<BankRoute />, { api, info: info('recruiter') });
    await mounted.click(mounted.button('Load more'));
    const listCalls = calls.filter((c) => c.path === '/bank/items');
    expect(listCalls[1]?.query['cursor']).toBe(cursorFor(4));
    expect(mounted.container.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(mounted.maybeButton('Load more')).toBeNull();
  });

  it('applies the filters as a query and starts again from the first page', async () => {
    const { api, calls } = bankApi();
    mounted = await mountScreen(<BankRoute />, { api, info: info('recruiter') });
    await mounted.choose(mounted.field('Format'), 'written');
    await mounted.type(mounted.field('Skill'), 'verbal');
    await mounted.type(mounted.field('Difficulty from'), '0.2');
    await mounted.choose(mounted.field('Status'), 'in_review');
    await mounted.submit(pick(mounted.container, 'form'));
    const last = calls.filter((c) => c.path === '/bank/items').at(-1);
    expect(last?.query).toEqual({
      format: 'written',
      skillKey: 'verbal',
      difficultyMin: '0.2',
      status: 'in_review',
    });
    expect(last?.query['cursor']).toBeUndefined();
  });

  it('names a bad difficulty without sending a request', async () => {
    const { api, calls } = bankApi();
    mounted = await mountScreen(<BankRoute />, { api, info: info('recruiter') });
    const before = calls.length;
    await mounted.type(mounted.field('Difficulty from'), '7');
    await mounted.submit(pick(mounted.container, 'form'));
    expect(mounted.text()).toContain('Difficulty must be a number from 0 to 1.');
    expect(calls.length).toBe(before);
  });

  it('"Reset filters" empties the form and reloads without a query', async () => {
    const { api, calls } = bankApi();
    mounted = await mountScreen(<BankRoute />, { api, info: info('recruiter') });
    await mounted.type(mounted.field('Skill'), 'verbal');
    await mounted.submit(pick(mounted.container, 'form'));
    await mounted.click(mounted.button('Reset filters'));
    expect(calls.filter((c) => c.path === '/bank/items').at(-1)?.query).toEqual({});
    expect((mounted.field('Skill') as HTMLInputElement).value).toBe('');
  });

  it('shows a fixed sentence when the list cannot be read, keeping the heading', async () => {
    const { api } = fakeApi((call) =>
      call.path === '/bank/items' ? failure(500, 'internal_error') : { body: STATS },
    );
    mounted = await mountScreen(<BankRoute />, { api, info: info('recruiter') });
    expect(mounted.text()).toContain('Item bank');
    expect(mounted.text()).toContain('Something went wrong. Try again.');
  });

  it('keeps the heading while the list is loading and with no signed-in api', async () => {
    mounted = await mountScreen(<BankRoute />, { api: null, info: info('recruiter') });
    expect(mounted.text()).toContain('Item bank');
  });

  it('puts no server text on screen when stats fail; the list still shows', async () => {
    const { api } = fakeApi((call) =>
      call.path === '/bank/stats'
        ? failure(500, 'internal_error')
        : { body: { items: [summary(1)], nextCursor: null } },
    );
    mounted = await mountScreen(<BankRoute />, { api, info: info('recruiter') });
    expect(mounted.text()).toContain('[synthetic] Stem preview 1');
    expect(mounted.text()).toContain('The share could not be read.');
  });
});
