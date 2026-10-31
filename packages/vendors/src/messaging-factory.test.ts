// AT-M2-11 and AT-M2-23: createMessagingV2 (specs/m2-scheduling-invites.md §6.4, M2-2, R5-22; build-notes 2026-10-31
// "Wave 1 lead part" d, g). The env × provider matrix, SMS and WhatsApp off by default, production refuses every
// provider and every mock until M8 (founder gate), the Messaging v2 shape, and the outbox / SMS / WhatsApp adapters'
// recipient guards. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { InMemoryOutboxStore } from './messaging.js';
import { createMessagingV2, parseMessagingFlag } from './messaging-factory.js';
import type { CreateMessagingV2Options } from './messaging-factory.js';
import { LoadSimMessaging, seededRandom } from './messaging-loadsim.js';
import { OutboxMessagingV2 } from './messaging-outbox.js';
import { SesEmailMessaging } from './messaging-ses.js';
import { MockSmsMessaging } from './messaging-sms.js';
import { MockWhatsAppMessaging } from './messaging-whatsapp.js';
import {
  MessagingConfigError,
  MessagingSendError,
  assertNonProductionMessagingEnv,
} from './messaging-v2.js';
import type { MessagingV2, OutboundMessageV2 } from './messaging-v2.js';
import {
  FIXED_DATE,
  jsonResponse,
  recordingFetch,
  testCredentials,
} from './messaging-sigv4.test-helpers.js';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const MSG_1 = '00000000-0000-4000-8000-00000000c0de';

const adapterOptions = () => ({
  outbox: { store: new InMemoryOutboxStore() },
  loadSim: {
    sink: { emit: () => undefined },
    random: seededRandom(1),
    scheduler: { schedule: (_d: number, fn: () => void) => fn() },
    transientFailureRate: 0,
    permanentFailureRate: 0,
  },
  ses: {
    ...testCredentials(),
    fromAddress: 'invites@mail.example.test',
    fetch: recordingFetch(() => jsonResponse(200, { MessageId: 'ses-1' })).fetch,
    now: () => FIXED_DATE,
  },
});

const create = (
  traceEnv: unknown,
  emailProvider: unknown,
  patch: Partial<CreateMessagingV2Options> = {},
) => createMessagingV2({ traceEnv, emailProvider, ...adapterOptions(), ...patch });

const configError = (fn: () => unknown): MessagingConfigError => {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(MessagingConfigError);
  return caught as MessagingConfigError;
};

const email = (patch: Partial<OutboundMessageV2> = {}): OutboundMessageV2 => ({
  orgId: ORG_A,
  channel: 'email',
  purpose: 'invite',
  to: 'candidate.1@example.test',
  subject: 'Invitation [synthetic]',
  bodyText: 'Synthetic body.',
  idempotencyKey: `${MSG_1}:claim-1`,
  outboundMessageId: MSG_1,
  ...patch,
});

describe('createMessagingV2: env × provider matrix (§6.4)', () => {
  const matrix: [string, string, 'ok' | 'provider_refused' | 'env_refused'][] = [
    ['dev', 'outbox', 'ok'],
    ['dev', 'loadsim', 'ok'],
    ['dev', 'ses', 'provider_refused'],
    ['staging', 'outbox', 'ok'],
    ['staging', 'loadsim', 'ok'],
    ['staging', 'ses', 'ok'],
    ['production', 'outbox', 'env_refused'],
    ['production', 'loadsim', 'env_refused'],
    ['production', 'ses', 'env_refused'],
  ];
  it.each(matrix)('%s × %s → %s', (env, provider, outcome) => {
    if (outcome === 'ok') {
      const m = create(env, provider);
      expect(m.emailProvider).toBe(provider);
    } else {
      expect(configError(() => create(env, provider)).code).toBe(outcome);
    }
  });

  it.each([undefined, '', 'Production', 'prod', 'test', 'preview', 42])(
    'refuses traceEnv %j',
    (env) => {
      expect(configError(() => create(env, 'loadsim')).code).toBe('env_refused');
    },
  );

  it.each([undefined, '', 'smtp', 'SES', 'sns', 'mock'])(
    'refuses provider %j as unknown_provider',
    (p) => {
      expect(configError(() => create('dev', p)).code).toBe('unknown_provider');
    },
  );

  it('refuses a chosen provider whose options are missing', () => {
    expect(
      configError(() => createMessagingV2({ traceEnv: 'dev', emailProvider: 'outbox' })).code,
    ).toBe('bad_options');
    expect(
      configError(() => createMessagingV2({ traceEnv: 'dev', emailProvider: 'loadsim' })).code,
    ).toBe('bad_options');
    expect(
      configError(() => createMessagingV2({ traceEnv: 'staging', emailProvider: 'ses' })).code,
    ).toBe('bad_options');
  });
});

describe('production refuses every provider and every mock until M8 (founder gate)', () => {
  it('createMessagingV2 refuses production for every provider and flag combination', () => {
    for (const provider of ['outbox', 'loadsim', 'ses']) {
      for (const smsEnabled of [false, true]) {
        for (const whatsappEnabled of [false, true]) {
          expect(
            configError(() => create('production', provider, { smsEnabled, whatsappEnabled })).code,
          ).toBe('env_refused');
        }
      }
    }
  });

  it('every adapter constructor refuses production on its own', () => {
    const o = adapterOptions();
    expect(configError(() => new OutboxMessagingV2('production', o.outbox.store)).code).toBe(
      'env_refused',
    );
    expect(configError(() => new LoadSimMessaging('production', o.loadSim)).code).toBe(
      'env_refused',
    );
    expect(
      configError(() => new SesEmailMessaging({ traceEnv: 'production', ...o.ses })).code,
    ).toBe('env_refused');
    expect(configError(() => new MockSmsMessaging('production', { enabled: true })).code).toBe(
      'env_refused',
    );
    expect(configError(() => new MockWhatsAppMessaging('production', { enabled: true })).code).toBe(
      'env_refused',
    );
  });

  it('the shared guard allows exactly dev and staging', () => {
    expect(() => assertNonProductionMessagingEnv('dev')).not.toThrow();
    expect(() => assertNonProductionMessagingEnv('staging')).not.toThrow();
    for (const env of ['production', undefined, null, '', ' dev', 'DEV', {}]) {
      expect(() => assertNonProductionMessagingEnv(env)).toThrow(MessagingConfigError);
    }
  });
});

describe('Messaging v2 shape (R5-22)', () => {
  it.each(['outbox', 'loadsim', 'ses'])(
    '%s: send → { provider, providerMessageId, status: accepted }',
    async (p) => {
      const m: MessagingV2 = create('staging', p);
      const to = p === 'ses' ? 'success@simulator.amazonses.com' : 'candidate.1@example.test';
      const out = await m.send(email({ to }));
      expect(Object.keys(out).sort()).toEqual(['provider', 'providerMessageId', 'status']);
      expect(out.provider).toBe(p);
      expect(out.status).toBe('accepted');
      expect(out.providerMessageId.length).toBeGreaterThan(0);
    },
  );

  it.each([
    [{ orgId: 'not-a-uuid' }, 'bad_org'],
    [{ channel: 'pigeon' }, 'bad_channel'],
    [{ purpose: 'marketing' }, 'bad_purpose'],
    [{ to: '' }, 'bad_recipient'],
    [{ subject: 'line\nbreak' }, 'bad_subject'],
    [{ bodyText: '' }, 'bad_body'],
    [{ bodyHtml: '' }, 'bad_html'],
    [{ idempotencyKey: '' }, 'bad_idempotency_key'],
    [{ outboundMessageId: 'x y' }, 'bad_message_id'],
    [{ extra: 1 }, 'unknown_key'],
  ])('validates the message: %j → %s (codes only, not retryable)', async (patch, code) => {
    const m = create('dev', 'loadsim');
    const e = await m
      .send({ ...email(), ...(patch as object) } as OutboundMessageV2)
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(MessagingSendError);
    expect((e as MessagingSendError).code).toBe(code);
    expect((e as MessagingSendError).retryable).toBe(false);
    expect((e as Error).message).toBe(`messaging: ${code}`);
  });

  it('refuses a non-object message', async () => {
    const e = await create('dev', 'loadsim')
      .send(null as never)
      .catch((err: unknown) => err);
    expect((e as MessagingSendError).code).toBe('not_object');
  });

  it('declares a send rate per channel', () => {
    expect(create('dev', 'loadsim').sendRatePerSecond('email')).toBe(50);
    expect(create('staging', 'ses').sendRatePerSecond('email')).toBe(1);
    expect(create('dev', 'loadsim').sendRatePerSecond('sms')).toBe(0);
  });
});

describe('SMS and WhatsApp: mocks behind flags, off by default (M2-2)', () => {
  const sms = (patch: Partial<OutboundMessageV2> = {}) =>
    email({ channel: 'sms', to: '+919990000001', subject: undefined as never, ...patch });

  it('are off by default: an sms or whatsapp message is refused with channel_disabled', async () => {
    const m = create('dev', 'loadsim');
    const { subject: _s, ...noSubject } = sms();
    for (const channel of ['sms', 'whatsapp'] as const) {
      const e = await m.send({ ...noSubject, channel }).catch((err: unknown) => err);
      expect(e).toBeInstanceOf(MessagingSendError);
      expect((e as MessagingSendError).code).toBe('channel_disabled');
    }
  });

  it('when enabled, accept only +91999 reserved test numbers and never send', async () => {
    const m = create('staging', 'loadsim', { smsEnabled: true, whatsappEnabled: true });
    const { subject: _s, ...base } = sms();
    for (const channel of ['sms', 'whatsapp'] as const) {
      const ok = await m.send({ ...base, channel });
      expect(ok.provider).toBe(channel === 'sms' ? 'mock_sms' : 'mock_whatsapp');
      expect(ok.status).toBe('accepted');
      for (const to of [
        '+919876543210',
        '+14155550100',
        '9990000001',
        '+9199900000011',
        '+91999000000',
      ]) {
        const e = await m.send({ ...base, channel, to }).catch((err: unknown) => err);
        expect((e as MessagingSendError).code).toBe('bad_recipient');
      }
    }
  });

  it('the mock classes are off unless enabled, and refuse an email message', async () => {
    const { subject: _s, ...base } = sms();
    const off = new MockSmsMessaging('dev');
    expect(((await off.send(base).catch((e: unknown) => e)) as MessagingSendError).code).toBe(
      'channel_disabled',
    );
    const offWa = new MockWhatsAppMessaging('dev', { enabled: false });
    expect(
      (
        (await offWa
          .send({ ...base, channel: 'whatsapp' })
          .catch((e: unknown) => e)) as MessagingSendError
      ).code,
    ).toBe('channel_disabled');
    const on = new MockSmsMessaging('dev', { enabled: true });
    expect(((await on.send(email()).catch((e: unknown) => e)) as MessagingSendError).code).toBe(
      'channel_refused',
    );
  });

  it('flags must be booleans', () => {
    expect(configError(() => create('dev', 'loadsim', { smsEnabled: '1' as never })).code).toBe(
      'bad_options',
    );
  });

  it('parseMessagingFlag reads 0/1 and fails closed on anything else', () => {
    expect(parseMessagingFlag('1')).toBe(true);
    expect(parseMessagingFlag('0')).toBe(false);
    expect(parseMessagingFlag(undefined)).toBe(false);
    for (const bad of ['true', 'yes', ' 1', '', 1, true]) {
      expect(configError(() => parseMessagingFlag(bad)).code).toBe('bad_options');
    }
  });
});

describe('OutboxMessagingV2 (D1 outbox behind v2)', () => {
  it('maps invite and otp onto the D1 outbox and refuses other purposes and channels', async () => {
    const store = new InMemoryOutboxStore();
    const m = new OutboxMessagingV2('dev', store);
    const r1 = await m.send(email({ purpose: 'invite' }));
    const r2 = await m.send(email({ purpose: 'otp', idempotencyKey: 'otp-1' }));
    expect(r1.provider).toBe('outbox');
    const rows = await store.list(ORG_A, 10);
    expect(rows.map((r) => r.kind).sort()).toEqual(['invite', 'otp']);
    expect(rows.find((r) => r.kind === 'otp')?.id).toBe(r2.providerMessageId);
    for (const purpose of ['reminder', 'reschedule'] as const) {
      const e = await m.send(email({ purpose })).catch((err: unknown) => err);
      expect((e as MessagingSendError).code).toBe('purpose_refused');
    }
  });

  it('keeps the D1 @example.test recipient guard and idempotency', async () => {
    const store = new InMemoryOutboxStore();
    const m = new OutboxMessagingV2('staging', store);
    const e = await m.send(email({ to: 'someone@loadsim.test' })).catch((err: unknown) => err);
    expect((e as MessagingSendError).code).toBe('bad_recipient');
    const a = await m.send(email());
    const b = await m.send(email());
    expect(a.providerMessageId).toBe(b.providerMessageId);
  });

  it('refuses a missing store', () => {
    expect(configError(() => new OutboxMessagingV2('dev', undefined as never)).code).toBe(
      'bad_options',
    );
  });
});
