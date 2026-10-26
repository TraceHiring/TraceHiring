// The A2a fixture fakes added in fix round 1 (R5-64 a, c, d; database D3), each pinned by a test of its own so a
// route test can trust it: the inner embed `pool_items!inner(pool_id)` of the bank pool filter, the view
// `v_pool_item_counts`, the missing client grant on `import_jobs.images_ok` (the guard counts it), and the partial
// unique index `item_versions_one_open_per_item` (its 23505 is 409 `conflict` through the clone route); and the M1-q
// function `save_bank_draft` (R5-71 e: one transaction for a draft's content and key). The real index, view, grant,
// guard and function are proven by supabase/tests (lead). Synthetic data only.
import { describe, expect, it } from 'vitest';
import { RestError } from '../tests/org-context.js';
import {
  a2aDb,
  codeOf,
  fakeVariants,
  harness,
  LIBRARY_ORG,
  ORG,
  seedVersion,
  WS,
} from './a2a.test-helpers.js';
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

describe('A2a fixture: public.save_bank_draft (M1-q, R5-71 e, R5-64 b, A2a re-review Low 4)', () => {
  const content = (patch: Record<string, unknown> = {}) => ({
    format: 'mcq',
    stem: '[synthetic] Bank MCQ',
    options: [
      { id: 'o1', text: 'One' },
      { id: 'o2', text: 'Two' },
    ],
    rubric_version_id: null,
    skill_key: 'verbal',
    difficulty: 0.5,
    is_parameterised: false,
    param_spec: null,
    media: null,
    content_sha256: '6'.repeat(64),
    ...patch,
  });
  const save = (
    db: ReturnType<typeof a2aDb>,
    payload: Record<string, unknown>,
    org: string = ORG,
  ): Promise<string | null> => {
    if (db.rest.rpc === undefined) throw new Error('no rpc');
    return db.rest.rpc<string | null>('save_bank_draft', { p_org: org, p_payload: payload });
  };
  const keyOf = (db: ReturnType<typeof a2aDb>, versionId: unknown) =>
    (db.tables.item_answer_keys ?? []).find((k) => k.item_version_id === versionId)?.key;

  it('creates the item, its draft version 1 and its key in one call (guard defaults apply)', async () => {
    const db = a2aDb();
    const id = await save(db, {
      mode: 'create',
      workspaceId: WS,
      keyOptionId: 'o2',
      content: content(),
    });
    const [v] = db.tables.item_versions ?? [];
    expect(v).toMatchObject({
      id,
      version_no: 1,
      status: 'draft',
      origin: 'human',
      workspace_id: WS,
    });
    expect(db.tables.items).toEqual([expect.objectContaining({ id: v?.item_id, format: 'mcq' })]);
    expect(keyOf(db, id)).toEqual({ option_id: 'o2' });
  });

  it('edits a draft and its key together; a key on no current option (23514) changes nothing', async () => {
    const db = a2aDb();
    const create = { mode: 'create', workspaceId: WS, keyOptionId: 'o2', content: content() };
    const id = await save(db, create);
    const itemId = db.tables.item_versions?.[0]?.item_id;
    const edited = content({
      stem: '[synthetic] Bank MCQ edited',
      options: [
        { id: 'o1', text: 'One' },
        { id: 'o3', text: 'Three' },
      ],
    });
    const edit = { mode: 'update', itemId, versionId: id };
    expect(await save(db, { ...edit, keyOptionId: 'o3', content: edited })).toBe(id);
    expect(db.tables.item_versions?.[0]?.stem).toBe('[synthetic] Bank MCQ edited');
    expect(keyOf(db, id)).toEqual({ option_id: 'o3' });
    const before = structuredClone(db.tables);
    const err = await rejection(
      save(db, { ...edit, keyOptionId: 'o9', content: content({ stem: '[synthetic] other' }) }),
    );
    expect(err.sqlstate).toBe('23514');
    expect(db.tables).toEqual(before);
    // An edit with no key removes the draft's key (a written or parameterised draft has none).
    expect(await save(db, { ...edit, keyOptionId: null, content: edited })).toBe(id);
    expect(keyOf(db, id)).toBeUndefined();
  });

  it('answers null for an edit of a version that is not a draft (I-M1-3), of another item, or of another org', async () => {
    const db = a2aDb();
    const approved = seedVersion(db);
    const draft = seedVersion(db, { status: 'draft' });
    const before = structuredClone(db.tables);
    const edit = { mode: 'update', keyOptionId: 'a', content: content() };
    expect(
      await save(db, { ...edit, itemId: approved.item_id, versionId: approved.id }),
    ).toBeNull();
    expect(await save(db, { ...edit, itemId: approved.item_id, versionId: draft.id })).toBeNull();
    expect(
      await save(db, { ...edit, itemId: draft.item_id, versionId: draft.id }, LIBRARY_ORG),
    ).toBeNull();
    expect(db.tables).toEqual(before);
  });

  it('clones a new draft version with its key; a failed key leaves no version; a second open one is 23505', async () => {
    const db = a2aDb();
    const v1 = seedVersion(db);
    const clone = {
      mode: 'clone',
      itemId: v1.item_id,
      keyOptionId: 'a',
      content: content({ options: v1.options }),
    };
    db.failInside('insert', 'item_answer_keys', new RestError(503, null));
    const before = structuredClone(db.tables);
    expect((await rejection(save(db, clone))).status).toBe(503);
    expect(db.tables).toEqual(before);
    const id = await save(db, clone);
    expect(db.tables.item_versions?.find((v) => v.id === id)).toMatchObject({
      version_no: 2,
      status: 'draft',
      origin: 'human',
    });
    expect(keyOf(db, id)).toEqual({ option_id: 'a' });
    expect((await rejection(save(db, clone))).sqlstate).toBe('23505');
  });

  it('refuses an unknown mode or a payload with no content (22023)', async () => {
    const db = a2aDb();
    const merge = await rejection(save(db, { mode: 'merge', content: content() }));
    expect(merge.sqlstate).toBe('22023');
    const bare = await rejection(save(db, { mode: 'create', workspaceId: WS }));
    expect(bare.sqlstate).toBe('22023');
    expect(db.tables.items).toEqual([]);
  });
});
