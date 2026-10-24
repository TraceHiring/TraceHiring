// The A2a fixture fakes added in fix round 1 (R5-64 a, c, d; database D3), each pinned by a test of its own so a
// route test can trust it: the inner embed `pool_items!inner(pool_id)` of the bank pool filter, the view
// `v_pool_item_counts`, the missing client grant on `import_jobs.images_ok` (the guard counts it), and the partial
// unique index `item_versions_one_open_per_item` (its 23505 is 409 `conflict` through the clone route). The real index,
// view, grant and guard are proven by supabase/tests (lead). Synthetic data only.
import { describe, expect, it } from 'vitest';
import { RestError } from '../tests/org-context.js';
import { a2aDb, codeOf, fakeVariants, harness, ORG, seedVersion, WS } from './a2a.test-helpers.js';
import { createBankRoutes } from './routes.js';

const POOL = 'c6000000-0000-4000-8000-0000000000a1';
const EMPTY_POOL = 'c6000000-0000-4000-8000-0000000000a2';
const JOB = 'c8000000-0000-4000-8000-0000000000a1';

const rejection = async (p: Promise<unknown>): Promise<RestError> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof RestError) return err;
    throw err;
  }
  throw new Error('expected a RestError');
};

describe('A2a fixture: the inner embed of the bank pool filter (database D3)', () => {
  it('keeps the versions the pool holds, drops the embed from the rows, and needs embed and filter together', async () => {
    const db = a2aDb();
    const held = seedVersion(db);
    seedVersion(db);
    (db.tables.pool_items ??= []).push({ org_id: ORG, pool_id: POOL, item_version_id: held.id });
    const rows = await db.rest.select<Record<string, unknown>>('item_versions', {
      select: 'id,status,pool_items!inner(pool_id)',
      org_id: `eq.${ORG}`,
      'pool_items.pool_id': `eq.${POOL}`,
    });
    expect(rows).toEqual([{ id: held.id, status: 'approved' }]);
    expect(
      await db.rest.select('item_versions', {
        select: 'id,pool_items!inner(pool_id)',
        'pool_items.pool_id': `eq.${EMPTY_POOL}`,
      }),
    ).toEqual([]);
    await expect(
      Promise.resolve().then(() =>
        db.rest.select('item_versions', { select: 'id,pool_items!inner(pool_id)' }),
      ),
    ).rejects.toThrow('an inner embed needs its filter');
    await expect(
      Promise.resolve().then(() =>
        db.rest.select('item_versions', { select: 'id', 'pool_items.pool_id': `eq.${POOL}` }),
      ),
    ).rejects.toThrow('an inner embed needs its filter');
  });
});

describe('A2a fixture: the view v_pool_item_counts (R5-64 d)', () => {
  it('counts items and approved items per pool, with no row for a pool without items', async () => {
    const db = a2aDb();
    const approved = seedVersion(db);
    const retired = seedVersion(db, { status: 'retired' });
    const pool_items = (db.tables.pool_items ??= []);
    pool_items.push({ org_id: ORG, workspace_id: WS, pool_id: POOL, item_version_id: approved.id });
    pool_items.push({ org_id: ORG, workspace_id: WS, pool_id: POOL, item_version_id: retired.id });
    // A pool row naming a version the caller cannot see counts nothing (an inner join).
    pool_items.push({
      org_id: ORG,
      workspace_id: WS,
      pool_id: POOL,
      item_version_id: 'c4000000-0000-4000-8000-0000000000ef',
    });
    const rows = await db.rest.select('v_pool_item_counts', {
      select: 'pool_id,item_count,approved_count',
      org_id: `eq.${ORG}`,
    });
    expect(rows).toEqual([{ pool_id: POOL, item_count: 2, approved_count: 1 }]);
    expect(
      await db.rest.select('v_pool_item_counts', {
        select: 'pool_id',
        pool_id: `eq.${EMPTY_POOL}`,
      }),
    ).toEqual([]);
  });
});

describe('A2a fixture: import_jobs.images_ok has no client update grant (R5-64 c)', () => {
  it('refuses a client images_ok (42501) and counts the distinct image keys when the job ends', async () => {
    const db = a2aDb();
    (db.tables.import_jobs ??= []).push({
      id: JOB,
      org_id: ORG,
      workspace_id: WS,
      status: 'validating',
      rows_total: 0,
      rows_ok: 0,
      rows_error: 0,
      images_ok: 0,
    });
    const image = (n: number) => ({
      key: `item-media/${ORG}/${String(n).repeat(64)}.png`,
      alt: 'A',
    });
    seedVersion(db, { import_job_id: JOB, media: [image(1), image(2)] });
    seedVersion(db, { import_job_id: JOB, media: [image(1)] });
    const err = await rejection(
      db.rest.update('import_jobs', { id: `eq.${JOB}` }, { images_ok: 2 }),
    );
    expect(err.sqlstate).toBe('42501');
    expect(db.tables.import_jobs?.[0]?.images_ok).toBe(0);
    const [done] = await db.rest.update<Record<string, unknown>>(
      'import_jobs',
      { id: `eq.${JOB}`, select: 'status,rows_ok,images_ok' },
      { status: 'completed' },
    );
    expect(done).toEqual({ status: 'completed', rows_ok: 2, images_ok: 2 });
  });
});

describe('A2a fixture: the one-open-version index item_versions_one_open_per_item (R5-64 a)', () => {
  it('refuses a second open version of an item with 23505, allows one beside closed versions', async () => {
    const db = a2aDb();
    const v1 = seedVersion(db, { status: 'retired' });
    const insert = (status?: string) =>
      db.rest.insert('item_versions', {
        org_id: ORG,
        item_id: v1.item_id,
        format: 'mcq',
        stem: '[synthetic] Another version',
        ...(status === undefined ? {} : { status }),
      });
    const [v2] = await insert();
    expect(v2).toMatchObject({ status: 'draft', version_no: 2 });
    const err = await rejection(insert());
    expect(err.sqlstate).toBe('23505');
    expect(db.tables.item_versions).toHaveLength(2);
  });

  it('its 23505 reaches the clone route as 409 conflict (an older open version under a newer approved one)', async () => {
    const db = a2aDb();
    const open = seedVersion(db, { status: 'draft' });
    seedVersion(db, { item_id: open.item_id, version_no: 2, status: 'approved' });
    const { call } = harness((org) => createBankRoutes({ org, variants: () => fakeVariants }), db);
    const res = await call('POST', `/bank/items/${String(open.item_id)}/versions`);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('conflict');
    expect(db.tables.item_versions).toHaveLength(2);
  });
});
