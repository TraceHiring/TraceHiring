// AT-M1-20, AT-M1-29 and the package v2 publish (spec m1 §5 TestPackageV2, §6.5, R3-2, R5-56 a/d, R5-57 a, R5-58,
// R5-60 a/e, DB-M1-1, E4, E22). The package is built from the live pool (approved pool items of pool sections, inline
// items of inline sections), parsed with TestPackageV2 before upload, and carries no key: keys present in the database
// never reach the JSON. Media keep their stored object path (a library copy keeps the library org's prefix); option
// `text` becomes the package `label`; skill and difficulty band are copied together or both omitted; exposure is the
// count read at build. The publish update carries the snapshot digest; a 40001 with the snapshot guard text is retried
// with a rebuild, at most 3 times, then 409. Runs on the fake PostgREST of tests.test-helpers.ts.
import { captureSignalsFor } from '@trace/shared';
import { TestPackageV2 } from '@trace/shared/contracts/candidate';
import { PublishTestResponse } from '@trace/shared/contracts/d1';
import { TestDraftView, type SaveTestDraftRequest } from '@trace/shared/contracts/m1';
import { snapshotDigest } from '@trace/shared/item-hash';
import { difficultyBand } from '@trace/item-delivery';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../candidate/encoding.js';
import { RestError } from './org-context.js';
import {
  LIBRARY_ORG,
  ORG,
  STANDARD,
  STRICT,
  authoringDb,
  draftBody,
  fakeBucket,
  rowsOf,
  saveBody,
  seedPool,
  setSettings,
  testsApp,
} from './tests.test-helpers.js';

const MCQ_POOL = '90000000-0000-4000-8000-000000000001';
const WRITTEN_POOL = '90000000-0000-4000-8000-000000000002';

type Section = SaveTestDraftRequest['sections'][number];
const poolSection = (patch: Partial<Section>): Section => ({
  mode: 'pool',
  format: 'mcq',
  name: 'Drawn',
  weight: 30,
  items: [],
  shuffleItems: true,
  shuffleOptions: true,
  navigation: 'free',
  ...patch,
});

const setup = async (opts: {
  settings?: Record<string, string>;
  sections?: Section[];
  seed?: (db: ReturnType<typeof authoringDb>) => void;
}) => {
  const db = authoringDb();
  const bucket = fakeBucket();
  const { call } = testsApp(db, bucket);
  const created = TestDraftView.parse(
    await (await call('POST', `/v1/orgs/${ORG}/tests`, { name: 'Synthetic Test' })).json(),
  );
  const testId = created.test.id;
  const versionId = created.version.id;
  opts.seed?.(db);
  setSettings(db, versionId, opts.settings ?? { ...STANDARD }, 'standard');
  const base = saveBody();
  const sections = opts.sections ?? [
    { ...base.sections[0]!, weight: 30 },
    { ...base.sections[1]!, weight: 40 },
    poolSection({ poolId: MCQ_POOL, drawCount: 2 }),
  ];
  const put = await call('PUT', `/v1/orgs/${ORG}/tests/${testId}/draft`, { ...base, sections });
  expect(put.status).toBe(200);
  const publish = () =>
    call('POST', `/v1/orgs/${ORG}/tests/${testId}/publish`, { testVersionId: versionId });
  const pkgText = () => bucket.objects.get(`packages/${versionId}.json`) ?? '';
  return { db, bucket, call, testId, versionId, publish, pkgText };
};

const mcqPool =
  (count = 3, extra: Partial<Parameters<typeof seedPool>[1]> = {}) =>
  (db: ReturnType<typeof authoringDb>) =>
    seedPool(db, { poolId: MCQ_POOL, format: 'mcq', count, prefix: 'a7', ...extra });

const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe('package v2 (AT-M1-20, AT-M1-29)', () => {
  it('builds v2 from inline items and the approved pool items, parses as TestPackageV2, holds no key', async () => {
    const s = await setup({
      seed: (db) => {
        mcqPool(3)(db);
        // Not approved: never in the package or the snapshot (an AI draft in review, a retired version).
        seedPool(db, {
          poolId: MCQ_POOL,
          format: 'mcq',
          count: 1,
          prefix: 'a8',
          status: 'in_review',
          origin: 'ai_draft',
        });
        seedPool(db, {
          poolId: MCQ_POOL,
          format: 'mcq',
          count: 1,
          prefix: 'a9',
          status: 'retired',
        });
      },
    });
    const res = await s.publish();
    expect(res.status).toBe(200);
    const body = PublishTestResponse.parse(await res.json());
    const text = s.pkgText();
    expect(await sha256Hex(text)).toBe(body.contentSha256);
    const pkg = TestPackageV2.parse(JSON.parse(text));
    expect(pkg).toMatchObject({
      v: 2,
      testVersionId: s.versionId,
      title: 'Synthetic Support Test',
      language: 'en',
      durationSeconds: 1200,
      heartbeatSeconds: 10,
      captureSignals: captureSignalsFor({ ...STANDARD }, 'm1-settings-v1'),
    });
    expect(pkg.sections.map((x) => [x.position, x.format, x.navigation, x.draw])).toEqual([
      [1, 'mcq', 'free', null],
      [2, 'written', 'forward_only', null],
      [3, 'mcq', 'free', { count: 2, strata: [] }],
    ]);
    // DB-M1-1: the written section's paste rule is the settings' paste_written.
    expect(pkg.sections[1]?.pasteRule).toBe('allowed_logged');
    const poolIds = pkg.items.filter((i) => i.sectionId === pkg.sections[2]?.id);
    expect(poolIds.map((i) => i.itemVersionId)).toEqual([
      'a7000000-0000-4000-8000-000000000001',
      'a7000000-0000-4000-8000-000000000002',
      'a7000000-0000-4000-8000-000000000003',
    ]);
    // AT-M1-29: the package's item ids are exactly the snapshot's.
    const snap = rowsOf(s.db, 'section_pool_snapshot');
    expect(new Set(pkg.items.map((i) => i.itemVersionId))).toEqual(
      new Set(snap.map((r) => r.item_version_id)),
    );
    // AT-M1-20: no key anywhere in the JSON, though keys exist for every mcq item.
    expect(rowsOf(s.db, 'item_answer_keys').length).toBeGreaterThan(3);
    expect(text).not.toMatch(/"(key|answer|correct[A-Za-z]*|option_id|rubric[A-Za-z]*)"/);
    // option text -> label
    expect(poolIds[0]?.options).toEqual([
      { id: 'a', label: 'Option A 1' },
      { id: 'b', label: 'Option B 1' },
    ]);
  });

  it('the publish update carries the snapshot digest of the rows it used (R5-56 d, R5-60 a)', async () => {
    const s = await setup({ seed: mcqPool(3) });
    expect((await s.publish()).status).toBe(200);
    const pkg = TestPackageV2.parse(JSON.parse(s.pkgText()));
    const expected = await snapshotDigest(
      pkg.items.map((i) => ({ sectionId: i.sectionId, itemVersionId: i.itemVersionId })),
    );
    const row = rowsOf(s.db, 'test_versions').find((v) => v.id === s.versionId);
    expect(row).toMatchObject({
      status: 'published',
      package_version: 2,
      snapshot_digest: expected,
    });
  });

  it('skill and difficulty band are copied together, or both omitted (R5-58); exposure is read at build (R5-60 a)', async () => {
    const s = await setup({
      seed: (db) => {
        mcqPool(2)(db);
        rowsOf(db, 'v_item_exposure').push({
          org_id: ORG,
          workspace_id: '',
          item_id: 'a7100000-0000-4000-8000-000000000002',
          served_count: 7,
        });
      },
    });
    expect((await s.publish()).status).toBe(200);
    const pkg = TestPackageV2.parse(JSON.parse(s.pkgText()));
    const pool = pkg.items.filter((i) => i.sectionId === pkg.sections[2]?.id);
    expect(pool.map((i) => [i.skillKey, i.difficultyBand, i.exposureAtPublish])).toEqual([
      ['verbal', difficultyBand(0.45), 0],
      ['verbal', difficultyBand(0.45), 7],
    ]);
    // Inline D1-style items have no skill or difficulty: both omitted.
    const inline = pkg.items.find((i) => i.sectionId === pkg.sections[0]?.id);
    expect(inline).not.toHaveProperty('skillKey');
    expect(inline).not.toHaveProperty('difficultyBand');
    expect(inline?.exposureAtPublish).toBe(0);
    // The snapshot keeps the count frozen by the publish statement; the package value is never above it.
    for (const item of pkg.items) {
      const snap = rowsOf(s.db, 'section_pool_snapshot').find(
        (r) => r.item_version_id === item.itemVersionId,
      );
      expect(item.exposureAtPublish).toBeLessThanOrEqual(Number(snap?.exposure_at_publish));
    }
  });

  it('media keep their stored object path: a library copy keeps the library org prefix (R5-56 a)', async () => {
    const s = await setup({ seed: mcqPool(2, { origin: 'library', mediaOrg: LIBRARY_ORG }) });
    expect((await s.publish()).status).toBe(200);
    const pkg = TestPackageV2.parse(JSON.parse(s.pkgText()));
    const item = pkg.items.find((i) => i.media !== undefined);
    expect(item?.media).toEqual([
      {
        hash: 'ab'.repeat(32),
        ext: 'png',
        alt: 'A synthetic chart',
        objectPath: `item-media/${LIBRARY_ORG}/${'ab'.repeat(32)}.png`,
      },
    ]);
  });

  it('parameterised pool items carry their variants, options as labels, never a variant key', async () => {
    const s = await setup({
      seed: (db) => {
        const [first] = mcqPool(2)(db);
        if (first === undefined) throw new Error('fixture');
        first.is_parameterised = true;
        for (const n of [1, 2]) {
          rowsOf(db, 'item_variants').push({
            id: `a6000000-0000-4000-8000-00000000000${n}`,
            org_id: ORG,
            item_version_id: first.id,
            variant_no: n,
            stem: `[synthetic] Variant ${n}`,
            options: [
              { id: 'a', text: `${n}0` },
              { id: 'b', text: `${n}1` },
            ],
            difficulty: 0.45,
          });
          rowsOf(db, 'item_variant_keys').push({
            org_id: ORG,
            item_variant_id: `a6000000-0000-4000-8000-00000000000${n}`,
            key: { option_id: 'b' },
          });
        }
      },
    });
    expect((await s.publish()).status).toBe(200);
    const text = s.pkgText();
    const pkg = TestPackageV2.parse(JSON.parse(text));
    const item = pkg.items.find((i) => i.variants !== undefined);
    expect(item?.variants).toEqual([
      {
        variantId: 'a6000000-0000-4000-8000-000000000001',
        prompt: '[synthetic] Variant 1',
        options: [
          { id: 'a', label: '10' },
          { id: 'b', label: '11' },
        ],
      },
      {
        variantId: 'a6000000-0000-4000-8000-000000000002',
        prompt: '[synthetic] Variant 2',
        options: [
          { id: 'a', label: '20' },
          { id: 'b', label: '21' },
        ],
      },
    ]);
    expect(text).not.toContain('option_id');
  });

  it('captureSignals follow the settings (fullscreen_tab_focus off: no tab or fullscreen signals)', async () => {
    const s = await setup({
      seed: mcqPool(2),
      settings: { ...STRICT, fullscreen_tab_focus: 'off' },
    });
    expect((await s.publish()).status).toBe(200);
    const pkg = TestPackageV2.parse(JSON.parse(s.pkgText()));
    expect(pkg.captureSignals).not.toContain('tab_hidden');
    expect(pkg.captureSignals).not.toContain('fullscreen_exit');
    expect(pkg.captureSignals).toContain('paste');
    expect(pkg.sections[1]?.pasteRule).toBe('blocked');
  });
});

describe('publish v2 failures', () => {
  it('a pool smaller than its draw is 422 pool_too_small before any R2 write (E4)', async () => {
    const s = await setup({ seed: mcqPool(1) });
    const res = await s.publish();
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('pool_too_small');
    expect(s.bucket.puts).toEqual([]);
  });

  it('retries a snapshot conflict with a rebuild, at most 3 times, then 409 (R5-56 d, R5-60 e)', async () => {
    const s = await setup({ seed: mcqPool(3) });
    const snapshotConflict = () => new RestError(409, '40001', 'snapshot_changed');
    for (let n = 0; n < 4; n += 1) s.db.failNext('update', 'test_versions', snapshotConflict());
    const before = s.db.calls.length;
    const res = await s.publish();
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('conflict');
    const calls = s.db.calls.slice(before);
    const updates = calls.filter((c) => c.method === 'update' && c.table === 'test_versions');
    expect(updates).toHaveLength(4);
    // Each attempt rebuilt from the live pool first (one source call each, R5-65).
    expect(calls.filter((c) => c.method === 'rpc' && c.table === 'publish_source_v2')).toHaveLength(
      4,
    );
    expect(rowsOf(s.db, 'test_versions').find((v) => v.id === s.versionId)?.status).toBe('draft');
  });

  it('a pool change between build and publish is absorbed by the retry: the rebuilt package matches the snapshot', async () => {
    const s = await setup({ seed: mcqPool(3) });
    const hooks = s.db.hooks.test_versions;
    const original = hooks?.update;
    let first = true;
    if (hooks !== undefined && original !== undefined) {
      hooks.update = (old, next, d) => {
        if (first && next.status === 'published') {
          first = false;
          // Another recruiter adds an approved item to the pool after this build.
          seedPool(d, { poolId: MCQ_POOL, format: 'mcq', count: 1, prefix: 'b3' });
        }
        return original(old, next, d);
      };
    }
    const res = await s.publish();
    expect(res.status).toBe(200);
    const pkg = TestPackageV2.parse(JSON.parse(s.pkgText()));
    expect(pkg.items.map((i) => i.itemVersionId)).toContain('b3000000-0000-4000-8000-000000000001');
    expect(new Set(pkg.items.map((i) => i.itemVersionId))).toEqual(
      new Set(rowsOf(s.db, 'section_pool_snapshot').map((r) => r.item_version_id)),
    );
  });

  it('40001 without the snapshot guard text is not retried (R5-60 e)', async () => {
    const s = await setup({ seed: mcqPool(3) });
    s.db.failNext('update', 'test_versions', new RestError(409, '40001', null));
    const before = s.db.calls.length;
    const res = await s.publish();
    expect(res.status).not.toBe(200);
    expect(
      s.db.calls.slice(before).filter((c) => c.method === 'update' && c.table === 'test_versions'),
    ).toHaveLength(1);
  });

  it('a lock that forbids the stored settings is 409 setting_locked at publish (E16)', async () => {
    const s = await setup({ seed: mcqPool(3) });
    rowsOf(s.db, 'org_integrity_locks').push({
      id: '0c000000-0000-4000-8000-000000000001',
      org_id: ORG,
      setting_key: 'paste_written',
      locked_value: 'blocked',
    });
    const res = await s.publish();
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('setting_locked');
  });

  it('a v2 draft without its navigation or settings is 422 draft_incomplete before any R2 write', async () => {
    const s = await setup({ seed: mcqPool(3) });
    setSettings(s.db, s.versionId, null);
    const res = await s.publish();
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('draft_incomplete');
    expect(s.bucket.puts).toEqual([]);
  });

  it('a package over 5 MB is 422 package_too_large (E22)', async () => {
    const s = await setup({
      seed: (db) => {
        const rows = mcqPool(1300)(db);
        for (const r of rows) r.stem = `[synthetic] ${'w'.repeat(3980)}`;
      },
      sections: [
        { ...saveBody().sections[1]!, weight: 50 },
        poolSection({ poolId: MCQ_POOL, drawCount: 2, weight: 50 }),
      ],
    });
    const res = await s.publish();
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('package_too_large');
    expect(s.bucket.puts).toEqual([]);
  });

  it('a written pool draws approved written items; the version publishes as v2', async () => {
    const s = await setup({
      seed: (db) => {
        seedPool(db, { poolId: WRITTEN_POOL, format: 'written', count: 2, prefix: 'c4' });
        rowsOf(db, 'rubric_versions').push({
          id: '7b900000-0000-4000-8000-000000000001',
          org_id: ORG,
          criteria: [],
        });
      },
      sections: [
        { ...saveBody().sections[0]!, weight: 50 },
        poolSection({
          format: 'written',
          poolId: WRITTEN_POOL,
          drawCount: 1,
          weight: 50,
          shuffleOptions: false,
          navigation: 'forward_only',
        }),
      ],
    });
    const res = await s.publish();
    expect(res.status).toBe(200);
    const pkg = TestPackageV2.parse(JSON.parse(s.pkgText()));
    expect(pkg.sections[1]).toMatchObject({ format: 'written', pasteRule: 'allowed_logged' });
    expect(pkg.items.filter((i) => i.kind === 'written')).toHaveLength(2);
  });
});

const ITEM_1 = 'a7100000-0000-4000-8000-000000000001';
const served = (db: ReturnType<typeof authoringDb>, count: number) =>
  rowsOf(db, 'v_item_exposure').push({
    org_id: ORG,
    workspace_id: '',
    item_id: ITEM_1,
    served_count: count,
  });
const versionRow = (s: { db: ReturnType<typeof authoringDb>; versionId: string }) =>
  rowsOf(s.db, 'test_versions').find((v) => v.id === s.versionId);

describe('two publishers of one v2 draft (fix round 1 #1, E2): the stored package is always the frozen one', () => {
  it('a loser that read the bucket before the winner wrote never lands its put (exposure changed between builds)', async () => {
    const s = await setup({ seed: mcqPool(3) });
    let raced = false;
    let winner: { contentSha256: string } | undefined;
    s.bucket.beforeWrite = async () => {
      if (raced) return;
      raced = true;
      // An item is served between the two builds: the winner's package differs from the loser's.
      served(s.db, 4);
      const w = await s.publish();
      expect(w.status).toBe(200);
      winner = PublishTestResponse.parse(await w.json());
    };
    const loser = await s.publish();
    expect(loser.status).toBe(409);
    expect(versionRow(s)).toMatchObject({
      status: 'published',
      content_sha256: winner?.contentSha256,
    });
    expect(await sha256Hex(s.pkgText())).toBe(winner?.contentSha256);
  });

  it("a loser that read the winner's first write never lands its put after the winner's check", async () => {
    const s = await setup({ seed: mcqPool(3) });
    const hooks = s.db.hooks.test_versions;
    const original = hooks?.update;
    if (hooks === undefined || original === undefined) throw new Error('fixture');
    let loser: Promise<Response> | undefined;
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    hooks.update = async (old, next, d) => {
      if (next.status === 'published' && loser === undefined) {
        // The winner's put has landed; before its UPDATE commits, a second publisher reads the bucket and the
        // still-open draft, builds with one more served item, and stalls just before its own write.
        served(s.db, 4);
        let reached = () => {};
        const atWrite = new Promise<void>((r) => {
          reached = r;
        });
        s.bucket.beforeWrite = async () => {
          s.bucket.beforeWrite = undefined;
          reached();
          await gate;
        };
        loser = Promise.resolve(s.publish());
        await atWrite;
      }
      return original(old, next, d);
    };
    const w = await s.publish();
    expect(w.status).toBe(200);
    const winner = PublishTestResponse.parse(await w.json());
    release();
    const l = await (loser ?? Promise.reject(new Error('no second publisher')));
    expect(l.status).toBe(409);
    expect(versionRow(s)?.content_sha256).toBe(winner.contentSha256);
    expect(await sha256Hex(s.pkgText())).toBe(winner.contentSha256);
  });

  it('the losing publisher path: its UPDATE finds no draft, it answers 409 and the frozen package stays', async () => {
    const s = await setup({ seed: mcqPool(3) });
    let winner: { contentSha256: string } | undefined;
    s.bucket.afterWrite = async () => {
      s.bucket.afterWrite = undefined;
      // After the loser's write and before its UPDATE, another publisher (one more served item) wins.
      served(s.db, 2);
      const w = await s.publish();
      expect(w.status).toBe(200);
      winner = PublishTestResponse.parse(await w.json());
    };
    const loser = await s.publish();
    expect(loser.status).toBe(409);
    expect(await codeOf(loser)).toBe('conflict');
    expect(versionRow(s)?.content_sha256).toBe(winner?.contentSha256);
    expect(await sha256Hex(s.pkgText())).toBe(winner?.contentSha256);
  });
});

describe('the frozen rebuild differs after the update (AT-M1-29, fix round 1 #6): 500 and retired', () => {
  const afterPublish = (
    s: Awaited<ReturnType<typeof setup>>,
    change: (d: ReturnType<typeof authoringDb>) => void,
  ) => {
    const hooks = s.db.hooks.test_versions;
    const original = hooks?.update;
    if (hooks === undefined || original === undefined) throw new Error('fixture');
    hooks.update = async (old, next, d) => {
      const out = await original(old, next, d);
      if (next.status === 'published') change(s.db);
      return out;
    };
  };

  it('a frozen exposure below the built count retires the version', async () => {
    const s = await setup({
      seed: (db) => {
        mcqPool(3)(db);
        served(db, 5);
      },
    });
    afterPublish(s, (d) => {
      for (const r of rowsOf(d, 'section_pool_snapshot')) {
        if (r.item_version_id === 'a7000000-0000-4000-8000-000000000001') r.exposure_at_publish = 2;
      }
    });
    const res = await s.publish();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: 'internal' } });
    expect(versionRow(s)?.status).toBe('retired');
  });

  it('a pool item changed after the update retires the version', async () => {
    const s = await setup({ seed: mcqPool(3) });
    afterPublish(s, (d) => {
      const item = rowsOf(d, 'item_versions').find(
        (i) => i.id === 'a7000000-0000-4000-8000-000000000002',
      );
      if (item !== undefined) item.stem = '[synthetic] changed after the update';
    });
    const res = await s.publish();
    expect(res.status).toBe(500);
    expect(versionRow(s)?.status).toBe('retired');
  });
});

describe('a locked org: a draft with settings never keeps a null navigation (fix round 1 #5, R5-63 b)', () => {
  it("D1's PUT in a locked org saves the default navigation; the draft publishes as v2", async () => {
    const db = authoringDb();
    rowsOf(db, 'org_integrity_locks').push({
      id: '0c000000-0000-4000-8000-000000000001',
      org_id: ORG,
      setting_key: 'paste_written',
      locked_value: 'blocked',
      locked_by: null,
      locked_at: '2026-10-17T09:00:00.000+00:00',
    });
    const { call } = testsApp(db, fakeBucket(), undefined, {
      reference: () => ({
        settingsCatalog: async () => ({
          catalogVersion: 'm1-settings-v1',
          presets: { standard: { version: 1, values: { ...STANDARD } } },
        }),
        templates: async () => [],
        browse: async () => [],
      }),
    });
    const created = TestDraftView.parse(
      await (await call('POST', `/v1/orgs/${ORG}/tests`, { name: 'Synthetic Test' })).json(),
    );
    const put = await call('PUT', `/v1/orgs/${ORG}/tests/${created.test.id}`, draftBody());
    expect(put.status).toBe(200);
    const view = TestDraftView.parse(await put.json());
    expect(view.version.sections.map((x) => [x.format, x.navigation, x.pasteRule])).toEqual([
      ['mcq', 'free', undefined],
      ['written', 'forward_only', 'blocked'],
    ]);
    const res = await call('POST', `/v1/orgs/${ORG}/tests/${created.test.id}/publish`, {
      testVersionId: created.version.id,
    });
    expect(res.status).toBe(200);
    expect(rowsOf(db, 'test_versions')[0]).toMatchObject({
      status: 'published',
      package_version: 2,
    });
  });
});

describe('one-call package source (R5-65, R5-63 f): publish_source_v2', () => {
  const sourceCalls = (s: Awaited<ReturnType<typeof setup>>, before: number) =>
    s.db.calls.slice(before).filter((c) => c.method === 'rpc' && c.table === 'publish_source_v2');

  it('a v2 publish reads its source with one call per build (live, then frozen), never per row', async () => {
    const s = await setup({ seed: mcqPool(120) });
    const args: unknown[] = [];
    const original = s.db.functions.publish_source_v2!;
    s.db.functions.publish_source_v2 = (a, d) => {
      args.push(a);
      return original(a, d);
    };
    const before = s.db.calls.length;
    const res = await s.publish();
    expect(res.status).toBe(200);
    expect(sourceCalls(s, before)).toHaveLength(2);
    expect(args).toEqual([
      { p_org_id: ORG, p_test_version_id: s.versionId, p_frozen: false },
      { p_org_id: ORG, p_test_version_id: s.versionId, p_frozen: true },
    ]);
    const perRow = s.db.calls
      .slice(before)
      .filter(
        (c) =>
          c.method === 'select' &&
          ['pool_items', 'item_variants', 'v_item_exposure', 'section_pool_snapshot'].includes(
            c.table,
          ),
      );
    expect(perRow).toEqual([]);
    const pkg = TestPackageV2.parse(JSON.parse(s.pkgText()));
    expect(pkg.items.filter((i) => i.sectionId === pkg.sections[2]?.id)).toHaveLength(120);
  });

  it('a null source (version not visible) is 503 unavailable before any R2 write', async () => {
    const s = await setup({ seed: mcqPool(3) });
    s.db.functions.publish_source_v2 = () => null;
    const res = await s.publish();
    expect(res.status).toBe(503);
    expect(await codeOf(res)).toBe('unavailable');
    expect(s.bucket.puts).toEqual([]);
  });

  it('a malformed source is 503 unavailable before any R2 write', async () => {
    const s = await setup({ seed: mcqPool(3) });
    s.db.functions.publish_source_v2 = () => ({
      members: 'x',
      items: [],
      variants: [],
      exposure: [],
    });
    const res = await s.publish();
    expect(res.status).toBe(503);
    expect(s.bucket.puts).toEqual([]);
  });

  it('a member without its item row is 503 unavailable (fail closed, never a smaller package)', async () => {
    const s = await setup({ seed: mcqPool(3) });
    const original = s.db.functions.publish_source_v2!;
    s.db.functions.publish_source_v2 = (a, d) => {
      const src = original(a, d) as { items: unknown[] };
      return { ...src, items: src.items.slice(1) };
    };
    const res = await s.publish();
    expect(res.status).toBe(503);
    expect(s.bucket.puts).toEqual([]);
  });

  it('more than 10,000 members is 503 unavailable', async () => {
    const s = await setup({ seed: mcqPool(3) });
    const original = s.db.functions.publish_source_v2!;
    s.db.functions.publish_source_v2 = (a, d) => {
      const src = original(a, d) as { members: unknown[] };
      const first = src.members[0];
      return { ...src, members: Array.from({ length: 10_001 }, () => first) };
    };
    const res = await s.publish();
    expect(res.status).toBe(503);
    expect(s.bucket.puts).toEqual([]);
  });

  it('a failed source call is 503 unavailable', async () => {
    const s = await setup({ seed: mcqPool(3) });
    s.db.failNext('rpc', 'publish_source_v2', new RestError(503, 'PGRST000'));
    const res = await s.publish();
    expect(res.status).toBe(503);
    expect(s.bucket.puts).toEqual([]);
  });
});
