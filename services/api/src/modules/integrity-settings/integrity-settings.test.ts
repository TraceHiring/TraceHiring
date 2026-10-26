// Integrity presets, per-signal settings and admin locks (spec m1 §6.6-§6.7, M1-13, M1-14, R3-1, R5-34, DB-M1-1, E16,
// E17; AT-M1-15/16 api parts; A5c review M2). GET/PUT …/tests/:testId/integrity answer IntegritySettingsView: the
// stored values (a D1 draft without settings reads as D1 behaves: the Standard values with paste blocked, custom), an
// admin lock's value in place of the stored one on a draft (the database refuses to save or publish another, E16),
// `always` for the three always-locked settings, and "What candidates will see" from renderCandidateSummary. A named
// preset must carry exactly that preset's values. Admin locks: GET/POST/DELETE …/settings/integrity-locks (admin, aal2;
// DELETE answers 204). Nothing here can reject anyone (rule 2) or change a rule's tier or validation (rule 3).
import { renderCandidateSummary } from '@trace/shared';
import {
  IntegrityLockListResponse,
  IntegrityLockView,
  IntegritySettingsView,
  TestDraftView,
} from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { RestError } from '../tests/org-context.js';
import {
  OPEN_BOOK,
  ORG,
  STANDARD,
  STRICT,
  authoringDb,
  callerOf,
  draftBody,
  rowsOf,
  saveBody,
  testsApp,
  type AuthoringDb,
} from '../tests/tests.test-helpers.js';
import type { ReferenceSource } from '../templates/reference.js';
import { D1_EQUIVALENT_VALUES, createIntegritySettingsRoutes } from './routes.js';

const reference = (): ReferenceSource => ({
  settingsCatalog: async () => ({
    catalogVersion: 'm1-settings-v1',
    presets: {
      strict: { version: 2, values: { ...STRICT } },
      standard: { version: 3, values: { ...STANDARD } },
      open_book: { version: 1, values: { ...OPEN_BOOK } },
    },
  }),
  templates: async () => [],
  browse: async () => [],
});

const LOCK_AT = '2026-10-17T09:00:00.000+00:00';
const lock = (setting_key: string, locked_value: string, n = 1) => ({
  id: `0c000000-0000-4000-8000-00000000000${n}`,
  org_id: ORG,
  setting_key,
  locked_value,
  locked_by: null,
  locked_at: LOCK_AT,
});

const setup = async (opts: { roles?: string[]; aal?: 'aal1' | 'aal2'; ref?: boolean } = {}) => {
  const db: AuthoringDb = authoringDb();
  const tests = testsApp(db);
  const created = TestDraftView.parse(
    await (await tests.call('POST', `/v1/orgs/${ORG}/tests`, { name: 'Synthetic Test' })).json(),
  );
  // Make it a v2 draft (navigation set) so paste rules are stored on its written section.
  expect(
    (await tests.call('PUT', `/v1/orgs/${ORG}/tests/${created.test.id}/draft`, saveBody())).status,
  ).toBe(200);
  const member = rowsOf(db, 'memberships')[0];
  if (member !== undefined && opts.roles !== undefined) member.roles = opts.roles;
  const app = new Hono<{ Bindings: Env }>();
  app.route(
    '/',
    createIntegritySettingsRoutes({
      org: {
        context: async () => ({
          caller: callerOf({ aal: opts.aal ?? 'aal2', amr: ['totp'] }),
          rest: db.rest,
        }),
      },
      reference: () => (opts.ref === false ? null : reference()),
    }),
  );
  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      `https://api.test/v1/orgs/${ORG}${path}`,
      {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: { 'content-type': 'application/json' },
      },
      {} as Env,
    );
  const path = `/tests/${created.test.id}/integrity`;
  return { db, call, path, testId: created.test.id, versionId: created.version.id, tests };
};

const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe('GET …/tests/:testId/integrity', () => {
  it('a D1 draft without settings reads as D1 behaves: Standard values with paste blocked, custom', async () => {
    const s = await setup();
    const res = await s.call('GET', s.path);
    expect(res.status).toBe(200);
    const view = IntegritySettingsView.parse(await res.json());
    expect(view.presetKey).toBeNull();
    expect(view.values).toEqual(D1_EQUIVALENT_VALUES);
    expect(D1_EQUIVALENT_VALUES).toEqual({ ...STANDARD, paste_written: 'blocked' });
    expect(view.locked).toEqual({
      integrity_review_scope: 'always',
      accommodations: 'always',
      id_verification: 'always',
    });
    expect(view.candidateSummary).toEqual(
      renderCandidateSummary(D1_EQUIVALENT_VALUES, 'm1-settings-v1').lines,
    );
    expect(view.stored).toBe(false);
  });

  it('stored is true once settings are stored, also for custom values without a preset (R5-70 d)', async () => {
    const s = await setup();
    const custom = { ...STANDARD, question_copy: 'off' };
    const put = IntegritySettingsView.parse(
      await (await s.call('PUT', s.path, { presetKey: null, values: custom })).json(),
    );
    expect(put).toMatchObject({ presetKey: null, stored: true });
    const view = IntegritySettingsView.parse(await (await s.call('GET', s.path)).json());
    expect(view).toMatchObject({ presetKey: null, stored: true });
  });

  it('carries an admin lock value in place of the stored one on a draft; the preset becomes custom (E16, A5c M2)', async () => {
    const s = await setup();
    expect((await s.call('PUT', s.path, { presetKey: 'standard', values: STANDARD })).status).toBe(
      200,
    );
    rowsOf(s.db, 'org_integrity_locks').push(lock('paste_written', 'blocked'));
    const view = IntegritySettingsView.parse(await (await s.call('GET', s.path)).json());
    expect(view.values.paste_written).toBe('blocked');
    expect(view.locked.paste_written).toBe('admin');
    expect(view.presetKey).toBeNull();
    // A lock that agrees with the stored value keeps the preset.
    rowsOf(s.db, 'org_integrity_locks').splice(0, 1, lock('paste_written', 'allowed_logged'));
    const same = IntegritySettingsView.parse(await (await s.call('GET', s.path)).json());
    expect(same.presetKey).toBe('standard');
    expect(same.locked.paste_written).toBe('admin');
  });

  it('a published version shows its frozen values; a later lock never rewrites them (E17)', async () => {
    const s = await setup();
    await s.call('PUT', s.path, { presetKey: 'standard', values: STANDARD });
    const v = rowsOf(s.db, 'test_versions')[0];
    if (v !== undefined) v.status = 'published';
    rowsOf(s.db, 'org_integrity_locks').push(lock('paste_written', 'blocked'));
    const view = IntegritySettingsView.parse(await (await s.call('GET', s.path)).json());
    expect(view.values.paste_written).toBe('allowed_logged');
    expect(view.presetKey).toBe('standard');
  });

  it('a reviewer or a hiring manager is 404 before any test row is read', async () => {
    for (const roles of [['reviewer'], ['hiring_manager']]) {
      const s = await setup({ roles });
      const before = s.db.calls.length;
      expect((await s.call('GET', s.path)).status).toBe(404);
      expect(s.db.calls.slice(before).map((c) => `${c.method} ${c.table}`)).toEqual([
        'select memberships',
      ]);
    }
  });
});

describe('PUT …/tests/:testId/integrity', () => {
  it('stores a preset and its values; the written section takes paste_written (DB-M1-1)', async () => {
    const s = await setup();
    const res = await s.call('PUT', s.path, { presetKey: 'strict', values: STRICT });
    expect(res.status).toBe(200);
    const view = IntegritySettingsView.parse(await res.json());
    expect(view).toMatchObject({ presetKey: 'strict', values: STRICT });
    const ruleset = rowsOf(s.db, 'ruleset_versions')[0];
    expect(ruleset).toMatchObject({ preset_key: 'strict', settings: STRICT });
    const written = rowsOf(s.db, 'sections').find((x) => x.format === 'written');
    expect(written?.paste_rule).toBe('blocked');
    const mcq = rowsOf(s.db, 'sections').find((x) => x.format === 'mcq');
    expect(mcq?.paste_rule).toBeNull();
  });

  it('custom values store preset null; a preset whose values differ from its own is 400', async () => {
    const s = await setup();
    const custom = { ...STANDARD, question_copy: 'off' };
    const res = await s.call('PUT', s.path, { presetKey: null, values: custom });
    expect(res.status).toBe(200);
    expect(rowsOf(s.db, 'ruleset_versions')[0]).toMatchObject({
      preset_key: null,
      settings: custom,
    });
    const mislabelled = await s.call('PUT', s.path, { presetKey: 'standard', values: custom });
    expect(mislabelled.status).toBe(400);
    expect(await codeOf(mislabelled)).toBe('bad_request');
  });

  it('an always-locked setting has one value; anything else is 400 (M1-14)', async () => {
    const s = await setup();
    for (const values of [
      { ...STANDARD, integrity_review_scope: 'all' },
      { ...STANDARD, accommodations: 'off' },
      { ...STANDARD, id_verification: 'on' },
    ]) {
      expect((await s.call('PUT', s.path, { presetKey: null, values })).status).toBe(400);
    }
  });

  it('a value an admin locked otherwise is 409 setting_locked (I-M1-6)', async () => {
    const s = await setup();
    rowsOf(s.db, 'org_integrity_locks').push(lock('paste_written', 'blocked'));
    const res = await s.call('PUT', s.path, { presetKey: 'standard', values: STANDARD });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('setting_locked');
  });

  it('a published version is 409 (settings freeze with it); a named preset without the reference read is 503', async () => {
    const s = await setup();
    const v = rowsOf(s.db, 'test_versions')[0];
    if (v !== undefined) v.status = 'published';
    expect((await s.call('PUT', s.path, { presetKey: null, values: STANDARD })).status).toBe(409);
    const n = await setup({ ref: false });
    const res = await n.call('PUT', n.path, { presetKey: 'standard', values: STANDARD });
    expect(res.status).toBe(503);
  });
});

describe('admin locks (…/settings/integrity-locks)', () => {
  it('an admin at aal2 lists, adds and removes locks; DELETE is 204 with no body', async () => {
    const s = await setup({ roles: ['admin'] });
    const add = await s.call('POST', '/settings/integrity-locks', {
      settingKey: 'paste_written',
      lockedValue: 'blocked',
    });
    expect(add.status).toBe(201);
    const view = IntegrityLockView.parse(await add.json());
    expect(view).toMatchObject({ settingKey: 'paste_written', lockedValue: 'blocked' });
    const list = IntegrityLockListResponse.parse(
      await (await s.call('GET', '/settings/integrity-locks')).json(),
    );
    expect(list.locks.map((l) => l.settingKey)).toEqual(['paste_written']);
    const del = await s.call('DELETE', '/settings/integrity-locks/paste_written');
    expect(del.status).toBe(204);
    expect(await del.text()).toBe('');
    expect(rowsOf(s.db, 'org_integrity_locks')).toEqual([]);
    expect((await s.call('DELETE', '/settings/integrity-locks/paste_written')).status).toBe(404);
    expect((await s.call('DELETE', '/settings/integrity-locks/not_a_setting')).status).toBe(404);
  });

  it('an always-locked setting or a value outside its list is 400; a second lock on a key is 409', async () => {
    const s = await setup({ roles: ['admin'] });
    for (const body of [
      { settingKey: 'integrity_review_scope', lockedValue: 'shortlist_only' },
      { settingKey: 'paste_written', lockedValue: 'off' },
      { settingKey: 'paste_written', lockedValue: 'blocked', extra: 1 },
    ]) {
      expect((await s.call('POST', '/settings/integrity-locks', body)).status).toBe(400);
    }
    s.db.failNext('insert', 'org_integrity_locks', new RestError(409, '23505'));
    const dup = await s.call('POST', '/settings/integrity-locks', {
      settingKey: 'paste_written',
      lockedValue: 'blocked',
    });
    expect(dup.status).toBe(409);
  });

  it('only an admin: a recruiter or owner without admin is 404; an aal1 admin is 403', async () => {
    for (const [roles, aal, status] of [
      [['recruiter'], 'aal2', 404],
      [['org_owner'], 'aal2', 404],
      [['admin'], 'aal1', 403],
    ] as const) {
      const s = await setup({ roles: [...roles], aal });
      for (const [method, path, body] of [
        ['GET', '/settings/integrity-locks', undefined],
        [
          'POST',
          '/settings/integrity-locks',
          { settingKey: 'paste_written', lockedValue: 'blocked' },
        ],
        ['DELETE', '/settings/integrity-locks/paste_written', undefined],
      ] as const) {
        expect((await s.call(method, path, body)).status, `${roles.join()} ${method}`).toBe(status);
      }
      expect(rowsOf(s.db, 'org_integrity_locks')).toEqual([]);
    }
  });
});

describe('R5-34: a new draft of a locked org gets the Standard preset with its locks', () => {
  it('POST …/tests writes Standard with the locked values (custom when a lock moved one)', async () => {
    const db = authoringDb();
    rowsOf(db, 'org_integrity_locks').push(lock('paste_written', 'blocked'));
    const { call } = testsApp(db, undefined, undefined, { reference: () => reference() });
    const res = await call('POST', `/v1/orgs/${ORG}/tests`, { name: 'Synthetic Test' });
    expect(res.status).toBe(201);
    expect(rowsOf(db, 'ruleset_versions')[0]).toMatchObject({
      preset_key: null,
      settings: { ...STANDARD, paste_written: 'blocked' },
    });
    // Without locks nothing is written: the draft stays a D1 draft (R3-1).
    const plain = authoringDb();
    await testsApp(plain, undefined, undefined, { reference: () => reference() }).call(
      'POST',
      `/v1/orgs/${ORG}/tests`,
      { name: 'Synthetic Test' },
    );
    expect(rowsOf(plain, 'ruleset_versions')[0]?.settings).toBeNull();
  });

  it('a lock equal to the Standard value keeps the preset and stores its catalog version (fix round 1 #9)', async () => {
    const db = authoringDb();
    rowsOf(db, 'org_integrity_locks').push(lock('question_copy', 'on'));
    const { call } = testsApp(db, undefined, undefined, { reference: () => reference() });
    expect((await call('POST', `/v1/orgs/${ORG}/tests`, { name: 'Synthetic Test' })).status).toBe(
      201,
    );
    expect(rowsOf(db, 'ruleset_versions')[0]).toMatchObject({
      preset_key: 'standard',
      preset_version: 3,
      settings: STANDARD,
    });
  });
});

describe('fix round 1: preset versions (#9) and default navigation (#5)', () => {
  it('a named preset stores its catalog version; custom stores none', async () => {
    const s = await setup();
    expect((await s.call('PUT', s.path, { presetKey: 'strict', values: STRICT })).status).toBe(200);
    expect(rowsOf(s.db, 'ruleset_versions')[0]).toMatchObject({
      preset_key: 'strict',
      preset_version: 2,
    });
    const custom = { ...STANDARD, question_copy: 'off' };
    expect((await s.call('PUT', s.path, { presetKey: null, values: custom })).status).toBe(200);
    expect(rowsOf(s.db, 'ruleset_versions')[0]).toMatchObject({
      preset_key: null,
      preset_version: null,
    });
  });

  it('settings on a D1 draft give its null-navigation sections the default and the paste rule', async () => {
    const db: AuthoringDb = authoringDb();
    const tests = testsApp(db);
    const created = TestDraftView.parse(
      await (await tests.call('POST', `/v1/orgs/${ORG}/tests`, { name: 'Synthetic Test' })).json(),
    );
    expect(
      (await tests.call('PUT', `/v1/orgs/${ORG}/tests/${created.test.id}`, draftBody())).status,
    ).toBe(200);
    expect(rowsOf(db, 'sections').map((x) => x.navigation)).toEqual([null, null]);
    const app = new Hono<{ Bindings: Env }>();
    app.route(
      '/',
      createIntegritySettingsRoutes({
        org: {
          context: async () => ({
            caller: callerOf({ aal: 'aal2', amr: ['totp'] }),
            rest: db.rest,
          }),
        },
        reference: () => reference(),
      }),
    );
    const res = await app.request(
      `https://api.test/v1/orgs/${ORG}/tests/${created.test.id}/integrity`,
      {
        method: 'PUT',
        body: JSON.stringify({ presetKey: 'strict', values: STRICT }),
        headers: { 'content-type': 'application/json' },
      },
      {} as Env,
    );
    expect(res.status).toBe(200);
    expect(rowsOf(db, 'sections').map((x) => [x.format, x.navigation, x.paste_rule])).toEqual([
      ['mcq', 'free', null],
      ['written', 'forward_only', 'blocked'],
    ]);
  });
});
