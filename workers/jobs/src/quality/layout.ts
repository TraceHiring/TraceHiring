// The served layout check of a package v2 message (spec m1 R5-59 a, R5-61 f, R5-62 b). Pure: no I/O. One
// implementation for both stages: the mirror runs it before anything is written (M1-i layout reads), the quality
// stage again before anything is scored (defence in depth); each stage throws its own constant codes. It lives under
// quality/ because quality files may import only quality files (rule 1 boundary); the neutral mirror imports it.
// Rule 1: nothing here knows of integrity data, scores or keys.

/** A section of the pinned version, in `position` order; drawCount is sections.draw_count (null: inline). */
export interface LayoutSection {
  id: string;
  drawCount: number | null;
}

/** An item placed inline in a section of the pinned version (item_versions.section_id). */
export interface LayoutItem {
  itemVersionId: string;
  sectionId: string;
}

/** What the layout check reads of a v2 mirror message (served rows, draws and the pool section ids it names). */
export interface LayoutMessage {
  poolSectionIds: readonly string[];
  draws: readonly { sectionId: string; itemVersionIds: readonly string[] }[];
  served: readonly { position: number; itemVersionId: string; sectionId: string }[];
}

/** The constant codes a stage throws for a refused layout. */
export interface LayoutCodes {
  badDraws: string;
  badServedPosition: string;
}

export const MIRROR_LAYOUT_CODES = {
  badDraws: 'mirror_bad_draws',
  badServedPosition: 'mirror_bad_served_position',
} as const satisfies LayoutCodes;

export const QUALITY_LAYOUT_CODES = {
  badDraws: 'quality_bad_draws',
  badServedPosition: 'quality_bad_served_position',
} as const satisfies LayoutCodes;

const fail = (code: string): never => {
  throw new Error(code);
};

/**
 * The served positions and pool sections of a v2 message, checked against the pinned version (R5-59 a; A3a fix-1
 * security review). Answers map to items only through `served[]` (position -> item), so a served row at another
 * item's slot would score one answer against another item's key:
 *   - `poolSectionIds` must be exactly the version's sections with a draw_count, and every draw must belong to one of
 *     them, once, with at most draw_count items; else `codes.badDraws`;
 *   - the candidate's slots follow the sections in `position` order (`sections` arrives in that order): a pool section
 *     takes draw_count slots, its k-th drawn item (k from 0, the index in its `draws[].itemVersionIds`) at the
 *     section's first slot + k; an inline section takes one slot per item. A served pool row must sit exactly at its
 *     slot; a served inline row must be an item of its section and sit inside the section's slot range (the inline
 *     order inside a section may be shuffled by the edge, so its exact slot is not derivable from the database);
 *     a row naming a section outside the version is out of place too; else `codes.badServedPosition`.
 */
export const checkServedLayout = (
  sections: readonly LayoutSection[],
  inline: readonly LayoutItem[],
  message: LayoutMessage,
  codes: LayoutCodes,
): void => {
  const pool = new Set(sections.filter((s) => s.drawCount !== null).map((s) => s.id));
  const named = new Set(message.poolSectionIds);
  if (named.size !== message.poolSectionIds.length || named.size !== pool.size) {
    return fail(codes.badDraws);
  }
  for (const id of named) if (!pool.has(id)) return fail(codes.badDraws);

  const drawCount = new Map(sections.map((s) => [s.id, s.drawCount]));
  const drawOf = new Map<string, readonly string[]>();
  for (const draw of message.draws) {
    const count = drawCount.get(draw.sectionId);
    if (count === undefined || count === null || drawOf.has(draw.sectionId)) {
      return fail(codes.badDraws);
    }
    if (draw.itemVersionIds.length > count) return fail(codes.badDraws);
    drawOf.set(draw.sectionId, draw.itemVersionIds);
  }

  const inlineOf = new Map<string, Set<string>>();
  for (const item of inline) {
    const set = inlineOf.get(item.sectionId) ?? new Set<string>();
    set.add(item.itemVersionId);
    inlineOf.set(item.sectionId, set);
  }
  const range = new Map<string, { first: number; slots: number }>();
  let next = 1;
  for (const section of sections) {
    const slots = section.drawCount ?? inlineOf.get(section.id)?.size ?? 0;
    range.set(section.id, { first: next, slots });
    next += slots;
  }

  for (const row of message.served) {
    const r = range.get(row.sectionId);
    if (r === undefined) return fail(codes.badServedPosition);
    if (pool.has(row.sectionId)) {
      const k = drawOf.get(row.sectionId)?.indexOf(row.itemVersionId) ?? -1;
      if (k < 0) return fail(codes.badDraws);
      if (row.position !== r.first + k) return fail(codes.badServedPosition);
    } else {
      if (inlineOf.get(row.sectionId)?.has(row.itemVersionId) !== true) {
        return fail(codes.badServedPosition);
      }
      if (row.position < r.first || row.position >= r.first + r.slots) {
        return fail(codes.badServedPosition);
      }
    }
  }
};
