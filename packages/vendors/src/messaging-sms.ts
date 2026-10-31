// MockSmsMessaging (specs/m2-scheduling-invites.md M2-2, §6.4): the SMS channel as a mock behind the
// MESSAGING_SMS_ENABLED flag (option `enabled`, default off); dev and staging only (production refused until a
// provider ADR, and no message of any kind before M8); +91999… reserved test numbers only; never sends.
import { PhoneChannelCore } from './messaging-phone.js';
import type { PhoneMockRecord } from './messaging-phone.js';
import { assertNonProductionMessagingEnv } from './messaging-v2.js';
import type { ChannelMessaging, OutboundMessageV2, SendResultV2 } from './messaging-v2.js';

export class MockSmsMessaging implements ChannelMessaging {
  readonly provider = 'mock_sms' as const;
  readonly sendRatePerSecond = 10;
  readonly #core: PhoneChannelCore;

  constructor(traceEnv: unknown, options: { enabled?: boolean } = {}) {
    assertNonProductionMessagingEnv(traceEnv);
    this.#core = new PhoneChannelCore(traceEnv, 'sms', options.enabled === true);
  }

  get enabled(): boolean {
    return this.#core.enabled;
  }

  /** Ids of the messages it accepted (tests); never a number or text. */
  records(): PhoneMockRecord[] {
    return this.#core.records();
  }

  send(msg: OutboundMessageV2): Promise<SendResultV2> {
    return this.#core.send(msg);
  }
}
