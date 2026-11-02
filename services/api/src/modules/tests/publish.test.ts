// AT-D15 (api part) and AT-D14 (cutoff pinned at publish): spec §6.2 PUT and publish rows, L-9, L-15, OPEN-7.
// Publish without a cutoff -> 422 `cutoff_required`; PUT with null or 101 -> 400; a `testVersionId` that is not the
// open draft -> 409; a hash mismatch after the guarded UPDATE retires the version (500). The package is key-free.
// Runs on the fake PostgREST of tests.test-helpers.ts (the triggers it models are tested in supabase/tests).
import { TestPackage } from '@trace/shared/contracts/candidate';
import { PublishTestResponse, TestDetailResponse } from '@trace/shared/contracts/d1';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../candidate/encoding.js';
import { RestError } from './org-context.js';
import { ORG, authoringDb, draftBody, fakeBucket, rowsOf, testsApp } from './tests.test-helpers.js';

const setup = async (opts: { draft?: unknown } = {}) => {
  const db = authoringDb();
  const bucket = fakeBucket();
  const { call } = testsApp(db, bucket);
  const created = TestDetailResponse.parse(
    await (await call('POST', `/v1/orgs/${ORG}/tests`, { name: 'Synthetic Test' })).json(),
  );
  const testId = created.test.id;
  const versionId = created.version.id;
  if (opts.draft !== null) {
    const put = await call('PUT', `/v1/orgs/${ORG}/tests/${testId}`, opts.draft ?? draftBody());
    expect(put.status).toBe(200);
  }
  const publish = (testVersionId: string = versionId) =>
    call('POST', `/v1/orgs/${ORG}/tests/${testId}/publish`, { testVersionId });
  return { db, bucket, call, testId, versionId, publish };
};

const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe('POST …/tests/:testId/publish', () => {
  it('writes the key-free package to R2, then publishes with the api-supplied hash', async () => {
    const s = await setup();
    const res = await s.publish();
    expect(res.status).toBe(200);
    const body = PublishTestResponse.parse(await res.json());
    expect(body).toMatchObject({
      testVersionId: s.versionId,
      status: 'published',
      qualityCutoff: 55,
    });
    const text = s.bucket.objects.get(`packages/${s.versionId}.json`) ?? '';
    expect(await sha256Hex(text)).toBe(body.contentSha256);
    const pkg = TestPackage.parse(JSON.parse(text));
    expect(pkg).toMatchObject({
      v: 1,
      testVersionId: s.versionId,
      title: 'Synthetic Support Test',
      durationSeconds: 1200,
      language: 'en',
      pasteBlocked: true,
      heartbeatSeconds: 10,
      signalCatalogVersion: 'd1-signals-v1',
    });
    expect(pkg.items.map((i) => [i.position, i.kind])).toEqual([
      [1, 'mcq'],
      [2, 'written'],
    ]);
    expect(pkg.items[0]?.options).toEqual([
      { id: 'a', label: 'Blue' },
      { id: 'b', label: 'Green' },
    ]);
    // No answer key, rubric, weight, cutoff or score anywhere in the bytes.
    for (const word of [
      'correct',
      'option_id',
      'rubric',
      'criteria',
      'anchors',
      'weight',
      'cutoff',
      'score',
      'receipt',
    ])
      expect(text).not.toContain(word);
    const row = rowsOf(s.db, 'test_versions').find((v) => v.id === s.versionId);
    expect(row).toMatchObject({ status: 'published', content_sha256: body.contentSha256 });
    // R2 write precedes the guarded UPDATE.
    const order = s.db.calls.filter((c) => c.method === 'update' && c.table === 'test_versions');
    expect(order.at(-1)?.query).toMatchObject({ status: 'eq.draft', id: `eq.${s.versionId}` });
    expect(s.bucket.puts).toEqual([`packages/${s.versionId}.json`]);
  });

  it('refuses a version whose cutoff is missing or out of range with 422 cutoff_required', async () => {
    for (const cutoff of [null, 101, -1]) {
      const s = await setup();
      const row = rowsOf(s.db, 'test_versions').find((v) => v.id === s.versionId);
      if (row !== undefined) row.quality_cutoff = cutoff;
      const res = await s.publish();
      expect(res.status).toBe(422);
      expect(await errorCode(res)).toBe('cutoff_required');
      expect(s.bucket.puts).toEqual([]);
      expect(row?.status).toBe('draft');
    }
  });

  it('maps the column CHECK (23514) on the UPDATE to 422 cutoff_required', async () => {
    const s = await setup();
    s.db.failNext('update', 'test_versions', new RestError(400, '23514'));
    const res = await s.publish();
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('cutoff_required');
  });

  it('answers 409 for a testVersionId that is not the open draft (published, unknown, another test)', async () => {
    const s = await setup();
    expect((await s.publish()).status).toBe(200);
    const again = await s.publish();
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe('conflict');
    expect((await s.publish('f1000000-0000-4000-8000-000000000099')).status).toBe(409);
    const other = await setup();
    const res = await s.call('POST', `/v1/orgs/${ORG}/tests/${s.testId}/publish`, {
      testVersionId: other.versionId,
    });
    expect(res.status).toBe(409);
  });

  it('retires the version and answers 500 when the rebuilt package differs (fail closed)', async () => {
    const s = await setup();
    // A write that lands between the R2 put and the freeze: the frozen rows no longer match the package.
    const hooks = s.db.hooks.test_versions;
    const original = hooks?.update;
    if (hooks !== undefined && original !== undefined) {
      hooks.update = (old, next, d) => {
        const out = original(old, next, d);
        if (next.status === 'published') {
          const item = rowsOf(d, 'item_versions')[0];
          if (item !== undefined) item.stem = 'Changed after the package was written';
        }
        return out;
      };
    }
    const res = await s.publish();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: 'internal' } });
    expect(rowsOf(s.db, 'test_versions').find((v) => v.id === s.versionId)?.status).toBe('retired');
  });

  it('rewrites the R2 object from the frozen rows if it was overwritten before the check', async () => {
    const s = await setup();
    const put = s.bucket.put;
    let first = true;
    s.bucket.put = async (key, text, sha) => {
      await put(key, first ? `${text} ` : text, sha);
      first = false;
    };
    const body = PublishTestResponse.parse(await (await s.publish()).json());
    const text = s.bucket.objects.get(`packages/${s.versionId}.json`) ?? '';
    expect(await sha256Hex(text)).toBe(body.contentSha256);
  });

  it('a losing attempt whose stale R2 write lands after the winner restores the frozen package (spec review r3a #2)', async () => {
    const s = await setup();
    // Attempt B built the package from draft state 1; while its put is in flight the draft changes to state 2,
    // attempt A publishes state 2 (and passes its own check), and only then B's stale bytes land in R2.
    const put = s.bucket.put;
    let raced = false;
    let winner: { contentSha256: string } | undefined;
    s.bucket.put = async (key, text, sha) => {
      if (!raced) {
        raced = true;
        s.bucket.put = put;
        const edited = await s.call(
          'PUT',
          `/v1/orgs/${ORG}/tests/${s.testId}`,
          draftBody({ name: 'Synthetic Support Test, state 2' }),
        );
        expect(edited.status).toBe(200);
        const a = await s.publish();
        expect(a.status).toBe(200);
        winner = PublishTestResponse.parse(await a.json());
      }
      await put(key, text, sha);
    };
    const b = await s.publish();
    expect(b.status).toBe(409);
    expect(await errorCode(b)).toBe('conflict');
    const row = rowsOf(s.db, 'test_versions').find((v) => v.id === s.versionId);
    expect(row).toMatchObject({ status: 'published', content_sha256: winner?.contentSha256 });
    const text = s.bucket.objects.get(`packages/${s.versionId}.json`) ?? '';
    expect(await sha256Hex(text)).toBe(winner?.contentSha256);
    expect(TestPackage.parse(JSON.parse(text)).title).toBe('Synthetic Support Test, state 2');
  });

  it('an incomplete draft is 422 draft_incomplete before any R2 write or UPDATE', async () => {
    const empty = await setup({ draft: draftBody({ sections: [] }) });
    expect(await errorCode(await empty.publish())).toBe('draft_incomplete');
    const noItems = await setup({
      draft: draftBody({ sections: [{ format: 'mcq', name: 'Empty', weight: 10, items: [] }] }),
    });
    const res = await noItems.publish();
    expect(res.status).toBe(422);
    for (const s of [empty, noItems]) {
      expect(s.bucket.puts).toEqual([]);
      expect(
        s.db.calls.some(
          (c) =>
            c.method === 'update' &&
            c.query.status === 'eq.draft' &&
            c.table === 'test_versions' &&
            c.query.select !== 'id',
        ),
      ).toBe(false);
    }
  });

  it('maps a guard refusal of the UPDATE (42501) to 422 draft_incomplete', async () => {
    const s = await setup();
    s.db.failNext('update', 'test_versions', new RestError(403, '42501'));
    const res = await s.publish();
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('draft_incomplete');
  });

  it('a failed R2 write leaves the draft unpublished (503); no bucket bound is 503', async () => {
    const s = await setup();
    s.bucket.failPut = true;
    const res = await s.publish();
    expect(res.status).toBe(503);
    expect(rowsOf(s.db, 'test_versions').find((v) => v.id === s.versionId)?.status).toBe('draft');
    const db = authoringDb();
    const { call } = testsApp(db, null);
    const created = TestDetailResponse.parse(
      await (await call('POST', `/v1/orgs/${ORG}/tests`, { name: 'Synthetic Test' })).json(),
    );
    const r = await call('POST', `/v1/orgs/${ORG}/tests/${created.test.id}/publish`, {
      testVersionId: created.version.id,
    });
    expect(r.status).toBe(503);
  });

  it('checks the caller role before any R2 write: reviewer or no membership is 404, aal1 admin is 403 (security r3 #2)', async () => {
    const cases: { roles: string[] | null; status: number; code: string }[] = [
      { roles: ['reviewer'], status: 404, code: 'not_found' },
      { roles: null, status: 404, code: 'not_found' },
      { roles: ['admin'], status: 403, code: 'aal2_required' },
    ];
    for (const { roles, status, code } of cases) {
      const s = await setup();
      const member = rowsOf(s.db, 'memberships')[0];
      if (member === undefined) throw new Error('fixture: no membership row');
      if (roles === null) member.status = 'removed';
      else member.roles = roles;
      const before = s.db.calls.length;
      const res = await s.publish();
      expect(res.status).toBe(status);
      expect(await errorCode(res)).toBe(code);
      expect(s.bucket.puts).toEqual([]);
      expect(s.bucket.objects.size).toBe(0);
      expect(rowsOf(s.db, 'test_versions').find((v) => v.id === s.versionId)?.status).toBe('draft');
      // The role check is the first read: nothing about the test or its draft is read or written after it fails.
      expect(s.db.calls.slice(before).map((c) => `${c.method} ${c.table}`)).toEqual([
        'select memberships',
      ]);
    }
  });

  it('a test the caller cannot see is 404; a malformed body is 400', async () => {
    const s = await setup();
    const res = await s.call(
      'POST',
      `/v1/orgs/${ORG}/tests/e1000000-0000-4000-8000-000000000077/publish`,
      {
        testVersionId: s.versionId,
      },
    );
    expect(res.status).toBe(404);
    const bad = await s.call('POST', `/v1/orgs/${ORG}/tests/${s.testId}/publish`, {
      testVersionId: s.versionId,
      expectedRevision: 3,
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe('{"error":{"code":"bad_request"}}');
  });
});

describe('PUT …/tests/:testId (cutoff required, draft only)', () => {
  it('refuses a null, missing, fractional or out-of-range cutoff with 400 cutoff_required', async () => {
    const s = await setup();
    const base = draftBody() as unknown as Record<string, unknown>;
    const missing = Object.fromEntries(
      Object.entries(base).filter(([key]) => key !== 'qualityCutoff'),
    );
    for (const body of [
      { ...base, qualityCutoff: null },
      { ...base, qualityCutoff: 101 },
      { ...base, qualityCutoff: 40.5 },
      { ...base, qualityCutoff: '40' },
      missing,
    ]) {
      const res = await s.call('PUT', `/v1/orgs/${ORG}/tests/${s.testId}`, body);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('{"error":{"code":"cutoff_required"}}');
    }
    expect(rowsOf(s.db, 'test_versions').find((v) => v.id === s.versionId)?.quality_cutoff).toBe(
      55,
    );
  });

  it('accepts the boundaries 0 and 100', async () => {
    const s = await setup();
    for (const qualityCutoff of [0, 100]) {
      const res = await s.call(
        'PUT',
        `/v1/orgs/${ORG}/tests/${s.testId}`,
        draftBody({ qualityCutoff }),
      );
      expect(res.status).toBe(200);
      expect(TestDetailResponse.parse(await res.json()).version.qualityCutoff).toBe(qualityCutoff);
    }
  });

  it('a published test is read-only: 409, and the cutoff stays pinned', async () => {
    const s = await setup();
    expect((await s.publish()).status).toBe(200);
    const res = await s.call(
      'PUT',
      `/v1/orgs/${ORG}/tests/${s.testId}`,
      draftBody({ qualityCutoff: 10 }),
    );
    expect(res.status).toBe(409);
    expect(rowsOf(s.db, 'test_versions').find((v) => v.id === s.versionId)?.quality_cutoff).toBe(
      55,
    );
  });

  it('a freeze-trigger refusal during the replace (published meanwhile) is 409', async () => {
    const s = await setup();
    s.db.failNext('remove', 'item_versions', new RestError(403, '42501'));
    const res = await s.call('PUT', `/v1/orgs/${ORG}/tests/${s.testId}`, draftBody());
    expect(res.status).toBe(409);
  });
});
