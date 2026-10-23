// The quality stage for package v2 sessions (spec m1 R5-19, R5-47; AT-M1-21; rule 1): inline sections as D1, pool
// sections by their draw_count slots filled from the candidate's own drawn items, keys loaded through session_items
// (the served variant's key for a parameterised item), options scored by id whatever the served order.
import { MockLlmGrader, type LlmGrader } from '@trace/vendors';
import { describe, expect, it } from 'vitest';
import { inTx, qualityHandlers, table, type FakeDb } from './fake-db.test-helpers.js';
import { runQuality } from './handler.js';
import { SQL } from './store.js';
import { HASH_RW1, Q2, qualityWorldV2 } from './world-v2.test-helpers.js';

const run = (
  db: FakeDb,
  message: Parameters<typeof runQuality>[0],
  grader: LlmGrader = new MockLlmGrader(),
  log?: string[],
) => inTx(db, message.orgId, qualityHandlers, (tx) => runQuality(message, { tx, grader }), log);

const sections = (db: FakeDb) =>
  (
    table(db, 'scores')[0]?.['section_scores'] as { sectionId: string; scoreHundredths: number }[]
  ).map((s) => [s.sectionId, s.scoreHundredths]);

describe('quality v2: the scored item set is the candidate own set (R5-19, R5-47)', () => {
  it('inline as D1, a pool section by draw_count slots, a never-entered pool section scores 0', async () => {
    const w = qualityWorldV2();
    await run(w.db, w.message);
    // sA (100 + 0) / 2; sP b2 100 (variant key), b1 100, b3 drawn unserved 0 -> 6667; sW never entered: 1 slot at 0.
    expect(sections(w.db)).toEqual([
      [Q2.sA, 5000],
      [Q2.sP, 6667],
      [Q2.sW, 0],
    ]);
    expect(table(w.db, 'scores')[0]).toMatchObject({
      score: 40,
      meets_cutoff: true,
      scoring_version: 'd1-scoring-v1',
      grader_model_id: 'none',
    });
    expect(table(w.db, 'quality_cards')).toHaveLength(1);
    expect(table(w.db, 'idempotency_keys')).toHaveLength(1);
  });

  it('a pool section fully answered scores every slot', async () => {
    const w = qualityWorldV2({ b3Answered: true });
    await run(w.db, w.message);
    expect(sections(w.db)[1]).toEqual([Q2.sP, 10000]);
  });

  it('a pool section partly answered: an unanswered drawn item scores 0, the denominator stays draw_count', async () => {
    const w = qualityWorldV2({ choiceB1: null });
    await run(w.db, w.message);
    expect(sections(w.db)[1]).toEqual([Q2.sP, 3333]);
  });

  it('a parameterised item is scored by its served variant key, never the item own key', async () => {
    const right = qualityWorldV2({ choiceB2: 'c' });
    await run(right.db, right.message);
    expect(sections(right.db)[1]).toEqual([Q2.sP, 6667]);
    const itemKey = qualityWorldV2({ choiceB2: 'a' }); // the item's own key, wrong for variant v2b
    await run(itemKey.db, itemKey.message);
    expect(sections(itemKey.db)[1]).toEqual([Q2.sP, 3333]);
  });

  it('shuffled options are scored by option id, whatever the served order', async () => {
    // b1 was served as ['c', 'a', 'd', 'b']: its key 'a' is the second shown option; choosing the first shown ('c')
    // or the option at the key's original index is wrong, choosing id 'a' is right.
    const first = qualityWorldV2({ choiceB1: 'c' });
    await run(first.db, first.message);
    expect(sections(first.db)[1]).toEqual([Q2.sP, 3333]);
    const byId = qualityWorldV2({ choiceB1: 'a' });
    await run(byId.db, byId.message);
    expect(sections(byId.db)[1]).toEqual([Q2.sP, 6667]);
  });

  it('an entered written pool section is graded from its drawn item and its rubric', async () => {
    const w = qualityWorldV2({ written: true });
    await run(w.db, w.message);
    expect(sections(w.db)[2]).toEqual([Q2.sW, 10000]);
    expect(table(w.db, 'grader_runs')).toEqual([
      expect.objectContaining({ session_item_id: Q2.siW1, rubric_version_id: Q2.rw1 }),
    ]);
    expect(table(w.db, 'scores')[0]).toMatchObject({ rubric_version_ids: [Q2.rw1] });
    expect(HASH_RW1).toHaveLength(64);
  });

  it('a missing variant key fails closed; it never falls back to the item own key', async () => {
    const w = qualityWorldV2({ noVariantKeys: true });
    await expect(run(w.db, w.message)).rejects.toThrow(/^quality_bad_key$/);
    expect(table(w.db, 'scores')).toHaveLength(0);
  });

  it('more drawn rows than the section draw_count fail closed', async () => {
    const w = qualityWorldV2();
    const section = table(w.db, 'sections').find((s) => s['id'] === Q2.sP);
    if (section === undefined) throw new Error('no section');
    section['draw_count'] = 2;
    await expect(run(w.db, w.message)).rejects.toThrow(/^quality_bad_draw$/);
    expect(table(w.db, 'scores')).toHaveLength(0);
  });

  it('a v2 message for a version that is not package v2 fails closed', async () => {
    const w = qualityWorldV2({ packageVersion: 1 });
    await expect(run(w.db, w.message)).rejects.toThrow(/^quality_bad_package$/);
    expect(table(w.db, 'scores')).toHaveLength(0);
  });

  it('a re-delivery stores nothing new (exactly-once under the quality_score key)', async () => {
    const w = qualityWorldV2({ written: true });
    await run(w.db, w.message);
    const before = structuredClone(w.db.tables);
    await run(w.db, w.message);
    expect(w.db.tables).toEqual(before);
  });

  it('pool keys and rubrics load through session_items, never by test_version_id alone (R5-19)', () => {
    expect(SQL.drawn).toContain('public.session_items');
    expect(SQL.drawnKeys).toContain('public.session_items');
    expect(SQL.variantKeys).toContain('public.item_variant_keys');
    expect(SQL.variantKeys).toContain('public.session_items');
    expect(SQL.rubricsV2).toContain('public.session_items');
  });
});

describe('rule 1: the v2 quality result is identical whatever integrity data exists', () => {
  it('ignores every integrity row and never names the integrity schema', async () => {
    const plain = qualityWorldV2({ written: true });
    await run(plain.db, plain.message);

    const noisy = qualityWorldV2({ written: true });
    noisy.db.tables['integrity_cards'] = [
      { org_id: Q2.org, session_id: Q2.session, band: 'strong_concern', review_state: 'reviewed' },
    ];
    noisy.db.tables['flags'] = [{ org_id: Q2.org, session_id: Q2.session, rule_id: 'D1-PASTE' }];
    noisy.db.tables['signals'] = [
      { org_id: Q2.org, session_id: Q2.session, seq: 1, kind: 'untrusted_input' },
    ];
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

  it('no quality SQL statement names the integrity schema or an integrity table', () => {
    for (const text of Object.values(SQL)) {
      expect(text).not.toMatch(/integrity|band|flag|signal/i);
    }
  });
});
