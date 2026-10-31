// createMessagingV2 (specs/m2-scheduling-invites.md §6.4, M2-2, R5-22; build-notes 2026-10-31 "Wave 1 lead part"
// d, g): picks the email adapter from MESSAGING_EMAIL_PROVIDER (`outbox | loadsim | ses`), refuses any adapter not
// allowed in TRACE_ENV, and routes `sms` / `whatsapp` messages to their mocks only when MESSAGING_SMS_ENABLED /
// MESSAGING_WHATSAPP_ENABLED are on (default off). The env × provider matrix:
//   outbox  dev, staging   (the api also requires DEMO_OUTBOX === '1', §6.4)
//   loadsim dev, staging   (CI runs as dev)
//   ses     staging        (production after M8)
// Founder gate: production refuses every provider and every mock until M8 (no real message before M8).
import type { OutboxStore } from './messaging.js';
import { LoadSimMessaging } from './messaging-loadsim.js';
import type { LoadSimOptions } from './messaging-loadsim.js';
import { OutboxMessagingV2 } from './messaging-outbox.js';
import { SesEmailMessaging } from './messaging-ses.js';
import type { SesEmailOptions } from './messaging-ses.js';
import { MockSmsMessaging } from './messaging-sms.js';
import { MockWhatsAppMessaging } from './messaging-whatsapp.js';
import {
  MessagingConfigError,
  MessagingSendError,
  assertNonProductionMessagingEnv,
  parseMessageV2,
} from './messaging-v2.js';
import type {
  ChannelMessaging,
  EmailProviderName,
  MessageChannel,
  MessagingV2,
  OutboundMessageV2,
  SendResultV2,
} from './messaging-v2.js';

export const EMAIL_PROVIDERS: readonly EmailProviderName[] = ['outbox', 'loadsim', 'ses'];
/** Where each email provider may run (production: none before M8). */
export const EMAIL_PROVIDER_ENVS: Readonly<Record<EmailProviderName, readonly string[]>> = {
  outbox: ['dev', 'staging'],
  loadsim: ['dev', 'staging'],
  ses: ['staging'],
};

export interface CreateMessagingV2Options {
  /** TRACE_ENV. */
  traceEnv: unknown;
  /** MESSAGING_EMAIL_PROVIDER. */
  emailProvider: unknown;
  /** MESSAGING_SMS_ENABLED (parse with parseMessagingFlag). Default false. */
  smsEnabled?: boolean;
  /** MESSAGING_WHATSAPP_ENABLED (parse with parseMessagingFlag). Default false. */
  whatsappEnabled?: boolean;
  outbox?: { store: OutboxStore };
  /** With emailProvider 'loadsim', `scheduler` is required (bad_options without it; B1 fix 5). */
  loadSim?: LoadSimOptions;
  ses?: Omit<SesEmailOptions, 'traceEnv'>;
}

/** The routed Messaging v2 the api and the jobs consumer hold. */
export interface RoutedMessagingV2 extends MessagingV2 {
  readonly emailProvider: EmailProviderName;
  /** The send rate the channel's adapter declares (0 for a channel that is off). */
  sendRatePerSecond(channel: MessageChannel): number;
}

/** Reads a `0` / `1` flag (MESSAGING_SMS_ENABLED, MESSAGING_WHATSAPP_ENABLED); unset is off; anything else throws. */
export function parseMessagingFlag(value: unknown): boolean {
  if (value === undefined || value === '0') return false;
  if (value === '1') return true;
  throw new MessagingConfigError('bad_options');
}

function emailAdapter(
  env: 'dev' | 'staging',
  provider: EmailProviderName,
  o: CreateMessagingV2Options,
) {
  switch (provider) {
    case 'outbox':
      if (o.outbox === undefined) throw new MessagingConfigError('bad_options');
      return new OutboxMessagingV2(env, o.outbox.store);
    case 'loadsim': {
      // A Worker cancels plain timers once the handler returns, so the wiring must pass a scheduler (the jobs
      // wiring backs it with ctx.waitUntil). The class's setTimeout default serves direct (test) construction only.
      const loadSim: unknown = o.loadSim;
      if (typeof loadSim !== 'object' || loadSim === null) {
        throw new MessagingConfigError('bad_options');
      }
      const scheduler = (loadSim as { scheduler?: unknown }).scheduler;
      if (
        typeof scheduler !== 'object' ||
        scheduler === null ||
        typeof (scheduler as { schedule?: unknown }).schedule !== 'function'
      ) {
        throw new MessagingConfigError('bad_options');
      }
      return new LoadSimMessaging(env, loadSim as LoadSimOptions);
    }
    case 'ses':
      if (o.ses === undefined) throw new MessagingConfigError('bad_options');
      return new SesEmailMessaging({ ...o.ses, traceEnv: env });
  }
}

const flag = (v: unknown): boolean => {
  if (v === undefined) return false;
  if (typeof v !== 'boolean') throw new MessagingConfigError('bad_options');
  return v;
};

export function createMessagingV2(options: CreateMessagingV2Options): RoutedMessagingV2 {
  if (typeof options !== 'object' || options === null)
    throw new MessagingConfigError('bad_options');
  const { traceEnv, emailProvider } = options;
  assertNonProductionMessagingEnv(traceEnv);
  if (
    typeof emailProvider !== 'string' ||
    !(EMAIL_PROVIDERS as readonly string[]).includes(emailProvider)
  ) {
    throw new MessagingConfigError('unknown_provider');
  }
  const provider = emailProvider as EmailProviderName;
  if (!EMAIL_PROVIDER_ENVS[provider].includes(traceEnv))
    throw new MessagingConfigError('provider_refused');
  const smsEnabled = flag(options.smsEnabled);
  const whatsappEnabled = flag(options.whatsappEnabled);
  const channels: Record<MessageChannel, ChannelMessaging | null> = {
    email: emailAdapter(traceEnv, provider, options),
    sms: smsEnabled ? new MockSmsMessaging(traceEnv, { enabled: true }) : null,
    whatsapp: whatsappEnabled ? new MockWhatsAppMessaging(traceEnv, { enabled: true }) : null,
  };
  return {
    emailProvider: provider,
    sendRatePerSecond: (channel) => channels[channel]?.sendRatePerSecond ?? 0,
    send: (msg: OutboundMessageV2): Promise<SendResultV2> => {
      try {
        assertNonProductionMessagingEnv(traceEnv);
        const m = parseMessageV2(msg);
        const adapter = channels[m.channel];
        if (adapter === null) throw new MessagingSendError('channel_disabled');
        return adapter.send(m);
      } catch (e) {
        return Promise.reject(
          e instanceof Error ? e : new MessagingSendError('provider_unavailable'),
        );
      }
    },
  };
}
