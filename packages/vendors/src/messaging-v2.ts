// Messaging v2 (specs/m2-scheduling-invites.md §5, §6.3, §6.4, M2-2, R4-6, R5-22; build-notes 2026-10-31 "Wave 1
// lead part" c, d): the interface invites, reminders, reschedules and OTP emails go through in M2. It lives beside the
// D1 Messaging in messaging.ts, which stays unchanged until its last caller moves (decision d).
// - `purpose` replaces D1's `kind`; `channel` is new; the result is `{ provider, providerMessageId, status }`.
// - `outboundMessageId` is the outbound_messages.id (ids only); the SES adapter sends it as the `msg` tag (R4-6).
// - Errors carry codes only, never an address, subject, body or key: MessagingSendError {code, retryable} for a send,
//   MessagingConfigError {code} for construction.
// - Founder gate: no real message before M8. Every adapter and the factory refuse 'production' (and any value other
//   than 'dev' or 'staging') through assertNonProductionMessagingEnv.

export type MessagingTraceEnv = 'dev' | 'staging' | 'production';
export type MessageChannel = 'email' | 'sms' | 'whatsapp';
export type MessagePurpose = 'invite' | 'reminder' | 'reschedule' | 'otp';
/** MESSAGING_EMAIL_PROVIDER. */
export type EmailProviderName = 'outbox' | 'loadsim' | 'ses';
/** Recorded as outbound_messages.provider. */
export type MessagingProviderName = EmailProviderName | 'mock_sms' | 'mock_whatsapp';

export interface OutboundMessageV2 {
  orgId: string;
  channel: MessageChannel;
  purpose: MessagePurpose;
  to: string;
  subject?: string;
  bodyText: string;
  bodyHtml?: string;
  /** `${outbound_messages.idempotency_key}:${claim_id}` for drive messages (R3-6). */
  idempotencyKey: string;
  /** outbound_messages.id (ids only; the SES `msg` tag, R4-6). */
  outboundMessageId?: string;
}

export interface SendResultV2 {
  provider: MessagingProviderName;
  providerMessageId: string;
  status: 'accepted';
}

export interface MessagingV2 {
  send(msg: OutboundMessageV2): Promise<SendResultV2>;
}

/** An adapter for one channel: it also declares the send rate it can carry (§6.3 rate limit per org and channel). */
export interface ChannelMessaging extends MessagingV2 {
  readonly provider: MessagingProviderName;
  readonly sendRatePerSecond: number;
}

export type MessagingSendErrorCode =
  // the message (never retryable)
  | 'not_object'
  | 'unknown_key'
  | 'missing_key'
  | 'bad_org'
  | 'bad_channel'
  | 'bad_purpose'
  | 'bad_recipient'
  | 'bad_subject'
  | 'bad_body'
  | 'bad_html'
  | 'bad_idempotency_key'
  | 'bad_message_id'
  // routing (never retryable)
  | 'channel_refused'
  | 'channel_disabled'
  | 'purpose_refused'
  // the provider
  | 'provider_throttled'
  | 'provider_unavailable'
  | 'provider_rejected'
  | 'provider_bad_response';

const RETRYABLE: ReadonlySet<MessagingSendErrorCode> = new Set([
  'provider_throttled',
  'provider_unavailable',
]);

/** A failed send. `retryable` says whether the consumer should retry (Queue retry with backoff, §6.3). */
export class MessagingSendError extends Error {
  readonly code: MessagingSendErrorCode;
  readonly retryable: boolean;
  constructor(code: MessagingSendErrorCode) {
    super(`messaging: ${code}`);
    this.name = 'MessagingSendError';
    this.code = code;
    this.retryable = RETRYABLE.has(code);
  }
}

export type MessagingConfigErrorCode =
  'env_refused' | 'provider_refused' | 'unknown_provider' | 'bad_options';

/** A refused construction (environment, provider or options). Names the failed check only. */
export class MessagingConfigError extends Error {
  readonly code: MessagingConfigErrorCode;
  constructor(code: MessagingConfigErrorCode) {
    super(`messaging: ${code}`);
    this.name = 'MessagingConfigError';
    this.code = code;
  }
}

const NON_PRODUCTION_ENVS: readonly string[] = ['dev', 'staging'];

/**
 * Throws MessagingConfigError('env_refused') unless `env` is exactly 'dev' or 'staging' ('production', undefined,
 * '' and every other value refused). Founder gate: no message of any kind is sent from production before M8.
 */
export function assertNonProductionMessagingEnv(env: unknown): asserts env is 'dev' | 'staging' {
  if (typeof env !== 'string' || !NON_PRODUCTION_ENVS.includes(env)) {
    throw new MessagingConfigError('env_refused');
  }
}

export const MESSAGE_LIMITS = {
  to: 254,
  subject: 200,
  bodyText: 20_000,
  bodyHtml: 100_000,
  idempotencyKey: 200,
} as const;

const MESSAGE_KEYS: readonly string[] = [
  'orgId',
  'channel',
  'purpose',
  'to',
  'subject',
  'bodyText',
  'bodyHtml',
  'idempotencyKey',
  'outboundMessageId',
];
const REQUIRED_KEYS: readonly string[] = [
  'orgId',
  'channel',
  'purpose',
  'to',
  'bodyText',
  'idempotencyKey',
];
const CHANNELS: readonly string[] = ['email', 'sms', 'whatsapp'];
const PURPOSES: readonly string[] = ['invite', 'reminder', 'reschedule', 'otp'];
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Printable, one line, no control characters (subject, recipient, idempotency key). */
const PRINTABLE_LINE = /^[^\p{Cc}\p{Zl}\p{Zp}]+$/u;
/** Bodies may hold line breaks and tabs but no other control characters. */
const BODY_TEXT = /^[^\p{Cc}]*$/u;
const stripBodyBreaks = (s: string): string => s.replace(/[\r\n\t]/g, '');

const line = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= max &&
  PRINTABLE_LINE.test(value);
const body = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= max &&
  BODY_TEXT.test(stripBodyBreaks(value));

/**
 * Validates a v2 message; throws MessagingSendError (never retryable) naming the failed check. Channel-specific
 * recipient rules are each adapter's own; here `to` is only a bounded single line.
 */
export function parseMessageV2(raw: unknown): OutboundMessageV2 {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MessagingSendError('not_object');
  }
  const m = raw as Record<string, unknown>;
  for (const key of Object.keys(m)) {
    if (!MESSAGE_KEYS.includes(key)) throw new MessagingSendError('unknown_key');
  }
  for (const key of REQUIRED_KEYS) {
    if (m[key] === undefined) throw new MessagingSendError('missing_key');
  }
  // Each field is read once; only the locals are checked and used.
  const {
    orgId,
    channel,
    purpose,
    to,
    subject,
    bodyText,
    bodyHtml,
    idempotencyKey,
    outboundMessageId,
  } = m;
  if (typeof orgId !== 'string' || !UUID_RE.test(orgId)) throw new MessagingSendError('bad_org');
  if (typeof channel !== 'string' || !CHANNELS.includes(channel)) {
    throw new MessagingSendError('bad_channel');
  }
  if (typeof purpose !== 'string' || !PURPOSES.includes(purpose)) {
    throw new MessagingSendError('bad_purpose');
  }
  if (!line(to, MESSAGE_LIMITS.to)) throw new MessagingSendError('bad_recipient');
  if (subject !== undefined && !line(subject, MESSAGE_LIMITS.subject)) {
    throw new MessagingSendError('bad_subject');
  }
  if (!body(bodyText, MESSAGE_LIMITS.bodyText)) throw new MessagingSendError('bad_body');
  if (bodyHtml !== undefined && !body(bodyHtml, MESSAGE_LIMITS.bodyHtml)) {
    throw new MessagingSendError('bad_html');
  }
  if (!line(idempotencyKey, MESSAGE_LIMITS.idempotencyKey)) {
    throw new MessagingSendError('bad_idempotency_key');
  }
  if (
    outboundMessageId !== undefined &&
    (typeof outboundMessageId !== 'string' || !UUID_RE.test(outboundMessageId))
  ) {
    throw new MessagingSendError('bad_message_id');
  }
  const out: OutboundMessageV2 = {
    orgId,
    channel: channel as MessageChannel,
    purpose: purpose as MessagePurpose,
    to,
    bodyText,
    idempotencyKey,
  };
  if (subject !== undefined) out.subject = subject;
  if (bodyHtml !== undefined) out.bodyHtml = bodyHtml;
  if (outboundMessageId !== undefined) out.outboundMessageId = outboundMessageId;
  return out;
}

/** trim → NFKC → lower case (the M2-4 first steps; vendors cannot import @trace/pii-crypto). */
export const normaliseRecipientEmail = (to: string): string =>
  to.trim().normalize('NFKC').toLowerCase();
