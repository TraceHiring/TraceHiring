// @trace/item-variants (specs/m1-test-authoring.md §6.3, ABH-7): the parameterised-variant parser and generator.
// Pure TypeScript: specs are data (check-boundaries rule 12), no I/O, no clock, no Math.random. The only async
// helpers hash a seed with Web Crypto.
export const ITEM_VARIANTS_PACKAGE = '@trace/item-variants';

export type { Rational } from './rational.js';
export {
  EvalRejection,
  ExprError,
  MAX_EXPR_DEPTH,
  MAX_EXPR_LENGTH,
  RESERVED_NAMES,
  evaluate,
  parseExpression,
} from './expr.js';
export type { CompareOp, EvalRejectCode, Expr, ExprErrorCode, ExprMode } from './expr.js';
export { RenderRejection, TemplateError, parseTemplate, renderTemplate } from './template.js';
export type { RenderRejectCode, TemplateFormat, TemplatePart, TemplateValue } from './template.js';
export {
  MAX_ATTEMPTS_PER_VARIANT,
  generateVariants,
  generateVariantsFor,
  validateParamSpec,
  variantSeed,
} from './generate.js';
export type { GenerateResult, GeneratedVariant, SpecCheck, SpecErrorReason } from './generate.js';
export { VariantDifficultyError, variantDifficulty } from './difficulty.js';
export type { VariantDifficultyErrorCode } from './difficulty.js';
