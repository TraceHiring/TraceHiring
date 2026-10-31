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
