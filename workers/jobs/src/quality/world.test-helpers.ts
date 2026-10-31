// A synthetic mirrored session for the quality tests: the rows the mirror stage leaves behind plus the pinned test
// version. Two sections (MCQ weight 1, written weight 2), four items, item 4 never served. Synthetic data only.
import type { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { newDb, table, type FakeDb } from './fake-db.test-helpers.js';

const id = (n: number): string =>
  `b7e1c4a9-2d6f-4f3b-9e85-${(0x3a17c0 + n).toString(16).padStart(12, '0')}`;

export const IDS = {
  org: id(1),
  otherOrg: id(2),
  session: id(3),
  invitation: id(4),
  testVersion: id(5),
  ruleset: id(6),
  consent: id(7),
  s1: id(10),
  s2: id(11),
  i1: id(20),
  i2: id(21),
  i3: id(22),
  i4: id(23),
  r3: id(30),
  r4: id(31),
  si1: id(40),
  si2: id(41),
  si3: id(42),
  report: id(50),
} as const;

export const HASH_R3 = 'c'.repeat(64);
export const HASH_R4 = 'd'.repeat(64);

const criteria = (anchors: string[], minHits: number) =>
  JSON.stringify([
    { id: 'c1', label: 'Names the mechanism', max_points: 4, anchors, min_hits: minHits },
  ]);

export interface WorldOptions {
  cutoff?: number;
  choice1?: string | null;
  text3?: string | null;
}

export const qualityWorld = (
  opts: WorldOptions = {},
): { db: FakeDb; message: SessionMirrorMessage } => {
  const db = newDb();
  const org = IDS.org;
  table(db, 'sessions').push({
    org_id: org,
    id: IDS.session,
    test_version_id: IDS.testVersion,
    ruleset_version_id: IDS.ruleset,
    state: 'submitted',
  });
  table(db, 'test_versions').push({
    org_id: org,
    id: IDS.testVersion,
    quality_cutoff: opts.cutoff ?? 40,
  });
  table(db, 'sections').push(
    { org_id: org, id: IDS.s1, test_version_id: IDS.testVersion, position: 1, weight: '1.00' },
    { org_id: org, id: IDS.s2, test_version_id: IDS.testVersion, position: 2, weight: '2.00' },
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
    test_version_id: IDS.testVersion,
    format,
    position,
    stem: `Synthetic prompt ${position}`,
    rubric_version_id: rubric,
  });
  table(db, 'item_versions').push(
    item(IDS.i1, IDS.s1, 'mcq', 1, null),
    item(IDS.i2, IDS.s1, 'mcq', 2, null),
    item(IDS.i3, IDS.s2, 'written', 3, IDS.r3),
    item(IDS.i4, IDS.s2, 'written', 4, IDS.r4),
  );
  table(db, 'item_answer_keys').push(
    { org_id: org, item_version_id: IDS.i1, option_id: 'b' },
    { org_id: org, item_version_id: IDS.i2, option_id: 'c' },
  );
  table(db, 'rubric_versions').push(
    { org_id: org, id: IDS.r3, criteria: criteria(['queue', 'retry'], 2), content_sha256: HASH_R3 },
    { org_id: org, id: IDS.r4, criteria: criteria(['index'], 1), content_sha256: HASH_R4 },
  );
  table(db, 'session_items').push(
    { org_id: org, id: IDS.si1, session_id: IDS.session, item_version_id: IDS.i1, position: 1 },
    { org_id: org, id: IDS.si2, session_id: IDS.session, item_version_id: IDS.i2, position: 2 },
    { org_id: org, id: IDS.si3, session_id: IDS.session, item_version_id: IDS.i3, position: 3 },
  );
  const choice1 = opts.choice1 === undefined ? 'b' : opts.choice1;
  if (choice1 !== null) {
    table(db, 'responses').push({
      org_id: org,
      session_id: IDS.session,
      session_item_id: IDS.si1,
      answer_kind: 'choice',
      final_choice: choice1,
    });
  }
  table(db, 'responses').push({
    org_id: org,
    session_id: IDS.session,
    session_item_id: IDS.si2,
    answer_kind: 'choice',
    final_choice: 'a',
  });
  const text3 = opts.text3 === undefined ? 'The queue will retry the message.' : opts.text3;
  if (text3 !== null) {
    table(db, 'responses').push({
      org_id: org,
      session_id: IDS.session,
      session_item_id: IDS.si3,
      answer_kind: 'text',
      final_text: text3,
    });
  }
  table(db, 'reports').push({
    org_id: org,
    id: IDS.report,
    session_id: IDS.session,
    quality_card_id: null,
    integrity_card_id: null,
  });

  const hex = 'e'.repeat(64);
  const message: SessionMirrorMessage = {
    v: 1,
    jobKind: 'session_mirror',
    mirrorSeq: 1,
    jobKey: `${IDS.session}:session_mirror:${IDS.ruleset}`,
    sessionId: IDS.session,
    orgId: org,
    invitationId: IDS.invitation,
    testVersionId: IDS.testVersion,
    rulesetVersionId: IDS.ruleset,
    consentId: IDS.consent,
    state: 'submitted',
    receiptRef: 'ABCD2345',
    startedAt: '2026-10-15T09:00:00.000Z',
    deadlineAt: '2026-10-15T10:00:00.000Z',
    submittedAt: '2026-10-15T09:30:00.000Z',
    lastEventSeq: 0,
    streamCount: 1,
    resumeCount: 0,
    served: [],
    evidence: {
      finalKey: `sessions/${org}/${IDS.session}/final.json`,
      finalSha256: hex,
      eventsKey: `sessions/${org}/${IDS.session}/events.ndjson`,
      eventsSha256: hex,
    },
    replay: 'ok',
    signalCatalogVersion: 'd1-signals-v1',
    coverage: { activeMs: 1_800_000, coveredMs: 1_800_000 },
    gaps: [],
    photo: null,
    photoSkippedReason: 'declined',
  };
  return { db, message };
};
