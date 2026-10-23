// Test authoring routes (spec §6.2 rows GET/POST /tests and GET/PUT /tests/:testId; L-8, L-15, R-8 path org filter;
// spec m1 R5-53 a: GET, the POST 201 and D1's PUT answer TestDraftView). The draft starts at cutoff 40 in the default
// workspace; D1's PUT maps its body to inline sections (navigation null, package v1) and replaces the draft's children
// in one `public.save_test_draft` call (M1-18, fixes D1 r3 m-4), then reads the result back; every query is filtered by
// the path org; errors are constant codes. Runs on the fake PostgREST of tests.test-helpers.ts.
import { TestListResponse } from '@trace/shared/contracts/d1';
import { TestDraftView } from '@trace/shared/contracts/m1';
import { itemContentSha256 } from '@trace/shared/item-hash';
import { describe, expect, it } from 'vitest';
import { MAX_LIST_ROWS, RestError, orgFail } from './org-context.js';
import { createTestsRoutes } from './routes.js';
import { ORG, ORG_B, WS, authoringDb, draftBody, rowsOf, testsApp } from './tests.test-helpers.js';

const create = async (
  call: ReturnType<typeof testsApp>['call'],
  body: unknown = { name: 'Synthetic Test' },
) => call('POST', `/v1/orgs/${ORG}/tests`, body);

describe('POST /v1/orgs/:orgId/tests', () => {
  it('creates the test in the default workspace and its open draft with cutoff 40', async () => {
    const db = authoringDb();
    const { call } = testsApp(db);
    const res = await create(call, { name: 'Synthetic Test', durationMinutes: 25 });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = TestDraftView.parse(await res.json());
    expect(body.version).toMatchObject({
      versionNo: 1,
      status: 'draft',
      durationMinutes: 25,
      qualityCutoff: 40,
      publishedAt: null,
      sections: [],
    });
    expect(rowsOf(db, 'tests')[0]).toMatchObject({
      org_id: ORG,
      workspace_id: WS,
      name: 'Synthetic Test',
    });
    // Only the authoring columns are sent: the ruleset and notice pins come from the L-8 trigger.
    const insert = db.calls.find((c) => c.method === 'insert' && c.table === 'test_versions');
    expect(insert).toBeDefined();
    expect(Object.keys(rowsOf(db, 'test_versions')[0] ?? {})).toContain('ruleset_version_id');
  });

  it('uses a named workspace, defaults the duration to 30 minutes, and filters the default by the path org', async () => {
    const db = authoringDb();
    const { call } = testsApp(db);
    const ws2 = 'b1000000-0000-4000-8000-000000000002';
    const res = await create(call, { name: 'Synthetic Test', workspaceId: ws2 });
    expect(res.status).toBe(201);
    expect(TestDraftView.parse(await res.json()).version.durationMinutes).toBe(30);
    expect(rowsOf(db, 'tests')[0]?.workspace_id).toBe(ws2);
    db.tables.workspaces = [
      { id: 'b1000000-0000-4000-8000-000000000004', org_id: ORG_B, is_default: true },
    ];
    expect((await create(call)).status).toBe(404);
  });

  it('refuses a bad body with a constant 400 and maps an RLS refusal to 404', async () => {
    const db = authoringDb();
    const { call } = testsApp(db);
    for (const body of [
      {},
      { name: '' },
      { name: 'x', durationMinutes: 4 },
      { name: 'x', extra: 1 },
      'not json',
    ])
      expect(await (await create(call, body)).text()).toBe('{"error":{"code":"bad_request"}}');
    db.failNext('insert', 'tests', new RestError(403, '42501'));
    const res = await create(call);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":{"code":"not_found"}}');
  });
});

describe('POST /v1/orgs/:orgId/tests: the two writes (DB review r3 m-4)', () => {
  it('a failed draft insert archives the new test row, so no orphan without a version stays visible', async () => {
    const db = authoringDb();
    const { call } = testsApp(db);
    db.failNext('insert', 'test_versions', new RestError(503, 'PGRST000'));
    const res = await create(call);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('{"error":{"code":"unavailable"}}');
    const rows = rowsOf(db, 'tests');
    expect(rows).toHaveLength(1);
    expect(typeof rows[0]?.archived_at).toBe('string');
    const update = db.calls.find((c) => c.method === 'update' && c.table === 'tests');
    expect(update?.query).toMatchObject({ org_id: `eq.${ORG}`, archived_at: 'is.null' });
  });
});

describe('GET /v1/orgs/:orgId/tests: read caps (DB review r3 m-3)', () => {
  const withTests = async (count: number) => {
    const db = authoringDb();
    const { call } = testsApp(db);
    await create(call);
    const test = rowsOf(db, 'tests')[0];
    const version = rowsOf(db, 'test_versions')[0];
    if (test === undefined || version === undefined) throw new Error('fixture');
    const hex = (n: number) => n.toString(16).padStart(12, '0');
    for (let n = 2; n <= count; n += 1) {
      const id = `e9000000-0000-4000-8000-${hex(n)}`;
      rowsOf(db, 'tests').push({ ...test, id });
      rowsOf(db, 'test_versions').push({
        ...version,
        id: `f9000000-0000-4000-8000-${hex(n)}`,
        test_id: id,
      });
    }
    return { db, call };
  };

  it('lists exactly MAX_LIST_ROWS tests (versions read in chunks of ids) and fails closed past it', async () => {
    const full = await withTests(MAX_LIST_ROWS);
    const before = full.db.calls.length;
    const res = await full.call('GET', `/v1/orgs/${ORG}/tests`);
    expect(res.status).toBe(200);
    expect(TestListResponse.parse(await res.json()).tests).toHaveLength(MAX_LIST_ROWS);
    const versionReads = full.db.calls
      .slice(before)
      .filter((c) => c.method === 'select' && c.table === 'test_versions');
    expect(versionReads).toHaveLength(MAX_LIST_ROWS / 50);
    const over = await withTests(MAX_LIST_ROWS + 1);
    const r = await over.call('GET', `/v1/orgs/${ORG}/tests`);
    expect(r.status).toBe(503);
    expect(await r.text()).toBe('{"error":{"code":"unavailable"}}');
  });
});

describe('GET /v1/orgs/:orgId/tests and /tests/:testId', () => {
  it('lists the tests of the path org with their newest version and invitation count', async () => {
    const db = authoringDb();
    const { call } = testsApp(db);
    const created = TestDraftView.parse(await (await create(call)).json());
    const t = rowsOf(db, 'tests')[0];
    if (t !== undefined) t.invitation_seq = 3;
    db.tables.tests?.push({
      id: 'e1000000-0000-4000-8000-0000000000bb',
      org_id: ORG_B,
      workspace_id: 'b1000000-0000-4000-8000-000000000004',
      name: 'Other Org Test',
      created_at: '2026-10-17T08:00:00.000+00:00',
      invitation_seq: 0,
    });
    const res = await call('GET', `/v1/orgs/${ORG}/tests`);
    expect(res.status).toBe(200);
    expect(TestListResponse.parse(await res.json()).tests).toEqual([
      {
        id: created.test.id,
        name: 'Synthetic Test',
        status: 'draft',
        versionNo: 1,
        invitationCount: 3,
        createdAt: '2026-10-17T08:00:00.000+00:00',
      },
    ]);
    expect(
      db.calls.filter((c) => c.method === 'select').every((c) => c.query.org_id === `eq.${ORG}`),
    ).toBe(true);
  });

  it('a test of another org, an unknown test and a malformed id are 404', async () => {
    const db = authoringDb();
    const { call } = testsApp(db);
    db.tables.tests = [
      {
        id: 'e1000000-0000-4000-8000-0000000000bb',
        org_id: ORG_B,
        workspace_id: 'b1000000-0000-4000-8000-000000000004',
        name: 'Other Org Test',
        created_at: '2026-10-17T08:00:00.000+00:00',
        invitation_seq: 0,
      },
    ];
    for (const id of [
      'e1000000-0000-4000-8000-0000000000bb',
      'e1000000-0000-4000-8000-000000000099',
      'nope',
    ]) {
      const res = await call('GET', `/v1/orgs/${ORG}/tests/${id}`);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('{"error":{"code":"not_found"}}');
    }
    expect((await call('GET', '/v1/orgs/not-an-org/tests')).status).toBe(404);
  });
});

describe('PUT /v1/orgs/:orgId/tests/:testId', () => {
  it('writes the draft and reads it back: options, key, rubric (camelCase on the wire, max_points in the row)', async () => {
    const db = authoringDb();
    const { call } = testsApp(db);
    const created = TestDraftView.parse(await (await create(call)).json());
    const res = await call('PUT', `/v1/orgs/${ORG}/tests/${created.test.id}`, draftBody());
    expect(res.status).toBe(200);
    const detail = TestDraftView.parse(await res.json());
    expect(detail.test.name).toBe('Synthetic Support Test');
    expect(detail.version).toMatchObject({ durationMinutes: 20, qualityCutoff: 55 });
    expect(detail.version.sections.map((s) => [s.position, s.format, s.name, s.weight])).toEqual([
      [1, 'mcq', 'Basics', 40],
      [2, 'written', 'Writing', 60],
    ]);
    const [mcq] = detail.version.sections[0]?.items ?? [];
    expect(mcq).toMatchObject({ format: 'mcq', position: 1, correctOptionId: 'a' });
    const [written] = detail.version.sections[1]?.items ?? [];
    expect(written).toMatchObject({
      format: 'written',
      rubric: {
        criteria: [
          {
            id: 'c1',
            label: 'Mentions the receipt',
            maxPoints: 4,
            anchors: ['receipt', 'refund'],
            minHits: 1,
          },
        ],
      },
    });
    expect(rowsOf(db, 'rubric_versions')[0]).toMatchObject({
      org_id: ORG,
      version_no: 1,
      criteria: [
        {
          id: 'c1',
          label: 'Mentions the receipt',
          max_points: 4,
          anchors: ['receipt', 'refund'],
          min_hits: 1,
        },
      ],
    });
    expect(rowsOf(db, 'rubric_versions')[0]?.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rowsOf(db, 'item_answer_keys')).toEqual([
      { org_id: ORG, item_version_id: mcq?.id, format: 'mcq', key: { option_id: 'a' } },
    ]);
    for (const item of rowsOf(db, 'item_versions'))
      expect(item.content_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a second PUT replaces every child of the draft in one save_test_draft call (atomic, M1-18)', async () => {
    const db = authoringDb();
    const { call } = testsApp(db);
    const created = TestDraftView.parse(await (await create(call)).json());
    await call('PUT', `/v1/orgs/${ORG}/tests/${created.test.id}`, draftBody());
    const before = db.calls.length;
    const res = await call(
      'PUT',
      `/v1/orgs/${ORG}/tests/${created.test.id}`,
      draftBody({ sections: [draftBody().sections[1]!] }),
    );
    expect(res.status).toBe(200);
    expect(rowsOf(db, 'sections')).toHaveLength(1);
    expect(rowsOf(db, 'item_versions')).toHaveLength(1);
    expect(rowsOf(db, 'item_answer_keys')).toHaveLength(0);
    const writes = db.calls
      .slice(before)
      .filter((c) => c.method !== 'select')
      .map((c) => `${c.method}:${c.table}`);
    expect(writes).toEqual(['rpc:save_test_draft']);
    // D1's body is package v1: inline sections with no M1 field and no settings.
    const payload = db.savePayloads.at(-1) as Record<string, unknown>;
    expect(payload).toMatchObject({ name: 'Synthetic Support Test', totalTimeSeconds: 1200 });
    expect(payload).not.toHaveProperty('settings');
    expect((payload.sections as Record<string, unknown>[])[0]).toEqual({
      name: 'Writing',
      format: 'written',
      weight: 60,
      shuffleItems: false,
      shuffleOptions: false,
      navigation: null,
      items: [
        expect.objectContaining({
          format: 'written',
          stem: 'Describe a synthetic refund process.',
        }),
      ],
    });
    const view = TestDraftView.parse(await res.json());
    expect(view.version.sections[0]).toMatchObject({ mode: 'inline', navigation: null });
  });

  it('a written item whose rubric is unchanged reuses its rubric version (R5-51 f, DB L6)', async () => {
    const db = authoringDb();
    const { call } = testsApp(db);
    const created = TestDraftView.parse(await (await create(call)).json());
    await call('PUT', `/v1/orgs/${ORG}/tests/${created.test.id}`, draftBody());
    expect(rowsOf(db, 'rubric_versions')).toHaveLength(1);
    await call('PUT', `/v1/orgs/${ORG}/tests/${created.test.id}`, draftBody({ name: 'Renamed' }));
    expect(rowsOf(db, 'rubric_versions')).toHaveLength(1);
    const payload = db.savePayloads.at(-1) as { sections: { items: Record<string, unknown>[] }[] };
    expect(payload.sections[1]?.items[0]?.rubricVersionId).toBe(
      rowsOf(db, 'rubric_versions')[0]?.id,
    );
    const changed = draftBody();
    const item = changed.sections[1]?.items[0];
    if (item?.format === 'written') item.rubric.criteria[0]!.maxPoints = 5;
    await call('PUT', `/v1/orgs/${ORG}/tests/${created.test.id}`, changed);
    expect(rowsOf(db, 'rubric_versions')).toHaveLength(2);
  });

  it('item content hashes are the R5-49 a canonical hash (key excluded)', async () => {
    const db = authoringDb();
    const { call } = testsApp(db);
    const created = TestDraftView.parse(await (await create(call)).json());
    await call('PUT', `/v1/orgs/${ORG}/tests/${created.test.id}`, draftBody());
    const mcq = rowsOf(db, 'item_versions').find((i) => i.format === 'mcq');
    expect(mcq?.content_sha256).toBe(
      await itemContentSha256({
        format: 'mcq',
        stem: 'Which colour is the synthetic sky?',
        options: [
          { id: 'a', text: 'Blue' },
          { id: 'b', text: 'Green' },
        ],
        media: null,
        paramSpec: null,
      }),
    );
    // Another key, same served content: same hash.
    const other = draftBody();
    const first = other.sections[0]?.items[0];
    if (first?.format === 'mcq') first.correctOptionId = 'b';
    await call('PUT', `/v1/orgs/${ORG}/tests/${created.test.id}`, other);
    expect(rowsOf(db, 'item_versions').find((i) => i.format === 'mcq')?.content_sha256).toBe(
      mcq?.content_sha256,
    );
  });

  it('refuses a body that breaks the contract with 400 bad_request (cutoff valid)', async () => {
    const db = authoringDb();
    const { call } = testsApp(db);
    const created = TestDraftView.parse(await (await create(call)).json());
    const twoMcq = draftBody({ sections: [draftBody().sections[0]!, draftBody().sections[0]!] });
    for (const body of [twoMcq, { ...draftBody(), extra: true }, [], null]) {
      const res = await call('PUT', `/v1/orgs/${ORG}/tests/${created.test.id}`, body);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('{"error":{"code":"bad_request"}}');
    }
    expect(rowsOf(db, 'sections')).toEqual([]);
  });

  it('a PUT for a test the caller cannot see is 404 and writes nothing', async () => {
    const db = authoringDb();
    const { call } = testsApp(db);
    const res = await call(
      'PUT',
      `/v1/orgs/${ORG}/tests/e1000000-0000-4000-8000-000000000099`,
      draftBody(),
    );
    expect(res.status).toBe(404);
    expect(db.calls.filter((c) => c.method !== 'select')).toEqual([]);
  });

  it('only an owner, admin or recruiter may create or edit: a reviewer is 404, an aal1 admin 403 (spec review r3a #4)', async () => {
    const cases: { roles: string[]; status: number; code: string }[] = [
      { roles: ['reviewer'], status: 404, code: 'not_found' },
      { roles: ['hiring_manager'], status: 404, code: 'not_found' },
      { roles: ['admin'], status: 403, code: 'aal2_required' },
    ];
    for (const { roles, status, code } of cases) {
      const db = authoringDb();
      const { call } = testsApp(db);
      const created = TestDraftView.parse(await (await create(call)).json());
      const member = rowsOf(db, 'memberships')[0];
      if (member === undefined) throw new Error('fixture: no membership row');
      member.roles = roles;
      const before = db.calls.length;
      for (const res of [
        await call('PUT', `/v1/orgs/${ORG}/tests/${created.test.id}`, draftBody()),
        await create(call),
      ]) {
        expect(res.status, roles.join()).toBe(status);
        expect(await res.text()).toBe(`{"error":{"code":"${code}"}}`);
      }
      expect(db.calls.slice(before).map((c) => `${c.method} ${c.table}`)).toEqual([
        'select memberships',
        'select memberships',
      ]);
    }
  });

  it('only an owner, admin or recruiter may read the editor view, which carries the answer keys (R4 spec review #4)', async () => {
    const cases: { roles: string[]; status: number; code: string }[] = [
      { roles: ['reviewer'], status: 404, code: 'not_found' },
      { roles: ['hiring_manager'], status: 404, code: 'not_found' },
      { roles: ['admin'], status: 403, code: 'aal2_required' },
    ];
    for (const { roles, status, code } of cases) {
      const db = authoringDb();
      const { call } = testsApp(db);
      const created = TestDraftView.parse(await (await create(call)).json());
      const member = rowsOf(db, 'memberships')[0];
      if (member === undefined) throw new Error('fixture: no membership row');
      member.roles = roles;
      const before = db.calls.length;
      const res = await call('GET', `/v1/orgs/${ORG}/tests/${created.test.id}`);
      expect(res.status, roles.join()).toBe(status);
      expect(await res.text()).toBe(`{"error":{"code":"${code}"}}`);
      // Refused before any authoring table is read.
      expect(db.calls.slice(before).map((c) => `${c.method} ${c.table}`)).toEqual([
        'select memberships',
      ]);
    }
  });
});

describe('the tests router: caller and contract failures', () => {
  it('a failed caller check answers its constant code and touches no table', async () => {
    const db = authoringDb();
    const app = createTestsRoutes({
      org: { context: async () => orgFail('unauthorized') },
      packages: () => null,
    });
    const test = 'e1000000-0000-4000-8000-000000000001';
    for (const [method, path] of [
      ['GET', `/v1/orgs/${ORG}/tests`],
      ['POST', `/v1/orgs/${ORG}/tests`],
      ['GET', `/v1/orgs/${ORG}/tests/${test}`],
      ['PUT', `/v1/orgs/${ORG}/tests/${test}`],
      ['POST', `/v1/orgs/${ORG}/tests/${test}/publish`],
    ] as const) {
      const res = await app.request(
        `https://api.test${path}`,
        { method, ...(method === 'GET' ? {} : { body: '{}' }) },
        {} as Env,
      );
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.text()).toBe('{"error":{"code":"unauthorized"}}');
    }
    expect(db.calls).toEqual([]);
  });

  it('a stored row that does not fit the contract is 503 unavailable, never echoed', async () => {
    const db = authoringDb();
    const { call } = testsApp(db);
    const created = TestDraftView.parse(await (await create(call)).json());
    const t = rowsOf(db, 'tests')[0];
    if (t !== undefined) t.name = 'x'.repeat(201);
    for (const path of [`/v1/orgs/${ORG}/tests`, `/v1/orgs/${ORG}/tests/${created.test.id}`]) {
      const res = await call('GET', path);
      expect(res.status).toBe(503);
      expect(await res.text()).toBe('{"error":{"code":"unavailable"}}');
    }
  });
});
