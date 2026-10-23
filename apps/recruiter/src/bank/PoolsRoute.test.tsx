// @vitest-environment happy-dom
// `/bank/pools` (specs/m1-test-authoring.md §3.2, §6.2, §6.5, E3, E4; R5-54 a; PoolDetail, PoolItemsRequest): create
// pools, add approved items and remove items one by one (no selection, no bulk bar), see which tests draw from a
// pool (usedByDraws, with the count when the list is cut off) and the gap to the 10x rule for drives.
import { afterEach, describe, expect, it } from 'vitest';
import { PoolsRoute } from './PoolsRoute';
import { failure, fakeApi, info } from './testing/api.test-helpers';
import { mountScreen, pick, type Mounted } from './testing/dom.test-helpers';
import { cursorFor, pool, summary, uid } from './testing/fixtures.test-helpers';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const mountPools = (api: ReturnType<typeof fakeApi>['api']) =>
  mountScreen(<PoolsRoute />, { api, info: info('recruiter') });

describe('the pool list', () => {
  const USED = pool(1, {
    usedByDraws: [
      { testId: uid(71), drawCount: 3 },
      { testId: uid(72), drawCount: 2 },
    ],
    usedByDrawsTotal: 7,
    approvedCount: 5,
    itemCount: 6,
  });
  const BIG = pool(2, {
    approvedCount: 40,
    itemCount: 41,
    usedByDraws: [{ testId: uid(73), drawCount: 4 }],
    usedByDrawsTotal: 1,
  });
  const UNUSED = pool(3, { format: 'written', skillKey: null });
  const LOW = pool(4, {
    approvedCount: 8,
    itemCount: 8,
    usedByDraws: [{ testId: uid(74), drawCount: 2 }],
    usedByDrawsTotal: 1,
  });

  function listApi() {
    return fakeApi((call) =>
      call.path === '/pools'
        ? { body: { pools: [USED, BIG, UNUSED, LOW], nextCursor: cursorFor(3) } }
        : undefined,
    );
  }

  it('shows name, format, skill, status and the approved count of each pool', async () => {
    const { api } = listApi();
    mounted = await mountPools(api);
    const text = mounted.text();
    expect(text).toContain('Pools');
    expect(text).toContain('[synthetic] Pool 1');
    expect(text).toContain('Multiple choice');
    expect(text).toContain('quant');
    expect(text).toContain('5 of 6 items approved');
    expect(text).toContain('Active');
  });

  it('shows which tests draw from a pool and says when the list is cut off', async () => {
    const { api } = listApi();
    mounted = await mountPools(api);
    const rows = [...mounted.container.querySelectorAll('tbody tr')];
    expect(rows[0]?.textContent).toContain('Used by 7 tests');
    expect(rows[0]?.textContent).toContain('Showing 2 of 7');
    expect(rows[0]?.textContent).toContain('draws 3');
    expect(mounted.links()).toContain(`/tests/${uid(71)}`);
    expect(rows[1]?.textContent).toContain('Used by 1 test');
    expect(rows[1]?.textContent).not.toContain('Showing');
    expect(rows[2]?.textContent).toContain('Not used by any test yet.');
  });

  it('shows the gap to ten times the largest draw', async () => {
    const { api } = listApi();
    mounted = await mountPools(api);
    const rows = [...mounted.container.querySelectorAll('tbody tr')];
    // The first pool's list of tests is cut off (2 of 7), so the gap is a lower bound.
    expect(rows[0]?.textContent).toContain(
      'Needs at least 25 more approved items for drives (10 times the largest draw, 3)',
    );
    expect(rows[3]?.textContent).toContain(
      'Needs 12 more approved items for drives (10 times the largest draw, 2)',
    );
    expect(rows[1]?.textContent).toContain(
      'Large enough for drives (10 times the largest draw, 4)',
    );
    expect(mounted.text()).not.toMatch(/\btotal\b/i);
  });

  it('pages the list with the cursor', async () => {
    const { api, calls } = fakeApi((call) =>
      call.query['cursor'] === undefined
        ? { body: { pools: [USED], nextCursor: cursorFor(1) } }
        : { body: { pools: [UNUSED], nextCursor: null } },
    );
    mounted = await mountPools(api);
    await mounted.click(mounted.button('Load more'));
    expect(calls[1]?.query['cursor']).toBe(cursorFor(1));
    expect(mounted.container.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('says so when there are no pools, and keeps the heading on an error', async () => {
    const empty = fakeApi(() => ({ body: { pools: [], nextCursor: null } }));
    mounted = await mountPools(empty.api);
    expect(mounted.text()).toContain('No pools yet.');
    mounted.unmount();
    const broken = fakeApi(() => failure(500, 'internal_error'));
    mounted = await mountPools(broken.api);
    expect(mounted.text()).toContain('Pools');
    expect(mounted.text()).toContain('Something went wrong. Try again.');
  });

  it('keeps the heading with no api', async () => {
    mounted = await mountScreen(<PoolsRoute />, { api: null, info: info('recruiter') });
    expect(mounted.text()).toContain('Pools');
  });
});

describe('creating a pool', () => {
  it('posts the name, format and optional skill, then lists the pool', async () => {
    const made = pool(9, { name: '[synthetic] New pool', itemCount: 0, approvedCount: 0 });
    let created = false;
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'POST' && call.path === '/pools') {
        created = true;
        return { status: 201, body: made };
      }
      if (call.path === '/pools')
        return { body: { pools: created ? [made] : [], nextCursor: null } };
      return undefined;
    });
    mounted = await mountPools(api);
    await mounted.type(mounted.field('Pool name'), '[synthetic] New pool');
    await mounted.type(mounted.field('Skill'), 'quant');
    await mounted.submit(pick(mounted.container, 'form[aria-label="New pool"]'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: '[synthetic] New pool',
      format: 'mcq',
      skillKey: 'quant',
    });
    expect(mounted.text()).toContain('[synthetic] New pool');
  });

  it('leaves the skill out when empty and names bad values without a request', async () => {
    const { api, calls } = fakeApi((call) =>
      call.path === '/pools' ? { body: { pools: [], nextCursor: null } } : undefined,
    );
    mounted = await mountPools(api);
    await mounted.submit(pick(mounted.container, 'form[aria-label="New pool"]'));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(mounted.text()).toContain('Give the pool a name (1 to 120 characters).');
    await mounted.type(mounted.field('Skill'), 'Bad Skill');
    await mounted.type(mounted.field('Pool name'), 'x');
    await mounted.submit(pick(mounted.container, 'form[aria-label="New pool"]'));
    expect(mounted.text()).toContain('A skill is lower-case letters, digits and underscores.');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
});

describe('managing the items of a pool', () => {
  const P = pool(1, { approvedCount: 1, itemCount: 1 });
  const IN_POOL = summary(1, { stemPreview: '[synthetic] Already in the pool' });
  const CANDIDATE = summary(2, { stemPreview: '[synthetic] Could be added' });

  function manageApi() {
    const state = { inPool: [IN_POOL], detail: P };
    const handle = fakeApi((call) => {
      if (call.method === 'GET' && call.path === '/pools') {
        return { body: { pools: [state.detail], nextCursor: null } };
      }
      if (call.method === 'GET' && call.path === `/pools/${P.id}`) return { body: state.detail };
      if (call.method === 'GET' && call.path === '/bank/items') {
        return call.query['poolId'] === P.id
          ? { body: { items: state.inPool, nextCursor: null } }
          : { body: { items: [IN_POOL, CANDIDATE], nextCursor: null } };
      }
      const items = (call.body as { itemVersionIds: string[] } | undefined)?.itemVersionIds ?? [];
      if (call.method === 'POST' && call.path === `/pools/${P.id}/items`) {
        state.inPool = [...state.inPool, CANDIDATE];
        state.detail = { ...P, itemCount: 2, approvedCount: 2 };
        return { body: state.detail };
      }
      if (call.method === 'DELETE' && call.path === `/pools/${P.id}/items`) {
        state.inPool = state.inPool.filter((i) => !items.includes(i.itemVersionId));
        state.detail = { ...P, itemCount: 0, approvedCount: 0 };
        return { body: state.detail };
      }
      return undefined;
    });
    return { ...handle, state };
  }

  it('opens a pool with its items and the approved items it could take', async () => {
    const { api, calls } = manageApi();
    mounted = await mountPools(api);
    await mounted.click(mounted.button(`Manage pool: ${P.name}`));
    expect(calls.some((c) => c.path === `/pools/${P.id}`)).toBe(true);
    expect(calls.some((c) => c.path === '/bank/items' && c.query['poolId'] === P.id)).toBe(true);
    expect(
      calls.some(
        (c) =>
          c.path === '/bank/items' &&
          c.query['status'] === 'approved' &&
          c.query['format'] === 'mcq' &&
          c.query['skillKey'] === 'quant',
      ),
    ).toBe(true);
    const text = mounted.text();
    expect(text).toContain('Items in this pool');
    expect(text).toContain('[synthetic] Already in the pool');
    expect(text).toContain('Approved items that could be added');
    expect(mounted.button('Remove from pool: [synthetic] Already in the pool')).toBeTruthy();
    expect(mounted.button('Add to pool: [synthetic] Could be added')).toBeTruthy();
    // An item already in the pool is not offered again.
    expect(mounted.maybeButton('Add to pool: [synthetic] Already in the pool')).toBeNull();
  });

  it('adds one item per click, sending its version id, and updates the counts', async () => {
    const { api, calls } = manageApi();
    mounted = await mountPools(api);
    await mounted.click(mounted.button(`Manage pool: ${P.name}`));
    await mounted.click(mounted.button('Add to pool: [synthetic] Could be added'));
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/items'));
    expect(post?.body).toEqual({ itemVersionIds: [CANDIDATE.itemVersionId] });
    expect(mounted.text()).toContain('2 of 2 items approved');
    expect(mounted.maybeButton('Add to pool: [synthetic] Could be added')).toBeNull();
    expect(mounted.button('Remove from pool: [synthetic] Could be added')).toBeTruthy();
  });

  it('removes one item per click', async () => {
    const { api, calls } = manageApi();
    mounted = await mountPools(api);
    await mounted.click(mounted.button(`Manage pool: ${P.name}`));
    await mounted.click(mounted.button('Remove from pool: [synthetic] Already in the pool'));
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.body).toEqual({ itemVersionIds: [IN_POOL.itemVersionId] });
    expect(mounted.maybeButton('Remove from pool: [synthetic] Already in the pool')).toBeNull();
    expect(mounted.text()).toContain('0 of 0 items approved');
  });

  it('shows a fixed sentence when the pool refuses an item', async () => {
    const { api } = fakeApi((call) => {
      if (call.method === 'POST') return failure(400, 'bad_request');
      if (call.path === '/pools') return { body: { pools: [P], nextCursor: null } };
      if (call.path === `/pools/${P.id}`) return { body: P };
      if (call.path === '/bank/items') {
        return call.query['poolId'] === undefined
          ? { body: { items: [CANDIDATE], nextCursor: null } }
          : { body: { items: [], nextCursor: null } };
      }
      return undefined;
    });
    mounted = await mountPools(api);
    await mounted.click(mounted.button(`Manage pool: ${P.name}`));
    await mounted.click(mounted.button('Add to pool: [synthetic] Could be added'));
    expect(mounted.text()).toContain('Some values were not accepted. Check the form.');
  });

  it('has no row selection and no bulk control', async () => {
    const { api } = manageApi();
    mounted = await mountPools(api);
    await mounted.click(mounted.button(`Manage pool: ${P.name}`));
    expect(mounted.container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(mounted.container.querySelector('[aria-selected], [role="checkbox"]')).toBeNull();
    expect(mounted.text()).not.toMatch(/bulk|select all/i);
  });
});
