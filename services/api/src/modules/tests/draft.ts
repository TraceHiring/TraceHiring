// The editor read-model and the draft save path (spec m1 R5-53 a: TestDraftView answers GET …/tests/:testId, the POST
// 201s and both PUTs; §6.11 PUT …/draft → `public.save_test_draft`, M1-18). The save payload is the DB shape of
// save_test_draft (M1-c header): every content hash is the R5-49 a canonical hash (`@trace/shared/item-hash`, key
// excluded), an unchanged rubric reuses its version (R5-51 f, DB L6), timed sections set the total time (M1-11), and a
// written v2 section's paste rule is the settings' paste_written (DB-M1-1). D1's UpdateTestDraftRequest maps to inline
// sections with navigation null, so a D1 draft stays package v1 (R2-1, R3-1).
import { canonicalJson } from '@trace/shared/canonical-json';
import type { UpdateTestDraftRequest } from '@trace/shared/contracts/d1';
import type { SaveTestDraftRequest, TestDraftView } from '@trace/shared/contracts/m1';
import { itemContentSha256 } from '@trace/shared/item-hash';
import { z } from 'zod';
import { sha256Hex } from '../candidate/encoding.js';
import {
  isComplete,
  itemsOf,
  type Content,
  type ItemRow,
  type StoredCriterion,
  type TestRow,
  type VersionRow,
} from './authoring.js';
import { orgFail } from './org-context.js';

const BlueprintView = z.strictObject({
  strata: z
    .array(
      z.strictObject({
        skillKey: z.string(),
        difficultyBand: z.int(),
        count: z.int(),
      }),
    )
    .min(1)
    .max(20),
});

const itemView = (content: Content, i: ItemRow) =>
  i.format === 'mcq'
    ? {
        id: i.id,
        position: i.position ?? orgFail('unavailable'),
        format: 'mcq' as const,
        prompt: i.stem,
        options: (i.options ?? []).map((o) => ({ id: o.id, text: o.text })),
        correctOptionId: content.keys.get(i.id) ?? orgFail('unavailable'),
      }
    : {
        id: i.id,
        position: i.position ?? orgFail('unavailable'),
        format: 'written' as const,
        prompt: i.stem,
        rubric: {
          criteria: (content.rubrics.get(i.rubric_version_id ?? '') ?? orgFail('unavailable')).map(
            (c) => ({
              id: c.id,
              label: c.label,
              maxPoints: c.max_points,
              anchors: c.anchors,
              minHits: c.min_hits,
            }),
          ),
        },
      };

/**
 * The org-side editor view (it carries the inline answer keys; never sent to the candidate path). A draft leaves out
 * its incomplete items (isComplete); a published or retired version is fail-closed. The caller parses the result with
 * TestDraftView (`answer`), so a stored row the contract refuses is 503, never echoed.
 */
export const toDraftView = (
  test: TestRow,
  version: VersionRow,
  content: Content,
): TestDraftView => {
  const draft = version.status === 'draft';
  const visible: Content = draft
    ? { ...content, items: content.items.filter((i) => isComplete(content, i)) }
    : content;
  return {
    test: {
      id: test.id,
      workspaceId: test.workspace_id,
      name: test.name,
      createdAt: test.created_at,
    },
    version: {
      id: version.id,
      versionNo: version.version_no,
      status: version.status,
      durationMinutes: Math.min(120, Math.max(1, Math.floor(version.total_time_seconds / 60))),
      qualityCutoff: version.quality_cutoff ?? orgFail('unavailable'),
      publishedAt: version.published_at,
      sections: [...visible.sections]
        .sort((a, b) => a.position - b.position)
        .map((s) => {
          let blueprint: z.infer<typeof BlueprintView> | undefined;
          if (s.blueprint !== null) {
            const parsed = BlueprintView.safeParse(s.blueprint);
            blueprint = parsed.success ? parsed.data : orgFail('unavailable');
          }
          return {
            id: s.id,
            position: s.position,
            mode: s.pool_id === null ? ('inline' as const) : ('pool' as const),
            format: s.format,
            name: s.name,
            weight: Math.round(s.weight),
            items: itemsOf(visible, s.id).map((i) => itemView(visible, i)),
            ...(s.pool_id === null ? {} : { poolId: s.pool_id }),
            ...(s.draw_count === null ? {} : { drawCount: s.draw_count }),
            shuffleItems: s.shuffle_items,
            shuffleOptions: s.shuffle_options,
            navigation: s.navigation,
            ...(s.paste_rule === null ? {} : { pasteRule: s.paste_rule }),
            ...(s.time_limit_seconds === null ? {} : { timeLimitSeconds: s.time_limit_seconds }),
            ...(blueprint === undefined ? {} : { blueprint }),
          };
        }),
    },
  };
};

/** D1's request as an M1 save: inline sections, navigation null, unshuffled, no paste rule (package v1, R2-1). */
export const fromD1Request = (req: UpdateTestDraftRequest): SaveTestDraftRequest => ({
  name: req.name,
  durationMinutes: req.durationMinutes,
  qualityCutoff: req.qualityCutoff,
  sections: req.sections.map((s) => ({
    mode: 'inline' as const,
    format: s.format,
    name: s.name,
    weight: s.weight,
    items: s.items,
    shuffleItems: false,
    shuffleOptions: false,
    navigation: null,
  })),
});

/** The stored criteria shape (rubric_versions.criteria), and its content hash as D1 writes it. */
const storedCriteria = (
  criteria: readonly {
    id: string;
    label: string;
    maxPoints: number;
    anchors: string[];
    minHits: number;
  }[],
): StoredCriterion[] =>
  criteria.map((c) => ({
    id: c.id,
    label: c.label,
    max_points: c.maxPoints,
    anchors: c.anchors,
    min_hits: c.minHits,
  }));
const criteriaHash = (criteria: readonly StoredCriterion[]) => sha256Hex(canonicalJson(criteria));

/**
 * The navigation a section gets when its draft has settings and it names none (lead decision R5-63 b): multiple
 * choice is free, written is forward only (as the templates and the v2 editor default them).
 */
export const defaultNavigation = (format: 'mcq' | 'written'): 'free' | 'forward_only' =>
  format === 'mcq' ? 'free' : 'forward_only';

export interface SaveOptions {
  /** The ruleset's stored settings, or null (a D1 draft). Written v2 sections take its paste_written. */
  settings: Readonly<Record<string, unknown>> | null;
  /** Rubric versions the draft references now (id → criteria): an identical rubric is reused, not minted again. */
  rubrics: ReadonlyMap<string, readonly StoredCriterion[]>;
  /** Settings to store with the draft (the clone path), or absent to keep the ruleset's. */
  write?: { presetKey: string | null; settings: Readonly<Record<string, unknown>> };
}

/**
 * The `p_payload` of public.save_test_draft. A written section with a navigation (a v2 section) takes the paste rule of
 * the settings when there are settings; a different paste rule in the request is 400 (the database refuses it at
 * publish anyway, DB-M1-1). When every section is timed, the total time is the sum of the section times (M1-11).
 */
export const buildSavePayload = async (
  req: SaveTestDraftRequest,
  opts: SaveOptions,
): Promise<Record<string, unknown>> => {
  const settings = opts.write?.settings ?? opts.settings;
  const pasteWritten =
    settings !== null && typeof settings.paste_written === 'string' ? settings.paste_written : null;
  const known = await Promise.all(
    [...opts.rubrics].map(async ([id, criteria]) => ({ id, hash: await criteriaHash(criteria) })),
  );
  const timed =
    req.sections.length > 0 && req.sections.every((s) => s.timeLimitSeconds !== undefined);
  const totalTimeSeconds = timed
    ? req.sections.reduce((n, s) => n + (s.timeLimitSeconds ?? 0), 0)
    : req.durationMinutes * 60;
  if (totalTimeSeconds < 60 || totalTimeSeconds > 7200) return orgFail('bad_request');
  const sections = await Promise.all(
    req.sections.map(async (s) => {
      // R5-63 b: a draft with settings is package v2, where the publish guard refuses a null navigation; such a
      // section takes the default, so the draft is never unpublishable for that reason.
      const navigation = s.navigation ?? (settings === null ? null : defaultNavigation(s.format));
      let pasteRule = s.pasteRule;
      if (s.format === 'written' && navigation !== null && pasteWritten !== null) {
        if (pasteRule !== undefined && pasteRule !== pasteWritten) return orgFail('bad_request');
        pasteRule = pasteWritten as 'blocked' | 'allowed_logged';
      }
      const items = await Promise.all(
        s.items.map(async (item) => {
          if (item.format === 'mcq') {
            const options = item.options.map((o) => ({ id: o.id, text: o.text }));
            return {
              format: 'mcq',
              stem: item.prompt,
              options,
              correctOptionId: item.correctOptionId,
              contentSha256: await itemContentSha256({
                format: 'mcq',
                stem: item.prompt,
                options,
                media: null,
                paramSpec: null,
              }),
            };
          }
          const criteria = storedCriteria(item.rubric.criteria);
          const hash = await criteriaHash(criteria);
          const reuse = known.find((k) => k.hash === hash);
          return {
            format: 'written',
            stem: item.prompt,
            contentSha256: await itemContentSha256({
              format: 'written',
              stem: item.prompt,
              options: null,
              media: null,
              paramSpec: null,
            }),
            ...(reuse === undefined
              ? { rubric: { criteria, contentSha256: hash } }
              : { rubricVersionId: reuse.id }),
          };
        }),
      );
      return {
        name: s.name,
        format: s.format,
        weight: s.weight,
        ...(s.timeLimitSeconds === undefined ? {} : { timeLimitSeconds: s.timeLimitSeconds }),
        ...(s.poolId === undefined ? {} : { poolId: s.poolId }),
        ...(s.drawCount === undefined ? {} : { drawCount: s.drawCount }),
        shuffleItems: s.shuffleItems,
        shuffleOptions: s.shuffleOptions,
        navigation,
        ...(pasteRule === undefined ? {} : { pasteRule }),
        ...(s.blueprint === undefined ? {} : { blueprint: s.blueprint }),
        items,
      };
    }),
  );
  return {
    name: req.name,
    totalTimeSeconds,
    qualityCutoff: req.qualityCutoff,
    ...(opts.write === undefined
      ? {}
      : { presetKey: opts.write.presetKey, settings: opts.write.settings }),
    sections,
  };
};
