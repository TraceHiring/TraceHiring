// Library reference reads as trace_api (spec m1 R2-5, R3-7): the settings catalog with its presets, the published role
// templates and approved library items are not readable by `authenticated`, so the api reads them through the DEFINER
// functions `private.library_reference(p_viewer, p_aal, p_amr, kind)` and `private.library_browse(…)` on its own
// database path (ApiDb: `set local role trace_api`, `trace.api_org_id` = the path org). Only `sub`, `aal` and `amr`
// of the verified Supabase JWT are passed; the functions return rows only to an active owner/admin/recruiter of that
// customer org whose membership counts at this aal (R3-7). SQL text is constant; values are bound parameters. A row
// that does not fit is 503 `unavailable` (never echoed).
import {
  IntegritySettingsRequest,
  PresetKey,
  type IntegritySettingsRequest as SettingsRequest,
} from '@trace/shared/contracts/m1';
import { z } from 'zod';
import { openApiDb, type ApiDb } from '../candidate/api-db.js';
import { OrgError, orgFail, type OrgCaller } from '../tests/org-context.js';

export type SettingValues = SettingsRequest['values'];

export interface SettingsCatalog {
  catalogVersion: string;
  presets: Partial<Record<PresetKey, { version: number; values: SettingValues }>>;
}

const BlueprintSectionRef = z.object({
  title: z.string().min(1).max(120),
  format: z.enum(['mcq', 'written', 'typing', 'voice']),
  skillKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  drawCount: z.int().min(1).max(100),
  available: z.boolean(),
});
export const TemplateRefSchema = z.object({
  id: z.uuid(),
  templateKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  version: z.int().min(1),
  name: z.string().min(1).max(120),
  keywords: z.array(z.string().min(1).max(40)).min(1).max(80),
  blueprint: z.object({
    sections: z.array(BlueprintSectionRef).min(1).max(10),
    totalTimeSeconds: z.number().int().min(60).max(7200),
  }),
  presetKey: PresetKey,
});
export type TemplateRef = z.infer<typeof TemplateRefSchema>;

/** An approved library item version as browse returns it (stems and metadata; never a key, I-M1-5). */
export interface LibraryItemRef {
  libraryItemVersionId: string;
  format: 'mcq' | 'written';
  skillKey: string;
  difficulty: number;
  createdAt: string;
}

export interface LibraryBrowseFilter {
  skillKey: string;
  format: 'mcq' | 'written';
  /** The keyset after which to read (`created_at` text exactly as returned, id), or null for the first page. */
  after: { createdAt: string; id: string } | null;
  limit: number;
}

export interface ReferenceSource {
  settingsCatalog(caller: OrgCaller, orgId: string): Promise<SettingsCatalog>;
  templates(caller: OrgCaller, orgId: string): Promise<TemplateRef[]>;
  browse(caller: OrgCaller, orgId: string, filter: LibraryBrowseFilter): Promise<LibraryItemRef[]>;
}

const REFERENCE_SQL =
  'select private.library_reference($1::uuid, $2, ' +
  "(select coalesce(array_agg(m), '{}') from jsonb_array_elements_text($3::text::jsonb) as m), $4) as r";

const BROWSE_SQL =
  'select library_item_version_id, format::text as format, skill_key, difficulty::text as difficulty, ' +
  "to_json(created_at)#>>'{}' as created_at from private.library_browse($1::uuid, $2, " +
  "(select coalesce(array_agg(m), '{}') from jsonb_array_elements_text($3::text::jsonb) as m), $4, " +
  '$5::public.section_format, null, null, $6::timestamptz, $7::uuid, $8::int)';

const CatalogRow = z.object({
  catalogVersion: z.string().min(1).max(40),
  settings: z.array(z.unknown()),
  presets: z.array(
    z.object({
      presetKey: PresetKey,
      version: z.int().min(1),
      values: IntegritySettingsRequest.shape.values,
    }),
  ),
});

const BrowseRow = z.object({
  library_item_version_id: z.uuid(),
  format: z.enum(['mcq', 'written']),
  skill_key: z.string(),
  difficulty: z.coerce.number().min(0).max(1),
  created_at: z.string().min(1),
});

const parseOr503 = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const r = schema.safeParse(value);
  return r.success ? r.data : orgFail('unavailable');
};

/** The reference reads over one ApiDb (one transaction per read). */
export const referenceFromApiDb = (db: ApiDb): ReferenceSource => {
  const viewer = (caller: OrgCaller) => [caller.userId, caller.aal, JSON.stringify(caller.amr)];
  const reference = async (caller: OrgCaller, orgId: string, kind: string): Promise<unknown> => {
    const rows = await db.withOrg(orgId, (tx) =>
      tx.query<{ r: unknown }>(REFERENCE_SQL, [...viewer(caller), kind]),
    );
    return rows[0]?.r ?? [];
  };
  return {
    async settingsCatalog(caller, orgId) {
      const [row] = parseOr503(z.array(CatalogRow), await reference(caller, orgId, 'settings'));
      if (row === undefined) return orgFail('unavailable');
      const presets: SettingsCatalog['presets'] = {};
      for (const p of row.presets) {
        const prior = presets[p.presetKey];
        if (prior === undefined || prior.version < p.version) {
          presets[p.presetKey] = { version: p.version, values: p.values };
        }
      }
      return { catalogVersion: row.catalogVersion, presets };
    },
    async templates(caller, orgId) {
      return parseOr503(z.array(TemplateRefSchema), await reference(caller, orgId, 'templates'));
    },
    async browse(caller, orgId, filter) {
      const rows = await db.withOrg(orgId, (tx) =>
        tx.query(BROWSE_SQL, [
          ...viewer(caller),
          filter.skillKey,
          filter.format,
          filter.after?.createdAt ?? null,
          filter.after?.id ?? null,
          filter.limit,
        ]),
      );
      return parseOr503(z.array(BrowseRow), rows).map((r) => ({
        libraryItemVersionId: r.library_item_version_id,
        format: r.format,
        skillKey: r.skill_key,
        difficulty: r.difficulty,
        createdAt: r.created_at,
      }));
    },
  };
};

/**
 * The production source: a trace_api connection per read (API_DB Hyperdrive on staging, API_DB_URL on the local
 * stack), closed after it; null when neither is bound (the routes answer 503 where they need it).
 */
export const referenceFromEnv = (env: Env): ReferenceSource | null => {
  if (openApiDbProbe(env) === false) return null;
  const run = async <T>(fn: (source: ReferenceSource) => Promise<T>): Promise<T> => {
    const handle = openApiDb(env as Parameters<typeof openApiDb>[0]);
    if (handle === null) return orgFail('unavailable');
    try {
      return await fn(referenceFromApiDb(handle.db));
    } catch (err) {
      if (err instanceof OrgError) throw err;
      return orgFail('unavailable');
    } finally {
      await handle.close();
    }
  };
  return {
    settingsCatalog: (caller, orgId) => run((s) => s.settingsCatalog(caller, orgId)),
    templates: (caller, orgId) => run((s) => s.templates(caller, orgId)),
    browse: (caller, orgId, filter) => run((s) => s.browse(caller, orgId, filter)),
  };
};

/** Whether a database path is configured at all (without opening a connection). */
const openApiDbProbe = (env: Env): boolean => {
  const e = env as { API_DB?: unknown; API_DB_URL?: unknown };
  return e.API_DB !== undefined || (typeof e.API_DB_URL === 'string' && e.API_DB_URL !== '');
};
