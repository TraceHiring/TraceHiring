// The draft save guards of spec m1 R5-70 a-c, on both draft PUTs (D1's `PUT …/tests/:testId` and `PUT …/draft`):
// (a) an optional expected version `?version=<testVersionId>`: present and not the open draft's id → 409 conflict and
// nothing written (a stale tab never overwrites a newer draft; D1's E2E support omits it and keeps working); (b) D1's
// PUT keeps D1's shape: 409 when the stored draft has a section D1's editor cannot express; (c) admin locks placed
// after settings were stored (E16): the save compares the paste rule with the locked settings and stores them, so a
// later lock never makes the draft unsavable. Runs on the fake PostgREST of tests.test-helpers.ts.
import { TestDraftView } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import { RestError } from './org-context.js';
import {
  ORG,
  STANDARD,
  authoringDb,
  draftBody,
  rowsOf,
  saveBody,
  seedPool,
  setSettings,
  testsApp,
} from './tests.test-helpers.js';

const POOL = '90000000-0000-4000-8000-000000000001';
const OTHER = 'e1000000-0000-4000-8000-0000000000aa';

const setup = async () => {
  const db = authoringDb();
  const { call } = testsApp(db);
  const created = TestDraftView.parse(
    await (await call('POST', `/v1/orgs/${ORG}/tests`, { name: 'Synthetic Test' })).json(),
  );
  const d1Path = `/v1/orgs/${ORG}/tests/${created.test.id}`;
  return { db, call, d1Path, v2Path: `${d1Path}/draft`, versionId: created.version.id };
};
const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe('the expected version (R5-70 a)', () => {
  it('both PUTs save when ?version names the open draft, and when it is absent (D1 E2E support)', async () => {
    const s = await setup();
    expect((await s.call('PUT', `${s.d1Path}?version=${s.versionId}`, draftBody())).status).toBe(
      200,
    );
    expect((await s.call('PUT', s.d1Path, draftBody())).status).toBe(200);
    expect((await s.call('PUT', `${s.v2Path}?version=${s.versionId}`, saveBody())).status).toBe(
      200,
    );
    expect(
      (await s.call('PUT', `${s.v2Path}?version=${s.versionId.toUpperCase()}`, saveBody())).status,
    ).toBe(200);
    expect((await s.call('PUT', s.v2Path, saveBody())).status).toBe(200);
  });

  it.each([
    ['d1', draftBody],
    ['v2', saveBody],
  ] as const)(
    '%s: another version id is 409 conflict and nothing is written',
    async (which, body) => {
      const s = await setup();
      const path = which === 'd1' ? s.d1Path : s.v2Path;
      const saves = s.db.savePayloads.length;
      for (const version of [OTHER, '', 'not-a-uuid']) {
        const res = await s.call('PUT', `${path}?version=${version}`, body({ name: 'Stale tab' }));
        expect(res.status, version).toBe(409);
        expect(await codeOf(res)).toBe('conflict');
      }
      expect(s.db.savePayloads).toHaveLength(saves);
      expect(rowsOf(s.db, 'tests')[0]?.name).toBe('Synthetic Test');
    },
  );
});

describe("D1's PUT keeps D1's shape (R5-70 b)", () => {
  it('refuses with 409 a stored draft holding a section D1 cannot express, and writes nothing', async () => {
    const shapes = [
      {
        mode: 'pool' as const,
        format: 'mcq' as const,
        name: 'Drawn',
        weight: 10,
        items: [],
        poolId: POOL,
        drawCount: 2,
        shuffleItems: false,
        shuffleOptions: false,
        navigation: 'free' as const,
      },
      { ...saveBody().sections[0]!, shuffleItems: true },
      { ...saveBody().sections[0]!, shuffleOptions: true },
      { ...saveBody().sections[0]!, timeLimitSeconds: 600 },
      { ...saveBody().sections[0]!, navigation: 'forward_only' as const },
    ].map((x) => [x]);
    // Two multiple-choice sections.
    shapes.push([saveBody().sections[0]!, { ...saveBody().sections[0]!, name: 'More choice' }]);
    for (const extra of shapes) {
      const s = await setup();
      seedPool(s.db, { poolId: POOL, format: 'mcq', count: 3, prefix: 'b7' });
      const body = saveBody({ sections: [saveBody().sections[1]!, ...extra] });
      expect((await s.call('PUT', s.v2Path, body)).status).toBe(200);
      const saves = s.db.savePayloads.length;
      const res = await s.call('PUT', s.d1Path, draftBody());
      expect(res.status, JSON.stringify(extra)).toBe(409);
      expect(await codeOf(res)).toBe('conflict');
      expect(s.db.savePayloads).toHaveLength(saves);
    }
  });

  it('a pool section with a blueprint is refused too', async () => {
    const s = await setup();
    seedPool(s.db, { poolId: POOL, format: 'mcq', count: 3, prefix: 'b8' });
    const body = saveBody({
      sections: [
        {
          mode: 'pool',
          format: 'mcq',
          name: 'Drawn',
          weight: 10,
          items: [],
          poolId: POOL,
          drawCount: 2,
          shuffleItems: false,
          shuffleOptions: false,
          navigation: 'free',
          blueprint: { strata: [{ skillKey: 'verbal', difficultyBand: 2, count: 2 }] },
        },
      ],
    });
    expect((await s.call('PUT', s.v2Path, body)).status).toBe(200);
    expect((await s.call('PUT', s.d1Path, draftBody())).status).toBe(409);
  });

  it('accepts a D1-shaped draft, with or without stored settings', async () => {
    const s = await setup();
    expect((await s.call('PUT', s.d1Path, draftBody())).status).toBe(200);
    expect((await s.call('PUT', s.d1Path, draftBody())).status).toBe(200);
    setSettings(s.db, s.versionId, { ...STANDARD }, 'standard');
    // The settings give each section its default navigation and the written one the paste rule (R5-63 b).
    expect((await s.call('PUT', s.v2Path, saveBody())).status).toBe(200);
    const res = await s.call('PUT', s.d1Path, draftBody());
    expect(res.status).toBe(200);
    const view = TestDraftView.parse(await res.json());
    expect(view.version.sections.map((x) => [x.navigation, x.pasteRule])).toEqual([
      ['free', undefined],
      ['forward_only', 'allowed_logged'],
    ]);
  });
});

describe("D1's shape re-checked by the database under its row lock (R5-71 a, R5-70 re-review Low 1)", () => {
  it("D1's PUT asks save_test_draft to re-check the shape; the v2 PUT does not", async () => {
    const s = await setup();
    expect((await s.call('PUT', s.d1Path, draftBody())).status).toBe(200);
    expect(s.db.savePayloads.at(-1)).toMatchObject({ requireD1Shape: true });
    expect((await s.call('PUT', s.v2Path, saveBody())).status).toBe(200);
    expect(s.db.savePayloads.at(-1)).not.toHaveProperty('requireD1Shape');
  });

  it('a v2 save that lands between the api check and the write is never overwritten (409)', async () => {
    const s = await setup();
    seedPool(s.db, { poolId: POOL, format: 'mcq', count: 3, prefix: 'b9' });
    // The api's own check reads a D1-shaped draft; a concurrent v2 save then stores a pool section before
    // save_test_draft takes the row lock, so the database's re-check refuses the D1 save.
    // The concurrent write commits on its own: it runs before the fake's one-transaction snapshot.
    s.db.beforeRpc = (fn) => {
      if (fn !== 'save_test_draft') return;
      rowsOf(s.db, 'sections').push({
        id: '5c000000-0000-4000-8000-0000000000ff',
        org_id: ORG,
        test_version_id: s.versionId,
        position: 9,
        name: 'Drawn',
        format: 'mcq',
        weight: 10,
        pool_id: POOL,
        draw_count: 2,
        shuffle_items: false,
        shuffle_options: false,
        navigation: 'free',
        paste_rule: null,
        blueprint: null,
        time_limit_seconds: null,
      });
    };
    const res = await s.call('PUT', s.d1Path, draftBody());
    expect(res.status).toBe(409);
    // The refusal comes from the database (the api's own check passed): its guard key answers 409.
    expect(await codeOf(res)).toBe('conflict');
    expect(s.db.savePayloads.at(-1)).toMatchObject({ requireD1Shape: true });
    // M1-p spec review 1: the concurrent v2 save's pool section is never overwritten.
    expect(rowsOf(s.db, 'sections').some((x) => x.pool_id === POOL)).toBe(true);
  });

  it('a deadlock the database breaks (40P01) is 409 conflict, never a 500 (M1-p database review 2)', async () => {
    const s = await setup();
    s.db.beforeRpc = (fn) => {
      if (fn === 'save_test_draft') throw new RestError(500, '40P01');
    };
    const res = await s.call('PUT', s.v2Path, saveBody());
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('conflict');
  });
});

describe('admin locks placed after settings were stored (R5-70 c, E16)', () => {
  const lock = (setting_key: string, locked_value: string) => ({
    id: '0c000000-0000-4000-8000-000000000001',
    org_id: ORG,
    setting_key,
    locked_value,
    locked_by: null,
    locked_at: '2026-10-17T09:00:00.000+00:00',
  });

  it('a save with the locked paste rule succeeds and stores the locked settings (custom)', async () => {
    const s = await setup();
    setSettings(s.db, s.versionId, { ...STANDARD }, 'standard');
    rowsOf(s.db, 'org_integrity_locks').push(lock('paste_written', 'blocked'));
    const body = saveBody();
    body.sections[1] = { ...body.sections[1]!, pasteRule: 'blocked' };
    const res = await s.call('PUT', `${s.v2Path}?version=${s.versionId}`, body);
    expect(res.status).toBe(200);
    const view = TestDraftView.parse(await res.json());
    expect(view.version.sections[1]?.pasteRule).toBe('blocked');
    const ruleset = rowsOf(s.db, 'ruleset_versions')[0];
    expect(ruleset?.settings).toEqual({ ...STANDARD, paste_written: 'blocked' });
    expect(ruleset?.preset_key).toBeNull();
  });

  it("D1's PUT on a locked draft stores the locked settings too", async () => {
    const s = await setup();
    setSettings(s.db, s.versionId, { ...STANDARD }, 'standard');
    rowsOf(s.db, 'org_integrity_locks').push(lock('paste_written', 'blocked'));
    const res = await s.call('PUT', s.d1Path, draftBody());
    expect(res.status).toBe(200);
    expect(TestDraftView.parse(await res.json()).version.sections[1]?.pasteRule).toBe('blocked');
    expect(rowsOf(s.db, 'ruleset_versions')[0]?.settings).toMatchObject({
      paste_written: 'blocked',
    });
  });

  it('the old paste rule after the lock is 400; a lock that moves nothing writes no settings', async () => {
    const s = await setup();
    setSettings(s.db, s.versionId, { ...STANDARD }, 'standard');
    rowsOf(s.db, 'org_integrity_locks').push(lock('paste_written', 'blocked'));
    const stale = saveBody();
    stale.sections[1] = { ...stale.sections[1]!, pasteRule: 'allowed_logged' };
    expect((await s.call('PUT', s.v2Path, stale)).status).toBe(400);

    const t = await setup();
    setSettings(t.db, t.versionId, { ...STANDARD }, 'standard');
    rowsOf(t.db, 'org_integrity_locks').push(lock('paste_written', 'allowed_logged'));
    expect((await t.call('PUT', t.v2Path, saveBody())).status).toBe(200);
    expect(t.db.savePayloads.at(-1)).not.toHaveProperty('settings');
    expect(rowsOf(t.db, 'ruleset_versions')[0]?.preset_key).toBe('standard');
  });
});
