// The public surface of @trace/item-variants (specs/m1-test-authoring.md §6.3): pinned so a change is deliberate.
import { describe, expect, it } from 'vitest';
import * as variants from './index.js';

describe('@trace/item-variants exports', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(variants).sort()).toEqual([
      'EvalRejection',
      'ExprError',
      'GENERATION_WORK_BUDGET',
      'ITEM_VARIANTS_PACKAGE',
      'MAX_ATTEMPTS_PER_VARIANT',
      'MAX_EXPR_DEPTH',
      'MAX_EXPR_LENGTH',
      'RESERVED_NAMES',
      'RenderRejection',
      'TUPLE_WORK_BUDGET',
      'TemplateError',
      'VariantDifficultyError',
      'evaluate',
      'generateVariants',
      'generateVariantsFor',
      'parseExpression',
      'parseTemplate',
      'renderTemplate',
      'validateParamSpec',
      'variantDifficulty',
      'variantSeed',
    ]);
  });
});
