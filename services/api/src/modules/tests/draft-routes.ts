// The M1 draft routes of the tests module (spec m1 §6.11: `PUT …/tests/:testId/draft` → `public.save_test_draft`;
// `POST …/tests/:testId/versions` clones the latest published version into a new draft, §4.2, Q20; R5-53 a: both answer
// TestDraftView). A separate router so the lead mounts it with the route inventory (R2-18); D1's router keeps its path
// set. Every write goes through PostgREST as the caller: RLS decides who may author, the guard triggers own the
// draft-only rule, the one-open-draft index and the settings locks; errors are constant codes.
import { SaveTestDraftRequest, TestDraftView } from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { z } from 'zod';
import { applyLocks, loadLocks, type SettingValues } from '../integrity-settings/locks.js';
import {
  lockedStandard,
  pinPresetVersion,
  type SettingsWrite,
} from '../integrity-settings/settings-write.js';
import {
  findRuleset,
  findTest,
  latestPublished,
  latestVersion,
  loadContent,
  parseRows,
} from './authoring.js';
import { d1Shaped } from './d1-shape.js';
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

export interface SaveDraftOptions {
  /**
   * R5-70 a: the `?version=` query, the version the editor loaded, or null when absent (D1's E2E support sends none).
   * Present and not the open draft's id → 409 conflict before anything is written, so a stale tab never overwrites a
   * newer draft.
   */
  expectedVersion: string | null;
  /** R5-70 b: D1's PUT refuses (409) a stored draft holding a section D1's request cannot express. */
  requireD1Shape: boolean;
}

/** The `?version=` query of a draft PUT: null when absent, else its text (lower-cased, as path ids are). */
export const expectedVersionOf = (query: string | undefined): string | null =>
  query === undefined ? null : query.toLowerCase();

/**
 * Saves `req` into the test's open draft (one save_test_draft call, atomic) and answers its TestDraftView. The stored
 * settings stay as they are unless an admin lock placed after they were stored moved a value (E16, R5-70 c): then the
 * locked settings are stored with the draft (custom, preset null, as the integrity PUT stores a moved preset), and the
 * request's paste rule is compared with them, so a later lock never makes the draft unsavable. Publish's checks are
 * unchanged (the database refuses a locked value there too).
 */
export const saveDraft = async (
  ctx: OrgContext,
  orgId: string,
  testId: string,
  req: SaveTestDraftRequest,
  opts: SaveDraftOptions = { expectedVersion: null, requireD1Shape: false },
): Promise<Response> => {
  const test = (await findTest(ctx.rest, orgId, testId)) ?? orgFail('not_found');
  const version = (await latestVersion(ctx.rest, orgId, testId)) ?? orgFail('not_found');
  if (version.status !== 'draft') return orgFail('conflict');
  if (opts.expectedVersion !== null && opts.expectedVersion !== version.id.toLowerCase()) {
    return orgFail('conflict');
  }
  const ruleset = await findRuleset(ctx.rest, orgId, version.ruleset_version_id);
  const current = await loadContent(ctx.rest, orgId, version.id);
  if (opts.requireD1Shape) {
    if (!d1Shaped(toDraftView(test, version, current).version.sections)) {
      return orgFail('conflict');
    }
  }
  let write: { presetKey: null; settings: SettingValues } | undefined;
  if (ruleset?.settings !== null && ruleset?.settings !== undefined) {
    const locked = applyLocks(ruleset.settings as SettingValues, await loadLocks(ctx.rest, orgId));
    if (locked.changed) write = { presetKey: null, settings: locked.values };
  }
  const payload = await buildSavePayload(req, {
    settings: ruleset?.settings ?? null,
    rubrics: current.rubrics,
    ...(write === undefined ? {} : { write }),
  });
  try {
    await rpcOf(ctx.rest)('save_test_draft', {
      p_test_version: version.id,
      p_payload: payload,
    });
  } catch (err) {
    return saveFailure(err);
  }
  return answer(TestDraftView, await draftViewOf(ctx, orgId, testId));
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
      return await saveDraft(ctx, orgId, testId, parseBody(SaveTestDraftRequest, body), {
        expectedVersion: expectedVersionOf(c.req.query('version')),
        requireD1Shape: false,
      });
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

      // The settings to write, read before any write: the source's, with any admin lock added since (E16; a moved
      // value makes the preset custom); for a source without settings in an org with locks, the Standard preset with
      // the locks (R5-34, fix round 1 #4). A named preset keeps its catalog version (fix round 1 #9).
      const locks = await loadLocks(ctx.rest, orgId);
      let write: SettingsWrite | null = null;
      if (sourceRuleset?.settings !== null && sourceRuleset?.settings !== undefined) {
        const locked = applyLocks(sourceRuleset.settings as SettingValues, locks);
        write = locked.changed
          ? { presetKey: null, presetVersion: null, settings: locked.values }
          : {
              presetKey: sourceRuleset.preset_key,
              presetVersion:
                sourceRuleset.preset_key === null ? null : sourceRuleset.preset_version,
              settings: locked.values,
            };
      } else {
        write = await lockedStandard(deps.reference?.(c.env) ?? null, ctx, orgId, locks);
      }

      // The new draft: the D1 seed trigger pins a new ruleset and the org's notice.
      const [created] = parseRows(
        z.object({ id: z.uuid(), ruleset_version_id: z.uuid().nullable() }),
        await ctx.rest.insert(
          'test_versions',
          {
            org_id: orgId,
            test_id: testId,
            total_time_seconds: source.total_time_seconds,
            quality_cutoff: source.quality_cutoff,
          },
          { select: 'id,ruleset_version_id' },
        ),
      );
      if (created === undefined) return orgFail('not_found');
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
        ...(write === null
          ? {}
          : { write: { presetKey: write.presetKey, settings: write.settings } }),
      });
      payload.totalTimeSeconds = source.total_time_seconds;
      try {
        await rpcOf(ctx.rest)('save_test_draft', {
          p_test_version: created.id,
          p_payload: payload,
        });
        // save_test_draft stores preset_version null; the version whose values were used is stored next to the key.
        if (write !== null && created.ruleset_version_id !== null) {
          await pinPresetVersion(ctx, orgId, created.ruleset_version_id, write);
        }
      } catch (err) {
        return saveFailure(err);
      }
      return answer(TestDraftView, await draftViewOf(ctx, orgId, testId), 201);
    }),
  );

  return app;
};
