// A whole synthetic package-v2 session before the mirror runs (test only, neutral; spec m1 R5-19, R5-42, R5-47,
// R5-59 a). Three sections in `position` order: sA inline MCQ (2 items, weight 40), sP a pool MCQ section drawing 3 of
// 4 (weight 30; b2 is parameterised with variants v2a/v2b), sW a pool written section drawing 1 of 2 (weight 30).
// Session-wide candidate positions: sA 1-2, sP 3-5, sW 6. The candidate is served iA1, iA2, b2 (variant v2b, shuffled
// options) and b1; b3 is drawn but never served; sW is never entered unless `writtenEntered`. All three stage fakes
// run over one table set. Synthetic data only.
import type { FinalAnswers, SessionMirrorMessageV2 } from '@trace/shared/contracts/candidate';
import type { LlmGrader } from '@trace/vendors';
import {
  ALL_SIGNALS_ENABLED,
  D1_RULES as rules,
  MemoryEvidence,
  heartbeat,
  ndjson,
  paste,
} from '../integrity/world.test-helpers.js';
import type { Stages } from '../queue/consumer.js';
import { sha256Hex } from './evidence.js';
import { inTx, newDb, table, type FakeDb } from './fake-db.test-helpers.js';
import { createStages } from './pipeline.js';
import { ALL_HANDLERS } from './world.test-helpers.js';

const id = (n: number): string =>
  `a4c9e2f7-5b1d-4e8a-9c3f-6d2b8e${(0x7a40 + n).toString(16).padStart(6, '0')}`;

export const V2 = {
  org: id(1),
  session: id(3),
  invitation: id(4),
  testVersion: id(5),
  ruleset: id(6),
  consent: id(7),
  bandRules: id(8),
  sA: id(10),
  sP: id(11),
  sW: id(12),
  poolP: id(13),
  poolW: id(14),
  iA1: id(20),
  iA2: id(21),
  b1: id(30),
  b2: id(31),
  b3: id(32),
  b4: id(33),
  w1: id(34),
  w2: id(35),
  v2a: id(40),
  v2b: id(41),
  rw1: id(50),
  rw2: id(51),
  streamA: id(60),
} as const;

export const SEED_P = '7'.repeat(64);
export const SEED_W = '6'.repeat(64);
export const PHOTO_SHA_V2 = '5'.repeat(64);
export const PHOTO_BYTES_V2 = 1024;
export const PHOTO_KEY_V2 = `media/${V2.org}/${V2.session}/start_photo.jpg`;
export const WRITTEN_TEXT = 'The queue will retry the message.';

const criteria = (anchors: string[], minHits: number) =>
  JSON.stringify([
    { id: 'c1', label: 'Names the mechanism', max_points: 4, anchors, min_hits: minHits },
  ]);

export interface SessionWorldV2 {
  db: FakeDb;
  evidence: MemoryEvidence;
  message: SessionMirrorMessageV2;
  final: FinalAnswers;
}

export interface SessionWorldV2Options {
  /** sW entered: w1 drawn, served at position 6 and answered. */
  writtenEntered?: boolean;
  /** Edits the message before it is stored in R2 (final.json is rebuilt from `answers`). */
  patch?: (m: SessionMirrorMessageV2) => SessionMirrorMessageV2;
  /** Replaces the final answers (positions are session-wide). */
  answers?: (all: FinalAnswers['answers']) => FinalAnswers['answers'];
  packageVersion?: 1 | 2;
}

const served = (n: number): string => `2026-10-15T09:0${n}:00.000Z`;

export const sessionWorldV2 = async (opts: SessionWorldV2Options = {}): Promise<SessionWorldV2> => {
  const db = newDb();
  const org = V2.org;
  const tv = V2.testVersion;
  table(db, 'invitations').push({
    org_id: org,
    id: V2.invitation,
    status: 'started',
    session_id: V2.session,
    adult_confirmed_by_inviter: true,
    adult_self_declared: true,
  });
  table(db, 'consents').push({
    org_id: org,
    id: V2.consent,
    invitation_id: V2.invitation,
    ruleset_version_id: V2.ruleset,
  });
  table(db, 'test_versions').push({
    org_id: org,
    id: tv,
    quality_cutoff: 40,
    package_version: opts.packageVersion ?? 2,
  });
  table(db, 'sections').push(
    { org_id: org, id: V2.sA, test_version_id: tv, position: 1, weight: '40.00', draw_count: null },
    { org_id: org, id: V2.sP, test_version_id: tv, position: 2, weight: '30.00', draw_count: 3 },
    { org_id: org, id: V2.sW, test_version_id: tv, position: 3, weight: '30.00', draw_count: 1 },
  );
  const inline = (iid: string, position: number) => ({
    org_id: org,
    id: iid,
    section_id: V2.sA,
    test_version_id: tv,
    format: 'mcq',
    position,
    stem: `[synthetic] inline prompt ${position}`,
    rubric_version_id: null,
    is_parameterised: false,
  });
  const bank = (iid: string, format: string, rubric: string | null, param = false) => ({
    org_id: org,
    id: iid,
    section_id: null,
    test_version_id: null,
    format,
    position: null,
    stem: `[synthetic] bank prompt ${iid.slice(-2)}`,
    rubric_version_id: rubric,
    is_parameterised: param,
  });
  table(db, 'item_versions').push(
    inline(V2.iA1, 1),
    inline(V2.iA2, 2),
    bank(V2.b1, 'mcq', null),
    bank(V2.b2, 'mcq', null, true),
    bank(V2.b3, 'mcq', null),
    bank(V2.b4, 'mcq', null),
    bank(V2.w1, 'written', V2.rw1),
    bank(V2.w2, 'written', V2.rw2),
  );
  table(db, 'item_variants').push(
    { org_id: org, id: V2.v2a, item_version_id: V2.b2 },
    { org_id: org, id: V2.v2b, item_version_id: V2.b2 },
  );
  table(db, 'item_answer_keys').push(
    { org_id: org, item_version_id: V2.iA1, option_id: 'b' },
    { org_id: org, item_version_id: V2.iA2, option_id: 'c' },
    { org_id: org, item_version_id: V2.b1, option_id: 'a' },
    // The parameterised item's own key differs from its variants' keys: only the served variant's key may score.
    { org_id: org, item_version_id: V2.b2, option_id: 'a' },
    { org_id: org, item_version_id: V2.b3, option_id: 'd' },
    { org_id: org, item_version_id: V2.b4, option_id: 'a' },
  );
  table(db, 'item_variant_keys').push(
    { org_id: org, item_variant_id: V2.v2a, option_id: 'b' },
    { org_id: org, item_variant_id: V2.v2b, option_id: 'c' },
  );
  const snap = (section: string, item: string) => ({
    org_id: org,
    test_version_id: tv,
    section_id: section,
    item_version_id: item,
  });
  table(db, 'section_pool_snapshot').push(
    snap(V2.sA, V2.iA1),
    snap(V2.sA, V2.iA2),
    snap(V2.sP, V2.b1),
    snap(V2.sP, V2.b2),
    snap(V2.sP, V2.b3),
    snap(V2.sP, V2.b4),
    snap(V2.sW, V2.w1),
    snap(V2.sW, V2.w2),
  );
  table(db, 'rubric_versions').push(
    {
      org_id: org,
      id: V2.rw1,
      criteria: criteria(['queue', 'retry'], 2),
      content_sha256: 'c'.repeat(64),
    },
    { org_id: org, id: V2.rw2, criteria: criteria(['index'], 1), content_sha256: 'd'.repeat(64) },
  );
  table(db, 'ruleset_versions').push({
    org_id: org,
    id: V2.ruleset,
    band_rule_version_id: V2.bandRules,
    signal_settings: ALL_SIGNALS_ENABLED,
  });
  table(db, 'band_rule_versions').push({
    org_id: org,
    id: V2.bandRules,
    version_no: 1,
    families: rules.families,
    coverage_floor_permille: rules.coverageFloorPermille,
    coverage_photo_missing_factor_permille: rules.coveragePhotoMissingFactorPermille,
    rules: rules.rules,
  });

  const written = opts.writtenEntered === true;
  const choice = async (position: number, c: string, finalSeq: number) => ({
    position,
    kind: 'choice' as const,
    choice: c,
    sha256: await sha256Hex(c),
    finalSeq,
  });
  let answers: FinalAnswers['answers'] = [
    await choice(1, 'b', 2), // iA1 correct
    await choice(2, 'a', 3), // iA2 wrong
    await choice(3, 'c', 4), // b2 as variant v2b: correct by the variant key (the item's own key says 'a')
    await choice(4, 'a', 5), // b1 correct
  ];
  if (written) {
    answers.push({
      position: 6,
      kind: 'text',
      text: WRITTEN_TEXT,
      sha256: await sha256Hex(WRITTEN_TEXT),
      finalSeq: 7,
    });
  }
  if (opts.answers !== undefined) answers = opts.answers(answers);
  const final: FinalAnswers = { v: 1, sessionId: V2.session, answers };
  const finalBody = JSON.stringify(final);
  const lines = [
    heartbeat(1, 10_000, V2.streamA),
    paste(4, 20_000, V2.streamA),
    heartbeat(5, 30_000, V2.streamA),
  ];
  const eventsBody = ndjson(lines);
  const evidence = new MemoryEvidence();
  const finalKey = `sessions/${org}/${V2.session}/final.json`;
  const eventsKey = `sessions/${org}/${V2.session}/events.ndjson`;
  evidence.put(finalKey, finalBody);
  evidence.put(eventsKey, eventsBody);
  evidence.put(PHOTO_KEY_V2, new Uint8Array(PHOTO_BYTES_V2), {
    sha256: PHOTO_SHA_V2,
    blurred: '1',
  });

  let message: SessionMirrorMessageV2 = {
    v: 2,
    jobKind: 'session_mirror',
    mirrorSeq: 1,
    jobKey: `${V2.session}:session_mirror:${V2.ruleset}`,
    sessionId: V2.session,
    orgId: org,
    invitationId: V2.invitation,
    testVersionId: tv,
    rulesetVersionId: V2.ruleset,
    consentId: V2.consent,
    state: 'submitted',
    receiptRef: 'M2Q7R4TX',
    startedAt: '2026-10-15T09:00:00.000Z',
    deadlineAt: '2026-10-15T10:00:00.000Z',
    submittedAt: '2026-10-15T09:30:00.000Z',
    lastEventSeq: 8,
    streamCount: 1,
    resumeCount: 0,
    served: [
      { position: 1, itemVersionId: V2.iA1, servedAt: served(1), sectionId: V2.sA },
      { position: 2, itemVersionId: V2.iA2, servedAt: served(2), sectionId: V2.sA },
      {
        position: 3,
        itemVersionId: V2.b2,
        servedAt: served(3),
        sectionId: V2.sP,
        itemVariantId: V2.v2b,
        optionOrder: ['d', 'c', 'b', 'a'],
        drawSeedSha256: SEED_P,
      },
      {
        position: 4,
        itemVersionId: V2.b1,
        servedAt: served(4),
        sectionId: V2.sP,
        optionOrder: ['c', 'a', 'd', 'b'],
        drawSeedSha256: SEED_P,
      },
      ...(written
        ? [
            {
              position: 6,
              itemVersionId: V2.w1,
              servedAt: served(6),
              sectionId: V2.sW,
              drawSeedSha256: SEED_W,
            },
          ]
        : []),
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
    photo: {
      key: PHOTO_KEY_V2,
      sha256: PHOTO_SHA_V2,
      bytes: PHOTO_BYTES_V2,
      mime: 'image/jpeg',
      blurredOnDevice: true,
    },
    photoSkippedReason: null,
    poolSectionIds: [V2.sP, V2.sW],
    draws: [
      {
        sectionId: V2.sP,
        itemVersionIds: [V2.b2, V2.b1, V2.b3],
        itemVariantIds: [V2.v2b, null, null],
      },
      ...(written ? [{ sectionId: V2.sW, itemVersionIds: [V2.w1], itemVariantIds: [null] }] : []),
    ],
  };
  if (opts.patch !== undefined) message = opts.patch(message);
  evidence.put(`sessions/${org}/${V2.session}/mirror.json`, JSON.stringify(message));
  return { db, evidence, message, final };
};

/** The three real stages over the v2 world's fake, each in its own (fake) transaction with the job org set. */
export const fakeStagesV2 = (w: SessionWorldV2, grader: LlmGrader): Stages =>
  createStages({
    db: { run: (_stage, orgId, fn) => inTx(w.db, orgId, ALL_HANDLERS, fn) },
    evidence: w.evidence,
    grader,
  });
