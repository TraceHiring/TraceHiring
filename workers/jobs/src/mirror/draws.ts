// The session_items rows of a package v2 session (spec m1 R5-19, R5-41, R5-42, R5-47, R5-59 a). Pure.
//   - Pool sections: one row per drawn item, in draw order, `position` = 1 + its index in the section's
//     `draws[].itemVersionIds` (the draw position, never the candidate's session-wide `served[].position`); a served
//     item's `served_at`, option order and draw seed hash are merged into its row; the variant comes from the draw.
//     A drawn item never served keeps `served_at` null (it counts in Answer Quality as 0 and writes no exposure).
//   - Inline sections keep D1: one row per served item at its served position; an unserved inline item has no row.
// Every row is built before anything is written, so the mirror inserts each session's rows exactly once (R5-41).
// A message that breaks an invariant is malformed: a constant code, never a partial write.
import {
  MirrorInvariantError,
  checkMirrorV2,
  type SessionMirrorMessageV2,
} from '@trace/shared/contracts/candidate';

export interface SessionItemInsert {
  item_version_id: string;
  section_id: string;
  position: number;
  served_at: string | null;
  item_variant_id: string | null;
  option_order: string[] | null;
  draw_seed_sha256: string | null;
}

const fail = (code: string): never => {
  throw new Error(code);
};

/** checkMirrorV2 as a constant code of this stage (`mirror_invariant_<code>`). */
const checkInvariants = (message: SessionMirrorMessageV2): void => {
  try {
    checkMirrorV2(message);
  } catch (err) {
    if (err instanceof MirrorInvariantError) fail(`mirror_invariant_${err.code}`);
    throw err;
  }
};

export const sessionItemsV2 = (message: SessionMirrorMessageV2): SessionItemInsert[] => {
  checkInvariants(message);
  const pool = new Set(message.poolSectionIds);
  const servedByItem = new Map(message.served.map((s) => [s.itemVersionId, s]));
  const rows: SessionItemInsert[] = [];
  const seen = new Set<string>();
  const once = (itemVersionId: string): void => {
    // session_items is unique per (session, item version): an item in two draws, or drawn and served inline, would
    // be stored once by ON CONFLICT DO NOTHING and lose a row. It is malformed instead.
    if (seen.has(itemVersionId)) fail('mirror_bad_draws');
    seen.add(itemVersionId);
  };

  for (const draw of message.draws) {
    draw.itemVersionIds.forEach((itemVersionId, index) => {
      once(itemVersionId);
      const served = servedByItem.get(itemVersionId);
      if (served !== undefined && served.sectionId !== draw.sectionId) fail('mirror_bad_draws');
      rows.push({
        item_version_id: itemVersionId,
        section_id: draw.sectionId,
        position: index + 1,
        served_at: served?.servedAt ?? null,
        item_variant_id: draw.itemVariantIds[index] ?? null,
        option_order: served?.optionOrder ?? null,
        draw_seed_sha256: served?.drawSeedSha256 ?? null,
      });
    });
  }
  for (const served of message.served) {
    if (pool.has(served.sectionId)) continue; // stored above from its draw (checkMirrorV2: it is in the draw)
    once(served.itemVersionId);
    rows.push({
      item_version_id: served.itemVersionId,
      section_id: served.sectionId,
      position: served.position,
      served_at: served.servedAt,
      item_variant_id: served.itemVariantId ?? null,
      option_order: served.optionOrder ?? null,
      draw_seed_sha256: served.drawSeedSha256 ?? null,
    });
  }
  return rows;
};
