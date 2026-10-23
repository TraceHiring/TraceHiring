// Fixtures for the authoring tests: the fake PostgREST of rest.test-helpers.ts with hooks that stand in for the
// migration triggers the api relies on (ids and timestamps, version_no, the L-8 ruleset/notice pin, draft-only
// children, the publish guard v2 with its snapshot and digest (M1-b, M1-e, M1-f), the ruleset settings guard with the
// org's admin locks, the frozen published row) and a stand-in for `public.save_test_draft` (M1-c), a fake R2 package
// bucket, and draft bodies. Synthetic data only. The real triggers are tested in supabase/tests (lead).
import type { UpdateTestDraftRequest } from '@trace/shared/contracts/d1';
import type { SaveTestDraftRequest } from '@trace/shared/contracts/m1';
import { snapshotDigest } from '@trace/shared/item-hash';
import { RestError, type OrgCaller, type OrgContext } from './org-context.js';
import { fakeDb, guardError, idMaker, type FakeDb, type Row } from './rest.test-helpers.js';
import { Hono } from 'hono';
import { createTestDraftRoutes } from './draft-routes.js';
import { createTestsRoutes, type PackageBucket, type TestRouteDeps } from './routes.js';

export const ORG = 'a1000000-0000-4000-8000-000000000001';
export const ORG_B = 'a1000000-0000-4000-8000-000000000003';
export const WS = 'b1000000-0000-4000-8000-000000000001';
export const USER = '00000000-0000-4000-8000-000000000005';
export const MEMBERSHIP = 'd1000000-0000-4000-8000-000000000005';
export const RULESET = 'c1000000-0000-4000-8000-000000000001';
export const NOTICE = 'c2000000-0000-4000-8000-000000000001';
export const LIBRARY_ORG = 'a1000000-0000-4000-8000-00000000000f';
const T0 = '2026-10-17T08:00:00.000+00:00';

/** The Standard preset of catalog m1-settings-v1 (migration M1-b seed). */
export const STANDARD = {
  calibration_warmup: 'on',
  typing_provenance: 'on',
  burst_after_tab: 'on',
  fullscreen_tab_focus: 'warn_first',
  single_screen: 'off',
  camera_face_presence: 'on',
  mic_speech_presence: 'off',
  explain_probe: 'off',
  question_copy: 'on',
  paste_written: 'allowed_logged',
  integrity_review_scope: 'shortlist_only',
  accommodations: 'on',
  id_verification: 'off',
} as const;
export const STRICT = {
  ...STANDARD,
  burst_after_tab: 'on',
  fullscreen_tab_focus: 'on',
  single_screen: 'on',
  mic_speech_presence: 'on',
  explain_probe: 'on',
  paste_written: 'blocked',
} as const;
export const OPEN_BOOK = {
  ...STANDARD,
  burst_after_tab: 'off',
  fullscreen_tab_focus: 'off',
  camera_face_presence: 'off',
  question_copy: 'off',
} as const;

const versionOf = (db: FakeDb, id: unknown) =>
  (db.tables.test_versions ?? []).find((v) => v.id === id);
const draftOnly = (db: FakeDb, versionId: unknown) => {
  if (versionOf(db, versionId)?.status !== 'draft') throw guardError();
};
const frozen = () => new RestError(403, '42501', 'version_frozen');
const locked = () => new RestError(403, '42501', 'setting_locked');

const SECTION_DEFAULTS = {
  time_limit_seconds: null,
  pool_id: null,
  draw_count: null,
  shuffle_items: false,
  shuffle_options: false,
  navigation: null,
  paste_rule: null,
  blueprint: null,
};

/** Bank and inline item defaults (M1-a columns). */
export const ITEM_DEFAULTS = {
  status: 'approved',
  origin: 'human',
  skill_key: null,
  difficulty: null,
  is_parameterised: false,
  media: null,
  param_spec: null,
  rubric_version_id: null,
  options: null,
};

const lockedValueBreaks = (db: FakeDb, orgId: unknown, settings: Record<string, unknown>) =>
  (db.tables.org_integrity_locks ?? []).some(
    (l) => l.org_id === orgId && settings[String(l.setting_key)] !== l.locked_value,
  );

/** The digest rows and exposure of a v2 publish, as the guard writes section_pool_snapshot. */
const snapshotOf = (db: FakeDb, version: Row) => {
  const sections = (db.tables.sections ?? []).filter((s) => s.test_version_id === version.id);
  const items = db.tables.item_versions ?? [];
  const exposure = (itemId: unknown) =>
    (db.tables.v_item_exposure ?? [])
      .filter((e) => e.item_id === itemId)
      .reduce((n, e) => n + Number(e.served_count), 0);
  return sections.flatMap((s) => {
    const ids =
      s.pool_id === null
        ? items.filter((i) => i.section_id === s.id)
        : (db.tables.pool_items ?? [])
            .filter((p) => p.pool_id === s.pool_id)
            .flatMap((p) => items.filter((i) => i.id === p.item_version_id))
            .filter((i) => i.status === 'approved');
    return ids.map((i) => ({
      org_id: version.org_id,
      section_id: s.id,
      item_version_id: i.id,
      test_version_id: version.id,
      exposure_at_publish: exposure(i.item_id),
    }));
  });
};

const usesM1 = (db: FakeDb, version: Row, settings: unknown) =>
  settings !== null ||
  (db.tables.sections ?? []).some(
    (s) =>
      s.test_version_id === version.id &&
      (s.pool_id !== null ||
        s.navigation !== null ||
        s.shuffle_items === true ||
        s.shuffle_options === true ||
        s.paste_rule !== null ||
        s.blueprint !== null),
  ) ||
  (db.tables.item_versions ?? []).some(
    (i) => i.test_version_id === version.id && i.media !== null && i.media !== undefined,
  );

const publishGuard = async (old: Row, next: Row, d: FakeDb): Promise<Row> => {
  if (next.content_sha256 === null) throw guardError();
  const sections = (d.tables.sections ?? []).filter((s) => s.test_version_id === old.id);
  const items = (d.tables.item_versions ?? []).filter((i) => i.test_version_id === old.id);
  if (sections.length === 0) throw guardError();
  if (sections.some((s) => s.pool_id === null && !items.some((i) => i.section_id === s.id)))
    throw guardError();
  const ruleset = (d.tables.ruleset_versions ?? []).find((r) => r.id === old.ruleset_version_id);
  const settings = (ruleset?.settings ?? null) as Record<string, unknown> | null;
  if (
    settings === null &&
    (d.tables.org_integrity_locks ?? []).some((l) => l.org_id === old.org_id)
  )
    throw new RestError(403, '42501', 'settings_required');
  const v2 = usesM1(d, old, settings);
  if (v2 && settings === null) throw new RestError(403, '42501', 'other');
  if (settings !== null && lockedValueBreaks(d, old.org_id, settings)) throw locked();
  let out: Row = { ...next, published_at: '2026-10-17T08:05:00.000+00:00' };
  if (v2) {
    if (sections.some((s) => s.navigation === null)) throw new RestError(403, '42501', 'other');
    if (
      sections.some(
        (s) => s.format === 'written' && s.paste_rule !== (settings?.paste_written ?? null),
      )
    )
      throw new RestError(403, '42501', 'other');
    if (sections.reduce((n, s) => n + Number(s.weight), 0) !== 100)
      throw new RestError(403, '42501', 'other');
    const snap = snapshotOf(d, old);
    for (const s of sections.filter((x) => x.pool_id !== null)) {
      if (snap.filter((r) => r.section_id === s.id).length < Number(s.draw_count))
        throw new RestError(403, '42501', 'pool_too_small');
    }
    if (next.snapshot_digest === null || next.snapshot_digest === undefined)
      throw new RestError(403, '42501', 'digest_required');
    const digest = await snapshotDigest(
      snap.map((r) => ({
        sectionId: String(r.section_id),
        itemVersionId: String(r.item_version_id),
      })),
    );
    if (digest !== next.snapshot_digest) throw new RestError(409, '40001', 'snapshot_changed');
    (d.tables.section_pool_snapshot ??= []).push(...snap);
    out = { ...out, package_version: 2 };
  } else {
    out = { ...out, package_version: 1, snapshot_digest: null };
  }
  if (ruleset !== undefined) ruleset.published_at = out.published_at;
  return out;
};

/** Records every save_test_draft payload the api sent (for assertions). */
export type AuthoringDb = FakeDb & { rest: OrgContext['rest']; savePayloads: unknown[] };

export const authoringDb = (): AuthoringDb => {
  const ids = {
    test: idMaker('e1'),
    version: idMaker('f1'),
    ruleset: idMaker('c1'),
    section: idMaker('5c'),
    item: idMaker('17'),
    itemIdentity: idMaker('1d'),
    rubric: idMaker('7b'),
  };
  const savePayloads: unknown[] = [];
  const db = fakeDb(
    {
      // The caller is a recruiter of ORG (publish narrows to org_owner, admin and recruiter before any R2 write).
      memberships: [
        { id: MEMBERSHIP, org_id: ORG, user_id: USER, status: 'active', roles: ['recruiter'] },
      ],
      workspaces: [
        { id: WS, org_id: ORG, is_default: true },
        { id: 'b1000000-0000-4000-8000-000000000004', org_id: ORG_B, is_default: true },
      ],
      org_integrity_locks: [],
      v_item_exposure: [],
    },
    {
      tests: {
        insert: (row) => ({
          id: ids.test(),
          created_at: T0,
          invitation_seq: 0,
          archived_at: null,
          created_by: USER,
          job_id: null,
          ...row,
        }),
      },
      test_versions: {
        insert: (row, d) => {
          const rulesetId = ids.ruleset();
          (d.tables.ruleset_versions ??= []).push({
            id: rulesetId,
            org_id: row.org_id,
            test_id: row.test_id,
            settings: null,
            preset_key: null,
            catalog_version: null,
            published_at: null,
          });
          return {
            id: ids.version(),
            version_no:
              Math.max(
                0,
                ...(d.tables.test_versions ?? [])
                  .filter((v) => v.test_id === row.test_id)
                  .map((v) => Number(v.version_no)),
              ) + 1,
            status: 'draft',
            ruleset_version_id: rulesetId,
            notice_version_id: NOTICE,
            content_sha256: null,
            published_at: null,
            package_version: 1,
            snapshot_digest: null,
            ...row,
          };
        },
        update: async (old, next, d) => {
          if (old.status === 'retired') throw guardError();
          if (old.status === 'published') {
            if (next.status !== 'retired') throw guardError();
            return next;
          }
          if (next.status === 'published') return publishGuard(old, next, d);
          return next;
        },
      },
      ruleset_versions: {
        update: (old, next, d) => {
          if (old.published_at !== null) throw guardError();
          const settings = next.settings as Record<string, unknown> | null;
          if (settings !== null && lockedValueBreaks(d, old.org_id, settings)) throw locked();
          return {
            ...next,
            catalog_version: settings === null ? null : 'm1-settings-v1',
          };
        },
      },
      sections: {
        insert: (row, d) => {
          draftOnly(d, row.test_version_id);
          return { id: ids.section(), ...SECTION_DEFAULTS, ...row };
        },
        update: (old, next, d) => {
          draftOnly(d, old.test_version_id);
          return next;
        },
        remove: (row, d) => draftOnly(d, row.test_version_id),
      },
      item_versions: {
        insert: (row, d) => {
          draftOnly(d, row.test_version_id);
          return { id: ids.item(), item_id: ids.itemIdentity(), ...ITEM_DEFAULTS, ...row };
        },
        remove: (row, d) => draftOnly(d, row.test_version_id),
      },
      item_answer_keys: {
        insert: (row, d) => {
          const item = (d.tables.item_versions ?? []).find((i) => i.id === row.item_version_id);
          draftOnly(d, item?.test_version_id);
          return row;
        },
        remove: (row, d) => {
          const item = (d.tables.item_versions ?? []).find((i) => i.id === row.item_version_id);
          draftOnly(d, item?.test_version_id);
        },
      },
      rubric_versions: { insert: (row) => ({ id: ids.rubric(), ...row }) },
      org_integrity_locks: {},
    },
    {
      // public.save_test_draft (M1-c), as the SQL body: version first (the guard refuses a published one), the test
      // name, the ruleset settings when given, then every child replaced in order.
      save_test_draft: (args, d) => {
        savePayloads.push(args.p_payload);
        const p = args.p_payload as {
          name: string;
          totalTimeSeconds: number;
          qualityCutoff: number;
          presetKey?: string | null;
          settings?: Record<string, unknown> | null;
          sections: {
            name: string;
            format: string;
            weight: number;
            timeLimitSeconds?: number;
            poolId?: string;
            drawCount?: number;
            shuffleItems?: boolean;
            shuffleOptions?: boolean;
            navigation?: string | null;
            pasteRule?: string | null;
            blueprint?: unknown;
            items: {
              format: string;
              stem: string;
              contentSha256: string;
              options?: unknown;
              correctOptionId?: string;
              rubricVersionId?: string;
              rubric?: { criteria: unknown; contentSha256: string };
            }[];
          }[];
        };
        const v = versionOf(d, args.p_test_version);
        if (v === undefined) throw new RestError(409, '23503', 'other');
        if (v.status !== 'draft') throw frozen();
        v.total_time_seconds = p.totalTimeSeconds;
        v.quality_cutoff = p.qualityCutoff;
        const test = (d.tables.tests ?? []).find((t) => t.id === v.test_id);
        if (test !== undefined) test.name = p.name;
        if (p.settings !== null && typeof p.settings === 'object') {
          const r = (d.tables.ruleset_versions ?? []).find((x) => x.id === v.ruleset_version_id);
          if (r === undefined || r.published_at !== null) throw frozen();
          if (lockedValueBreaks(d, v.org_id, p.settings)) throw locked();
          Object.assign(r, {
            settings: p.settings,
            preset_key: p.presetKey ?? null,
            catalog_version: 'm1-settings-v1',
          });
        }
        const itemIds = new Set(
          (d.tables.item_versions ?? []).filter((i) => i.test_version_id === v.id).map((i) => i.id),
        );
        d.tables.item_answer_keys = (d.tables.item_answer_keys ?? []).filter(
          (k) => !itemIds.has(k.item_version_id),
        );
        d.tables.item_versions = (d.tables.item_versions ?? []).filter(
          (i) => i.test_version_id !== v.id,
        );
        d.tables.sections = (d.tables.sections ?? []).filter((s) => s.test_version_id !== v.id);
        let items = 0;
        p.sections.forEach((s, si) => {
          const section = {
            ...SECTION_DEFAULTS,
            id: ids.section(),
            org_id: v.org_id,
            test_version_id: v.id,
            position: si + 1,
            name: s.name,
            format: s.format,
            weight: s.weight,
            time_limit_seconds: s.timeLimitSeconds ?? null,
            pool_id: s.poolId ?? null,
            draw_count: s.drawCount ?? null,
            shuffle_items: s.shuffleItems ?? false,
            shuffle_options: s.shuffleOptions ?? false,
            navigation: s.navigation ?? null,
            paste_rule: s.pasteRule ?? null,
            blueprint: s.blueprint ?? null,
          };
          d.tables.sections?.push(section);
          s.items.forEach((it, ii) => {
            let rubric: string | null = null;
            if (it.format === 'written') {
              if (it.rubric !== undefined) {
                rubric = ids.rubric();
                (d.tables.rubric_versions ??= []).push({
                  id: rubric,
                  org_id: v.org_id,
                  version_no: 1,
                  criteria: it.rubric.criteria,
                  content_sha256: it.rubric.contentSha256,
                });
              } else rubric = it.rubricVersionId ?? null;
            }
            const row = {
              ...ITEM_DEFAULTS,
              id: ids.item(),
              item_id: ids.itemIdentity(),
              org_id: v.org_id,
              test_version_id: v.id,
              section_id: section.id,
              format: it.format,
              position: ii + 1,
              stem: it.stem,
              options: it.format === 'mcq' ? (it.options ?? null) : null,
              rubric_version_id: rubric,
              content_sha256: it.contentSha256,
            };
            d.tables.item_versions?.push(row);
            if (it.format === 'mcq') {
              d.tables.item_answer_keys?.push({
                org_id: v.org_id,
                item_version_id: row.id,
                format: 'mcq',
                key: { option_id: it.correctOptionId },
              });
            }
            items += 1;
          });
        });
        return { sections: p.sections.length, items };
      },
    },
  );
  return Object.assign(db, { savePayloads });
};

export const fakeBucket = (): PackageBucket & {
  objects: Map<string, string>;
  puts: string[];
  failPut: boolean;
} => {
  const objects = new Map<string, string>();
  const puts: string[] = [];
  const bucket = {
    objects,
    puts,
    failPut: false,
    put: async (key: string, text: string) => {
      if (bucket.failPut) throw new Error('r2 down');
      puts.push(key);
      objects.set(key, text);
    },
    getText: async (key: string) => objects.get(key) ?? null,
  };
  return bucket;
};

export const callerOf = (patch: Partial<OrgCaller> = {}): OrgCaller => ({
  userId: USER,
  aal: 'aal1',
  amr: ['otp'],
  jwt: 'h.p.s',
  ...patch,
});

export const testsApp = (
  db: FakeDb & { rest: OrgContext['rest'] },
  bucket: PackageBucket | null = fakeBucket(),
  caller: OrgCaller = callerOf(),
  extra: Partial<TestRouteDeps> = {},
) => {
  const deps: TestRouteDeps = {
    org: { context: async () => ({ caller, rest: db.rest }) },
    packages: () => bucket,
    ...extra,
  };
  // The D1 router and the M1 draft router, mounted as the lead mounts them in app.ts.
  const app = new Hono<{ Bindings: Env }>();
  app.route('/', createTestsRoutes(deps));
  app.route('/', createTestDraftRoutes(deps));
  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      `https://api.test${path}`,
      {
        method,
        ...(body === undefined
          ? {}
          : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
        headers: { 'content-type': 'application/json' },
      },
      {} as Env,
    );
  return { app, call };
};

export const draftBody = (patch: Partial<UpdateTestDraftRequest> = {}): UpdateTestDraftRequest => ({
  name: 'Synthetic Support Test',
  durationMinutes: 20,
  qualityCutoff: 55,
  sections: [
    {
      format: 'mcq',
      name: 'Basics',
      weight: 40,
      items: [
        {
          format: 'mcq',
          prompt: 'Which colour is the synthetic sky?',
          options: [
            { id: 'a', text: 'Blue' },
            { id: 'b', text: 'Green' },
          ],
          correctOptionId: 'a',
        },
      ],
    },
    {
      format: 'written',
      name: 'Writing',
      weight: 60,
      items: [
        {
          format: 'written',
          prompt: 'Describe a synthetic refund process.',
          rubric: {
            criteria: [
              {
                id: 'c1',
                label: 'Mentions the receipt',
                maxPoints: 4,
                anchors: ['receipt', 'refund'],
                minHits: 1,
              },
            ],
          },
        },
      ],
    },
  ],
  ...patch,
});

/** The same draft as an M1 SaveTestDraftRequest (inline sections, v2 navigation). */
export const saveBody = (patch: Partial<SaveTestDraftRequest> = {}): SaveTestDraftRequest => {
  const d1 = draftBody();
  return {
    name: d1.name,
    durationMinutes: d1.durationMinutes,
    qualityCutoff: d1.qualityCutoff,
    sections: d1.sections.map((s) => ({
      mode: 'inline' as const,
      format: s.format,
      name: s.name,
      weight: s.weight,
      items: s.items,
      shuffleItems: false,
      shuffleOptions: false,
      navigation: s.format === 'written' ? ('forward_only' as const) : ('free' as const),
    })),
    ...patch,
  };
};

export const rowsOf = (db: FakeDb, table: string): Row[] => (db.tables[table] ??= []);

/** Sets the draft's ruleset settings directly (as a prior PUT …/integrity would). */
export const setSettings = (
  db: FakeDb,
  versionId: string,
  settings: Record<string, string> | null,
  presetKey: string | null = null,
) => {
  const v = versionOf(db, versionId);
  const r = rowsOf(db, 'ruleset_versions').find((x) => x.id === v?.ruleset_version_id);
  if (r === undefined) throw new Error('fixture: no ruleset');
  Object.assign(r, {
    settings,
    preset_key: presetKey,
    catalog_version: settings === null ? null : 'm1-settings-v1',
  });
};

/** A bank pool of approved items (M1-a rows) in ORG/WS, for pool sections. */
export const seedPool = (
  db: FakeDb,
  opts: {
    poolId: string;
    format: 'mcq' | 'written';
    count: number;
    prefix: string;
    status?: string;
    origin?: string;
    skillKey?: string | null;
    difficulty?: number | null;
    mediaOrg?: string;
  },
): Row[] => {
  (db.tables.pools ??= []).push({
    id: opts.poolId,
    org_id: ORG,
    workspace_id: WS,
    name: 'Synthetic pool',
    format: opts.format,
    status: 'active',
  });
  const rows: Row[] = [];
  for (let n = 1; n <= opts.count; n += 1) {
    const hex = n.toString(16).padStart(12, '0');
    const id = `${opts.prefix}000000-0000-4000-8000-${hex}`;
    const row: Row = {
      ...ITEM_DEFAULTS,
      id,
      item_id: `${opts.prefix}100000-0000-4000-8000-${hex}`,
      org_id: ORG,
      workspace_id: WS,
      section_id: null,
      test_version_id: null,
      position: null,
      format: opts.format,
      stem: `[synthetic] Pool item ${n}`,
      status: opts.status ?? 'approved',
      origin: opts.origin ?? 'human',
      skill_key: opts.skillKey === undefined ? 'verbal' : opts.skillKey,
      difficulty: opts.difficulty === undefined ? 0.45 : opts.difficulty,
      options:
        opts.format === 'mcq'
          ? [
              { id: 'a', text: `Option A ${n}` },
              { id: 'b', text: `Option B ${n}` },
            ]
          : null,
      rubric_version_id: opts.format === 'written' ? '7b900000-0000-4000-8000-000000000001' : null,
      media:
        opts.mediaOrg === undefined
          ? null
          : [
              {
                key: `item-media/${opts.mediaOrg}/${'ab'.repeat(32)}.png`,
                alt: 'A synthetic chart',
              },
            ],
      content_sha256: 'cd'.repeat(32),
    };
    rows.push(row);
    (db.tables.item_versions ??= []).push(row);
    (db.tables.pool_items ??= []).push({
      org_id: ORG,
      pool_id: opts.poolId,
      item_version_id: id,
      workspace_id: WS,
    });
    if (opts.format === 'mcq') {
      (db.tables.item_answer_keys ??= []).push({
        org_id: ORG,
        item_version_id: id,
        format: 'mcq',
        key: { option_id: 'a' },
        library_sourced: false,
      });
    }
  }
  return rows;
};
