// A mirrored package-v2 session for the quality tests (spec m1 R5-19, R5-47): the rows the v2 mirror leaves plus the
// pinned version and its published snapshot. sA inline MCQ (iA1, iA2; weight 40), sP pool MCQ drawing 3 (weight 30):
// b2 served as variant v2b with shuffled options, b1 served, b3 drawn but unserved; sW pool written drawing 1 (weight
// 30), never entered unless `written`. Synthetic data only. Rule 1: this helper lives in quality/ and knows no
// integrity table.
import type { SessionMirrorMessageV2 } from '@trace/shared/contracts/candidate';
import { newDb, table, type FakeDb } from './fake-db.test-helpers.js';

const id = (n: number): string =>
  `e3b7d1c5-9f2a-4b6e-8d4c-2a9f6e${(0x5c10 + n).toString(16).padStart(6, '0')}`;

export const Q2 = {
  org: id(1),
  session: id(3),
  invitation: id(4),
  testVersion: id(5),
  ruleset: id(6),
  consent: id(7),
  sA: id(10),
  sP: id(11),
  sW: id(12),
  iA1: id(20),
  iA2: id(21),
  b1: id(30),
  b2: id(31),
  b3: id(32),
  w1: id(34),
  v2a: id(40),
  v2b: id(41),
  rw1: id(50),
  siA1: id(60),
  siA2: id(61),
  siB2: id(62),
  siB1: id(63),
  siB3: id(64),
  siW1: id(65),
  report: id(70),
} as const;

export const HASH_RW1 = 'c'.repeat(64);
export const WRITTEN_TEXT_Q = 'The queue will retry the message.';

export interface QualityWorldV2Options {
  /** sW entered: w1 drawn, served and answered. */
  written?: boolean;
  /** b2's chosen option (the served variant v2b's key is 'c'; the item's own key is 'a'). */
  choiceB2?: string | null;
  /** b1's chosen option (key 'a'). */
  choiceB1?: string | null;
  /** b3: drawn and served (answered 'd', its key) instead of drawn and unserved. */
  b3Answered?: boolean;
  packageVersion?: number;
  /** Omit the variant keys (a broken publish): the stage must fail, never fall back to the item's own key. */
  noVariantKeys?: boolean;
}

/**
 * The candidate positions of this version (R5-59 a): sA inline takes slots 1-2, sP (draw 3) slots 3-5, sW (draw 1)
 * slot 6. A pool item's slot is its section's first slot + its index in the draw.
 */
export const SLOT = { iA1: 1, iA2: 2, b2: 3, b1: 4, b3: 5, w1: 6 } as const;

export const qualityWorldV2 = (
  opts: QualityWorldV2Options = {},
): { db: FakeDb; message: SessionMirrorMessageV2 } => {
  const db = newDb();
  const org = Q2.org;
  const tv = Q2.testVersion;
  table(db, 'sessions').push({
    org_id: org,
    id: Q2.session,
    test_version_id: tv,
    ruleset_version_id: Q2.ruleset,
    state: 'submitted',
  });
  table(db, 'test_versions').push({
    org_id: org,
    id: tv,
    quality_cutoff: 40,
    package_version: opts.packageVersion ?? 2,
  });
  table(db, 'sections').push(
    { org_id: org, id: Q2.sA, test_version_id: tv, position: 1, weight: '40.00', draw_count: null },
    { org_id: org, id: Q2.sP, test_version_id: tv, position: 2, weight: '30.00', draw_count: 3 },
    { org_id: org, id: Q2.sW, test_version_id: tv, position: 3, weight: '30.00', draw_count: 1 },
  );
  const inline = (iid: string, position: number) => ({
    org_id: org,
    id: iid,
    section_id: Q2.sA,
    test_version_id: tv,
    format: 'mcq',
    position,
    stem: `[synthetic] inline prompt ${position}`,
    rubric_version_id: null,
  });
  const bank = (iid: string, format: string, rubric: string | null) => ({
    org_id: org,
    id: iid,
    section_id: null,
    test_version_id: null,
    format,
    position: null,
    stem: `[synthetic] bank prompt ${iid.slice(-2)}`,
    rubric_version_id: rubric,
  });
  table(db, 'item_versions').push(
    inline(Q2.iA1, 1),
    inline(Q2.iA2, 2),
    bank(Q2.b1, 'mcq', null),
    bank(Q2.b2, 'mcq', null),
    bank(Q2.b3, 'mcq', null),
    bank(Q2.w1, 'written', Q2.rw1),
  );
  table(db, 'item_answer_keys').push(
    { org_id: org, item_version_id: Q2.iA1, option_id: 'b' },
    { org_id: org, item_version_id: Q2.iA2, option_id: 'c' },
    { org_id: org, item_version_id: Q2.b1, option_id: 'a' },
    { org_id: org, item_version_id: Q2.b2, option_id: 'a' },
    { org_id: org, item_version_id: Q2.b3, option_id: 'd' },
  );
  if (opts.noVariantKeys !== true) {
    table(db, 'item_variant_keys').push(
      { org_id: org, item_variant_id: Q2.v2a, option_id: 'b' },
      { org_id: org, item_variant_id: Q2.v2b, option_id: 'c' },
    );
  }
  table(db, 'rubric_versions').push({
    org_id: org,
    id: Q2.rw1,
    criteria: JSON.stringify([
      {
        id: 'c1',
        label: 'Names the mechanism',
        max_points: 4,
        anchors: ['queue', 'retry'],
        min_hits: 2,
      },
    ]),
    content_sha256: HASH_RW1,
  });
  const at = (n: number): string => `2026-10-15T09:0${n}:00.000Z`;
  const row = (
    sid: string,
    item: string,
    section: string,
    position: number,
    servedAt: string | null,
    variant: string | null = null,
    order: string[] | null = null,
  ) => ({
    org_id: org,
    id: sid,
    session_id: Q2.session,
    item_version_id: item,
    section_id: section,
    position,
    served_at: servedAt,
    item_variant_id: variant,
    option_order: order,
  });
  table(db, 'session_items').push(
    row(Q2.siA1, Q2.iA1, Q2.sA, 1, at(1)),
    row(Q2.siA2, Q2.iA2, Q2.sA, 2, at(2)),
    row(Q2.siB2, Q2.b2, Q2.sP, 1, at(3), Q2.v2b, ['d', 'c', 'b', 'a']),
    row(Q2.siB1, Q2.b1, Q2.sP, 2, at(4), null, ['c', 'a', 'd', 'b']),
    row(Q2.siB3, Q2.b3, Q2.sP, 3, opts.b3Answered === true ? at(5) : null),
  );
  if (opts.written === true) table(db, 'session_items').push(row(Q2.siW1, Q2.w1, Q2.sW, 1, at(6)));
  const choice = (si: string, c: string | null | undefined) => {
    if (c === null || c === undefined) return;
    table(db, 'responses').push({
      org_id: org,
      session_id: Q2.session,
      session_item_id: si,
      answer_kind: 'choice',
      final_choice: c,
    });
  };
  choice(Q2.siA1, 'b');
  choice(Q2.siA2, 'a');
  choice(Q2.siB2, opts.choiceB2 === undefined ? 'c' : opts.choiceB2);
  choice(Q2.siB1, opts.choiceB1 === undefined ? 'a' : opts.choiceB1);
  if (opts.b3Answered === true) choice(Q2.siB3, 'd');
  if (opts.written === true) {
    table(db, 'responses').push({
      org_id: org,
      session_id: Q2.session,
      session_item_id: Q2.siW1,
      answer_kind: 'text',
      final_text: WRITTEN_TEXT_Q,
    });
  }
  table(db, 'reports').push({
    org_id: org,
    id: Q2.report,
    session_id: Q2.session,
    quality_card_id: null,
    integrity_card_id: null,
  });

  const hex = 'e'.repeat(64);
  // served[] as the edge mirrors it: the candidate's session-wide slot, the section, variant and option order.
  const served: SessionMirrorMessageV2['served'] = [
    { position: SLOT.iA1, itemVersionId: Q2.iA1, servedAt: at(1), sectionId: Q2.sA },
    { position: SLOT.iA2, itemVersionId: Q2.iA2, servedAt: at(2), sectionId: Q2.sA },
    {
      position: SLOT.b2,
      itemVersionId: Q2.b2,
      servedAt: at(3),
      sectionId: Q2.sP,
      itemVariantId: Q2.v2b,
      optionOrder: ['d', 'c', 'b', 'a'],
    },
    {
      position: SLOT.b1,
      itemVersionId: Q2.b1,
      servedAt: at(4),
      sectionId: Q2.sP,
      optionOrder: ['c', 'a', 'd', 'b'],
    },
  ];
  if (opts.b3Answered === true) {
    served.push({ position: SLOT.b3, itemVersionId: Q2.b3, servedAt: at(5), sectionId: Q2.sP });
  }
  if (opts.written === true) {
    served.push({ position: SLOT.w1, itemVersionId: Q2.w1, servedAt: at(6), sectionId: Q2.sW });
  }
  const message: SessionMirrorMessageV2 = {
    v: 2,
    jobKind: 'session_mirror',
    mirrorSeq: 1,
    jobKey: `${Q2.session}:session_mirror:${Q2.ruleset}`,
    sessionId: Q2.session,
    orgId: org,
    invitationId: Q2.invitation,
    testVersionId: tv,
    rulesetVersionId: Q2.ruleset,
    consentId: Q2.consent,
    state: 'submitted',
    receiptRef: 'ABCD2346',
    startedAt: '2026-10-15T09:00:00.000Z',
    deadlineAt: '2026-10-15T10:00:00.000Z',
    submittedAt: '2026-10-15T09:30:00.000Z',
    lastEventSeq: 0,
    streamCount: 1,
    resumeCount: 0,
    served,
    evidence: {
      finalKey: `sessions/${org}/${Q2.session}/final.json`,
      finalSha256: hex,
      eventsKey: `sessions/${org}/${Q2.session}/events.ndjson`,
      eventsSha256: hex,
    },
    replay: 'ok',
    signalCatalogVersion: 'd1-signals-v1',
    coverage: { activeMs: 1_800_000, coveredMs: 1_800_000 },
    gaps: [],
    photo: null,
    photoSkippedReason: 'declined',
    poolSectionIds: [Q2.sP, Q2.sW],
    draws: [
      {
        sectionId: Q2.sP,
        itemVersionIds: [Q2.b2, Q2.b1, Q2.b3],
        itemVariantIds: [Q2.v2b, null, null],
      },
      ...(opts.written === true
        ? [{ sectionId: Q2.sW, itemVersionIds: [Q2.w1], itemVariantIds: [null] }]
        : []),
    ],
  };
  return { db, message };
};
