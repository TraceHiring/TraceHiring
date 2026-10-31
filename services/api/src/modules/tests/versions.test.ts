// AT-M1-14 (api part, spec m1 §4.2, Q20): POST …/tests/:testId/versions clones the latest published version into a new
// draft (version_no + 1; a new ruleset from the D1 seed trigger, its settings copied from the source ruleset), answers
// TestDraftView 201 (R5-53 a); the published version and every invitation's pin are untouched (the invitations'
// test_version_id is immutable in the database, rls_m1_publish_v2). A draft already open, or no published version, is
// 409. A setting an admin locked since the source was published takes the locked value (E16/E17: the source stays
// frozen; the new draft follows the lock). Runs on the fake PostgREST of tests.test-helpers.ts.
import { PublishTestResponse } from '@trace/shared/contracts/d1';
import { TestDraftView } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import {
  ORG,
  STANDARD,
  authoringDb,
  draftBody,
  rowsOf,
  saveBody,
  setSettings,
  testsApp,
} from './tests.test-helpers.js';

const setup = async (opts: { settings?: boolean } = {}) => {
  const db = authoringDb();
  const { call } = testsApp(db);
  const created = TestDraftView.parse(
    await (await call('POST', `/v1/orgs/${ORG}/tests`, { name: 'Synthetic Test' })).json(),
  );
  const testId = created.test.id;
  const v1 = created.version.id;
  if (opts.settings === true) {
    setSettings(db, v1, { ...STANDARD }, 'standard');
    expect((await call('PUT', `/v1/orgs/${ORG}/tests/${testId}/draft`, saveBody())).status).toBe(
      200,
    );
  } else {
    expect((await call('PUT', `/v1/orgs/${ORG}/tests/${testId}`, draftBody())).status).toBe(200);
  }
  const pub = await call('POST', `/v1/orgs/${ORG}/tests/${testId}/publish`, { testVersionId: v1 });
  expect(pub.status).toBe(200);
  PublishTestResponse.parse(await pub.json());
  const clone = () => call('POST', `/v1/orgs/${ORG}/tests/${testId}/versions`);
  return { db, call, testId, v1, clone };
};

describe('POST …/tests/:testId/versions (Edit as new version)', () => {
  it('clones the published version into draft 2 with the same content; the published one is untouched', async () => {
    const s = await setup();
    const res = await s.clone();
    expect(res.status).toBe(201);
    const view = TestDraftView.parse(await res.json());
    expect(view.version).toMatchObject({
      versionNo: 2,
      status: 'draft',
      durationMinutes: 20,
      qualityCutoff: 55,
      publishedAt: null,
    });
    expect(view.version.id).not.toBe(s.v1);
    expect(
      view.version.sections.map((x) => [x.name, x.format, x.weight, x.navigation, x.items.length]),
    ).toEqual([
      ['Basics', 'mcq', 40, null, 1],
      ['Writing', 'written', 60, null, 1],
    ]);
    const mcq = view.version.sections[0]?.items[0];
    expect(mcq).toMatchObject({ format: 'mcq', correctOptionId: 'a' });
    // The written item reuses the frozen rubric version (no new rubric row).
    expect(rowsOf(s.db, 'rubric_versions')).toHaveLength(1);
    const published = rowsOf(s.db, 'test_versions').find((v) => v.id === s.v1);
    expect(published?.status).toBe('published');
    expect(rowsOf(s.db, 'item_versions').filter((i) => i.test_version_id === s.v1)).toHaveLength(2);
    // The new draft has its own ruleset; a D1 source has no settings, so none are written.
    const draft = rowsOf(s.db, 'test_versions').find((v) => v.id === view.version.id);
    expect(draft?.ruleset_version_id).not.toBe(published?.ruleset_version_id);
    expect(s.db.savePayloads.at(-1)).not.toHaveProperty('settings');
  });

  it('copies the source settings and preset; a lock added since takes the locked value (preset becomes custom)', async () => {
    const s = await setup({ settings: true });
    const res = await s.clone();
    expect(res.status).toBe(201);
    expect(s.db.savePayloads.at(-1)).toMatchObject({ presetKey: 'standard', settings: STANDARD });
    const s2 = await setup({ settings: true });
    rowsOf(s2.db, 'org_integrity_locks').push({
      id: '0c000000-0000-4000-8000-000000000001',
      org_id: ORG,
      setting_key: 'paste_written',
      locked_value: 'blocked',
      locked_by: null,
      locked_at: '2026-10-17T09:00:00.000+00:00',
    });
    const res2 = await s2.clone();
    expect(res2.status).toBe(201);
    expect(s2.db.savePayloads.at(-1)).toMatchObject({
      presetKey: null,
      settings: { ...STANDARD, paste_written: 'blocked' },
    });
    // The written section's paste rule follows the (locked) setting (DB-M1-1).
    const view = TestDraftView.parse(await res2.json());
    expect(view.version.sections[1]?.pasteRule).toBe('blocked');
  });

  it('an open draft already exists, or nothing is published: 409', async () => {
    const s = await setup();
    expect((await s.clone()).status).toBe(201);
    const again = await s.clone();
    expect(again.status).toBe(409);
    const db = authoringDb();
    const { call } = testsApp(db);
    const created = TestDraftView.parse(
      await (await call('POST', `/v1/orgs/${ORG}/tests`, { name: 'Synthetic Test' })).json(),
    );
    const none = await call('POST', `/v1/orgs/${ORG}/tests/${created.test.id}/versions`);
    expect(none.status).toBe(409);
  });

  it('a reviewer cannot clone (404), and nothing is written', async () => {
    const s = await setup();
    const member = rowsOf(s.db, 'memberships')[0];
    if (member === undefined) throw new Error('fixture');
    member.roles = ['reviewer'];
    const before = s.db.calls.length;
    expect((await s.clone()).status).toBe(404);
    expect(s.db.calls.slice(before).every((c) => c.method === 'select')).toBe(true);
  });
});

const reference = () => ({
  settingsCatalog: async () => ({
    catalogVersion: 'm1-settings-v1',
    presets: { standard: { version: 4, values: { ...STANDARD } } },
  }),
  templates: async () => [],
  browse: async () => [],
});

/** A D1 test (no settings) published before the org locked a setting; the clone runs with the reference read. */
const lockedOrgClone = async (lock: { setting_key: string; locked_value: string }) => {
  const db = authoringDb();
  const { call } = testsApp(db, undefined, undefined, { reference });
  const created = TestDraftView.parse(
    await (await call('POST', `/v1/orgs/${ORG}/tests`, { name: 'Synthetic Test' })).json(),
  );
  expect((await call('PUT', `/v1/orgs/${ORG}/tests/${created.test.id}`, draftBody())).status).toBe(
    200,
  );
  const pub = await call('POST', `/v1/orgs/${ORG}/tests/${created.test.id}/publish`, {
    testVersionId: created.version.id,
  });
  expect(pub.status).toBe(200);
  rowsOf(db, 'org_integrity_locks').push({
    id: '0c000000-0000-4000-8000-000000000001',
    org_id: ORG,
    locked_by: null,
    locked_at: '2026-10-17T09:00:00.000+00:00',
    ...lock,
  });
  const res = await call('POST', `/v1/orgs/${ORG}/tests/${created.test.id}/versions`);
  expect(res.status).toBe(201);
  const view = TestDraftView.parse(await res.json());
  const draft = rowsOf(db, 'test_versions').find((v) => v.id === view.version.id);
  const ruleset = rowsOf(db, 'ruleset_versions').find((r) => r.id === draft?.ruleset_version_id);
  return { db, call, view, ruleset, testId: created.test.id };
};

describe('cloning in an org with admin locks (fix round 1 #4, #5, #9; R5-34)', () => {
  it('a D1 source gets the Standard preset with the locks applied, and its sections the default navigation', async () => {
    const s = await lockedOrgClone({ setting_key: 'paste_written', locked_value: 'blocked' });
    expect(s.ruleset).toMatchObject({
      preset_key: null,
      preset_version: null,
      settings: { ...STANDARD, paste_written: 'blocked' },
    });
    expect(s.view.version.sections.map((x) => [x.format, x.navigation, x.pasteRule])).toEqual([
      ['mcq', 'free', undefined],
      ['written', 'forward_only', 'blocked'],
    ]);
    // The new draft is publishable (not draft_incomplete).
    const res = await s.call('POST', `/v1/orgs/${ORG}/tests/${s.testId}/publish`, {
      testVersionId: s.view.version.id,
    });
    expect(res.status).toBe(200);
  });

  it('a lock that keeps the Standard values stores the preset with its catalog version', async () => {
    const s = await lockedOrgClone({ setting_key: 'question_copy', locked_value: 'on' });
    expect(s.ruleset).toMatchObject({
      preset_key: 'standard',
      preset_version: 4,
      settings: STANDARD,
    });
  });

  it("a source with a named preset keeps that preset's version in the clone", async () => {
    const s = await setup({ settings: true });
    const source = rowsOf(s.db, 'ruleset_versions')[0];
    if (source !== undefined) source.preset_version = 2;
    const res = await s.clone();
    expect(res.status).toBe(201);
    const view = TestDraftView.parse(await res.json());
    const draft = rowsOf(s.db, 'test_versions').find((v) => v.id === view.version.id);
    expect(
      rowsOf(s.db, 'ruleset_versions').find((r) => r.id === draft?.ruleset_version_id),
    ).toMatchObject({
      preset_key: 'standard',
      preset_version: 2,
    });
  });
});
