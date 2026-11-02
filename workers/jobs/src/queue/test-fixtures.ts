// Synthetic fixtures for the queue tests: a valid SessionMirrorMessage (spec §4.4) and a fake Workers
// Message / MessageBatch. All ids are made-up UUIDs; nothing here is real data.
import type { SessionMirrorMessage } from '@trace/shared/contracts/candidate';

// Realistic (random-looking) v4 ids: the redactor treats long digit runs, such as all zeros, as numbers.
const uuid = (n: number): string =>
  `3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b${n.toString(16).padStart(3, '0')}`;
const HEX = 'a'.repeat(64);

export const ORG_ID = uuid(42);
export const SESSION_ID = uuid(60);
export const RULESET_ID = uuid(51);

export const mirrorKey = (orgId: string, sessionId: string): string =>
  `sessions/${orgId}/${sessionId}/mirror.json`;

/** A valid mirror message; `patch` overrides top-level fields. */
export const validMessage = (patch: Partial<SessionMirrorMessage> = {}): SessionMirrorMessage => ({
  v: 1,
  jobKind: 'session_mirror',
  mirrorSeq: 1,
  jobKey: `${SESSION_ID}:session_mirror:${RULESET_ID}`,
  sessionId: SESSION_ID,
  orgId: ORG_ID,
  invitationId: uuid(41),
  testVersionId: uuid(50),
  rulesetVersionId: RULESET_ID,
  consentId: uuid(61),
  state: 'submitted',
  receiptRef: 'ABCD1234',
  startedAt: '2026-10-15T09:00:00.000Z',
  deadlineAt: '2026-10-15T10:00:00.000Z',
  submittedAt: '2026-10-15T09:30:00.000Z',
  lastEventSeq: 42,
  streamCount: 2,
  resumeCount: 1,
  served: [{ position: 1, itemVersionId: uuid(52), servedAt: '2026-10-15T09:00:05.000Z' }],
  evidence: {
    finalKey: `sessions/${ORG_ID}/${SESSION_ID}/final.json`,
    finalSha256: HEX,
    eventsKey: `sessions/${ORG_ID}/${SESSION_ID}/events.ndjson`,
    eventsSha256: HEX,
  },
  replay: 'ok',
  signalCatalogVersion: 'd1-signals-v1', // SIGNAL_CATALOG_VERSION (R2 lead request 4)
  coverage: { activeMs: 600000, coveredMs: 590000 },
  gaps: [],
  photo: null,
  photoSkippedReason: 'declined',
  ...patch,
});

export interface FakeMessage extends Message<unknown> {
  readonly acked: () => number;
  readonly retried: () => number;
}

/** A Message whose ack() and retry() calls are counted. */
export const fakeMessage = (body: unknown, id = 'msg-1'): FakeMessage => {
  let acks = 0;
  let retries = 0;
  return {
    id,
    timestamp: new Date('2026-10-15T09:30:00.000Z'),
    body,
    attempts: 1,
    ack() {
      acks++;
    },
    retry() {
      retries++;
    },
    acked: () => acks,
    retried: () => retries,
  };
};

export const fakeBatch = (messages: readonly Message<unknown>[]): MessageBatch<unknown> => ({
  messages,
  queue: 'trace-session-mirror-test',
  metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  retryAll() {},
  ackAll() {},
});
