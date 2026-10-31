// @trace/vendors: vendor interfaces and their mocks (CLAUDE.md "Vendors behind interfaces"; specs/d1-demo-slice.md
// §5.3). Each interface arrives with the milestone that first needs it; D1 pulls LlmGrader and Messaging forward,
// M1 adds LlmDrafter (specs/m1-test-authoring.md R5-3), M2 KeyManager (KMS envelope keys for contact data;
// specs/m2-scheduling-invites.md R5-22: its interface and mock arrive with stream B1, whose exports the lead adds
// here at merge). No vendor SDK; this package imports only @trace/shared and, for SigV4 signing of the SES and KMS
// HTTPS calls, aws4fetch (ADR-034).
export const VENDOR_INTERFACES: readonly string[] = [
  'KeyManager',
  'LlmDrafter',
  'LlmGrader',
  'Messaging',
];

export type {
  DraftFormat,
  DraftRequest,
  DraftResult,
  DraftedItem,
  DraftedMcqItem,
  DraftedMcqOption,
  DraftedWrittenItem,
  LlmDrafter,
} from './llm-drafter.js';
export type { DraftRequestErrorCode } from './llm-drafter.mock.js';
export {
  DRAFT_PROMPT_VERSION,
  DraftRequestError,
  DrafterMockInProductionError,
  MOCK_DRAFTER_ADAPTER_VERSION,
  MOCK_DRAFTER_MODEL_ID,
  MOCK_DRAFTER_PROVIDER,
  MockLlmDrafter,
  assertMockDrafterEnv,
} from './llm-drafter.mock.js';

export type {
  GradeRequest,
  GradeRequestErrorCode,
  GradeResult,
  LlmGrader,
  RubricCriterion,
  RubricSnapshot,
} from './llm-grader.js';
export {
  GradeRequestError,
  MOCK_GRADER_ADAPTER_VERSION,
  MOCK_GRADER_MODEL_ID,
  MockLlmGrader,
  parseGradeRequest,
} from './llm-grader.js';
export type {
  Messaging,
  MessagingEnv,
  MessagingInputErrorCode,
  OutboundMessage,
  OutboxEntry,
  OutboxStore,
} from './messaging.js';
export {
  DEMO_RECIPIENT_RE,
  InMemoryOutboxStore,
  MessagingInputError,
  MessagingMockInProductionError,
  OutboxMessaging,
  createMessaging,
} from './messaging.js';
export type { OutboxKind } from './messaging.js';

// ---- M2 (stream B1; specs/m2-scheduling-invites.md R5-22, §5, §6.4): Messaging v2 beside the D1 Messaging ----------
export type {
  ChannelMessaging,
  EmailProviderName,
  MessageChannel,
  MessagePurpose,
  MessagingConfigErrorCode,
  MessagingProviderName,
  MessagingSendErrorCode,
  MessagingTraceEnv,
  MessagingV2,
  OutboundMessageV2,
  SendResultV2,
} from './messaging-v2.js';
export {
  MESSAGE_LIMITS,
  MessagingConfigError,
  MessagingSendError,
  assertNonProductionMessagingEnv,
  parseMessageV2,
} from './messaging-v2.js';
export type { CreateMessagingV2Options, RoutedMessagingV2 } from './messaging-factory.js';
export {
  EMAIL_PROVIDERS,
  EMAIL_PROVIDER_ENVS,
  createMessagingV2,
  parseMessagingFlag,
} from './messaging-factory.js';
export { OutboxMessagingV2 } from './messaging-outbox.js';
export type {
  LoadSimDeliveryEvent,
  LoadSimEventSink,
  LoadSimOptions,
  LoadSimScheduler,
  LoadSimStats,
} from './messaging-loadsim.js';
export {
  LOADSIM_DEFAULTS,
  LOADSIM_RECIPIENT_RE,
  LOADSIM_SEND_RATE_PER_SECOND,
  LoadSimMessaging,
  sampleLatencyMs,
  seededRandom,
} from './messaging-loadsim.js';
export type { SesEmailOptions } from './messaging-ses.js';
export {
  SES_DEFAULT_SEND_RATE_PER_SECOND,
  SES_ENDPOINT,
  SES_REGION,
  SesEmailMessaging,
} from './messaging-ses.js';
export { MockSmsMessaging } from './messaging-sms.js';
export { MockWhatsAppMessaging } from './messaging-whatsapp.js';
export type { PhoneMockRecord } from './messaging-phone.js';
export { PHONE_MOCK_IDEMPOTENCY_KEYS_MAX, RESERVED_TEST_PHONE_RE } from './messaging-phone.js';
export type { AwsFetch } from './messaging-aws.js';

// ---- M2 KeyManager (stream B1; R5-22, M2-3; build-notes "B1 first reviews" c: the key version is bound) ----------
export type {
  DataKey,
  DataKeyHandle,
  KeyManager,
  KeyManagerErrorCode,
  KeyPurpose,
} from './key-manager.js';
export {
  INITIAL_KEY_VERSION,
  KEY_PURPOSES,
  KeyManagerError,
  WRAPPED_KEY_MAX_LENGTH,
  assertKeyVersion,
} from './key-manager.js';
export { DEV_KEY_REF, DevKeyManager, devKekFromBase64 } from './key-manager-dev.js';
export type { AwsKmsKeyManagerOptions } from './key-manager-kms.js';
export { AwsKmsKeyManager, KMS_ENDPOINT, KMS_KEY_ARN_RE } from './key-manager-kms.js';
export type { CachingKeyManagerOptions } from './key-manager-cache.js';
export { CachingKeyManager, KEY_CACHE_MAX_TTL_MS } from './key-manager-cache.js';
export type { CreateKeyManagerOptions } from './key-manager-factory.js';
export { KEY_MANAGER_PROVIDER_ENVS, createKeyManager } from './key-manager-factory.js';
