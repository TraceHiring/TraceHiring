// AT-M2-11 (SES v2 SendEmail request shape, SigV4 against an independent reference, no network) and AT-M2-23 (no real
// recipient from non-production: the recipient guard throws before fetch is called; the one test inbox matched by
// HMAC, R5-27). Spec: specs/m2-scheduling-invites.md §6.4, M2-15, M2-16, R4-6, R5-22, R5-27; ADR-034.
// Credentials and HMAC keys are synthetic and built at run time. Synthetic data only.
import { hmacSha256Hex } from '@trace/shared/invite-email';
import { beforeAll, describe, expect, it } from 'vitest';
import { MessagingConfigError, MessagingSendError } from './messaging-v2.js';
import type { OutboundMessageV2 } from './messaging-v2.js';
import { SES_ENDPOINT, SES_REGION, SesEmailMessaging } from './messaging-ses.js';
import type { SesEmailOptions } from './messaging-ses.js';
import {
  FIXED_AMZ_DATE,
  FIXED_DATE,
  jsonResponse,
  recordingFetch,
  referenceSigV4,
  testCredentials,
  without,
} from './messaging-sigv4.test-helpers.js';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const MSG_1 = '00000000-0000-4000-8000-00000000c0de';
const TEST_INBOX = 'founder.test.inbox@example.test';
const recipientKey = (): string =>
  Array.from({ length: 48 }, (_, i) => 'recipientkey'[i % 12]).join('');
let allowedHmac: string;

beforeAll(async () => {
  allowedHmac = await hmacSha256Hex(recipientKey(), TEST_INBOX);
});

const okFetch = () => recordingFetch(() => jsonResponse(200, { MessageId: 'ses-message-0001' }));

const options = (patch: Partial<SesEmailOptions> = {}): SesEmailOptions => ({
  traceEnv: 'staging',
  ...testCredentials(),
  fromAddress: 'invites@mail.example.test',
  fetch: okFetch().fetch,
  now: () => FIXED_DATE,
  testRecipientHmacKey: recipientKey(),
  allowedTestRecipientHmac: allowedHmac,
  ...patch,
});

const message = (patch: Partial<OutboundMessageV2> = {}): OutboundMessageV2 => ({
  orgId: ORG_A,
  channel: 'email',
  purpose: 'invite',
  to: 'success@simulator.amazonses.com',
  subject: 'Your assessment invitation',
  bodyText: 'Hello [synthetic]. परीक्षा उम्मीदवार.',
  bodyHtml: '<p>Hello [synthetic]. परीक्षा उम्मीदवार.</p>',
  idempotencyKey: `${MSG_1}:claim-1`,
  outboundMessageId: MSG_1,
  ...patch,
});

const sendError = async (p: Promise<unknown>): Promise<MessagingSendError> => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(MessagingSendError);
  return e as MessagingSendError;
};

describe('SesEmailMessaging: SES v2 SendEmail request (AT-M2-11)', () => {
  it('pins region and endpoint (fixed strings, never built from input)', () => {
    expect(SES_REGION).toBe('ap-south-1');
    expect(SES_ENDPOINT).toBe('https://email.ap-south-1.amazonaws.com/v2/email/outbound-emails');
  });

  it('sends one POST signed with SigV4 for a fixed date, matching an independent reference signer', async () => {
    const rec = okFetch();
    const ses = new SesEmailMessaging(options({ fetch: rec.fetch }));
    const out = await ses.send(message());
    expect(out).toEqual({
      provider: 'ses',
      providerMessageId: 'ses-message-0001',
      status: 'accepted',
    });
    expect(rec.calls).toHaveLength(1);
    const req = rec.calls[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://email.ap-south-1.amazonaws.com/v2/email/outbound-emails');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['x-amz-date']).toBe(FIXED_AMZ_DATE);
    expect(req.headers['x-amz-security-token']).toBeUndefined();

    const ref = referenceSigV4({
      method: 'POST',
      host: 'email.ap-south-1.amazonaws.com',
      path: '/v2/email/outbound-emails',
      signedHeaders: { 'x-amz-date': FIXED_AMZ_DATE },
      body: req.body,
      region: 'ap-south-1',
      service: 'ses',
      amzDate: FIXED_AMZ_DATE,
      ...testCredentials(),
    });
    // The pinned canonical request (only the body hash varies with the body).
    expect(ref.canonicalRequest.split('\n').slice(0, 7)).toEqual([
      'POST',
      '/v2/email/outbound-emails',
      '',
      'host:email.ap-south-1.amazonaws.com',
      'x-amz-date:20261031T120000Z',
      '',
      'host;x-amz-date',
    ]);
    expect(req.headers.authorization).toBe(ref.authorization);
    expect(req.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=TEST_ACCESS_ID_SYNTHETIC\/20261031\/ap-south-1\/ses\/aws4_request, SignedHeaders=host;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('builds the SendEmail body: UTF-8 text and HTML parts, tags org and msg, no idempotency key or extras', async () => {
    const rec = okFetch();
    await new SesEmailMessaging(options({ fetch: rec.fetch })).send(message());
    expect(JSON.parse(rec.calls[0]!.body)).toEqual({
      FromEmailAddress: 'invites@mail.example.test',
      Destination: { ToAddresses: ['success@simulator.amazonses.com'] },
      Content: {
        Simple: {
          Subject: { Data: 'Your assessment invitation', Charset: 'UTF-8' },
          Body: {
            Text: { Data: 'Hello [synthetic]. परीक्षा उम्मीदवार.', Charset: 'UTF-8' },
            Html: { Data: '<p>Hello [synthetic]. परीक्षा उम्मीदवार.</p>', Charset: 'UTF-8' },
          },
        },
      },
      EmailTags: [
        { Name: 'org', Value: ORG_A },
        { Name: 'msg', Value: MSG_1 },
      ],
    });
  });

  it('adds the configuration set when configured and omits the HTML part when there is none', async () => {
    const rec = okFetch();
    const ses = new SesEmailMessaging(
      options({ fetch: rec.fetch, configurationSetName: 'trace-staging-events' }),
    );
    const noHtml = without(message(), 'bodyHtml');
    await ses.send(noHtml);
    const body = JSON.parse(rec.calls[0]!.body) as Record<string, unknown> & {
      Content: { Simple: { Body: Record<string, unknown> } };
    };
    expect(body.ConfigurationSetName).toBe('trace-staging-events');
    expect(Object.keys(body.Content.Simple.Body)).toEqual(['Text']);
  });

  it('signs a session token when one is given', async () => {
    const rec = okFetch();
    const sessionToken = ['synthetic', 'session', 'value'].join('-');
    await new SesEmailMessaging(options({ fetch: rec.fetch, sessionToken })).send(message());
    const req = rec.calls[0]!;
    expect(req.headers['x-amz-security-token']).toBe(sessionToken);
    const ref = referenceSigV4({
      method: 'POST',
      host: 'email.ap-south-1.amazonaws.com',
      path: '/v2/email/outbound-emails',
      signedHeaders: { 'x-amz-date': FIXED_AMZ_DATE, 'x-amz-security-token': sessionToken },
      body: req.body,
      region: 'ap-south-1',
      service: 'ses',
      amzDate: FIXED_AMZ_DATE,
      ...testCredentials(),
    });
    expect(req.headers.authorization).toBe(ref.authorization);
  });

  it('requires the outbound message id for the msg tag (R4-6) and a subject', async () => {
    const rec = okFetch();
    const ses = new SesEmailMessaging(options({ fetch: rec.fetch }));
    const noId = without(message(), 'outboundMessageId');
    expect((await sendError(ses.send(noId))).code).toBe('bad_message_id');
    const noSubject = without(message(), 'subject');
    expect((await sendError(ses.send(noSubject))).code).toBe('bad_subject');
    expect((await sendError(ses.send(message({ channel: 'sms' })))).code).toBe('channel_refused');
    expect(rec.calls).toHaveLength(0);
  });

  it('an otp send has no outbound message: it carries the org tag only, no msg tag (R4-6)', async () => {
    const rec = okFetch();
    const ses = new SesEmailMessaging(options({ fetch: rec.fetch }));
    const otp = without(message({ purpose: 'otp', idempotencyKey: 'otp-1' }), 'outboundMessageId');
    const out = await ses.send(otp);
    expect(out.providerMessageId).toBe('ses-message-0001');
    expect(rec.calls).toHaveLength(1);
    expect(JSON.parse(rec.calls[0]!.body).EmailTags).toEqual([{ Name: 'org', Value: ORG_A }]);
  });

  it('an otp with an outbound message id is bad_message_id (an OTP has no outbound_messages row)', async () => {
    const rec = okFetch();
    const ses = new SesEmailMessaging(options({ fetch: rec.fetch }));
    expect((await sendError(ses.send(message({ purpose: 'otp' })))).code).toBe('bad_message_id');
    expect(rec.calls).toHaveLength(0);
  });

  it.each(['invite', 'reminder', 'reschedule'] as const)(
    'a %s without the outbound message id is bad_message_id; with it, both tags',
    async (purpose) => {
      const rec = okFetch();
      const ses = new SesEmailMessaging(options({ fetch: rec.fetch }));
      const noId = without(message({ purpose }), 'outboundMessageId');
      expect((await sendError(ses.send(noId))).code).toBe('bad_message_id');
      expect(rec.calls).toHaveLength(0);
      await ses.send(message({ purpose }));
      expect(JSON.parse(rec.calls[0]!.body).EmailTags).toEqual([
        { Name: 'org', Value: ORG_A },
        { Name: 'msg', Value: MSG_1 },
      ]);
    },
  );
});

describe('SesEmailMessaging: provider errors carry codes only', () => {
  it.each([
    [429, 'provider_throttled', true],
    [500, 'provider_unavailable', true],
    [503, 'provider_unavailable', true],
    [400, 'provider_rejected', false],
    [403, 'provider_rejected', false],
  ] as const)('HTTP %i → %s (retryable %s)', async (status, code, retryable) => {
    const rec = recordingFetch(() =>
      jsonResponse(status, { message: 'synthetic failure for success@simulator' }),
    );
    const e = await sendError(new SesEmailMessaging(options({ fetch: rec.fetch })).send(message()));
    expect(e.code).toBe(code);
    expect(e.retryable).toBe(retryable);
    expect(e.message).toBe(`messaging: ${code}`);
  });

  it('a network error is retryable provider_unavailable', async () => {
    const ses = new SesEmailMessaging(
      options({
        fetch: () => Promise.reject(new TypeError('network down success@simulator.amazonses.com')),
      }),
    );
    const e = await sendError(ses.send(message()));
    expect(e.code).toBe('provider_unavailable');
    expect(e.retryable).toBe(true);
    expect(e.message).not.toContain('simulator');
  });

  it('a 200 without a usable MessageId is a permanent provider_bad_response (no double send on retry)', async () => {
    for (const body of [{}, { MessageId: '' }, { MessageId: 42 }]) {
      const rec = recordingFetch(() => jsonResponse(200, body));
      const e = await sendError(
        new SesEmailMessaging(options({ fetch: rec.fetch })).send(message()),
      );
      expect(e.code).toBe('provider_bad_response');
      expect(e.retryable).toBe(false);
    }
    const notJson = recordingFetch(() => new Response('not json', { status: 200 }));
    const e = await sendError(
      new SesEmailMessaging(options({ fetch: notJson.fetch })).send(message()),
    );
    expect(e.code).toBe('provider_bad_response');
  });
});

describe('SesEmailMessaging: MessageId bound (provider_message_id CHECK {1,255}; B1 fix 4)', () => {
  it('accepts a 255-character MessageId', async () => {
    const id = 'm'.repeat(255);
    const rec = recordingFetch(() => jsonResponse(200, { MessageId: id }));
    const out = await new SesEmailMessaging(options({ fetch: rec.fetch })).send(message());
    expect(out.providerMessageId).toBe(id);
  });

  it('a 256-character MessageId is the permanent provider_bad_response', async () => {
    const rec = recordingFetch(() => jsonResponse(200, { MessageId: 'm'.repeat(256) }));
    const e = await sendError(new SesEmailMessaging(options({ fetch: rec.fetch })).send(message()));
    expect(e.code).toBe('provider_bad_response');
    expect(e.retryable).toBe(false);
  });
});

describe('SesEmailMessaging: recipient guard outside production (AT-M2-23)', () => {
  it.each([
    'success@simulator.amazonses.com',
    'bounce@simulator.amazonses.com',
    'complaint@simulator.amazonses.com',
    'suppressionlist@simulator.amazonses.com',
    'Success+label@Simulator.AmazonSES.com',
  ])('allows the mailbox simulator address %s', async (to) => {
    const rec = okFetch();
    await new SesEmailMessaging(options({ fetch: rec.fetch })).send(message({ to }));
    expect(rec.calls).toHaveLength(1);
  });

  it('allows the one test inbox whose HMAC matches, compared after normalisation', async () => {
    for (const to of [TEST_INBOX, '  Founder.Test.Inbox@Example.TEST ']) {
      const rec = okFetch();
      await new SesEmailMessaging(options({ fetch: rec.fetch })).send(message({ to }));
      expect(rec.calls).toHaveLength(1);
      expect(JSON.parse(rec.calls[0]!.body).Destination).toEqual({ ToAddresses: [TEST_INBOX] });
    }
  });

  it.each([
    'someone@example.com',
    'candidate.1@example.test',
    'success@simulator.amazonses.com.evil.example',
    'success@notsimulator.amazonses.com',
    'success@simulator.amazonses.co',
    'founder.test.inbox@example.tes',
    'success@simulator.amazonses.com, other@example.com',
    'success@simulator.amazonses.com\r\nbcc: other@example.com',
    '',
  ])('throws bad_recipient for %j before any network call', async (to) => {
    let called = 0;
    const ses = new SesEmailMessaging(
      options({
        fetch: () => {
          called++;
          return Promise.resolve(jsonResponse(200, { MessageId: 'x' }));
        },
      }),
    );
    const e = await sendError(ses.send(message({ to })));
    expect(e.code).toBe('bad_recipient');
    expect(e.retryable).toBe(false);
    expect(called).toBe(0);
  });

  it('a different HMAC key does not match the configured digest', async () => {
    const rec = okFetch();
    const ses = new SesEmailMessaging(
      options({ fetch: rec.fetch, testRecipientHmacKey: 'x'.repeat(48) }),
    );
    expect((await sendError(ses.send(message({ to: TEST_INBOX })))).code).toBe('bad_recipient');
    expect(rec.calls).toHaveLength(0);
  });

  it('without a configured test inbox, only simulator addresses pass', async () => {
    const rec = okFetch();
    const ses = new SesEmailMessaging({
      traceEnv: 'staging',
      ...testCredentials(),
      fromAddress: 'invites@mail.example.test',
      fetch: rec.fetch,
      now: () => FIXED_DATE,
    });
    expect((await sendError(ses.send(message({ to: TEST_INBOX })))).code).toBe('bad_recipient');
    await ses.send(message());
    expect(rec.calls).toHaveLength(1);
  });
});

describe('SesEmailMessaging: construction', () => {
  it.each(['production', 'dev', '', undefined, 'Staging'])(
    'refuses traceEnv %j (staging only until M8)',
    (traceEnv) => {
      let caught: unknown;
      try {
        new SesEmailMessaging(options({ traceEnv: traceEnv as never }));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(MessagingConfigError);
      expect((caught as MessagingConfigError).code).toBe('env_refused');
    },
  );

  it.each([
    [{ accessKeyId: '' }],
    [{ secretAccessKey: '' }],
    [{ fromAddress: 'not an address' }],
    [{ fetch: undefined as never }],
    [{ testRecipientHmacKey: 'short' }],
    [{ allowedTestRecipientHmac: 'ABC' }],
    [{ allowedTestRecipientHmac: undefined }],
    [{ configurationSetName: 'bad name!' }],
    [{ sendRatePerSecond: 0 }],
  ])('refuses bad options %j with bad_options', (patch) => {
    let caught: unknown;
    try {
      new SesEmailMessaging(options(patch as Partial<SesEmailOptions>));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MessagingConfigError);
    expect((caught as MessagingConfigError).code).toBe('bad_options');
  });

  it('declares the sandbox send rate of 1 per second by default', () => {
    expect(new SesEmailMessaging(options()).sendRatePerSecond).toBe(1);
    expect(new SesEmailMessaging(options({ sendRatePerSecond: 14 })).sendRatePerSecond).toBe(14);
  });
});
