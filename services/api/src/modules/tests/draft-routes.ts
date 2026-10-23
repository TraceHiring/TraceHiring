// The M1 draft routes of the tests module (spec m1 §6.11: `PUT …/tests/:testId/draft` → `public.save_test_draft`;
// `POST …/tests/:testId/versions` clones the latest published version into a new draft, §4.2, Q20; R5-53 a: both answer
// TestDraftView). A separate router so the lead mounts it with the route inventory (R2-18); D1's router keeps its path
// set. Every write goes through PostgREST as the caller: RLS decides who may author, the guard triggers own the
// draft-only rule, the one-open-draft index and the settings locks; errors are constant codes.
import { SaveTestDraftRequest, TestDraftView } from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { z } from 'zod';
import { applyLocks, loadLocks } from '../integrity-settings/locks.js';
import {
  findRuleset,
  findTest,
  latestPublished,
  latestVersion,
  loadContent,
  parseRows,
} from './authoring.js';
import { buildSavePayload, toDraftView } from './draft.js';
import { answer, BODY_CAPS, parseBody, readJson } from './http.js';
import { requireRole, type Role } from './membership.js';
import {
  RestError,
  handleOrg,
  orgFail,
  pathId,
  restErrorCode,
  rpcOf,
  type OrgContext,
} from './org-context.js';
import type { TestRouteDeps } from './routes.js';

/** The roles that may create, edit and publish (spec §6.2); the guard triggers and RLS still decide each write. */
export const PUBLISHERS: readonly Role[] = ['org_owner', 'admin', 'recruiter'];

export const TEST_DRAFT_PATH = '/v1/orgs/:orgId/tests/:testId/draft';
export const TEST_VERSIONS_PATH = '/v1/orgs/:orgId/tests/:testId/versions';

/** The editor view of the test's newest version. */
export const draftViewOf = async (ctx: OrgContext, orgId: string, testId: string) => {
  const test = (await findTest(ctx.rest, orgId, testId)) ?? orgFail('not_found');
  const version = (await latestVersion(ctx.rest, orgId, testId)) ?? orgFail('not_found');
  return toDraftView(test, version, await loadContent(ctx.rest, orgId, version.id));
};

/** A save_test_draft refusal: a frozen version (published meanwhile, E1) is 409; the rest by its guard key. */
const saveFailure = (err: unknown): never => {
  if (err instanceof RestError) {
    if (err.sqlstate === '42501' && (err.guard === null || err.guard === 'version_frozen')) {
      return orgFail('conflict');
    }
    if (err.sqlstate === '22023') return orgFail('bad_request');
    return orgFail(restErrorCode(err));
  }
  throw err;
};

/**
 * Saves `req` into the test's open draft (one save_test_draft call, atomic) and answers its TestDraftView. The stored
 * settings stay as they are unless `write` names new ones (the clone path).
 */
export const saveDraft = async (
  ctx: OrgContext,
  orgId: string,
  testId: string,
  req: SaveTestDraftRequest,
  status = 200,
): Promise<Response> => {
  if ((await findTest(ctx.rest, orgId, testId)) === null) return orgFail('not_found');
  const version = (await latestVersion(ctx.rest, orgId, testId)) ?? orgFail('not_found');
  if (version.status !== 'draft') return orgFail('conflict');
  const ruleset = await findRuleset(ctx.rest, orgId, version.ruleset_version_id);
  const current = await loadContent(ctx.rest, orgId, version.id);
  const payload = await buildSavePayload(req, {
    settings: ruleset?.settings ?? null,
    rubrics: current.rubrics,
  });
  try {
    await rpcOf(ctx.rest)('save_test_draft', {
      p_test_version: version.id,
      p_payload: payload,
    });
  } catch (err) {
    return saveFailure(err);
  }
  return answer(TestDraftView, await draftViewOf(ctx, orgId, testId), status);
};

/** A copy of `row` without `keys` (the view's ids and positions, which a save request does not carry). */
const withoutKeys = <T extends object, K extends keyof T>(
  row: T,
  keys: readonly K[],
): Omit<T, K> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!(keys as readonly string[]).includes(k)) out[k] = v;
  }
  return out as Omit<T, K>;
};

const cutoffValid = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;

export const createTestDraftRoutes = (deps: TestRouteDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.put(TEST_DRAFT_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, PUBLISHERS);
      // R5-53 d: a full draft is larger than the default body cap.
      const body = await readJson(c.req.raw, BODY_CAPS.saveTestDraft);
      if (typeof body !== 'object' || body === null || Array.isArray(body))
        return orgFail('bad_request');
      // L-15: the cutoff is required; null, missing or out of range is its own 400 (as D1's PUT).
      if (!cutoffValid((body as { qualityCutoff?: unknown }).qualityCutoff))
        return orgFail('cutoff_required', 400);
      return await saveDraft(ctx, orgId, testId, parseBody(SaveTestDraftRequest, body));
    }),
  );

  app.post(TEST_VERSIONS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, PUBLISHERS);
      if ((await findTest(ctx.rest, orgId, testId)) === null) return orgFail('not_found');
      const latest = (await latestVersion(ctx.rest, orgId, testId)) ?? orgFail('not_found');
      // One open draft per test (the database index refuses a second one too).
      if (latest.status === 'draft') return orgFail('conflict');
      const source = (await latestPublished(ctx.rest, orgId, testId)) ?? orgFail('conflict');
      const sourceRuleset = await findRuleset(ctx.rest, orgId, source.ruleset_version_id);
      const test = (await findTest(ctx.rest, orgId, testId)) ?? orgFail('not_found');
      const sourceContent = await loadContent(ctx.rest, orgId, source.id);
      const sourceView = toDraftView(test, source, sourceContent);

      // The new draft: the D1 seed trigger pins a new ruleset and the org's notice.
      const [created] = parseRows(
        z.object({ id: z.uuid() }),
        await ctx.rest.insert(
          'test_versions',
          {
            org_id: orgId,
            test_id: testId,
            total_time_seconds: source.total_time_seconds,
            quality_cutoff: source.quality_cutoff,
          },
          { select: 'id' },
        ),
      );
      if (created === undefined) return orgFail('not_found');

      // The source's settings, with any admin lock added since (E16); a moved value makes the preset custom.
      let write: { presetKey: string | null; settings: Record<string, unknown> } | undefined;
      if (sourceRuleset?.settings !== null && sourceRuleset?.settings !== undefined) {
        const locked = applyLocks(
          sourceRuleset.settings as Parameters<typeof applyLocks>[0],
          await loadLocks(ctx.rest, orgId),
        );
        write = {
          presetKey: locked.changed ? null : sourceRuleset.preset_key,
          settings: locked.values,
        };
      }
      // The content as a save request. Paste rules are left to the settings (DB-M1-1); the total time is the source's.
      const req: SaveTestDraftRequest = {
        name: sourceView.test.name,
        durationMinutes: Math.min(120, Math.max(5, Math.round(source.total_time_seconds / 60))),
        qualityCutoff: sourceView.version.qualityCutoff,
        sections: sourceView.version.sections.map((s) => ({
          ...withoutKeys(s, ['id', 'position', 'pasteRule']),
          items: s.items.map((i) =>
            i.format === 'mcq'
              ? withoutKeys(i, ['id', 'position'])
              : withoutKeys(i, ['id', 'position']),
          ),
        })),
      };
      const payload = await buildSavePayload(req, {
        settings: null,
        rubrics: sourceContent.rubrics,
        ...(write === undefined ? {} : { write }),
      });
      payload.totalTimeSeconds = source.total_time_seconds;
      try {
        await rpcOf(ctx.rest)('save_test_draft', {
          p_test_version: created.id,
          p_payload: payload,
        });
      } catch (err) {
        return saveFailure(err);
      }
      return answer(TestDraftView, await draftViewOf(ctx, orgId, testId), 201);
    }),
  );

  return app;
};
