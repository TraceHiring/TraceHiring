// Parameterised-variant generation (specs/m1-test-authoring.md §6.3, M1-7, E14, E15; seeds R5-52 b). Pure: the
// spec and one seed per variant are the only inputs; no I/O, no clock, no Math.random. The api calls it before a
// parameterised draft leaves `draft` and stores the result through save_item_variants.
//
// Variant k (1-based, = item_variants.variant_no) draws from sfc32 seeded with seeds[k-1]; the async helper
// generateVariantsFor() uses variantSeed(itemVersionId, k) = SHA-256(utf8(itemVersionId) ‖ utf8(String(k))).
// Each draw is one tuple: params in name order (code-unit order; jsonb does not keep key order, so declaration order
// cannot matter), each `int` param uniform over min, min+step, ... <= max and each `choice` uniform over its values.
// Then derived values in dependency order (ties by name), then the constraints, then stem and options are rendered.
// A tuple is rejected when a constraint is false, an expression divides by zero (or another EvalRejection), a
// template cannot render, two options render equal (after trimming and collapsing whitespace), a text is empty or
// too long, or the rendered stem and options repeat an earlier variant. Generation stops at `count` variants, or
// fails with variant_generation_failed after 50 x count tuples in total.
//
// The answer key: options keep the parent's option ids, so a variant's key is the parent's correctOptionId; the
// equal-option rejection guarantees the key's rendered text differs from every distractor.
import { ParamSpec } from '@trace/shared/contracts/m1';
import {
  EvalRejection,
  ExprError,
  RESERVED_NAMES,
  evaluate,
  exprNames,
  parseExpression,
  type Expr,
  type ExprErrorCode,
} from './expr.js';
import { sfc32, uniformBelow, type Prng } from './prng.js';
import { rational, type Rational } from './rational.js';
import {
  RenderRejection,
  TemplateError,
  formattedNames,
  parseTemplate,
  renderTemplate,
  templateNames,
  type TemplatePart,
  type TemplateValue,
} from './template.js';

/** §6.3: a spec fails after this many tuples per requested variant. */
export const MAX_ATTEMPTS_PER_VARIANT = 50;

const MAX_STEM = 4000;
const MAX_OPTION = 500;

export type SpecErrorReason =
  | 'invalid_shape'
  | 'reserved_name'
  | 'unknown_name'
  | 'cycle'
  | 'non_numeric_param'
  | 'format_on_text'
  | 'bad_template'
  | ExprErrorCode;

export interface GeneratedVariant {
  /** item_variants.variant_no, 1..count. */
  readonly variantNo: number;
  /** The drawn params (scalars only), keys in name order. */
  readonly params: Readonly<Record<string, number | string>>;
  readonly stem: string;
  /** The parent's option ids, in the parent's order, with rendered text. */
  readonly options: readonly { readonly id: string; readonly text: string }[];
  /** The parent's correctOptionId: the key is always one of the variant's options. */
  readonly correctOptionId: string;
}

export type SpecCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'bad_param_spec';
      readonly reason: SpecErrorReason;
      readonly path: string;
    };

export type GenerateResult =
  | { readonly ok: true; readonly variants: readonly GeneratedVariant[] }
  | {
      readonly ok: false;
      readonly code: 'bad_param_spec';
      readonly reason: SpecErrorReason;
      readonly path: string;
    }
  | {
      readonly ok: false;
      readonly code: 'variant_generation_failed';
      readonly accepted: number;
      readonly attempts: number;
    };

interface Compiled {
  readonly spec: ParamSpec;
  readonly paramNames: readonly string[];
  readonly derived: readonly { readonly name: string; readonly expr: Expr }[];
  readonly constraints: readonly Expr[];
  readonly stem: readonly TemplatePart[];
  readonly options: readonly { readonly id: string; readonly parts: readonly TemplatePart[] }[];
}

class SpecError extends Error {
  constructor(
    readonly reason: SpecErrorReason,
    readonly path: string,
  ) {
    super(`param spec: ${reason} at ${path}`);
    this.name = 'SpecError';
  }
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const ownKeys = (record: object): string[] => Object.keys(record).sort(byCodeUnit);

function parseAt(src: string, mode: 'value' | 'constraint', path: string): Expr {
  try {
    return parseExpression(src, mode);
  } catch (error) {
    if (error instanceof ExprError) throw new SpecError(error.code, path);
    throw error;
  }
}

function templateAt(src: string, path: string): TemplatePart[] {
  try {
    return parseTemplate(src);
  } catch (error) {
    if (error instanceof TemplateError) throw new SpecError('bad_template', path);
    throw error;
  }
}

/** Derived values in dependency order (Kahn's algorithm, smallest ready name first). */
function orderDerived(exprs: ReadonlyMap<string, Expr>): { name: string; expr: Expr }[] {
  const pending = new Map<string, Set<string>>();
  for (const [name, expr] of exprs) {
    pending.set(name, new Set(exprNames(expr).filter((dep) => exprs.has(dep))));
  }
  const ordered: { name: string; expr: Expr }[] = [];
  while (pending.size > 0) {
    const ready = [...pending].filter(([, deps]) => deps.size === 0).map(([name]) => name);
    if (ready.length === 0)
      throw new SpecError('cycle', `derived.${[...pending.keys()].sort(byCodeUnit)[0]!}`);
    const name = ready.sort(byCodeUnit)[0]!;
    pending.delete(name);
    for (const deps of pending.values()) deps.delete(name);
    ordered.push({ name, expr: exprs.get(name)! });
  }
  return ordered;
}

function compile(raw: unknown): Compiled {
  const parsed = ParamSpec.safeParse(raw);
  if (!parsed.success) throw new SpecError('invalid_shape', '$');
  const spec = parsed.data;
  // Every lookup below goes through Maps and Sets built from own keys, never `record[name]` on a name taken from
  // an expression or a template (a name such as `constructor` must not resolve through Object.prototype).
  const paramNames = ownKeys(spec.params);
  const derivedNames = ownKeys(spec.derived);
  for (const name of [...paramNames, ...derivedNames]) {
    if (RESERVED_NAMES.includes(name)) throw new SpecError('reserved_name', name);
  }
  const textParams = new Set(
    paramNames.filter((name) => {
      const def = Object.getOwnPropertyDescriptor(spec.params, name)?.value as
        ParamSpec['params'][string] | undefined;
      return def?.kind === 'choice' && def.values.some((v) => typeof v === 'string');
    }),
  );
  const known = new Set([...paramNames, ...derivedNames]);

  const derivedExprs = new Map<string, Expr>();
  for (const name of derivedNames) {
    const src = Object.getOwnPropertyDescriptor(spec.derived, name)?.value as string;
    derivedExprs.set(name, parseAt(src, 'value', `derived.${name}`));
  }
  const constraints = spec.constraints.map((src, i) =>
    parseAt(src, 'constraint', `constraints[${i}]`),
  );
  const checkNames = (expr: Expr, path: string) => {
    for (const name of exprNames(expr)) {
      if (!known.has(name)) throw new SpecError('unknown_name', path);
      if (textParams.has(name)) throw new SpecError('non_numeric_param', path);
    }
  };
  for (const [name, expr] of derivedExprs) checkNames(expr, `derived.${name}`);
  constraints.forEach((expr, i) => checkNames(expr, `constraints[${i}]`));
  const derived = orderDerived(derivedExprs);

  const checkTemplate = (parts: readonly TemplatePart[], path: string) => {
    for (const name of templateNames(parts)) {
      if (!known.has(name)) throw new SpecError('unknown_name', path);
    }
    for (const name of formattedNames(parts)) {
      if (textParams.has(name)) throw new SpecError('format_on_text', path);
    }
  };
  const stem = templateAt(spec.stem, 'stem');
  checkTemplate(stem, 'stem');
  const options = spec.options.map((option, i) => {
    const parts = templateAt(option.text, `options[${i}].text`);
    checkTemplate(parts, `options[${i}].text`);
    return { id: option.id, parts };
  });
  return { spec, paramNames, derived, constraints, stem, options };
}

/** Checks a spec without generating: the import and editor report `bad_param_spec` with a reason and path. */
export function validateParamSpec(spec: unknown): SpecCheck {
  try {
    compile(spec);
    return { ok: true };
  } catch (error) {
    if (error instanceof SpecError) {
      return { ok: false, code: 'bad_param_spec', reason: error.reason, path: error.path };
    }
    throw error;
  }
}

const normalise = (text: string) => text.trim().replace(/\s+/g, ' ');

function drawParams(c: Compiled, rng: Prng): Map<string, number | string> {
  const drawn = new Map<string, number | string>();
  for (const name of c.paramNames) {
    const def = Object.getOwnPropertyDescriptor(c.spec.params, name)!
      .value as ParamSpec['params'][string];
    if (def.kind === 'int') {
      const min = BigInt(def.min);
      const step = BigInt(def.step);
      const span = (BigInt(def.max) - min) / step + 1n;
      drawn.set(name, Number(min + uniformBelow(rng, span) * step));
    } else {
      drawn.set(name, def.values[Number(uniformBelow(rng, BigInt(def.values.length)))]!);
    }
  }
  return drawn;
}

/** One tuple: the rendered variant, or undefined when the tuple is rejected. */
function tryTuple(
  c: Compiled,
  rng: Prng,
  variantNo: number,
): { variant: GeneratedVariant; key: string } | undefined {
  const drawn = drawParams(c, rng);
  const numeric = new Map<string, Rational>();
  const values = new Map<string, TemplateValue>();
  for (const [name, v] of drawn) {
    if (typeof v === 'number') {
      const r = rational(BigInt(v));
      numeric.set(name, r);
      values.set(name, r);
    } else {
      values.set(name, v);
    }
  }
  let stem: string;
  let options: { id: string; text: string }[];
  try {
    for (const { name, expr } of c.derived) {
      const v = evaluate(expr, numeric) as Rational;
      numeric.set(name, v);
      values.set(name, v);
    }
    for (const expr of c.constraints) if (evaluate(expr, numeric) !== true) return undefined;
    stem = renderTemplate(c.stem, values);
    options = c.options.map((o) => ({ id: o.id, text: renderTemplate(o.parts, values) }));
  } catch (error) {
    if (error instanceof EvalRejection || error instanceof RenderRejection) return undefined;
    throw error;
  }
  if (normalise(stem) === '' || stem.length > MAX_STEM) return undefined;
  const texts = options.map((o) => normalise(o.text));
  if (texts.some((t, i) => t === '' || options[i]!.text.length > MAX_OPTION)) return undefined;
  if (new Set(texts).size !== texts.length) return undefined;
  const params: Record<string, number | string> = {};
  for (const [name, v] of drawn)
    Object.defineProperty(params, name, { value: v, enumerable: true });
  return {
    variant: { variantNo, params, stem, options, correctOptionId: c.spec.correctOptionId },
    key: JSON.stringify([normalise(stem), texts]),
  };
}

/**
 * Generates `spec.count` variants; `seeds[k - 1]` seeds variant k and must hold at least 16 bytes (RangeError
 * otherwise, and when there is not exactly one seed per variant).
 */
export function generateVariants(spec: ParamSpec, seeds: readonly Uint8Array[]): GenerateResult {
  let c: Compiled;
  try {
    c = compile(spec);
  } catch (error) {
    if (error instanceof SpecError) {
      return { ok: false, code: 'bad_param_spec', reason: error.reason, path: error.path };
    }
    throw error;
  }
  const count = c.spec.count;
  if (!Array.isArray(seeds) || seeds.length !== count) {
    throw new RangeError('seeds: one per variant');
  }
  const prngs = seeds.map((seed) => sfc32(seed));
  const budget = MAX_ATTEMPTS_PER_VARIANT * count;
  const variants: GeneratedVariant[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  for (let k = 1; k <= count; k += 1) {
    const rng = prngs[k - 1]!;
    for (;;) {
      if (attempts >= budget) {
        return {
          ok: false,
          code: 'variant_generation_failed',
          accepted: variants.length,
          attempts,
        };
      }
      attempts += 1;
      const got = tryTuple(c, rng, k);
      if (got === undefined || seen.has(got.key)) continue;
      seen.add(got.key);
      variants.push(got.variant);
      break;
    }
  }
  return { ok: true, variants };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** R5-52 b: SHA-256(utf8(itemVersionId) ‖ utf8(decimal variantNo)), with Web Crypto (Node 22 and Workers). */
export async function variantSeed(itemVersionId: string, variantNo: number): Promise<Uint8Array> {
  if (typeof itemVersionId !== 'string' || !UUID.test(itemVersionId)) {
    throw new RangeError('variantSeed: a lower-case uuid');
  }
  if (!Number.isSafeInteger(variantNo) || variantNo < 1) {
    throw new RangeError('variantSeed: variant_no >= 1');
  }
  const bytes = new TextEncoder().encode(`${itemVersionId}${String(variantNo)}`);
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

/** generateVariants with variant k seeded by variantSeed(itemVersionId, k); a bad spec is reported unhashed. */
export async function generateVariantsFor(
  spec: ParamSpec,
  itemVersionId: string,
): Promise<GenerateResult> {
  const check = validateParamSpec(spec);
  if (!check.ok) return check;
  const seeds = await Promise.all(
    Array.from({ length: spec.count }, (_, k) => variantSeed(itemVersionId, k + 1)),
  );
  return generateVariants(spec, seeds);
}
