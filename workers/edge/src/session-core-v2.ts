// Package v2 in the SessionDO (specs/m1-test-authoring.md §4.6, §5, §6.5; R5-9, R5-19, R5-20, R5-45): how the
// object stores a package of up to 5 MB, lays out the candidate positions, runs the section clock and keeps each
// section's draw. Pure helpers over the object's synchronous KV; SessionCore calls them inside its transactions.
//
// Storage. A SQLite-backed object's KV entry is at most 2 MB of key + value (Cloudflare Durable Objects limits), and a
// v2 package may be 5 MB, so the package is never one value: a header (everything but the items, ~KB), one entry per
// eligible item without its variants, and the variants in parts of at most VALUE_BUDGET_UNITS UTF-16 units of JSON
// each (≤ 512 KB even if every unit takes two bytes). A single variant is ≤ 4,000 + 6 × 500 characters, so a part
// always fits. Nothing else in the object grows with the package.
//
// Positions (R5-59 a: two positions). The candidate's position is session-wide: it follows the sections in `position`
// order, a section takes `draw.count` slots (pool) or one per item (inline), so a never-entered section still has its
// positions (its slots score 0, R5-19). The k-th slot of a section (k from 0) is the k-th item of its stored draw, at
// position `first + k`. This session-wide position is the one in the view, `served[].position` of the mirror,
// `final.json` and `events.ndjson`. The draw position of a pool item is 1 + k, its index in the section's
// `draws[].itemVersionIds` (`session_items.position`, R5-42); the edge never sends it, the jobs derive it.
//
// Sections (§4.6). Untimed versions (no section timer): every section opens at test start and closes at its
// `section.finish`, the test deadline or submit. Timed versions run in position order: section 1 opens at test start,
// each next one when the previous closes; a section closes at the first of its deadline (opened + time limit, never
// after the test deadline), its `section.finish`, the test deadline or submit; a closed section never reopens. Every
// state is computed from the DO's own clock and the stored finish times; the client's clock never decides. A section
// is drawn when it opens and the draw is stored before its first serve; one never opened is never drawn.
import { drawSection, type DrawnItem } from '@trace/item-delivery';
import type { TestPackageV2 } from '@trace/shared/contracts/candidate';

/** The R2 object of a package v2 is at most 5 MB (§5; E22 refuses larger ones at publish). */
export const PACKAGE_V2_MAX_BYTES = 5 * 1024 * 1024;
/** UTF-16 units of JSON per stored variant part (≤ 512 KB at two bytes per unit). */
export const VALUE_BUDGET_UNITS = 256 * 1024;
/** Every stored draw's key starts with this. */
export const DRAW_PREFIX = 'draw:';

export type PackageV2 = TestPackageV2;
export type PackageV2Section = TestPackageV2['sections'][number];
export type PackageV2Item = TestPackageV2['items'][number];

/** The minimal synchronous KV these helpers use (the object's `ctx.storage.kv`). */
export interface V2Kv {
  get<T = unknown>(key: string): T | undefined;
  put<T>(key: string, value: T): void;
}

export interface V2SectionMeta {
  section: PackageV2Section;
  /** 0-based index in position order (the storage key's section number). */
  index: number;
  /** The first candidate position of the section. */
  first: number;
  /** Positions the section takes: `draw.count`, or every item of an inline section. */
  slots: number;
  /** Eligible items stored for the section. */
  itemCount: number;
}

/** The package without its items, plus the position layout. */
export interface V2Header {
  testVersionId: string;
  rulesetVersionId: string;
  title: string;
  durationSeconds: number;
  signalCatalogVersion: string;
  /** The signal kinds the package captures (R2-12, R5-59 c): the DO acks but never stores any other kind. */
  captureSignals: PackageV2['captureSignals'];
  timed: boolean;
  sections: V2SectionMeta[];
  /** Positions in the session (≤ 100, TestPackageV2's refine). */
  total: number;
}

/** One stored item: the package item without its variants, and how many variant parts follow it. */
type StoredItem = Omit<PackageV2Item, 'variants'> & { vparts: number };

/** The stored draw of one section (R5-19): served order, chosen variants and option orders. */
export interface StoredDraw {
  sectionId: string;
  index: number;
  items: DrawnItem[];
  /** For each drawn item, its index among the section's stored items. */
  itemIndex: number[];
  /**
   * sha256 hex of the draw seed, mirrored as `drawSeedSha256` (only the hash is mirrored). The seed is not a secret
   * (R5-59 f): it is deterministic and derivable from the session and section ids (`drawSeed`, R5-52 b), so a draw
   * can be replayed for audit. Predicting a draw also needs the pool, so secrecy relies on the pool not leaking; a
   * random per-session salt is a deferred hardening (§13, owner M8).
   */
  seedSha256: string;
}

/** Each section's draw seed (drawSeed bytes, hex) and the sha256 of it, computed once at session creation. */
export type StoredSeeds = Record<string, { seed: string; sha256: string }>;

const pad = (n: number, width: number) => String(n).padStart(width, '0');

export const K2 = {
  header: 'p2:header',
  item: (s: number, i: number) => `p2:item:${pad(s, 2)}:${pad(i, 5)}`,
  variants: (s: number, i: number, part: number) =>
    `p2:var:${pad(s, 2)}:${pad(i, 5)}:${pad(part, 4)}`,
  seeds: 'seeds',
  draw: (s: number) => `${DRAW_PREFIX}${pad(s, 2)}`,
} as const;

const units = (value: unknown): number => JSON.stringify(value).length;

/** Splits variants into parts of at most VALUE_BUDGET_UNITS units of JSON each (at least one variant per part). */
const variantParts = (
  variants: NonNullable<PackageV2Item['variants']>,
): NonNullable<PackageV2Item['variants']>[] => {
  const parts: NonNullable<PackageV2Item['variants']>[] = [];
  let current: NonNullable<PackageV2Item['variants']> = [];
  let size = 2;
  for (const variant of variants) {
    const add = units(variant) + 1;
    if (current.length > 0 && size + add > VALUE_BUDGET_UNITS) {
      parts.push(current);
      current = [];
      size = 2;
    }
    current.push(variant);
    size += add;
  }
  if (current.length > 0) parts.push(current);
  return parts;
};

/** The header of a parsed package (sections in position order, positions laid out). */
export const headerOf = (pkg: PackageV2): V2Header => {
  const ordered = [...pkg.sections].sort((a, b) => a.position - b.position);
  let next = 1;
  const sections = ordered.map((section, index): V2SectionMeta => {
    const itemCount = pkg.items.filter((i) => i.sectionId === section.id).length;
    const slots = section.draw === null ? itemCount : section.draw.count;
    const meta = { section, index, first: next, slots, itemCount };
    next += slots;
    return meta;
  });
  return {
    testVersionId: pkg.testVersionId,
    rulesetVersionId: pkg.rulesetVersionId,
    title: pkg.title,
    durationSeconds: pkg.durationSeconds,
    signalCatalogVersion: pkg.signalCatalogVersion,
    captureSignals: [...pkg.captureSignals],
    timed: ordered.some((s) => s.timeLimitSeconds !== undefined),
    sections,
    total: next - 1,
  };
};

/** Stores a parsed package v2 (inside the caller's transaction). */
export const storePackageV2 = (kv: V2Kv, pkg: PackageV2, header: V2Header): void => {
  kv.put(K2.header, header);
  for (const meta of header.sections) {
    const own = pkg.items.filter((i) => i.sectionId === meta.section.id);
    own.forEach((item, i) => {
      const { variants, ...base } = item;
      const parts = variants === undefined ? [] : variantParts(variants);
      kv.put<StoredItem>(K2.item(meta.index, i), { ...base, vparts: parts.length });
      parts.forEach((part, p) => kv.put(K2.variants(meta.index, i, p), part));
    });
  }
};

export const readHeader = (kv: V2Kv): V2Header => {
  const header = kv.get<V2Header>(K2.header);
  if (header === undefined) throw new Error('session_package_missing');
  return header;
};

/** The media list of one stored item, without reading its variant parts. */
export const readItemMedia = (kv: V2Kv, s: number, i: number): PackageV2Item['media'] =>
  kv.get<StoredItem>(K2.item(s, i))?.media;

/** One stored item with its variants put back together. */
export const readItem = (kv: V2Kv, s: number, i: number): PackageV2Item => {
  const stored = kv.get<StoredItem>(K2.item(s, i));
  if (stored === undefined) throw new Error('session_package_missing');
  const { vparts, ...base } = stored;
  if (vparts === 0) return base;
  const variants: NonNullable<PackageV2Item['variants']> = [];
  for (let p = 0; p < vparts; p += 1) {
    const part = kv.get<NonNullable<PackageV2Item['variants']>>(K2.variants(s, i, p));
    if (part === undefined) throw new Error('session_package_missing');
    variants.push(...part);
  }
  return { ...base, variants };
};

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));

export const readDraw = (kv: V2Kv, s: number): StoredDraw | undefined =>
  kv.get<StoredDraw>(K2.draw(s));

/**
 * Draws one section with its stored seed (the caller stores the result under K2.draw, once: it checked that no draw
 * exists, and a stored draw is never replaced).
 */
export const computeDraw = (kv: V2Kv, meta: V2SectionMeta): StoredDraw => {
  const seeds = kv.get<StoredSeeds>(K2.seeds);
  const seed = seeds?.[meta.section.id];
  if (seed === undefined) throw new Error('session_seed_missing');
  const items = Array.from({ length: meta.itemCount }, (_, i) => readItem(kv, meta.index, i));
  const draw = drawSection(meta.section, items, hexToBytes(seed.seed));
  return {
    sectionId: meta.section.id,
    index: meta.index,
    items: [...draw.items],
    itemIndex: draw.items.map((d) => items.findIndex((i) => i.itemVersionId === d.itemVersionId)),
    seedSha256: seed.sha256,
  };
};

// ---- section clock -------------------------------------------------------------------------------------------------

export type SectionState = 'not_entered' | 'open' | 'closed';

export interface SectionClock {
  state: SectionState;
  /** When the section opened (DO time), or null if never entered. */
  openedAt: number | null;
  /** A timed section's deadline (never after the test deadline), or null (untimed or not entered). */
  deadlineAt: number | null;
  /** When the section closes or closed (the first of its closing times), or null if not entered. */
  closeAt: number | null;
  /** The section's `section.finish` time, if it was finished while open. */
  finishedAt: number | null;
}

export interface SessionTimes {
  startedAt: number;
  /** The test deadline (started_at + durationSeconds). */
  deadlineAt: number;
  /** submittedAt of a finished session, else null. */
  endAt: number | null;
  /** section id -> the DO time of its `section.finish`. */
  finishes: Record<string, number>;
}

/** Every section's clock at `now` (§4.6), in position order. */
export const sectionClocks = (
  header: V2Header,
  times: SessionTimes,
  now: number,
): SectionClock[] => {
  const end = times.endAt ?? Number.POSITIVE_INFINITY;
  if (!header.timed) {
    return header.sections.map(({ section }) => {
      const finishedAt = times.finishes[section.id] ?? null;
      const closeAt = Math.min(finishedAt ?? Number.POSITIVE_INFINITY, times.deadlineAt, end);
      return {
        state: now < closeAt ? 'open' : 'closed',
        openedAt: times.startedAt,
        deadlineAt: null,
        closeAt,
        finishedAt,
      };
    });
  }
  const out: SectionClock[] = [];
  let opensAt: number | null = times.startedAt;
  for (const { section } of header.sections) {
    if (opensAt === null) {
      out.push({
        state: 'not_entered',
        openedAt: null,
        deadlineAt: null,
        closeAt: null,
        finishedAt: null,
      });
      continue;
    }
    const deadlineAt = Math.min(opensAt + (section.timeLimitSeconds ?? 0) * 1000, times.deadlineAt);
    const finish = times.finishes[section.id];
    const finishedAt = finish !== undefined && finish >= opensAt ? finish : null;
    const closeAt = Math.min(deadlineAt, finishedAt ?? Number.POSITIVE_INFINITY, end);
    const open = now < closeAt;
    out.push({
      state: open ? 'open' : 'closed',
      openedAt: opensAt,
      deadlineAt,
      closeAt,
      finishedAt,
    });
    // The next section opens when this one closes, unless the test itself ended then.
    opensAt = open || closeAt >= times.deadlineAt || closeAt >= end ? null : closeAt;
  }
  return out;
};

/** The section index of a candidate position, or -1. */
export const sectionOfPosition = (header: V2Header, position: number): number =>
  header.sections.findIndex((m) => position >= m.first && position < m.first + m.slots);

/** What one drawn slot shows: the chosen variant's prompt and options, options in served order. */
export interface SlotContent {
  item: PackageV2Item;
  drawn: DrawnItem;
  prompt: string;
  /** The options in served order (mcq only). */
  options: { id: string; label: string }[] | undefined;
}

export const slotContent = (item: PackageV2Item, drawn: DrawnItem): SlotContent => {
  const variant = drawn.variantIndex === null ? undefined : item.variants?.[drawn.variantIndex];
  const source = variant?.options ?? item.options;
  const options =
    source === undefined || drawn.optionOrder === null
      ? undefined
      : drawn.optionOrder.map((id) => {
          const option = source.find((o) => o.id === id);
          if (option === undefined) throw new Error('session_draw_invalid');
          return option;
        });
  return { item, drawn, prompt: variant?.prompt ?? item.prompt, options };
};
