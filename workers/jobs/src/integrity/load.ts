// Inputs of the integrity stage (spec d1 §5.1 row `integrity`, §5.2; L-14, L-21, R-11). Reads the session's
// `events.ndjson` from R2 (hash-checked against the message), turns its signal lines into band-engine events keyed by
// the session-global gseq, derives `connectivity_gap` events from the message's gaps (seq continuing after
// lastEventSeq), and decides `photoMissing`. Heartbeat lines only prove coverage, which the DO already computed, so
// they are dropped here. Nothing here reads quality data (rule 1); the only quality fact the stage ever sees is
// public.quality_cards.meets_cutoff, read in ./store.ts.
import type { SignalEvent } from '@trace/band-engine';
import { EvidenceEventLine, type SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import type { EvidenceReader } from '@trace/shared/jobs';

/** The per-session cap of stored event payload (SEC-C1b-2); a larger file is refused unread. */
export const MAX_EVENTS_BYTES = 20 * 1024 * 1024;

/** The SessionDO stores at most this many events per session (SEC-C1b-2), so events.ndjson has at most as many lines. */
export const MAX_EVENT_LINES = 50_000;

/** One accepted signal: what integrity.signals stores and the band engine reads. */
export interface LoadedSignal {
  seq: number;
  kind:
    'paste' | 'drop' | 'untrusted_input' | 'tab_hidden' | 'fullscreen_exit' | 'connectivity_gap';
  offsetMs: number;
  itemPosition: number | null;
  /** integrity.signals.details: keys `len` and `duration_ms` only, never content. */
  details: { len?: number; duration_ms?: number };
  event: SignalEvent;
}

const fail = (code: string): never => {
  throw new Error(code);
};

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

export const sha256HexBytes = async (bytes: ArrayBuffer): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', bytes));

export const eventsKeyOf = (orgId: string, sessionId: string): string =>
  `sessions/${orgId}/${sessionId}/events.ndjson`;
export const startPhotoKeyOf = (orgId: string, sessionId: string): string =>
  `media/${orgId}/${sessionId}/start_photo.jpg`;

const offsetFrom = (startedAtMs: number, iso: string): number => {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return fail('integrity_bad_events');
  return Math.max(0, at - startedAtMs);
};

/**
 * Parses the NDJSON body line by line straight from its bytes: each line is decoded on its own, so the whole file is
 * never held as one string next to its buffer (memory, C1b note 4). Heartbeats are dropped as they are read.
 * Sorted by gseq. A string input (tests) is encoded first.
 */
export const parseEventLines = (
  input: Uint8Array | string,
  message: Pick<SessionMirrorMessage, 'startedAt' | 'lastEventSeq'>,
): LoadedSignal[] => {
  const startedAtMs = Date.parse(message.startedAt);
  const out: LoadedSignal[] = [];
  const seen = new Set<number>();
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let from = 0;
  let lines = 0;
  while (from < bytes.length) {
    let end = bytes.indexOf(0x0a, from);
    if (end < 0) end = bytes.length;
    const start = from;
    from = end + 1;
    if (end === start) continue;
    lines += 1;
    if (lines > MAX_EVENT_LINES) return fail('integrity_events_too_large');
    let json: unknown;
    try {
      // a malformed UTF-8 sequence throws here too (fatal decoder)
      json = JSON.parse(decoder.decode(bytes.subarray(start, end)));
    } catch {
      return fail('integrity_bad_events');
    }
    const parsed = EvidenceEventLine.safeParse(json);
    if (!parsed.success) return fail('integrity_bad_events');
    const line = parsed.data;
    if (line.gseq > message.lastEventSeq || seen.has(line.gseq))
      return fail('integrity_bad_events');
    seen.add(line.gseq);
    if (line.kind === 'heartbeat') continue;
    const offsetMs = offsetFrom(startedAtMs, line.tServer);
    const base = { seq: line.gseq, offsetMs, itemPosition: line.item };
    switch (line.sig) {
      case 'paste':
      case 'drop':
        out.push({
          ...base,
          kind: line.sig,
          details: { len: line.len },
          event: { seq: line.gseq, atMs: offsetMs, kind: line.sig, attrs: { len: line.len } },
        });
        break;
      case 'untrusted_input':
        out.push({
          ...base,
          kind: line.sig,
          details: {},
          event: {
            seq: line.gseq,
            atMs: offsetMs,
            kind: line.sig,
            attrs: { via: line.via, count: line.count },
          },
        });
        break;
      case 'tab_hidden':
        out.push({
          ...base,
          kind: line.sig,
          details: { duration_ms: line.ms },
          event: { seq: line.gseq, atMs: offsetMs, kind: line.sig, durationMs: line.ms, attrs: {} },
        });
        break;
      case 'fullscreen_exit':
        out.push({
          ...base,
          kind: line.sig,
          details: {},
          event: { seq: line.gseq, atMs: offsetMs, kind: line.sig, attrs: {} },
        });
        break;
    }
  }
  // gseq order, whatever the file order: the stored rows and the input hash then never depend on it.
  return out.sort((a, b) => a.seq - b.seq);
};

/** The message's connectivity gaps as context events, numbered lastEventSeq + 1 + index (continuing gseq). */
export const gapSignals = (
  message: Pick<SessionMirrorMessage, 'startedAt' | 'lastEventSeq' | 'gaps'>,
): LoadedSignal[] => {
  const startedAtMs = Date.parse(message.startedAt);
  return message.gaps.map((gap, index) => {
    const offsetMs = offsetFrom(startedAtMs, gap.from);
    const durationMs = Math.max(0, Date.parse(gap.to) - Date.parse(gap.from));
    if (!Number.isFinite(durationMs)) return fail('integrity_bad_gaps');
    const seq = message.lastEventSeq + 1 + index;
    return {
      seq,
      kind: 'connectivity_gap',
      offsetMs,
      itemPosition: null,
      details: { duration_ms: durationMs },
      event: { seq, atMs: offsetMs, kind: 'connectivity_gap', durationMs, attrs: {} },
    };
  });
};

/**
 * Reads and hash-checks the session's events.ndjson. The key must be the canonical one for the message's org and
 * session (so a message can never point the stage at another session's file). Missing object, oversize file, hash
 * mismatch or a malformed line all fail with a constant code; the message is retried and then dead-lettered.
 */
export const loadSignals = async (
  evidence: EvidenceReader,
  message: SessionMirrorMessage,
): Promise<LoadedSignal[]> => {
  const key = eventsKeyOf(message.orgId, message.sessionId);
  if (message.evidence.eventsKey !== key) return fail('integrity_bad_message');
  const object = await evidence.get(key);
  if (object === null) return fail('integrity_events_missing');
  if (object.size > MAX_EVENTS_BYTES) return fail('integrity_events_too_large');
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength > MAX_EVENTS_BYTES) return fail('integrity_events_too_large');
  if ((await sha256HexBytes(bytes)) !== message.evidence.eventsSha256) {
    return fail('integrity_events_hash_mismatch');
  }
  return [...parseEventLines(new Uint8Array(bytes), message), ...gapSignals(message)];
};

/**
 * photoMissing (R-11): true when the message names no photo, and also (fail closed, the same rule as the mirror,
 * C1b) when the canonical start_photo.jpg is absent or its stored sha256 is not the mirrored one. A missing photo
 * only lowers coverage; it can never raise the band.
 */
export const isPhotoMissing = async (
  evidence: EvidenceReader,
  message: SessionMirrorMessage,
): Promise<boolean> => {
  const photo = message.photo;
  if (photo === null) return true;
  const key = startPhotoKeyOf(message.orgId, message.sessionId);
  if (photo.key !== key) return true;
  const head = await evidence.head(key);
  if (head === null) return true;
  return head.customMetadata['sha256'] !== photo.sha256 || head.size !== photo.bytes;
};
