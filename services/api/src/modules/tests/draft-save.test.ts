// PUT …/tests/:testId/draft (spec m1 §6.11 `SaveTestDraftRequest → public.save_test_draft`; R5-53 a answers
// TestDraftView; E1 a published version is 409; M1-11 timed sections; DB-M1-1 a written section's paste rule is the
// settings' paste_written; R5-53 d per-route body cap). Runs on the fake PostgREST of tests.test-helpers.ts.
import { TestDraftView } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import { RestError } from './org-context.js';
import {
  ORG,
  STANDARD,
  STRICT,
  authoringDb,
  rowsOf,
  saveBody,
  seedPool,
  setSettings,
  testsApp,
} from './tests.test-helpers.js';

const POOL = '90000000-0000-4000-8000-000000000001';

const setup = async () => {
  const db = authoringDb();
  const { call } = testsApp(db);
  const created = TestDraftView.parse(
    await (await call('POST', `/v1/orgs/${ORG}/tests`, { name: 'Synthetic Test' })).json(),
  );
  const path = `/v1/orgs/${ORG}/tests/${created.test.id}/draft`;
  return { db, call, path, testId: created.test.id, versionId: created.version.id };
};

const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe('PUT …/tests/:testId/draft', () => {
  it('saves inline and pool sections through save_test_draft and answers TestDraftView', async () => {
    const s = await setup();
    seedPool(s.db, { poolId: POOL, format: 'mcq', count: 3, prefix: 'a7' });
    const body = saveBody({
      sections: [
        ...saveBody().sections,
        {
          mode: 'pool',
          format: 'mcq',
          name: 'Drawn',
          weight: 10,
          items: [],
          poolId: POOL,
          drawCount: 2,
          shuffleItems: true,
          shuffleOptions: true,
          navigation: 'free',
          blueprint: { strata: [{ skillKey: 'verbal', difficultyBand: 2, count: 2 }] },
        },
      ],
    });
    const res = await s.call('PUT', s.path, body);
    expect(res.status).toBe(200);
    const view = TestDraftView.parse(await res.json());
    expect(view.version.sections.map((x) => [x.mode, x.format, x.navigation])).toEqual([
      ['inline', 'mcq', 'free'],
      ['inline', 'written', 'forward_only'],
      ['pool', 'mcq', 'free'],
    ]);
    expect(view.version.sections[2]).toMatchObject({
      poolId: POOL,
      drawCount: 2,
      shuffleItems: true,
      blueprint: { strata: [{ skillKey: 'verbal', difficultyBand: 2, count: 2 }] },
    });
    const payload = s.db.savePayloads.at(-1) as { sections: Record<string, unknown>[] };
    expect(payload.sections[2]).toMatchObject({
      poolId: POOL,
      drawCount: 2,
      shuffleItems: true,
      shuffleOptions: true,
      navigation: 'free',
      items: [],
    });
    expect(payload).not.toHaveProperty('settings');
  });

  it('a written section takes the settings paste rule; a different one in the body is 400 (DB-M1-1)', async () => {
    const s = await setup();
    setSettings(s.db, s.versionId, { ...STANDARD });
    const ok = await s.call('PUT', s.path, saveBody());
    expect(ok.status).toBe(200);
    const view = TestDraftView.parse(await ok.json());
    expect(view.version.sections[1]?.pasteRule).toBe('allowed_logged');
    const sameRule = saveBody();
    sameRule.sections[1] = { ...sameRule.sections[1]!, pasteRule: 'allowed_logged' };
    expect((await s.call('PUT', s.path, sameRule)).status).toBe(200);
    const otherRule = saveBody();
    otherRule.sections[1] = { ...otherRule.sections[1]!, pasteRule: 'blocked' };
    const res = await s.call('PUT', s.path, otherRule);
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('bad_request');
    setSettings(s.db, s.versionId, { ...STRICT });
    const strict = TestDraftView.parse(await (await s.call('PUT', s.path, saveBody())).json());
    expect(strict.version.sections[1]?.pasteRule).toBe('blocked');
  });

  it('when every section is timed the total time is their sum (M1-11)', async () => {
    const s = await setup();
    const body = saveBody();
    body.sections = body.sections.map((x, i) => ({ ...x, timeLimitSeconds: i === 0 ? 600 : 930 }));
    const res = await s.call('PUT', s.path, body);
    expect(res.status).toBe(200);
    expect((s.db.savePayloads.at(-1) as { totalTimeSeconds: number }).totalTimeSeconds).toBe(1530);
    const partly = saveBody();
    partly.sections[0] = { ...partly.sections[0]!, timeLimitSeconds: 600 };
    await s.call('PUT', s.path, partly);
    expect((s.db.savePayloads.at(-1) as { totalTimeSeconds: number }).totalTimeSeconds).toBe(1200);
  });

  it('a published version is 409 conflict (E1); an unknown test is 404; a bad body is 400', async () => {
    const s = await setup();
    s.db.failNext('rpc', 'save_test_draft', new RestError(403, '42501', 'version_frozen'));
    expect((await s.call('PUT', s.path, saveBody())).status).toBe(409);
    const v = rowsOf(s.db, 'test_versions')[0];
    if (v !== undefined) v.status = 'published';
    const res = await s.call('PUT', s.path, saveBody());
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('conflict');
    const missing = await s.call(
      'PUT',
      `/v1/orgs/${ORG}/tests/e1000000-0000-4000-8000-000000000099/draft`,
      saveBody(),
    );
    expect(missing.status).toBe(404);
    for (const body of [{ ...saveBody(), extra: 1 }, { ...saveBody(), qualityCutoff: 101 }, []]) {
      const r = await s.call('PUT', s.path, body);
      expect(r.status).toBe(400);
    }
  });

  it('a draft larger than the default 256 KB body cap is accepted under the draft cap (R5-53 d)', async () => {
    const s = await setup();
    const body = saveBody();
    const mcq = body.sections[0]!;
    const items = Array.from({ length: 80 }, (_, n) => ({
      format: 'mcq' as const,
      prompt: `[synthetic] ${'q'.repeat(3900)} ${n}`,
      options: [
        { id: 'a', text: 'Blue' },
        { id: 'b', text: 'Green' },
      ],
      correctOptionId: 'a',
    }));
    body.sections[0] = { ...mcq, items };
    expect(JSON.stringify(body).length).toBeGreaterThan(256 * 1024);
    const res = await s.call('PUT', s.path, body);
    expect(res.status).toBe(200);
    expect(rowsOf(s.db, 'item_versions')).toHaveLength(81);
  });

  it('only an owner, admin or recruiter saves; refused before any write', async () => {
    const s = await setup();
    const member = rowsOf(s.db, 'memberships')[0];
    if (member === undefined) throw new Error('fixture');
    member.roles = ['reviewer'];
    const before = s.db.calls.length;
    expect((await s.call('PUT', s.path, saveBody())).status).toBe(404);
    expect(s.db.calls.slice(before).map((c) => `${c.method} ${c.table}`)).toEqual([
      'select memberships',
    ]);
  });

  it('a value an admin lock forbids is 409 setting_locked', async () => {
    const s = await setup();
    setSettings(s.db, s.versionId, { ...STANDARD });
    s.db.failNext('rpc', 'save_test_draft', new RestError(403, '42501', 'setting_locked'));
    const res = await s.call('PUT', s.path, saveBody());
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('setting_locked');
  });

  it('a draft with settings saves a null navigation as the default: mcq free, written forward_only (R5-63 b)', async () => {
    const s = await setup();
    setSettings(s.db, s.versionId, { ...STRICT });
    const body = saveBody();
    body.sections = body.sections.map((x) => ({ ...x, navigation: null }));
    const res = await s.call('PUT', s.path, body);
    expect(res.status).toBe(200);
    const view = TestDraftView.parse(await res.json());
    expect(view.version.sections.map((x) => [x.format, x.navigation, x.pasteRule])).toEqual([
      ['mcq', 'free', undefined],
      ['written', 'forward_only', 'blocked'],
    ]);
    // Without settings (a D1 draft) the null navigation stays: package v1 (R3-1).
    const d1 = await setup();
    const plain = TestDraftView.parse(await (await d1.call('PUT', d1.path, body)).json());
    expect(plain.version.sections.map((x) => x.navigation)).toEqual([null, null]);
  });
});
