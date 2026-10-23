// drawSection (specs/m1-test-authoring.md §6.5, M1-10, R2-13, R3-2, R5-52 b and c): the seeded section draw the
// SessionDO runs at section enter and stores before the first item is served. Pure: the package section, its items
// and the seed are the only inputs; no I/O, no clock, no Math.random. Same inputs -> same result.
//
// The stream is sfc32 seeded with the seed's bytes 0-15 (big-endian words, 12 outputs discarded) and is consumed in
// this fixed order:
//   1. Draw sections: for each stratum in `section.draw.strata` order (no strata = one stratum of all the section's
//      items with `draw.count`), `count` weighted picks without replacement over the stratum's items in package
//      order; a pick takes item i with probability weight_i / sum(remaining weights), weight = drawWeight(exposure)
//      (two outputs per pick, a 53-bit uniform). Picks are concatenated stratum by stratum.
//      A section without a draw serves all its items in package order.
//   2. If `shuffleItems`: one Fisher-Yates shuffle of that list (unbiased integer draws).
//   3. For each served item in served order: `variantIndex = next() mod variants.length` if it has variants, then,
//      for an mcq item when `shuffleOptions`, a Fisher-Yates shuffle of its option ids (the variant's options).
// A malformed section throws DrawError. The package refine (TestPackageV2) and the publish guard refuse those cases
// upstream; in particular a stratum with fewer matching items than its quota is `stratum_too_small` here.
import type { TestPackageV2 } from '@trace/shared/contracts/candidate';
import { DrawError } from './errors.js';
import { sfc32, uniform01, uniformInt, type Prng } from './prng.js';

export { DrawError, type DrawErrorCode } from './errors.js';

export type PackageSection = TestPackageV2['sections'][number];
export type PackageItem = TestPackageV2['items'][number];

/** One served item, in served order. Plain data: the DO stores it as JSON. */
export interface DrawnItem {
  readonly itemVersionId: string;
  /** Index into the item's `variants`, or null for an item that is not parameterised. */
  readonly variantIndex: number | null;
  /** The chosen variant's id (mirrored as itemVariantId), or null. */
  readonly variantId: string | null;
  /** The served option order (option ids) of an mcq item; the package order when not shuffled; null if written. */
  readonly optionOrder: readonly string[] | null;
}

export interface SectionDraw {
  readonly sectionId: string;
  readonly items: readonly DrawnItem[];
}

/**
 * The draw weight of an item (R2-13, pending founder question Q-M1-4): 1 / (1 + its exposure count frozen at
 * publish). Prefers low exposure and still differs per candidate. The only place the weighting is defined.
 */
export function drawWeight(exposureAtPublish: number): number {
  if (!Number.isSafeInteger(exposureAtPublish) || exposureAtPublish < 0) {
    throw new DrawError('bad_exposure');
  }
  return 1 / (1 + exposureAtPublish);
}

// ---- Shuffles and weighted picks (the stream is prng.ts) ---------------------------------------------------------

function shuffle<T>(rng: Prng, list: T[]): void {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = uniformInt(rng, i + 1);
    const t = list[i]!;
    list[i] = list[j]!;
    list[j] = t;
  }
}

/** `count` weighted picks without replacement, in pick order. */
function weightedDraw(rng: Prng, candidates: readonly PackageItem[], count: number): PackageItem[] {
  const left = candidates.map((item) => ({ item, w: drawWeight(item.exposureAtPublish) }));
  const picked: PackageItem[] = [];
  for (let k = 0; k < count; k += 1) {
    let total = 0;
    for (const c of left) total += c.w;
    const u = uniform01(rng) * total;
    let acc = 0;
    let at = left.length - 1;
    for (let i = 0; i < left.length; i += 1) {
      acc += left[i]!.w;
      if (u < acc) {
        at = i;
        break;
      }
    }
    picked.push(left[at]!.item);
    left.splice(at, 1);
  }
  return picked;
}

// ---- The draw -------------------------------------------------------------------------------------------------------

/**
 * Draws one section of a package v2 (§6.5). `items` may be the whole package's items: only those of `section.id`
 * are used. `seed` is drawSeed(sessionId, sectionId) (at least 16 bytes; only the first 16 are used).
 */
export function drawSection(
  section: PackageSection,
  items: readonly PackageItem[],
  seed: Uint8Array,
): SectionDraw {
  const rng = sfc32(seed);
  const own = items.filter((i) => i.sectionId === section.id);
  if (own.length === 0) throw new DrawError('no_items');
  if (new Set(own.map((i) => i.itemVersionId)).size !== own.length) {
    throw new DrawError('duplicate_item');
  }
  for (const i of own) drawWeight(i.exposureAtPublish);

  let served: PackageItem[];
  if (section.draw === null) {
    served = [...own];
  } else {
    const { count, strata } = section.draw;
    if (count > own.length) throw new DrawError('draw_too_large');
    const quotas =
      strata.length === 0
        ? [{ match: (): boolean => true, count }]
        : strata.map((st) => ({
            match: (i: PackageItem) =>
              i.skillKey === st.skillKey && i.difficultyBand === st.difficultyBand,
            count: st.count,
          }));
    if (strata.length > 0) {
      if (strata.reduce((n, st) => n + st.count, 0) !== count) {
        throw new DrawError('strata_mismatch');
      }
      const keys = new Set(strata.map((st) => `${st.skillKey}:${st.difficultyBand}`));
      if (keys.size !== strata.length) throw new DrawError('duplicate_stratum');
    }
    served = [];
    for (const quota of quotas) {
      const candidates = own.filter(quota.match);
      if (candidates.length < quota.count) throw new DrawError('stratum_too_small');
      served.push(...weightedDraw(rng, candidates, quota.count));
    }
  }
  if (section.shuffleItems) shuffle(rng, served);

  const drawn = served.map((item): DrawnItem => {
    let variantIndex: number | null = null;
    let variantId: string | null = null;
    let options = item.options;
    if (item.variants !== undefined && item.variants.length > 0) {
      variantIndex = rng.next() % item.variants.length;
      const variant = item.variants[variantIndex]!;
      variantId = variant.variantId;
      options = variant.options;
    }
    let optionOrder: string[] | null = null;
    if (item.kind === 'mcq' && options !== undefined) {
      optionOrder = options.map((o) => o.id);
      if (section.shuffleOptions) shuffle(rng, optionOrder);
    }
    return { itemVersionId: item.itemVersionId, variantIndex, variantId, optionOrder };
  });
  return { sectionId: section.id, items: drawn };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** M1-10, R5-52 b: SHA-256(utf8(sessionId) ‖ utf8(sectionId)), both lower-case uuids, with Web Crypto. */
export async function drawSeed(sessionId: string, sectionId: string): Promise<Uint8Array> {
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) {
    throw new RangeError('drawSeed: a lower-case uuid session id');
  }
  if (typeof sectionId !== 'string' || !UUID.test(sectionId)) {
    throw new RangeError('drawSeed: a lower-case uuid section id');
  }
  const bytes = new TextEncoder().encode(`${sessionId}${sectionId}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
