// Regression pin (A1 review round 1): a stored draw is never re-drawn, but a retry or a resumed device must get the
// same draw from the same seed, so the drawSection output for one fixed seed and section is pinned.
import { describe, expect, it } from 'vitest';
import { drawSection } from './draw.js';
import { item, section } from './test-fixtures.js';

describe('drawSection pin', () => {
  it('seed bytes 0..15, 8 items (every other one with 3 variants), draw 4, items and options shuffled', () => {
    const pool = Array.from({ length: 8 }, (_, i) =>
      item(i + 1, { exposureAtPublish: i, variants: i % 2 === 0 ? 3 : 0 }),
    );
    const s = section({ draw: { count: 4, strata: [] }, shuffleItems: true, shuffleOptions: true });
    const out = drawSection(
      s,
      pool,
      Uint8Array.from({ length: 16 }, (_, i) => i),
    );
    expect(out.items).toEqual([
      {
        itemVersionId: '00000001-0000-4000-8000-000000000005',
        variantIndex: 0,
        variantId: '00000003-0000-4000-8000-000000001388',
        optionOrder: ['o0', 'o1', 'o2', 'o3'],
      },
      {
        itemVersionId: '00000001-0000-4000-8000-000000000003',
        variantIndex: 2,
        variantId: '00000003-0000-4000-8000-000000000bba',
        optionOrder: ['o3', 'o0', 'o2', 'o1'],
      },
      {
        itemVersionId: '00000001-0000-4000-8000-000000000002',
        variantIndex: null,
        variantId: null,
        optionOrder: ['o0', 'o3', 'o2', 'o1'],
      },
      {
        itemVersionId: '00000001-0000-4000-8000-000000000001',
        variantIndex: 1,
        variantId: '00000003-0000-4000-8000-0000000003e9',
        optionOrder: ['o2', 'o3', 'o1', 'o0'],
      },
    ]);
  });
});
