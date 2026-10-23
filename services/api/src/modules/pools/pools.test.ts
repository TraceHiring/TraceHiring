// Pools (spec m1 §3.2 pools/pool_items, §6.2 pools editor, §6.5, §6.11 `GET/POST/PUT …/pools`, R5-54 a, R5-55 a):
// a pool is a working set of approved bank items of one format; what a test serves is frozen at publish. PoolDetail
// counts the pool's items and the approved ones and lists the tests whose sections draw from it. Synthetic data only.
import { PoolDetail, PoolListResponse } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import {
  a2aDb,
  callerOf,
  codeOf,
  harness,
  jsonOf,
  ORG,
  seedVersion,
  WS,
  WS2,
} from '../bank/a2a.test-helpers.js';
import { createPoolsRoutes } from './routes.js';

const setup = (roles?: string[]) => {
  const db = a2aDb(roles === undefined ? {} : { roles });
  const { call } = harness((org) => createPoolsRoutes({ org }), db, callerOf());
  return { db, call };
};

const create = async (call: ReturnType<typeof setup>['call'], body: Record<string, unknown> = {}) =>
  PoolDetail.parse(
    await (
      await call('POST', '/pools', { name: 'Synthetic verbal pool', format: 'mcq', ...body })
    ).json(),
  );

describe('POST …/pools', () => {
  it('creates an empty active pool in the default workspace', async () => {
    const { db, call } = setup();
    const res = await call('POST', '/pools', {
      name: 'Synthetic pool',
      format: 'mcq',
      skillKey: 'verbal',
    });
    expect(res.status).toBe(201);
    const body = PoolDetail.parse(await res.json());
    expect(body).toMatchObject({
      name: 'Synthetic pool',
      format: 'mcq',
      skillKey: 'verbal',
      status: 'active',
      itemCount: 0,
      approvedCount: 0,
      usedByDraws: [],
      usedByDrawsTotal: 0,
    });
    expect(db.tables.pools?.[0]?.workspace_id).toBe(WS);
  });

  it('refuses a bad body and is not for reviewers', async () => {
    const { call } = setup();
    expect((await call('POST', '/pools', { name: '', format: 'mcq' })).status).toBe(400);
    const r = setup(['reviewer']);
    expect((await r.call('POST', '/pools', { name: 'x', format: 'mcq' })).status).toBe(404);
  });
});

describe('POST/DELETE …/pools/:id/items', () => {
  it('adds approved items once each, counts them and removes them', async () => {
    const { db, call } = setup();
    const pool = await create(call);
    const a = seedVersion(db);
    const b = seedVersion(db);
    const added = await call('POST', `/pools/${pool.id}/items`, {
      itemVersionIds: [a.id, b.id],
    });
    expect(added.status).toBe(200);
    expect(PoolDetail.parse(await added.json())).toMatchObject({ itemCount: 2, approvedCount: 2 });
    // Adding one already there is a no-op, never a 409.
    const again = await call('POST', `/pools/${pool.id}/items`, { itemVersionIds: [a.id] });
    expect(PoolDetail.parse(await again.json()).itemCount).toBe(2);
    // A retired item stays in the pool but no longer counts as approved (E3).
    b.status = 'retired';
    const removed = await call('DELETE', `/pools/${pool.id}/items`, { itemVersionIds: [a.id] });
    expect(removed.status).toBe(200);
    expect(PoolDetail.parse(await removed.json())).toMatchObject({
      itemCount: 1,
      approvedCount: 0,
    });
  });

  it('answers 409 for an archived pool (guard pool_archived) and 404 for an unknown pool', async () => {
    const { db, call } = setup();
    const pool = await create(call);
    const stored = db.tables.pools?.[0];
    if (stored !== undefined) stored.status = 'archived';
    const a = seedVersion(db);
    const res = await call('POST', `/pools/${pool.id}/items`, { itemVersionIds: [a.id] });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('conflict');
    const unknown = await call('POST', '/pools/c6000000-0000-4000-8000-0000000000ff/items', {
      itemVersionIds: [a.id],
    });
    expect(unknown.status).toBe(404);
  });

  it('refuses duplicate ids in a batch', async () => {
    const { db, call } = setup();
    const pool = await create(call);
    const a = seedVersion(db);
    const res = await call('POST', `/pools/${pool.id}/items`, { itemVersionIds: [a.id, a.id] });
    expect(res.status).toBe(400);
  });
});

describe('GET …/pools/:id and …/pools', () => {
  it('lists the tests whose sections draw from the pool', async () => {
    const { db, call } = setup();
    const pool = await create(call);
    const T1 = 'e1000000-0000-4000-8000-000000000001';
    const T2 = 'e1000000-0000-4000-8000-000000000002';
    (db.tables.sections ??= []).push(
      { id: 's1', org_id: ORG, test_id: T1, pool_id: pool.id, draw_count: 10 },
      { id: 's2', org_id: ORG, test_id: T1, pool_id: pool.id, draw_count: 12 },
      { id: 's3', org_id: ORG, test_id: T2, pool_id: pool.id, draw_count: 1 },
      { id: 's4', org_id: ORG, test_id: T2, pool_id: null, draw_count: null },
    );
    const body = PoolDetail.parse(await (await call('GET', `/pools/${pool.id}`)).json());
    expect(body.usedByDrawsTotal).toBe(2);
    expect(body.usedByDraws).toEqual([
      { testId: T1, drawCount: 12 },
      { testId: T2, drawCount: 1 },
    ]);
  });

  it('pages the org pools newest first', async () => {
    const { call } = setup();
    for (let n = 0; n < 51; n += 1) await create(call, { name: `Synthetic pool ${String(n)}` });
    const first = PoolListResponse.parse(await (await call('GET', '/pools')).json());
    expect(first.pools).toHaveLength(50);
    expect(first.pools[0]?.name).toBe('Synthetic pool 50');
    const second = PoolListResponse.parse(
      await (await call('GET', `/pools?cursor=${String(first.nextCursor)}`)).json(),
    );
    expect(second.pools.map((p) => p.name)).toEqual(['Synthetic pool 0']);
    expect(second.nextCursor).toBeNull();
  });
});

describe('pool counts from v_pool_item_counts (database D2, spec Low 4, R5-64 d)', () => {
  it('reads the counts of a list page in one view read, never the members', async () => {
    const { db, call } = setup();
    const p1 = await create(call, { name: 'Synthetic pool 1' });
    const p2 = await create(call, { name: 'Synthetic pool 2' });
    await create(call, { name: 'Synthetic empty pool' });
    const a = seedVersion(db);
    const b = seedVersion(db, { status: 'retired' });
    const items = (db.tables.pool_items ??= []);
    items.push(
      { org_id: ORG, workspace_id: WS, pool_id: p1.id, item_version_id: a.id },
      { org_id: ORG, workspace_id: WS, pool_id: p1.id, item_version_id: b.id },
      { org_id: ORG, workspace_id: WS, pool_id: p2.id, item_version_id: a.id },
    );
    db.calls.length = 0;
    const page = PoolListResponse.parse(await (await call('GET', '/pools')).json());
    expect(page.pools.map((p) => [p.name, p.itemCount, p.approvedCount])).toEqual([
      ['Synthetic empty pool', 0, 0],
      ['Synthetic pool 2', 1, 1],
      ['Synthetic pool 1', 2, 1],
    ]);
    const tables = db.calls.map((c) => c.table);
    expect(tables.filter((t) => t === 'v_pool_item_counts')).toHaveLength(1);
    expect(tables).not.toContain('pool_items');
    expect(tables).not.toContain('item_versions');
  });

  it('has no pool size cap: a pool over 10,000 items reads, adds and removes without a 503', async () => {
    const { db, call } = setup();
    const pool = await create(call);
    const versions = (db.tables.item_versions ??= []);
    const items = (db.tables.pool_items ??= []);
    for (let n = 0; n < 10_001; n += 1) {
      const id = `c7000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
      versions.push({ id, org_id: ORG, workspace_id: WS, status: 'approved', format: 'mcq' });
      items.push({ org_id: ORG, workspace_id: WS, pool_id: pool.id, item_version_id: id });
    }
    const read = await call('GET', `/pools/${pool.id}`);
    expect(read.status).toBe(200);
    expect(PoolDetail.parse(await read.json())).toMatchObject({
      itemCount: 10_001,
      approvedCount: 10_001,
    });
    const extra = seedVersion(db);
    const first = String(items[0]?.item_version_id);
    db.calls.length = 0;
    const added = await call('POST', `/pools/${pool.id}/items`, {
      itemVersionIds: [first, extra.id],
    });
    expect(added.status).toBe(200);
    expect(PoolDetail.parse(await added.json()).itemCount).toBe(10_002);
    // The no-op check reads only the requested ids, never the whole pool.
    for (const c of db.calls.filter((x) => x.method === 'select' && x.table === 'pool_items')) {
      expect(c.query.item_version_id).toMatch(/^in\./);
    }
    const removed = await call('DELETE', `/pools/${pool.id}/items`, { itemVersionIds: [first] });
    expect(removed.status).toBe(200);
    expect(PoolDetail.parse(await removed.json()).itemCount).toBe(10_001);
  });
});

describe('PUT …/pools/:id', () => {
  it('renames the pool and changes its skill; format and workspace never move', async () => {
    const { call } = setup();
    const pool = await create(call);
    const res = await call('PUT', `/pools/${pool.id}`, {
      name: 'Synthetic renamed pool',
      format: 'mcq',
      skillKey: 'reading',
    });
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toMatchObject({
      name: 'Synthetic renamed pool',
      skillKey: 'reading',
    });
    const format = await call('PUT', `/pools/${pool.id}`, { name: 'x', format: 'written' });
    expect(format.status).toBe(400);
    const moved = await call('PUT', `/pools/${pool.id}`, {
      name: 'x',
      format: 'mcq',
      workspaceId: WS2,
    });
    expect(moved.status).toBe(400);
  });
});
