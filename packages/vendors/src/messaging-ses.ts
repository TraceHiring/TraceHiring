// SesEmailMessaging (specs/m2-scheduling-invites.md §6.4, M2-15, M2-16, R4-6, R5-27; ADR-034; AT-M2-11, AT-M2-23):
// SES v2 SendEmail over HTTPS in ap-south-1, signed with aws4fetch, through an injected fetch.
// - Body: UTF-8 subject, text part and optional HTML part; EmailTags `org` and `msg` (ids only, R4-6, so SNS events
//   carry the org); optional configuration set (the SNS event destination). `outboundMessageId` is required for
//   invite, reminder and reschedule and must be absent for otp: an OTP has no outbound_messages row, so it carries
//   the `org` tag only and its SNS events are dropped and counted by the webhook (lead decision, B1 fix 2).
// - Recipient guard (founder gate: no real email to real people before M8): outside production only
//   `@simulator.amazonses.com` addresses and the one test inbox whose HMAC-SHA-256(testRecipientHmacKey, normalised
//   address) equals allowedTestRecipientHmac (hexEqual) are sent; anything else throws bad_recipient BEFORE any
//   network call. The repo is public, so the inbox is never in config as an address or a bare hash (R5-27).
// - Production is refused until M8 (staging only).
// - HTTP 429 → provider_throttled, 5xx and network errors → provider_unavailable (both retryable); any other 4xx →
//   provider_rejected (permanent); a 2xx without a MessageId → provider_bad_response (permanent: the message may have
//   been sent, so no retry). Errors carry codes only.
import { hexEqual, hmacSha256Hex } from '@trace/shared/invite-email';
import { AWS_REGION, signedAwsPost, validCredentials } from './messaging-aws.js';
import type { AwsCredentials, AwsFetch } from './messaging-aws.js';
import {
  MessagingConfigError,
  MessagingSendError,
  normaliseRecipientEmail,
  parseMessageV2,
} from './messaging-v2.js';
import type { ChannelMessaging, OutboundMessageV2, SendResultV2 } from './messaging-v2.js';

export const SES_REGION = AWS_REGION;
export const SES_ENDPOINT = 'https://email.ap-south-1.amazonaws.com/v2/email/outbound-emails';
/** SES sandbox send rate; 14/s once out of the sandbox (§6.3), set by the wiring. */
export const SES_DEFAULT_SEND_RATE_PER_SECOND = 1;
export const SES_SIMULATOR_RE = /^[a-z0-9._+-]{1,64}@simulator\.amazonses\.com$/;
/** The test-recipient HMAC key's minimum length in UTF-8 bytes. */
export const SES_TEST_RECIPIENT_KEY_MIN_BYTES = 32;

const SES_ENVS: readonly string[] = ['staging'];
const SIMPLE_ADDRESS = /^[a-z0-9._+-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const CONFIGURATION_SET = /^[A-Za-z0-9_-]{1,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MESSAGE_ID = /^[\x21-\x7e]{1,256}$/;

export interface SesEmailOptions extends AwsCredentials {
  traceEnv: unknown;
  /** SES_FROM_ADDRESS (a verified identity). */
  fromAddress: string;
  fetch: AwsFetch;
  /** The SigV4 signing clock. Default `() => new Date()`. */
  now?: () => Date;
  configurationSetName?: string;
  /** The Worker secret SES_TEST_RECIPIENT_… (camelCase here; the wiring reads the secret). */
  testRecipientHmacKey?: string;
  /** SES_ALLOWED_TEST_RECIPIENT_HMAC: 64 lower-case hex. Set together with testRecipientHmacKey, or neither. */
  allowedTestRecipientHmac?: string;
  sendRatePerSecond?: number;
  timeoutMs?: number;
}

function badOptions(): never {
  throw new MessagingConfigError('bad_options');
}

export class SesEmailMessaging implements ChannelMessaging {
  readonly provider = 'ses' as const;
  readonly sendRatePerSecond: number;
  readonly #credentials: AwsCredentials;
  readonly #from: string;
  readonly #fetch: AwsFetch;
  readonly #now: () => Date;
  readonly #configurationSet: string | undefined;
  readonly #testKey: string | undefined;
  readonly #testDigest: string | undefined;
  readonly #timeoutMs: number;

  constructor(options: SesEmailOptions) {
    if (typeof options !== 'object' || options === null) badOptions();
    if (typeof options.traceEnv !== 'string' || !SES_ENVS.includes(options.traceEnv)) {
      throw new MessagingConfigError('env_refused');
    }
    const {
      accessKeyId,
      secretAccessKey,
      sessionToken,
      fromAddress,
      fetch,
      now,
      configurationSetName,
      testRecipientHmacKey,
      allowedTestRecipientHmac,
      sendRatePerSecond,
      timeoutMs,
    } = options;
    if (
      !validCredentials({
        accessKeyId,
        secretAccessKey,
        ...(sessionToken === undefined ? {} : { sessionToken }),
      })
    ) {
      badOptions();
    }
    if (typeof fromAddress !== 'string' || !SIMPLE_ADDRESS.test(fromAddress)) badOptions();
    if (typeof fetch !== 'function') badOptions();
    if (now !== undefined && typeof now !== 'function') badOptions();
    if (configurationSetName !== undefined && !CONFIGURATION_SET.test(configurationSetName)) {
      badOptions();
    }
    if ((testRecipientHmacKey === undefined) !== (allowedTestRecipientHmac === undefined))
      badOptions();
    if (testRecipientHmacKey !== undefined) {
      if (
        typeof testRecipientHmacKey !== 'string' ||
        new TextEncoder().encode(testRecipientHmacKey).length < SES_TEST_RECIPIENT_KEY_MIN_BYTES
      ) {
        badOptions();
      }
      if (typeof allowedTestRecipientHmac !== 'string' || !HEX64.test(allowedTestRecipientHmac)) {
        badOptions();
      }
    }
    const rate = sendRatePerSecond ?? SES_DEFAULT_SEND_RATE_PER_SECOND;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 1000)
      badOptions();
    const timeout = timeoutMs ?? 10_000;
    if (
      typeof timeout !== 'number' ||
      !Number.isInteger(timeout) ||
      timeout < 100 ||
      timeout > 60_000
    ) {
      badOptions();
    }
    this.#credentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken === undefined ? {} : { sessionToken }),
    };
    this.#from = fromAddress;
    this.#fetch = fetch;
    this.#now = now ?? (() => new Date());
    this.#configurationSet = configurationSetName;
    this.#testKey = testRecipientHmacKey;
    this.#testDigest = allowedTestRecipientHmac;
    this.sendRatePerSecond = rate;
    this.#timeoutMs = timeout;
  }

  /** True only for a simulator address or the one HMAC-matched test inbox. Runs before any network call. */
  async #recipientAllowed(normalised: string): Promise<boolean> {
    if (SES_SIMULATOR_RE.test(normalised)) return true;
    if (this.#testKey === undefined || this.#testDigest === undefined) return false;
    if (!SIMPLE_ADDRESS.test(normalised)) return false;
    return hexEqual(await hmacSha256Hex(this.#testKey, normalised), this.#testDigest);
  }

  async send(msg: OutboundMessageV2): Promise<SendResultV2> {
    const m = parseMessageV2(msg);
    if (m.channel !== 'email') throw new MessagingSendError('channel_refused');
    const to = normaliseRecipientEmail(m.to);
    if (!(await this.#recipientAllowed(to))) throw new MessagingSendError('bad_recipient');
    if (m.subject === undefined) throw new MessagingSendError('bad_subject');
    // An OTP has no outbound_messages row: no id, no `msg` tag (its SNS events are dropped and counted, R4-6).
    // Every other purpose must carry the id (lead decision, B1 fix 2).
    if ((m.purpose === 'otp') !== (m.outboundMessageId === undefined)) {
      throw new MessagingSendError('bad_message_id');
    }

    const bodyParts: Record<string, { Data: string; Charset: 'UTF-8' }> = {
      Text: { Data: m.bodyText, Charset: 'UTF-8' },
    };
    if (m.bodyHtml !== undefined) bodyParts.Html = { Data: m.bodyHtml, Charset: 'UTF-8' };
    const request: Record<string, unknown> = {
      FromEmailAddress: this.#from,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: { Subject: { Data: m.subject, Charset: 'UTF-8' }, Body: bodyParts },
      },
      EmailTags:
        m.outboundMessageId === undefined
          ? [{ Name: 'org', Value: m.orgId }]
          : [
              { Name: 'org', Value: m.orgId },
              { Name: 'msg', Value: m.outboundMessageId },
            ],
    };
    if (this.#configurationSet !== undefined) request.ConfigurationSetName = this.#configurationSet;

    let res: Response;
    try {
      res = await signedAwsPost({
        url: SES_ENDPOINT,
        service: 'ses',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        credentials: this.#credentials,
        now: this.#now,
        fetch: this.#fetch,
        timeoutMs: this.#timeoutMs,
      });
    } catch {
      throw new MessagingSendError('provider_unavailable');
    }
    if (res.status === 429) throw new MessagingSendError('provider_throttled');
    if (res.status >= 500) throw new MessagingSendError('provider_unavailable');
    if (res.status < 200 || res.status >= 300) throw new MessagingSendError('provider_rejected');
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new MessagingSendError('provider_bad_response');
    }
    const id = (parsed as { MessageId?: unknown } | null)?.MessageId;
    if (typeof id !== 'string' || !MESSAGE_ID.test(id)) {
      throw new MessagingSendError('provider_bad_response');
    }
    return { provider: 'ses', providerMessageId: id, status: 'accepted' };
  }
}
