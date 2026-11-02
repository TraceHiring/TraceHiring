// The `answer.text` edit the candidate sends (specs/d1-demo-slice.md §4.4, revision 4h): keep `p` UTF-16 units,
// delete `d`, insert `i`, derived from the common prefix and suffix of two consecutive textarea values. Both
// boundaries are moved out of any surrogate pair (code-point aligned), because the contract refuses a lone surrogate
// in `i` and in the rebuilt text. The same derivation as `spliceOf` in workers/edge/src/session-do.autosave.test.ts.

export interface Splice {
  p: number;
  d: number;
  i: string;
}

const HIGH = /[\uD800-\uDBFF]/;
const LOW = /[\uDC00-\uDFFF]/;

/** True when UTF-16 offset `k` of `s` falls between the two halves of a surrogate pair. */
const insidePair = (s: string, k: number): boolean =>
  k > 0 && k < s.length && HIGH.test(s.charAt(k - 1)) && LOW.test(s.charAt(k));

/** The splice that turns `prev` into `next`. */
export const spliceOf = (prev: string, next: string): Splice => {
  let p = 0;
  while (p < prev.length && p < next.length && prev[p] === next[p]) p += 1;
  if (insidePair(prev, p) || insidePair(next, p)) p -= 1;
  let s = 0;
  while (
    s < prev.length - p &&
    s < next.length - p &&
    prev[prev.length - 1 - s] === next[next.length - 1 - s]
  ) {
    s += 1;
  }
  if (s > 0 && (insidePair(prev, prev.length - s) || insidePair(next, next.length - s))) s -= 1;
  return { p, d: prev.length - p - s, i: next.slice(p, next.length - s) };
};

/** Applies a splice as the edge does; null when the range does not fit the text. */
export const applySplice = (text: string, { p, d, i }: Splice): string | null => {
  if (p > text.length || d > text.length - p) return null;
  return text.slice(0, p) + i + text.slice(p + d);
};
