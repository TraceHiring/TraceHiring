// Test stand-ins for the templates module (spec m1 R5-71 d, R5-63 f): `public.create_test_from_template` (M1-q) as
// its SQL body over the fake PostgREST (the job, the test, the draft version, one pool per section filled through
// `library_copy_requests` 500 ids a request, the pool items, the sections and settings through save_test_draft, the
// preset version pinned; one transaction: the fake's rpc restores every table on a throw), and the org's own
// published role templates as rows. Synthetic data only.
import { RestError } from '../tests/org-context.js';
import type { Row } from '../tests/rest.test-helpers.js';
import { ORG, type AuthoringDb } from '../tests/tests.test-helpers.js';

interface TemplateSectionPayload {
  name: string;
  format: string;
  weight: number;
  drawCount: number;
  skillKey: string;
  shuffleItems: boolean;
  shuffleOptions: boolean;
  navigation: string;
  libraryItemVersionIds: unknown;
}

interface TemplatePayload {
  workspaceId: string;
  jobTitle: string;
  roleTemplateVersionId: string;
  jdSha256?: string | null;
  templateMatchPermille?: number | null;
  totalTimeSeconds: number;
  qualityCutoff: number;
  presetKey?: string | null;
  presetVersion?: number | null;
  settings: unknown;
  sections: unknown;
}

const badInput = () => new RestError(400, '22023');

/**
 * Registers the create_test_from_template stand-in. `payloads` records every call's arguments; `apiWrites()` lists
 * the non-select calls the api made itself (the calls the function makes inside its transaction are left out).
 */
export const withTemplateRpc = (db: AuthoringDb) => {
  const payloads: { p_org: unknown; p_payload: unknown }[] = [];
  const spans: [number, number][] = [];
  const insert = async (table: string, body: unknown): Promise<Row[]> =>
    db.rest.insert<Row>(table, body);
  db.functions.create_test_from_template = async (args) => {
    const start = db.calls.length;
    payloads.push(structuredClone({ p_org: args.p_org, p_payload: args.p_payload }));
    try {
      const org = args.p_org;
      const p = args.p_payload as TemplatePayload | null;
      if (
        typeof org !== 'string' ||
        p === null ||
        typeof p !== 'object' ||
        !Array.isArray(p.sections) ||
        p.sections.length < 1 ||
        p.sections.length > 10 ||
        typeof p.settings !== 'object' ||
        p.settings === null ||
        Array.isArray(p.settings)
      ) {
        throw badInput();
      }
      const sections = p.sections as TemplateSectionPayload[];
      if (
        sections.some(
          (s) =>
            typeof s !== 'object' ||
            !Array.isArray(s.libraryItemVersionIds) ||
            s.libraryItemVersionIds.length > 1000,
        )
      ) {
        throw badInput();
      }
      const [job] = await insert('jobs', {
        org_id: org,
        workspace_id: p.workspaceId,
        title: p.jobTitle,
        role_template_version_id: p.roleTemplateVersionId,
        jd_sha256: p.jdSha256 ?? null,
        template_match_permille: p.templateMatchPermille ?? null,
      });
      const [test] = await insert('tests', {
        org_id: org,
        workspace_id: p.workspaceId,
        name: p.jobTitle,
        job_id: job?.id,
      });
      const [version] = await insert('test_versions', {
        org_id: org,
        test_id: test?.id,
        total_time_seconds: p.totalTimeSeconds,
        quality_cutoff: p.qualityCutoff,
      });
      if (job === undefined || test === undefined || version === undefined) throw badInput();
      const saved: Row[] = [];
      for (const s of sections) {
        const [pool] = await insert('pools', {
          org_id: org,
          workspace_id: p.workspaceId,
          name: s.name,
          format: s.format,
          skill_key: s.skillKey,
        });
        const ids = s.libraryItemVersionIds as string[];
        const copied: string[] = [];
        for (let i = 0; i < ids.length; i += 500) {
          const [req] = await insert('library_copy_requests', {
            org_id: org,
            workspace_id: p.workspaceId,
            library_item_version_ids: ids.slice(i, i + 500),
          });
          copied.push(...((req?.result_item_version_ids as string[] | undefined) ?? []));
        }
        const distinct = [...new Set(copied)];
        if (distinct.length > 0) {
          await insert(
            'pool_items',
            distinct.map((id) => ({ org_id: org, pool_id: pool?.id, item_version_id: id })),
          );
        }
        saved.push({
          name: s.name,
          format: s.format,
          weight: s.weight,
          poolId: pool?.id,
          drawCount: s.drawCount,
          shuffleItems: s.shuffleItems,
          shuffleOptions: s.shuffleOptions,
          navigation: s.navigation,
          items: [],
        });
      }
      await db.rest.rpc('save_test_draft', {
        p_test_version: version.id,
        p_payload: {
          name: p.jobTitle,
          totalTimeSeconds: p.totalTimeSeconds,
          qualityCutoff: p.qualityCutoff,
          presetKey: p.presetKey ?? null,
          settings: p.settings,
          sections: saved,
        },
      });
      if (p.presetKey != null && p.presetVersion != null) {
        for (const r of db.tables.ruleset_versions ?? []) {
          if (
            r.org_id === org &&
            r.id === version.ruleset_version_id &&
            r.preset_key === p.presetKey &&
            r.published_at === null
          ) {
            r.preset_version = p.presetVersion;
          }
        }
      }
      return { jobId: job.id, testId: test.id, versionId: version.id };
    } finally {
      spans.push([start, db.calls.length]);
    }
  };
  const apiWrites = () =>
    db.calls
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => c.method !== 'select' && !spans.some(([a, b]) => i >= a && i < b))
      .map(({ c }) => ({ method: c.method, table: c.table }));
  return { payloads, apiWrites };
};

/** One of the org's own published role templates (a synthetic one-section MCQ blueprint). */
export const ownTemplateRow = (n: number, patch: Row = {}): Row => ({
  id: `a7000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  org_id: ORG,
  template_key: `role_${String(n).padStart(4, '0')}`,
  version: 1,
  name: `[synthetic] Role ${n}`,
  keywords: ['synthetic', `role${n}`],
  blueprint: {
    sections: [
      { title: 'Verbal ability', format: 'mcq', skillKey: 'verbal', drawCount: 1, available: true },
    ],
    totalTimeSeconds: 1200,
  },
  preset_key: 'standard',
  status: 'published',
  created_at: '2026-10-20T09:00:00.000000+00:00',
  ...patch,
});
