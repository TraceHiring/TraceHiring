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
//   R5-56 g). Every read and check comes first; then one call of `public.create_test_from_template` (M1-q, R5-71 d,
//   R5-63 f) writes the job, test, draft, pools, copies, sections and settings in one transaction as the caller, so a
//   failure leaves nothing behind.
// - The template list (R5-63 f) is the org's own published templates (read in keyset pages of PGRST_MAX_ROWS) merged
//   with the library's, sorted by (templateKey, version), capped at TEMPLATE_LIST_CAP (503 past it, never a cut list)
//   and served in pages of 50; propose and from-template scan the whole list.
import {
  BlueprintProposeRequest,
  BlueprintProposeResponse,
  CreateTestFromTemplateRequest,
  CreateTestFromTemplateResponse,
  RoleTemplateListQuery,
  RoleTemplateListResponse,
  encodePageCursor,
} from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { z } from 'zod';
import { sha256Hex } from '../candidate/encoding.js';
import { loadLocks } from '../integrity-settings/locks.js';
import { presetWithLocks, type SettingsWrite } from '../integrity-settings/settings-write.js';
import { parseRows } from '../tests/authoring.js';
import { PUBLISHERS, draftViewOf } from '../tests/draft-routes.js';
import { answer, parseBody, readJson, readQuery } from '../tests/http.js';
import { requireRole } from '../tests/membership.js';
import {
  PGRST_MAX_ROWS,
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
import { PAGE_SIZE, cursorOf } from '../tests/rest-keyset.js';
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
/** library_browse returns at most 100 rows a call. */
const BROWSE_PAGE = 100;
const DEFAULT_CUTOFF = 40;
/** create_test_from_template refuses a section naming more library items (it copies them 500 a request). */
export const MAX_SECTION_LIBRARY_IDS = 1000;
/** create_test_from_template refuses more library ids in one call, all sections together (statement timeout, daily copy cap). */
export const MAX_CALL_LIBRARY_IDS = 2000;
/** The most templates (own and library, merged) any reader scans; past it every reader answers 503. */
export const TEMPLATE_LIST_CAP = 2000;

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

const toTemplateRef = (r: z.infer<typeof OwnTemplateRow>): TemplateRef => {
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
};

/**
 * The org's own published templates (as the caller, keyset pages of PGRST_MAX_ROWS by id until exhausted) and the
 * library's (as trace_api); the org's own win a clash. Sorted by (templateKey, version). Never a silently cut list
 * (DB review r3 m-3): past TEMPLATE_LIST_CAP it fails closed.
 */
const usableTemplates = async (
  ctx: OrgContext,
  orgId: string,
  reference: ReferenceSource,
): Promise<TemplateRef[]> => {
  const own: TemplateRef[] = [];
  let after: string | null = null;
  for (;;) {
    const rows: z.infer<typeof OwnTemplateRow>[] = parseRows(
      OwnTemplateRow,
      await ctx.rest.select('role_templates', {
        select: 'id,template_key,version,name,keywords,blueprint,preset_key',
        org_id: eq(orgId),
        status: 'eq.published',
        ...(after === null ? {} : { id: `gt.${after}` }),
        order: 'id.asc',
        limit: String(PGRST_MAX_ROWS),
      }),
    );
    own.push(...rows.map(toTemplateRef));
    if (own.length > TEMPLATE_LIST_CAP) return orgFail('unavailable');
    const last = rows[rows.length - 1];
    if (rows.length < PGRST_MAX_ROWS || last === undefined) break;
    after = last.id;
  }
  const library = await reference.templates(ctx.caller, orgId);
  const keyOf = (t: TemplateRef) => `${t.templateKey}:${String(t.version)}`;
  const ownKeys = new Set(own.map(keyOf));
  const all = [...own, ...library.filter((t) => !ownKeys.has(keyOf(t)))].sort((a, b) =>
    a.templateKey === b.templateKey
      ? a.version - b.version
      : a.templateKey < b.templateKey
        ? -1
        : 1,
  );
  if (all.length > TEMPLATE_LIST_CAP) return orgFail('unavailable');
  return all;
};

/**
 * The template list cursor. The contract's cursor carries only a `PageCursor` (`{createdAt, id}`), and a library
 * template has no `created_at`, so the cursor names the page's last template by id under a fixed marker time; the next
 * page starts after that template's (templateKey, version). A cursor of another list (other time) or whose template
 * is no longer listed (its place is unknown) is 400 `bad_request`, never a guessed page.
 */
const TEMPLATE_CURSOR_AT = '1970-01-01T00:00:00.000Z';
const templateCursor = (t: TemplateRef): string =>
  encodePageCursor({ createdAt: TEMPLATE_CURSOR_AT, id: t.id });
const pageStart = (all: readonly TemplateRef[], text: string | undefined): number => {
  const cursor = cursorOf(text);
  if (cursor === null) return 0;
  if (cursor.createdAt !== TEMPLATE_CURSOR_AT) return orgFail('bad_request');
  const at = all.findIndex((t) => t.id === cursor.id);
  return at < 0 ? orgFail('bad_request') : at + 1;
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

/** Equal integer weights summing to 100 (the first sections take the remainder). */
const weightsOf = (n: number): number[] =>
  Array.from({ length: n }, (_, i) => Math.floor(100 / n) + (i < 100 % n ? 1 : 0));

/** One available blueprint section with its weight and the library item versions found for its pool. */
export interface TemplateDraftSection {
  title: string;
  format: 'mcq' | 'written';
  skillKey: string;
  drawCount: number;
  weight: number;
  libraryItemVersionIds: readonly string[];
}

/**
 * The create_test_from_template payload (DB shape, the keys the function reads): MCQ sections shuffle items and
 * options and navigate freely, written ones neither shuffle nor go back. More than MAX_SECTION_LIBRARY_IDS library ids
 * for one section, or MAX_CALL_LIBRARY_IDS in all, is 503 `unavailable` (the function refuses it too).
 */
export const templateDraftPayload = (args: {
  workspaceId: string;
  jobTitle: string;
  template: TemplateRef;
  jdSha256: string | null;
  templateMatchPermille: number | null;
  settings: SettingsWrite;
  sections: readonly TemplateDraftSection[];
}) => {
  if (
    args.sections.some((s) => s.libraryItemVersionIds.length > MAX_SECTION_LIBRARY_IDS) ||
    args.sections.reduce((n, s) => n + s.libraryItemVersionIds.length, 0) > MAX_CALL_LIBRARY_IDS
  ) {
    return orgFail('unavailable');
  }
  return {
    workspaceId: args.workspaceId,
    jobTitle: args.jobTitle,
    roleTemplateVersionId: args.template.id,
    jdSha256: args.jdSha256,
    templateMatchPermille: args.templateMatchPermille,
    totalTimeSeconds: args.template.blueprint.totalTimeSeconds,
    qualityCutoff: DEFAULT_CUTOFF,
    presetKey: args.settings.presetKey,
    presetVersion: args.settings.presetVersion,
    settings: args.settings.settings,
    sections: args.sections.map((s) => ({
      name: s.title,
      format: s.format,
      weight: s.weight,
      drawCount: s.drawCount,
      skillKey: s.skillKey,
      shuffleItems: s.format === 'mcq',
      shuffleOptions: s.format === 'mcq',
      navigation: s.format === 'mcq' ? 'free' : 'forward_only',
      libraryItemVersionIds: [...s.libraryItemVersionIds],
    })),
  };
};

/** create_test_from_template's answer; anything else is 503 `unavailable`. */
const CreatedIds = z.strictObject({ jobId: z.uuid(), testId: z.uuid(), versionId: z.uuid() });

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
      const start = pageStart(all, query.cursor);
      const rows = all.slice(start, start + PAGE_SIZE);
      const last = rows[rows.length - 1];
      return answer(RoleTemplateListResponse, {
        templates: rows.map((t) => ({
          templateKey: t.templateKey,
          version: t.version,
          name: t.name,
          presetKey: t.presetKey,
        })),
        nextCursor:
          start + PAGE_SIZE < all.length && last !== undefined ? templateCursor(last) : null,
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

      const available = template.blueprint.sections.filter(
        (x): x is typeof x & { format: 'mcq' | 'written' } =>
          x.available && (x.format === 'mcq' || x.format === 'written'),
      );
      const skippedSections = template.blueprint.sections
        .filter((x) => !x.available || (x.format !== 'mcq' && x.format !== 'written'))
        .map((x) => ({ title: x.title, format: x.format }));
      const weights = weightsOf(available.length);
      const sections: TemplateDraftSection[] = [];
      for (const [i, x] of available.entries()) {
        const found = await libraryItems(
          reference,
          ctx,
          orgId,
          x.skillKey,
          x.format,
          POOL_FACTOR * x.drawCount,
        );
        sections.push({
          title: x.title,
          format: x.format,
          skillKey: x.skillKey,
          drawCount: x.drawCount,
          weight: weights[i] ?? 1,
          libraryItemVersionIds: found.map((f) => f.libraryItemVersionId),
        });
      }
      // M1-17, E19: only the JD's hash and the match permille are kept.
      const jdText = req.jdText ?? '';
      const payload = templateDraftPayload({
        workspaceId,
        jobTitle: req.jobTitle,
        template,
        jdSha256: jdText === '' ? null : await sha256Hex(jdText),
        templateMatchPermille:
          jdText === '' ? null : matchPermille(tokensOf(jdText), template.keywords),
        settings,
        sections,
      });

      // R5-71 d / R5-63 f: one transaction as the caller; a failure anywhere leaves nothing behind.
      let created: unknown;
      try {
        created = await rpcOf(ctx.rest)('create_test_from_template', {
          p_org: orgId,
          p_payload: payload,
        });
      } catch (err) {
        if (err instanceof RestError) return orgFail(restErrorCode(err));
        throw err;
      }
      const ids = CreatedIds.safeParse(created);
      if (!ids.success) return orgFail('unavailable');
      return answer(
        CreateTestFromTemplateResponse,
        { draft: await draftViewOf(ctx, orgId, ids.data.testId), skippedSections },
        201,
      );
    }),
  );

  return app;
};
