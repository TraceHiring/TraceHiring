// Synthetic wire samples for the candidate tests (no PII: fixed fake ids, invented titles). Each one parses with its
// zod contract (api.test.ts checks that), so a test that builds on them talks the edge's real shapes.
import type {
  EventBatchAck,
  NoticeRes,
  Receipt,
  ServedItem,
  ServedItemV2,
  SessionView,
  SessionViewV2,
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

// ---- Package v2 (M1, R5-9, R5-10, R5-20, R5-24) -----------------------------------------------------------------

export const SECTION_ID_2 = '66666666-6666-4666-8666-666666666666';
export const SECTION_ID_3 = '77777777-7777-4777-8777-777777777777';
export const STREAM_ID_3 = '88888888-8888-4888-8888-888888888888';

export type SectionV2 = SessionViewV2['sections'][number];

/** An MCQ section with free navigation (no paste rule: only written sections have one). */
export const mcqSection = (over: Partial<SectionV2> = {}): SectionV2 => ({
  id: SECTION_ID,
  title: 'Section one',
  position: 1,
  format: 'mcq',
  navigation: 'free',
  state: 'open',
  ...over,
});

/** A written section: always forward-only with a paste rule (R5-24, the contract's section rule). */
export const writtenSection = (over: Partial<SectionV2> = {}): SectionV2 => ({
  id: SECTION_ID_2,
  title: 'Section two',
  position: 2,
  format: 'written',
  navigation: 'forward_only',
  pasteRule: 'blocked',
  state: 'open',
  ...over,
});

/**
 * A v2 view: by default an MCQ section (positions 1, 2) and a written section (positions 3, 4), both open (an untimed
 * version). `slots` gives each section's number of positions, in section order.
 */
export const viewV2At = (
  nowMs: number,
  {
    startedAgoMs = 0,
    durationMs = 30 * 60_000,
    streamId = STREAM_ID,
    sections = [mcqSection(), writtenSection()],
    slots = sections.map(() => 2),
    served = [],
    answers = [],
    receipt,
  }: {
    startedAgoMs?: number;
    durationMs?: number;
    streamId?: string;
    sections?: SectionV2[];
    slots?: number[];
    /** Positions the DO has served (their `servedAt` is set). */
    served?: number[];
    answers?: SessionViewV2['answers'];
    receipt?: Receipt;
  } = {},
): SessionViewV2 => {
  const items: SessionViewV2['items'] = [];
  let position = 1;
  sections.forEach((section, s) => {
    for (let k = 0; k < (slots[s] ?? 0); k += 1) {
      items.push({
        position,
        sectionId: section.id,
        kind: section.format,
        servedAt: served.includes(position) ? new Date(nowMs).toISOString() : null,
      });
      position += 1;
    }
  });
  return {
    v: 2,
    sessionId: SESSION_ID,
    state: receipt === undefined ? 'in_progress' : 'submitted',
    serverNow: new Date(nowMs).toISOString(),
    startedAt: new Date(nowMs - startedAgoMs).toISOString(),
    deadlineAt: new Date(nowMs - startedAgoMs + durationMs).toISOString(),
    streamId,
    heartbeatSeconds: 10,
    title: 'Synthetic sectioned test',
    sections,
    items,
    answers,
    ...(receipt === undefined ? {} : { receipt }),
  };
};

/** A served v2 MCQ item; its options are in served order (c, a, b), never sorted. */
export const mcqItemV2 = (position: number, sectionId = SECTION_ID): ServedItemV2 => ({
  position,
  kind: 'mcq',
  sectionId,
  prompt: `Synthetic choice question ${position}`,
  options: [
    { id: 'c', label: 'Option gamma' },
    { id: 'a', label: 'Option alpha' },
    { id: 'b', label: 'Option beta' },
  ],
  variantId: '99999999-9999-4999-8999-999999999999',
  servedAt: '2026-10-19T10:00:00.000Z',
});

export const writtenItemV2 = (position: number, sectionId = SECTION_ID_2): ServedItemV2 => ({
  position,
  kind: 'written',
  sectionId,
  prompt: `Synthetic written question ${position}`,
  maxChars: 2000,
  servedAt: '2026-10-19T10:00:00.000Z',
});

/** The 8-byte PNG signature plus a few bytes: enough for the app, which never decodes the image. */
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

/** A JSON Response as the edge sends it. */
export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
