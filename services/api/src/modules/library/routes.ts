// The Trace library for customers (spec m1 M1-4, §6.2, §6.11 `GET …/library/items` (rate-limited), `POST …/library/copy`;
// R2-5, R3-7, R3-8, R5-54 a, R5-56 g, R5-57 b; E7, E8; AT-M1-22 api part).
//
// - Browse reads approved library stems through the injected LibrarySource (trace_api, the verified viewer only) and
//   pages them by the `(created_at, id)` keyset with the exact `created_at` text (R5-57 b). A card has no key field.
// - Every browse spends one token of the caller's library budget: the injected LibraryLimiter is the same binding as
//   `POST …/tests/from-template` (LIBRARY_LIMITER, 60 a minute per user, one budget). Unbound is 503 before any read;
//   spent is 429 `rate_limited`.
// - Copy is the guarded `library_copy_requests` insert as the caller (staff of the workspace, the daily cap, reuse of
//   earlier copies keyed by workspace and source; R2-5, R3-8) and answers the local item version ids. The cap is
//   429 `library_cap` (E8); an item that is not an approved library version is 409.
import {
  LibraryBrowseQuery,
  LibraryBrowseResponse,
  LibraryCopyRequest,
  LibraryCopyResponse,
} from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUTHORS, defaultWorkspace } from '../bank/content.js';
import type { LibraryLimiter } from '../templates/routes.js';
import { parseRows } from '../tests/authoring.js';
import { answer, parseBody, readJson, readQuery } from '../tests/http.js';
import { requireRole } from '../tests/membership.js';
import { handleOrg, orgFail, pathId, type OrgDeps } from '../tests/org-context.js';
import { cursorOf, pageOf, PAGE_SIZE } from '../tests/rest-keyset.js';
import type { LibrarySource } from './source.js';

export interface LibraryDeps {
  org: OrgDeps;
  /** Library reads as trace_api, or null when no database path is bound (503). */
  source(env: Env): LibrarySource | null;
  /** The per-user library limiter (R5-56 g), or null when unbound (503 before any read). */
  limiter(env: Env): LibraryLimiter | null;
}

export const LIBRARY_ITEMS_PATH = '/v1/orgs/:orgId/library/items';
export const LIBRARY_COPY_PATH = '/v1/orgs/:orgId/library/copy';

const CopyRow = z.object({ result_item_version_ids: z.array(z.uuid()).nullable() });

export const createLibraryRoutes = (deps: LibraryDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.get(LIBRARY_ITEMS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      // The budget first: unbound is 503 and spent is 429 before any table or library read.
      const limiter = deps.limiter(c.env) ?? orgFail('unavailable');
      if (!(await limiter.limit({ key: ctx.caller.userId })).success) {
        return orgFail('rate_limited');
      }
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const query = readQuery(c.req.url, LibraryBrowseQuery);
      const source = deps.source(c.env) ?? orgFail('unavailable');
      const rows = await source.browse(ctx.caller, orgId, {
        ...(query.skillKey === undefined ? {} : { skillKey: query.skillKey }),
        ...(query.format === undefined ? {} : { format: query.format }),
        ...(query.difficultyMin === undefined ? {} : { difficultyMin: query.difficultyMin }),
        ...(query.difficultyMax === undefined ? {} : { difficultyMax: query.difficultyMax }),
        after: cursorOf(query.cursor),
        limit: PAGE_SIZE + 1,
      });
      const page = pageOf(
        rows.map((r) => ({
          id: r.card.libraryItemVersionId,
          created_at: r.createdAt,
          card: r.card,
        })),
      );
      return answer(LibraryBrowseResponse, {
        items: page.rows.map((r) => r.card),
        nextCursor: page.nextCursor,
      });
    }),
  );

  app.post(LIBRARY_COPY_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const req = parseBody(LibraryCopyRequest, await readJson(c.req.raw));
      const workspaceId = req.workspaceId ?? (await defaultWorkspace(ctx, orgId));
      const [row] = parseRows(
        CopyRow,
        await ctx.rest.insert(
          'library_copy_requests',
          {
            org_id: orgId,
            workspace_id: workspaceId,
            library_item_version_ids: req.libraryItemVersionIds,
          },
          { select: 'result_item_version_ids' },
        ),
      );
      const ids = row?.result_item_version_ids ?? orgFail('unavailable');
      return answer(LibraryCopyResponse, { itemVersionIds: ids });
    }),
  );

  return app;
};
