// OutboxMessagingV2 (specs/m2-scheduling-invites.md §6.4, M2-19, R5-22): the D1 demo outbox behind the v2 interface.
// dev and staging only; @example.test recipients only (the D1 guard, DEMO_RECIPIENT_RE); email only; it maps the v2
// purposes `invite` and `otp` onto D1's `kind` and refuses `reminder` and `reschedule` (D1's outbox has no such kind).
// The api's `DEMO_OUTBOX === '1'` requirement stays in the api (§6.4). The D1 code in messaging.ts is reused as is.
import { DEMO_RECIPIENT_RE, MessagingInputError, OutboxMessaging } from './messaging.js';
import type { OutboxStore } from './messaging.js';
import {
  MessagingConfigError,
  MessagingSendError,
  assertNonProductionMessagingEnv,
  parseMessageV2,
} from './messaging-v2.js';
import type {
  ChannelMessaging,
  MessagingSendErrorCode,
  OutboundMessageV2,
  SendResultV2,
} from './messaging-v2.js';

/** The demo outbox is a Durable Object write per message; it declares the load-sim rate. */
export const OUTBOX_SEND_RATE_PER_SECOND = 50;

const D1_TO_V2_CODES: Readonly<Record<string, MessagingSendErrorCode>> = {
  bad_recipient: 'bad_recipient',
  bad_subject: 'bad_subject',
  bad_body: 'bad_body',
  bad_idempotency_key: 'bad_idempotency_key',
  bad_org: 'bad_org',
};

export class OutboxMessagingV2 implements ChannelMessaging {
  readonly provider = 'outbox' as const;
  readonly sendRatePerSecond = OUTBOX_SEND_RATE_PER_SECOND;
  readonly #env: 'dev' | 'staging';
  readonly #d1: OutboxMessaging;

  constructor(traceEnv: unknown, store: OutboxStore) {
    assertNonProductionMessagingEnv(traceEnv);
    if (
      typeof store !== 'object' ||
      store === null ||
      typeof store.append !== 'function' ||
      typeof store.list !== 'function'
    ) {
      throw new MessagingConfigError('bad_options');
    }
    this.#env = traceEnv;
    this.#d1 = new OutboxMessaging(traceEnv, store);
  }

  async send(msg: OutboundMessageV2): Promise<SendResultV2> {
    assertNonProductionMessagingEnv(this.#env);
    const m = parseMessageV2(msg);
    if (m.channel !== 'email') throw new MessagingSendError('channel_refused');
    if (m.purpose !== 'invite' && m.purpose !== 'otp')
      throw new MessagingSendError('purpose_refused');
    if (!DEMO_RECIPIENT_RE.test(m.to)) throw new MessagingSendError('bad_recipient');
    if (m.subject === undefined) throw new MessagingSendError('bad_subject');
    try {
      const { id } = await this.#d1.send({
        orgId: m.orgId,
        kind: m.purpose,
        to: m.to,
        subject: m.subject,
        bodyText: m.bodyText,
        idempotencyKey: m.idempotencyKey,
      });
      return { provider: 'outbox', providerMessageId: id, status: 'accepted' };
    } catch (e) {
      if (e instanceof MessagingInputError) {
        throw new MessagingSendError(D1_TO_V2_CODES[e.code] ?? 'bad_body');
      }
      // A store failure (the Durable Object unreachable) is worth a retry.
      throw new MessagingSendError('provider_unavailable');
    }
  }
}
