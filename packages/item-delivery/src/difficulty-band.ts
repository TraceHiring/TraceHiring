// The difficulty band of an item (specs/m1-test-authoring.md M1-10: strata are skill x difficulty band, 0.2 wide;
// A1 review round 1, database Low). The one definition the api's strata builder and the draw share.
// Band b (0-4) holds difficulties in [0.2 b, 0.2 (b + 1)), computed in whole hundredths (difficulty is numeric(3,2)),
// so 0.19 -> 0 and 0.20 -> 1 exactly. 1.00 has no band of its own: it joins the highest band, 4 = [0.80, 1.00].
import { DrawError } from './errors.js';

export function difficultyBand(difficulty: number): 0 | 1 | 2 | 3 | 4 {
  if (typeof difficulty !== 'number' || !Number.isFinite(difficulty)) {
    throw new DrawError('bad_difficulty');
  }
  const h = Math.round(difficulty * 100);
  if (h < 0 || h > 100 || Math.abs(h - difficulty * 100) > 1e-6) {
    throw new DrawError('bad_difficulty');
  }
  return Math.min(4, Math.floor(h / 20)) as 0 | 1 | 2 | 3 | 4;
}
