// The quality stage over the fake SqlTx (AT-D15 versions and wiring, AT-D16 exactly-once, AT-D3 no integrity input).
import { canonicalJson } from '@trace/shared/canonical-json';
import {
  MOCK_GRADER_ADAPTER_VERSION,
  MOCK_GRADER_MODEL_ID,
  MockLlmGrader,
  type LlmGrader,
} from '@trace/vendors';
import { describe, expect, it } from 'vitest';
import { inTx, qualityHandlers, shared, table, type FakeDb } from './fake-db.test-helpers.js';
import { NO_GRADER, rubricSetSha256, runQuality, sha256Hex } from './handler.js';
import { HASH_R3, HASH_R4, IDS, qualityWorld } from './world.test-helpers.js';

const KEY = `${IDS.session}:quality_score:${IDS.ruleset}`;

const countingGrader = (inner: LlmGrader = new MockLlmGrader()) => {
  let calls = 0;
  const grader: LlmGrader = {
    grade: (req, opts) => {
      calls += 1;
      return inner.grade(req, opts);
    },
  };
  return { grader, calls: () => calls };
};

const run = (
  db: FakeDb,
  message: Parameters<typeof runQuality>[0],
  grader: LlmGrader,
  log?: string[],
) => inTx(db, message.orgId, qualityHandlers, (tx) => runQuality(message, { tx, grader }), log);

describe('quality stage', () => {
  it('scores MCQ by key and written answers through the grader, then stores score, card, pointer and key', async () => {
    const { db, message } = qualityWorld();
    const g = countingGrader();
    await run(db, message, g.grader);

    // MCQ section: (100 + 0) / 2 = 50.00; written section: item 3 = 100 (both anchors), item 4 never served = 0.
    const [score] = table(db, 'scores');
    expect(score).toMatchObject({
      score: 50,
      quality_cutoff: 40,
      meets_cutoff: true,
      scoring_version: 'd1-scoring-v1',
      grader_model_id: MOCK_GRADER_MODEL_ID,
      grader_adapter_version: MOCK_GRADER_ADAPTER_VERSION,
      test_version_id: IDS.testVersion,
      rubric_version_ids: [IDS.r3, IDS.r4].sort(),
    });
    expect(score?.['section_scores']).toEqual([
      { sectionId: IDS.s1, weight: 1, scoreHundredths: 5000 },
      { sectionId: IDS.s2, weight: 2, scoreHundredths: 5000 },
    ]);
    expect(score?.['rubric_set_sha256']).toBe(
      await sha256Hex(canonicalJson([HASH_R3, HASH_R4].sort())),
    );

    // One grader call (item 3); item 4 was never served, so it is 0 without a call.
    expect(g.calls()).toBe(1);
    const runs = table(db, 'grader_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      session_item_id: IDS.si3,
      rubric_version_id: IDS.r3,
      model_id: MOCK_GRADER_MODEL_ID,
      adapter_version: MOCK_GRADER_ADAPTER_VERSION,
      pass_no: 1,
      raw_score: '1.0000',
    });
    // criteria carry ids and numbers only, never answer text
    expect(JSON.stringify(runs[0]?.['criteria'])).not.toMatch(/queue|retry|message/i);

    const [card] = table(db, 'quality_cards');
    expect(card).toMatchObject({ score: 50, meets_cutoff: true, quality_score_id: score?.['id'] });
    expect(table(db, 'reports')[0]?.['quality_card_id']).toBe(card?.['id']);
    expect(table(db, 'idempotency_keys')).toEqual([
      { org_id: IDS.org, scope: 'quality_score', key: KEY, result_ref: card?.['id'] },
    ]);
  });

  it('stores meets_cutoff = false below the cutoff and true exactly at it', async () => {
    const below = qualityWorld({ cutoff: 51 });
    await run(below.db, below.message, new MockLlmGrader());
    expect(table(below.db, 'quality_cards')[0]).toMatchObject({ score: 50, meets_cutoff: false });

    const at = qualityWorld({ cutoff: 50 });
    await run(at.db, at.message, new MockLlmGrader());
    expect(table(at.db, 'quality_cards')[0]).toMatchObject({ score: 50, meets_cutoff: true });
  });

  it('scores an unanswered MCQ and an empty written answer 0 without calling the grader', async () => {
    const { db, message } = qualityWorld({ choice1: null, text3: '   ' });
    const g = countingGrader();
    await run(db, message, g.grader);
    expect(g.calls()).toBe(0);
    expect(table(db, 'grader_runs')).toHaveLength(0);
    expect(table(db, 'scores')[0]).toMatchObject({
      score: 0,
      grader_model_id: NO_GRADER,
      grader_adapter_version: NO_GRADER,
    });
  });

  it('a replay of the same message stores nothing new and keeps the ids (AT-D16)', async () => {
    const { db, message } = qualityWorld();
    const g = countingGrader();
    await run(db, message, g.grader);
    const before = structuredClone(db.tables);
    await run(db, message, g.grader);
    expect(db.tables).toEqual(before);
    expect(g.calls()).toBe(1); // the key short-circuits the replay
  });

  it('a replay without the key (crash after commit is impossible, but a lost key is not) re-reads the same ids', async () => {
    const { db, message } = qualityWorld();
    await run(db, message, new MockLlmGrader());
    const cardId = table(db, 'quality_cards')[0]?.['id'];
    db.tables['idempotency_keys'] = [];
    await run(db, message, new MockLlmGrader());
    expect(table(db, 'scores')).toHaveLength(1);
    expect(table(db, 'quality_cards')).toHaveLength(1);
    expect(table(db, 'grader_runs')).toHaveLength(1);
    expect(table(db, 'reports')[0]?.['quality_card_id']).toBe(cardId);
    expect(table(db, 'idempotency_keys')[0]?.['result_ref']).toBe(cardId);
  });

  it('two concurrent runs of one message give one row each and the same ids (AT-D16)', async () => {
    const { db, message } = qualityWorld();
    const grader = new MockLlmGrader();
    await Promise.all([
      shared(db, message.orgId, qualityHandlers, (tx) => runQuality(message, { tx, grader })),
      shared(db, message.orgId, qualityHandlers, (tx) => runQuality(message, { tx, grader })),
    ]);
    expect(table(db, 'scores')).toHaveLength(1);
    expect(table(db, 'quality_cards')).toHaveLength(1);
    expect(table(db, 'grader_runs')).toHaveLength(1);
    expect(table(db, 'idempotency_keys')).toHaveLength(1);
    expect(table(db, 'reports')[0]?.['quality_card_id']).toBe(
      table(db, 'quality_cards')[0]?.['id'],
    );
  });

  it('fails closed with a constant code and writes nothing when the session is not mirrored yet', async () => {
    const { db, message } = qualityWorld();
    db.tables['sessions'] = [];
    await expect(run(db, message, new MockLlmGrader())).rejects.toThrow(
      /^quality_session_missing$/,
    );
    expect(table(db, 'scores')).toHaveLength(0);
  });

  it('a grader failure rolls the whole stage back with a constant code', async () => {
    const { db, message } = qualityWorld();
    const failing: LlmGrader = {
      grade: () => Promise.reject(new Error('vendor said: The queue retries')),
    };
    const err = await run(db, message, failing).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('quality_grade_failed');
    expect(table(db, 'grader_runs')).toHaveLength(0);
    expect(table(db, 'scores')).toHaveLength(0);
    expect(table(db, 'idempotency_keys')).toHaveLength(0);
  });

  it('refuses a session whose pins differ from the message', async () => {
    const { db, message } = qualityWorld();
    await expect(
      run(db, { ...message, testVersionId: IDS.otherOrg }, new MockLlmGrader()),
    ).rejects.toThrow(/^quality_pin_mismatch$/);
  });

  it('refuses a weight that is not an integer and a rubric of another shape', async () => {
    const w = qualityWorld();
    table(w.db, 'sections')[0]!['weight'] = '1.50';
    await expect(run(w.db, w.message, new MockLlmGrader())).rejects.toThrow(/^quality_bad_weight$/);

    const r = qualityWorld();
    // the org's seeded default rubric shape (anchors as an object, no min_hits) is not gradable
    table(r.db, 'rubric_versions')[0]!['criteria'] = JSON.stringify([
      { id: 'c1', label: 'x', max_points: 4, anchors: { '0': 'none' } },
    ]);
    await expect(run(r.db, r.message, new MockLlmGrader())).rejects.toThrow(/^quality_bad_rubric$/);
  });

  it('only sees its own org (trace.job_org_id)', async () => {
    const { db, message } = qualityWorld();
    await expect(
      inTx(db, IDS.otherOrg, qualityHandlers, (tx) =>
        runQuality(message, { tx, grader: new MockLlmGrader() }),
      ),
    ).rejects.toThrow(/^quality_session_missing$/);
  });

  it('rubric_set_sha256 hashes the sorted stored hashes with canonical JSON', async () => {
    expect(await rubricSetSha256([HASH_R4, HASH_R3])).toBe(
      await sha256Hex(`["${HASH_R3}","${HASH_R4}"]`),
    );
    expect(await rubricSetSha256([])).toBe(await sha256Hex('[]'));
  });
});

describe('AT-D3: the quality result is identical whatever integrity data exists', () => {
  it('ignores every integrity row and never names the integrity schema', async () => {
    const plain = qualityWorld();
    await run(plain.db, plain.message, new MockLlmGrader());

    const noisy = qualityWorld();
    noisy.db.tables['integrity_cards'] = [
      {
        org_id: IDS.org,
        session_id: IDS.session,
        band: 'strong_concern',
        review_state: 'awaiting_quality',
      },
    ];
    noisy.db.tables['signals'] = [
      { org_id: IDS.org, session_id: IDS.session, seq: 1, kind: 'paste' },
    ];
    noisy.db.tables['flags'] = [{ org_id: IDS.org, session_id: IDS.session, rule_id: 'D1-PASTE' }];
    const log: string[] = [];
    await run(noisy.db, noisy.message, new MockLlmGrader(), log);

    const strip = (rows: Record<string, unknown>[] | undefined) =>
      (rows ?? []).map((row) => {
        const rest = { ...row };
        delete rest['id'];
        delete rest['quality_score_id'];
        return rest;
      });
    expect(strip(noisy.db.tables['scores'])).toEqual(strip(plain.db.tables['scores']));
    expect(strip(noisy.db.tables['quality_cards'])).toEqual(
      strip(plain.db.tables['quality_cards']),
    );
    expect(log.some((sql) => /integrity/i.test(sql))).toBe(false);
  });
});
