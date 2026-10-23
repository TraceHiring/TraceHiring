// Authoring rows as the caller (spec §3.2 migration 1, §6.2 tests rows; spec m1 §3.3 the widened sections and item
// versions; path 1: PostgREST with the caller's JWT, so RLS, the freeze triggers and the audit actor apply). Every read
// is also filtered by the path org (a multi-org caller sees rows of each of their orgs through RLS). Rows are parsed
// before use; a row that does not parse is a 503 `unavailable` (never echoed). Answer keys and rubrics are org-side
// data: they never reach the test package.
import { z } from 'zod';
import { orgFail, type Rest } from './org-context.js';

const uuid = z.uuid();
const time = z.string().min(1);

export const TestRowSchema = z.object({
  id: uuid,
  org_id: uuid,
  workspace_id: uuid,
  name: z.string(),
  created_at: time,
  invitation_seq: z.number().int().min(0),
});
export type TestRow = z.infer<typeof TestRowSchema>;

export const VersionRowSchema = z.object({
  id: uuid,
  test_id: uuid,
  version_no: z.number().int().min(1),
  status: z.enum(['draft', 'published', 'retired']),
  total_time_seconds: z.number().int(),
  quality_cutoff: z.number().int().nullable(),
  ruleset_version_id: uuid.nullable(),
  content_sha256: z.string().nullable(),
  published_at: time.nullable(),
});
export type VersionRow = z.infer<typeof VersionRowSchema>;

/** A section with the M1 columns (§3.3; null navigation = package v1, R2-1). */
const SectionRowSchema = z.object({
  id: uuid,
  test_version_id: uuid,
  position: z.number().int().min(1),
  name: z.string(),
  format: z.enum(['mcq', 'written']),
  weight: z.coerce.number(),
  time_limit_seconds: z.number().int().nullable(),
  pool_id: uuid.nullable(),
  draw_count: z.number().int().nullable(),
  shuffle_items: z.boolean(),
  shuffle_options: z.boolean(),
  navigation: z.enum(['free', 'forward_only']).nullable(),
  paste_rule: z.enum(['blocked', 'allowed_logged']).nullable(),
  blueprint: z.unknown().nullable(),
});
export type SectionRow = z.infer<typeof SectionRowSchema>;

const OptionsSchema = z.array(z.object({ id: z.string(), text: z.string() })).nullable();
const MediaSchema = z.array(z.object({ key: z.string(), alt: z.string() })).nullable();

/** An item version (inline or bank) with the M1 columns the package and the editor read. */
export const ItemRowSchema = z.object({
  id: uuid,
  item_id: uuid,
  test_version_id: uuid.nullable(),
  section_id: uuid.nullable(),
  format: z.enum(['mcq', 'written']),
  position: z.number().int().min(1).nullable(),
  stem: z.string(),
  options: OptionsSchema,
  rubric_version_id: uuid.nullable(),
  media: MediaSchema,
  skill_key: z.string().nullable(),
  difficulty: z.coerce.number().nullable(),
  is_parameterised: z.boolean(),
});
export type ItemRow = z.infer<typeof ItemRowSchema>;

const KeyRowSchema = z.object({
  item_version_id: uuid,
  key: z.object({ option_id: z.string() }),
});

/** The jsonb criteria the api writes (DB validator: id, label, max_points > 0, anchors; plus min_hits). */
const StoredCriterion = z.object({
  id: z.string(),
  label: z.string(),
  max_points: z.number(),
  anchors: z.array(z.string()),
  min_hits: z.number().int(),
});
const RubricRowSchema = z.object({ id: uuid, criteria: z.array(StoredCriterion) });
export type StoredCriterion = z.infer<typeof StoredCriterion>;

export const TEST_COLS = 'id,org_id,workspace_id,name,created_at,invitation_seq';
export const VERSION_COLS =
  'id,test_id,version_no,status,total_time_seconds,quality_cutoff,ruleset_version_id,content_sha256,published_at';
export const SECTION_COLS =
  'id,test_version_id,position,name,format,weight,time_limit_seconds,pool_id,draw_count,shuffle_items,' +
  'shuffle_options,navigation,paste_rule,blueprint';
export const ITEM_COLS =
  'id,item_id,test_version_id,section_id,format,position,stem,options,rubric_version_id,media,skill_key,' +
  'difficulty,is_parameterised';

export const parseRows = <S extends z.ZodType>(schema: S, rows: unknown[]): z.infer<S>[] =>
  rows.map((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? (parsed.data as z.infer<S>) : orgFail('unavailable');
  });

export const inList = (ids: readonly string[]) => `in.(${ids.join(',')})`;

export const findTest = async (
  rest: Rest,
  orgId: string,
  testId: string,
): Promise<TestRow | null> => {
  const rows = await rest.select('tests', {
    select: TEST_COLS,
    id: `eq.${testId}`,
    org_id: `eq.${orgId}`,
  });
  return parseRows(TestRowSchema, rows)[0] ?? null;
};

/** The test's newest version. */
export const latestVersion = async (
  rest: Rest,
  orgId: string,
  testId: string,
): Promise<VersionRow | null> => {
  const rows = await rest.select('test_versions', {
    select: VERSION_COLS,
    org_id: `eq.${orgId}`,
    test_id: `eq.${testId}`,
    order: 'version_no.desc',
    limit: '1',
  });
  return parseRows(VersionRowSchema, rows)[0] ?? null;
};

/** The test's newest published version (the source of "Edit as new version", §4.2). */
export const latestPublished = async (
  rest: Rest,
  orgId: string,
  testId: string,
): Promise<VersionRow | null> => {
  const rows = await rest.select('test_versions', {
    select: VERSION_COLS,
    org_id: `eq.${orgId}`,
    test_id: `eq.${testId}`,
    status: 'eq.published',
    order: 'version_no.desc',
    limit: '1',
  });
  return parseRows(VersionRowSchema, rows)[0] ?? null;
};

export const findVersion = async (
  rest: Rest,
  orgId: string,
  testId: string,
  versionId: string,
): Promise<VersionRow | null> => {
  const rows = await rest.select('test_versions', {
    select: VERSION_COLS,
    id: `eq.${versionId}`,
    org_id: `eq.${orgId}`,
    test_id: `eq.${testId}`,
  });
  return parseRows(VersionRowSchema, rows)[0] ?? null;
};

export interface Content {
  sections: SectionRow[];
  /** The version's inline items (pool sections have none of their own). */
  items: ItemRow[];
  /** item_version_id -> option id */
  keys: Map<string, string>;
  /** rubric_version_id -> criteria */
  rubrics: Map<string, StoredCriterion[]>;
}

/** Answer keys of mcq item versions the caller can read (library-sourced keys are invisible, I-M1-5). */
export const loadKeys = async (
  rest: Rest,
  orgId: string,
  itemVersionIds: readonly string[],
): Promise<Map<string, string>> => {
  const keys = new Map<string, string>();
  if (itemVersionIds.length === 0) return keys;
  const rows = parseRows(
    KeyRowSchema,
    await rest.select('item_answer_keys', {
      select: 'item_version_id,key',
      org_id: `eq.${orgId}`,
      item_version_id: inList(itemVersionIds),
    }),
  );
  for (const r of rows) keys.set(r.item_version_id, r.key.option_id);
  return keys;
};

export const loadRubrics = async (
  rest: Rest,
  orgId: string,
  rubricIds: readonly string[],
): Promise<Map<string, StoredCriterion[]>> => {
  const rubrics = new Map<string, StoredCriterion[]>();
  const ids = [...new Set(rubricIds)];
  if (ids.length === 0) return rubrics;
  const rows = parseRows(
    RubricRowSchema,
    await rest.select('rubric_versions', {
      select: 'id,criteria',
      org_id: `eq.${orgId}`,
      id: inList(ids),
    }),
  );
  for (const r of rows) rubrics.set(r.id, r.criteria);
  return rubrics;
};

export const loadSections = async (
  rest: Rest,
  orgId: string,
  versionId: string,
): Promise<SectionRow[]> =>
  parseRows(
    SectionRowSchema,
    await rest.select('sections', {
      select: SECTION_COLS,
      org_id: `eq.${orgId}`,
      test_version_id: `eq.${versionId}`,
      order: 'position.asc',
    }),
  );

export const loadContent = async (
  rest: Rest,
  orgId: string,
  versionId: string,
): Promise<Content> => {
  const sections = await loadSections(rest, orgId, versionId);
  const items = parseRows(
    ItemRowSchema,
    await rest.select('item_versions', {
      select: ITEM_COLS,
      org_id: `eq.${orgId}`,
      test_version_id: `eq.${versionId}`,
      order: 'position.asc',
    }),
  );
  const keys = await loadKeys(
    rest,
    orgId,
    items.filter((i) => i.format === 'mcq').map((i) => i.id),
  );
  const rubrics = await loadRubrics(
    rest,
    orgId,
    items.flatMap((i) => (i.rubric_version_id === null ? [] : [i.rubric_version_id])),
  );
  return { sections, items, keys, rubrics };
};

/** Items of one section in order. */
export const itemsOf = (content: Content, sectionId: string): ItemRow[] =>
  content.items
    .filter((i) => i.section_id === sectionId)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

/**
 * Whether an item has its answer key (mcq) or a stored rubric (written). A draft can lack one after a failed write
 * (spec §6.2 "half-written draft is harmless"; spec review r3a #3): the editor view leaves such an item out and the next
 * save replaces the children; publish validates. A published or retired version is never incomplete, so there the
 * view stays fail-closed (503 unavailable).
 */
export const isComplete = (content: Content, item: ItemRow): boolean =>
  item.format === 'mcq'
    ? content.keys.has(item.id)
    : content.rubrics.has(item.rubric_version_id ?? '');

const RulesetRowSchema = z.object({
  id: uuid,
  settings: z.record(z.string(), z.unknown()).nullable(),
  preset_key: z.enum(['strict', 'standard', 'open_book']).nullable(),
  catalog_version: z.string().nullable(),
  published_at: time.nullable(),
});
export type RulesetRow = z.infer<typeof RulesetRowSchema>;

/** The version's pinned ruleset (settings, preset, catalog), or null when the caller cannot see it. */
export const findRuleset = async (
  rest: Rest,
  orgId: string,
  rulesetId: string | null,
): Promise<RulesetRow | null> => {
  if (rulesetId === null) return null;
  const rows = await rest.select('ruleset_versions', {
    select: 'id,settings,preset_key,catalog_version,published_at',
    org_id: `eq.${orgId}`,
    id: `eq.${rulesetId}`,
  });
  return parseRows(RulesetRowSchema, rows)[0] ?? null;
};
