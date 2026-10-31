// @trace/vendors: vendor interfaces and their mocks (CLAUDE.md "Vendors behind interfaces"; specs/d1-demo-slice.md
// §5.3). Each interface arrives with the milestone that first needs it; D1 pulls LlmGrader and Messaging forward,
// M1 adds LlmDrafter (specs/m1-test-authoring.md R5-3), M2 KeyManager (KMS envelope keys for contact data;
// specs/m2-scheduling-invites.md R5-22: its interface and mock arrive with stream B1, whose exports the lead adds
// here at merge). No vendor SDK; this package imports only @trace/shared.
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
