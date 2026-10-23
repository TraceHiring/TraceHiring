// Package v2 session_items rows from the mirror message (spec m1 R5-42, R5-59 a). Red-first stub.
import type { SessionMirrorMessageV2 } from '@trace/shared/contracts/candidate';

export interface SessionItemInsert {
  item_version_id: string;
  section_id: string;
  position: number;
  served_at: string | null;
  item_variant_id: string | null;
  option_order: string[] | null;
  draw_seed_sha256: string | null;
}

export const sessionItemsV2 = (_message: SessionMirrorMessageV2): SessionItemInsert[] => {
  throw new Error('not_implemented');
};
