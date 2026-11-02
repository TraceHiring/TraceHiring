// The candidate's only network client (specs/d1-demo-slice.md §4.2, §4.7): exact routes, `Content-Type:
// application/json` on JSON bodies, Bearer auth, no cookies or credentials, constant error codes mapped by status,
// and responses narrowed by a hand check (no zod in the bundle). Each hand check is compared with the zod contract.
import {
  CANDIDATE_ERROR_STATUS,
  EventBatchAck,
  InviteResolveRes,
  NoticeRes,
  OtpRequestRes,
  OtpVerifyRes,
  PhotoRes,
  Receipt,
  ServedItem,
  SessionAttachRes,
  SessionStartRes,
} from '@trace/shared/contracts/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createApi,
  ERROR_STATUS,
  isEventBatchAck,
  isInviteResolveRes,
  isNoticeRes,
  isOtpRequestRes,
  isOtpVerifyRes,
  isPhotoRes,
  isReceipt,
  isServedItem,
  isSessionAttachRes,
  isSessionStartRes,
  resolveEdgeOrigin,
} from './api';
import {
  ackOf,
  json,
  LINK_TOKEN,
  LOBBY_TOKEN,
  MCQ_ITEM,
  NOTICE,
  NOTICE_ID,
  RECEIPT,
  SESSION_TOKEN,
  SHA,
  STREAM_ID,
  viewAt,
  WRITTEN_ITEM,
} from './fixtures.test-helpers';

const ORIGIN = 'https://trace-edge-staging.example-sub.workers.dev';
const NOW = Date.parse('2026-10-19T10:00:00.000Z');

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let answer: (call: Call) => Response | Promise<Response> = () => json(200, { ok: true });

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return answer(call);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const headersOf = (call: Call | undefined): Record<string, string> =>
  Object.fromEntries(new Headers(call?.init.headers).entries());

describe('resolveEdgeOrigin (fail closed)', () => {
  it('accepts an https origin and the two local http origins', () => {
    expect(resolveEdgeOrigin(ORIGIN)).toBe(ORIGIN);
    expect(resolveEdgeOrigin(`${ORIGIN}/`)).toBe(ORIGIN);
    expect(resolveEdgeOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(resolveEdgeOrigin('http://localhost:8787')).toBe('http://localhost:8787');
  });

  it('refuses anything else', () => {
    for (const bad of [
      undefined,
      null,
      '',
      ' ',
      'trace-edge-staging.example.workers.dev',
      'http://trace-edge-staging.example.workers.dev',
      'http://10.0.0.1:8787',
      'ftp://example.test',
      `${ORIGIN}/v1`,
      `${ORIGIN}?x=1`,
      `${ORIGIN}#x`,
      'https://user:pw@example.test',
      'javascript:alert(1)'.replace('javascript', 'data'),
      42,
    ])
      expect(resolveEdgeOrigin(bad), String(bad)).toBeNull();
  });
});

describe('ERROR_STATUS', () => {
  it('is the contract table exactly', () => {
    expect(ERROR_STATUS).toEqual(CANDIDATE_ERROR_STATUS);
  });
});

describe('requests', () => {
  const api = createApi(ORIGIN);

  it('resolve posts the link token as JSON, without credentials or Authorization', async () => {
    answer = () => json(200, { state: 'sent', title: 'Synthetic test', durationMinutes: 30 });
    const res = await api.resolve(LINK_TOKEN);
    expect(res).toEqual({
      ok: true,
      value: { state: 'sent', title: 'Synthetic test', durationMinutes: 30 },
    });
    const call = calls[0];
    expect(call?.url).toBe(`${ORIGIN}/v1/invite/resolve`);
    expect(call?.init.method).toBe('POST');
    expect(call?.init.credentials).toBe('omit');
    expect(call?.init.cache).toBe('no-store');
    expect(call?.init.referrerPolicy).toBe('no-referrer');
    expect(headersOf(call)).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(call?.init.body))).toEqual({ token: LINK_TOKEN });
  });

  it('OTP request and verify', async () => {
    answer = ({ url }) =>
      url.endsWith('/request')
        ? json(200, { resendAfterSeconds: 30, expiresInSeconds: 600, channel: 'email' })
        : json(200, {
            lobbyToken: LOBBY_TOKEN,
            expiresAt: '2026-10-19T10:30:00.000Z',
            next: 'age',
          });
    expect((await api.otpRequest(LINK_TOKEN)).ok).toBe(true);
    const verified = await api.otpVerify(LINK_TOKEN, '123456');
    expect(verified.ok && verified.value.next).toBe('age');
    expect(calls.map((c) => c.url)).toEqual([
      `${ORIGIN}/v1/otp/request`,
      `${ORIGIN}/v1/otp/verify`,
    ]);
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ token: LINK_TOKEN, code: '123456' });
  });

  it('lobby routes carry the Bearer lobby token', async () => {
    answer = ({ url }) => (url.endsWith('/notice') ? json(200, NOTICE) : json(200, { ok: true }));
    expect(await api.age(LOBBY_TOKEN, true)).toEqual({ ok: true, value: { ok: true } });
    expect(await api.notice(LOBBY_TOKEN)).toEqual({ ok: true, value: NOTICE });
    expect(
      await api.consent(LOBBY_TOKEN, {
        noticeVersionId: NOTICE_ID,
        renderedSha256: SHA,
        accepted: true,
      }),
    ).toEqual({ ok: true, value: { ok: true } });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['POST', `${ORIGIN}/v1/lobby/age`],
      ['GET', `${ORIGIN}/v1/lobby/notice`],
      ['POST', `${ORIGIN}/v1/lobby/consent`],
    ]);
    expect(headersOf(calls[0])).toEqual({
      authorization: `Bearer ${LOBBY_TOKEN}`,
      'content-type': 'application/json',
    });
    // A GET has no body and so no content-type.
    expect(headersOf(calls[1])).toEqual({ authorization: `Bearer ${LOBBY_TOKEN}` });
    expect(calls[1]?.init.body).toBeUndefined();
  });

  it('the photo is a raw image/jpeg PUT with the lowercase hex hash', async () => {
    answer = () => json(200, { sha256: SHA, bytes: 3 });
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const res = await api.photo(LOBBY_TOKEN, bytes, SHA);
    expect(res).toEqual({ ok: true, value: { sha256: SHA, bytes: 3 } });
    expect(calls[0]?.init.method).toBe('PUT');
    expect(calls[0]?.url).toBe(`${ORIGIN}/v1/lobby/photo`);
    expect(headersOf(calls[0])).toEqual({
      authorization: `Bearer ${LOBBY_TOKEN}`,
      'content-type': 'image/jpeg',
      'x-photo-sha256': SHA,
    });
    expect(calls[0]?.init.body).toBe(bytes);
  });

  it('session routes carry the Bearer session token', async () => {
    const view = viewAt(NOW);
    answer = ({ url }) => {
      if (url.endsWith('/start'))
        return json(200, {
          sessionToken: SESSION_TOKEN,
          expiresAt: '2026-10-19T12:00:00.000Z',
          view,
        });
      if (url.endsWith('/attach')) return json(200, { view });
      if (url.includes('/items/')) return json(200, WRITTEN_ITEM);
      if (url.endsWith('/events')) return json(200, ackOf(2, NOW, NOW + 60_000));
      return json(200, RECEIPT);
    };
    const started = await api.start(LOBBY_TOKEN, {
      rulesAcknowledged: true,
      photo: { skippedReason: 'declined' },
    });
    expect(started.ok).toBe(true);
    expect((await api.attach(SESSION_TOKEN)).ok).toBe(true);
    expect(await api.item(SESSION_TOKEN, 2)).toEqual({ ok: true, value: WRITTEN_ITEM });
    const ack = await api.events(SESSION_TOKEN, {
      streamId: STREAM_ID,
      events: [{ seq: 1, t: 0, kind: 'heartbeat' }],
    });
    expect(ack.ok && ack.value.ackSeq).toBe(2);
    expect(await api.submit(SESSION_TOKEN, { streamId: STREAM_ID, finalSeq: 2 })).toEqual({
      ok: true,
      value: RECEIPT,
    });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['POST', `${ORIGIN}/v1/session/start`],
      ['POST', `${ORIGIN}/v1/session/attach`],
      ['GET', `${ORIGIN}/v1/session/items/2`],
      ['POST', `${ORIGIN}/v1/session/events`],
      ['POST', `${ORIGIN}/v1/session/submit`],
    ]);
    expect(headersOf(calls[0])['authorization']).toBe(`Bearer ${LOBBY_TOKEN}`);
    for (const call of calls.slice(1))
      expect(headersOf(call)['authorization']).toBe(`Bearer ${SESSION_TOKEN}`);
    for (const call of calls) expect(call.init.credentials).toBe('omit');
  });

  it('never sends a cookie header or an identity key', async () => {
    answer = () => json(200, { ok: true });
    await api.age(LOBBY_TOKEN, false);
    expect(headersOf(calls[0])['cookie']).toBeUndefined();
    expect(String(calls[0]?.init.body)).not.toMatch(/invitationId|sessionId|orgId|candidateId/);
  });

  it('refuses an item position that is not a positive integer without a request', async () => {
    expect(await api.item(SESSION_TOKEN, 0)).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await api.item(SESSION_TOKEN, 1.5)).toMatchObject({ ok: false, code: 'bad_request' });
    expect(calls).toHaveLength(0);
  });
});

describe('failures', () => {
  const api = createApi(ORIGIN);

  it('maps a contract error body by its status', async () => {
    for (const [code, status] of Object.entries(CANDIDATE_ERROR_STATUS)) {
      answer = () =>
        json(status, code === 'out_of_order' ? { error: code, ackSeq: 0 } : { error: code });
      const res = await api.age(LOBBY_TOKEN, true);
      expect(res, code).toMatchObject({ ok: false, code, status });
    }
  });

  it('carries ackSeq on 409 out_of_order and Retry-After on 429', async () => {
    answer = () => json(409, { error: 'out_of_order', ackSeq: 7 });
    expect(await api.events(SESSION_TOKEN, { streamId: STREAM_ID, events: [] })).toEqual({
      ok: false,
      code: 'out_of_order',
      status: 409,
      ackSeq: 7,
    });
    answer = () => json(429, { error: 'rate_limited' }, { 'retry-after': '3' });
    expect(await api.age(LOBBY_TOKEN, true)).toEqual({
      ok: false,
      code: 'rate_limited',
      status: 429,
      retryAfterSeconds: 3,
    });
  });

  it('parses odd bodies defensively', async () => {
    const cases: [Response, string][] = [
      [new Response('not json', { status: 503 }), 'unavailable'],
      [new Response('', { status: 502 }), 'unexpected'],
      [json(500, { error: { code: 'internal' } }), 'unexpected'],
      [json(401, { error: 'closed' }), 'unexpected'], // a known code on the wrong status
      [json(404, { error: 'not_found' }), 'unexpected'],
      [json(429, null), 'rate_limited'],
      [json(409, { error: 'out_of_order', ackSeq: -1 }), 'unexpected'],
      [json(413, 'x'), 'too_large'],
    ];
    for (const [res, code] of cases) {
      answer = () => res;
      expect(await api.age(LOBBY_TOKEN, true)).toMatchObject({ ok: false, code });
    }
  });

  it('a 200 whose body does not fit the contract is unexpected', async () => {
    answer = () => json(200, { state: 'nope' });
    expect(await api.resolve(LINK_TOKEN)).toMatchObject({ ok: false, code: 'unexpected' });
    answer = () => new Response('{', { status: 200 });
    expect(await api.resolve(LINK_TOKEN)).toMatchObject({ ok: false, code: 'unexpected' });
  });

  it('a network failure is "network"', async () => {
    answer = () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await api.resolve(LINK_TOKEN)).toEqual({ ok: false, code: 'network', status: 0 });
  });
});

describe('hand checks agree with the zod contracts', () => {
  const view = viewAt(NOW, {
    answers: [
      { position: 1, choice: 'b' },
      { position: 2, text: 'draft' },
    ],
  });
  const cases: [
    string,
    (v: unknown) => boolean,
    { safeParse(v: unknown): { success: boolean } },
    unknown[],
    unknown[],
  ][] = [
    [
      'InviteResolveRes',
      isInviteResolveRes,
      InviteResolveRes,
      [{ state: 'sent' }, { state: 'started', title: 'T', durationMinutes: 30 }],
      [
        {},
        { state: 'nope' },
        { state: 'sent', durationMinutes: 1.5 },
        { state: 'sent', title: '' },
        null,
      ],
    ],
    [
      'OtpRequestRes',
      isOtpRequestRes,
      OtpRequestRes,
      [{ resendAfterSeconds: 30, expiresInSeconds: 600, channel: 'email' }],
      [{ resendAfterSeconds: 30, expiresInSeconds: 600, channel: 'sms' }, { channel: 'email' }],
    ],
    [
      'OtpVerifyRes',
      isOtpVerifyRes,
      OtpVerifyRes,
      [{ lobbyToken: LOBBY_TOKEN, expiresAt: '2026-10-19T10:30:00.000Z', next: 'photo' }],
      [
        { lobbyToken: 'x', expiresAt: '2026-10-19T10:30:00.000Z', next: 'photo' },
        { lobbyToken: LOBBY_TOKEN, expiresAt: 'soon', next: 'photo' },
        { lobbyToken: LOBBY_TOKEN, expiresAt: '2026-10-19T10:30:00.000Z', next: 'test' },
      ],
    ],
    [
      'NoticeRes',
      isNoticeRes,
      NoticeRes,
      [NOTICE],
      [
        { ...NOTICE, language: 'hi' },
        { ...NOTICE, bodyText: '' },
        { ...NOTICE, renderedSha256: 'A'.repeat(64) },
      ],
    ],
    [
      'PhotoRes',
      isPhotoRes,
      PhotoRes,
      [{ sha256: SHA, bytes: 1000 }],
      [
        { sha256: SHA, bytes: 0 },
        { sha256: 'x', bytes: 10 },
        { sha256: SHA, bytes: 600_000 },
      ],
    ],
    [
      'SessionStartRes',
      isSessionStartRes,
      SessionStartRes,
      [
        { sessionToken: SESSION_TOKEN, expiresAt: '2026-10-19T12:00:00.000Z', view },
        { state: 'submitted', receipt: RECEIPT },
      ],
      [
        { sessionToken: SESSION_TOKEN, expiresAt: '2026-10-19T12:00:00.000Z' },
        { state: 'submitted', receipt: { receiptRef: 'abc', submittedAt: RECEIPT.submittedAt } },
        { state: 'in_progress', receipt: RECEIPT },
      ],
    ],
    [
      'SessionAttachRes',
      isSessionAttachRes,
      SessionAttachRes,
      [{ view }, { view: viewAt(NOW, { receipt: RECEIPT }) }],
      [
        { view: { ...view, heartbeatSeconds: 5 } },
        { view: { ...view, items: [] } },
        { view: { ...view, answers: [{ position: 2 }] } },
        { view: { ...view, streamId: 'not-a-uuid' } },
        {},
      ],
    ],
    [
      'ServedItem',
      isServedItem,
      ServedItem,
      [MCQ_ITEM, WRITTEN_ITEM, { ...WRITTEN_ITEM, maxChars: undefined }],
      [
        { ...MCQ_ITEM, options: undefined },
        { ...WRITTEN_ITEM, options: MCQ_ITEM.options },
        { ...MCQ_ITEM, position: 0 },
        { ...WRITTEN_ITEM, kind: 'code' },
      ],
    ],
    [
      'EventBatchAck',
      isEventBatchAck,
      EventBatchAck,
      [ackOf(0, NOW, NOW + 1000)],
      [
        { ...ackOf(0, NOW, NOW), ackSeq: -1 },
        { ...ackOf(0, NOW, NOW), state: 'paused' },
      ],
    ],
    [
      'Receipt',
      isReceipt,
      Receipt,
      [RECEIPT],
      [{ ...RECEIPT, receiptRef: 'ABCDEFGI' }, { receiptRef: RECEIPT.receiptRef }],
    ],
  ];

  for (const [name, check, schema, good, bad] of cases) {
    it(`${name}: valid samples pass both, invalid ones fail both`, () => {
      for (const sample of good) {
        const clean = JSON.parse(JSON.stringify(sample)) as unknown;
        expect(schema.safeParse(clean).success, `${name} zod good`).toBe(true);
        expect(check(clean), `${name} hand good`).toBe(true);
      }
      for (const sample of bad) {
        const clean = JSON.parse(JSON.stringify(sample ?? null)) as unknown;
        expect(schema.safeParse(clean).success, `${name} zod bad ${JSON.stringify(clean)}`).toBe(
          false,
        );
        expect(check(clean), `${name} hand bad ${JSON.stringify(clean)}`).toBe(false);
      }
    });
  }
});
