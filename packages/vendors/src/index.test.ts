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

// M2 stream B1 (specs/m2-scheduling-invites.md R5-22, §6.4; lead merge): the api and jobs wiring import the Messaging v2
// factory, the KeyManager factory and their error types from the package root only.
describe('@trace/vendors M2 exports (Messaging v2 and KeyManager)', () => {
  it('re-exports the two factories, and both refuse production for every mock (fail closed)', () => {
    expect(typeof vendors.createMessagingV2).toBe('function');
    expect(typeof vendors.createKeyManager).toBe('function');
    expect(() =>
      vendors.createMessagingV2({ traceEnv: 'production', emailProvider: 'outbox' } as never),
    ).toThrow();
    expect(() =>
      vendors.createKeyManager({ traceEnv: 'production', provider: 'dev' } as never),
    ).toThrow(vendors.KeyManagerError);
  });

  it('re-exports the adapters, error classes and constants the wiring and tests need', () => {
    for (const cls of [
      vendors.OutboxMessagingV2,
      vendors.LoadSimMessaging,
      vendors.SesEmailMessaging,
      vendors.MockSmsMessaging,
      vendors.MockWhatsAppMessaging,
      vendors.DevKeyManager,
      vendors.AwsKmsKeyManager,
      vendors.CachingKeyManager,
      vendors.MessagingSendError,
      vendors.MessagingConfigError,
      vendors.KeyManagerError,
    ]) {
      expect(typeof cls).toBe('function');
    }
    expect(vendors.EMAIL_PROVIDERS).toEqual(['outbox', 'loadsim', 'ses']);
    expect(vendors.KEY_PURPOSES).toEqual(['contacts', 'bidx']);
    expect(vendors.KEY_CACHE_MAX_TTL_MS).toBe(300_000);
    expect(typeof vendors.devKekFromBase64).toBe('function');
    expect(typeof vendors.parseMessagingFlag).toBe('function');
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
