// Redacting JSON-lines logger (spec §9.1). No dependencies: browser, Workers and Node.
// Events must be string literals: enforced by the type below, by the `trace/log-event-literal`
// ESLint rule, and at runtime (a non-matching event becomes `log.invalid_event`).
import { redact, redactSerializedError, redactString } from './redact.js';
import { serializeError } from './serialize-error.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Resolves to `never` for a widened `string`, so only literal events type-check. */
export type LiteralEvent<E extends string> = string extends E ? never : E;

export interface LogOptions {
  requestId?: string;
  orgId?: string;
  err?: unknown;
}

export type LogMethod = <E extends string>(
  event: LiteralEvent<E>,
  data?: unknown,
  opts?: LogOptions,
) => void;

export type Logger = Record<LogLevel, LogMethod>;

export interface LoggerConfig {
  service: string;
  version: string;
  sink?: (line: string) => void;
  now?: () => Date;
}

const EVENT = /^[a-z0-9_.]{1,64}$/;
const VERSION = /^[0-9a-f]{7,40}$|^dev$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Valid only as a short contract-shaped string that the redactor would leave untouched. */
const safeEvent = (event: unknown): string =>
  typeof event === 'string' && EVENT.test(event) && redactString(event) === event
    ? event
    : 'log.invalid_event';

const defaultSink = (line: string): void => {
  console.log(line);
};

export const createLogger = (config: LoggerConfig): Logger => {
  if (!VERSION.test(config.version)) throw new Error('createLogger: invalid version');
  if (!config.service) throw new Error('createLogger: service is required');
  const sink = config.sink ?? defaultSink;
  const now = config.now ?? (() => new Date());

  const write = (level: LogLevel, event: unknown, data: unknown, opts: LogOptions = {}): void => {
    try {
      const line: Record<string, unknown> = {
        ts: now().toISOString(),
        level,
        service: config.service,
        version: config.version,
        event: safeEvent(event),
      };
      if (opts.requestId !== undefined && UUID.test(opts.requestId)) {
        line.requestId = opts.requestId;
      }
      if (opts.orgId !== undefined && UUID.test(opts.orgId)) line.orgId = opts.orgId;
      if (data !== undefined || opts.err !== undefined) {
        const redacted = redact(data);
        const body =
          redacted !== null && typeof redacted === 'object' && !Array.isArray(redacted)
            ? (redacted as Record<string, unknown>)
            : data === undefined
              ? {}
              : { value: redacted };
        line.data =
          opts.err === undefined
            ? body
            : { ...body, error: redactSerializedError(serializeError(opts.err)) };
      }
      sink(JSON.stringify(line));
    } catch {
      // Logging must never throw into the caller.
    }
  };

  const method =
    (level: LogLevel): LogMethod =>
    (event, data, opts) =>
      write(level, event, data, opts);

  return {
    debug: method('debug'),
    info: method('info'),
    warn: method('warn'),
    error: method('error'),
  };
};
