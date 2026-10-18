// Fixtures for the authoring tests: the fake PostgREST of rest.test-helpers.ts with hooks that stand in for the
// migration 1 and 3 triggers the api relies on (ids and timestamps, version_no, the L-8 ruleset/notice pin, draft-only
// children, the publish preconditions and the frozen published row), a fake R2 package bucket, and a draft body.
// Synthetic data only.
import type { UpdateTestDraftRequest } from '@trace/shared/contracts/d1';
import { guardError, idMaker, fakeDb, type FakeDb, type Row } from './rest.test-helpers.js';
import type { OrgCaller, OrgContext } from './org-context.js';
import { createTestsRoutes, type PackageBucket } from './routes.js';

export const ORG = 'a1000000-0000-4000-8000-000000000001';
export const ORG_B = 'a1000000-0000-4000-8000-000000000003';
export const WS = 'b1000000-0000-4000-8000-000000000001';
export const USER = '00000000-0000-4000-8000-000000000005';
export const MEMBERSHIP = 'd1000000-0000-4000-8000-000000000005';
export const RULESET = 'c1000000-0000-4000-8000-000000000001';
export const NOTICE = 'c2000000-0000-4000-8000-000000000001';
const T0 = '2026-10-17T08:00:00.000+00:00';

const versionOf = (db: FakeDb, id: unknown) =>
  (db.tables.test_versions ?? []).find((v) => v.id === id);
const draftOnly = (db: FakeDb, versionId: unknown) => {
  if (versionOf(db, versionId)?.status !== 'draft') throw guardError();
};

export const authoringDb = () => {
  const ids = {
    test: idMaker('e1'),
    version: idMaker('f1'),
    section: idMaker('5c'),
    item: idMaker('17'),
    rubric: idMaker('7b'),
  };
  const db = fakeDb(
    {
      // The caller is a recruiter of ORG (publish narrows to org_owner, admin and recruiter before any R2 write).
      memberships: [
        { id: MEMBERSHIP, org_id: ORG, user_id: USER, status: 'active', roles: ['recruiter'] },
      ],
      workspaces: [
        { id: WS, org_id: ORG, is_default: true },
        { id: 'b1000000-0000-4000-8000-000000000004', org_id: ORG_B, is_default: true },
      ],
    },
    {
      tests: {
        insert: (row) => ({
          id: ids.test(),
          created_at: T0,
          invitation_seq: 0,
          archived_at: null,
          created_by: USER,
          ...row,
        }),
      },
      test_versions: {
        insert: (row, d) => ({
          id: ids.version(),
          version_no:
            Math.max(
              0,
              ...(d.tables.test_versions ?? [])
                .filter((v) => v.test_id === row.test_id)
                .map((v) => Number(v.version_no)),
            ) + 1,
          status: 'draft',
          ruleset_version_id: RULESET,
          notice_version_id: NOTICE,
          content_sha256: null,
          published_at: null,
          ...row,
        }),
        update: (old, next, d) => {
          if (old.status === 'retired') throw guardError();
          if (old.status === 'published') {
            if (next.status !== 'retired') throw guardError();
            return next;
          }
          if (next.status === 'published') {
            if (next.content_sha256 === null) throw guardError();
            const sections = (d.tables.sections ?? []).filter((s) => s.test_version_id === old.id);
            const items = (d.tables.item_versions ?? []).filter(
              (i) => i.test_version_id === old.id,
            );
            if (sections.length === 0) throw guardError();
            if (sections.some((s) => !items.some((i) => i.section_id === s.id))) throw guardError();
            return { ...next, published_at: '2026-10-17T08:05:00.000+00:00' };
          }
          return next;
        },
      },
      sections: {
        insert: (row, d) => {
          draftOnly(d, row.test_version_id);
          return { id: ids.section(), ...row };
        },
        remove: (row, d) => draftOnly(d, row.test_version_id),
      },
      item_versions: {
        insert: (row, d) => {
          draftOnly(d, row.test_version_id);
          return { id: ids.item(), ...row };
        },
        remove: (row, d) => draftOnly(d, row.test_version_id),
      },
      item_answer_keys: {
        insert: (row, d) => {
          const item = (d.tables.item_versions ?? []).find((i) => i.id === row.item_version_id);
          draftOnly(d, item?.test_version_id);
          return row;
        },
        remove: (row, d) => {
          const item = (d.tables.item_versions ?? []).find((i) => i.id === row.item_version_id);
          draftOnly(d, item?.test_version_id);
        },
      },
      rubric_versions: { insert: (row) => ({ id: ids.rubric(), ...row }) },
    },
  );
  return db;
};

export const fakeBucket = (): PackageBucket & {
  objects: Map<string, string>;
  puts: string[];
  failPut: boolean;
} => {
  const objects = new Map<string, string>();
  const puts: string[] = [];
  const bucket = {
    objects,
    puts,
    failPut: false,
    put: async (key: string, text: string) => {
      if (bucket.failPut) throw new Error('r2 down');
      puts.push(key);
      objects.set(key, text);
    },
    getText: async (key: string) => objects.get(key) ?? null,
  };
  return bucket;
};

export const callerOf = (patch: Partial<OrgCaller> = {}): OrgCaller => ({
  userId: USER,
  aal: 'aal1',
  amr: ['otp'],
  jwt: 'h.p.s',
  ...patch,
});

export const testsApp = (
  db: FakeDb & { rest: OrgContext['rest'] },
  bucket: PackageBucket | null = fakeBucket(),
  caller: OrgCaller = callerOf(),
) => {
  const app = createTestsRoutes({
    org: { context: async () => ({ caller, rest: db.rest }) },
    packages: () => bucket,
  });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      `https://api.test${path}`,
      {
        method,
        ...(body === undefined
          ? {}
          : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
        headers: { 'content-type': 'application/json' },
      },
      {} as Env,
    );
  return { app, call };
};

export const draftBody = (patch: Partial<UpdateTestDraftRequest> = {}): UpdateTestDraftRequest => ({
  name: 'Synthetic Support Test',
  durationMinutes: 20,
  qualityCutoff: 55,
  sections: [
    {
      format: 'mcq',
      name: 'Basics',
      weight: 40,
      items: [
        {
          format: 'mcq',
          prompt: 'Which colour is the synthetic sky?',
          options: [
            { id: 'a', text: 'Blue' },
            { id: 'b', text: 'Green' },
          ],
          correctOptionId: 'a',
        },
      ],
    },
    {
      format: 'written',
      name: 'Writing',
      weight: 60,
      items: [
        {
          format: 'written',
          prompt: 'Describe a synthetic refund process.',
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
        },
      ],
    },
  ],
  ...patch,
});

export const rowsOf = (db: FakeDb, table: string): Row[] => db.tables[table] ?? [];
