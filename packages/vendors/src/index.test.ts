import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DraftRequest, DraftResult, DraftedItem, LlmDrafter } from './index.js';
import { VENDOR_INTERFACES } from './index.js';

describe('@trace/vendors interface list', () => {
  it('lists the M1 interfaces (LlmDrafter next to D1 LlmGrader and Messaging, M1 spec R5-3)', () => {
    expect(VENDOR_INTERFACES).toEqual(['LlmDrafter', 'LlmGrader', 'Messaging']);
  });

  it('exports the LlmDrafter interface and its request and result types (M1 spec §6.4)', () => {
    expectTypeOf<LlmDrafter['draft']>().toEqualTypeOf<
      (req: DraftRequest, opts?: { signal?: AbortSignal }) => Promise<DraftResult>
    >();
    expectTypeOf<keyof DraftRequest>().toEqualTypeOf<
      'format' | 'skill' | 'difficulty' | 'count' | 'topic'
    >();
    expectTypeOf<DraftResult['items']>().toEqualTypeOf<readonly DraftedItem[]>();
    expectTypeOf<DraftedItem['format']>().toEqualTypeOf<'mcq' | 'written'>();
  });
});
