// @trace/shared/log: redacting logger, error serialiser and the ErrorReporter contract (spec §9.1, §9.2).
// redact.js is re-exported by name: its uncapped applyPatterns and canonical stay internal.
export * from './error-reporter.js';
export * from './logger.js';
export {
  CIRCULAR,
  MAX_DEPTH,
  MAX_ENTRIES,
  MAX_NODES,
  MAX_STRING,
  REDACTED,
  TRUNCATED,
  UNSUPPORTED,
  isSensitiveKey,
  redact,
  redactSerializedError,
  redactString,
} from './redact.js';
export * from './serialize-error.js';
