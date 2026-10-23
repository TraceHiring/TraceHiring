// The §6.3 expression language (specs/m1-test-authoring.md §6.3, M1-7): a hand-written tokenizer and Pratt parser
// that accepts exactly the grammar below and refuses everything else with a typed ExprError, plus an exact evaluator
// over rationals. Specs are data, never code (check-boundaries rule 12): nothing here runs a string.
//
//   number     digits, optionally "." and 1-6 more digits (no sign: "-" is the unary operator)
//   name       [a-z][a-z0-9_]{0,15}; `and`, `or`, `not` and the function names are reserved
//   value      + - * / (left-associative), unary -, base ^ e with e an integer literal 0-6, parentheses,
//              min(x, y, ...) and max(...) with 2-8 arguments, abs(x), floor(x), ceil(x), gcd(x, y), lcm(x, y),
//              round(x, d) with d an integer literal 0-6
//   constraint comparisons < <= > >= == != (not chained) combined with and / or / not; constraints only
//   caps       200 characters; tree height 16 (a leaf has height 1)
//
// Precedence, loosest first: or, and, not, comparison, + -, * /, unary -, ^. So -2^2 = -(2^2) and `not a < b` is
// `not (a < b)`. `2 ^ 3 ^ 2` is refused (write the parentheses). Error messages carry a code and a character offset,
// never the input text.
import {
  RationalError,
  abs,
  add,
  bigGcd,
  ceil,
  compare,
  div,
  floor,
  isInteger,
  mul,
  neg,
  parseDecimal,
  pow,
  rational,
  roundHalfAway,
  sub,
  type Rational,
} from './rational.js';

export const MAX_EXPR_LENGTH = 200;
export const MAX_EXPR_DEPTH = 16;
const MAX_NAME_LENGTH = 16;
const MAX_DECIMALS = 6;
const MAX_EXPONENT = 6;
const MAX_ROUND_DIGITS = 6;
const MAX_MIN_MAX_ARGS = 8;

export type ExprMode = 'value' | 'constraint';

export type ExprErrorCode =
  | 'empty'
  | 'too_long'
  | 'bad_char'
  | 'bad_number'
  | 'bad_name'
  | 'reserved_name'
  | 'unknown_function'
  | 'bad_arity'
  | 'bad_exponent'
  | 'bad_round_digits'
  | 'unexpected_token'
  | 'unexpected_end'
  | 'too_deep'
  | 'not_allowed'
  | 'type_mismatch'
  | 'comparison_chain';

/** A refused expression: the code and the character offset where it was found. */
export class ExprError extends Error {
  readonly code: ExprErrorCode;
  readonly at: number;
  constructor(code: ExprErrorCode, at: number) {
    super(`expression: ${code} at ${at}`);
    this.name = 'ExprError';
    this.code = code;
    this.at = at;
  }
}

const FUNCTIONS = ['min', 'max', 'abs', 'round', 'floor', 'ceil', 'gcd', 'lcm'] as const;
type FunctionName = (typeof FUNCTIONS)[number];
const KEYWORDS = ['and', 'or', 'not'] as const;
/** Names a param or derived value may not take: the keywords and the function names. */
export const RESERVED_NAMES: readonly string[] = Object.freeze([...KEYWORDS, ...FUNCTIONS]);

export type CompareOp = '<' | '<=' | '>' | '>=' | '==' | '!=';
type ArithOp = '+' | '-' | '*' | '/';

/** The parsed tree. Plain data: it can be stored, compared and walked; it never holds a callable. */
export type Expr =
  | { readonly t: 'num'; readonly v: Rational }
  | { readonly t: 'var'; readonly name: string }
  | { readonly t: 'neg'; readonly a: Expr }
  | { readonly t: 'bin'; readonly op: ArithOp; readonly a: Expr; readonly b: Expr }
  | { readonly t: 'pow'; readonly a: Expr; readonly e: number }
  | {
      readonly t: 'call';
      readonly fn: Exclude<FunctionName, 'round'>;
      readonly args: readonly Expr[];
    }
  | { readonly t: 'round'; readonly a: Expr; readonly digits: number }
  | { readonly t: 'cmp'; readonly op: CompareOp; readonly a: Expr; readonly b: Expr }
  | { readonly t: 'not'; readonly a: Expr }
  | { readonly t: 'logic'; readonly op: 'and' | 'or'; readonly a: Expr; readonly b: Expr };

// ---- Tokens ---------------------------------------------------------------------------------------------------------

type Token =
  | { readonly k: 'num'; readonly text: string; readonly at: number }
  | { readonly k: 'name'; readonly text: string; readonly at: number }
  | { readonly k: 'op'; readonly text: string; readonly at: number }
  | { readonly k: 'end'; readonly at: number };

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isLower = (c: string | undefined) => c !== undefined && c >= 'a' && c <= 'z';
const TWO_CHAR_OPS = ['<=', '>=', '==', '!='];
const ONE_CHAR_OPS = '+-*/^(),<>';

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t') {
      i += 1;
      continue;
    }
    if (isDigit(c)) {
      let j = i;
      while (isDigit(src[j])) j += 1;
      if (src[j] === '.') {
        let k = j + 1;
        while (isDigit(src[k])) k += 1;
        if (k === j + 1 || k - j - 1 > MAX_DECIMALS) throw new ExprError('bad_number', i);
        j = k;
      }
      out.push({ k: 'num', text: src.slice(i, j), at: i });
      i = j;
      continue;
    }
    if (isLower(c)) {
      let j = i + 1;
      while (isLower(src[j]) || isDigit(src[j]) || src[j] === '_') j += 1;
      if (j - i > MAX_NAME_LENGTH) throw new ExprError('bad_name', i);
      out.push({ k: 'name', text: src.slice(i, j), at: i });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      out.push({ k: 'op', text: two, at: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(c)) {
      out.push({ k: 'op', text: c, at: i });
      i += 1;
      continue;
    }
    throw new ExprError('bad_char', i);
  }
  out.push({ k: 'end', at: src.length });
  return out;
}

// ---- Parser ---------------------------------------------------------------------------------------------------------

const BP_OR = 1;
const BP_AND = 2;
const BP_NOT = 3;
const BP_CMP = 4;
const BP_ADD = 5;
const BP_MUL = 6;
const BP_NEG = 7;
const BP_POW = 8;

const COMPARE_OPS: readonly string[] = ['<', '<=', '>', '>=', '==', '!='];
const isBool = (e: Expr): boolean => e.t === 'cmp' || e.t === 'not' || e.t === 'logic';
const isFunction = (name: string): name is FunctionName =>
  (FUNCTIONS as readonly string[]).includes(name);

/** An integer literal 0..max as written (a `num` node with an integer value), else undefined. */
const smallIntLiteral = (e: Expr, max: number): number | undefined =>
  e.t === 'num' && e.v.d === 1n && e.v.n >= 0n && e.v.n <= BigInt(max) ? Number(e.v.n) : undefined;

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: readonly Token[],
    private readonly mode: ExprMode,
  ) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private take(): Token {
    const tok = this.tokens[this.pos]!;
    if (tok.k !== 'end') this.pos += 1;
    return tok;
  }

  private isOp(tok: Token, text: string): boolean {
    return tok.k === 'op' && tok.text === text;
  }

  private fail(tok: Token): never {
    throw new ExprError(tok.k === 'end' ? 'unexpected_end' : 'unexpected_token', tok.at);
  }

  private needNum(e: Expr, at: number): Expr {
    if (isBool(e)) throw new ExprError('type_mismatch', at);
    return e;
  }

  private needBool(e: Expr, at: number): Expr {
    if (!isBool(e)) throw new ExprError('type_mismatch', at);
    return e;
  }

  private constraintOnly(at: number): void {
    if (this.mode === 'value') throw new ExprError('not_allowed', at);
  }

  parseAll(): Expr {
    const e = this.parse(0);
    const rest = this.peek();
    if (rest.k !== 'end') this.fail(rest);
    return e;
  }

  private parse(minBp: number): Expr {
    let left = this.prefix();
    for (;;) {
      const tok = this.peek();
      if (tok.k === 'name' && (tok.text === 'and' || tok.text === 'or')) {
        const bp = tok.text === 'and' ? BP_AND : BP_OR;
        if (bp <= minBp) return left;
        this.constraintOnly(tok.at);
        this.take();
        const right = this.parse(bp);
        left = {
          t: 'logic',
          op: tok.text,
          a: this.needBool(left, tok.at),
          b: this.needBool(right, tok.at),
        };
        continue;
      }
      if (tok.k !== 'op') return left;
      if (COMPARE_OPS.includes(tok.text)) {
        if (BP_CMP <= minBp) return left;
        this.constraintOnly(tok.at);
        if (left.t === 'cmp') throw new ExprError('comparison_chain', tok.at);
        this.take();
        const right = this.parse(BP_CMP);
        left = {
          t: 'cmp',
          op: tok.text as CompareOp,
          a: this.needNum(left, tok.at),
          b: this.needNum(right, tok.at),
        };
        const next = this.peek();
        if (next.k === 'op' && COMPARE_OPS.includes(next.text)) {
          throw new ExprError('comparison_chain', next.at);
        }
        continue;
      }
      if (tok.text === '+' || tok.text === '-' || tok.text === '*' || tok.text === '/') {
        const bp = tok.text === '+' || tok.text === '-' ? BP_ADD : BP_MUL;
        if (bp <= minBp) return left;
        this.take();
        const right = this.parse(bp);
        left = {
          t: 'bin',
          op: tok.text,
          a: this.needNum(left, tok.at),
          b: this.needNum(right, tok.at),
        };
        continue;
      }
      if (tok.text === '^') {
        if (BP_POW <= minBp) return left;
        this.take();
        const expTok = this.take();
        const e =
          expTok.k === 'num' && /^[0-9]+$/.test(expTok.text) ? Number(expTok.text) : Number.NaN;
        if (!(e >= 0 && e <= MAX_EXPONENT)) throw new ExprError('bad_exponent', expTok.at);
        if (this.isOp(this.peek(), '^')) throw new ExprError('bad_exponent', this.peek().at);
        left = { t: 'pow', a: this.needNum(left, tok.at), e };
        continue;
      }
      return left;
    }
  }

  private prefix(): Expr {
    const tok = this.take();
    if (tok.k === 'num') {
      try {
        return { t: 'num', v: parseDecimal(tok.text) };
      } catch (error) {
        // A literal beyond the size bound (rational.ts MAX_BITS) is a parse error, never a thrown RationalError.
        if (error instanceof RationalError) throw new ExprError('bad_number', tok.at);
        throw error;
      }
    }
    if (tok.k === 'name') {
      if (tok.text === 'not') {
        this.constraintOnly(tok.at);
        return { t: 'not', a: this.needBool(this.parse(BP_NOT), tok.at) };
      }
      if (tok.text === 'and' || tok.text === 'or') {
        this.constraintOnly(tok.at);
        this.fail(tok);
      }
      const call = this.isOp(this.peek(), '(');
      if (isFunction(tok.text)) {
        if (!call) throw new ExprError('reserved_name', tok.at);
        return this.call(tok.text, tok.at);
      }
      if (call) throw new ExprError('unknown_function', tok.at);
      return { t: 'var', name: tok.text };
    }
    if (this.isOp(tok, '-')) return { t: 'neg', a: this.needNum(this.parse(BP_NEG), tok.at) };
    if (this.isOp(tok, '(')) {
      const inner = this.parse(0);
      const close = this.take();
      if (!this.isOp(close, ')')) this.fail(close);
      return inner;
    }
    return this.fail(tok);
  }

  private call(fn: FunctionName, at: number): Expr {
    this.take(); // "("
    const args: Expr[] = [];
    if (this.isOp(this.peek(), ')')) {
      this.take();
    } else {
      for (;;) {
        const argAt = this.peek().at;
        args.push(this.needNum(this.parse(0), argAt));
        const sep = this.take();
        if (this.isOp(sep, ')')) break;
        if (!this.isOp(sep, ',')) this.fail(sep);
      }
    }
    if (fn === 'round') {
      if (args.length !== 2) throw new ExprError('bad_arity', at);
      const digits = smallIntLiteral(args[1]!, MAX_ROUND_DIGITS);
      if (digits === undefined) throw new ExprError('bad_round_digits', at);
      return { t: 'round', a: args[0]!, digits };
    }
    const [lo, hi] =
      fn === 'min' || fn === 'max'
        ? [2, MAX_MIN_MAX_ARGS]
        : fn === 'gcd' || fn === 'lcm'
          ? [2, 2]
          : [1, 1];
    if (args.length < lo || args.length > hi) throw new ExprError('bad_arity', at);
    return { t: 'call', fn, args };
  }
}

/** The height of the tree (a leaf has height 1), iteratively, so a deep tree cannot overflow the stack. */
function height(root: Expr): number {
  let max = 0;
  const stack: [Expr, number][] = [[root, 1]];
  while (stack.length > 0) {
    const [e, h] = stack.pop()!;
    if (h > max) max = h;
    switch (e.t) {
      case 'num':
      case 'var':
        break;
      case 'neg':
      case 'pow':
      case 'round':
      case 'not':
        stack.push([e.a, h + 1]);
        break;
      case 'bin':
      case 'cmp':
      case 'logic':
        stack.push([e.a, h + 1], [e.b, h + 1]);
        break;
      case 'call':
        for (const arg of e.args) stack.push([arg, h + 1]);
        break;
    }
  }
  return max;
}

/**
 * Parses one expression of the §6.3 grammar. `value` mode (derived values) allows arithmetic only; `constraint`
 * mode requires a comparison or a boolean combination at the top. Throws ExprError for anything else.
 */
export function parseExpression(src: string, mode: ExprMode): Expr {
  if (typeof src !== 'string' || src.trim() === '') throw new ExprError('empty', 0);
  if (src.length > MAX_EXPR_LENGTH) throw new ExprError('too_long', MAX_EXPR_LENGTH);
  const tree = new Parser(tokenize(src), mode).parseAll();
  if (mode === 'constraint' && !isBool(tree)) throw new ExprError('type_mismatch', 0);
  if (height(tree) > MAX_EXPR_DEPTH) throw new ExprError('too_deep', 0);
  return tree;
}

/** The names an expression reads, sorted and without repeats. */
export function exprNames(root: Expr): string[] {
  const names = new Set<string>();
  const stack: Expr[] = [root];
  while (stack.length > 0) {
    const e = stack.pop()!;
    switch (e.t) {
      case 'num':
        break;
      case 'var':
        names.add(e.name);
        break;
      case 'neg':
      case 'pow':
      case 'round':
      case 'not':
        stack.push(e.a);
        break;
      case 'bin':
      case 'cmp':
      case 'logic':
        stack.push(e.a, e.b);
        break;
      case 'call':
        stack.push(...e.args);
        break;
    }
  }
  return [...names].sort();
}

// ---- Evaluation -----------------------------------------------------------------------------------------------------

export type EvalRejectCode = 'division_by_zero' | 'not_integer' | 'too_large' | 'unknown_name';

/** The parameter tuple cannot be used (§6.3: e.g. a division by zero rejects the tuple). */
export class EvalRejection extends Error {
  readonly code: EvalRejectCode;
  constructor(code: EvalRejectCode) {
    super(`evaluation: ${code}`);
    this.name = 'EvalRejection';
    this.code = code;
  }
}

function integerOf(v: Rational): bigint {
  if (!isInteger(v)) throw new EvalRejection('not_integer');
  return v.n;
}

function num(e: Expr, env: ReadonlyMap<string, Rational>): Rational {
  switch (e.t) {
    case 'num':
      return e.v;
    case 'var': {
      // A Map, never a plain object: a name such as `constructor` must not resolve through a prototype.
      const v = env.get(e.name);
      if (v === undefined) throw new EvalRejection('unknown_name');
      return v;
    }
    case 'neg':
      return neg(num(e.a, env));
    case 'bin': {
      const a = num(e.a, env);
      const b = num(e.b, env);
      return e.op === '+'
        ? add(a, b)
        : e.op === '-'
          ? sub(a, b)
          : e.op === '*'
            ? mul(a, b)
            : div(a, b);
    }
    case 'pow':
      return pow(num(e.a, env), e.e);
    case 'round':
      return roundHalfAway(num(e.a, env), e.digits);
    case 'call':
      return callOf(
        e.fn,
        e.args.map((arg) => num(arg, env)),
      );
    default:
      // Boolean nodes never reach here: the parser types the tree.
      throw new EvalRejection('not_integer');
  }
}

function callOf(fn: Exclude<FunctionName, 'round'>, args: readonly Rational[]): Rational {
  if (fn === 'min') return args.reduce((m, v) => (compare(v, m) < 0 ? v : m));
  if (fn === 'max') return args.reduce((m, v) => (compare(v, m) > 0 ? v : m));
  if (fn === 'abs') return abs(args[0]!);
  if (fn === 'floor') return floor(args[0]!);
  if (fn === 'ceil') return ceil(args[0]!);
  const a = integerOf(args[0]!);
  const b = integerOf(args[1]!);
  if (fn === 'gcd') return rational(bigGcd(a, b));
  if (a === 0n || b === 0n) return rational(0n);
  const product = a * b;
  return rational((product < 0n ? -product : product) / bigGcd(a, b));
}

function compareHolds(op: CompareOp, c: -1 | 0 | 1): boolean {
  if (op === '<') return c < 0;
  if (op === '<=') return c <= 0;
  if (op === '>') return c > 0;
  if (op === '>=') return c >= 0;
  if (op === '==') return c === 0;
  return c !== 0;
}

function bool(e: Expr, env: ReadonlyMap<string, Rational>): boolean {
  if (e.t === 'cmp') return compareHolds(e.op, compare(num(e.a, env), num(e.b, env)));
  if (e.t === 'not') return !bool(e.a, env);
  if (e.t === 'logic') {
    // No short-circuit: every operand is evaluated, so a division by zero anywhere rejects the tuple.
    const a = bool(e.a, env);
    const b = bool(e.b, env);
    return e.op === 'and' ? a && b : a || b;
  }
  // Value nodes never reach here: the parser types the tree.
  throw new EvalRejection('not_integer');
}

/**
 * Evaluates a parsed expression exactly. Returns a Rational for a value expression and a boolean for a
 * constraint. Throws EvalRejection when the tuple cannot be used (division by zero, a non-integer gcd/lcm
 * argument, a value beyond the size bound, or a name the environment does not bind).
 */
export function evaluate(e: Expr, env: ReadonlyMap<string, Rational>): Rational | boolean {
  try {
    return isBool(e) ? bool(e, env) : num(e, env);
  } catch (error) {
    if (error instanceof RationalError) throw new EvalRejection(error.code);
    throw error;
  }
}
