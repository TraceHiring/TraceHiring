// A deterministic work meter (A1 review round 1, security High): generation charges abstract work units for every
// rational operation (by operand size) and every rendered character, against a per-tuple and a per-generation
// budget. No clock: the same spec and seeds always spend the same units, so the result stays deterministic.
//
// The meter is module state set only for the synchronous extent of runMetered(); evaluation outside a generation
// (the editor's parse or evaluate calls) is unmetered, and its cost is bounded by the 200-character grammar.

/** Thrown when a budget is exhausted; generateVariants turns it into variant_generation_failed, work_budget. */
export class WorkBudgetExceeded extends Error {
  constructor() {
    super('work budget exceeded');
    this.name = 'WorkBudgetExceeded';
  }
}

export interface Meter {
  /** Units left for the whole generation. */
  generation: number;
  /** Units left for the current tuple (reset per tuple by the caller). */
  tuple: number;
}

let active: Meter | null = null;

/** Spends `units` on the active meter, if any. Throws WorkBudgetExceeded when either budget goes negative. */
export function charge(units: number): void {
  if (active === null) return;
  active.generation -= units;
  active.tuple -= units;
  if (active.generation < 0 || active.tuple < 0) throw new WorkBudgetExceeded();
}

/** Units for touching `chars` characters of text (rendering, normalising, serialising): one per 64. */
export const textUnits = (chars: number): number => Math.max(1, Math.ceil(chars / 64));

/** Runs `fn` with `meter` active; restores the previous meter afterwards, also on a throw. */
export function runMetered<T>(meter: Meter, fn: () => T): T {
  const previous = active;
  active = meter;
  try {
    return fn();
  } finally {
    active = previous;
  }
}
