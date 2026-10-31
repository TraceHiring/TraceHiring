// difficultyBand (review round 1, database Low; M1-10: strata are skill x difficulty band, 0.2 wide). One function so
// the api's strata builder and the draw agree. Band b holds difficulties in [0.2 b, 0.2 (b + 1)); 1.00 has no band
// of its own and joins the highest band, 4 ([0.80, 1.00]).
import { describe, expect, it } from 'vitest';
import { DrawError } from './draw.js';
import { difficultyBand } from './difficulty-band.js';

describe('difficultyBand', () => {
  it.each<[number, number]>([
    [0, 0],
    [0.19, 0],
    [0.2, 1],
    [0.39, 1],
    [0.4, 2],
    [0.59, 2],
    [0.6, 3],
    [0.79, 3],
    [0.8, 4],
    [0.99, 4],
    [1, 4],
  ])('%s -> band %s', (d, band) => {
    expect(difficultyBand(d)).toBe(band);
  });

  it('refuses a value that is not a numeric(3,2) difficulty in 0..1', () => {
    for (const bad of [-0.01, 1.01, 0.405, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => difficultyBand(bad)).toThrow(DrawError);
    }
    try {
      difficultyBand(2);
    } catch (error) {
      expect((error as DrawError).code).toBe('bad_difficulty');
    }
  });
});
