// D1 candidate wire contracts (specs/d1-demo-slice.md §4.2-§4.6). Synthetic values only; no secret-shaped literals.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
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
  SessionStartedRpcIn,
  SessionStartedRpcOut,
  SessionStartReq,
  SessionStartRes,
  SessionView,
  SubmitReq,
  TestPackage,
  discardIdentityKeys,
} from './contracts-candidate.js';
import { allObjectsStrict, keysMatching, schemaKeys } from './contracts-schema-walk.js';

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
    expect(ok(CandidateErrorBody, { error: 'out_of_order', ackSeq: 4 })).toBe(false);
    expect(ok(CandidateErrorBody, { error: { code: 'out_of_order' } })).toBe(false);
    expect(ok(CandidateErrorBody, { error: 'something <script>' })).toBe(false);
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
      ...Object.values(CandidateRpcSchemas).flatMap((pair) => [pair.in, pair.out]),
    ];
    for (const schema of all) expect(allObjectsStrict(schema)).toBe(true);
  });
});
