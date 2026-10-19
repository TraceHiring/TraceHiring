// The three stages against the real local schema, grants, RLS and card guard (spec d1 §5.1; AT-D5, D6, D14, D16;
// DB review m2 n-7). Each stage runs as the consumer will run it: its own transaction on a login role that holds
// exactly one worker role, SET LOCAL ROLE and trace.job_org_id. Fixtures: one fresh random org for this file,
// removed again in afterAll.
import { MockLlmGrader } from '@trace/vendors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runIntegrity } from '../src/integrity/handler.js';
import { SQL as INTEGRITY_SQL } from '../src/integrity/store.js';
import { heartbeat, paste, tabHidden, untrusted } from '../src/integrity/world.test-helpers.js';
import { runMirror } from '../src/mirror/handler.js';
import { runQuality } from '../src/quality/handler.js';
import { sweepPending } from '../src/sweep/pending.js';
import { seedOrg, seedSession, type OrgFixture, type SessionFixture } from './fixtures.js';
import {
  SCHEMA_STATE_SQL,
  cleanupOrg,
  newId,
  openHarness,
  type Harness,
  type Isolation,
} from './harness.js';

let h: Harness;
let f: OrgFixture;
const ORG = newId();
let schemaBefore: string;
const grader = new MockLlmGrader();

const mirror = (s: SessionFixture, iso?: Isolation, conn: 'a' | 'b' = 'a') =>
  h.stageOn(
    conn,
    'trace_worker',
    s.message.orgId,
    (tx) => runMirror(s.message, { tx, evidence: s.evidence }),
    iso,
  );
const quality = (s: SessionFixture) =>
  h.stage('trace_quality_worker', s.message.orgId, (tx) => runQuality(s.message, { tx, grader }));
const integrity = (s: SessionFixture) =>
  h.stage('trace_integrity_worker', s.message.orgId, (tx) =>
    runIntegrity(s.message, { tx, evidence: s.evidence }),
  );
const all = async (s: SessionFixture) => {
  await mirror(s);
  await quality(s);
  await integrity(s);
};

type Rows = Record<string, unknown>[];
const q = async (text: string, params: readonly (string | number)[]): Promise<Rows> =>
  (await h.admin.unsafe(text, params as string[])) as unknown as Rows;

/** Every row the stages wrote for one session, ids included, in a stable order. */
const snapshot = async (session: string) => ({
  sessions: await q('select id::text, state, mirror_seq from public.sessions where id = $1', [
    session,
  ]),
  items: await q(
    'select id::text, position from public.session_items where session_id = $1 order by position',
    [session],
  ),
  responses: await q(
    'select id::text, answer_kind from public.responses where session_id = $1 order by id',
    [session],
  ),
  media: await q('select id::text, r2_key from public.media_objects where session_id = $1', [
    session,
  ]),
  reports: await q(
    'select id::text, quality_card_id::text, integrity_card_id::text from public.reports where session_id = $1',
    [session],
  ),
  scores: await q('select id::text, score from quality.scores where session_id = $1', [session]),
  runs: await q('select id::text from quality.grader_runs where session_id = $1 order by id', [
    session,
  ]),
  qcards: await q(
    'select id::text, score, meets_cutoff from public.quality_cards where session_id = $1',
    [session],
  ),
  signals: await q(
    'select id::text, seq, kind from integrity.signals where session_id = $1 order by seq',
    [session],
  ),
  results: await q('select id::text, band::text from integrity.results where session_id = $1', [
    session,
  ]),
  flags: await q(
    'select id::text, rule_id, state from integrity.flags where session_id = $1 order by rule_id',
    [session],
  ),
  icards: await q(
    'select id::text, band, review_state, photo_missing, coverage_permille, rule_table_version from public.integrity_cards where session_id = $1',
    [session],
  ),
  timeline: await q(
    'select id::text, position, entry_kind, signal_kind, flag_state from public.integrity_timeline_entries where session_id = $1 order by position',
    [session],
  ),
  keys: await q(
    "select scope, result_ref from public.idempotency_keys where key like $1 || ':%' order by scope",
    [session],
  ),
  invitation: await q('select status::text from public.invitations where session_id = $1', [
    session,
  ]),
});

beforeAll(async () => {
  const started = Date.now();
  h = await openHarness();
  // orgs a crashed earlier run left behind
  for (const r of await q("select id::text from public.orgs where slug like 'jobs-dbtest-%'", [])) {
    await cleanupOrg(h.admin, String(r['id']));
  }
  schemaBefore = String((await q(SCHEMA_STATE_SQL, []))[0]?.['fp']);
  f = await seedOrg(h, ORG, [40, 60]);
  console.info(`db-test setup ${Date.now() - started} ms`);
}, 60_000);

afterAll(async () => {
  if (h === undefined) return;
  try {
    {
      await cleanupOrg(h.admin, ORG);
      const left = await q(
        'select (select count(*) from public.orgs where id = $1) + (select count(*) from public.audit_log where org_id = $1) + (select count(*) from integrity.band_rule_versions where org_id = $1) as n',
        [ORG],
      );
      expect(Number(left[0]?.['n'])).toBe(0);
      expect(String((await q(SCHEMA_STATE_SQL, []))[0]?.['fp'])).toBe(schemaBefore);
    }
  } finally {
    await h.close();
  }
}, 60_000);

describe('full chain against the real schema', () => {
  it('a paste session: mirror -> quality -> integrity gives Review, both pointers, three keys', async () => {
    const s = await seedSession(h, f, {
      cutoff: 40,
      lines: [heartbeat(1, 10_000), paste(4, 20_000), heartbeat(5, 30_000)],
    });
    await all(s);
    const snap = await snapshot(s.session);
    expect(snap.sessions).toEqual([{ id: s.session, state: 'submitted', mirror_seq: 1 }]);
    expect(snap.items.map((r) => r['position'])).toEqual([1, 2, 3]);
    expect(snap.responses).toHaveLength(3);
    expect(snap.media).toEqual([
      expect.objectContaining({ r2_key: `media/${f.org}/${s.session}/start_photo.jpg` }),
    ]);
    expect(snap.invitation).toEqual([{ status: 'submitted' }]);
    expect(snap.qcards).toEqual([expect.objectContaining({ score: 50, meets_cutoff: true })]);
    expect(snap.runs).toHaveLength(1);
    expect(snap.signals).toEqual([expect.objectContaining({ seq: 4, kind: 'paste' })]);
    expect(snap.flags).toEqual([
      expect.objectContaining({ rule_id: 'D1-PASTE', state: 'pending' }),
    ]);
    expect(snap.icards).toEqual([
      expect.objectContaining({
        band: 'review',
        review_state: 'reviewed',
        photo_missing: false,
        rule_table_version: 'd1-v1',
      }),
    ]);
    expect(snap.timeline).toEqual([
      expect.objectContaining({
        position: 1,
        entry_kind: 'flag',
        signal_kind: 'paste',
        flag_state: 'pending',
      }),
    ]);
    expect(snap.reports).toEqual([
      expect.objectContaining({
        quality_card_id: snap.qcards[0]?.['id'],
        integrity_card_id: snap.icards[0]?.['id'],
      }),
    ]);
    expect(snap.keys.map((k) => k['scope'])).toEqual([
      'integrity_band',
      'quality_score',
      'session_mirror',
    ]);
  });

  it('an untrusted-input session gives Strong concern; 50 tab_hidden stay context', async () => {
    const lines = [
      untrusted(1, 5_000),
      ...Array.from({ length: 50 }, (_, i) => tabHidden(i + 2, (i + 2) * 20_000, 8_000)),
    ];
    const s = await seedSession(h, f, { cutoff: 40, lines });
    await all(s);
    const snap = await snapshot(s.session);
    expect(snap.icards[0]).toMatchObject({ band: 'strong_concern', review_state: 'reviewed' });
    expect(snap.flags).toEqual([
      expect.objectContaining({ rule_id: 'D1-UNTRUSTED-INPUT', state: 'pending' }),
    ]);
    expect(snap.timeline).toHaveLength(51);
    expect(snap.signals).toHaveLength(51);
  });

  it('below the cutoff: flags not_used, no timeline, integrity pointer null (rule 6)', async () => {
    const s = await seedSession(h, f, { cutoff: 60, lines: [paste(1, 1_000)] });
    await all(s);
    const snap = await snapshot(s.session);
    expect(snap.qcards[0]).toMatchObject({ score: 50, meets_cutoff: false });
    expect(snap.icards[0]).toMatchObject({
      band: 'review',
      review_state: 'not_reviewed_below_cutoff',
    });
    expect(snap.flags.map((r) => r['state'])).toEqual(['not_used']);
    expect(snap.timeline).toHaveLength(0);
    expect(snap.reports[0]).toMatchObject({
      quality_card_id: snap.qcards[0]?.['id'],
      integrity_card_id: null,
    });
    expect(snap.keys.map((k) => k['scope'])).toEqual([
      'integrity_band',
      'quality_score',
      'session_mirror',
    ]);
  });

  it('quality late: awaiting_quality, the sweep lists it, then quality and one flip; the sweep is then quiet', async () => {
    const s = await seedSession(h, f, { cutoff: 40, lines: [paste(1, 1_000)] });
    await mirror(s);
    await integrity(s);
    let snap = await snapshot(s.session);
    expect(snap.icards[0]).toMatchObject({ review_state: 'awaiting_quality', band: 'review' });
    expect(snap.flags).toHaveLength(0);
    expect(snap.timeline).toHaveLength(0);
    expect(snap.keys.map((k) => k['scope'])).toEqual(['session_mirror']);
    const cardId = snap.icards[0]?.['id'];

    const pending = async () =>
      (await h.stage('trace_worker', null, (tx) => sweepPending(tx, 500))).filter(
        (r) => r.sessionId === s.session,
      );
    expect((await pending()).map((r) => r.stage)).toEqual(['quality_score']);

    await quality(s);
    expect((await pending()).map((r) => r.stage)).toEqual(['integrity_band']);
    await integrity(s);
    snap = await snapshot(s.session);
    expect(snap.icards).toEqual([
      expect.objectContaining({ id: cardId, review_state: 'reviewed' }),
    ]);
    expect(snap.flags.map((r) => r['state'])).toEqual(['pending']);
    expect(snap.timeline).toHaveLength(1);
    expect(snap.reports[0]?.['integrity_card_id']).toBe(cardId);
    expect(await pending()).toEqual([]);
  });

  it('a start photo with another sha256 is not recorded and counts as missing', async () => {
    const s = await seedSession(h, f, { cutoff: 40, lines: [], photo: 'other_sha' });
    await all(s);
    const snap = await snapshot(s.session);
    expect(snap.media).toHaveLength(0);
    expect(snap.icards[0]).toMatchObject({
      photo_missing: true,
      coverage_permille: 750,
      band: 'clear',
    });
  });
});

describe('exactly-once against the real schema (AT-D16)', () => {
  it('a replay of every stage returns the same ids and writes nothing', async () => {
    const s = await seedSession(h, f, {
      cutoff: 40,
      lines: [heartbeat(1, 1_000), paste(2, 2_000)],
    });
    await all(s);
    const before = await snapshot(s.session);
    await all(s);
    expect(await snapshot(s.session)).toEqual(before);
  });

  it('m2 n-7: two connections mirroring one message at once give one sessions row and the same ids', async () => {
    const s = await seedSession(h, f, { cutoff: 40, lines: [paste(1, 1_000)] });
    const results = await Promise.allSettled([
      mirror(s, 'read committed', 'a'),
      mirror(s, 'read committed', 'b'),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const snap = await snapshot(s.session);
    expect(snap.sessions).toHaveLength(1);
    expect(snap.items).toHaveLength(3);
    expect(snap.responses).toHaveLength(3);
    expect(snap.reports).toHaveLength(1);
    expect(snap.keys).toEqual([{ scope: 'session_mirror', result_ref: s.session }]);
    await mirror(s);
    expect(await snapshot(s.session)).toEqual(snap);
  });

  it('under REPEATABLE READ the loser fails with 40001 and its retry is a duplicate', async () => {
    const s = await seedSession(h, f, { cutoff: 40, lines: [] });
    const results = await Promise.allSettled([
      mirror(s, 'repeatable read', 'a'),
      mirror(s, 'repeatable read', 'b'),
    ]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    for (const r of rejected) expect((r.reason as { code?: string }).code).toBe('40001');
    await mirror(s, 'repeatable read'); // the queue retry
    const snap = await snapshot(s.session);
    expect(snap.sessions).toHaveLength(1);
    expect(snap.keys).toHaveLength(1);
  });

  const integrityOn = (s: SessionFixture, conn: 'a' | 'b') =>
    h.stageOn(conn, 'trace_integrity_worker', s.message.orgId, (tx) =>
      runIntegrity(s.message, { tx, evidence: s.evidence }),
    );
  const concurrentIntegrity = async (s: SessionFixture) => {
    const results = await Promise.allSettled([integrityOn(s, 'a'), integrityOn(s, 'b')]);
    // DB review #1: both runs fulfil, no retry (the advisory lock on the job key serialises them).
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const snap = await snapshot(s.session);
    expect(snap.icards).toHaveLength(1);
    expect(snap.results).toHaveLength(1);
    expect(snap.flags).toHaveLength(1);
    expect(snap.timeline).toHaveLength(1);
    expect(snap.keys.filter((k) => k['scope'] === 'integrity_band')).toEqual([
      { scope: 'integrity_band', result_ref: snap.icards[0]?.['id'] },
    ]);
    expect(snap.reports[0]?.['integrity_card_id']).toBe(snap.icards[0]?.['id']);
    await integrity(s); // a later redelivery is a duplicate
    expect(await snapshot(s.session)).toEqual(snap);
    return snap;
  };

  it('DB #1: two concurrent integrity runs on the direct-final path both fulfil with the same ids', async () => {
    const s = await seedSession(h, f, { cutoff: 40, lines: [paste(1, 1_000)] });
    await mirror(s);
    await quality(s);
    const snap = await concurrentIntegrity(s);
    expect(snap.icards[0]).toMatchObject({ review_state: 'reviewed' });
  });

  it('DB #1: two concurrent quality runs both fulfil with one card, one score and one key', async () => {
    const s = await seedSession(h, f, { cutoff: 40, lines: [] });
    await mirror(s);
    const run = (conn: 'a' | 'b') =>
      h.stageOn(conn, 'trace_quality_worker', s.message.orgId, (tx) =>
        runQuality(s.message, { tx, grader }),
      );
    const results = await Promise.allSettled([run('a'), run('b')]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const snap = await snapshot(s.session);
    expect(snap.qcards).toHaveLength(1);
    expect(snap.scores).toHaveLength(1);
    expect(snap.keys.filter((k) => k['scope'] === 'quality_score')).toEqual([
      { scope: 'quality_score', result_ref: snap.qcards[0]?.['id'] },
    ]);
    await quality(s);
    expect(await snapshot(s.session)).toEqual(snap);
  });

  it('DB #2: a quality card committed after the gate read hits the real card guard: integrity_retry', async () => {
    const s = await seedSession(h, f, { cutoff: 40, lines: [paste(1, 1_000)] });
    await mirror(s);
    const err = await h
      .stageOn('a', 'trace_integrity_worker', s.message.orgId, (tx) =>
        runIntegrity(s.message, {
          evidence: s.evidence,
          tx: {
            query: async <R extends object>(
              text: string,
              params?: readonly (string | number | boolean | null)[],
            ) => {
              const rows = await tx.query<R>(text, params);
              if (text === INTEGRITY_SQL.meetsCutoff) {
                await h.stageOn('b', 'trace_quality_worker', s.message.orgId, (qtx) =>
                  runQuality(s.message, { tx: qtx, grader }),
                );
              }
              return rows;
            },
          },
        }),
      )
      .catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe('integrity_retry');
    expect((await snapshot(s.session)).icards).toHaveLength(0);
    await integrity(s); // the queue retry takes the final path
    expect((await snapshot(s.session)).icards[0]).toMatchObject({ review_state: 'reviewed' });
  });

  it('DB #1: two concurrent integrity runs on the flip path both fulfil with the same ids', async () => {
    const s = await seedSession(h, f, { cutoff: 40, lines: [paste(1, 1_000)] });
    await mirror(s);
    await integrity(s);
    const awaiting = await snapshot(s.session);
    expect(awaiting.icards[0]).toMatchObject({ review_state: 'awaiting_quality' });
    await quality(s);
    const snap = await concurrentIntegrity(s);
    expect(snap.icards).toEqual([
      expect.objectContaining({ id: awaiting.icards[0]?.['id'], review_state: 'reviewed' }),
    ]);
    expect(snap.results).toEqual(awaiting.results);
    expect(snap.signals).toEqual(awaiting.signals);
  });
});

describe('tenancy binding', () => {
  it('with trace.job_org_id unset the mirror sees no invitation and writes nothing', async () => {
    const s = await seedSession(h, f, { cutoff: 40, lines: [] });
    await expect(
      h.stage('trace_worker', null, (tx) => runMirror(s.message, { tx, evidence: s.evidence })),
    ).rejects.toThrow(/^mirror_invitation_missing$/);
    expect((await snapshot(s.session)).sessions).toHaveLength(0);
  });

  it('the quality stage cannot run before the mirror (no session row visible)', async () => {
    const s = await seedSession(h, f, { cutoff: 40, lines: [] });
    await expect(quality(s)).rejects.toThrow(/^quality_session_missing$/);
  });
});
