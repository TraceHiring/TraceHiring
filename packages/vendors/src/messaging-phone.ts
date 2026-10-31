// The shared body of the SMS and WhatsApp mocks (specs/m2-scheduling-invites.md M2-2, §6.4): email only until ABH-83
// (DLT + WhatsApp registration) completes, so these channels exist only as mocks behind flags (default off), in dev
// and staging, for the +91999… reserved test numbers, and never send anything. A refused or disabled message names
// the failed check only. The real providers arrive with their own ADR after ABH-83.
import {
  MessagingSendError,
  assertNonProductionMessagingEnv,
  parseMessageV2,
} from './messaging-v2.js';
import type { OutboundMessageV2, SendResultV2 } from './messaging-v2.js';

/** +91 999 then 7 digits: the reserved test numbers the mocks accept. */
export const RESERVED_TEST_PHONE_RE = /^\+91999[0-9]{7}$/;
/** What a mock records per accepted message: ids only, never the number or the text. */
export interface PhoneMockRecord {
  orgId: string;
  purpose: OutboundMessageV2['purpose'];
  idempotencyKey: string;
  providerMessageId: string;
}

const RECORD_MAX = 1000;

export class PhoneChannelCore {
  readonly #env: 'dev' | 'staging';
  readonly #channel: 'sms' | 'whatsapp';
  readonly #provider: 'mock_sms' | 'mock_whatsapp';
  readonly #enabled: boolean;
  readonly #byKey = new Map<string, string>();
  readonly #records: PhoneMockRecord[] = [];

  constructor(traceEnv: unknown, channel: 'sms' | 'whatsapp', enabled: boolean) {
    assertNonProductionMessagingEnv(traceEnv);
    this.#env = traceEnv;
    this.#channel = channel;
    this.#provider = channel === 'sms' ? 'mock_sms' : 'mock_whatsapp';
    this.#enabled = enabled;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  records(): PhoneMockRecord[] {
    return this.#records.map((r) => ({ ...r }));
  }

  send(msg: OutboundMessageV2): Promise<SendResultV2> {
    try {
      assertNonProductionMessagingEnv(this.#env);
      const m = parseMessageV2(msg);
      if (m.channel !== this.#channel) throw new MessagingSendError('channel_refused');
      if (!this.#enabled) throw new MessagingSendError('channel_disabled');
      if (!RESERVED_TEST_PHONE_RE.test(m.to)) throw new MessagingSendError('bad_recipient');
      const key = JSON.stringify([m.orgId, m.idempotencyKey]);
      let id = this.#byKey.get(key);
      if (id === undefined) {
        id = `${this.#provider}-${crypto.randomUUID()}`;
        this.#byKey.set(key, id);
        this.#records.push({
          orgId: m.orgId,
          purpose: m.purpose,
          idempotencyKey: m.idempotencyKey,
          providerMessageId: id,
        });
        if (this.#records.length > RECORD_MAX) this.#records.shift();
      }
      return Promise.resolve({
        provider: this.#provider,
        providerMessageId: id,
        status: 'accepted',
      });
    } catch (e) {
      return Promise.reject(
        e instanceof Error ? e : new MessagingSendError('provider_unavailable'),
      );
    }
  }
}
