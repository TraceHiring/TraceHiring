// The output checks of the AI drafting job (specs/m1-test-authoring.md §6.4, §7 E20, R5-51 d, R5-56 e). Pure functions:
// every drafted item is untrusted until it passes the zod shape, readability (stem 20-1,200 chars, options 1-200, no
// option equal to the stem, Flesch reading ease >= 30 for English), no candidate-facing placeholder (`{{`), no exact
// duplicate (normalised text) of an org version or of an earlier draft of the batch, and no near duplicate (word
// 5-shingle Jaccard >= 0.8) of the skill's approved items, each draft compared with at most 2,000 of them. A written
// draft is always discarded until the founder answers R5-56 e (the job cannot store the rubric it needs, R5-49 b).
// Nothing here logs or throws text of a draft.
import type { DraftFormat, DraftedItem, DraftedMcqItem } from '@trace/vendors';
import { z } from 'zod';

export const DRAFT_LIMITS = Object.freeze({
  stemMin: 20,
  stemMax: 1200,
  optionMin: 1,
  optionMax: 200,
  fleschMin: 30,
  jaccardMax: 0.8,
  shingleSize: 5,
  maxComparisons: 2000,
});

export type DiscardReason =
  | 'bad_shape'
  | 'wrong_format'
  | 'written_needs_rubric'
  | 'stem_length'
  | 'option_length'
  | 'option_equals_stem'
  | 'placeholder'
  | 'readability'
  | 'duplicate_exact'
  | 'duplicate_near';

// A generous text bound so a hostile answer cannot make the checks slow; the real limits are checked below.
const text = () => z.string().max(10_000);

const McqSchema = z
  .strictObject({
    format: z.literal('mcq'),
    stem: text(),
    options: z
      .array(z.strictObject({ id: z.string().min(1).max(64), text: text() }))
      .min(2)
      .max(6),
    correctOptionId: z.string().min(1).max(64),
  })
  .refine((i) => new Set(i.options.map((o) => o.id)).size === i.options.length)
  .refine((i) => i.options.some((o) => o.id === i.correctOptionId));

const WrittenSchema = z.strictObject({ format: z.literal('written'), stem: text() });

/** The drafted item as zod reads it, or null (E20: malformed, or a key outside its options). Never throws. */
export const parseDraftedItem = (raw: unknown): DraftedItem | null => {
  const mcq = McqSchema.safeParse(raw);
  if (mcq.success) return mcq.data;
  const written = WrittenSchema.safeParse(raw);
  return written.success ? written.data : null;
};

/** Lower case, runs of ASCII whitespace as one space, trimmed (the same rule as the store's SQL lookup). */
export const normaliseText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[ \t\n\r\f\v]+/g, ' ')
    .replace(/^ | $/g, '');

const WORD = /[\p{L}\p{N}]/u;
const words = (s: string): string[] => s.split(/\s+/).filter((w) => WORD.test(w));

const syllables = (word: string): number => {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 1; // a number reads as one unit
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, w.match(/[aeiouy]{1,2}/g)?.length ?? 1);
};

/** Flesch reading ease of English text: 206.835 - 1.015 words/sentence - 84.6 syllables/word. */
export const fleschReadingEase = (s: string): number => {
  const ws = words(s);
  if (ws.length === 0) return 0;
  const sentences = Math.max(1, s.match(/[.!?]+(?=\s|$)/g)?.length ?? 0);
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  return 206.835 - 1.015 * (ws.length / sentences) - 84.6 * (syl / ws.length);
};

/** Word 5-shingles of the normalised text; text of fewer than five words is one shingle. */
export const shingles = (s: string): Set<string> => {
  const ws = normaliseText(s)
    .split(' ')
    .filter((w) => w !== '');
  const n = DRAFT_LIMITS.shingleSize;
  if (ws.length < n) return new Set([ws.join(' ')]);
  const out = new Set<string>();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(' '));
  return out;
};

export const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  let both = 0;
  for (const x of a) if (b.has(x)) both += 1;
  return both / (a.size + b.size - both);
};

const PLACEHOLDER = '{{';

/** Readability and placeholder checks of one parsed draft (§6.4); null when it passes. */
export const contentCheck = (item: DraftedItem): DiscardReason | null => {
  const stem = item.stem.trim();
  if (stem.length < DRAFT_LIMITS.stemMin || stem.length > DRAFT_LIMITS.stemMax)
    return 'stem_length';
  if (stem.includes(PLACEHOLDER)) return 'placeholder';
  if (item.format === 'mcq') {
    const normStem = normaliseText(stem);
    for (const o of item.options) {
      const t = o.text.trim();
      if (t.length < DRAFT_LIMITS.optionMin || t.length > DRAFT_LIMITS.optionMax) {
        return 'option_length';
      }
      if (t.includes(PLACEHOLDER)) return 'placeholder';
      if (normaliseText(t) === normStem) return 'option_equals_stem';
    }
  }
  if (fleschReadingEase(stem) < DRAFT_LIMITS.fleschMin) return 'readability';
  return null;
};

export interface ScreenContext {
  /** The job's format (pinned on the job row). */
  format: DraftFormat;
  /** Normalised stems that already exist in the org (exact duplicates). */
  existing: ReadonlySet<string>;
  /** Approved stems of the job's skill, most recent first (near duplicates). */
  approved: readonly string[];
  /** Drafts the job may still store (count minus drafts already stored, R5-50). */
  room: number;
}

export interface ScreenResult {
  /** Drafts to store, in drafter order, with their position in the drafter's answer. */
  accepted: DraftedMcqItem[];
  positions: number[];
  /** Drafts that failed a check (R5-51 d: every failed attempt, the caller caps the stored count). */
  discarded: number;
}

/** A draft that passed the shape and content checks; the duplicate checks need the database. */
export interface Candidate {
  position: number;
  item: DraftedItem;
}

/** Shape and content checks of the drafter's answer, in order; failures are only counted. */
export const preScreen = (
  raw: readonly unknown[],
  format: DraftFormat,
): { candidates: Candidate[]; failed: number } => {
  const candidates: Candidate[] = [];
  let failed = 0;
  raw.forEach((r, position) => {
    const item = parseDraftedItem(r);
    if (item === null || item.format !== format || contentCheck(item) !== null) failed += 1;
    else candidates.push({ position, item });
  });
  return { candidates, failed };
};

const reasonOf = (
  item: DraftedItem,
  format: DraftFormat,
  seen: ReadonlySet<string>,
  existing: ReadonlySet<string>,
  approvedShingles: readonly Set<string>[],
): DiscardReason | null => {
  if (item.format !== format) return 'wrong_format';
  if (item.format === 'written') return 'written_needs_rubric';
  const norm = normaliseText(item.stem);
  if (existing.has(norm) || seen.has(norm)) return 'duplicate_exact';
  const own = shingles(item.stem);
  for (const other of approvedShingles) {
    if (jaccard(own, other) >= DRAFT_LIMITS.jaccardMax) return 'duplicate_near';
  }
  return null;
};

/**
 * Every check of §6.4 over the drafter's answer, in drafter order, until the room is full. Drafts past the room are
 * neither stored nor counted. Never throws.
 */
export const screenDrafts = (raw: readonly unknown[], ctx: ScreenContext): ScreenResult => {
  const approvedShingles = ctx.approved.slice(0, DRAFT_LIMITS.maxComparisons).map(shingles);
  const accepted: DraftedMcqItem[] = [];
  const positions: number[] = [];
  const seen = new Set<string>();
  let discarded = 0;
  for (let position = 0; position < raw.length && accepted.length < ctx.room; position++) {
    const item = parseDraftedItem(raw[position]);
    const reason: DiscardReason | null =
      item === null
        ? 'bad_shape'
        : (contentCheck(item) ?? reasonOf(item, ctx.format, seen, ctx.existing, approvedShingles));
    if (reason !== null || item === null || item.format !== 'mcq') {
      discarded += 1;
      continue;
    }
    seen.add(normaliseText(item.stem));
    accepted.push(item);
    positions.push(position);
  }
  return { accepted, positions, discarded };
};
