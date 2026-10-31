import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  DraftRequest,
  DraftRequestErrorCode,
  DraftResult,
  DraftedItem,
  LlmDrafter,
} from './index.js';
import * as vendors from './index.js';
import { VENDOR_INTERFACES } from './index.js';

describe('@trace/vendors MockLlmDrafter exports (M1 spec R5-3, R5-52 g)', () => {
  it('re-exports the mock drafter, its guard, errors and the constants the database fixtures use', () => {
    expect(new vendors.MockLlmDrafter('dev')).toBeInstanceOf(vendors.MockLlmDrafter);
    expect(() => new vendors.MockLlmDrafter('production')).toThrow(
      vendors.DrafterMockInProductionError,
    );
    expect(typeof vendors.assertMockDrafterEnv).toBe('function');
    expect(typeof vendors.DraftRequestError).toBe('function');
    expect(vendors.MOCK_DRAFTER_PROVIDER).toBe('mock');
    expect(vendors.MOCK_DRAFTER_MODEL_ID).toBe('mock-drafter-v1');
    expect(vendors.DRAFT_PROMPT_VERSION).toBe('draft-v1');
    expect(typeof vendors.MOCK_DRAFTER_ADAPTER_VERSION).toBe('string');
    expectTypeOf<DraftRequestErrorCode>().toBeString();
  });
});

describe('@trace/vendors interface list', () => {
  it('lists the M1 interfaces (LlmDrafter next to D1 LlmGrader and Messaging, M1 spec R5-3) and M2 KeyManager (R5-22)', () => {
    expect(VENDOR_INTERFACES).toEqual(['KeyManager', 'LlmDrafter', 'LlmGrader', 'Messaging']);
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
