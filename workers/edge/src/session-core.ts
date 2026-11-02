// The SessionDO logic (specs/d1-demo-slice.md §4.4, D1-4; L-12, L-14, L-17, L-18, L-21). One object per invitation
// (`idFromName(invitation_id)` from verified claims only). The DO is the clock authority: `started_at` is set once
// from its own clock, the deadline is `started_at + durationSeconds`, events are accepted while the DO's time is at most
// `deadline + 60 s`, and one alarm at that instant auto-submits. The client's clock (`t`) is stored as T3 context and
// never reaches the deadline, coverage or signal times (AT-D37).
//
// Events arrive on streams (one per start or attach; a newer stream supersedes the older). Each stream numbers its own
// events from 1 (`seq`, client dedupe and the ack, high-water `hw`); the DO numbers every accepted event once,
// session-wide (`gseq`, L-14). At submit the final answer is rebuilt by replaying every accepted answer edit in `gseq`
// order. The evidence files and the one mirror message go to R2 and then to the mirror queue, with `mirror_state` and
// an alarm retry schedule; `mirror_state` reads `acked` only after the queue accepted the message.
//
// Storage is the object's synchronous SQLite-backed KV. Every request does its async hashing first and then reads,
// decides and writes in one synchronous block (inside `transaction`), so requests cannot interleave a read and a
// write. Nothing here logs a token, nonce, answer text, event payload or bytes: the logger gets ids and counts only.
import {
  SessionMirrorMessage,
  TestPackage,
  type CandidateErrorCode,
  type ClientEvent,
  type PhotoSkippedReason,
  type Receipt,
  type ServedItem,
  type SessionState,
  type SessionView,
} from '@trace/shared/contracts/candidate';
import type { Logger } from '@trace/shared/log';
import type { z } from 'zod';
import { constantTimeEqual, sha256Hex, sha256HexBytes, utf8 } from './encoding.js';
import type { SyncKvLike } from './otp-core.js';
import {
  applyAnswer,
  computeCoverage,
  eventsNdjson,
  finalAnswersBody,
  isAnswer,
  iso,
  receiptRefOf,
  replayAnswers,
  sameAnswers,
  type AnswerState,
  type EventBody,
  type PackageItem,
  type StoredEvent,
} from './session-evidence.js';

/** Grace after the deadline for in-flight saves (§4.4, plan §12). */
export const GRACE_MS = 60_000;
/** The test package is at most 256 KB (§4.4). */
export const PACKAGE_MAX_BYTES = 256 * 1024;
/** Mirror retries after a failed send: 5 s, 15 s, 60 s, then every 5 min, for 24 h from submit (§4.4). */
export const MIRROR_BACKOFF_MS = [5_000, 15_000, 60_000] as const;
export const MIRROR_RETRY_EVERY_MS = 5 * 60_000;
export const MIRROR_GIVE_UP_MS = 24 * 60 * 60_000;
/** How long one delivery attempt holds the mirror before another path may try again (object reset mid-send). */
export const MIRROR_LEASE_MS = 30_000;

/**
 * Per-session storage caps (SEC-C1b-2), counted in the object's storage so they survive a restart: at most 50 000
 * stored events and 20 MB of stored event bytes (UTF-8 of each stored event's JSON). A batch that would pass either is
 * refused whole with 413 `too_large`. They keep the finalise pass and `events.ndjson` inside the object's memory.
 */
export const MAX_STORED_EVENTS = 50_000;
export const MAX_STORED_EVENT_BYTES = 20 * 1024 * 1024;
/**
 * Heartbeat thinning (SEC-C1b-2): a token bucket of `HEARTBEAT_BURST` stored heartbeats, refilled at one per 5 s of the
 * object's time. A heartbeat without a token is acknowledged (the stream's `seq` advances, dedupe holds) but not stored
 * and takes no `gseq`. The honest cadence (one per 10 s) never empties the bucket, so it is never thinned; a flood
 * stores at most one heartbeat per 5 s after the burst, which keeps every 10 s coverage window covered.
 */
export const HEARTBEAT_STORE_EVERY_MS = 5_000;
export const HEARTBEAT_BURST = 12;

/** Per-session request limits in fixed windows (§4.2): events 5 batches/s; attach and submit 6/min; items 60/min. */
export const SESSION_LIMITS = {
  events: { n: 5, windowMs: 1_000 },
  attach: { n: 6, windowMs: 60_000 },
  items: { n: 60, windowMs: 60_000 },
  submit: { n: 6, windowMs: 60_000 },
} as const;
type LimitBucket = keyof typeof SESSION_LIMITS;

/** The slice of `ctx.storage.kv` this logic uses: the OTP slice plus an ordered prefix listing. */
export interface SessionKv extends SyncKvLike {
  list<T = unknown>(options: { prefix: string }): Iterable<[string, T]>;
}

/** The read-only package source (edge code only ever calls get/head on it). Throws when unavailable. */
export interface PackageSource {
  get(key: string): Promise<{ size: number; bytes(): Promise<Uint8Array> } | null>;
}

/** Writes one evidence object. Throws when unavailable. */
export interface EvidenceSink {
  put(key: string, body: string, contentType: string): Promise<void>;
}

/** Hands the one mirror message to the transport (queue). Throws when it was not accepted. */
export interface MirrorTransport {
  send(message: SessionMirrorMessage): Promise<void>;
}

/** The object's single alarm slot. */
export interface AlarmSlot {
  set(atMs: number): Promise<void> | void;
  clear(): Promise<void> | void;
}

export interface SessionCoreDeps {
  kv: SessionKv;
  /** Runs `fn` atomically (the object's `transactionSync`). */
  transaction: <T>(fn: () => T) => T;
  alarm: AlarmSlot;
  packages: PackageSource;
  evidence: EvidenceSink;
  mirror: MirrorTransport;
  log: Logger;
  /** Epoch milliseconds: the object's own clock, the only clock of the session. */
  now?: () => number;
  /** A new v4 uuid (stream ids). */
  newId?: () => string;
}

export type PhotoRef = { key: string; sha256: string; bytes: number };

/** What `session/start` hands the object: the api grant (claim-derived ids) and the head()-checked photo. */
export interface StartInput {
  sessionId: string;
  orgId: string;
  invitationId: string;
  testVersionId: string;
  rulesetVersionId: string;
  consentId: string;
  durationSeconds: number;
  /** The stored, set-once start of a session that already began (api), or null. The object's own value wins. */
  grantStartedAt: string | null;
  packageKey: string;
  packageSha256: string;
  /** The raw session-token nonce; only its hash is stored. */
  nonce: string;
  adultConfirmed: boolean;
  photo: PhotoRef | null;
  photoSkippedReason: PhotoSkippedReason | null;
}

/** Every session-token request presents the token's nonce and org (both from verified claims). */
export interface SessionAuth {
  nonce: string;
  orgId: string;
}

export type PackageCause = 'missing' | 'too_large' | 'hash' | 'schema' | 'mismatch';

export type Refusal = {
  ok: false;
  error: CandidateErrorCode;
  retryAfterSeconds?: number;
  ackSeq?: number;
  /** Set when the test package is missing or invalid (RT-12): the route logs `session.package_invalid`. */
  pkg?: PackageCause;
};

export type View = z.input<typeof SessionView>;

export type StartResult =
  | { ok: true; kind: 'live'; startedAt: string; photoSha256: string | null; view: View }
  | { ok: true; kind: 'submitted'; startedAt: string; photoSha256: string | null; receipt: Receipt }
  | Refusal;
export type AttachResult = { ok: true; view: View } | Refusal;
export type ItemResult = { ok: true; item: z.input<typeof ServedItem> } | Refusal;
export type EventsResult =
  | { ok: true; ackSeq: number; serverNow: string; deadlineAt: string; state: SessionState }
  | Refusal;
export type SubmitResult = { ok: true; receipt: Receipt } | Refusal;

/** What the routes call on the object (the RPC stub and the test fake both have this shape). */
export interface SessionApi {
  start(input: StartInput): Promise<StartResult>;
  attach(auth: SessionAuth): Promise<AttachResult>;
  item(auth: SessionAuth, position: number): Promise<ItemResult>;
  events(
    auth: SessionAuth,
    batch: { streamId: string; events: ClientEvent[] },
  ): Promise<EventsResult>;
  submit(auth: SessionAuth, request: { streamId: string; finalSeq: number }): Promise<SubmitResult>;
}

type MirrorState = 'none' | 'pending' | 'acked' | 'failed';

interface Meta {
  v: 1;
  sessionId: string;
  orgId: string;
  invitationId: string;
  testVersionId: string;
  rulesetVersionId: string;
  consentId: string;
  state: SessionState;
  startedAt: number;
  deadlineAt: number;
  submittedAt: number | null;
  /** Hash of the live session-token nonce; moved to `finalNonceHash` at submit (the token then only reads). */
  nonceHash: string | null;
  finalNonceHash: string | null;
  activeStreamId: string;
  streamCount: number;
  gseqHw: number;
  receiptRef: string;
  photo: PhotoRef | null;
  photoSkippedReason: PhotoSkippedReason | null;
  /** A client `len` check disagreed with the server's text (context only). */
  lenMismatch: boolean;
  replay: 'ok' | 'mismatch' | null;
  coverage: { activeMs: number; coveredMs: number } | null;
  gaps: { from: number; to: number }[];
  mirror: {
    state: MirrorState;
    attempts: number;
    nextAt: number | null;
    leaseUntil: number | null;
  };
  /** Stored events and their bytes (SEC-C1b-2); absent until the first stored event. */
  stored?: { events: number; bytes: number };
  /** The heartbeat bucket (SEC-C1b-2): tokens left at `at`; absent means a full bucket. */
  heartbeats?: { tokens: number; at: number };
}

interface StreamRow {
  hw: number;
  openedAt: number;
}

interface RateWindow {
  start: number;
  n: number;
}

const K = {
  meta: 'meta',
  pkg: 'pkg',
  served: 'served',
  final: (position: number) => `fin:${position}`,
  mirror: 'mirror',
  stream: (id: string) => `stream:${id}`,
  event: (gseq: number) => `ev:${String(gseq).padStart(10, '0')}`,
  eventPrefix: 'ev:',
  answer: (position: number) => `ans:${position}`,
  rate: (bucket: LimitBucket) => `rate:${bucket}`,
} as const;

const refuse = (error: CandidateErrorCode, extra: Omit<Refusal, 'ok' | 'error'> = {}): Refusal => ({
  ok: false,
  error,
  ...extra,
});

/** A batch with an event that is not valid for the session (unknown item, bad splice, over `maxChars`). */
class BatchRejected extends Error {}

const finished = (meta: Meta): boolean => meta.state !== 'in_progress';

export const evidenceKeys = (orgId: string, sessionId: string) => ({
  final: `sessions/${orgId}/${sessionId}/final.json`,
  events: `sessions/${orgId}/${sessionId}/events.ndjson`,
  mirror: `sessions/${orgId}/${sessionId}/mirror.json`,
});

/** The stored size of one event: the UTF-8 bytes of its JSON (SEC-C1b-2). */
const storedBytes = (event: StoredEvent): number => utf8(JSON.stringify(event)).byteLength;

export const mirrorBackoffMs = (failures: number): number =>
  MIRROR_BACKOFF_MS[failures - 1] ?? MIRROR_RETRY_EVERY_MS;

export class SessionCore implements SessionApi {
  readonly #kv: SessionKv;
  readonly #tx: <T>(fn: () => T) => T;
  readonly #alarm: AlarmSlot;
  readonly #packages: PackageSource;
  readonly #evidence: EvidenceSink;
  readonly #mirror: MirrorTransport;
  readonly #log: Logger;
  readonly #now: () => number;
  readonly #newId: () => string;

  constructor(deps: SessionCoreDeps) {
    this.#kv = deps.kv;
    this.#tx = deps.transaction;
    this.#alarm = deps.alarm;
    this.#packages = deps.packages;
    this.#evidence = deps.evidence;
    this.#mirror = deps.mirror;
    this.#log = deps.log;
    this.#now = deps.now ?? (() => Date.now());
    this.#newId = deps.newId ?? (() => crypto.randomUUID());
  }

  // ---- storage helpers -----------------------------------------------------------------------------------------

  #meta(): Meta | undefined {
    return this.#kv.get<Meta>(K.meta);
  }

  #pkg(): TestPackage {
    const pkg = this.#kv.get<TestPackage>(K.pkg);
    if (pkg === undefined) throw new Error('session_package_missing');
    return pkg;
  }

  #items(pkg: TestPackage): Map<number, PackageItem> {
    return new Map(pkg.items.map((item) => [item.position, item]));
  }

  #served(): Record<string, number> {
    return this.#kv.get<Record<string, number>>(K.served) ?? {};
  }

  *#events(): Generator<StoredEvent> {
    for (const [, event] of this.#kv.list<StoredEvent>({ prefix: K.eventPrefix })) yield event;
  }

  #answers(pkg: TestPackage): Map<number, AnswerState> {
    const out = new Map<number, AnswerState>();
    for (const item of pkg.items) {
      const answer = this.#kv.get<AnswerState>(K.answer(item.position));
      if (answer !== undefined) out.set(item.position, answer);
    }
    return out;
  }

  #finalAnswers(): Map<number, AnswerState> {
    const out = new Map<number, AnswerState>();
    for (const item of this.#pkg().items) {
      const answer = this.#kv.get<AnswerState>(K.final(item.position));
      if (answer !== undefined) out.set(item.position, answer);
    }
    return out;
  }

  /** Counts one request in a fixed window; a refusal carries the wait. */
  #limit(bucket: LimitBucket, now: number): Refusal | null {
    const { n, windowMs } = SESSION_LIMITS[bucket];
    const window = this.#kv.get<RateWindow>(K.rate(bucket));
    const current =
      window !== undefined && now >= window.start && now - window.start < windowMs
        ? window
        : { start: now, n: 0 };
    if (current.n >= n) {
      return refuse('rate_limited', {
        retryAfterSeconds: Math.max(1, Math.ceil((current.start + windowMs - now) / 1000)),
      });
    }
    this.#kv.put(K.rate(bucket), { start: current.start, n: current.n + 1 });
    return null;
  }

  /**
   * Checks a session token's nonce hash and org against the stored session. `live`: the current token of a running
   * session. `final`: the token that was current at submit (it may read the receipt, nothing else). A different
   * nonce is an older grant (`superseded`, before and after submit, SR-5/RT-3); no session, another org, or no
   * nonce at all is `token_invalid`.
   */
  #authorise(meta: Meta | undefined, presented: string, orgId: string): Refusal | 'live' | 'final' {
    if (meta === undefined || meta.orgId !== orgId) return refuse('token_invalid');
    if (meta.nonceHash !== null && constantTimeEqual(presented, meta.nonceHash)) return 'live';
    if (meta.finalNonceHash !== null && constantTimeEqual(presented, meta.finalNonceHash)) {
      return 'final';
    }
    return refuse(
      meta.nonceHash === null && meta.finalNonceHash === null ? 'token_invalid' : 'superseded',
    );
  }

  /** Past `deadline + 60 s` a running session is finalised on the spot (the alarm may run late). */
  #lazyFinalise(meta: Meta, now: number): Meta {
    if (meta.state === 'in_progress' && now > meta.deadlineAt + GRACE_MS) {
      return this.#finalise(meta, 'auto_submitted', now);
    }
    return meta;
  }

  #openStream(meta: Meta, now: number): Meta {
    const streamId = this.#newId();
    this.#kv.put<StreamRow>(K.stream(streamId), { hw: 0, openedAt: now });
    return { ...meta, activeStreamId: streamId, streamCount: meta.streamCount + 1 };
  }

  #receipt(meta: Meta): Receipt {
    return { receiptRef: meta.receiptRef, submittedAt: iso(meta.submittedAt ?? meta.deadlineAt) };
  }

  #view(meta: Meta, now: number): View {
    const pkg = this.#pkg();
    const served = this.#served();
    // A finished session shows its receipt and no answer text (SEC-C1b-5): the final answers stay in the object and in
    // final.json, never in a response after submit.
    const answers = finished(meta) ? new Map<number, AnswerState>() : this.#answers(pkg);
    const viewAnswers: View['answers'] = [];
    for (const position of [...answers.keys()].sort((a, b) => a - b)) {
      const answer = answers.get(position);
      if (answer?.kind === 'text' && answer.text !== '') {
        viewAnswers.push({ position, text: answer.text });
      }
      if (answer?.kind === 'choice' && answer.choice !== null) {
        viewAnswers.push({ position, choice: answer.choice });
      }
    }
    return {
      sessionId: meta.sessionId,
      state: meta.state,
      serverNow: iso(now),
      startedAt: iso(meta.startedAt),
      deadlineAt: iso(meta.deadlineAt),
      streamId: meta.activeStreamId,
      heartbeatSeconds: 10,
      pasteBlocked: pkg.pasteBlocked,
      title: pkg.title,
      sections: pkg.sections,
      items: pkg.items.map((item) => {
        const at = served[String(item.position)];
        return {
          position: item.position,
          sectionId: item.sectionId,
          kind: item.kind,
          servedAt: at === undefined ? null : iso(at),
        };
      }),
      answers: viewAnswers,
      ...(finished(meta) ? { receipt: this.#receipt(meta) } : {}),
    };
  }

  // ---- package ---------------------------------------------------------------------------------------------------

  /** Reads and checks the package (RT-12). A source failure is `unavailable` without a package cause (RT-11). */
  async #readPackage(input: StartInput): Promise<TestPackage | Refusal> {
    let found: Awaited<ReturnType<PackageSource['get']>>;
    let bytes: Uint8Array;
    try {
      found = await this.#packages.get(input.packageKey);
      if (found === null) return refuse('unavailable', { pkg: 'missing' });
      if (found.size > PACKAGE_MAX_BYTES) return refuse('unavailable', { pkg: 'too_large' });
      bytes = await found.bytes();
    } catch {
      return refuse('unavailable');
    }
    if (bytes.length > PACKAGE_MAX_BYTES) return refuse('unavailable', { pkg: 'too_large' });
    if ((await sha256HexBytes(bytes)) !== input.packageSha256) {
      return refuse('unavailable', { pkg: 'hash' });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
      ) as unknown;
    } catch {
      return refuse('unavailable', { pkg: 'schema' });
    }
    const parsed = TestPackage.safeParse(raw);
    if (!parsed.success) return refuse('unavailable', { pkg: 'schema' });
    const pkg = parsed.data;
    if (
      pkg.testVersionId !== input.testVersionId ||
      pkg.rulesetVersionId !== input.rulesetVersionId ||
      pkg.durationSeconds !== input.durationSeconds
    ) {
      return refuse('unavailable', { pkg: 'mismatch' });
    }
    return pkg;
  }

  // ---- start / attach / item -------------------------------------------------------------------------------------

  /**
   * Creates the session on the first call (`started_at` from the object's clock, the deadline alarm set) or resumes
   * it (same `started_at`, the nonce rotated, a new stream that supersedes the older). Refuses without
   * `adultConfirmed` (rule 9, L-13). A finished session answers its receipt. The photo is set once, at creation (a
   * resume ignores `input.photo`); every answer carries its stored hash, so the route pins the canonical photo only
   * when it holds exactly those bytes (SEC-1).
   */
  async start(input: StartInput): Promise<StartResult> {
    if (input.adultConfirmed !== true) return refuse('not_eligible');
    const nonceHash = await sha256Hex(input.nonce);
    const receiptRef = await receiptRefOf(input.sessionId);
    let pkg: TestPackage | undefined;
    if (this.#meta() === undefined) {
      const read = await this.#readPackage(input);
      if ('ok' in read) return read;
      pkg = read;
    }
    const result = this.#tx((): StartResult => {
      const now = this.#now();
      const existing = this.#meta();
      if (existing !== undefined) {
        if (
          existing.sessionId !== input.sessionId ||
          existing.orgId !== input.orgId ||
          existing.invitationId !== input.invitationId
        ) {
          return refuse('unavailable');
        }
        const meta = this.#lazyFinalise(existing, now);
        if (finished(meta)) {
          return {
            ok: true,
            kind: 'submitted',
            startedAt: iso(meta.startedAt),
            photoSha256: meta.photo?.sha256 ?? null,
            receipt: this.#receipt(meta),
          };
        }
        const resumed = this.#openStream({ ...meta, nonceHash }, now);
        this.#kv.put(K.meta, resumed);
        return {
          ok: true,
          kind: 'live',
          startedAt: iso(resumed.startedAt),
          photoSha256: resumed.photo?.sha256 ?? null,
          view: this.#view(resumed, now),
        };
      }
      if (pkg === undefined) return refuse('unavailable');
      // A session that api already recorded as started keeps that start (a lost object never extends the time).
      const stored = input.grantStartedAt === null ? Number.NaN : Date.parse(input.grantStartedAt);
      const startedAt = Number.isFinite(stored) ? Math.min(stored, now) : now;
      const deadlineAt = startedAt + input.durationSeconds * 1000;
      if (now > deadlineAt + GRACE_MS) return refuse('closed');
      this.#kv.put(K.pkg, pkg);
      const created = this.#openStream(
        {
          v: 1,
          sessionId: input.sessionId,
          orgId: input.orgId,
          invitationId: input.invitationId,
          testVersionId: input.testVersionId,
          rulesetVersionId: input.rulesetVersionId,
          consentId: input.consentId,
          state: 'in_progress',
          startedAt,
          deadlineAt,
          submittedAt: null,
          nonceHash,
          finalNonceHash: null,
          activeStreamId: '',
          streamCount: 0,
          gseqHw: 0,
          receiptRef,
          photo: input.photo,
          photoSkippedReason: input.photo === null ? input.photoSkippedReason : null,
          lenMismatch: false,
          replay: null,
          coverage: null,
          gaps: [],
          mirror: { state: 'none', attempts: 0, nextAt: null, leaseUntil: null },
        },
        now,
      );
      this.#kv.put(K.meta, created);
      return {
        ok: true,
        kind: 'live',
        startedAt: iso(created.startedAt),
        photoSha256: created.photo?.sha256 ?? null,
        view: this.#view(created, now),
      };
    });
    await this.#schedule();
    return result;
  }

  /** A reload: a new stream for the same token (the older stream is superseded). A finished session reads only. */
  async attach(auth: SessionAuth): Promise<AttachResult> {
    const presented = await sha256Hex(auth.nonce);
    const result = this.#tx((): AttachResult => {
      const now = this.#now();
      const stored = this.#meta();
      const who = this.#authorise(stored, presented, auth.orgId);
      if (typeof who !== 'string' || stored === undefined) return who as Refusal;
      const meta = this.#lazyFinalise(stored, now);
      if (finished(meta)) return { ok: true, view: this.#view(meta, now) };
      const limited = this.#limit('attach', now);
      if (limited !== null) return limited;
      const next = this.#openStream(meta, now);
      this.#kv.put(K.meta, next);
      return { ok: true, view: this.#view(next, now) };
    });
    await this.#schedule();
    return result;
  }

  /**
   * Serves one prompt; the first serve stamps `served_at` (server time). Only until the deadline: the 60 s grace is
   * for saves already in flight, not for new reads (SEC-C1b-4), so after the deadline it answers `closed`.
   */
  async item(auth: SessionAuth, position: number): Promise<ItemResult> {
    const presented = await sha256Hex(auth.nonce);
    const result = this.#tx((): ItemResult => {
      const now = this.#now();
      const stored = this.#meta();
      const who = this.#authorise(stored, presented, auth.orgId);
      if (typeof who !== 'string' || stored === undefined) return who as Refusal;
      const meta = this.#lazyFinalise(stored, now);
      if (finished(meta) || now > meta.deadlineAt) return refuse('closed');
      const limited = this.#limit('items', now);
      if (limited !== null) return limited;
      const item = this.#items(this.#pkg()).get(position);
      if (item === undefined) return refuse('bad_request');
      const served = this.#served();
      const at = served[String(position)] ?? now;
      if (served[String(position)] === undefined) {
        this.#kv.put(K.served, { ...served, [String(position)]: at });
      }
      return {
        ok: true,
        item: {
          position: item.position,
          kind: item.kind,
          sectionId: item.sectionId,
          prompt: item.prompt,
          ...(item.options === undefined ? {} : { options: item.options }),
          ...(item.maxChars === undefined ? {} : { maxChars: item.maxChars }),
          servedAt: iso(at),
        },
      };
    });
    await this.#schedule();
    return result;
  }

  // ---- events ----------------------------------------------------------------------------------------------------

  /**
   * One batch on the active stream, in one transaction: `seq <= hw` is an idempotent resend (no new `gseq`); the next
   * must be `hw + 1`; the first gap stops the batch (409 `out_of_order`, `ackSeq = hw`, the events before it kept);
   * each accepted event takes the next `gseq`. An event that is not valid for the session (an unknown item, a splice
   * outside the text, a text over `maxChars`) rejects the whole batch (400) and nothing of it is kept (RT-13).
   */
  async events(
    auth: SessionAuth,
    batch: { streamId: string; events: ClientEvent[] },
  ): Promise<EventsResult> {
    const presented = await sha256Hex(auth.nonce);
    const result = this.#tx((): EventsResult => {
      const now = this.#now();
      const stored = this.#meta();
      const who = this.#authorise(stored, presented, auth.orgId);
      if (typeof who !== 'string' || stored === undefined) return who as Refusal;
      const meta = this.#lazyFinalise(stored, now);
      if (finished(meta)) return refuse('closed');
      const stream = this.#kv.get<StreamRow>(K.stream(batch.streamId));
      if (batch.streamId !== meta.activeStreamId) {
        return refuse(stream === undefined ? 'bad_request' : 'superseded');
      }
      if (stream === undefined) return refuse('unavailable');
      const limited = this.#limit('events', now);
      if (limited !== null) return limited;
      try {
        return this.#accept(meta, stream, batch, now);
      } catch (err) {
        if (err instanceof BatchRejected) return refuse('bad_request');
        throw err;
      }
    });
    await this.#schedule();
    return result;
  }

  #accept(
    meta: Meta,
    stream: StreamRow,
    batch: { streamId: string; events: ClientEvent[] },
    now: number,
  ): EventsResult {
    const items = this.#items(this.#pkg());
    const answers = new Map<number, AnswerState | undefined>();
    const answerOf = (position: number): AnswerState | undefined => {
      if (!answers.has(position)) answers.set(position, this.#kv.get(K.answer(position)));
      return answers.get(position);
    };
    const accepted: StoredEvent[] = [];
    let hw = stream.hw;
    let gseq = meta.gseqHw;
    let lenMismatch = meta.lenMismatch;
    let gap = false;
    const bucket = meta.heartbeats ?? { tokens: HEARTBEAT_BURST, at: now };
    let tokens = Math.min(
      HEARTBEAT_BURST,
      bucket.tokens + Math.max(0, now - bucket.at) / HEARTBEAT_STORE_EVERY_MS,
    );
    let addedBytes = 0;
    for (const event of batch.events) {
      if (event.seq <= hw) continue;
      if (event.seq !== hw + 1) {
        gap = true;
        break;
      }
      const { seq, t, ...body } = event;
      if (body.kind === 'heartbeat') {
        if (tokens < 1) {
          // Acknowledged, not stored (SEC-C1b-2).
          hw = seq;
          continue;
        }
        tokens -= 1;
      }
      const next = gseq + 1;
      if (isAnswer(body)) {
        const item = items.get(body.item);
        if (item === undefined) throw new BatchRejected();
        const state = applyAnswer(answerOf(body.item), body, item, next);
        if (state === null) throw new BatchRejected();
        if (body.kind === 'answer.text' && body.len !== undefined && state.kind === 'text') {
          if (body.len !== state.text.length) lenMismatch = true;
        }
        answers.set(body.item, state);
      } else if (body.kind === 'signal' && body.item !== null && !items.has(body.item)) {
        throw new BatchRejected();
      }
      const stored: StoredEvent = {
        gseq: next,
        streamId: batch.streamId,
        seq,
        t,
        tServer: now,
        body: body as EventBody,
      };
      addedBytes += storedBytes(stored);
      accepted.push(stored);
      gseq = next;
      hw = seq;
    }
    const counted = meta.stored ?? { events: 0, bytes: 0 };
    const total = { events: counted.events + accepted.length, bytes: counted.bytes + addedBytes };
    if (total.events > MAX_STORED_EVENTS || total.bytes > MAX_STORED_EVENT_BYTES) {
      // Refused whole: nothing of the batch is kept and the high-water mark does not move (SEC-C1b-2).
      return refuse('too_large');
    }
    for (const event of accepted) this.#kv.put(K.event(event.gseq), event);
    for (const [position, state] of answers) {
      if (state !== undefined) this.#kv.put(K.answer(position), state);
    }
    if (hw !== stream.hw) {
      this.#kv.put<StreamRow>(K.stream(batch.streamId), { ...stream, hw });
      this.#kv.put<Meta>(K.meta, {
        ...meta,
        gseqHw: gseq,
        lenMismatch,
        stored: total,
        heartbeats: { tokens, at: now },
      });
    }
    if (gap) return refuse('out_of_order', { ackSeq: hw });
    return {
      ok: true,
      ackSeq: hw,
      serverNow: iso(now),
      deadlineAt: iso(meta.deadlineAt),
      state: meta.state,
    };
  }

  // ---- submit, finalise, mirror ------------------------------------------------------------------------------------

  /**
   * The candidate's submit: the stream must hold every event up to `finalSeq` (else 409 with `ackSeq`). Idempotent: a
   * finished session (submitted, or auto-submitted by the alarm or past the grace) answers the same receipt. The
   * receipt does not wait for Postgres; the evidence and the mirror are attempted at once and retried by the alarm.
   */
  async submit(
    auth: SessionAuth,
    request: { streamId: string; finalSeq: number },
  ): Promise<SubmitResult> {
    const presented = await sha256Hex(auth.nonce);
    const result = this.#tx((): SubmitResult => {
      const now = this.#now();
      const stored = this.#meta();
      const who = this.#authorise(stored, presented, auth.orgId);
      if (typeof who !== 'string' || stored === undefined) return who as Refusal;
      const meta = this.#lazyFinalise(stored, now);
      if (finished(meta)) return { ok: true, receipt: this.#receipt(meta) };
      const stream = this.#kv.get<StreamRow>(K.stream(request.streamId));
      if (request.streamId !== meta.activeStreamId) {
        return refuse(stream === undefined ? 'bad_request' : 'superseded');
      }
      if (stream === undefined) return refuse('unavailable');
      const limited = this.#limit('submit', now);
      if (limited !== null) return limited;
      if (stream.hw < request.finalSeq) return refuse('out_of_order', { ackSeq: stream.hw });
      return { ok: true, receipt: this.#receipt(this.#finalise(meta, 'submitted', now)) };
    });
    if (result.ok) await this.#deliver();
    await this.#schedule();
    return result;
  }

  /** The alarm: auto-submit at `deadline + 60 s` (idempotent), then any due mirror retry, then the next alarm. */
  async alarm(): Promise<void> {
    this.#tx(() => {
      const meta = this.#meta();
      const now = this.#now();
      if (meta?.state === 'in_progress' && now >= meta.deadlineAt + GRACE_MS) {
        this.#finalise(meta, 'auto_submitted', now);
      }
    });
    await this.#deliver();
    await this.#schedule();
  }

  /**
   * Freezes the session (synchronous, inside the caller's transaction): replays every answer edit in `gseq` order and
   * compares it with the incremental state (`replay`), computes coverage and gaps from server times, keeps the final
   * answers, moves the nonce to the read-only slot and marks the mirror pending. From here on no event is accepted.
   */
  #finalise(meta: Meta, kind: 'submitted' | 'auto_submitted', now: number): Meta {
    const pkg = this.#pkg();
    const items = this.#items(pkg);
    const incremental = this.#answers(pkg);
    const replayed = replayAnswers(this.#events(), items);
    const replayOk =
      replayed !== null && sameAnswers(replayed, incremental) && meta.lenMismatch === false;
    const finalAnswers = replayed ?? incremental;
    const endAt = Math.min(now, meta.deadlineAt);
    const coverage = computeCoverage(meta.startedAt, endAt, this.#events());
    const next: Meta = {
      ...meta,
      state: kind,
      submittedAt: now,
      finalNonceHash: meta.nonceHash,
      nonceHash: null,
      replay: replayOk ? 'ok' : 'mismatch',
      coverage: { activeMs: coverage.activeMs, coveredMs: coverage.coveredMs },
      gaps: coverage.gaps,
      mirror: { state: 'pending', attempts: 0, nextAt: now, leaseUntil: null },
    };
    for (const [position, answer] of finalAnswers) this.#kv.put(K.final(position), answer);
    this.#kv.put(K.meta, next);
    return next;
  }

  /** The one mirror message (built once, stored, and the same JSON on every attempt), with the evidence bodies. */
  async #mirrorMessage(
    meta: Meta,
  ): Promise<{ message: SessionMirrorMessage; final: string; events: string }> {
    const keys = evidenceKeys(meta.orgId, meta.sessionId);
    const final = await finalAnswersBody(meta.sessionId, this.#finalAnswers());
    const events = eventsNdjson(this.#events());
    const kept = this.#kv.get<SessionMirrorMessage>(K.mirror);
    if (kept !== undefined) return { message: kept, final, events };
    const pkg = this.#pkg();
    const served = this.#served();
    const itemVersion = new Map(pkg.items.map((item) => [item.position, item.itemVersionId]));
    const message = SessionMirrorMessage.parse({
      v: 1,
      jobKind: 'session_mirror',
      mirrorSeq: 1,
      jobKey: `${meta.sessionId}:session_mirror:${meta.rulesetVersionId}`,
      sessionId: meta.sessionId,
      orgId: meta.orgId,
      invitationId: meta.invitationId,
      testVersionId: meta.testVersionId,
      rulesetVersionId: meta.rulesetVersionId,
      consentId: meta.consentId,
      state: meta.state,
      receiptRef: meta.receiptRef,
      startedAt: iso(meta.startedAt),
      deadlineAt: iso(meta.deadlineAt),
      submittedAt: iso(meta.submittedAt ?? meta.deadlineAt),
      lastEventSeq: meta.gseqHw,
      streamCount: meta.streamCount,
      resumeCount: meta.streamCount - 1,
      served: Object.entries(served)
        .map(([position, at]) => ({
          position: Number(position),
          itemVersionId: itemVersion.get(Number(position)) ?? '',
          servedAt: iso(at),
        }))
        .sort((a, b) => a.position - b.position),
      evidence: {
        finalKey: keys.final,
        finalSha256: await sha256Hex(final),
        eventsKey: keys.events,
        eventsSha256: await sha256Hex(events),
      },
      replay: meta.replay ?? 'mismatch',
      signalCatalogVersion: pkg.signalCatalogVersion,
      coverage: meta.coverage ?? { activeMs: 0, coveredMs: 0 },
      gaps: meta.gaps.map((gap) => ({
        from: iso(gap.from),
        to: iso(gap.to),
        label: 'connectivity',
      })),
      photo:
        meta.photo === null ? null : { ...meta.photo, mime: 'image/jpeg', blurredOnDevice: true },
      photoSkippedReason: meta.photo === null ? meta.photoSkippedReason : null,
    });
    this.#kv.put(K.mirror, message);
    return { message, final, events };
  }

  /**
   * One delivery attempt when due: `final.json`, `events.ndjson`, then `mirror.json` to R2, and only then the queue
   * send (so any stage can rebuild its input, L-18). Success marks `acked`. A failure counts an attempt and schedules
   * the next (5 s, 15 s, 60 s, then every 5 min); 24 h after submit the state becomes `failed` and
   * `session.mirror_failed` is logged. A lease stops two paths (submit and alarm) from sending at once.
   *
   * The attempt is counted and the 24 h limit checked when the lease is taken (SEC-C1b-3): an object that dies inside
   * an attempt leaves its lease behind and never runs the bookkeeping after it, so the retry after the lease must
   * still count, and still give up.
   */
  async #deliver(): Promise<void> {
    const taken = this.#tx((): Meta | { gaveUp: number; sessionId: string } | null => {
      const meta = this.#meta();
      const now = this.#now();
      if (meta === undefined || meta.mirror.state !== 'pending') return null;
      if (meta.mirror.leaseUntil !== null && meta.mirror.leaseUntil > now) return null;
      if (meta.mirror.nextAt !== null && meta.mirror.nextAt > now) return null;
      if (now - (meta.submittedAt ?? now) >= MIRROR_GIVE_UP_MS) {
        const attempts = meta.mirror.attempts;
        this.#kv.put<Meta>(K.meta, {
          ...meta,
          mirror: { state: 'failed', attempts, nextAt: null, leaseUntil: null },
        });
        return { gaveUp: attempts, sessionId: meta.sessionId };
      }
      const leased: Meta = {
        ...meta,
        mirror: {
          ...meta.mirror,
          attempts: meta.mirror.attempts + 1,
          leaseUntil: now + MIRROR_LEASE_MS,
        },
      };
      this.#kv.put(K.meta, leased);
      return leased;
    });
    if (taken === null) return;
    const failedNow = 'gaveUp' in taken ? taken.gaveUp : await this.#attempt(taken);
    if (failedNow !== null) {
      this.#log.error('session.mirror_failed', { sessionId: taken.sessionId, n: failedNow });
    }
  }

  /** One leased attempt and its bookkeeping; returns the attempt count when the mirror just became `failed`. */
  async #attempt(taken: Meta): Promise<number | null> {
    await this.#schedule();
    let delivered = false;
    try {
      const { message, final, events } = await this.#mirrorMessage(taken);
      const keys = evidenceKeys(taken.orgId, taken.sessionId);
      await this.#evidence.put(keys.final, final, 'application/json');
      await this.#evidence.put(keys.events, events, 'application/x-ndjson');
      await this.#evidence.put(keys.mirror, JSON.stringify(message), 'application/json');
      await this.#mirror.send(message);
      delivered = true;
    } catch {
      delivered = false;
    }
    return this.#tx((): number | null => {
      const meta = this.#meta();
      if (meta === undefined) return null;
      const now = this.#now();
      // Counted when the lease was taken.
      const attempts = meta.mirror.attempts;
      if (delivered) {
        this.#kv.put<Meta>(K.meta, {
          ...meta,
          mirror: { state: 'acked', attempts, nextAt: null, leaseUntil: null },
        });
        return null;
      }
      const failures = attempts;
      const giveUp = now - (meta.submittedAt ?? now) >= MIRROR_GIVE_UP_MS;
      this.#kv.put<Meta>(K.meta, {
        ...meta,
        mirror: giveUp
          ? { state: 'failed', attempts, nextAt: null, leaseUntil: null }
          : {
              state: 'pending',
              attempts,
              nextAt: now + mirrorBackoffMs(failures),
              leaseUntil: null,
            },
      });
      return giveUp ? attempts : null;
    });
  }

  /** The one alarm slot: the deadline alarm while running, else the next mirror retry (or lease end). */
  async #schedule(): Promise<void> {
    const meta = this.#meta();
    let next: number | null = null;
    if (meta?.state === 'in_progress') next = meta.deadlineAt + GRACE_MS;
    if (meta !== undefined && meta.mirror.state === 'pending') {
      const due = Math.max(meta.mirror.nextAt ?? 0, meta.mirror.leaseUntil ?? 0);
      next = next === null ? due : Math.min(next, due);
    }
    if (next === null) await this.#alarm.clear();
    else await this.#alarm.set(next);
  }
}
