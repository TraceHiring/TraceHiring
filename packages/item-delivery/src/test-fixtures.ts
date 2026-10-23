// Synthetic package-v2 sections and items for the draw tests (R5-4: synthetic content only). Test-only module.
import type { PackageItem, PackageSection } from './draw.js';

export const SECTION_ID = '5ec70000-0000-4000-8000-000000000001';

/** A lower-case 36-character uuid made from a number (synthetic ids only). */
export const uuidOf = (prefix: string, n: number): string =>
  `${prefix.padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export function section(overrides: Partial<PackageSection> = {}): PackageSection {
  return {
    id: SECTION_ID,
    title: '[synthetic] Section',
    position: 1,
    format: 'mcq',
    navigation: 'free',
    shuffleItems: false,
    shuffleOptions: false,
    draw: null,
    ...overrides,
  };
}

export interface ItemShape {
  skillKey?: string;
  difficultyBand?: number;
  exposureAtPublish?: number;
  options?: number;
  variants?: number;
  kind?: 'mcq' | 'written';
  sectionId?: string;
}

const optionsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `o${i}`, text: `[synthetic] option ${i}` }));

export function item(n: number, shape: ItemShape = {}): PackageItem {
  const kind = shape.kind ?? 'mcq';
  const base: PackageItem = {
    sectionId: shape.sectionId ?? SECTION_ID,
    itemVersionId: uuidOf('1', n),
    itemId: uuidOf('2', n),
    kind,
    prompt: `[synthetic] item ${n}`,
    skillKey: shape.skillKey ?? 'quant',
    difficultyBand: shape.difficultyBand ?? 2,
    exposureAtPublish: shape.exposureAtPublish ?? 0,
  };
  if (kind === 'written') return { ...base, maxChars: 2000 };
  const options = optionsOf(shape.options ?? 4);
  const variants = shape.variants ?? 0;
  if (variants === 0) return { ...base, options };
  return {
    ...base,
    options,
    variants: Array.from({ length: variants }, (_, v) => ({
      variantId: uuidOf('3', n * 1000 + v),
      prompt: `[synthetic] item ${n} variant ${v}`,
      options,
    })),
  };
}

/** Deterministic synthetic seed bytes. */
export const seedOf = (n: number, length = 32): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => (n * 131 + i * 17 + 7) % 256);
