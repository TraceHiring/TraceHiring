// Pure pieces of the SessionDO (specs/d1-demo-slice.md §4.4): the answer splice and its validation, coverage and
// connectivity gaps from server times only, the receipt reference, and the bodies of the two evidence files
// (`final.json`, `events.ndjson`). Nothing here reads a clock, storage or the network, and nothing here logs. The
// client's own clock (`t`) is carried as context and never feeds a deadline, coverage or gap (AT-D37).
import type {
  ClientEvent,
  EvidenceEventLine,
  FinalAnswers,
  TestPackage,
} from '@trace/shared/contracts/candidate';
import { sha256Hex, utf8 } from './encoding.js';

/** Coverage windows (§4.4): 10 s from `started_at`; three uncovered windows in a row are a connectivity gap. */
export const WINDOW_MS = 10_000;
export const GAP_MIN_WINDOWS = 3;
export const MAX_GAPS = 50;
/** A written item without `maxChars` is still capped at the final-answer limit of the contract. */
export const DEFAULT_MAX_CHARS = 10_000;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A client event without its stream envelope (`seq`, `t`): what the DO keeps as the event's content. */
export type EventBody = DistributiveOmit<ClientEvent, 'seq' | 't'>;
export type AnswerBody = Extract<EventBody, { kind: 'answer.text' | 'answer.choice' }>;

/** One accepted event as stored in the DO. `tServer` is the DO's clock (epoch ms) when it accepted the event. */
export interface StoredEvent {
  gseq: number;
  streamId: string;
  seq: number;
  t: number;
  tServer: number;
  body: EventBody;
}

/** The answer state of one item. `gseq` is the session-global number of the last edit. */
export type AnswerState =
  | { kind: 'text'; text: string; gseq: number }
  | { kind: 'choice'; choice: string | null; gseq: number };

export type PackageItem = TestPackage['items'][number];

export const isAnswer = (body: EventBody): body is AnswerBody =>
  body.kind === 'answer.text' || body.kind === 'answer.choice';

/** Keep `p` UTF-16 units, delete `d`, insert `i`. Null when the range does not fit the current text. */
export const applySplice = (text: string, p: number, d: number, i: string): string | null => {
  if (p > text.length || d > text.length - p) return null;
  return text.slice(0, p) + i + text.slice(p + d);
};

/**
 * Applies one answer edit to the item's state, or returns null when the edit is not valid for the item: a text edit
 * on an MCQ item, a choice on a written item, an option the item does not have, a splice outside the text, or a text
 * longer than the item's `maxChars` (enforced on the rebuilt length, §4.4). The incremental state and the replay at
 * submit both use this one function.
 */
export const applyAnswer = (
  prev: AnswerState | undefined,
  body: AnswerBody,
  item: PackageItem,
  gseq: number,
): AnswerState | null => {
  if (body.kind === 'answer.choice') {
    if (item.kind !== 'mcq') return null;
    if (body.option !== null && !(item.options ?? []).some((o) => o.id === body.option))
      return null;
    return { kind: 'choice', choice: body.option, gseq };
  }
  if (item.kind !== 'written') return null;
  const before = prev?.kind === 'text' ? prev.text : '';
  const text = applySplice(before, body.p, body.d, body.i);
  if (text === null || text.length > (item.maxChars ?? DEFAULT_MAX_CHARS)) return null;
  return { kind: 'text', text, gseq };
};

/** Replays every accepted answer edit from empty, in `gseq` order. Null if a stored edit no longer applies. */
export const replayAnswers = (
  events: Iterable<StoredEvent>,
  items: ReadonlyMap<number, PackageItem>,
): Map<number, AnswerState> | null => {
  const out = new Map<number, AnswerState>();
  let last = 0;
  for (const event of events) {
    if (event.gseq <= last) return null;
    last = event.gseq;
    if (!isAnswer(event.body)) continue;
    const item = items.get(event.body.item);
    if (item === undefined) return null;
    const next = applyAnswer(out.get(event.body.item), event.body, item, event.gseq);
    if (next === null) return null;
    out.set(event.body.item, next);
  }
  return out;
};

export const sameAnswers = (
  a: ReadonlyMap<number, AnswerState>,
  b: ReadonlyMap<number, AnswerState>,
): boolean => {
  if (a.size !== b.size) return false;
  for (const [position, left] of a) {
    const right = b.get(position);
    if (right === undefined || JSON.stringify(left) !== JSON.stringify(right)) return false;
  }
  return true;
};

export interface Gap {
  from: number;
  to: number;
}

export interface Coverage {
  activeMs: number;
  coveredMs: number;
  gaps: Gap[];
}

/**
 * Coverage of `[startedAt, endAt)` in 10 s windows (§4.4). A window is covered when an accepted event's server time
 * falls in it, or when it overlaps a `tab_hidden` interval: the interval ends at the server time the signal arrived
 * and lasts the reported `ms`, clamped to the session (hidden tabs throttle timers). Runs of at least three uncovered
 * windows are connectivity gaps (the first 50 are kept). Only server times and a duration are read.
 */
export const computeCoverage = (
  startedAt: number,
  endAt: number,
  events: Iterable<StoredEvent>,
): Coverage => {
  const activeMs = Math.max(0, endAt - startedAt);
  const n = Math.ceil(activeMs / WINDOW_MS);
  const covered = new Array<boolean>(n).fill(false);
  const windowEnd = (k: number) => Math.min(startedAt + (k + 1) * WINDOW_MS, endAt);
  const mark = (from: number, to: number) => {
    const a = Math.max(from, startedAt);
    const b = Math.min(to, endAt);
    if (b <= a) return;
    const first = Math.floor((a - startedAt) / WINDOW_MS);
    const last = Math.min(n - 1, Math.ceil((b - startedAt) / WINDOW_MS) - 1);
    for (let k = first; k <= last; k += 1) covered[k] = true;
  };
  for (const event of events) {
    if (event.tServer >= startedAt && event.tServer < endAt) {
      covered[Math.floor((event.tServer - startedAt) / WINDOW_MS)] = true;
    }
    if (event.body.kind === 'signal' && event.body.sig === 'tab_hidden') {
      mark(event.tServer - event.body.ms, event.tServer);
    }
  }
  let coveredMs = 0;
  const gaps: Gap[] = [];
  let run = -1;
  for (let k = 0; k <= n; k += 1) {
    if (k < n && covered[k] === true) coveredMs += windowEnd(k) - (startedAt + k * WINDOW_MS);
    const uncovered = k < n && covered[k] !== true;
    if (uncovered && run < 0) run = k;
    if (!uncovered && run >= 0) {
      if (k - run >= GAP_MIN_WINDOWS && gaps.length < MAX_GAPS) {
        gaps.push({ from: startedAt + run * WINDOW_MS, to: windowEnd(k - 1) });
      }
      run = -1;
    }
  }
  return { activeMs, coveredMs, gaps };
};

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `receiptRef` = the first 8 Crockford-base32 characters of sha256(session_id) (§4.4; deterministic). */
export const receiptRefOf = async (sessionId: string): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(sessionId)));
  let out = '';
  let value = 0;
  let bits = 0;
  for (const byte of digest.subarray(0, 5)) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
};

export const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * One `events.ndjson` line per accepted signal or heartbeat event, in `gseq` order, each ending with a newline.
 * Answer edits are never written here (L-21): no `answer.*` kind and no text field.
 */
export const eventsNdjson = (events: Iterable<StoredEvent>): string => {
  let out = '';
  for (const event of events) {
    const { body } = event;
    if (body.kind !== 'signal' && body.kind !== 'heartbeat') continue;
    const envelope = {
      gseq: event.gseq,
      streamId: event.streamId,
      t: event.t,
      tServer: iso(event.tServer),
    };
    const line: EvidenceEventLine =
      body.kind === 'heartbeat' ? { ...envelope, kind: 'heartbeat' } : { ...envelope, ...body };
    out += `${JSON.stringify(line)}\n`;
  }
  return out;
};

/** The `final.json` body: one entry per answered item, by position, with the sha256 of the text or option id. */
export const finalAnswersBody = async (
  sessionId: string,
  answers: ReadonlyMap<number, AnswerState>,
): Promise<string> => {
  const entries: FinalAnswers['answers'] = [];
  for (const position of [...answers.keys()].sort((a, b) => a - b)) {
    const answer = answers.get(position);
    if (answer === undefined) continue;
    if (answer.kind === 'text') {
      entries.push({
        position,
        kind: 'text',
        text: answer.text,
        sha256: await sha256Hex(answer.text),
        finalSeq: answer.gseq,
      });
    } else {
      entries.push({
        position,
        kind: 'choice',
        choice: answer.choice,
        sha256: await sha256Hex(answer.choice ?? ''),
        finalSeq: answer.gseq,
      });
    }
  }
  const file: FinalAnswers = { v: 1, sessionId, answers: entries };
  return JSON.stringify(file);
};
