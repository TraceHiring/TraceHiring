// Role templates and JD -> blueprint (spec m1 §6.1, ABH-5; M1-16, M1-17, R2-5, R2-8, R3-7, R5-29, R5-34; E18, E19;
// §6.11 `GET …/templates`, `POST …/blueprints/propose`, `POST …/tests/from-template`).
//
// - Library templates and library items are read as trace_api through the injected ReferenceSource (the viewer is the
//   verified JWT's sub/aal/amr only, R3-7); the org's own published templates are read as the caller (RLS).
// - JD matching is deterministic (no LLM, no vendor, M1-17): NFKC, lower case, letter/digit runs, stop words removed;
//   permille = |JD tokens ∩ keywords| / |keywords|; the best template at or above 15% is proposed. The JD text is never
//   stored, logged or returned: a job keeps only its SHA-256 and the permille (R5-29: no score column).
// - A template creates the job, the test and its draft: each available blueprint section becomes a pool section (a pool
//   named after it, filled through `library_copy_requests` with up to 10x the section's draw of approved library items
//   of its skill and format, R2-8); voice and typing sections are skipped and returned as a note (M1-16, E18); the
//   template's preset with the org's admin locks applied is stored as the draft's settings (R5-34) with the preset's
//   catalog version; weights sum to 100. It spends the caller's library budget first (the injected LibraryLimiter,
//   R5-56 g), and on any failure after its first write it archives the job and the test it created (fix round 1 #10).
import {
  BlueprintProposeRequest,
  BlueprintProposeResponse,
  CreateTestFromTemplateRequest,
  CreateTestFromTemplateResponse,
  RoleTemplateListQuery,
  RoleTemplateListResponse,
  type SaveTestDraftRequest,
} from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { z } from 'zod';
import { sha256Hex } from '../candidate/encoding.js';
import { loadLocks } from '../integrity-settings/locks.js';
import { pinPresetVersion, presetWithLocks } from '../integrity-settings/settings-write.js';
import { parseRows } from '../tests/authoring.js';
import { PUBLISHERS, draftViewOf } from '../tests/draft-routes.js';
import { buildSavePayload } from '../tests/draft.js';
import { answer, parseBody, readJson, readQuery } from '../tests/http.js';
import { requireRole } from '../tests/membership.js';
import {
  RestError,
  eq,
  handleOrg,
  orgFail,
  pathId,
  restErrorCode,
  rpcOf,
  type OrgContext,
  type OrgDeps,
} from '../tests/org-context.js';
import { cursorOf } from '../tests/rest-keyset.js';
import {
  TemplateRefSchema,
  type LibraryItemRef,
  type ReferenceSource,
  type TemplateRef,
} from './reference.js';

/**
 * The per-user library read limit (R5-56 g: 60 a minute per user, the same budget as `GET …/library/items`). The
 * shape of a Workers rate-limit binding, so the lead can bind one directly; the key is the caller's user id.
 */
export interface LibraryLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface TemplatesDeps {
  org: OrgDeps;
  /** Library reads as trace_api, or null when no database path is bound (503). */
  reference(env: Env): ReferenceSource | null;
  /** The library read limiter, or null when unbound (from-template answers 503: it reads the library). */
  limiter(env: Env): LibraryLimiter | null;
}

/** §6.1: the best template is proposed at or above 15% of its keywords. */
export const PROPOSE_THRESHOLD_PERMILLE = 150;
/** R2-8: a pool holds up to ten times its section's draw. */
const POOL_FACTOR = 10;
/** library_browse returns at most 100 rows a call; library_copy_requests takes at most 500 ids. */
const BROWSE_PAGE = 100;
const COPY_BATCH = 500;
const DEFAULT_CUTOFF = 40;
const MAX_TEMPLATES = 50;

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'our',
  'the',
  'to',
  'we',
  'will',
  'with',
  'you',
  'your',
]);

/** The JD (or keyword) tokens: NFKC, lower case, runs of letters and digits, stop words removed. */
export const tokensOf = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const m of text
    .normalize('NFKC')
    .toLowerCase()
    .matchAll(/[\p{L}\p{N}]+/gu)) {
    if (!STOP_WORDS.has(m[0])) out.add(m[0]);
  }
  return out;
};

/** |JD tokens ∩ keywords| / |keywords| in permille (rounded down). A keyword of several words needs all of them. */
export const matchPermille = (jd: ReadonlySet<string>, keywords: readonly string[]): number => {
  if (keywords.length === 0) return 0;
  const hits = keywords.filter((k) => {
    const parts = [...tokensOf(k)];
    return parts.length > 0 && parts.every((p) => jd.has(p));
  }).length;
  return Math.floor((hits * 1000) / keywords.length);
};

const OwnTemplateRow = z.object({
  id: z.uuid(),
  template_key: z.string(),
  version: z.number().int(),
  name: z.string(),
  keywords: z.array(z.string()),
  blueprint: z.unknown(),
  preset_key: z.string(),
});

/** The org's own published templates (as the caller) and the library's (as trace_api); the org's own win a clash. */
const usableTemplates = async (
  ctx: OrgContext,
  orgId: string,
  reference: ReferenceSource,
): Promise<TemplateRef[]> => {
  const own = parseRows(
    OwnTemplateRow,
    await ctx.rest.select('role_templates', {
      select: 'id,template_key,version,name,keywords,blueprint,preset_key',
      org_id: eq(orgId),
      status: 'eq.published',
      limit: String(MAX_TEMPLATES + 1),
    }),
  ).map((r) => {
    const t = TemplateRefSchema.safeParse({
      id: r.id,
      templateKey: r.template_key,
      version: r.version,
      name: r.name,
      keywords: r.keywords,
      blueprint: r.blueprint,
      presetKey: r.preset_key,
    });
    return t.success ? t.data : orgFail('unavailable');
  });
  const library = await reference.templates(ctx.caller, orgId);
  const keyOf = (t: TemplateRef) => `${t.templateKey}:${t.version}`;
  const ownKeys = new Set(own.map(keyOf));
  const all = [...own, ...library.filter((t) => !ownKeys.has(keyOf(t)))].sort((a, b) =>
    a.templateKey === b.templateKey
      ? a.version - b.version
      : a.templateKey < b.templateKey
        ? -1
        : 1,
  );
  // Never a silently cut list (DB review r3 m-3): the catalogue is small; past one page it fails closed.
  if (all.length > MAX_TEMPLATES) return orgFail('unavailable');
  return all;
};

const proposalOf = (t: TemplateRef, permille: number) => ({
  templateKey: t.templateKey,
  version: t.version,
  matchPermille: permille,
  sections: t.blueprint.sections,
});

/** Up to `want` approved library items of a skill and format, in the library's keyset order. */
const libraryItems = async (
  reference: ReferenceSource,
  ctx: OrgContext,
  orgId: string,
  skillKey: string,
  format: 'mcq' | 'written',
  want: number,
): Promise<LibraryItemRef[]> => {
  const out: LibraryItemRef[] = [];
  let after: { createdAt: string; id: string } | null = null;
  while (out.length < want) {
    const limit = Math.min(BROWSE_PAGE, want - out.length);
    const page = await reference.browse(ctx.caller, orgId, { skillKey, format, after, limit });
    out.push(...page);
    const last = page[page.length - 1];
    if (page.length < limit || last === undefined) break;
    after = { createdAt: last.createdAt, id: last.libraryItemVersionId };
  }
  return out.slice(0, want);
};

const CopyRow = z.object({ result_item_version_ids: z.array(z.uuid()) });

/** Copies library versions into the workspace (the guarded insert reuses earlier copies, R3-8) and returns local ids. */
const copyIntoWorkspace = async (
  ctx: OrgContext,
  orgId: string,
  workspaceId: string,
  ids: readonly string[],
): Promise<string[]> => {
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += COPY_BATCH) {
    const [row] = parseRows(
      CopyRow,
      await ctx.rest.insert(
        'library_copy_requests',
        {
          org_id: orgId,
          workspace_id: workspaceId,
          library_item_version_ids: ids.slice(i, i + COPY_BATCH),
        },
        { select: 'result_item_version_ids' },
      ),
    );
    out.push(...(row?.result_item_version_ids ?? orgFail('unavailable')));
  }
  return out;
};

/**
 * Archives the job and the test a failed from-template call created (best effort, as POST …/tests archives a test
 * whose draft insert failed): neither stays live, and the original failure is answered.
 */
const archiveCreated = async (
  ctx: OrgContext,
  orgId: string,
  made: { jobId: string | null; testId: string | null },
): Promise<void> => {
  const at = new Date().toISOString();
  for (const [table, id] of [
    ['tests', made.testId],
    ['jobs', made.jobId],
  ] as const) {
    if (id === null) continue;
    try {
      await ctx.rest.update(
        table,
        { id: eq(id), org_id: eq(orgId), archived_at: 'is.null', select: 'id' },
        { archived_at: at },
      );
    } catch {
      // The failure answer stands; a list hides a test without a usable draft anyway.
    }
  }
};

/** Equal integer weights summing to 100 (the first sections take the remainder). */
const weightsOf = (n: number): number[] =>
  Array.from({ length: n }, (_, i) => Math.floor(100 / n) + (i < 100 % n ? 1 : 0));

export const TEMPLATES_PATH = '/v1/orgs/:orgId/templates';
export const BLUEPRINTS_PROPOSE_PATH = '/v1/orgs/:orgId/blueprints/propose';
export const TESTS_FROM_TEMPLATE_PATH = '/v1/orgs/:orgId/tests/from-template';

export const createTemplatesRoutes = (deps: TemplatesDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.get(TEMPLATES_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, PUBLISHERS);
      const query = readQuery(c.req.url, RoleTemplateListQuery);
      const reference = deps.reference(c.env) ?? orgFail('unavailable');
      const all = await usableTemplates(ctx, orgId, reference);
      // The catalogue is one page; a cursor (never issued) reads past its end.
      const rows = cursorOf(query.cursor) === null ? all : [];
      return answer(RoleTemplateListResponse, {
        templates: rows.map((t) => ({
          templateKey: t.templateKey,
          version: t.version,
          name: t.name,
          presetKey: t.presetKey,
        })),
        nextCursor: null,
      });
    }),
  );

  app.post(BLUEPRINTS_PROPOSE_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, PUBLISHERS);
      const req = parseBody(BlueprintProposeRequest, await readJson(c.req.raw));
      const reference = deps.reference(c.env) ?? orgFail('unavailable');
      const jd = tokensOf(req.jdText);
      let best: { t: TemplateRef; permille: number } | null = null;
      for (const t of await usableTemplates(ctx, orgId, reference)) {
        const permille = matchPermille(jd, t.keywords);
        if (best === null || permille > best.permille) best = { t, permille };
      }
      const proposal =
        best !== null && best.permille >= PROPOSE_THRESHOLD_PERMILLE
          ? proposalOf(best.t, best.permille)
          : null;
      return answer(BlueprintProposeResponse, { proposal });
    }),
  );

  app.post(TESTS_FROM_TEMPLATE_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, PUBLISHERS);
      const req = parseBody(CreateTestFromTemplateRequest, await readJson(c.req.raw));
      const reference = deps.reference(c.env) ?? orgFail('unavailable');
      // Fix round 1 #10: a template reads the library, so it spends the caller's library budget first (R5-56 g).
      const limiter = deps.limiter(c.env) ?? orgFail('unavailable');
      if (!(await limiter.limit({ key: ctx.caller.userId })).success)
        return orgFail('rate_limited');
      const template =
        (await usableTemplates(ctx, orgId, reference)).find(
          (t) => t.templateKey === req.templateKey && t.version === req.templateVersion,
        ) ?? orgFail('not_found');

      let workspaceId = req.workspaceId;
      if (workspaceId === undefined) {
        const [ws] = parseRows(
          z.object({ id: z.uuid() }),
          await ctx.rest.select('workspaces', {
            select: 'id',
            org_id: eq(orgId),
            is_default: 'eq.true',
          }),
        );
        workspaceId = ws?.id ?? orgFail('not_found');
      }
      // The template's preset with the org's locks (R5-34); read before any write.
      const catalog = await reference.settingsCatalog(ctx.caller, orgId);
      const preset = catalog.presets[template.presetKey] ?? orgFail('unavailable');
      const settings = presetWithLocks(
        template.presetKey,
        preset,
        await loadLocks(ctx.rest, orgId),
      );

      // Fix round 1 #10: every write after the first one is undone the way POST …/tests undoes a failed create
      // (DB review r3 m-4): on any failure the job and the test are archived (best effort) before the answer.
      const made: { jobId: string | null; testId: string | null } = { jobId: null, testId: null };
      try {
        // M1-17, E19: only the JD's hash and the match permille are kept.
        const jdText = req.jdText ?? '';
        const [job] = parseRows(
          z.object({ id: z.uuid() }),
          await ctx.rest.insert(
            'jobs',
            {
              org_id: orgId,
              workspace_id: workspaceId,
              title: req.jobTitle,
              role_template_version_id: template.id,
              jd_sha256: jdText === '' ? null : await sha256Hex(jdText),
              template_match_permille:
                jdText === '' ? null : matchPermille(tokensOf(jdText), template.keywords),
            },
            { select: 'id' },
          ),
        );
        if (job === undefined) return orgFail('not_found');
        made.jobId = job.id;
        const [test] = parseRows(
          z.object({ id: z.uuid() }),
          await ctx.rest.insert(
            'tests',
            { org_id: orgId, workspace_id: workspaceId, name: req.jobTitle, job_id: job.id },
            { select: 'id' },
          ),
        );
        if (test === undefined) return orgFail('not_found');
        made.testId = test.id;
        const [version] = parseRows(
          z.object({ id: z.uuid(), ruleset_version_id: z.uuid().nullable() }),
          await ctx.rest.insert(
            'test_versions',
            {
              org_id: orgId,
              test_id: test.id,
              total_time_seconds: template.blueprint.totalTimeSeconds,
              quality_cutoff: DEFAULT_CUTOFF,
            },
            { select: 'id,ruleset_version_id' },
          ),
        );
        if (version === undefined) return orgFail('not_found');

        const available = template.blueprint.sections.filter(
          (s): s is typeof s & { format: 'mcq' | 'written' } =>
            s.available && (s.format === 'mcq' || s.format === 'written'),
        );
        const skippedSections = template.blueprint.sections
          .filter((s) => !s.available || (s.format !== 'mcq' && s.format !== 'written'))
          .map((s) => ({ title: s.title, format: s.format }));
        const weights = weightsOf(available.length);
        const sections: SaveTestDraftRequest['sections'] = [];
        for (const [i, s] of available.entries()) {
          const [pool] = parseRows(
            z.object({ id: z.uuid() }),
            await ctx.rest.insert(
              'pools',
              {
                org_id: orgId,
                workspace_id: workspaceId,
                name: s.title,
                format: s.format,
                skill_key: s.skillKey,
              },
              { select: 'id' },
            ),
          );
          if (pool === undefined) return orgFail('not_found');
          const found = await libraryItems(
            reference,
            ctx,
            orgId,
            s.skillKey,
            s.format,
            POOL_FACTOR * s.drawCount,
          );
          const local =
            found.length === 0
              ? []
              : await copyIntoWorkspace(
                  ctx,
                  orgId,
                  workspaceId,
                  found.map((f) => f.libraryItemVersionId),
                );
          if (local.length > 0) {
            await ctx.rest.insert(
              'pool_items',
              [...new Set(local)].map((id) => ({
                org_id: orgId,
                pool_id: pool.id,
                item_version_id: id,
              })),
              { select: 'item_version_id' },
            );
          }
          sections.push({
            mode: 'pool',
            format: s.format,
            name: s.title,
            weight: weights[i] ?? 1,
            items: [],
            poolId: pool.id,
            drawCount: s.drawCount,
            shuffleItems: s.format === 'mcq',
            shuffleOptions: s.format === 'mcq',
            navigation: s.format === 'mcq' ? 'free' : 'forward_only',
          });
        }
        const payload = await buildSavePayload(
          {
            name: req.jobTitle,
            durationMinutes: Math.min(
              120,
              Math.max(5, Math.round(template.blueprint.totalTimeSeconds / 60)),
            ),
            qualityCutoff: DEFAULT_CUTOFF,
            sections,
          },
          {
            settings: null,
            rubrics: new Map(),
            write: { presetKey: settings.presetKey, settings: settings.settings },
          },
        );
        payload.totalTimeSeconds = template.blueprint.totalTimeSeconds;
        try {
          await rpcOf(ctx.rest)('save_test_draft', {
            p_test_version: version.id,
            p_payload: payload,
          });
          // Fix round 1 #9: the preset's catalog version next to its key (save_test_draft stores none).
          if (version.ruleset_version_id !== null) {
            await pinPresetVersion(ctx, orgId, version.ruleset_version_id, settings);
          }
        } catch (err) {
          if (err instanceof RestError) return orgFail(restErrorCode(err));
          throw err;
        }
        return answer(
          CreateTestFromTemplateResponse,
          { draft: await draftViewOf(ctx, orgId, test.id), skippedSections },
          201,
        );
      } catch (err) {
        await archiveCreated(ctx, orgId, made);
        throw err;
      }
    }),
  );

  return app;
};
