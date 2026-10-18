// Test authoring routes (spec §6.2 rows `GET/POST /v1/orgs/:orgId/tests`, `GET/PUT …/tests/:testId`, `POST
// …/tests/:testId/publish`; L-9, L-15, OPEN-7; AT-D14/AT-D15 api parts). Every route verifies the caller (org-context)
// and reads and writes through PostgREST as them: RLS decides who may author (owner, admin, recruiter; a reviewer
// reads assigned tests only), the guard triggers own the draft-only rule and the state machine, and no service key
// exists. Anything the caller cannot see is a 404; errors are constant codes.
//
// Publish: the caller must hold org_owner, admin or recruiter before anything touches R2 (security review r3 #2);
// then the key-free TestPackage is built from the draft's rows, written to R2 `packages/{id}.json`, then the
// guarded UPDATE sets `published` with the api-supplied `content_sha256`; the package is rebuilt from the frozen rows
// and compared. A mismatch retires the version and answers 500 (fail closed; the SessionDO verifies the hash too).
import {
  CreateTestRequest,
  PublishTestRequest,
  PublishTestResponse,
  TestDetailResponse,
  TestListResponse,
  UpdateTestDraftRequest,
} from '@trace/shared/contracts/d1';
import { Hono } from 'hono';
import { z } from 'zod';
import { sha256Hex } from '../candidate/encoding.js';
import {
  TEST_COLS,
  TestRowSchema,
  VERSION_COLS,
  VersionRowSchema,
  findTest,
  findVersion,
  latestVersion,
  loadContent,
  parseRows,
  replaceDraft,
  toDetail,
} from './authoring.js';
import { parseBody, readJson } from './http.js';
import { requireRole, type Role } from './membership.js';
import {
  RestError,
  handleOrg,
  orgFail,
  orgJson,
  pathId,
  type OrgContext,
  type OrgDeps,
} from './org-context.js';
import { buildPackage, encodePackage, packageKey } from './package.js';

/** The roles that may create, edit and publish (spec §6.2); the guard triggers and RLS still decide each write. */
const PUBLISHERS: readonly Role[] = ['org_owner', 'admin', 'recruiter'];

/** The R2 package bucket as the publish step uses it (`PACKAGES`, trace-packages-<env>). */
export interface PackageBucket {
  /** Writes the bytes; R2 checks the upload against `sha256`. */
  put(key: string, text: string, sha256: string): Promise<void>;
  getText(key: string): Promise<string | null>;
}

export interface TestRouteDeps {
  org: OrgDeps;
  /** The PACKAGES bucket, or null when it is not bound (publish answers 503). */
  packages(env: Env): PackageBucket | null;
}

export const packagesFromEnv = (env: Env): PackageBucket | null => {
  const bucket = env.PACKAGES;
  if (bucket === undefined) return null;
  return {
    put: async (key, text, sha256) => {
      await bucket.put(key, text, {
        sha256,
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { sha256 },
      });
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

/** Every answer is parsed against its contract first; a row that does not fit is `unavailable`, never echoed. */
const answer = <T>(
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  body: unknown,
  status = 200,
): Response => {
  const out = schema.safeParse(body);
  return out.success ? orgJson(out.data, status) : orgFail('unavailable');
};

const detailOf = async (ctx: OrgContext, orgId: string, testId: string) => {
  const test = (await findTest(ctx.rest, orgId, testId)) ?? orgFail('not_found');
  const version = (await latestVersion(ctx.rest, orgId, testId)) ?? orgFail('not_found');
  const content = await loadContent(ctx.rest, orgId, version.id);
  return toDetail(test, version, content);
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
      const tests = parseRows(
        TestRowSchema,
        await ctx.rest.select('tests', {
          select: TEST_COLS,
          org_id: `eq.${orgId}`,
          order: 'created_at.desc',
        }),
      );
      const versions =
        tests.length === 0
          ? []
          : parseRows(
              VersionRowSchema,
              await ctx.rest.select('test_versions', {
                select: VERSION_COLS,
                org_id: `eq.${orgId}`,
                test_id: `in.(${tests.map((t) => t.id).join(',')})`,
              }),
            );
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
      await ctx.rest.insert(
        'test_versions',
        {
          org_id: orgId,
          test_id: test.id,
          total_time_seconds: (req.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60,
          quality_cutoff: DEFAULT_CUTOFF,
        },
        { select: 'id' },
      );
      return answer(TestDetailResponse, await detailOf(ctx, orgId, test.id), 201);
    }),
  );

  app.get(TEST_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      return answer(TestDetailResponse, await detailOf(ctx, orgId, testId));
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
      const test = (await findTest(ctx.rest, orgId, testId)) ?? orgFail('not_found');
      const version = (await latestVersion(ctx.rest, orgId, testId)) ?? orgFail('not_found');
      if (version.status !== 'draft') return orgFail('conflict');
      try {
        await replaceDraft(ctx.rest, orgId, test, version, req);
      } catch (err) {
        // A freeze-trigger refusal means the version was published meanwhile.
        if (err instanceof RestError && err.sqlstate === '42501') return orgFail('conflict');
        throw err;
      }
      return answer(TestDetailResponse, await detailOf(ctx, orgId, testId));
    }),
  );

  app.post(PUBLISH_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      const req = parseBody(PublishTestRequest, await readJson(c.req.raw));
      // Security review r3 #2: an assigned reviewer can read the draft (RLS SELECT), so the role check comes before
      // any R2 write; only the guarded UPDATE below decides the publish itself.
      await requireRole(ctx.rest, ctx.caller, orgId, PUBLISHERS);
      const bucket = deps.packages(c.env) ?? orgFail('unavailable');
      const test = (await findTest(ctx.rest, orgId, testId)) ?? orgFail('not_found');
      // L-9: the id must be this test's open draft.
      const draft = await findVersion(ctx.rest, orgId, testId, req.testVersionId);
      if (draft?.status !== 'draft') return orgFail('conflict');
      if (!cutoffValid(draft.quality_cutoff)) return orgFail('cutoff_required');

      const built = buildPackage(test, draft, await loadContent(ctx.rest, orgId, draft.id));
      if (!built.ok) return orgFail('draft_incomplete');
      const encoded = await encodePackage(built.pkg);
      const key = packageKey(draft.id);
      try {
        await bucket.put(key, encoded.text, encoded.sha256);
      } catch {
        return orgFail('unavailable');
      }

      let published: unknown[];
      try {
        published = await ctx.rest.update(
          'test_versions',
          {
            id: `eq.${draft.id}`,
            org_id: `eq.${orgId}`,
            test_id: `eq.${testId}`,
            status: 'eq.draft',
            select: VERSION_COLS,
          },
          { status: 'published', content_sha256: encoded.sha256 },
        );
      } catch (err) {
        // The guard refuses a draft that is not publishable (42501); the cutoff column is not null 0..100.
        if (err instanceof RestError && err.sqlstate === '42501')
          return orgFail('draft_incomplete');
        if (err instanceof RestError && err.sqlstate === '23514') return orgFail('cutoff_required');
        throw err;
      }
      const [frozen] = parseRows(VersionRowSchema, published);
      if (frozen === undefined) return orgFail('conflict');

      // Rebuild from the frozen rows; any difference retires the version (fail closed).
      const retire = async () => {
        try {
          await ctx.rest.update(
            'test_versions',
            { id: `eq.${frozen.id}`, org_id: `eq.${orgId}`, status: 'eq.published', select: 'id' },
            { status: 'retired' },
          );
        } catch {
          // The 500 stands either way; the SessionDO's hash check also refuses a mismatched package.
        }
        return orgFail('internal');
      };
      const frozenTest = await findTest(ctx.rest, orgId, testId);
      const rebuilt =
        frozenTest === null
          ? null
          : buildPackage(frozenTest, frozen, await loadContent(ctx.rest, orgId, frozen.id));
      const again = rebuilt?.ok === true ? await encodePackage(rebuilt.pkg) : null;
      if (
        frozen.status !== 'published' ||
        frozen.content_sha256 !== encoded.sha256 ||
        again === null ||
        again.sha256 !== encoded.sha256
      ) {
        return await retire();
      }
      // The object must hold the frozen package (a concurrent publish attempt of an earlier draft state could
      // have overwritten it); the frozen rows are the truth, so rewrite them if it differs.
      try {
        const stored = await bucket.getText(key);
        if (stored === null || (await sha256Hex(stored)) !== encoded.sha256) {
          await bucket.put(key, again.text, again.sha256);
        }
      } catch {
        return await retire();
      }

      return answer(PublishTestResponse, {
        testVersionId: frozen.id,
        versionNo: frozen.version_no,
        status: 'published',
        publishedAt: frozen.published_at,
        contentSha256: encoded.sha256,
        qualityCutoff: frozen.quality_cutoff,
      });
    }),
  );

  return app;
};
