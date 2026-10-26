// Library browse as trace_api (spec m1 M1-4, R2-5, R3-7, R5-57 b, R5-60 b; AT-M1-22): approved library stems are not
// readable by `authenticated`, so the api reads them through the DEFINER function `private.library_browse` (10
// arguments since M1-e) on its own database path (ApiDb: `set local role trace_api`, `trace.api_org_id` = the path
// org). Only `sub`, `aal` and `amr` of the verified Supabase JWT are passed; the function returns rows only to an active
// owner/admin/recruiter of that customer org (R3-7). The keyset is `(created_at, id)`: `created_at` travels as the
// exact text Postgres printed (to_json, microseconds), never through a JS Date. Options are texts only, never ids; no
// key, param spec or answer field exists in the row or the card (I-M1-5). SQL text is constant; values are bound.
import { LibraryItemCard, type PageCursor } from '@trace/shared/contracts/m1';
import { z } from 'zod';
import { openApiDb, type ApiDb } from '../candidate/api-db.js';
import { OrgError, orgFail, type OrgCaller } from '../tests/org-context.js';

export interface LibraryBrowseInput {
  skillKey?: string;
  format?: 'mcq' | 'written';
  difficultyMin?: number;
  difficultyMax?: number;
  /** The keyset after which to read, or null for the first page. */
  after: PageCursor | null;
  /** Rows to read (the function caps it at 100). */
  limit: number;
}

export interface LibraryCardRow {
  card: LibraryItemCard;
  /** `created_at` exactly as Postgres printed it (the cursor's keyset). */
  createdAt: string;
}

export interface LibrarySource {
  browse(caller: OrgCaller, orgId: string, input: LibraryBrowseInput): Promise<LibraryCardRow[]>;
}

const BROWSE_SQL =
  'select library_item_version_id, format::text as format, skill_key, difficulty::text as difficulty, stem, ' +
  "options, is_parameterised, to_json(created_at)#>>'{}' as created_at " +
  'from private.library_browse($1::uuid, $2, ' +
  "(select coalesce(array_agg(m), '{}') from jsonb_array_elements_text($3::text::jsonb) as m), $4, " +
  '$5::public.section_format, $6::numeric, $7::numeric, $8::timestamptz, $9::uuid, $10::int)';

const BrowseRow = z.object({
  library_item_version_id: z.uuid(),
  format: z.enum(['mcq', 'written']),
  skill_key: z.string(),
  difficulty: z.coerce.number(),
  stem: z.string(),
  options: z.array(z.string()).nullable(),
  is_parameterised: z.boolean(),
  created_at: z.string().min(1),
});

/** The rows of one browse call as cards; a row that does not fit its contract is 503 (never echoed). */
export const cardsOf = (rows: unknown): LibraryCardRow[] => {
  const parsed = z.array(BrowseRow).safeParse(rows);
  if (!parsed.success) return orgFail('unavailable');
  return parsed.data.map((r) => {
    const card = LibraryItemCard.safeParse({
      libraryItemVersionId: r.library_item_version_id,
      format: r.format,
      skillKey: r.skill_key,
      difficulty: r.difficulty,
      stem: r.stem,
      ...(r.format === 'mcq' && r.options !== null ? { options: r.options } : {}),
      isParameterised: r.is_parameterised,
    });
    return card.success ? { card: card.data, createdAt: r.created_at } : orgFail('unavailable');
  });
};

/** The browse reads over one ApiDb (one transaction per read). */
export const libraryFromApiDb = (db: ApiDb): LibrarySource => ({
  async browse(caller, orgId, input) {
    const rows = await db.withOrg(orgId, (tx) =>
      tx.query(BROWSE_SQL, [
        caller.userId,
        caller.aal,
        JSON.stringify(caller.amr),
        input.skillKey ?? null,
        input.format ?? null,
        input.difficultyMin ?? null,
        input.difficultyMax ?? null,
        input.after?.createdAt ?? null,
        input.after?.id ?? null,
        input.limit,
      ]),
    );
    return cardsOf(rows);
  },
});

/**
 * The production source: a trace_api connection per read (API_DB Hyperdrive on staging, API_DB_URL on the local stack),
 * closed after it; null when neither is bound (the route answers 503).
 */
export const libraryFromEnv = (env: Env): LibrarySource | null => {
  const e = env as { API_DB?: unknown; API_DB_URL?: unknown };
  if (e.API_DB === undefined && !(typeof e.API_DB_URL === 'string' && e.API_DB_URL !== '')) {
    return null;
  }
  return {
    async browse(caller, orgId, input) {
      const handle = openApiDb(env as Parameters<typeof openApiDb>[0]);
      if (handle === null) return orgFail('unavailable');
      try {
        return await libraryFromApiDb(handle.db).browse(caller, orgId, input);
      } catch (err) {
        if (err instanceof OrgError) throw err;
        return orgFail('unavailable');
      } finally {
        await handle.close();
      }
    },
  };
};
