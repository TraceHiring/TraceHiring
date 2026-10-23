// The key-free TestPackage v2 (spec m1 §5 TestPackageV2, §6.5, M1-12; R3-2, R5-56 a/d, R5-57 a, R5-58, R5-60 a;
// DB-M1-1; E4, E22). Built from the version's sections, its inline items and, for each pool section, the approved items
// of the pool (`live`, before publish) or the rows of section_pool_snapshot (`frozen`, after publish). Keys and rubrics
// are never read here. The package is parsed with TestPackageV2 before it is encoded, so a shape the edge would refuse
// is never written to R2.
//
// - Media keep `objectPath` exactly as stored in item_versions.media (a library copy keeps the library org's prefix,
//   SEC-M1-5); never rebuilt.
// - Option `text` becomes the package `label` (McqOptions).
// - `skillKey` and `difficultyBand` are copied together when the item version has both, else both are omitted (R5-58).
// - `exposureAtPublish` is the served count read at build (v_item_exposure); a frozen rebuild takes the built value
//   for each item (the snapshot keeps the count of the publish statement, never below it; R5-60 a).
// - A written section's paste rule is the settings' paste_written (DB-M1-1); the stored column must equal it.
import { captureSignalsFor, type IntegritySettingValues } from '@trace/shared';
import { canonicalJson } from '@trace/shared/canonical-json';
import { TestPackageV2 } from '@trace/shared/contracts/candidate';
import { IntegritySettingsRequest } from '@trace/shared/contracts/m1';
import { SIGNAL_CATALOG_VERSION } from '@trace/shared/signal-catalog';
import { snapshotDigest, type SnapshotRow } from '@trace/shared/item-hash';
import { difficultyBand } from '@trace/item-delivery';
import { z } from 'zod';
import { sha256Hex } from '../candidate/encoding.js';
import {
  ITEM_COLS,
  ItemRowSchema,
  inList,
  itemsOf,
  parseRows,
  type Content,
  type ItemRow,
  type RulesetRow,
  type SectionRow,
  type TestRow,
  type VersionRow,
} from './authoring.js';
import { chunks, orgFail, PGRST_MAX_ROWS, type Rest } from './org-context.js';

/** The R2 object is at most 5 MB (§5, E22). */
export const PACKAGE_MAX_BYTES = 5 * 1024 * 1024;
const PACKAGE_MAX_ITEMS = 5000;

const MEDIA_KEY = /^item-media\/[0-9a-f-]{36}\/([0-9a-f]{64})\.(png|jpg|webp)$/;

export type PackageV2Problem =
  | 'no_ruleset'
  | 'no_settings'
  | 'bad_duration'
  | 'no_sections'
  | 'empty_section'
  | 'no_navigation'
  | 'paste_rule'
  | 'pool_too_small'
  | 'too_large'
  | 'invalid';

export type BuiltPackageV2 =
  | { ok: true; pkg: TestPackageV2; rows: SnapshotRow[]; text: string; sha256: string }
  | { ok: false; problem: PackageV2Problem };

/** What one v2 package is built from. Items per section are already in package order. */
export interface PackageV2Source {
  sections: SectionRow[];
  items: Map<string, ItemRow[]>;
  /** item_version_id -> variants in variant_no order (parameterised items only). */
  variants: Map<string, VariantRow[]>;
  /** item_version_id -> served count. */
  exposure: Map<string, number>;
}

const VariantRowSchema = z.object({
  id: z.uuid(),
  item_version_id: z.uuid(),
  variant_no: z.number().int().min(1),
  stem: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() })),
});
export type VariantRow = z.infer<typeof VariantRowSchema>;

/**
 * Whether the version is package v2, exactly as publish guard v2 decides (M1-b): settings, any M1 section column, or
 * an inline item with media. A v1 version is built and published as D1 (R3-1).
 */
export const usesM1 = (
  ruleset: RulesetRow | null,
  sections: readonly SectionRow[],
  inline: readonly ItemRow[],
): boolean =>
  (ruleset?.settings ?? null) !== null ||
  sections.some(
    (s) =>
      s.pool_id !== null ||
      s.navigation !== null ||
      s.shuffle_items ||
      s.shuffle_options ||
      s.paste_rule !== null ||
      s.blueprint !== null,
  ) ||
  inline.some((i) => i.media !== null);

const sortById = (rows: ItemRow[]) => rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Rows of one keyed table read past PostgREST's max_rows on `col` (ascending), so a large pool is never cut. */
const readAll = async (
  rest: Rest,
  table: string,
  query: Readonly<Record<string, string>>,
  col: string,
): Promise<Record<string, unknown>[]> => {
  const out: Record<string, unknown>[] = [];
  let after: string | null = null;
  for (;;) {
    const page: Record<string, unknown>[] = await rest.select(table, {
      ...query,
      ...(after === null ? {} : { [col]: `gt.${after}` }),
      order: `${col}.asc`,
      limit: String(PGRST_MAX_ROWS),
    });
    out.push(...page);
    if (page.length < PGRST_MAX_ROWS) return out;
    const last = page[page.length - 1]?.[col];
    if (typeof last !== 'string') return orgFail('unavailable');
    after = last;
    if (out.length > PACKAGE_MAX_ITEMS * 2) return orgFail('unavailable');
  }
};

const loadItems = async (
  rest: Rest,
  orgId: string,
  ids: readonly string[],
  filter: Readonly<Record<string, string>> = {},
) => {
  const rows: ItemRow[] = [];
  for (const part of chunks(ids)) {
    rows.push(
      ...parseRows(
        ItemRowSchema,
        await rest.select('item_versions', {
          select: ITEM_COLS,
          org_id: `eq.${orgId}`,
          id: inList(part),
          ...filter,
        }),
      ),
    );
  }
  return rows;
};

const loadVariants = async (rest: Rest, orgId: string, items: readonly ItemRow[]) => {
  const variants = new Map<string, VariantRow[]>();
  const ids = items.filter((i) => i.is_parameterised).map((i) => i.id);
  for (const part of chunks(ids)) {
    const rows = parseRows(
      VariantRowSchema,
      await rest.select('item_variants', {
        select: 'id,item_version_id,variant_no,stem,options',
        org_id: `eq.${orgId}`,
        item_version_id: inList(part),
        order: 'variant_no.asc',
      }),
    );
    for (const r of rows) {
      const list = variants.get(r.item_version_id) ?? [];
      list.push(r);
      variants.set(r.item_version_id, list);
    }
  }
  for (const list of variants.values()) list.sort((a, b) => a.variant_no - b.variant_no);
  return variants;
};

const ExposureRow = z.object({ item_id: z.uuid(), served_count: z.coerce.number().int().min(0) });

/** item_version_id -> the served count of its item (v_item_exposure, summed over the caller's visible rows). */
const loadExposure = async (rest: Rest, orgId: string, items: readonly ItemRow[]) => {
  const byItem = new Map<string, number>();
  for (const part of chunks(items.map((i) => i.item_id))) {
    const rows = parseRows(
      ExposureRow,
      await rest.select('v_item_exposure', {
        select: 'item_id,served_count',
        org_id: `eq.${orgId}`,
        item_id: inList(part),
      }),
    );
    for (const r of rows) byItem.set(r.item_id, (byItem.get(r.item_id) ?? 0) + r.served_count);
  }
  return new Map(items.map((i) => [i.id, byItem.get(i.item_id) ?? 0]));
};

const PoolItemRow = z.object({ item_version_id: z.uuid() });

/**
 * The live source (before publish): inline items of inline sections, and for each pool section the approved bank
 * versions of its pool, ordered by id. Exactly the rows publish guard v2 writes into section_pool_snapshot.
 */
export const loadLiveSource = async (
  rest: Rest,
  orgId: string,
  content: Content,
): Promise<PackageV2Source> => {
  const items = new Map<string, ItemRow[]>();
  const all: ItemRow[] = [];
  for (const s of content.sections) {
    if (s.pool_id === null) {
      const inline = itemsOf(content, s.id);
      items.set(s.id, inline);
      all.push(...inline);
      continue;
    }
    const ids = parseRows(
      PoolItemRow,
      await readAll(
        rest,
        'pool_items',
        { select: 'item_version_id', org_id: `eq.${orgId}`, pool_id: `eq.${s.pool_id}` },
        'item_version_id',
      ),
    ).map((r) => r.item_version_id);
    // Approved bank versions only, as the guard's snapshot (an AI draft in review or a retired version never).
    const eligible = sortById(
      await loadItems(rest, orgId, ids, { status: 'eq.approved', section_id: 'is.null' }),
    );
    items.set(s.id, eligible);
    all.push(...eligible);
  }
  return {
    sections: content.sections,
    items,
    variants: await loadVariants(rest, orgId, all),
    exposure: await loadExposure(rest, orgId, all),
  };
};

const SnapshotRowSchema = z.object({
  section_id: z.uuid(),
  item_version_id: z.uuid(),
  exposure_at_publish: z.coerce.number().int().min(0),
});

/**
 * The frozen source (after publish): the item set of each section is section_pool_snapshot's; the content is the
 * frozen item versions (immutable once published or approved, I-M1-2, I-M1-3). `exposure` is the map the package was
 * built with.
 */
export const loadFrozenSource = async (
  rest: Rest,
  orgId: string,
  versionId: string,
  content: Content,
  exposure: ReadonlyMap<string, number>,
): Promise<PackageV2Source> => {
  const snap = parseRows(
    SnapshotRowSchema,
    await readAll(
      rest,
      'section_pool_snapshot',
      {
        select: 'section_id,item_version_id,exposure_at_publish',
        org_id: `eq.${orgId}`,
        test_version_id: `eq.${versionId}`,
      },
      'item_version_id',
    ),
  );
  const loaded = await loadItems(
    rest,
    orgId,
    snap.map((r) => r.item_version_id),
  );
  const byId = new Map(loaded.map((i) => [i.id, i]));
  const items = new Map<string, ItemRow[]>();
  for (const s of content.sections) {
    if (s.pool_id === null) {
      items.set(s.id, itemsOf(content, s.id));
      continue;
    }
    const rows = snap
      .filter((r) => r.section_id === s.id)
      .map((r) => byId.get(r.item_version_id) ?? orgFail('unavailable'));
    items.set(s.id, sortById(rows));
  }
  const all = [...items.values()].flat();
  // The built count of each item, never above the count the publish statement froze (R5-60 a); anything else makes
  // the rebuild differ (-1 is refused by packageItem), so the version is retired (fail closed).
  const frozenCount = new Map(snap.map((r) => [r.item_version_id, r.exposure_at_publish]));
  const counted = (id: string) => {
    const built = exposure.get(id);
    const limit = frozenCount.get(id);
    if (built === undefined) return -1;
    return limit !== undefined && built > limit ? -1 : built;
  };
  return {
    sections: content.sections,
    items,
    variants: await loadVariants(rest, orgId, all),
    exposure: new Map(all.map((i) => [i.id, counted(i.id)])),
  };
};

const settingsOf = (ruleset: RulesetRow | null): IntegritySettingValues | null => {
  if (ruleset?.settings === null || ruleset?.settings === undefined) return null;
  const parsed = IntegritySettingsRequest.shape.values.safeParse(ruleset.settings);
  return parsed.success ? parsed.data : null;
};

export const buildPackageV2 = async (
  test: TestRow,
  version: VersionRow,
  ruleset: RulesetRow | null,
  src: PackageV2Source,
): Promise<BuiltPackageV2> => {
  const fail = (problem: PackageV2Problem): BuiltPackageV2 => ({ ok: false, problem });
  if (version.ruleset_version_id === null || ruleset === null) return fail('no_ruleset');
  const settings = settingsOf(ruleset);
  if (settings === null || ruleset.catalog_version === null) return fail('no_settings');
  if (version.total_time_seconds < 60 || version.total_time_seconds > 7200) {
    return fail('bad_duration');
  }
  const sections = [...src.sections].sort((a, b) => a.position - b.position);
  if (sections.length === 0) return fail('no_sections');
  let captureSignals: ReturnType<typeof captureSignalsFor>;
  try {
    captureSignals = captureSignalsFor(settings, ruleset.catalog_version);
  } catch {
    return fail('no_settings');
  }
  const rows: SnapshotRow[] = [];
  const pkgSections: unknown[] = [];
  const pkgItems: unknown[] = [];
  for (const s of sections) {
    if (s.navigation === null) return fail('no_navigation');
    const items = src.items.get(s.id) ?? [];
    if (s.pool_id === null && items.length === 0) return fail('empty_section');
    if (s.pool_id !== null && items.length < (s.draw_count ?? Number.POSITIVE_INFINITY)) {
      return fail('pool_too_small');
    }
    let pasteRule: 'blocked' | 'allowed_logged' | undefined;
    if (s.format === 'written') {
      pasteRule = settings.paste_written;
      if (s.paste_rule !== pasteRule) return fail('paste_rule');
    }
    let strata: unknown[] = [];
    if (s.blueprint !== null) {
      const bp = s.blueprint as { strata?: unknown };
      if (!Array.isArray(bp.strata)) return fail('invalid');
      strata = bp.strata;
    }
    pkgSections.push({
      id: s.id,
      title: s.name,
      position: s.position,
      format: s.format,
      ...(s.time_limit_seconds === null ? {} : { timeLimitSeconds: s.time_limit_seconds }),
      navigation: s.navigation,
      shuffleItems: s.shuffle_items,
      shuffleOptions: s.shuffle_options,
      ...(pasteRule === undefined ? {} : { pasteRule }),
      draw: s.pool_id === null ? null : { count: s.draw_count, strata },
    });
    for (const item of items) {
      rows.push({ sectionId: s.id, itemVersionId: item.id });
      const built = packageItem(s.id, item, src);
      if (built === null) return fail('invalid');
      pkgItems.push(built);
    }
  }
  if (pkgItems.length > PACKAGE_MAX_ITEMS) return fail('too_large');
  const parsed = TestPackageV2.safeParse({
    v: 2,
    testVersionId: version.id,
    rulesetVersionId: version.ruleset_version_id,
    title: test.name,
    language: 'en',
    durationSeconds: version.total_time_seconds,
    heartbeatSeconds: 10,
    signalCatalogVersion: SIGNAL_CATALOG_VERSION,
    captureSignals,
    sections: pkgSections,
    items: pkgItems,
  });
  if (!parsed.success) return fail('invalid');
  const text = canonicalJson(parsed.data);
  if (new TextEncoder().encode(text).byteLength > PACKAGE_MAX_BYTES) return fail('too_large');
  return { ok: true, pkg: parsed.data, rows, text, sha256: await sha256Hex(text) };
};

const packageItem = (sectionId: string, item: ItemRow, src: PackageV2Source): unknown => {
  const exposure = src.exposure.get(item.id) ?? 0;
  if (exposure < 0) return null;
  let media: unknown[] | undefined;
  if (item.media !== null && item.media.length > 0) {
    media = [];
    for (const m of item.media) {
      const match = MEDIA_KEY.exec(m.key);
      if (match === null) return null;
      media.push({ hash: match[1], ext: match[2], alt: m.alt, objectPath: m.key });
    }
  }
  let tags: { skillKey: string; difficultyBand: number } | undefined;
  if (item.skill_key !== null && item.difficulty !== null) {
    try {
      tags = { skillKey: item.skill_key, difficultyBand: difficultyBand(item.difficulty) };
    } catch {
      return null;
    }
  }
  let variants: unknown[] | undefined;
  if (item.is_parameterised) {
    const list = src.variants.get(item.id) ?? [];
    if (list.length === 0) return null;
    variants = list.map((v) => ({
      variantId: v.id,
      prompt: v.stem,
      options: v.options.map((o) => ({ id: o.id, label: o.text })),
    }));
  }
  return {
    sectionId,
    itemVersionId: item.id,
    itemId: item.item_id,
    kind: item.format,
    prompt: item.stem,
    ...(item.format === 'mcq'
      ? { options: (item.options ?? []).map((o) => ({ id: o.id, label: o.text })) }
      : {}),
    ...(media === undefined ? {} : { media }),
    ...(tags === undefined ? {} : tags),
    exposureAtPublish: exposure,
    ...(variants === undefined ? {} : { variants }),
  };
};

/** The snapshot digest the publish update carries (R5-56 d, R5-60 a: section:item lines only). */
export const digestOf = (rows: readonly SnapshotRow[]): Promise<string> => snapshotDigest(rows);
