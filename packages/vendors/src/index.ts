// @trace/vendors: vendor interfaces and their mocks (CLAUDE.md "Vendors behind interfaces"; specs/d1-demo-slice.md
// §5.3). Each interface arrives with the milestone that first needs it; D1 pulls LlmGrader and Messaging forward.
// No vendor SDK; this package imports only @trace/shared.
export const VENDOR_INTERFACES: readonly string[] = ['LlmGrader', 'Messaging'];

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
