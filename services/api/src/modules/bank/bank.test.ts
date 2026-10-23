// Item bank routes (spec m1 §6.2, §6.3, §4.1, §6.11 bank rows, R5-22, R5-49 a, R5-53 c/d, R5-54 a, R5-55 a): create a
// bank item as a draft (content hash per R5-49 a, origin from the write path), read it back (key only when readable and
// not library-sourced, I-M1-5), edit the draft, clone a new draft version (Q23), submit (parameterised items get their
// variants first, §6.3), approve or send back (the body id equals the path id), retire, and list with filters and a
// keyset cursor. Synthetic data only.
import {
  BankItemCreateResponse,
  BankItemDetail,
  BankItemListResponse,
  type BankItemDraft,
} from '@trace/shared/contracts/m1';
import { itemContentSha256 } from '@trace/shared/item-hash';
import { describe, expect, it } from 'vitest';
import { RestError } from '../tests/org-context.js';
import {
  a2aDb,
  callerOf,
  codeOf,
  fakeVariants,
  harness,
  jsonOf,
  LIBRARY_ORG,
  ORG,
  RUBRIC,
  seedVersion,
  WS,
  WS2,
} from './a2a.test-helpers.js';
import { createBankRoutes } from './routes.js';

const mcq = (patch: Partial<Extract<BankItemDraft, { format: 'mcq' }>> = {}): BankItemDraft => ({
  format: 'mcq',
  stem: '[synthetic] Which word is a noun?',
  options: [
    { id: 'a', text: 'Table' },
    { id: 'b', text: 'Quickly' },
  ],
  key: { optionId: 'a' },
  skillKey: 'verbal',
  difficulty: 0.35,
  ...patch,
});

const paramSpec = (patch: Record<string, unknown> = {}) => ({
  params: { a: { kind: 'int', min: 2, max: 40, step: 1 } },
  derived: { s: 'a + 1' },
  constraints: [],
  stem: '[synthetic] What is {{a}} plus one?',
  options: [
    { id: 'a', text: '{{s}}' },
    { id: 'b', text: '{{a}}' },
  ],
  correctOptionId: 'a',
  count: 5,
  ...patch,
});

const setup = (roles?: string[], aal: 'aal1' | 'aal2' = 'aal1') => {
  const db = a2aDb(roles === undefined ? {} : { roles });
  const caller = callerOf({ aal, amr: aal === 'aal2' ? ['totp'] : ['otp'] });
  const { call } = harness(
    (org) => createBankRoutes({ org, variants: () => fakeVariants }),
    db,
    caller,
  );
  return { db, call };
};

describe('POST …/bank/items', () => {
  it('creates an item and its draft version with the R5-49 a hash and the key, in the default workspace', async () => {
    const { db, call } = setup();
    const res = await call('POST', '/bank/items', mcq());
    expect(res.status).toBe(201);
    const body = BankItemCreateResponse.parse(await res.json());
    expect(body.status).toBe('draft');
    expect(body.origin).toBe('human');
    expect(body.workspaceId).toBe(WS);
    expect(body.content).toMatchObject({ format: 'mcq', key: { optionId: 'a' } });
    const [version] = db.tables.item_versions ?? [];
    expect(version?.content_sha256).toBe(
      await itemContentSha256({
        format: 'mcq',
        stem: mcq().stem,
        options: [
          { id: 'a', text: 'Table' },
          { id: 'b', text: 'Quickly' },
        ],
        media: null,
        paramSpec: null,
      }),
    );
    // The origin is never sent: the guard sets it from the write path (carried n-3).
    const insert = db.calls.find((c) => c.method === 'insert' && c.table === 'item_versions');
    expect(insert).toBeDefined();
    expect(db.tables.item_answer_keys).toEqual([
      expect.objectContaining({ item_version_id: version?.id, key: { option_id: 'a' } }),
    ]);
  });

  it('writes into the named workspace and refuses an image of another org', async () => {
    const { db, call } = setup();
    const ok = await call('POST', '/bank/items', { ...mcq(), workspaceId: WS2 });
    expect(ok.status).toBe(201);
    expect((await jsonOf(ok)).workspaceId).toBe(WS2);
    const foreign = await call('POST', '/bank/items', {
      ...mcq(),
      media: [{ key: `item-media/${LIBRARY_ORG}/${'ab'.repeat(32)}.png`, alt: 'A chart' }],
    });
    expect(foreign.status).toBe(400);
    expect(db.tables.items?.length).toBe(1);
  });

  it('creates a written item with its rubric and no key', async () => {
    const { db, call } = setup();
    const res = await call('POST', '/bank/items', {
      format: 'written',
      stem: '[synthetic] Describe a calm reply to a customer.',
      rubricVersionId: RUBRIC,
      skillKey: 'written_communication',
      difficulty: 0.5,
    });
    expect(res.status).toBe(201);
    const body = BankItemDetail.parse(await res.json());
    expect(body.content).toMatchObject({ format: 'written', rubricVersionId: RUBRIC });
    expect(db.tables.item_answer_keys).toEqual([]);
  });

  it('refuses a param spec the generator cannot take (a reserved name) and a key that is not its correct option', async () => {
    const { db, call } = setup();
    const reserved = await call(
      'POST',
      '/bank/items',
      mcq({
        paramSpec: paramSpec({
          params: { min: { kind: 'int', min: 1, max: 9, step: 1 } },
          derived: {},
          stem: '[synthetic] {{min}}',
          options: [
            { id: 'a', text: '{{min}}' },
            { id: 'b', text: 'none' },
          ],
        }) as never,
      }),
    );
    expect(reserved.status).toBe(400);
    expect(await codeOf(reserved)).toBe('bad_request');
    const wrongKey = await call(
      'POST',
      '/bank/items',
      mcq({ key: { optionId: 'b' }, paramSpec: paramSpec() as never }),
    );
    expect(wrongKey.status).toBe(400);
    expect(db.tables.items).toEqual([]);
  });

  it('stores a parameterised item with its spec and no item key (the variants carry the keys)', async () => {
    const { db, call } = setup();
    const res = await call('POST', '/bank/items', mcq({ paramSpec: paramSpec() as never }));
    expect(res.status).toBe(201);
    const body = BankItemDetail.parse(await res.json());
    expect(body.isParameterised).toBe(true);
    expect(body.content).toMatchObject({ key: { optionId: 'a' } });
    expect(db.tables.item_answer_keys).toEqual([]);
  });

  it('answers 503 for a parameterised write when no variant engine is bound', async () => {
    const db = a2aDb();
    const { call } = harness((org) => createBankRoutes({ org, variants: () => null }), db);
    const res = await call('POST', '/bank/items', mcq({ paramSpec: paramSpec() as never }));
    expect(res.status).toBe(503);
    expect(db.tables.items).toEqual([]);
    expect((await call('POST', '/bank/items', mcq())).status).toBe(201);
  });

  it('undoes the item when its version is refused, and never echoes the stem', async () => {
    const { db, call } = setup();
    db.failNext('insert', 'item_versions', new RestError(400, '23514'));
    const res = await call('POST', '/bank/items', mcq());
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain('noun');
    expect(db.tables.items).toEqual([]);
  });

  it('is for owners, admins and recruiters only', async () => {
    const { call } = setup(['reviewer'], 'aal2');
    const res = await call('POST', '/bank/items', mcq());
    expect(res.status).toBe(404);
  });
});

describe('GET …/bank/items/:itemId', () => {
  it('answers the latest version with its key and its exposure count', async () => {
    const { db, call } = setup();
    const v1 = seedVersion(db);
    const v2 = seedVersion(db, { item_id: v1.item_id, version_no: 2, status: 'draft' });
    (db.tables.v_item_exposure ??= []).push({
      org_id: ORG,
      workspace_id: WS,
      item_id: v1.item_id,
      served_count: 7,
    });
    const res = await call('GET', `/bank/items/${String(v1.item_id)}`);
    expect(res.status).toBe(200);
    const body = BankItemDetail.parse(await res.json());
    expect(body.itemVersionId).toBe(v2.id);
    expect(body.versionNo).toBe(2);
    expect(body.exposureCount).toBe(7);
    expect(body.content).toMatchObject({ key: { optionId: 'a' } });
  });

  it('never shows the key or the param spec of a library copy (I-M1-5)', async () => {
    const { db, call } = setup();
    const v = seedVersion(db, {
      origin: 'library',
      source_item_version_id: 'c5000000-0000-4000-8000-000000000001',
    });
    const res = await call('GET', `/bank/items/${String(v.item_id)}`);
    expect(res.status).toBe(200);
    const body = BankItemDetail.parse(await res.json());
    expect(body.librarySourced).toBe(true);
    expect(body.content).not.toHaveProperty('key');
    expect(JSON.stringify(body)).not.toContain('option_id');
  });

  it('answers 404 for an unknown or malformed id', async () => {
    const { call } = setup();
    expect((await call('GET', '/bank/items/c3000000-0000-4000-8000-0000000000ff')).status).toBe(
      404,
    );
    expect((await call('GET', '/bank/items/not-a-uuid')).status).toBe(404);
  });
});

describe('PUT …/bank/items/:itemId', () => {
  it('edits the draft version content, hash and key', async () => {
    const { db, call } = setup();
    const created = await jsonOf<{ itemId: string }>(await call('POST', '/bank/items', mcq()));
    const res = await call(
      'PUT',
      `/bank/items/${created.itemId}`,
      mcq({ stem: '[synthetic] Which word is a verb?', key: { optionId: 'b' } }),
    );
    expect(res.status).toBe(200);
    const body = BankItemDetail.parse(await res.json());
    expect(body.content).toMatchObject({ stem: '[synthetic] Which word is a verb?' });
    expect(body.content).toMatchObject({ key: { optionId: 'b' } });
    expect(db.tables.item_versions?.[0]?.content_sha256).not.toBe('cd'.repeat(32));
  });

  it('answers 409 when the latest version has left draft (an edit is a new version, I-M1-3)', async () => {
    const { db, call } = setup();
    const v = seedVersion(db, { status: 'in_review' });
    const res = await call('PUT', `/bank/items/${String(v.item_id)}`, mcq());
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('conflict');
  });

  it('refuses a format change and a workspace move', async () => {
    const { db, call } = setup();
    const v = seedVersion(db, { status: 'draft' });
    const written = await call('PUT', `/bank/items/${String(v.item_id)}`, {
      format: 'written',
      stem: '[synthetic] x',
      rubricVersionId: RUBRIC,
      skillKey: 'verbal',
      difficulty: 0.4,
    });
    expect(written.status).toBe(400);
    const moved = await call('PUT', `/bank/items/${String(v.item_id)}`, {
      ...mcq(),
      workspaceId: WS2,
    });
    expect(moved.status).toBe(400);
  });
});

describe('POST …/bank/items/:itemId/versions', () => {
  it('clones the latest approved version into a new draft with its key (Q23, E5)', async () => {
    const { db, call } = setup();
    const v1 = seedVersion(db);
    const res = await call('POST', `/bank/items/${String(v1.item_id)}/versions`);
    expect(res.status).toBe(201);
    const body = BankItemCreateResponse.parse(await res.json());
    expect(body.versionNo).toBe(2);
    expect(body.approvedBy).toBeNull();
    expect(body.content).toMatchObject({ stem: v1.stem, key: { optionId: 'a' } });
    expect(v1.status).toBe('approved');
  });

  it('answers 409 while a version is still open, and for a library copy', async () => {
    const { db, call } = setup();
    const open = seedVersion(db, { status: 'draft' });
    expect((await call('POST', `/bank/items/${String(open.item_id)}/versions`)).status).toBe(409);
    const lib = seedVersion(db, {
      origin: 'library',
      source_item_version_id: 'c5000000-0000-4000-8000-000000000001',
    });
    expect((await call('POST', `/bank/items/${String(lib.item_id)}/versions`)).status).toBe(409);
  });
});

describe('POST …/bank/item-versions/:id/submit', () => {
  it('moves a draft to in_review', async () => {
    const { db, call } = setup();
    const v = seedVersion(db, { status: 'draft' });
    const res = await call('POST', `/bank/item-versions/${String(v.id)}/submit`);
    expect(res.status).toBe(200);
    expect(BankItemDetail.parse(await res.json()).status).toBe('in_review');
  });

  it('generates and stores the variants of a parameterised draft before the status change (§6.3)', async () => {
    const { db, call } = setup();
    const saved: { p_item_version: unknown; p_variants: unknown[] }[] = [];
    db.functions.save_item_variants = (args, d) => {
      saved.push(args as never);
      for (const v of args.p_variants as { variantNo: number }[]) {
        (d.tables.item_variants ??= []).push({
          item_version_id: args.p_item_version,
          variant_no: v.variantNo,
        });
      }
      return (args.p_variants as unknown[]).length;
    };
    const created = await jsonOf<{ itemVersionId: string }>(
      await call('POST', '/bank/items', mcq({ paramSpec: paramSpec() as never })),
    );
    const res = await call('POST', `/bank/item-versions/${created.itemVersionId}/submit`);
    expect(res.status).toBe(200);
    expect(saved).toHaveLength(1);
    const variants = saved[0]?.p_variants as {
      variantNo: number;
      difficulty: number;
      correctOptionId: string;
      contentSha256: string;
      options: { id: string; text: string }[];
    }[];
    expect(variants.map((v) => v.variantNo)).toEqual([1, 2, 3, 4, 5]);
    for (const v of variants) {
      expect(v.difficulty).toBe(0.35);
      expect(v.correctOptionId).toBe('a');
      expect(v.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(v.options.map((o) => o.id)).toEqual(['a', 'b']);
    }
  });

  it('answers 409 for a version that is not a draft', async () => {
    const { db, call } = setup();
    const v = seedVersion(db);
    const res = await call('POST', `/bank/item-versions/${String(v.id)}/submit`);
    expect(res.status).toBe(409);
  });
});

describe('POST …/bank/item-versions/:id/review', () => {
  it('approves (the database records the approver) and sends back as not_approved (R5-22)', async () => {
    const { db, call } = setup(['reviewer'], 'aal2');
    const a = seedVersion(db, { status: 'in_review' });
    const ok = await call('POST', `/bank/item-versions/${String(a.id)}/review`, {
      itemVersionId: a.id,
      decision: 'approve',
    });
    expect(ok.status).toBe(200);
    const body = BankItemDetail.parse(await ok.json());
    expect(body.status).toBe('approved');
    expect(body.approvedBy).not.toBeNull();
    const b = seedVersion(db, { status: 'in_review' });
    const back = await call('POST', `/bank/item-versions/${String(b.id)}/review`, {
      itemVersionId: b.id,
      decision: 'not_approved',
    });
    expect(BankItemDetail.parse(await back.json()).status).toBe('not_approved');
  });

  it('refuses a body id that differs from the path id', async () => {
    const { db, call } = setup();
    const a = seedVersion(db, { status: 'in_review' });
    const res = await call('POST', `/bank/item-versions/${String(a.id)}/review`, {
      itemVersionId: 'c4000000-0000-4000-8000-0000000000ff',
      decision: 'approve',
    });
    expect(res.status).toBe(400);
    expect(a.status).toBe('in_review');
  });

  it('answers 409 when the version is not in review', async () => {
    const { db, call } = setup();
    const a = seedVersion(db, { status: 'draft' });
    const res = await call('POST', `/bank/item-versions/${String(a.id)}/review`, {
      itemVersionId: a.id,
      decision: 'approve',
    });
    expect(res.status).toBe(409);
  });

  it('a reviewer at aal1 is asked for aal2', async () => {
    const { db, call } = setup(['reviewer'], 'aal1');
    const a = seedVersion(db, { status: 'in_review' });
    const res = await call('POST', `/bank/item-versions/${String(a.id)}/review`, {
      itemVersionId: a.id,
      decision: 'approve',
    });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('aal2_required');
  });
});

describe('POST …/bank/item-versions/:id/retire', () => {
  it('retires an approved version and answers 409 for a draft', async () => {
    const { db, call } = setup();
    const a = seedVersion(db);
    const ok = await call('POST', `/bank/item-versions/${String(a.id)}/retire`);
    expect(ok.status).toBe(200);
    expect(BankItemDetail.parse(await ok.json()).status).toBe('retired');
    const d = seedVersion(db, { status: 'draft' });
    expect((await call('POST', `/bank/item-versions/${String(d.id)}/retire`)).status).toBe(409);
  });
});

describe('GET …/bank/items', () => {
  it('lists bank versions newest first with filters and no key', async () => {
    const { db, call } = setup();
    seedVersion(db, { status: 'in_review', difficulty: 0.2 });
    seedVersion(db, { status: 'in_review', difficulty: 0.6 });
    seedVersion(db, { status: 'approved', difficulty: 0.4 });
    const res = await call(
      'GET',
      '/bank/items?status=in_review&difficultyMin=0.1&difficultyMax=0.3',
    );
    expect(res.status).toBe(200);
    const body = BankItemListResponse.parse(await res.json());
    expect(body.items.map((i) => i.difficulty)).toEqual([0.2]);
    expect(JSON.stringify(body)).not.toContain('option_id');
    const all = BankItemListResponse.parse(await (await call('GET', '/bank/items')).json());
    expect(all.items.map((i) => i.difficulty)).toEqual([0.4, 0.6, 0.2]);
  });

  it('pages with the keyset cursor (PAGE_SIZE 50)', async () => {
    const { db, call } = setup();
    for (let n = 0; n < 51; n += 1) seedVersion(db);
    const first = BankItemListResponse.parse(await (await call('GET', '/bank/items')).json());
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = BankItemListResponse.parse(
      await (await call('GET', `/bank/items?cursor=${String(first.nextCursor)}`)).json(),
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('filters by pool and refuses an unknown filter', async () => {
    const { db, call } = setup();
    const a = seedVersion(db);
    seedVersion(db);
    const pool = 'c6000000-0000-4000-8000-000000000001';
    (db.tables.pool_items ??= []).push({ org_id: ORG, pool_id: pool, item_version_id: a.id });
    const body = BankItemListResponse.parse(
      await (await call('GET', `/bank/items?poolId=${pool}`)).json(),
    );
    expect(body.items.map((i) => i.itemVersionId)).toEqual([a.id]);
    expect((await call('GET', '/bank/items?sort=stem')).status).toBe(400);
  });
});
