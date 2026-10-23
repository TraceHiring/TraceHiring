// The scored item set of a session (spec m1 R5-19, R5-47; D1 §5.4). Pure: no I/O.
//   - An inline section (draw_count null) counts every item of the section, loaded by test_version_id exactly as D1;
//     an unserved or unanswered one scores 0.
//   - A pool section counts draw_count slots, filled in draw order by the candidate's own drawn items (session_items,
//     served or not); a drawn item never answered and every slot never filled (a section never entered) scores 0, so
//     the denominator never shrinks.
// A D1 (package v1) version has inline sections only, so its plan is D1's item list unchanged (ids are the item
// version ids). Rule 1: nothing here knows of integrity data.

export interface PlanSection {
  id: string;
  /** sections.draw_count: null for an inline section. */
  drawCount: number | null;
}

export interface PlanItem {
  itemVersionId: string;
  sectionId: string;
  format: string;
  stem: string;
  rubricVersionId: string | null;
  /** The served variant (session_items.item_variant_id) of a parameterised item; null otherwise. */
  variantId: string | null;
}

/** A session_items row of a pool section, with its item version's content. */
export interface DrawnItem extends PlanItem {
  /** The draw position (1 + index in the section's draw, R5-42, R5-59 a). */
  position: number;
}

/** One scored slot: an item, or an empty slot of a pool section (scores 0). Ids are unique within a plan. */
export interface PlanEntry {
  id: string;
  sectionId: string;
  item: PlanItem | null;
}

const fail = (code: string): never => {
  throw new Error(code);
};

const plain = ({
  itemVersionId,
  sectionId,
  format,
  stem,
  rubricVersionId,
  variantId,
}: PlanItem) => ({
  itemVersionId,
  sectionId,
  format,
  stem,
  rubricVersionId,
  variantId,
});

export const planScoredItems = (
  sections: readonly PlanSection[],
  inline: readonly PlanItem[],
  drawn: readonly DrawnItem[],
): PlanEntry[] => {
  const drawCount = new Map(sections.map((s) => [s.id, s.drawCount]));
  const drawnBySection = new Map<string, DrawnItem[]>();
  for (const row of drawn) {
    if (drawCount.get(row.sectionId) == null) return fail('quality_bad_draw');
    const list = drawnBySection.get(row.sectionId) ?? [];
    list.push(row);
    drawnBySection.set(row.sectionId, list);
  }
  const inlineBySection = new Map<string, PlanItem[]>();
  for (const item of inline) {
    if (!drawCount.has(item.sectionId) || drawCount.get(item.sectionId) !== null) {
      return fail('quality_bad_item');
    }
    const list = inlineBySection.get(item.sectionId) ?? [];
    list.push(item);
    inlineBySection.set(item.sectionId, list);
  }

  const entries: PlanEntry[] = [];
  for (const section of sections) {
    if (section.drawCount === null) {
      for (const item of inlineBySection.get(section.id) ?? []) {
        entries.push({ id: item.itemVersionId, sectionId: section.id, item: plain(item) });
      }
      continue;
    }
    const count = section.drawCount;
    if (!Number.isInteger(count) || count < 1) return fail('quality_bad_draw');
    const rows = [...(drawnBySection.get(section.id) ?? [])].sort(
      (a, b) => a.position - b.position,
    );
    if (rows.length > count) return fail('quality_bad_draw');
    const positions = new Set(rows.map((r) => r.position));
    if (positions.size !== rows.length) return fail('quality_bad_draw');
    if (rows.some((r) => !Number.isInteger(r.position) || r.position < 1 || r.position > count)) {
      return fail('quality_bad_draw');
    }
    for (const row of rows) {
      entries.push({ id: row.itemVersionId, sectionId: section.id, item: plain(row) });
    }
    for (let slot = rows.length + 1; slot <= count; slot += 1) {
      entries.push({ id: `${section.id}:slot:${slot}`, sectionId: section.id, item: null });
    }
  }
  return entries;
};

/** What the layout check reads of a v2 mirror message (served rows, draws and the pool section ids it names). */
export interface LayoutMessage {
  poolSectionIds: readonly string[];
  draws: readonly { sectionId: string; itemVersionIds: readonly string[] }[];
  served: readonly { position: number; itemVersionId: string; sectionId: string }[];
}

/**
 * The served positions and pool sections of a v2 message, checked against the pinned version before anything is
 * scored (R5-59 a; A3a fix-1 security review). The mirror maps every answer to an item through `served[]`
 * (position -> item), so a served row at another item's slot would score one answer against another item's key:
 *   - `poolSectionIds` must be exactly the version's sections with a draw_count, and every draw must belong to one of
 *     them, once, with at most draw_count items; else `quality_bad_draws`;
 *   - the candidate's slots follow the sections in `position` order (`sections` arrives in that order): a pool section
 *     takes draw_count slots, its k-th drawn item (k from 0, the index in its `draws[].itemVersionIds`) at the
 *     section's first slot + k; an inline section takes one slot per item. A served pool row must sit exactly at its
 *     slot; a served inline row must be an item of its section and sit inside the section's slot range (the inline
 *     order inside a section may be shuffled by the edge, so its exact slot is not derivable from the database);
 *     a row naming a section outside the version is out of place too; else `quality_bad_served_position`.
 */
export const checkServedLayout = (
  sections: readonly PlanSection[],
  inline: readonly Pick<PlanItem, 'itemVersionId' | 'sectionId'>[],
  message: LayoutMessage,
): void => {
  const pool = new Set(sections.filter((s) => s.drawCount !== null).map((s) => s.id));
  const named = new Set(message.poolSectionIds);
  if (named.size !== message.poolSectionIds.length || named.size !== pool.size) {
    return fail('quality_bad_draws');
  }
  for (const id of named) if (!pool.has(id)) return fail('quality_bad_draws');

  const drawCount = new Map(sections.map((s) => [s.id, s.drawCount]));
  const drawOf = new Map<string, readonly string[]>();
  for (const draw of message.draws) {
    const count = drawCount.get(draw.sectionId);
    if (count === undefined || count === null || drawOf.has(draw.sectionId)) {
      return fail('quality_bad_draws');
    }
    if (draw.itemVersionIds.length > count) return fail('quality_bad_draws');
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
    if (r === undefined) return fail('quality_bad_served_position');
    if (pool.has(row.sectionId)) {
      const k = drawOf.get(row.sectionId)?.indexOf(row.itemVersionId) ?? -1;
      if (k < 0) return fail('quality_bad_draws');
      if (row.position !== r.first + k) return fail('quality_bad_served_position');
    } else {
      if (inlineOf.get(row.sectionId)?.has(row.itemVersionId) !== true) {
        return fail('quality_bad_served_position');
      }
      if (row.position < r.first || row.position >= r.first + r.slots) {
        return fail('quality_bad_served_position');
      }
    }
  }
};

/**
 * The MCQ key of a scored item: the served variant's key for a parameterised item (item_variant_keys), else the
 * item version's key (item_answer_keys). Never a fallback from one to the other; a missing key fails closed.
 */
export const mcqKeyOf = (
  item: PlanItem,
  answerKeys: ReadonlyMap<string, string>,
  variantKeys: ReadonlyMap<string, string>,
): string => {
  const key =
    item.variantId === null ? answerKeys.get(item.itemVersionId) : variantKeys.get(item.variantId);
  return key === undefined ? fail('quality_bad_key') : key;
};
