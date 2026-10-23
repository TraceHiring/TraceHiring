// The typed error of @trace/item-delivery (specs/m1-test-authoring.md §6.5). Its own module so draw.ts, prng.ts
// and difficulty-band.ts share it without an import cycle.

export type DrawErrorCode =
  | 'bad_seed'
  | 'bad_exposure'
  | 'bad_difficulty'
  | 'no_items'
  | 'duplicate_item'
  | 'draw_too_large'
  | 'strata_mismatch'
  | 'duplicate_stratum'
  | 'stratum_too_small';

/** A section the draw cannot serve. The message names the code only, never ids or content. */
export class DrawError extends Error {
  readonly code: DrawErrorCode;
  constructor(code: DrawErrorCode) {
    super(`draw: ${code}`);
    this.name = 'DrawError';
    this.code = code;
  }
}
