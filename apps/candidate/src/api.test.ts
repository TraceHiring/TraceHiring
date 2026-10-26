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
  ServedItemV2,
  SessionAttachResV2,
  SessionStartResV2,
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
  isServedItemV2,
  isSessionViewV2,
  ITEM_IMAGE_MAX_BYTES,
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
  mcqItemV2,
  mcqSection,
  PNG_BYTES,
  viewV2At,
  writtenItemV2,
  writtenSection,
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

  it('R5-67, R5-68 e: a 409 out_of_order carries the refusedSeqs of the part the edge kept', async () => {
    answer = () => json(409, { error: 'out_of_order', ackSeq: 7, refusedSeqs: [2, 7] });
    expect(await api.events(SESSION_TOKEN, { streamId: STREAM_ID, events: [] })).toEqual({
      ok: false,
      code: 'out_of_order',
      status: 409,
      ackSeq: 7,
      refusedSeqs: [2, 7],
    });
    // Checked as an ack's: distinct, each acknowledged (<= ackSeq), at most 100; else the answer fits no contract.
    const tooMany = Array.from({ length: 101 }, (_, k) => k + 1);
    for (const refusedSeqs of [[8], [2, 2], [0], ['2'], 'x', null, tooMany]) {
      answer = () => json(409, { error: 'out_of_order', ackSeq: 7, refusedSeqs });
      expect(
        await api.events(SESSION_TOKEN, { streamId: STREAM_ID, events: [] }),
        JSON.stringify(refusedSeqs).slice(0, 20),
      ).toEqual({ ok: false, code: 'unexpected', status: 409 });
    }
    const hundred = Array.from({ length: 100 }, (_, k) => k + 1);
    answer = () => json(409, { error: 'out_of_order', ackSeq: 100, refusedSeqs: hundred });
    expect(await api.events(SESSION_TOKEN, { streamId: STREAM_ID, events: [] })).toMatchObject({
      code: 'out_of_order',
      refusedSeqs: hundred,
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

describe('package v2 (AT-M1-32; R5-10, R5-20, R5-45, R5-59 d, R5-66 e)', () => {
  const api = createApi(ORIGIN);
  const HASH = 'b'.repeat(64);
  const bytes = (n: number, type: string, headers: Record<string, string> = {}) =>
    new Response(new Uint8Array(n), {
      status: 200,
      headers: { 'content-type': type, 'cache-control': 'no-store', ...headers },
    });

  it('start and attach accept a v2 view', async () => {
    const view = viewV2At(NOW);
    answer = ({ url }) =>
      url.endsWith('/start')
        ? json(200, { sessionToken: SESSION_TOKEN, expiresAt: '2026-10-19T12:00:00.000Z', view })
        : json(200, { view });
    const started = await api.start(LOBBY_TOKEN, {
      rulesAcknowledged: true,
      photo: { skippedReason: 'declined' },
    });
    expect(started.ok && 'view' in started.value && started.value.view).toEqual(view);
    expect(await api.attach(SESSION_TOKEN)).toEqual({ ok: true, value: { view } });
  });

  it('a v2 item GET carries afterSeq; a call without it sends no query (v1 as D1)', async () => {
    answer = () => json(200, mcqItemV2(1));
    expect(await api.item(SESSION_TOKEN, 1, 7)).toEqual({ ok: true, value: mcqItemV2(1) });
    await api.item(SESSION_TOKEN, 2);
    expect(calls.map((c) => c.url)).toEqual([
      `${ORIGIN}/v1/session/items/1?afterSeq=7`,
      `${ORIGIN}/v1/session/items/2`,
    ]);
    expect(await api.item(SESSION_TOKEN, 1, -1)).toMatchObject({ ok: false, code: 'bad_request' });
    expect(calls).toHaveLength(2);
  });

  it('an item GET maps 410 section_closed and 409 out_of_order with ackSeq', async () => {
    answer = () => json(410, { error: 'section_closed' });
    expect(await api.item(SESSION_TOKEN, 3, 0)).toEqual({
      ok: false,
      code: 'section_closed',
      status: 410,
    });
    answer = () => json(409, { error: 'out_of_order', ackSeq: 4 });
    expect(await api.item(SESSION_TOKEN, 3, 6)).toEqual({
      ok: false,
      code: 'out_of_order',
      status: 409,
      ackSeq: 4,
    });
  });

  it('media: GETs the bytes with the session Bearer token and no credentials', async () => {
    answer = () =>
      new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
    const res = await api.media(SESSION_TOKEN, HASH);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.type).toBe('image/png');
      expect([...res.value.bytes]).toEqual([...PNG_BYTES]);
    }
    expect(calls[0]?.url).toBe(`${ORIGIN}/v1/session/media/${HASH}`);
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(headersOf(calls[0])['authorization']).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('media: only png, jpeg and webp (never svg) and at most 1 MiB', async () => {
    for (const type of ['image/jpeg', 'image/webp', 'image/png; charset=binary']) {
      answer = () => bytes(10, type);
      expect((await api.media(SESSION_TOKEN, HASH)).ok, type).toBe(true);
    }
    for (const type of ['image/svg+xml', 'text/html', 'image/gif', 'application/octet-stream']) {
      answer = () => bytes(10, type);
      expect(await api.media(SESSION_TOKEN, HASH), type).toMatchObject({ ok: false });
    }
    answer = () => bytes(ITEM_IMAGE_MAX_BYTES, 'image/png');
    expect((await api.media(SESSION_TOKEN, HASH)).ok).toBe(true);
    answer = () => bytes(ITEM_IMAGE_MAX_BYTES + 1, 'image/png');
    expect(await api.media(SESSION_TOKEN, HASH)).toMatchObject({ ok: false });
    // A declared length over the cap is refused before the body is read.
    answer = () => bytes(10, 'image/png', { 'content-length': String(ITEM_IMAGE_MAX_BYTES + 1) });
    expect(await api.media(SESSION_TOKEN, HASH)).toMatchObject({ ok: false });
  });

  it('media: a 404 is invalid_link, a malformed hash sends nothing', async () => {
    answer = () => json(404, { error: 'invalid_link' });
    expect(await api.media(SESSION_TOKEN, HASH)).toEqual({
      ok: false,
      code: 'invalid_link',
      status: 404,
    });
    const before = calls.length;
    for (const bad of ['B'.repeat(64), 'b'.repeat(63), '../x', `${HASH}?x=1`]) {
      expect(await api.media(SESSION_TOKEN, bad)).toMatchObject({ ok: false, code: 'bad_request' });
    }
    expect(calls).toHaveLength(before);
  });
});

describe('hand checks agree with the zod contracts', () => {
  const view = viewAt(NOW, {
    answers: [
      { position: 1, choice: 'b' },
      { position: 2, text: 'draft' },
    ],
  });
  const viewV2 = viewV2At(NOW);
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
      [ackOf(0, NOW, NOW + 1000), { ...ackOf(3, NOW, NOW), refusedSeqs: [1, 3] }],
      [
        { ...ackOf(0, NOW, NOW), ackSeq: -1 },
        { ...ackOf(0, NOW, NOW), state: 'paused' },
        { ...ackOf(2, NOW, NOW), refusedSeqs: [3] },
        { ...ackOf(2, NOW, NOW), refusedSeqs: [1, 1] },
        { ...ackOf(2, NOW, NOW), refusedSeqs: [0] },
        { ...ackOf(2, NOW, NOW), refusedSeqs: 'x' },
      ],
    ],
    [
      'SessionStartResV2',
      isSessionStartRes,
      SessionStartResV2,
      [
        { sessionToken: SESSION_TOKEN, expiresAt: '2026-10-19T12:00:00.000Z', view: viewV2 },
        { state: 'submitted', receipt: RECEIPT },
      ],
      [
        { sessionToken: SESSION_TOKEN, expiresAt: '2026-10-19T12:00:00.000Z' },
        {
          sessionToken: SESSION_TOKEN,
          expiresAt: '2026-10-19T12:00:00.000Z',
          view: { ...viewV2, v: 3 },
        },
      ],
    ],
    [
      'SessionAttachResV2',
      (v: unknown) =>
        typeof v === 'object' && v !== null && isSessionViewV2((v as { view?: unknown }).view),
      SessionAttachResV2,
      [
        { view: viewV2 },
        { view: viewV2At(NOW, { receipt: RECEIPT, served: [1] }) },
        {
          view: viewV2At(NOW, {
            sections: [
              mcqSection({ state: 'closed' }),
              writtenSection({
                pasteRule: 'allowed_logged',
                deadlineAt: '2026-10-19T10:20:00.000Z',
              }),
            ],
          }),
        },
        {
          view: viewV2At(NOW, {
            answers: [
              { position: 1, choice: 'a' },
              { position: 3, text: 'draft' },
            ],
          }),
        },
      ],
      [
        { view },
        { view: { ...viewV2, v: 1 } },
        { view: { ...viewV2, heartbeatSeconds: 5 } },
        { view: { ...viewV2, items: [] } },
        { view: { ...viewV2, pasteBlocked: true } },
        { view: viewV2At(NOW, { sections: [mcqSection({ state: 'paused' as 'open' })] }) },
        { view: viewV2At(NOW, { sections: [mcqSection({ navigation: 'back' as 'free' })] }) },
        // R5-24: a written section is forward-only with a paste rule; no other has one.
        { view: viewV2At(NOW, { sections: [writtenSection({ navigation: 'free' })] }) },
        { view: viewV2At(NOW, { sections: [writtenSection({ pasteRule: undefined })] }) },
        { view: viewV2At(NOW, { sections: [mcqSection({ pasteRule: 'blocked' })] }) },
        { view: viewV2At(NOW, { sections: [mcqSection({ deadlineAt: 'soon' })] }) },
        { view: { ...viewV2, items: [{ ...viewV2.items[0], sectionId: SHA.slice(0, 36) }] } },
        {
          view: {
            ...viewV2,
            items: [{ ...viewV2.items[0], sectionId: '12345678-1234-4123-8123-123456789012' }],
          },
        },
        {},
      ],
    ],
    [
      'ServedItemV2',
      isServedItemV2,
      ServedItemV2,
      [
        mcqItemV2(1),
        writtenItemV2(3),
        { ...mcqItemV2(1), variantId: undefined },
        { ...writtenItemV2(3), media: [{ hash: SHA, alt: 'A synthetic chart' }] },
        {
          ...mcqItemV2(1),
          media: Array.from({ length: 4 }, () => ({ hash: SHA, alt: 'x' })),
        },
      ],
      [
        { ...mcqItemV2(1), options: undefined },
        { ...writtenItemV2(3), variantId: '99999999-9999-4999-8999-999999999999' },
        { ...writtenItemV2(3), media: [] },
        { ...writtenItemV2(3), media: [{ hash: 'x', alt: 'a' }] },
        { ...writtenItemV2(3), media: [{ hash: SHA, alt: '' }] },
        { ...writtenItemV2(3), media: [{ hash: SHA, alt: 'a'.repeat(301) }] },
        { ...mcqItemV2(1), media: Array.from({ length: 5 }, () => ({ hash: SHA, alt: 'x' })) },
        { ...mcqItemV2(1), variantId: 'nope' },
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
