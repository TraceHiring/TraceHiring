// A whole synthetic session before the mirror runs (test only, neutral): the invitation, consent, pinned test
// version (2 sections, 4 items, item 4 never served), ruleset and rule table, and the R2 objects the SessionDO
// writes at submit (final.json, events.ndjson, start photo, mirror.json) with the matching mirror message. All three
// stage fakes run over one table set, so the pipeline and sweep tests see the stages together.
import type {
  EvidenceEventLine,
  FinalAnswers,
  SessionMirrorMessageV1,
} from '@trace/shared/contracts/candidate';
import type { LlmGrader } from '@trace/vendors';
import { integrityHandlers } from '../integrity/fake-db.test-helpers.js';
import {
  D1_RULES as rules,
  MemoryEvidence,
  heartbeat,
  ndjson,
  paste,
} from '../integrity/world.test-helpers.js';
import { qualityHandlers } from '../quality/fake-db.test-helpers.js';
import type { Stages } from '../queue/consumer.js';
import { sha256Hex } from './evidence.js';
import {
  inTx,
  mirrorHandlers,
  newDb,
  table,
  type FakeDb,
  type Handler,
} from './fake-db.test-helpers.js';
import { createStages } from './pipeline.js';

const id = (n: number): string =>
  `d2b8f4e1-6a3c-4d9b-a7e5-3c8f1b${(0x5d20 + n).toString(16).padStart(6, '0')}`;

export const W = {
  org: id(1),
  otherOrg: id(2),
  session: id(3),
  invitation: id(4),
  testVersion: id(5),
  ruleset: id(6),
  consent: id(7),
  bandRules: id(8),
  s1: id(10),
  s2: id(11),
  i1: id(20),
  i2: id(21),
  i3: id(22),
  i4: id(23),
  r3: id(30),
  r4: id(31),
  streamA: id(40),
} as const;

export const PHOTO_SHA = '9'.repeat(64);
export const PHOTO_BYTES = 2048;
export const PHOTO_KEY = `media/${W.org}/${W.session}/start_photo.jpg`;
export const MIRROR_KEY = `sessions/${W.org}/${W.session}/mirror.json`;

export const ALL_HANDLERS: Record<string, Handler> = {
  ...mirrorHandlers,
  ...qualityHandlers,
  ...integrityHandlers,
};

const criteria = (anchors: string[], minHits: number) =>
  JSON.stringify([
    { id: 'c1', label: 'Names the mechanism', max_points: 4, anchors, min_hits: minHits },
  ]);

export interface SessionWorld {
  db: FakeDb;
  evidence: MemoryEvidence;
  message: SessionMirrorMessageV1;
  finalBody: string;
}

export interface SessionWorldOptions {
  lines?: readonly EvidenceEventLine[];
  photo?: 'ok' | 'none' | 'missing_object' | 'other_sha';
  cutoff?: number;
  invitationStatus?: string;
  consent?: boolean;
}

export const sessionWorld = async (opts: SessionWorldOptions = {}): Promise<SessionWorld> => {
  const db = newDb();
  const org = W.org;
  table(db, 'invitations').push({
    org_id: org,
    id: W.invitation,
    status: opts.invitationStatus ?? 'started',
    session_id: W.session,
    adult_confirmed_by_inviter: true,
    adult_self_declared: true,
  });
  if (opts.consent !== false) {
    table(db, 'consents').push({
      org_id: org,
      id: W.consent,
      invitation_id: W.invitation,
      ruleset_version_id: W.ruleset,
    });
  }
  table(db, 'test_versions').push({
    org_id: org,
    id: W.testVersion,
    quality_cutoff: opts.cutoff ?? 40,
  });
  table(db, 'sections').push(
    { org_id: org, id: W.s1, test_version_id: W.testVersion, position: 1, weight: '1.00' },
    { org_id: org, id: W.s2, test_version_id: W.testVersion, position: 2, weight: '2.00' },
  );
  const item = (
    iid: string,
    sid: string,
    format: string,
    position: number,
    rubric: string | null,
  ) => ({
    org_id: org,
    id: iid,
    section_id: sid,
    test_version_id: W.testVersion,
    format,
    position,
    stem: `Synthetic prompt ${position}`,
    rubric_version_id: rubric,
  });
  table(db, 'item_versions').push(
    item(W.i1, W.s1, 'mcq', 1, null),
    item(W.i2, W.s1, 'mcq', 2, null),
    item(W.i3, W.s2, 'written', 3, W.r3),
    item(W.i4, W.s2, 'written', 4, W.r4),
  );
  table(db, 'item_answer_keys').push(
    { org_id: org, item_version_id: W.i1, option_id: 'b' },
    { org_id: org, item_version_id: W.i2, option_id: 'c' },
  );
  table(db, 'rubric_versions').push(
    {
      org_id: org,
      id: W.r3,
      criteria: criteria(['queue', 'retry'], 2),
      content_sha256: 'c'.repeat(64),
    },
    { org_id: org, id: W.r4, criteria: criteria(['index'], 1), content_sha256: 'd'.repeat(64) },
  );
  table(db, 'ruleset_versions').push({
    org_id: org,
    id: W.ruleset,
    band_rule_version_id: W.bandRules,
  });
  table(db, 'band_rule_versions').push({
    org_id: org,
    id: W.bandRules,
    version_no: 1,
    families: rules.families,
    coverage_floor_permille: rules.coverageFloorPermille,
    coverage_photo_missing_factor_permille: rules.coveragePhotoMissingFactorPermille,
    rules: rules.rules,
  });

  const text3 = 'The queue will retry the message.';
  const final: FinalAnswers = {
    v: 1,
    sessionId: W.session,
    answers: [
      { position: 1, kind: 'choice', choice: 'b', sha256: await sha256Hex('b'), finalSeq: 2 },
      { position: 2, kind: 'choice', choice: 'a', sha256: await sha256Hex('a'), finalSeq: 3 },
      { position: 3, kind: 'text', text: text3, sha256: await sha256Hex(text3), finalSeq: 6 },
    ],
  };
  const finalBody = JSON.stringify(final);
  const lines = opts.lines ?? [
    heartbeat(1, 10_000, W.streamA),
    paste(4, 20_000, W.streamA),
    heartbeat(5, 30_000, W.streamA),
  ];
  const eventsBody = ndjson(lines);

  const evidence = new MemoryEvidence();
  const finalKey = `sessions/${org}/${W.session}/final.json`;
  const eventsKey = `sessions/${org}/${W.session}/events.ndjson`;
  evidence.put(finalKey, finalBody);
  evidence.put(eventsKey, eventsBody);
  const photo = opts.photo ?? 'ok';
  if (photo === 'ok')
    evidence.put(PHOTO_KEY, new Uint8Array(PHOTO_BYTES), { sha256: PHOTO_SHA, blurred: '1' });
  if (photo === 'other_sha') {
    evidence.put(PHOTO_KEY, new Uint8Array(PHOTO_BYTES), { sha256: '8'.repeat(64), blurred: '1' });
  }

  const message: SessionMirrorMessageV1 = {
    v: 1,
    jobKind: 'session_mirror',
    mirrorSeq: 1,
    jobKey: `${W.session}:session_mirror:${W.ruleset}`,
    sessionId: W.session,
    orgId: org,
    invitationId: W.invitation,
    testVersionId: W.testVersion,
    rulesetVersionId: W.ruleset,
    consentId: W.consent,
    state: 'submitted',
    receiptRef: 'K7M2P9QX',
    startedAt: '2026-10-15T09:00:00.000Z',
    deadlineAt: '2026-10-15T10:00:00.000Z',
    submittedAt: '2026-10-15T09:30:00.000Z',
    lastEventSeq: Math.max(6, ...lines.map((l) => l.gseq)),
    streamCount: 1,
    resumeCount: 0,
    served: [
      { position: 1, itemVersionId: W.i1, servedAt: '2026-10-15T09:00:01.000Z' },
      { position: 2, itemVersionId: W.i2, servedAt: '2026-10-15T09:00:02.000Z' },
      { position: 3, itemVersionId: W.i3, servedAt: '2026-10-15T09:00:03.000Z' },
    ],
    evidence: {
      finalKey,
      finalSha256: await sha256Hex(finalBody),
      eventsKey,
      eventsSha256: await sha256Hex(eventsBody),
    },
    replay: 'ok',
    signalCatalogVersion: 'd1-signals-v1',
    coverage: { activeMs: 1_800_000, coveredMs: 1_800_000 },
    gaps: [],
    photo:
      photo === 'none'
        ? null
        : {
            key: PHOTO_KEY,
            sha256: PHOTO_SHA,
            bytes: PHOTO_BYTES,
            mime: 'image/jpeg',
            blurredOnDevice: true,
          },
    photoSkippedReason: photo === 'none' ? 'declined' : null,
  };
  evidence.put(MIRROR_KEY, JSON.stringify(message));
  return { db, evidence, message, finalBody };
};

/** The three real stages over the fake, each in its own (fake) transaction with the job org set. */
export const fakeStages = (w: SessionWorld, grader: LlmGrader): Stages =>
  createStages({
    db: { run: (_stage, orgId, fn) => inTx(w.db, orgId, ALL_HANDLERS, fn) },
    evidence: w.evidence,
    grader,
  });
