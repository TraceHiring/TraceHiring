// Library expert review through the api (spec m1 R5-64 h, M1-3, SEC-M1-4, ABH-6, R5-49 e): `POST …/bank/item-versions/
// :versionId/key-review` records the caller as the answer-key reviewer of an in-review `trace_library` version (the
// body id equals the path id; the reviewer is never taken from the body), after which a third library member approves
// it through the review route. Outside the library org it answers 409 `conflict`; the guard refusals are mapped (a
// state refusal 409, a permission refusal 403), never 404. Synthetic data only.
import { BankItemDetail } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import { RestError } from '../tests/org-context.js';
import {
  a2aDb,
  callerOf,
  codeOf,
  fakeVariants,
  harness,
  LIBRARY_ORG,
  LIBRARY_WS,
  ORG,
  seedVersion,
  type A2aDb,
} from './a2a.test-helpers.js';
import { createBankRoutes } from './routes.js';

/** Library content staff (synthetic ids): the author, the key reviewer and the approver. */
const AUTHOR = '00000000-0000-4000-8000-0000000000a1';
const KEY_REVIEWER = '00000000-0000-4000-8000-0000000000a2';
const APPROVER = '00000000-0000-4000-8000-0000000000a3';

const libraryDb = (): A2aDb => {
  const db = a2aDb();
  for (const [n, userId] of [AUTHOR, KEY_REVIEWER, APPROVER].entries()) {
    (db.tables.memberships ??= []).push({
      id: `d1000000-0000-4000-8000-0000000000b${String(n + 1)}`,
      org_id: LIBRARY_ORG,
      user_id: userId,
      status: 'active',
      roles: ['reviewer'],
    });
  }
  return db;
};

/** The bank router as `userId` (aal2, as a reviewer needs) on the paths of `orgId`. */
const as = (db: A2aDb, userId: string, orgId: string = LIBRARY_ORG) =>
  harness(
    (org) => createBankRoutes({ org, variants: () => fakeVariants }),
    db,
    callerOf({ userId, aal: 'aal2', amr: ['totp'] }),
    orgId,
  ).call;

const libraryVersion = (db: A2aDb, patch: Record<string, unknown> = {}) =>
  seedVersion(db, {
    org_id: LIBRARY_ORG,
    workspace_id: LIBRARY_WS,
    status: 'in_review',
    created_by: AUTHOR,
    ...patch,
  });

const keyReview = (call: ReturnType<typeof as>, versionId: unknown, body?: unknown) =>
  call(
    'POST',
    `/bank/item-versions/${String(versionId)}/key-review`,
    body ?? { itemVersionId: versionId },
  );

const keyPatches = (db: A2aDb) =>
  db.sentUpdates.filter((u) => u.table === 'item_versions' && 'key_reviewed_by' in u.patch);

describe('POST …/bank/item-versions/:id/key-review', () => {
  it('records the caller as key reviewer; a third library member then approves (R5-64 h, SEC-M1-4)', async () => {
    const db = libraryDb();
    const v = libraryVersion(db);
    // Without the key review the library approval is refused by the guard (a state refusal, 409).
    const early = await as(db, APPROVER)('POST', `/bank/item-versions/${String(v.id)}/review`, {
      itemVersionId: v.id,
      decision: 'approve',
    });
    expect(early.status).toBe(409);
    expect(await codeOf(early)).toBe('conflict');
    expect(v.status).toBe('in_review');

    const res = await keyReview(as(db, KEY_REVIEWER), v.id);
    expect(res.status).toBe(200);
    const body = BankItemDetail.parse(await res.json());
    expect(body).toMatchObject({ itemVersionId: v.id, status: 'in_review', approvedBy: null });
    expect(v.key_reviewed_by).toBe(KEY_REVIEWER);
    // The update carries the caller as key reviewer and nothing else (its own update, SEC-M1-4).
    expect(keyPatches(db).map((u) => u.patch)).toEqual([{ key_reviewed_by: KEY_REVIEWER }]);

    const ok = await as(db, APPROVER)('POST', `/bank/item-versions/${String(v.id)}/review`, {
      itemVersionId: v.id,
      decision: 'approve',
    });
    expect(ok.status).toBe(200);
    expect(BankItemDetail.parse(await ok.json())).toMatchObject({
      status: 'approved',
      approvedBy: APPROVER,
    });
    expect(v).toMatchObject({ reviewed_by: APPROVER, key_reviewed_by: KEY_REVIEWER });
  });

  it('never takes the reviewer from the body (a strict body: an extra field is 400)', async () => {
    const db = libraryDb();
    const v = libraryVersion(db);
    const res = await keyReview(as(db, KEY_REVIEWER), v.id, {
      itemVersionId: v.id,
      keyReviewedBy: APPROVER,
    });
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('bad_request');
    expect(keyPatches(db)).toEqual([]);
  });

  it('answers 409 conflict in a customer org and writes nothing', async () => {
    const db = libraryDb();
    const v = seedVersion(db, { status: 'in_review' });
    const call = harness(
      (org) => createBankRoutes({ org, variants: () => fakeVariants }),
      db,
      callerOf(),
      ORG,
    ).call;
    const res = await keyReview(call, v.id);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('conflict');
    expect(keyPatches(db)).toEqual([]);
    expect(v.key_reviewed_by).toBeUndefined();
  });

  it('the author as key reviewer is the guard refusal library_reviewers, answered 409 conflict', async () => {
    const db = libraryDb();
    const v = libraryVersion(db);
    const res = await keyReview(as(db, AUTHOR), v.id);
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(text).toBe('{"error":{"code":"conflict"}}');
    // The refusal came from the guard (the update was sent), and the version is unchanged.
    expect(keyPatches(db).map((u) => u.patch)).toEqual([{ key_reviewed_by: AUTHOR }]);
    expect(v.key_reviewed_by).toBeUndefined();
  });

  it('refuses a body id that differs from the path id (400) and takes an upper-case path id', async () => {
    const db = libraryDb();
    const v = libraryVersion(db);
    const res = await keyReview(as(db, KEY_REVIEWER), v.id, {
      itemVersionId: 'c4000000-0000-4000-8000-0000000000ff',
    });
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('bad_request');
    expect(keyPatches(db)).toEqual([]);
    const upper = await as(db, KEY_REVIEWER)(
      'POST',
      `/bank/item-versions/${String(v.id).toUpperCase()}/key-review`,
      { itemVersionId: v.id },
    );
    expect(upper.status).toBe(200);
  });

  it('the key-reviewer permission refusals answer 403 forbidden; a non-member sees 404', async () => {
    const db = libraryDb();
    const v = libraryVersion(db);
    for (const key of ['key_reviewer_member', 'key_reviewer_self'] as const) {
      db.failNext('update', 'item_versions', new RestError(403, '42501', key));
      const res = await keyReview(as(db, KEY_REVIEWER), v.id);
      expect(res.status, key).toBe(403);
      expect(await codeOf(res)).toBe('forbidden');
    }
    expect(v.key_reviewed_by).toBeUndefined();
    // A caller with no library membership cannot see the org (as every bank route).
    const stranger = '00000000-0000-4000-8000-0000000000a9';
    const res = await keyReview(as(db, stranger), v.id);
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe('not_found');
  });

  it('answers 409 once the key is reviewed or when the version is not in review, 404 when unknown', async () => {
    const db = libraryDb();
    const v = libraryVersion(db);
    expect((await keyReview(as(db, KEY_REVIEWER), v.id)).status).toBe(200);
    const again = await keyReview(as(db, APPROVER), v.id);
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe('conflict');
    expect(v.key_reviewed_by).toBe(KEY_REVIEWER);
    const draft = libraryVersion(db, { status: 'draft' });
    expect((await keyReview(as(db, KEY_REVIEWER), draft.id)).status).toBe(409);
    const unknown = 'c4000000-0000-4000-8000-0000000000ee';
    const res = await keyReview(as(db, KEY_REVIEWER), unknown);
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe('not_found');
  });
});
