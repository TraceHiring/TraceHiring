// Authoring rows as the caller (spec §3.2 migration 1, §6.2 tests rows; path 1: PostgREST with the caller's JWT, so
// RLS, the freeze triggers and the audit actor apply). Every read is also filtered by the path org (a multi-org
// caller sees rows of each of their orgs through RLS). Rows are parsed before use; a row that does not parse is a
// 503 `unavailable` (never echoed). Answer keys and rubrics are org-side data: they never reach the test package.
import { canonicalJson } from '@trace/shared/canonical-json';
import { z } from 'zod';
import type { TestDetailResponse, UpdateTestDraftRequest } from '@trace/shared/contracts/d1';
import { sha256Hex } from '../candidate/encoding.js';
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

const SectionRowSchema = z.object({
  id: uuid,
  test_version_id: uuid,
  position: z.number().int().min(1),
  name: z.string(),
  format: z.enum(['mcq', 'written']),
  weight: z.coerce.number(),
});
export type SectionRow = z.infer<typeof SectionRowSchema>;

const ItemRowSchema = z.object({
  id: uuid,
  test_version_id: uuid,
  section_id: uuid,
  format: z.enum(['mcq', 'written']),
  position: z.number().int().min(1),
  stem: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() })).nullable(),
  rubric_version_id: uuid.nullable(),
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
const SECTION_COLS = 'id,test_version_id,position,name,format,weight';
const ITEM_COLS = 'id,test_version_id,section_id,format,position,stem,options,rubric_version_id';

export const parseRows = <S extends z.ZodType>(schema: S, rows: unknown[]): z.infer<S>[] =>
  rows.map((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? (parsed.data as z.infer<S>) : orgFail('unavailable');
  });

const inList = (ids: readonly string[]) => `in.(${ids.join(',')})`;

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

/** The test's newest version (D1 has one per test; M1 adds more). */
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
  items: ItemRow[];
  /** item_version_id -> option id */
  keys: Map<string, string>;
  /** rubric_version_id -> criteria */
  rubrics: Map<string, StoredCriterion[]>;
}

export const loadContent = async (
  rest: Rest,
  orgId: string,
  versionId: string,
): Promise<Content> => {
  const sections = parseRows(
    SectionRowSchema,
    await rest.select('sections', {
      select: SECTION_COLS,
      org_id: `eq.${orgId}`,
      test_version_id: `eq.${versionId}`,
      order: 'position.asc',
    }),
  );
  const items = parseRows(
    ItemRowSchema,
    await rest.select('item_versions', {
      select: ITEM_COLS,
      org_id: `eq.${orgId}`,
      test_version_id: `eq.${versionId}`,
      order: 'position.asc',
    }),
  );
  const keys = new Map<string, string>();
  const mcqIds = items.filter((i) => i.format === 'mcq').map((i) => i.id);
  if (mcqIds.length > 0) {
    const rows = parseRows(
      KeyRowSchema,
      await rest.select('item_answer_keys', {
        select: 'item_version_id,key',
        org_id: `eq.${orgId}`,
        item_version_id: inList(mcqIds),
      }),
    );
    for (const r of rows) keys.set(r.item_version_id, r.key.option_id);
  }
  const rubrics = new Map<string, StoredCriterion[]>();
  const rubricIds = [
    ...new Set(items.flatMap((i) => (i.rubric_version_id === null ? [] : [i.rubric_version_id]))),
  ];
  if (rubricIds.length > 0) {
    const rows = parseRows(
      RubricRowSchema,
      await rest.select('rubric_versions', {
        select: 'id,criteria',
        org_id: `eq.${orgId}`,
        id: inList(rubricIds),
      }),
    );
    for (const r of rows) rubrics.set(r.id, r.criteria);
  }
  return { sections, items, keys, rubrics };
};

/** Items of one section in order. */
export const itemsOf = (content: Content, sectionId: string): ItemRow[] =>
  content.items.filter((i) => i.section_id === sectionId).sort((a, b) => a.position - b.position);

/**
 * Whether an item has its answer key (mcq) or a stored rubric (written). A draft can lack one after a PUT failed
 * between the item insert and the key or rubric insert (spec §6.2 "half-written draft is harmless"; spec review
 * r3a #3): the editor view leaves such an item out and the next PUT replaces the children; publish validates.
 * A published or retired version is never incomplete, so there toDetail stays fail-closed (503 unavailable).
 */
const isComplete = (content: Content, item: ItemRow): boolean =>
  item.format === 'mcq'
    ? content.keys.has(item.id)
    : content.rubrics.has(item.rubric_version_id ?? '');

/** The org-side editor view (it carries the answer key; never sent to the candidate path). */
export const toDetail = (
  test: TestRow,
  version: VersionRow,
  content: Content,
): TestDetailResponse =>
  version.status === 'draft'
    ? toDetailOf(test, version, draftView(content))
    : toDetailOf(test, version, content);

/** The draft's content without its incomplete items. */
const draftView = (content: Content): Content => ({
  ...content,
  items: content.items.filter((i) => isComplete(content, i)),
});

const toDetailOf = (test: TestRow, version: VersionRow, content: Content): TestDetailResponse => ({
  test: { id: test.id, name: test.name, createdAt: test.created_at },
  version: {
    id: version.id,
    versionNo: version.version_no,
    status: version.status,
    durationMinutes: Math.max(1, Math.floor(version.total_time_seconds / 60)),
    qualityCutoff: version.quality_cutoff ?? orgFail('unavailable'),
    publishedAt: version.published_at,
    sections: content.sections.map((s) => ({
      id: s.id,
      position: s.position,
      name: s.name,
      format: s.format,
      weight: Math.round(s.weight),
      items: itemsOf(content, s.id).map((i) =>
        i.format === 'mcq'
          ? {
              id: i.id,
              position: i.position,
              format: 'mcq' as const,
              prompt: i.stem,
              options: (i.options ?? []).map((o) => ({ id: o.id, text: o.text })),
              correctOptionId: content.keys.get(i.id) ?? orgFail('unavailable'),
            }
          : {
              id: i.id,
              position: i.position,
              format: 'written' as const,
              prompt: i.stem,
              rubric: {
                criteria: (
                  content.rubrics.get(i.rubric_version_id ?? '') ?? orgFail('unavailable')
                ).map((c) => ({
                  id: c.id,
                  label: c.label,
                  maxPoints: c.max_points,
                  anchors: c.anchors,
                  minHits: c.min_hits,
                })),
              },
            },
      ),
    })),
  },
});

const hashOf = (value: unknown) => sha256Hex(canonicalJson(value));

/**
 * Replaces the draft's children by ordered PostgREST writes as the caller (spec §6.2 PUT): the test name, the
 * version's duration and cutoff, then delete answer keys, items and sections of this draft, then insert sections,
 * rubric versions, items and answer keys. Draft-only by the guard triggers; publish validates, so a half-written
 * draft left by a failed write is harmless. Returns nothing; the caller reads the result back.
 */
export const replaceDraft = async (
  rest: Rest,
  orgId: string,
  test: TestRow,
  draft: VersionRow,
  req: UpdateTestDraftRequest,
  newKey: () => string = () => crypto.randomUUID(),
): Promise<void> => {
  const draftOnly = { id: `eq.${draft.id}`, org_id: `eq.${orgId}`, status: 'eq.draft' };
  const patched = await rest.update(
    'test_versions',
    { ...draftOnly, select: 'id' },
    {
      total_time_seconds: req.durationMinutes * 60,
      quality_cutoff: req.qualityCutoff,
    },
  );
  if (patched.length !== 1) orgFail('conflict');
  await rest.update(
    'tests',
    { id: `eq.${test.id}`, org_id: `eq.${orgId}`, select: 'id' },
    { name: req.name },
  );

  const old = await loadContent(rest, orgId, draft.id);
  const mcqIds = old.items.filter((i) => i.format === 'mcq').map((i) => i.id);
  if (mcqIds.length > 0) {
    await rest.remove('item_answer_keys', {
      org_id: `eq.${orgId}`,
      item_version_id: inList(mcqIds),
      select: 'item_version_id',
    });
  }
  if (old.items.length > 0) {
    await rest.remove('item_versions', {
      org_id: `eq.${orgId}`,
      test_version_id: `eq.${draft.id}`,
      select: 'id',
    });
  }
  if (old.sections.length > 0) {
    await rest.remove('sections', {
      org_id: `eq.${orgId}`,
      test_version_id: `eq.${draft.id}`,
      select: 'id',
    });
  }
  if (req.sections.length === 0) return;

  const sections = parseRows(
    SectionRowSchema,
    await rest.insert(
      'sections',
      req.sections.map((s, i) => ({
        org_id: orgId,
        test_version_id: draft.id,
        position: i + 1,
        name: s.name,
        format: s.format,
        weight: s.weight,
      })),
      { select: SECTION_COLS },
    ),
  );
  const sectionAt = (position: number) =>
    sections.find((s) => s.position === position) ?? orgFail('unavailable');

  // One rubric version per written item (a referenced rubric is frozen, so each draft write makes new ones).
  const rubricRows: { key: string; criteria: StoredCriterion[]; s: number; i: number }[] = [];
  req.sections.forEach((s, si) => {
    s.items.forEach((item, ii) => {
      if (item.format === 'written') {
        rubricRows.push({
          key: newKey(),
          s: si,
          i: ii,
          criteria: item.rubric.criteria.map((c) => ({
            id: c.id,
            label: c.label,
            max_points: c.maxPoints,
            anchors: c.anchors,
            min_hits: c.minHits,
          })),
        });
      }
    });
  });
  const rubricIdOf = new Map<string, string>();
  if (rubricRows.length > 0) {
    const body = await Promise.all(
      rubricRows.map(async (r) => ({
        org_id: orgId,
        rubric_key: r.key,
        version_no: 1,
        criteria: r.criteria,
        content_sha256: await hashOf(r.criteria),
      })),
    );
    const inserted = parseRows(
      z.object({ id: uuid, rubric_key: z.string() }),
      await rest.insert('rubric_versions', body, { select: 'id,rubric_key' }),
    );
    for (const r of rubricRows) {
      const row = inserted.find((x) => x.rubric_key === r.key) ?? orgFail('unavailable');
      rubricIdOf.set(`${r.s}:${r.i}`, row.id);
    }
  }

  const itemBody = await Promise.all(
    req.sections.flatMap((s, si) =>
      s.items.map(async (item, ii) => {
        const section = sectionAt(si + 1);
        const options =
          item.format === 'mcq' ? item.options.map((o) => ({ id: o.id, text: o.text })) : null;
        const rubricId = item.format === 'written' ? (rubricIdOf.get(`${si}:${ii}`) ?? null) : null;
        return {
          org_id: orgId,
          test_version_id: draft.id,
          section_id: section.id,
          format: item.format,
          position: ii + 1,
          stem: item.prompt,
          options,
          rubric_version_id: rubricId,
          content_sha256: await hashOf(
            item.format === 'mcq'
              ? { format: 'mcq', stem: item.prompt, options }
              : { format: 'written', stem: item.prompt, rubricVersionId: rubricId },
          ),
        };
      }),
    ),
  );
  if (itemBody.length === 0) return;
  const items = parseRows(
    ItemRowSchema,
    await rest.insert('item_versions', itemBody, { select: ITEM_COLS }),
  );

  const keyBody = req.sections.flatMap((s, si) =>
    s.items.flatMap((item, ii) => {
      if (item.format !== 'mcq') return [];
      const section = sectionAt(si + 1);
      const row =
        items.find((x) => x.section_id === section.id && x.position === ii + 1) ??
        orgFail('unavailable');
      return [
        {
          org_id: orgId,
          item_version_id: row.id,
          format: 'mcq',
          key: { option_id: item.correctOptionId },
        },
      ];
    }),
  );
  if (keyBody.length > 0) {
    await rest.insert('item_answer_keys', keyBody, { select: 'item_version_id' });
  }
};
