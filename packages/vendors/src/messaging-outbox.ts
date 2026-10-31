// OutboxMessagingV2 (specs/m2-scheduling-invites.md §6.4, M2-19, R5-22): the D1 demo outbox behind the v2 interface.
// dev and staging only; @example.test recipients only (the D1 guard, DEMO_RECIPIENT_RE); email only. It accepts all
// four purposes `invite | reminder | reschedule | otp` and stores kind = purpose (lead decision, B1 fix 1: drive
// messages go through the outbox in dev and staging, and a reschedule carries the new link local E2E reads). It
// validates with parseMessageV2 and appends to the OutboxStore itself: D1's OutboxMessaging.send keeps its own
// `invite | otp` validation unchanged. The api's `DEMO_OUTBOX === '1'` requirement stays in the api (§6.4).
import { DEMO_RECIPIENT_RE } from './messaging.js';
import type { OutboxStore } from './messaging.js';
import {
  MessagingConfigError,
  MessagingSendError,
  assertNonProductionMessagingEnv,
  parseMessageV2,
} from './messaging-v2.js';
import type { ChannelMessaging, OutboundMessageV2, SendResultV2 } from './messaging-v2.js';

/** The demo outbox is a Durable Object write per message; it declares the load-sim rate. */
export const OUTBOX_SEND_RATE_PER_SECOND = 50;

export class OutboxMessagingV2 implements ChannelMessaging {
  readonly provider = 'outbox' as const;
  readonly sendRatePerSecond = OUTBOX_SEND_RATE_PER_SECOND;
  readonly #env: 'dev' | 'staging';
  readonly #store: OutboxStore;

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
    this.#store = store;
  }

  async send(msg: OutboundMessageV2): Promise<SendResultV2> {
    assertNonProductionMessagingEnv(this.#env);
    const m = parseMessageV2(msg);
    if (m.channel !== 'email') throw new MessagingSendError('channel_refused');
    if (!DEMO_RECIPIENT_RE.test(m.to)) throw new MessagingSendError('bad_recipient');
    if (m.subject === undefined) throw new MessagingSendError('bad_subject');
    let id: string;
    try {
      ({ id } = await this.#store.append({
        orgId: m.orgId,
        kind: m.purpose,
        to: m.to,
        subject: m.subject,
        bodyText: m.bodyText,
        idempotencyKey: m.idempotencyKey,
      }));
    } catch {
      // A store failure (the Durable Object unreachable) is worth a retry.
      throw new MessagingSendError('provider_unavailable');
    }
    if (typeof id !== 'string' || id.length === 0) {
      throw new MessagingSendError('provider_bad_response');
    }
    return { provider: 'outbox', providerMessageId: id, status: 'accepted' };
  }
}
