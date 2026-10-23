// D1 candidate wire contracts (specs/d1-demo-slice.md §4.2-§4.6). Synthetic values only; no secret-shaped literals.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import * as Candidate from './contracts-candidate.js';
import {
  EvidenceEventLine,
  FinalAnswers,
  OutOfOrderBody,
  AgeDeclareReq,
  AgeDeclareRpcIn,
  AgeDeclareRpcOut,
  CANDIDATE_ERROR_CODES,
  CANDIDATE_ERROR_STATUS,
  CandidateErrorBody,
  CandidateErrorCode,
  CandidateRpcSchemas,
  CandidateTokenClaims,
  ClientEvent,
  ClientSignal,
  ConsentRecordRpcIn,
  ConsentReq,
  EventBatchAck,
  EventBatchReq,
  IDENTITY_KEYS,
  InviteResolveReq,
  InviteResolveRes,
  InviteResolveRpcIn,
  InviteResolveRpcOut,
  LobbyMintRpcIn,
  LobbyMintRpcOut,
  MessagingSendRpcIn,
  MessagingSendRpcOut,
  NoticeGetRpcIn,
  NoticeRes,
  OkRes,
  OtpRequestReq,
  OtpRequestRes,
  OtpVerifyReq,
  OtpVerifyRes,
  PhotoPermitRpcIn,
  PhotoPermitRpcOut,
  PhotoRes,
  Receipt,
  ServedItem,
  SessionAttachRes,
  SessionGrantRpcIn,
  SessionGrantRpcOut,
  SessionMirrorMessage,
  SessionMirrorMessageV1,
  SessionMirrorMessageV2,
  SessionStartedRpcIn,
  SessionStartedRpcOut,
  SessionStartReq,
  SessionStartRes,
  SessionView,
  SessionViewV2,
  ServedItemV2,
  SessionStartResV2,
  SessionAttachResV2,
  SubmitReq,
  TestPackage,
  TestPackageV2,
  discardIdentityKeys,
} from './contracts-candidate.js';
import {
  allObjectsStrict,
  keysMatching,
  schemaKeys,
  schemaNodes,
} from './contracts-schema-walk.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-14T10:00:00.000Z';
const T1 = '2026-10-14T10:30:00.000Z';
const T2 = '2026-10-14T10:31:00.000Z';
const HEX = 'a'.repeat(64);
const LINK = 'L'.repeat(43);
const FAKE_JWS = ['hdr', 'body', 'sig'].join('.'); // not a real token: three fake parts
const NONCE = 'n'.repeat(22);

const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

describe('identity keys are discarded before parsing, never accepted', () => {
  it('lists exactly the four identity keys of §4.2', () => {
    expect([...IDENTITY_KEYS].sort()).toEqual([
      'candidateId',
      'invitationId',
      'orgId',
      'sessionId',
    ]);
  });
  it('discardIdentityKeys removes them at the top level only and leaves other input alone', () => {
    const body = {
      token: LINK,
      invitationId: id(1),
      sessionId: id(2),
      orgId: id(3),
      candidateId: id(4),
    };
    expect(discardIdentityKeys(body)).toEqual({ token: LINK });
    expect(body.invitationId).toBe(id(1)); // the input is not mutated
    expect(discardIdentityKeys({ nested: { orgId: id(3) } })).toEqual({ nested: { orgId: id(3) } });
    expect(discardIdentityKeys('x')).toBe('x');
    expect(discardIdentityKeys(null)).toBeNull();
    expect(discardIdentityKeys([1])).toEqual([1]);
  });
  it('no candidate request schema has an identity key, so a stray one fails strict parsing', () => {
    const requests: [string, z.ZodType, object][] = [
      ['InviteResolveReq', InviteResolveReq, { token: LINK }],
      ['OtpRequestReq', OtpRequestReq, { token: LINK }],
      ['OtpVerifyReq', OtpVerifyReq, { token: LINK, code: '123456' }],
      ['AgeDeclareReq', AgeDeclareReq, { adult: true }],
      ['ConsentReq', ConsentReq, { noticeVersionId: id(9), renderedSha256: HEX, accepted: true }],
      [
        'SessionStartReq',
        SessionStartReq,
        { rulesAcknowledged: true, photo: { skippedReason: 'declined' } },
      ],
      [
        'EventBatchReq',
        EventBatchReq,
        { streamId: id(5), events: [{ seq: 1, t: 0, kind: 'heartbeat' }] },
      ],
      ['SubmitReq', SubmitReq, { streamId: id(5), finalSeq: 3 }],
    ];
    for (const [name, schema, valid] of requests) {
      expect(ok(schema, valid), name).toBe(true);
      for (const key of IDENTITY_KEYS) {
        expect(ok(schema, { ...valid, [key]: id(7) }), `${name} + ${key}`).toBe(false);
      }
      expect(
        schemaKeys(schema).filter((k) => (IDENTITY_KEYS as readonly string[]).includes(k)),
        name,
      ).toEqual([]);
      expect(ok(schema, { ...valid, extra: 1 }), `${name} + extra`).toBe(false);
    }
  });
});

describe('link, OTP and lobby steps', () => {
  it('InviteResolve', () => {
    expect(InviteResolveReq.parse({ token: LINK })).toEqual({ token: LINK });
    expect(ok(InviteResolveReq, { token: 'short' })).toBe(false);
    expect(ok(InviteResolveReq, { token: `${'L'.repeat(42)}+` })).toBe(false);
    const res = { state: 'sent', title: 'Sample test', durationMinutes: 30 };
    expect(InviteResolveRes.parse(res)).toEqual(res);
    expect(ok(InviteResolveRes, { state: 'expired' })).toBe(true);
    expect(ok(InviteResolveRes, { state: 'rejected' })).toBe(false);
    expect(ok(InviteResolveRes, { ...res, contactEmail: 'a@example.test' })).toBe(false);
    expect(ok(InviteResolveRes, { ...res, durationMinutes: 0 })).toBe(false);
  });
  it('OtpRequest and OtpVerify', () => {
    const res = { resendAfterSeconds: 30, expiresInSeconds: 600, channel: 'email' };
    expect(OtpRequestRes.parse(res)).toEqual(res);
    expect(ok(OtpRequestRes, { ...res, channel: 'sms' })).toBe(false);
    expect(ok(OtpVerifyReq, { token: LINK, code: '12345' })).toBe(false);
    expect(ok(OtpVerifyReq, { token: LINK, code: '12345a' })).toBe(false);
    expect(ok(OtpVerifyReq, { token: LINK, code: '1234567' })).toBe(false);
    const verified = { lobbyToken: FAKE_JWS, expiresAt: T1, next: 'age' };
    expect(OtpVerifyRes.parse(verified)).toEqual(verified);
    for (const next of ['age', 'consent', 'photo', 'start']) {
      expect(ok(OtpVerifyRes, { ...verified, next })).toBe(true);
    }
    expect(ok(OtpVerifyRes, { ...verified, next: 'test' })).toBe(false);
  });
  it('age, ok, notice, consent, photo', () => {
    expect(ok(AgeDeclareReq, { adult: false })).toBe(true);
    expect(ok(AgeDeclareReq, { adult: 'yes' })).toBe(false);
    expect(OkRes.parse({ ok: true })).toEqual({ ok: true });
    expect(ok(OkRes, { ok: false })).toBe(false);
    const notice = {
      noticeVersionId: id(9),
      language: 'en',
      bodyText: 'Notice text',
      renderedSha256: HEX,
    };
    expect(NoticeRes.parse(notice)).toEqual(notice);
    expect(ok(NoticeRes, { ...notice, language: 'hi' })).toBe(false);
    expect(ok(NoticeRes, { ...notice, renderedSha256: 'abc' })).toBe(false);
    expect(ok(ConsentReq, { noticeVersionId: id(9), renderedSha256: HEX, accepted: false })).toBe(
      false,
    );
    expect(ok(ConsentReq, { noticeVersionId: 'x', renderedSha256: HEX, accepted: true })).toBe(
      false,
    );
    expect(PhotoRes.parse({ sha256: HEX, bytes: 1234 })).toEqual({ sha256: HEX, bytes: 1234 });
    expect(ok(PhotoRes, { sha256: HEX, bytes: 512001 })).toBe(false);
    expect(ok(PhotoRes, { sha256: HEX, bytes: 0 })).toBe(false);
  });
});

const sections = [
  { id: id(20), title: 'Part A', position: 1 },
  { id: id(21), title: 'Part B', position: 2 },
];
const view = {
  sessionId: id(30),
  state: 'in_progress',
  serverNow: T0,
  startedAt: T0,
  deadlineAt: T1,
  streamId: id(31),
  heartbeatSeconds: 10,
  pasteBlocked: true,
  title: 'Sample test',
  sections,
  items: [
    { position: 1, sectionId: id(20), kind: 'mcq', servedAt: T0 },
    { position: 2, sectionId: id(21), kind: 'written', servedAt: null },
  ],
  answers: [
    { position: 1, choice: 'opt-a' },
    { position: 2, text: 'Draft answer' },
  ],
};

describe('session start, attach, view and items', () => {
  it('SessionStartReq takes exactly one photo form', () => {
    const base = { rulesAcknowledged: true };
    expect(ok(SessionStartReq, { ...base, photo: { sha256: HEX } })).toBe(true);
    for (const skippedReason of ['camera_denied', 'no_camera', 'declined']) {
      expect(ok(SessionStartReq, { ...base, photo: { skippedReason } })).toBe(true);
    }
    expect(ok(SessionStartReq, { ...base, photo: { skippedReason: 'busy' } })).toBe(false);
    expect(
      ok(SessionStartReq, { ...base, photo: { sha256: HEX, skippedReason: 'declined' } }),
    ).toBe(false);
    expect(ok(SessionStartReq, { ...base, photo: {} })).toBe(false);
    expect(ok(SessionStartReq, base)).toBe(false);
    expect(ok(SessionStartReq, { rulesAcknowledged: false, photo: { sha256: HEX } })).toBe(false);
    expect(ok(SessionStartReq, { ...base, photo: { sha256: 'abc' } })).toBe(false);
  });
  it('SessionView accepts a live view and a submitted view with a receipt', () => {
    expect(SessionView.parse(view)).toEqual(view);
    const submitted = {
      ...view,
      state: 'submitted',
      receipt: { receiptRef: 'ABCD1234', submittedAt: T2 },
    };
    expect(SessionView.parse(submitted)).toEqual(submitted);
    expect(ok(SessionView, { ...view, heartbeatSeconds: 5 })).toBe(false);
    expect(ok(SessionView, { ...view, state: 'paused' })).toBe(false);
    expect(ok(SessionView, { ...view, extra: 1 })).toBe(false);
    expect(
      ok(SessionView, {
        ...view,
        items: [{ position: 0, sectionId: id(20), kind: 'mcq', servedAt: null }],
      }),
    ).toBe(false);
    expect(ok(SessionView, { ...view, answers: [{ position: 1, text: 'x', choice: 'a' }] })).toBe(
      false,
    );
    expect(
      ok(SessionView, { ...view, receipt: { receiptRef: 'ABCD1234', submittedAt: T2, score: 1 } }),
    ).toBe(false);
  });
  it('SessionAttachRes wraps the view', () => {
    expect(SessionAttachRes.parse({ view })).toEqual({ view });
    expect(ok(SessionAttachRes, { view, extra: 1 })).toBe(false);
  });
  it('SessionStartRes is the live form or the submitted-receipt form, never a mix', () => {
    const live = { sessionToken: FAKE_JWS, expiresAt: T2, view };
    const done = { state: 'submitted', receipt: { receiptRef: 'ABCD1234', submittedAt: T2 } };
    expect(SessionStartRes.parse(live)).toEqual(live);
    expect(SessionStartRes.parse(done)).toEqual(done);
    expect(ok(SessionStartRes, { ...live, receipt: done.receipt })).toBe(false);
    expect(ok(SessionStartRes, { ...done, sessionToken: FAKE_JWS })).toBe(false);
    expect(ok(SessionStartRes, { state: 'submitted' })).toBe(false);
    expect(ok(SessionStartRes, { state: 'in_progress', receipt: done.receipt })).toBe(false);
  });
  it('ServedItem: mcq carries options, written does not', () => {
    const mcq = {
      position: 1,
      kind: 'mcq',
      sectionId: id(20),
      prompt: 'Pick one',
      options: [
        { id: 'a', label: 'First' },
        { id: 'b', label: 'Second' },
      ],
      servedAt: T0,
    };
    const written = {
      position: 2,
      kind: 'written',
      sectionId: id(21),
      prompt: 'Explain',
      maxChars: 2000,
      servedAt: T0,
    };
    expect(ServedItem.parse(mcq)).toEqual(mcq);
    expect(ServedItem.parse(written)).toEqual(written);
    expect(ok(ServedItem, { ...mcq, options: undefined })).toBe(false);
    expect(ok(ServedItem, { ...written, options: mcq.options })).toBe(false);
    expect(
      ok(ServedItem, { ...mcq, options: [{ id: 'a', label: 'x', correct: true }, mcq.options[1]] }),
    ).toBe(false);
    expect(ok(ServedItem, { ...mcq, options: [mcq.options[0]] })).toBe(false);
    expect(ok(ServedItem, { ...mcq, correctOptionId: 'a' })).toBe(false);
  });
});

describe('ClientEvent and batches', () => {
  const env = { seq: 1, t: 1500 };
  const events = {
    'answer.text': { ...env, kind: 'answer.text', item: 2, p: 0, d: 0, i: 'Hello' },
    'answer.text+len': { ...env, kind: 'answer.text', item: 2, p: 5, d: 1, i: '', len: 4 },
    'answer.choice': { ...env, kind: 'answer.choice', item: 1, option: 'a' },
    'answer.choice cleared': { ...env, kind: 'answer.choice', item: 1, option: null },
    paste: { ...env, kind: 'signal', sig: 'paste', item: 2, len: 120 },
    'paste outside an item': { ...env, kind: 'signal', sig: 'paste', item: null, len: 0 },
    drop: { ...env, kind: 'signal', sig: 'drop', item: 2, len: 10, dt: 'files' },
    untrusted_input: {
      ...env,
      kind: 'signal',
      sig: 'untrusted_input',
      item: 2,
      via: 'keydown',
      count: 3,
    },
    tab_hidden: { ...env, kind: 'signal', sig: 'tab_hidden', item: 2, ms: 4000 },
    fullscreen_exit: { ...env, kind: 'signal', sig: 'fullscreen_exit', item: null },
    heartbeat: { ...env, kind: 'heartbeat' },
  };
  it.each(Object.entries(events))('accepts %s', (_name, event) => {
    expect(ClientEvent.parse(event)).toEqual(event);
  });
  it('rejects unknown kinds, unknown signals, extra keys and bad numbers', () => {
    expect(ok(ClientEvent, { ...env, kind: 'keystroke' })).toBe(false);
    expect(ok(ClientEvent, { ...env, kind: 'signal', sig: 'copy', item: 1, len: 1 })).toBe(false);
    expect(ok(ClientEvent, { ...env, kind: 'signal', sig: 'paste', item: 1 })).toBe(false);
    expect(ok(ClientEvent, { ...events.heartbeat, extra: 1 })).toBe(false);
    expect(ok(ClientEvent, { ...events.heartbeat, payload: {} })).toBe(false);
    expect(ok(ClientEvent, { kind: 'heartbeat', t: 0 })).toBe(false); // seq is required
    expect(ok(ClientEvent, { ...events.heartbeat, seq: 0 })).toBe(false);
    expect(ok(ClientEvent, { ...events.heartbeat, t: -1 })).toBe(false);
    expect(ok(ClientEvent, { ...events.heartbeat, seq: 1.5 })).toBe(false);
    expect(ok(ClientEvent, { ...events.paste, dt: 'text' })).toBe(false);
    expect(ok(ClientEvent, { ...events.drop, dt: 'html' })).toBe(false);
    expect(ok(ClientEvent, { ...events.untrusted_input, via: 'click' })).toBe(false);
    expect(ok(ClientEvent, { ...events.untrusted_input, count: 0 })).toBe(false);
    expect(ok(ClientEvent, { ...events.tab_hidden, ms: -1 })).toBe(false);
  });
  it('answer.text: insert at most 10 000 units, no negative splice', () => {
    expect(ok(ClientEvent, { ...events['answer.text'], i: 'x'.repeat(10000) })).toBe(true);
    expect(ok(ClientEvent, { ...events['answer.text'], i: 'x'.repeat(10001) })).toBe(false);
    expect(ok(ClientEvent, { ...events['answer.text'], p: -1 })).toBe(false);
    expect(ok(ClientEvent, { ...events['answer.text'], d: -1 })).toBe(false);
    expect(ok(ClientEvent, { ...events['answer.text'], item: null })).toBe(false);
    expect(ok(ClientEvent, { ...events['answer.text'], len: -1 })).toBe(false);
  });
  it('signal payloads are metadata only: no text, content, clipboard, name or file key (rule 7)', () => {
    const keys = schemaKeys(ClientSignal);
    expect(keys.sort()).toEqual([
      'count',
      'dt',
      'item',
      'kind',
      'len',
      'ms',
      'seq',
      'sig',
      't',
      'via',
    ]);
    expect(
      keysMatching(ClientSignal, /text|content|clipboard|name|file|data|value|html|selection/i),
    ).toEqual([]);
    for (const key of ['text', 'content', 'clipboard', 'name', 'fileName', 'value']) {
      expect(ok(ClientEvent, { ...events.paste, [key]: 'x' }), key).toBe(false);
      expect(ok(ClientEvent, { ...events.drop, [key]: 'x' }), key).toBe(false);
    }
    expect(ClientSignal.safeParse(events.heartbeat).success).toBe(false);
    expect(ClientSignal.safeParse(events['answer.text']).success).toBe(false);
  });
  it('EventBatchReq holds 1..100 events', () => {
    const batch = (n: number) => ({
      streamId: id(31),
      events: Array.from({ length: n }, (_v, i) => ({ seq: i + 1, t: i, kind: 'heartbeat' })),
    });
    expect(ok(EventBatchReq, batch(1))).toBe(true);
    expect(ok(EventBatchReq, batch(100))).toBe(true);
    expect(ok(EventBatchReq, batch(0))).toBe(false);
    expect(ok(EventBatchReq, batch(101))).toBe(false);
    expect(ok(EventBatchReq, { ...batch(1), streamId: 'x' })).toBe(false);
  });
  it('EventBatchAck and SubmitReq', () => {
    const ack = { ackSeq: 12, serverNow: T0, deadlineAt: T1, state: 'in_progress' };
    expect(EventBatchAck.parse(ack)).toEqual(ack);
    expect(ok(EventBatchAck, { ...ack, state: 'auto_submitted' })).toBe(true);
    expect(ok(EventBatchAck, { ...ack, ackSeq: -1 })).toBe(false);
    expect(ok(EventBatchAck, { ...ack, state: 'closed' })).toBe(false);
    expect(ok(EventBatchAck, { ...ack, extra: 1 })).toBe(false);
    expect(SubmitReq.parse({ streamId: id(31), finalSeq: 0 })).toEqual({
      streamId: id(31),
      finalSeq: 0,
    });
    expect(ok(SubmitReq, { streamId: id(31), finalSeq: -1 })).toBe(false);
  });
});

describe('Receipt (rule 5, D1-11): exactly receiptRef and submittedAt', () => {
  it('accepts the two keys and nothing else', () => {
    const receipt = { receiptRef: 'ABCD1234', submittedAt: T2 };
    expect(Receipt.parse(receipt)).toEqual(receipt);
    expect(schemaKeys(Receipt)).toEqual(['receiptRef', 'submittedAt']);
    for (const key of ['score', 'band', 'outcome', 'grade', 'result', 'sessionId']) {
      expect(ok(Receipt, { ...receipt, [key]: 1 }), key).toBe(false);
    }
  });
  it('receiptRef is 8 Crockford base32 characters (no I, L, O, U)', () => {
    for (const bad of [
      'abcd1234',
      'ABCD123',
      'ABCD12345',
      'ABCI1234',
      'ABCL1234',
      'ABCO1234',
      'ABCU1234',
    ]) {
      expect(ok(Receipt, { receiptRef: bad, submittedAt: T2 }), bad).toBe(false);
    }
    expect(ok(Receipt, { receiptRef: '0123ABCZ', submittedAt: T2 })).toBe(true);
  });
});

describe('CandidateError codes (§4.2)', () => {
  const expected: Record<string, number> = {
    bad_request: 400,
    token_invalid: 401,
    token_expired: 401,
    superseded: 401,
    otp_wrong: 401,
    not_eligible: 403,
    step_required: 403,
    invalid_link: 404,
    link_expired: 410,
    link_revoked: 410,
    closed: 410,
    section_closed: 410, // M1 R5-20: an item GET for a closed or passed forward-only position
    out_of_order: 409,
    too_large: 413,
    bad_media: 415,
    otp_locked: 429,
    resend_too_soon: 429,
    rate_limited: 429,
    unavailable: 503,
  };
  it('has exactly the §4.2 codes with their statuses', () => {
    expect([...CANDIDATE_ERROR_CODES].sort()).toEqual(Object.keys(expected).sort());
    expect(CANDIDATE_ERROR_STATUS).toEqual(expected);
    for (const code of CANDIDATE_ERROR_CODES) expect(ok(CandidateErrorCode, code)).toBe(true);
    expect(ok(CandidateErrorCode, 'forbidden')).toBe(false);
  });
  it('the body is {error: code} and never echoes input', () => {
    expect(CandidateErrorBody.parse({ error: 'out_of_order' })).toEqual({ error: 'out_of_order' });
    expect(ok(CandidateErrorBody, { error: { code: 'out_of_order' } })).toBe(false);
    expect(ok(CandidateErrorBody, { error: 'something <script>' })).toBe(false);
  });
  it('every code other than out_of_order stays a strict {error} body (F1)', () => {
    for (const code of CANDIDATE_ERROR_CODES) {
      expect(ok(CandidateErrorBody, { error: code, ackSeq: 4 }), code).toBe(false);
      expect(ok(CandidateErrorBody, { error: code }), code).toBe(true);
    }
  });
  it('out_of_order carries ackSeq = hw (§4.4) and nothing else', () => {
    expect(OutOfOrderBody.parse({ error: 'out_of_order', ackSeq: 4 })).toEqual({
      error: 'out_of_order',
      ackSeq: 4,
    });
    expect(ok(OutOfOrderBody, { error: 'out_of_order', ackSeq: 0 })).toBe(true);
    expect(ok(OutOfOrderBody, { error: 'out_of_order' })).toBe(false);
    expect(ok(OutOfOrderBody, { error: 'out_of_order', ackSeq: -1 })).toBe(false);
    expect(ok(OutOfOrderBody, { error: 'out_of_order', ackSeq: 1.5 })).toBe(false);
    expect(ok(OutOfOrderBody, { error: 'closed', ackSeq: 4 })).toBe(false);
    expect(ok(OutOfOrderBody, { error: 'out_of_order', ackSeq: 4, hw: 4 })).toBe(false);
    expectTypeOf<OutOfOrderBody>().toEqualTypeOf<{ error: 'out_of_order'; ackSeq: number }>();
  });
});

describe('CandidateTokenClaims (ADR-030 §7)', () => {
  const claims = {
    sub: id(40),
    candidate_id: id(40),
    invitation_id: id(41),
    org_id: id(42),
    typ: 'lobby',
    nonce: NONCE,
    iat: 1_790_000_000,
    exp: 1_790_001_800,
  };
  it('accepts a valid claim set for each typ', () => {
    for (const typ of ['lobby', 'session', 'portal']) {
      expect(ok(CandidateTokenClaims, { ...claims, typ })).toBe(true);
    }
  });
  it.each([
    ['sub differs from candidate_id', { sub: id(99) }],
    ['unknown typ', { typ: 'admin' }],
    ['short nonce', { nonce: 'n'.repeat(15) }],
    ['fractional iat', { iat: 1_790_000_000.5 }],
    ['fractional exp', { exp: 1_790_001_800.5 }],
    ['exp not after iat', { exp: 1_790_000_000 }],
    ['negative iat', { iat: -1 }],
    ['extra claim', { role: 'admin' }],
    ['org_id not a uuid', { org_id: 'x' }],
  ])('rejects %s', (_label, patch) => {
    expect(ok(CandidateTokenClaims, { ...claims, ...patch })).toBe(false);
  });
  it('accepts a 16-character nonce', () => {
    expect(ok(CandidateTokenClaims, { ...claims, nonce: 'n'.repeat(16) })).toBe(true);
  });
});

describe('TestPackage (§4.4): key-free by construction', () => {
  const pkg = {
    v: 1,
    testVersionId: id(50),
    rulesetVersionId: id(51),
    title: 'Sample test',
    language: 'en',
    durationSeconds: 1800,
    pasteBlocked: true,
    heartbeatSeconds: 10,
    signalCatalogVersion: 'd1-signals-1',
    sections,
    items: [
      {
        position: 1,
        sectionId: id(20),
        itemVersionId: id(52),
        kind: 'mcq',
        prompt: 'Pick one',
        options: [
          { id: 'a', label: 'First' },
          { id: 'b', label: 'Second' },
        ],
      },
      {
        position: 2,
        sectionId: id(21),
        itemVersionId: id(53),
        kind: 'written',
        prompt: 'Explain',
        maxChars: 2000,
      },
    ],
  };
  it('accepts a valid package and rejects extra or answer-bearing keys', () => {
    expect(TestPackage.parse(pkg)).toEqual(pkg);
    expect(ok(TestPackage, { ...pkg, v: 2 })).toBe(false);
    expect(ok(TestPackage, { ...pkg, pasteBlocked: false })).toBe(false);
    expect(ok(TestPackage, { ...pkg, cutoff: 40 })).toBe(false);
    expect(ok(TestPackage, { ...pkg, score: 0 })).toBe(false);
    const withKey = { ...pkg, items: [{ ...pkg.items[0], correctOptionId: 'a' }, pkg.items[1]] };
    expect(ok(TestPackage, withKey)).toBe(false);
    const withWeight = { ...pkg, sections: [{ ...sections[0], weight: 2 }, sections[1]] };
    expect(ok(TestPackage, withWeight)).toBe(false);
    const withRubric = { ...pkg, items: [pkg.items[0], { ...pkg.items[1], rubric: {} }] };
    expect(ok(TestPackage, withRubric)).toBe(false);
  });
  it('items must reference a section of the package and agree with their kind', () => {
    const unknownSection = {
      ...pkg,
      items: [{ ...pkg.items[0], sectionId: id(99) }, pkg.items[1]],
    };
    expect(ok(TestPackage, unknownSection)).toBe(false);
    const mcqNoOptions = { ...pkg, items: [{ ...pkg.items[0], options: undefined }, pkg.items[1]] };
    expect(ok(TestPackage, mcqNoOptions)).toBe(false);
    const writtenWithOptions = {
      ...pkg,
      items: [pkg.items[0], { ...pkg.items[1], options: pkg.items[0]?.options }],
    };
    expect(ok(TestPackage, writtenWithOptions)).toBe(false);
    expect(ok(TestPackage, { ...pkg, durationSeconds: 59 })).toBe(false);
    expect(ok(TestPackage, { ...pkg, items: [] })).toBe(false);
  });
  it('no key at any depth names a key, rubric, weight, cutoff, score or outcome', () => {
    expect(
      keysMatching(
        TestPackage,
        /key|correct|answer|rubric|weight|cutoff|score|grade|band|outcome|result/i,
      ),
    ).toEqual([]);
  });
});

describe('SessionMirrorMessage (§4.4 code block)', () => {
  const message = {
    v: 1,
    jobKind: 'session_mirror',
    mirrorSeq: 1,
    jobKey: `${id(60)}:session_mirror:${id(51)}`,
    sessionId: id(60),
    orgId: id(42),
    invitationId: id(41),
    testVersionId: id(50),
    rulesetVersionId: id(51),
    consentId: id(61),
    state: 'submitted',
    receiptRef: 'ABCD1234',
    startedAt: T0,
    deadlineAt: T1,
    submittedAt: T2,
    lastEventSeq: 42,
    streamCount: 2,
    resumeCount: 1,
    served: [{ position: 1, itemVersionId: id(52), servedAt: T0 }],
    evidence: {
      finalKey: 'sessions/o/s/final.json',
      finalSha256: HEX,
      eventsKey: 'sessions/o/s/events.ndjson',
      eventsSha256: HEX,
    },
    replay: 'ok',
    signalCatalogVersion: 'd1-signals-1',
    coverage: { activeMs: 600000, coveredMs: 590000 },
    gaps: [{ from: T0, to: T1, label: 'connectivity' }],
    photo: {
      key: 'media/o/s/start_photo.jpg',
      sha256: HEX,
      bytes: 40000,
      mime: 'image/jpeg',
      blurredOnDevice: true,
    },
    photoSkippedReason: null,
  };
  it('accepts the message, with a photo or with a skipped reason', () => {
    expect(SessionMirrorMessage.parse(message)).toEqual(message);
    const skipped = {
      ...message,
      photo: null,
      photoSkippedReason: 'camera_denied',
      state: 'auto_submitted',
    };
    expect(ok(SessionMirrorMessage, skipped)).toBe(true);
  });
  it.each([
    ['extra key', { score: 1 }],
    ['v 2', { v: 2 }],
    ['wrong jobKind', { jobKind: 'quality_score' }],
    ['mirrorSeq 2', { mirrorSeq: 2 }],
    ['bad receiptRef', { receiptRef: 'abc' }],
    ['unknown state', { state: 'in_progress' }],
    ['negative lastEventSeq', { lastEventSeq: -1 }],
    ['zero streams', { streamCount: 0 }],
    ['bad replay', { replay: 'unknown' }],
    ['gap with another label', { gaps: [{ from: T0, to: T1, label: 'focus' }] }],
    ['gap with extra key', { gaps: [{ from: T0, to: T1, label: 'connectivity', n: 1 }] }],
    [
      'photo not blurred',
      { photo: { key: 'k', sha256: HEX, bytes: 1, mime: 'image/jpeg', blurredOnDevice: false } },
    ],
    [
      'photo not jpeg',
      { photo: { key: 'k', sha256: HEX, bytes: 1, mime: 'image/png', blurredOnDevice: true } },
    ],
    ['unknown skipped reason', { photoSkippedReason: 'busy' }],
    [
      '51 gaps',
      { gaps: Array.from({ length: 51 }, () => ({ from: T0, to: T1, label: 'connectivity' })) },
    ],
    ['evidence with an extra key', { evidence: { ...message.evidence, signals: [] } }],
  ])('rejects %s', (_label, patch) => {
    expect(ok(SessionMirrorMessage, { ...message, ...patch })).toBe(false);
  });
  it('carries no signal list, answer text or identity beyond ids', () => {
    expect(
      keysMatching(SessionMirrorMessage, /signals|text|answer|score|band|name|email|ip$/i),
    ).toEqual([]);
  });
});

describe('CandidateRpc method schemas (§4.2)', () => {
  const photoSha = { sha256: HEX };
  it('inviteResolve: hash lookup in, ids and state out, no contact address', () => {
    expect(ok(InviteResolveRpcIn, { token: LINK })).toBe(true);
    expect(ok(InviteResolveRpcIn, { token: LINK, orgId: id(1) })).toBe(false);
    const out = {
      invitationId: id(41),
      orgId: id(42),
      candidateId: id(40),
      state: 'sent',
      title: 'Sample test',
      durationMinutes: 30,
    };
    expect(InviteResolveRpcOut.parse(out)).toEqual(out);
    expect(ok(InviteResolveRpcOut, { ...out, contactEmail: 'a@example.test' })).toBe(false);
    expect(keysMatching(InviteResolveRpcOut, /email|contact|phone|address|to$/i)).toEqual([]);
  });
  it('messagingSend: ids, code and key in; no address either way', () => {
    const input = {
      invitationId: id(41),
      orgId: id(42),
      code: '123456',
      idempotencyKey: `${id(41)}:otp:1`,
    };
    expect(MessagingSendRpcIn.parse(input)).toEqual(input);
    expect(ok(MessagingSendRpcIn, { ...input, code: '12' })).toBe(false);
    expect(ok(MessagingSendRpcIn, { ...input, to: 'a@example.test' })).toBe(false);
    expect(MessagingSendRpcOut.parse({ ok: true })).toEqual({ ok: true });
    expect(keysMatching(MessagingSendRpcIn, /email|contact|address|^to$/i)).toEqual([]);
  });
  it('lobbyMint', () => {
    const input = { invitationId: id(41), orgId: id(42), nonce: NONCE };
    expect(LobbyMintRpcIn.parse(input)).toEqual(input);
    expect(ok(LobbyMintRpcIn, { ...input, nonce: 'short' })).toBe(false);
    const out = { lobbyToken: FAKE_JWS, expiresAt: T1, next: 'consent' };
    expect(LobbyMintRpcOut.parse(out)).toEqual(out);
  });
  it('every method after lobbyMint takes the raw lobby token', () => {
    const base = { lobbyToken: FAKE_JWS };
    expect(ok(AgeDeclareRpcIn, { ...base, adult: true })).toBe(true);
    expect(ok(AgeDeclareRpcIn, { adult: true })).toBe(false);
    expect(AgeDeclareRpcOut.parse({ blocked: true })).toEqual({ blocked: true });
    expect(ok(NoticeGetRpcIn, base)).toBe(true);
    expect(ok(NoticeGetRpcIn, {})).toBe(false);
    expect(
      ok(ConsentRecordRpcIn, {
        ...base,
        noticeVersionId: id(9),
        renderedSha256: HEX,
        accepted: true,
      }),
    ).toBe(true);
    expect(
      ok(ConsentRecordRpcIn, {
        ...base,
        noticeVersionId: id(9),
        renderedSha256: HEX,
        accepted: false,
      }),
    ).toBe(false);
    expect(ok(PhotoPermitRpcIn, base)).toBe(true);
    const permit = { orgId: id(42), sessionId: id(60), locked: false };
    expect(PhotoPermitRpcOut.parse(permit)).toEqual(permit);
    expect(ok(SessionGrantRpcIn, { ...base, rulesAcknowledged: true, photo: photoSha })).toBe(true);
    expect(
      ok(SessionGrantRpcIn, {
        ...base,
        rulesAcknowledged: true,
        photo: { skippedReason: 'no_camera' },
      }),
    ).toBe(true);
    expect(ok(SessionGrantRpcIn, { ...base, rulesAcknowledged: true })).toBe(false);
  });
  it('sessionGrant out: the §4.2 fields, adultConfirmed fixed true, startedAt only on resume', () => {
    const out = {
      resume: false,
      startedAt: null,
      durationSeconds: 1800,
      sessionToken: FAKE_JWS,
      nonce: NONCE,
      packageKey: `packages/${id(50)}.json`,
      packageSha256: HEX,
      testVersionId: id(50),
      rulesetVersionId: id(51),
      consentId: id(61),
      adultConfirmed: true,
      sessionId: id(60),
    };
    expect(SessionGrantRpcOut.parse(out)).toEqual(out);
    expect(ok(SessionGrantRpcOut, { ...out, resume: true, startedAt: T0 })).toBe(true);
    expect(ok(SessionGrantRpcOut, { ...out, resume: true, startedAt: null })).toBe(true);
    expect(ok(SessionGrantRpcOut, { ...out, resume: false, startedAt: T0 })).toBe(false); // F4
    expect(ok(SessionGrantRpcOut, { ...out, adultConfirmed: false })).toBe(false);
    expect(ok(SessionGrantRpcOut, { ...out, durationSeconds: 0 })).toBe(false);
    expect(ok(SessionGrantRpcOut, { ...out, score: 1 })).toBe(false);
  });
  it('sessionStarted: claim-derived ids and the DO clock in, the stored startedAt out', () => {
    const input = { invitationId: id(41), orgId: id(42), sessionId: id(60), startedAt: T0 };
    expect(SessionStartedRpcIn.parse(input)).toEqual(input);
    expect(ok(SessionStartedRpcIn, { ...input, startedAt: 'yesterday' })).toBe(false);
    expect(SessionStartedRpcOut.parse({ startedAt: T0 })).toEqual({ startedAt: T0 });
  });
  it('the registry names the nine methods and every entry is an in/out pair', () => {
    expect(Object.keys(CandidateRpcSchemas).sort()).toEqual([
      'ageDeclare',
      'consentRecord',
      'inviteResolve',
      'lobbyMint',
      'messagingSend',
      'noticeGet',
      'photoPermit',
      'sessionGrant',
      'sessionStarted',
    ]);
    for (const pair of Object.values(CandidateRpcSchemas)) {
      expect(Object.keys(pair).sort()).toEqual(['in', 'out']);
    }
  });
});

describe('candidate-facing responses carry no score, band, grade, outcome, cutoff, key or rubric (rules 1, 5)', () => {
  const FORBIDDEN = /score|band|grade|outcome|cutoff|answerKey|rubric/i;
  const responses: [string, z.ZodType][] = [
    ['TestPackage', TestPackage],
    ['SessionView', SessionView],
    ['Receipt', Receipt],
    ['ServedItem', ServedItem],
    ['InviteResolveRes', InviteResolveRes],
    ['OtpRequestRes', OtpRequestRes],
    ['OtpVerifyRes', OtpVerifyRes],
    ['NoticeRes', NoticeRes],
    ['PhotoRes', PhotoRes],
    ['SessionStartRes', SessionStartRes],
    ['SessionAttachRes', SessionAttachRes],
    ['EventBatchAck', EventBatchAck],
    ['OkRes', OkRes],
    ['CandidateErrorBody', CandidateErrorBody],
    // M1 (R5-9): the v2 session shapes the candidate reads.
    ['SessionViewV2', SessionViewV2],
    ['ServedItemV2', ServedItemV2],
    ['SessionStartResV2', SessionStartResV2],
    ['SessionAttachResV2', SessionAttachResV2],
  ];
  it.each(responses)('%s', (_name, schema) => {
    expect(keysMatching(schema, FORBIDDEN)).toEqual([]);
  });
  it('every candidate schema is strict at every depth', () => {
    const all: z.ZodType[] = [
      ...responses.map(([, s]) => s),
      InviteResolveReq,
      OtpRequestReq,
      OtpVerifyReq,
      AgeDeclareReq,
      ConsentReq,
      SessionStartReq,
      EventBatchReq,
      SubmitReq,
      ClientEvent,
      CandidateTokenClaims,
      SessionMirrorMessage,
      TestPackageV2,
      ...Object.values(CandidateRpcSchemas).flatMap((pair) => [pair.in, pair.out]),
    ];
    for (const schema of all) expect(allObjectsStrict(schema)).toBe(true);
  });
});

// ---- The two R2 evidence files (F2, §4.4, L-21) -------------------------------------------------------------------

describe('EvidenceEventLine (events.ndjson, L-21, rule 7)', () => {
  const base = { gseq: 7, streamId: id(31), t: 1200, tServer: T1 };
  const lines: Record<string, Record<string, unknown>> = {
    heartbeat: { ...base, kind: 'heartbeat' },
    paste: { ...base, kind: 'signal', sig: 'paste', item: 2, len: 120 },
    'paste outside an item': { ...base, kind: 'signal', sig: 'paste', item: null, len: 0 },
    drop: { ...base, kind: 'signal', sig: 'drop', item: 2, len: 10, dt: 'files' },
    untrusted_input: {
      ...base,
      kind: 'signal',
      sig: 'untrusted_input',
      item: 2,
      via: 'input',
      count: 3,
    },
    tab_hidden: { ...base, kind: 'signal', sig: 'tab_hidden', item: 2, ms: 4000 },
    fullscreen_exit: { ...base, kind: 'signal', sig: 'fullscreen_exit', item: null },
  };
  it.each(Object.entries(lines))('accepts %s', (_name, line) => {
    expect(EvidenceEventLine.parse(line)).toEqual(line);
  });
  it('holds signal and heartbeat only: no answer.* kind, whatever else it carries', () => {
    expect(
      ok(EvidenceEventLine, { ...base, kind: 'answer.text', item: 1, p: 0, d: 0, i: 'x' }),
    ).toBe(false);
    expect(ok(EvidenceEventLine, { ...base, kind: 'answer.choice', item: 1, option: 'a' })).toBe(
      false,
    );
    expect(ok(EvidenceEventLine, { ...base, kind: 'answer' })).toBe(false);
    expect(ok(EvidenceEventLine, { ...base, kind: 'keystroke' })).toBe(false);
  });
  it('uses the session-global gseq (from 1) and the server time, not the per-stream seq', () => {
    expect(ok(EvidenceEventLine, { ...lines.heartbeat, gseq: 0 })).toBe(false);
    expect(ok(EvidenceEventLine, { ...lines.heartbeat, gseq: 1.5 })).toBe(false);
    expect(ok(EvidenceEventLine, { ...lines.heartbeat, seq: 3 })).toBe(false);
    const noGseq = { ...lines.heartbeat, gseq: undefined };
    expect(ok(EvidenceEventLine, noGseq)).toBe(false);
    const noServerTime = { ...lines.heartbeat, tServer: undefined };
    expect(ok(EvidenceEventLine, noServerTime)).toBe(false);
    expect(ok(EvidenceEventLine, { ...lines.heartbeat, tServer: 'yesterday' })).toBe(false);
    expect(ok(EvidenceEventLine, { ...lines.heartbeat, t: -1 })).toBe(false);
    expect(ok(EvidenceEventLine, { ...lines.heartbeat, streamId: 'x' })).toBe(false);
  });
  it('a heartbeat has no payload; a signal has exactly its §4.6 payload', () => {
    expect(ok(EvidenceEventLine, { ...lines.heartbeat, payload: {} })).toBe(false);
    expect(ok(EvidenceEventLine, { ...lines.heartbeat, item: 1 })).toBe(false);
    expect(ok(EvidenceEventLine, { ...lines.paste, dt: 'text' })).toBe(false);
    expect(ok(EvidenceEventLine, { ...lines.paste, len: undefined })).toBe(false);
    expect(ok(EvidenceEventLine, { ...lines.drop, dt: 'html' })).toBe(false);
    expect(ok(EvidenceEventLine, { ...lines.untrusted_input, count: 0 })).toBe(false);
    expect(ok(EvidenceEventLine, { ...lines.tab_hidden, ms: -1 })).toBe(false);
    expect(ok(EvidenceEventLine, { ...lines.paste, sig: 'copy' })).toBe(false);
    expect(ok(EvidenceEventLine, { ...lines.paste, extra: 1 })).toBe(false);
    for (const key of ['text', 'content', 'clipboard', 'answer', 'name', 'fileName', 'file']) {
      expect(ok(EvidenceEventLine, { ...lines.paste, [key]: 'x' }), key).toBe(false);
      expect(ok(EvidenceEventLine, { ...lines.heartbeat, [key]: 'x' }), key).toBe(false);
    }
  });
  it('carries exactly the client signal payload, minus the client seq', () => {
    const payloadKeys = (schema: z.ZodType) =>
      schemaKeys(schema).filter((key) => !['seq', 'gseq', 'streamId', 'tServer'].includes(key));
    expect(payloadKeys(EvidenceEventLine)).toEqual(payloadKeys(ClientEvent).filter(isSignalKey));
  });
  it('no key at any depth names text, content, clipboard, answer, name or file (L-21, rule 7)', () => {
    expect(keysMatching(EvidenceEventLine, /text|content|clipboard|answer|name|file/i)).toEqual([]);
    expect(schemaKeys(EvidenceEventLine)).toEqual([
      'count',
      'dt',
      'gseq',
      'item',
      'kind',
      'len',
      'ms',
      'sig',
      'streamId',
      't',
      'tServer',
      'via',
    ]);
  });
  it('is strict at every depth', () => {
    expect(allObjectsStrict(EvidenceEventLine)).toBe(true);
  });
  it('infers the line type', () => {
    expectTypeOf<EvidenceEventLine>().toMatchTypeOf<{
      gseq: number;
      kind: 'signal' | 'heartbeat';
    }>();
  });
});

/** Keys of the signal envelope and payload (everything in ClientEvent except answer-only keys). */
function isSignalKey(key: string): boolean {
  // Answer-edit keys, and section.finish's sectionId (M1): neither kind is an evidence line.
  return !['p', 'd', 'i', 'option', 'sectionId'].includes(key);
}

describe('FinalAnswers (final.json, §4.4)', () => {
  const text = { position: 1, kind: 'text', text: 'my answer', sha256: HEX, finalSeq: 9 };
  const choice = { position: 2, kind: 'choice', choice: 'a', sha256: HEX, finalSeq: 4 };
  const file = { v: 1, sessionId: id(60), answers: [text, choice] };
  it('accepts text and choice answers', () => {
    expect(FinalAnswers.parse(file)).toEqual(file);
    expect(ok(FinalAnswers, { ...file, answers: [] })).toBe(true);
    expect(ok(FinalAnswers, { ...file, answers: [{ ...choice, choice: null }] })).toBe(true); // cleared
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, text: '' }] })).toBe(true);
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, finalSeq: 0 }] })).toBe(true);
  });
  it('text iff kind text, choice iff kind choice', () => {
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, choice: 'a' }] })).toBe(false);
    expect(ok(FinalAnswers, { ...file, answers: [{ ...choice, text: 'x' }] })).toBe(false);
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, text: undefined }] })).toBe(false);
    expect(ok(FinalAnswers, { ...file, answers: [{ ...choice, choice: undefined }] })).toBe(false);
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, kind: 'choice' }] })).toBe(false);
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, kind: 'audio' }] })).toBe(false);
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, text: null }] })).toBe(false);
  });
  it('bounds: text <= 10000, sha256 64 hex, positions and finalSeq integers', () => {
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, text: 'x'.repeat(10000) }] })).toBe(
      true,
    );
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, text: 'x'.repeat(10001) }] })).toBe(
      false,
    );
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, sha256: 'abc' }] })).toBe(false);
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, sha256: 'A'.repeat(64) }] })).toBe(
      false,
    );
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, position: 0 }] })).toBe(false);
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, finalSeq: -1 }] })).toBe(false);
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, finalSeq: 1.5 }] })).toBe(false);
    expect(ok(FinalAnswers, { ...file, answers: [{ ...choice, choice: '' }] })).toBe(false);
  });
  it('one answer per position', () => {
    expect(ok(FinalAnswers, { ...file, answers: [text, { ...choice, position: 1 }] })).toBe(false);
  });
  it('is versioned, bound to a session and strict', () => {
    expect(ok(FinalAnswers, { ...file, v: 2 })).toBe(false);
    expect(ok(FinalAnswers, { ...file, sessionId: 'x' })).toBe(false);
    expect(ok(FinalAnswers, { ...file, extra: 1 })).toBe(false);
    expect(ok(FinalAnswers, { ...file, answers: [{ ...text, extra: 1 }] })).toBe(false);
    expect(ok(FinalAnswers, { v: 1, answers: [] })).toBe(false);
    expect(allObjectsStrict(FinalAnswers)).toBe(true);
  });
  it('carries no score, band, grade, outcome, cutoff, key or rubric (rules 1, 5)', () => {
    expect(keysMatching(FinalAnswers, /score|band|grade|outcome|cutoff|answerKey|rubric/i)).toEqual(
      [],
    );
  });
  it('infers the file type', () => {
    expectTypeOf<FinalAnswers>().toHaveProperty('v').toEqualTypeOf<1>();
  });
});

// ---- Exported types (F3): every exported wire schema has a same-named type ---------------------------------------------

describe('exported types', () => {
  it('infer the wire shapes (compile-time; typecheck is the assertion)', () => {
    expectTypeOf<Candidate.OtpRequestReq>().toEqualTypeOf<{ token: string }>();
    expectTypeOf<Candidate.OtpVerifyReq>().toEqualTypeOf<{ token: string; code: string }>();
    expectTypeOf<Candidate.AgeDeclareReq>().toEqualTypeOf<{ adult: boolean }>();
    expectTypeOf<Candidate.SubmitReq>().toEqualTypeOf<{ streamId: string; finalSeq: number }>();
    expectTypeOf<Candidate.CandidateErrorBody>().toEqualTypeOf<{
      error: Candidate.CandidateErrorCode;
    }>();
    expectTypeOf<Candidate.OkRes>().toEqualTypeOf<{ ok: true }>();
    expectTypeOf<Candidate.EventBatchAck>().toHaveProperty('ackSeq').toEqualTypeOf<number>();
    expectTypeOf<Candidate.EventBatchReq>().toHaveProperty('events').toEqualTypeOf<ClientEvent[]>();
    expectTypeOf<Candidate.SessionGrantRpcOut>().toHaveProperty('resume').toEqualTypeOf<boolean>();
    expectTypeOf<Candidate.SessionStartRes>().toMatchTypeOf<
      { sessionToken: string } | { state: 'submitted' }
    >();
  });
});

// ---- Rule sweeps over every exported schema (F6) ---------------------------------------------------------------------

/** Exported schemas with no object node (enums and formats). They are checked to be object-free instead. */
const SCALAR_EXPORTS = [
  'LinkToken',
  'InvitationState',
  'SessionState',
  'PhotoSkippedReason',
  'LobbyNext',
  'CandidateErrorCode',
];
const candidateExports = (Object.entries(Candidate) as [string, unknown][]).filter(
  (entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType,
);
const candidateObjectExports = candidateExports.filter(([name]) => !SCALAR_EXPORTS.includes(name));

describe('every candidate schema export (F6)', () => {
  it('the sweep sees the contracts it must (guards against an empty or shrunk sweep)', () => {
    const names = candidateExports.map(([name]) => name);
    for (const name of [
      'Receipt',
      'SessionView',
      'ClientEvent',
      'EventBatchReq',
      'EvidenceEventLine',
      'FinalAnswers',
      'OutOfOrderBody',
      'SessionMirrorMessage',
      'TestPackage',
      'SessionGrantRpcOut',
      'CandidateTokenClaims',
      ...SCALAR_EXPORTS,
    ]) {
      expect(names, name).toContain(name);
    }
    expect(candidateObjectExports.length).toBeGreaterThan(40);
  });
  it('the scalar exports really are object-free, so they are the only exemption', () => {
    for (const name of SCALAR_EXPORTS) {
      const schema = Candidate[name as keyof typeof Candidate] as z.ZodType;
      expect(allObjectsStrict(schema), name).toBe(false);
      expect(schemaNodes(schema).size, name).toBeGreaterThan(0);
    }
  });
  it.each(candidateExports)('%s: no combined-result key (rule 1)', (_name, schema) => {
    expect(keysMatching(schema, /overall|combined|total|trust|honesty|composite/i)).toEqual([]);
  });
  it.each(candidateExports)('%s: nothing from the never-build list (rule 7)', (_name, schema) => {
    expect(
      keysMatching(
        schema,
        /emotion|stress|personality|gaze|ai_?likeness|voiceprint|faceMatch|face_template|asn$/i,
      ),
    ).toEqual([]);
  });
  it.each(candidateObjectExports)('%s: strict at every depth', (_name, schema) => {
    expect(allObjectsStrict(schema)).toBe(true);
  });
});

// R2 security review #2: Postgres jsonb refuses U+0000 and lone surrogates, so such a text would make the mirror
// fail on every attempt (a candidate could keep their own session out of every result). Candidate text is refused
// at the contract instead: the edit event, the rebuilt final answer and the session view.
describe('candidate text is storable (no NUL, no lone surrogate)', () => {
  const BAD = ['a\u0000b', '\ud83d', 'x\udc00', '\udc00\ud83d'];
  const GOOD = ['plain', 'नमस्ते 👋', '😀', '', 'tab\tnew\nline'];

  it.each(GOOD)('isStorableText accepts %j', (s) => {
    expect(Candidate.isStorableText(s)).toBe(true);
  });
  it.each(BAD)('isStorableText refuses %j', (s) => {
    expect(Candidate.isStorableText(s)).toBe(false);
  });

  it('an answer.text edit event with such text is refused', () => {
    const event = (i: string) => ({ seq: 1, t: 0, kind: 'answer.text', item: 1, p: 0, d: 0, i });
    expect(Candidate.ClientEvent.safeParse(event('ok')).success).toBe(true);
    for (const s of BAD) expect(Candidate.ClientEvent.safeParse(event(s)).success).toBe(false);
  });

  it('a final.json text answer with such text is refused', () => {
    const final = (text: string) => ({
      v: 1,
      sessionId: '6c1f2e3d-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
      answers: [{ position: 1, kind: 'text', text, sha256: 'a'.repeat(64), finalSeq: 3 }],
    });
    expect(FinalAnswers.safeParse(final('ok')).success).toBe(true);
    for (const s of BAD) expect(FinalAnswers.safeParse(final(s)).success).toBe(false);
  });

  it('the refusal message never echoes the text', () => {
    const r = FinalAnswers.safeParse({
      v: 1,
      sessionId: '6c1f2e3d-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
      answers: [
        { position: 1, kind: 'text', text: 'secret\u0000x', sha256: 'a'.repeat(64), finalSeq: 3 },
      ],
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).not.toContain('secret');
  });
});

// ==== M1 candidate session v2 (specs/m1-test-authoring.md §4.6, §5; R5-8, R5-9, R5-19, R5-20, R5-42) ===============

const KEY_LIKE = /^key$|answer|correct|rubric|solution|weight|cutoff|score|grade|outcome/i;

describe('M1 client events and ack (R5-20)', () => {
  const finish = { seq: 3, t: 9000, kind: 'section.finish', sectionId: id(20) };
  it('section.finish {sectionId} joins the union; the v1 events are unchanged', () => {
    expect(ClientEvent.parse(finish)).toEqual(finish);
    expect(ok(ClientEvent, { ...finish, sectionId: 'x' })).toBe(false);
    expect(ok(ClientEvent, { seq: 3, t: 0, kind: 'section.finish' })).toBe(false);
    expect(ok(ClientEvent, { ...finish, position: 2 })).toBe(false);
    expect(ok(EventBatchReq, { streamId: id(31), events: [finish] })).toBe(true);
  });
  it('item.view is not an event (dropped by R5-20)', () => {
    expect(ok(ClientEvent, { seq: 3, t: 0, kind: 'item.view', position: 2 })).toBe(false);
  });
  it('section.finish is not an evidence line and not a signal', () => {
    expect(ok(ClientSignal, finish)).toBe(false);
    const line = { gseq: 1, streamId: id(31), t: 0, tServer: T1, kind: 'section.finish' };
    expect(ok(EvidenceEventLine, { ...line, sectionId: id(20) })).toBe(false);
  });
  const ack = { ackSeq: 12, serverNow: T0, deadlineAt: T1, state: 'in_progress' };
  it('the ack may list refusedSeqs: acknowledged, never applied', () => {
    expect(EventBatchAck.parse(ack)).toEqual(ack);
    const refused = { ...ack, refusedSeqs: [11, 12] };
    expect(EventBatchAck.parse(refused)).toEqual(refused);
    expect(ok(EventBatchAck, { ...ack, refusedSeqs: [] })).toBe(true);
    expect(ok(EventBatchAck, { ...ack, refusedSeqs: [13] })).toBe(false); // beyond the acknowledged mark
    expect(ok(EventBatchAck, { ...ack, refusedSeqs: [0] })).toBe(false);
    expect(ok(EventBatchAck, { ...ack, refusedSeqs: [11, 11] })).toBe(false);
    expect(ok(EventBatchAck, { ...ack, refusedSeqs: [1.5] })).toBe(false);
    const many = {
      ...ack,
      ackSeq: 500,
      refusedSeqs: Array.from({ length: 101 }, (_v, i) => i + 1),
    };
    expect(ok(EventBatchAck, many)).toBe(false);
  });
  it('section_closed is a 410 with a plain {error} body', () => {
    expect(CANDIDATE_ERROR_STATUS.section_closed).toBe(410);
    expect(CandidateErrorBody.parse({ error: 'section_closed' })).toEqual({
      error: 'section_closed',
    });
    expect(ok(OutOfOrderBody, { error: 'section_closed', ackSeq: 1 })).toBe(false);
  });
});

const sectionA = id(70);
const sectionB = id(71);
const twoOptions = [
  { id: 'a', label: 'One' },
  { id: 'b', label: 'Two' },
];
const pkgItem = (n: number, sectionId: string, extra: Record<string, unknown> = {}) => ({
  sectionId,
  itemVersionId: id(1000 + n),
  itemId: id(2000 + n),
  kind: 'mcq',
  prompt: `[synthetic] Item ${n}`,
  options: twoOptions,
  skillKey: 'quant',
  difficultyBand: n % 5,
  ...extra,
});
const writtenPkgItem = {
  sectionId: sectionB,
  itemVersionId: id(1004),
  itemId: id(2004),
  kind: 'written',
  prompt: '[synthetic] Write a reply',
  maxChars: 2000,
  skillKey: 'written_communication',
  difficultyBand: 2,
};
const secA = {
  id: sectionA,
  title: 'Quant',
  position: 1,
  navigation: 'free',
  shuffleItems: true,
  shuffleOptions: true,
  draw: { count: 2, strata: [] as unknown[] },
};
const secB = {
  id: sectionB,
  title: 'Writing',
  position: 2,
  navigation: 'forward_only',
  shuffleItems: false,
  shuffleOptions: false,
  pasteRule: 'allowed_logged',
  draw: null,
};
const variantItem = pkgItem(2, sectionA, {
  media: [{ hash: HEX, ext: 'png', alt: 'A chart' }],
  variants: [
    {
      variantId: id(3001),
      prompt: '[synthetic] Variant 1',
      options: [
        { id: 'a', label: '3' },
        { id: 'b', label: '4' },
      ],
    },
  ],
});
const pkgV2 = {
  v: 2,
  testVersionId: id(50),
  rulesetVersionId: id(51),
  title: 'Sample v2 test',
  language: 'en',
  durationSeconds: 1800,
  heartbeatSeconds: 10,
  signalCatalogVersion: 'd1-signals-v1',
  captureSignals: ['paste', 'drop', 'untrusted_input'],
  sections: [secA, secB],
  items: [pkgItem(1, sectionA), variantItem, pkgItem(3, sectionA), writtenPkgItem],
};
const withItems = (items: unknown[]) => ({ ...pkgV2, items });
const withSections = (sections: unknown[]) => ({ ...pkgV2, sections });
const replaceFirst = (item: unknown) => withItems([item, ...pkgV2.items.slice(1)]);
const replaceWritten = (item: unknown) => withItems([...pkgV2.items.slice(0, 3), item]);

describe('TestPackageV2 (§5; AT-M1-20)', () => {
  it('accepts a package with a pool section and an inline section', () => {
    expect(TestPackageV2.parse(pkgV2)).toEqual(pkgV2);
  });
  it('the v1 package is unchanged and is not a v2 package', () => {
    expect(ok(TestPackageV2, { ...pkgV2, v: 1 })).toBe(false);
    expect(ok(TestPackage, pkgV2)).toBe(false);
  });
  it('AT-M1-20: no key-like field at any depth (schema walk); skillKey is the only "key" name', () => {
    expect(keysMatching(TestPackageV2, KEY_LIKE)).toEqual([]);
    expect(keysMatching(TestPackageV2, /key/i)).toEqual(['skillKey']);
    // `difficultyBand` is a difficulty stratum (0-4), not an integrity band; it is the only "band" name.
    expect(keysMatching(TestPackageV2, /band/i)).toEqual(['difficultyBand']);
    for (const extra of ['key', 'correctOptionId', 'answer', 'answerKey', 'rubric', 'weight']) {
      expect(
        ok(TestPackageV2, replaceFirst({ ...pkgItem(1, sectionA), [extra]: 'a' })),
        extra,
      ).toBe(false);
    }
    expect(ok(TestPackageV2, { ...pkgV2, qualityCutoff: 40 })).toBe(false);
  });
  const strata = (rows: unknown[], count = 2) =>
    withSections([{ ...secA, draw: { count, strata: rows } }, secB]);
  it.each([
    ['an item in an unknown section', () => withItems([...pkgV2.items, pkgItem(9, id(99))])],
    ['a draw larger than the section', () => strata([], 4)],
    ['a draw of 0', () => strata([], 0)],
    [
      'strata that do not sum to the draw',
      () => strata([{ skillKey: 'quant', difficultyBand: 1, count: 1 }]),
    ],
    [
      'a stratum beyond its eligible items',
      () => strata([{ skillKey: 'quant', difficultyBand: 1, count: 2 }]),
    ],
    [
      'a section without items',
      () => withSections([secA, secB, { ...secB, id: id(72), position: 3 }]),
    ],
    ['duplicate section ids', () => withSections([secA, { ...secB, id: sectionA }])],
    ['duplicate section positions', () => withSections([secA, { ...secB, position: 1 }])],
    ['an item version twice', () => withItems([...pkgV2.items, pkgItem(1, sectionA)])],
    [
      'an mcq item without options',
      () => replaceFirst({ ...pkgItem(1, sectionA), options: undefined }),
    ],
    [
      'a written item with options',
      () => replaceWritten({ ...writtenPkgItem, options: twoOptions }),
    ],
    [
      'variants on a written item',
      () =>
        replaceWritten({
          ...writtenPkgItem,
          variants: [{ variantId: id(3009), prompt: 'x', options: twoOptions }],
        }),
    ],
    ['a timer on one section only', () => withSections([{ ...secA, timeLimitSeconds: 600 }, secB])],
    ['an unknown navigation', () => withSections([{ ...secA, navigation: 'back' }, secB])],
    ['a difficulty band of 5', () => replaceFirst({ ...pkgItem(1, sectionA), difficultyBand: 5 })],
    ['an unknown captured signal', () => ({ ...pkgV2, captureSignals: ['gaze'] })],
    ['a duplicate captured signal', () => ({ ...pkgV2, captureSignals: ['paste', 'paste'] })],
    [
      'an image with a bad extension',
      () => replaceFirst({ ...pkgItem(1, sectionA), media: [{ hash: HEX, ext: 'gif', alt: 'x' }] }),
    ],
    [
      'an image without alt text',
      () => replaceFirst({ ...pkgItem(1, sectionA), media: [{ hash: HEX, ext: 'png', alt: '' }] }),
    ],
    ['a heartbeat other than 10', () => ({ ...pkgV2, heartbeatSeconds: 5 })],
  ])('refuses %s', (_label, make) => {
    expect(ok(TestPackageV2, make())).toBe(false);
  });
  it('accepts timers on every section and strata that fit', () => {
    const timed = withSections([
      { ...secA, timeLimitSeconds: 900 },
      { ...secB, timeLimitSeconds: 900 },
    ]);
    expect(ok(TestPackageV2, timed)).toBe(true);
    const fits = [
      { skillKey: 'quant', difficultyBand: 1, count: 1 },
      { skillKey: 'quant', difficultyBand: 2, count: 1 },
    ];
    expect(ok(TestPackageV2, strata(fits))).toBe(true);
  });
  it('holds up to 5,000 eligible items but serves a candidate at most 100 (R5-9)', () => {
    const big = Array.from({ length: 4999 }, (_v, i) => pkgItem(10 + i, sectionA));
    const pkg5000 = withItems([...big, writtenPkgItem]);
    expect(ok(TestPackageV2, pkg5000)).toBe(true);
    expect(ok(TestPackageV2, withItems([...big, pkgItem(9000, sectionA), writtenPkgItem]))).toBe(
      false,
    );
    const drawOf = (count: number) => [{ ...secA, draw: { count, strata: [] } }, secB];
    expect(ok(TestPackageV2, { ...pkg5000, sections: drawOf(100) })).toBe(false); // 100 drawn + 1 inline
    expect(ok(TestPackageV2, { ...pkg5000, sections: drawOf(99) })).toBe(true);
  });
});

const servedV2 = {
  position: 1,
  kind: 'mcq',
  sectionId: sectionA,
  prompt: '[synthetic] Variant 1',
  options: [
    { id: 'b', label: '4' },
    { id: 'a', label: '3' },
  ],
  media: [{ hash: HEX, alt: 'A chart' }],
  variantId: id(3001),
  servedAt: T0,
};
const sectionViewA = {
  id: sectionA,
  title: 'Quant',
  position: 1,
  navigation: 'free',
  pasteRule: 'blocked',
  state: 'open',
  deadlineAt: T1,
};
const sectionViewB = {
  id: sectionB,
  title: 'Writing',
  position: 2,
  navigation: 'forward_only',
  pasteRule: 'allowed_logged',
  state: 'not_entered',
};
const viewV2 = {
  v: 2,
  sessionId: id(30),
  state: 'in_progress',
  serverNow: T0,
  startedAt: T0,
  deadlineAt: T1,
  streamId: id(31),
  heartbeatSeconds: 10,
  title: 'Sample v2 test',
  sections: [sectionViewA, sectionViewB],
  items: [{ position: 1, sectionId: sectionA, kind: 'mcq', servedAt: T0 }],
  answers: [{ position: 1, choice: 'b' }],
};

describe('ServedItemV2 and SessionViewV2 (R5-9, §4.6)', () => {
  it('a served item carries media {hash, alt}, options in served order and its variant id', () => {
    expect(ServedItemV2.parse(servedV2)).toEqual(servedV2);
    const plain = { ...servedV2, media: undefined, variantId: undefined };
    expect(ok(ServedItemV2, plain)).toBe(true);
    const keyed = { ...servedV2, media: [{ hash: HEX, alt: 'x', key: 'item-media/x.png' }] };
    expect(ok(ServedItemV2, keyed)).toBe(false);
    const five = { ...servedV2, media: Array.from({ length: 5 }, () => ({ hash: HEX, alt: 'x' })) };
    expect(ok(ServedItemV2, five)).toBe(false);
    expect(ok(ServedItemV2, { ...servedV2, kind: 'written' })).toBe(false);
    expect(ok(ServedItemV2, { ...servedV2, correctOptionId: 'b' })).toBe(false);
    expect(keysMatching(ServedItemV2, KEY_LIKE)).toEqual([]);
  });
  it('a view lists per-section navigation, paste rule, state and deadline', () => {
    expect(SessionViewV2.parse(viewV2)).toEqual(viewV2);
    const closed = { ...viewV2, sections: [{ ...sectionViewA, state: 'closed' }, sectionViewB] };
    expect(ok(SessionViewV2, closed)).toBe(true);
    const receipt = { receiptRef: 'ABCD1234', submittedAt: T1 };
    expect(ok(SessionViewV2, { ...viewV2, receipt })).toBe(true);
  });
  it.each([
    ['the v1 pasteBlocked flag', { pasteBlocked: true }],
    ['v 1', { v: 1 }],
    [
      'an unknown section state',
      { sections: [{ ...sectionViewA, state: 'paused' }, sectionViewB] },
    ],
    [
      'an unknown paste rule',
      { sections: [{ ...sectionViewA, pasteRule: 'allowed' }, sectionViewB] },
    ],
    [
      '11 sections',
      {
        sections: Array.from({ length: 11 }, (_v, i) => ({
          ...sectionViewA,
          id: id(80 + i),
          position: i + 1,
        })),
      },
    ],
    [
      '101 items',
      {
        items: Array.from({ length: 101 }, (_v, i) => ({
          position: i + 1,
          sectionId: sectionA,
          kind: 'mcq',
          servedAt: null,
        })),
      },
    ],
    [
      'an item in an unknown section',
      { items: [{ position: 1, sectionId: id(99), kind: 'mcq', servedAt: T0 }] },
    ],
  ])('refuses %s', (_label, patch) => {
    expect(ok(SessionViewV2, { ...viewV2, ...patch })).toBe(false);
  });
  it('the v1 view is unchanged and is not a v2 view', () => {
    expect(ok(SessionView, view)).toBe(true);
    expect(ok(SessionViewV2, view)).toBe(false);
    expect(ok(SessionView, viewV2)).toBe(false);
  });
  it('start and attach responses carry the v2 view', () => {
    expect(ok(SessionAttachResV2, { view: viewV2 })).toBe(true);
    expect(ok(SessionAttachResV2, { view })).toBe(false);
    expect(ok(SessionStartResV2, { sessionToken: FAKE_JWS, expiresAt: T1, view: viewV2 })).toBe(
      true,
    );
    const receipt = { receiptRef: 'ABCD1234', submittedAt: T1 };
    expect(ok(SessionStartResV2, { state: 'submitted', receipt })).toBe(true);
  });
});

// A v1 mirror message exactly as the D1 jobs fixture builds it (workers/jobs/src/queue/test-fixtures.ts), so a v1
// message and a sweep-re-enqueued v1 mirror.json keep parsing through the union (R5-8, AT-M1-21).
const mirrorV1 = {
  v: 1,
  jobKind: 'session_mirror',
  mirrorSeq: 1,
  jobKey: `${id(60)}:session_mirror:${id(51)}`,
  sessionId: id(60),
  orgId: id(42),
  invitationId: id(41),
  testVersionId: id(50),
  rulesetVersionId: id(51),
  consentId: id(61),
  state: 'submitted',
  receiptRef: 'ABCD1234',
  startedAt: '2026-10-15T09:00:00.000Z',
  deadlineAt: '2026-10-15T10:00:00.000Z',
  submittedAt: '2026-10-15T09:30:00.000Z',
  lastEventSeq: 42,
  streamCount: 2,
  resumeCount: 1,
  served: [{ position: 1, itemVersionId: id(52), servedAt: '2026-10-15T09:00:05.000Z' }],
  evidence: {
    finalKey: `sessions/${id(42)}/${id(60)}/final.json`,
    finalSha256: HEX,
    eventsKey: `sessions/${id(42)}/${id(60)}/events.ndjson`,
    eventsSha256: HEX,
  },
  replay: 'ok',
  signalCatalogVersion: 'd1-signals-v1',
  coverage: { activeMs: 600000, coveredMs: 590000 },
  gaps: [],
  photo: null,
  photoSkippedReason: 'declined',
};
const servedPool = {
  position: 1,
  itemVersionId: id(1002),
  servedAt: T0,
  sectionId: sectionA,
  itemVariantId: id(3001),
  optionOrder: ['b', 'a'],
  drawSeedSha256: HEX,
};
const servedInline = { position: 3, itemVersionId: id(1004), servedAt: T1, sectionId: sectionB };
const drawA = {
  sectionId: sectionA,
  itemVersionIds: [id(1002), id(1001)],
  itemVariantIds: [id(3001), null],
};
const mirrorV2 = {
  ...mirrorV1,
  v: 2,
  served: [servedPool, servedInline],
  poolSectionIds: [sectionA],
  draws: [drawA],
};

describe('SessionMirrorMessage v1 | v2 (R5-8, R5-19, R5-42; AT-M1-21)', () => {
  it('a v1 message (the D1 jobs fixture) still parses, through the union and the v1 member', () => {
    expect(SessionMirrorMessage.parse(mirrorV1)).toEqual(mirrorV1);
    expect(SessionMirrorMessageV1.parse(mirrorV1)).toEqual(mirrorV1);
    expect(ok(SessionMirrorMessageV2, mirrorV1)).toBe(false);
  });
  it('a sweep-re-enqueued v1 mirror.json (JSON round trip) still parses', () => {
    expect(ok(SessionMirrorMessage, JSON.parse(JSON.stringify(mirrorV1)))).toBe(true);
  });
  it('a v2 message with draws parses and narrows on v', () => {
    const parsed = SessionMirrorMessage.parse(mirrorV2);
    expect(parsed).toEqual(mirrorV2);
    if (parsed.v === 2) {
      expectTypeOf(parsed.draws).toEqualTypeOf<
        { sectionId: string; itemVersionIds: string[]; itemVariantIds: (string | null)[] }[]
      >();
    }
    expect(ok(SessionMirrorMessage, { ...mirrorV2, served: [], draws: [] })).toBe(true);
  });
  it('R5-42: a served item of a pool section missing from its draw is refused as malformed', () => {
    const missing = { ...mirrorV2, served: [{ ...servedPool, itemVersionId: id(1003) }] };
    expect(ok(SessionMirrorMessage, missing)).toBe(false);
    expect(ok(SessionMirrorMessage, { ...mirrorV2, draws: [] })).toBe(false);
  });
  it.each([
    ['a v1 served row (no sectionId) in a v2 message', { served: mirrorV1.served }],
    ['no draws', { draws: undefined }],
    ['no pool section list', { poolSectionIds: undefined }],
    ['a draw of a section that is not a pool section', { poolSectionIds: [] }],
    ['two draws for one section', { draws: [drawA, drawA] }],
    ['variant ids not parallel to the draw', { draws: [{ ...drawA, itemVariantIds: [id(3001)] }] }],
    ['an item drawn twice', { draws: [{ ...drawA, itemVersionIds: [id(1002), id(1002)] }] }],
    [
      'a served variant other than the drawn one',
      { served: [{ ...servedPool, itemVariantId: id(3002) }] },
    ],
    [
      'a served item without its drawn variant',
      { served: [{ ...servedPool, itemVariantId: undefined }] },
    ],
    ['an option order with a repeat', { served: [{ ...servedPool, optionOrder: ['a', 'a'] }] }],
    ['a bad draw seed hash', { served: [{ ...servedPool, drawSeedSha256: 'x' }] }],
    [
      '101 served rows',
      {
        served: Array.from({ length: 101 }, (_v, i) => ({
          ...servedInline,
          position: i + 1,
          itemVersionId: id(5000 + i),
        })),
      },
    ],
    ['an extra key', { score: 1 }],
  ])('refuses %s', (_label, patch) => {
    expect(ok(SessionMirrorMessage, { ...mirrorV2, ...patch })).toBe(false);
  });
  it('v2 carries no signal list, answer text, answer key or identity beyond ids', () => {
    expect(
      keysMatching(
        SessionMirrorMessageV2,
        /signals|text|answer|score|band|name|email|ip$|correct|rubric/i,
      ),
    ).toEqual([]);
    // The only "key" names are v1's storage keys (jobKey, evidence keys, photo key); v2 adds none.
    expect(keysMatching(SessionMirrorMessageV2, /key/i)).toEqual(
      keysMatching(SessionMirrorMessageV1, /key/i),
    );
    expect(allObjectsStrict(SessionMirrorMessageV2)).toBe(true);
  });
});
