// Test authoring routes (spec §6.2 rows `GET/POST /v1/orgs/:orgId/tests`, `GET/PUT …/tests/:testId`, `POST
// …/tests/:testId/publish`; L-9, L-15, OPEN-7; AT-D14/AT-D15 api parts; spec m1 R5-53 a, R5-34, M1-12). Every route
// verifies the caller (org-context) and reads and writes through PostgREST as them: RLS decides who may author (owner,
// admin, recruiter; a reviewer reads assigned tests only), the guard triggers own the draft-only rule and the state
// machine, and no service key exists. Anything the caller cannot see is a 404; errors are constant codes.
//
// M1 (R5-53 a): GET …/tests/:testId, the POST …/tests 201 and D1's PUT …/tests/:testId answer TestDraftView. D1's PUT
// stays: its body maps to inline sections with navigation null (package v1) and is saved by the same atomic
// `public.save_test_draft` call as PUT …/draft (draft-routes.ts).
//
// Publish (publish.ts): the caller must hold org_owner, admin or recruiter before anything touches R2 (security review
// r3 #2); a version with no M1 feature publishes as D1 (package v1); a v2 version is built from the live pool and sent
// with its snapshot digest (R5-56 d).
import {
  CreateTestRequest,
  PublishTestRequest,
  TestListResponse,
  UpdateTestDraftRequest,
} from '@trace/shared/contracts/d1';
import { TestDraftView } from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { z } from 'zod';
import { loadLocks } from '../integrity-settings/locks.js';
import { lockedStandard } from '../integrity-settings/settings-write.js';
import type { ReferenceSource } from '../templates/reference.js';
import {
  TEST_COLS,
  TestRowSchema,
  VERSION_COLS,
  VersionRowSchema,
  parseRows,
} from './authoring.js';
import { PUBLISHERS, draftViewOf, expectedVersionOf, saveDraft } from './draft-routes.js';
import { fromD1Request } from './draft.js';
import { answer, parseBody, readJson } from './http.js';
import { requireRole } from './membership.js';
import {
  LIST_LIMIT,
  PGRST_MAX_ROWS,
  capped,
  chunks,
  eq,
  handleOrg,
  orgFail,
  pathId,
  type OrgContext,
  type OrgDeps,
} from './org-context.js';
import { publishDraft, type PackageBucket } from './publish.js';

export type { PackageBucket } from './publish.js';

export interface TestRouteDeps {
  org: OrgDeps;
  /** The PACKAGES bucket, or null when it is not bound (publish answers 503). */
  packages(env: Env): PackageBucket | null;
  /**
   * Library reference reads as trace_api (presets), or null when no database path is bound. Used only to give a new
   * draft of an org with admin locks the Standard preset with the locks applied (R5-34); without it that draft has no
   * settings and its publish is refused by the database until settings are saved (fail closed).
   */
  reference?: (env: Env) => ReferenceSource | null;
}

export const packagesFromEnv = (env: Env): PackageBucket | null => {
  const bucket = env.PACKAGES;
  if (bucket === undefined) return null;
  const options = (sha256: string) => ({
    sha256,
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { sha256 },
  });
  return {
    put: async (key, text, sha256) => {
      await bucket.put(key, text, options(sha256));
    },
    head: async (key) => {
      const object = await bucket.head(key);
      return {
        etag: object?.etag ?? null,
        uploadedMs: object === null ? null : object.uploaded.getTime(),
        readAtMs: Date.now(),
      };
    },
    // Fix round 1 #1: R2 refuses the write (put answers null) when the object changed since `seen`: another etag, or
    // the same bytes uploaded later; an object that was absent must not have been uploaded since the read.
    putIfUnchanged: async (key, text, sha256, seen) => {
      const onlyIf: R2Conditional =
        seen.etag === null || seen.uploadedMs === null
          ? { uploadedBefore: new Date(seen.readAtMs) }
          : { etagMatches: seen.etag, uploadedBefore: new Date(seen.uploadedMs + 1) };
      return (await bucket.put(key, text, { ...options(sha256), onlyIf })) !== null;
    },
    getText: async (key) => {
      const object = await bucket.get(key);
      return object === null ? null : await object.text();
    },
  };
};

const DEFAULT_DURATION_MINUTES = 30;
const DEFAULT_CUTOFF = 40;

const cutoffValid = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;

/**
 * R5-34: a new draft of an org with admin locks gets the Standard preset with the locks applied (preset custom when a
 * lock moved a value). Best effort: without it the database refuses the draft's publish until settings are saved.
 */
const seedLockedSettings = async (
  deps: TestRouteDeps,
  env: Env,
  ctx: OrgContext,
  orgId: string,
  rulesetId: string | null,
): Promise<void> => {
  if (rulesetId === null) return;
  try {
    const write = await lockedStandard(
      deps.reference?.(env) ?? null,
      ctx,
      orgId,
      await loadLocks(ctx.rest, orgId),
    );
    if (write === null) return;
    await ctx.rest.update(
      'ruleset_versions',
      { id: eq(rulesetId), org_id: eq(orgId), published_at: 'is.null', select: 'id' },
      {
        preset_key: write.presetKey,
        preset_version: write.presetVersion,
        settings: write.settings,
      },
    );
  } catch {
    // The draft stands without settings; publish stays refused until they are saved (fail closed).
  }
};

export const TESTS_PATH = '/v1/orgs/:orgId/tests';
export const TEST_PATH = '/v1/orgs/:orgId/tests/:testId';
export const PUBLISH_PATH = '/v1/orgs/:orgId/tests/:testId/publish';

/** The sub-router the lead mounts with `app.route('/', createTestsRoutes({ org, packages: packagesFromEnv }))`. */
export const createTestsRoutes = (deps: TestRouteDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();
  app.get(TESTS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      // DB review r3 m-3: never a silently cut list. The tests read one past the cap; the versions are read per
      // chunk of test ids, and a chunk that reaches PostgREST's max_rows fails closed too.
      const tests = capped(
        parseRows(
          TestRowSchema,
          await ctx.rest.select('tests', {
            select: TEST_COLS,
            org_id: `eq.${orgId}`,
            order: 'created_at.desc',
            limit: LIST_LIMIT,
          }),
        ),
      );
      const versions: z.infer<typeof VersionRowSchema>[] = [];
      for (const ids of chunks(tests.map((t) => t.id))) {
        const part = parseRows(
          VersionRowSchema,
          await ctx.rest.select('test_versions', {
            select: VERSION_COLS,
            org_id: `eq.${orgId}`,
            test_id: `in.(${ids.join(',')})`,
            limit: String(PGRST_MAX_ROWS),
          }),
        );
        if (part.length >= PGRST_MAX_ROWS) return orgFail('unavailable');
        versions.push(...part);
      }
      const rows = tests.flatMap((t) => {
        const latest = versions
          .filter((v) => v.test_id === t.id)
          .sort((a, b) => b.version_no - a.version_no)[0];
        return latest === undefined
          ? []
          : [
              {
                id: t.id,
                name: t.name,
                status: latest.status,
                versionNo: latest.version_no,
                invitationCount: t.invitation_seq,
                createdAt: t.created_at,
              },
            ];
      });
      return answer(TestListResponse, { tests: rows });
    }),
  );

  app.post(TESTS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, PUBLISHERS);
      const req = parseBody(CreateTestRequest, await readJson(c.req.raw));
      let workspaceId = req.workspaceId;
      if (workspaceId === undefined) {
        const [ws] = parseRows(
          z.object({ id: z.uuid() }),
          await ctx.rest.select('workspaces', {
            select: 'id',
            org_id: `eq.${orgId}`,
            is_default: 'eq.true',
          }),
        );
        workspaceId = ws?.id ?? orgFail('not_found');
      }
      const [test] = parseRows(
        TestRowSchema,
        await ctx.rest.insert(
          'tests',
          { org_id: orgId, workspace_id: workspaceId, name: req.name },
          { select: TEST_COLS },
        ),
      );
      if (test === undefined) return orgFail('not_found');
      // The L-8 trigger creates the draft's ruleset row and pins the org's notice; no api code touches integrity.*.
      let rulesetId: string | null = null;
      let versionId: string | null = null;
      try {
        const [created] = parseRows(
          z.object({ id: z.uuid(), ruleset_version_id: z.uuid().nullable() }),
          await ctx.rest.insert(
            'test_versions',
            {
              org_id: orgId,
              test_id: test.id,
              total_time_seconds: (req.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60,
              quality_cutoff: DEFAULT_CUTOFF,
            },
            { select: 'id,ruleset_version_id' },
          ),
        );
        rulesetId = created?.ruleset_version_id ?? null;
        versionId = created?.id ?? null;
      } catch (err) {
        // DB review r3 m-4: the two inserts are not one transaction. A test without a draft could never be edited
        // (GET and PUT need a version), so archive it before answering the failure (best effort).
        try {
          await ctx.rest.update(
            'tests',
            { id: eq(test.id), org_id: eq(orgId), archived_at: 'is.null', select: 'id' },
            { archived_at: new Date().toISOString() },
          );
        } catch {
          // The failure answer stands; the list hides a test without a version anyway.
        }
        throw err;
      }
      if (versionId !== null) await seedLockedSettings(deps, c.env, ctx, orgId, rulesetId);
      return answer(TestDraftView, await draftViewOf(ctx, orgId, test.id), 201);
    }),
  );

  app.get(TEST_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      // R4 spec review #4 (spec §6.2 "idem"): the editor view carries the answer keys, and an assigned reviewer can
      // read the draft under RLS, so the authoring roles are checked first (as for PUT).
      await requireRole(ctx.rest, ctx.caller, orgId, PUBLISHERS);
      return answer(TestDraftView, await draftViewOf(ctx, orgId, testId));
    }),
  );

  app.put(TEST_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      // Spec review r3a #4: an assigned reviewer reads the draft under RLS, so the authoring roles are checked first.
      await requireRole(ctx.rest, ctx.caller, orgId, PUBLISHERS);
      const body = await readJson(c.req.raw);
      if (typeof body !== 'object' || body === null || Array.isArray(body))
        return orgFail('bad_request');
      // L-15: the cutoff is required; null, missing or out of range is its own 400.
      if (!cutoffValid((body as { qualityCutoff?: unknown }).qualityCutoff))
        return orgFail('cutoff_required', 400);
      const req = parseBody(UpdateTestDraftRequest, body);
      // R5-70 a, b: the expected version, and D1's request never overwrites a section it cannot express.
      return await saveDraft(ctx, orgId, testId, fromD1Request(req), {
        expectedVersion: expectedVersionOf(c.req.query('version')),
        requireD1Shape: true,
      });
    }),
  );

  app.post(PUBLISH_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      const req = parseBody(PublishTestRequest, await readJson(c.req.raw));
      // Security review r3 #2: an assigned reviewer can read the draft (RLS SELECT), so the role check comes before
      // any R2 write; only the guarded UPDATE decides the publish itself.
      await requireRole(ctx.rest, ctx.caller, orgId, PUBLISHERS);
      const bucket = deps.packages(c.env) ?? orgFail('unavailable');
      return await publishDraft(ctx, orgId, testId, req, bucket);
    }),
  );

  return app;
};
