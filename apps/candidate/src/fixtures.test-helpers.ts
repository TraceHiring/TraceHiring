// Synthetic wire samples for the candidate tests (no PII: fixed fake ids, invented titles). Each one parses with its
// zod contract (api.test.ts checks that), so a test that builds on them talks the edge's real shapes.
import type {
  EventBatchAck,
  NoticeRes,
  Receipt,
  ServedItem,
  SessionView,
} from '@trace/shared/contracts/candidate';

export const LINK_TOKEN = 'A'.repeat(22) + 'b'.repeat(21);
/** A compact JWS shape (format only; nothing verifies it in the app). */
export const LOBBY_TOKEN = 'fakeLobbyHead.fakeLobbyBody.fakeLobbySig';
export const SESSION_TOKEN = 'fakeSessionHead.fakeSessionBody.fakeSessionSig';

export const SESSION_ID = '11111111-1111-4111-8111-111111111111';
export const STREAM_ID = '22222222-2222-4222-8222-222222222222';
export const STREAM_ID_2 = '33333333-3333-4333-8333-333333333333';
export const SECTION_ID = '44444444-4444-4444-8444-444444444444';
export const NOTICE_ID = '55555555-5555-4555-8555-555555555555';
export const SHA = 'a'.repeat(64);

export const RECEIPT: Receipt = { receiptRef: 'ABCD2345', submittedAt: '2026-10-19T10:30:00.000Z' };

export const NOTICE: NoticeRes = {
  noticeVersionId: NOTICE_ID,
  language: 'en',
  bodyText: 'Synthetic notice.\n\n  Line two keeps its spaces.\nWhat we record: answers.',
  renderedSha256: SHA,
};

/** A view of a two-item test (an MCQ and a written item) that started `startedAgoMs` before `nowMs`. */
export const viewAt = (
  nowMs: number,
  {
    startedAgoMs = 0,
    durationMs = 30 * 60_000,
    streamId = STREAM_ID,
    answers = [],
    receipt,
  }: {
    startedAgoMs?: number;
    durationMs?: number;
    streamId?: string;
    answers?: SessionView['answers'];
    receipt?: Receipt;
  } = {},
): SessionView => ({
  sessionId: SESSION_ID,
  state: receipt === undefined ? 'in_progress' : 'submitted',
  serverNow: new Date(nowMs).toISOString(),
  startedAt: new Date(nowMs - startedAgoMs).toISOString(),
  deadlineAt: new Date(nowMs - startedAgoMs + durationMs).toISOString(),
  streamId,
  heartbeatSeconds: 10,
  pasteBlocked: true,
  title: 'Synthetic aptitude test',
  sections: [{ id: SECTION_ID, title: 'Section one', position: 1 }],
  items: [
    { position: 1, sectionId: SECTION_ID, kind: 'mcq', servedAt: null },
    { position: 2, sectionId: SECTION_ID, kind: 'written', servedAt: null },
  ],
  answers,
  ...(receipt === undefined ? {} : { receipt }),
});

export const MCQ_ITEM: ServedItem = {
  position: 1,
  kind: 'mcq',
  sectionId: SECTION_ID,
  prompt: 'Which number is even?',
  options: [
    { id: 'a', label: 'Three' },
    { id: 'b', label: 'Four' },
  ],
  servedAt: '2026-10-19T10:00:00.000Z',
};

export const WRITTEN_ITEM: ServedItem = {
  position: 2,
  kind: 'written',
  sectionId: SECTION_ID,
  prompt: 'Describe a queue in one paragraph.',
  maxChars: 2000,
  servedAt: '2026-10-19T10:00:00.000Z',
};

export const ackOf = (ackSeq: number, nowMs: number, deadlineMs: number): EventBatchAck => ({
  ackSeq,
  serverNow: new Date(nowMs).toISOString(),
  deadlineAt: new Date(deadlineMs).toISOString(),
  state: 'in_progress',
});

/** A JSON Response as the edge sends it. */
export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
