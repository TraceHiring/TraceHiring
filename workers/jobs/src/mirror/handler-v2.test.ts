// The mirror stage for package v2 (spec m1 R5-19, R5-42, R5-43, R5-47, R5-59 a; AT-M1-21): one session_items row per
// drawn pool item with the served facts merged in, the draw position as `position`, inline sections as D1, answers
// mapped only through served[], malformed messages refused before any write, and exactly-once on re-delivery.
import { describe, expect, it } from 'vitest';
import { sessionItemsV2 } from './draws.js';
import { inTx, mirrorHandlers, table } from './fake-db.test-helpers.js';
import { runMirror } from './handler.js';
import {
  SEED_P,
  SEED_W,
  V2,
  sessionWorldV2,
  type SessionWorldV2,
} from './world-v2.test-helpers.js';

const run = (w: SessionWorldV2, message = w.message) =>
  inTx(w.db, message.orgId, mirrorHandlers, (tx) =>
    runMirror(message, { tx, evidence: w.evidence }),
  );

const items = (w: SessionWorldV2) =>
  table(w.db, 'session_items')
    .map((r) => ({
      item: r['item_version_id'],
      section: r['section_id'],
      position: r['position'],
      served: r['served_at'] ?? null,
      variant: r['item_variant_id'] ?? null,
      order: r['option_order'] ?? null,
      seed: r['draw_seed_sha256'] ?? null,
    }))
    .sort(
      (a, b) =>
        String(a.section).localeCompare(String(b.section)) ||
        Number(a.position) - Number(b.position),
    );

describe('sessionItemsV2: one row per drawn pool item, inline rows as served (R5-42, R5-47, R5-59 a)', () => {
  it('merges served facts into the draw rows and uses the draw position, never the candidate position', async () => {
    const w = await sessionWorldV2();
    const rows = sessionItemsV2(w.message);
    const pool = rows.filter((r) => r.section_id === V2.sP);
    expect(pool).toEqual([
      {
        item_version_id: V2.b2,
        section_id: V2.sP,
        position: 1,
        served_at: '2026-10-15T09:03:00.000Z',
        item_variant_id: V2.v2b,
        option_order: ['d', 'c', 'b', 'a'],
        draw_seed_sha256: SEED_P,
      },
      {
        item_version_id: V2.b1,
        section_id: V2.sP,
        position: 2,
        served_at: '2026-10-15T09:04:00.000Z',
        item_variant_id: null,
        option_order: ['c', 'a', 'd', 'b'],
        draw_seed_sha256: SEED_P,
      },
      {
        item_version_id: V2.b3,
        section_id: V2.sP,
        position: 3,
        served_at: null,
        item_variant_id: null,
        option_order: null,
        draw_seed_sha256: null,
      },
    ]);
  });

  it('inline sections keep the session-wide served position and have no row for an unserved item', async () => {
    const w = await sessionWorldV2();
    const inline = sessionItemsV2(w.message).filter((r) => r.section_id === V2.sA);
    expect(inline.map((r) => [r.item_version_id, r.position, r.served_at !== null])).toEqual([
      [V2.iA1, 1, true],
      [V2.iA2, 2, true],
    ]);
  });

  it('a section never entered has no draw and no row', async () => {
    const w = await sessionWorldV2();
    expect(sessionItemsV2(w.message).some((r) => r.section_id === V2.sW)).toBe(false);
  });

  it('a served pool item missing from its draw is malformed (R5-42)', async () => {
    const w = await sessionWorldV2({
      patch: (m) => ({
        ...m,
        draws: m.draws.map((d) => ({
          ...d,
          itemVersionIds: [V2.b2, V2.b4, V2.b3],
        })),
      }),
    });
    expect(() => sessionItemsV2(w.message)).toThrow(/^mirror_invariant_served_missing_from_draw$/);
  });

  it('a served variant other than the drawn one is malformed', async () => {
    const w = await sessionWorldV2({
      patch: (m) => ({
        ...m,
        served: m.served.map((s) =>
          s.itemVersionId === V2.b2 ? { ...s, itemVariantId: V2.v2a } : s,
        ),
      }),
    });
    expect(() => sessionItemsV2(w.message)).toThrow(/^mirror_invariant_served_variant_mismatch$/);
  });

  it('an item drawn in two sections, or drawn and also served inline, is malformed', async () => {
    const twice = await sessionWorldV2({
      writtenEntered: true,
      patch: (m) => ({
        ...m,
        draws: m.draws.map((d) => (d.sectionId === V2.sW ? { ...d, itemVersionIds: [V2.b3] } : d)),
        served: m.served.filter((s) => s.sectionId !== V2.sW),
      }),
    });
    expect(() => sessionItemsV2(twice.message)).toThrow(/^mirror_bad_draws$/);
    const inlineToo = await sessionWorldV2({
      patch: (m) => ({
        ...m,
        draws: m.draws.map((d) => ({ ...d, itemVersionIds: [V2.b2, V2.b1, V2.iA1] })),
      }),
    });
    expect(() => sessionItemsV2(inlineToo.message)).toThrow(/^mirror_bad_draws$/);
  });
});

describe('mirror stage v2 (AT-M1-21)', () => {
  it('stores every drawn row once, served data merged, inline rows as served, and the answers through served[]', async () => {
    const w = await sessionWorldV2({ writtenEntered: true });
    await run(w);
    expect(items(w)).toEqual(
      [
        { item: V2.iA1, section: V2.sA, position: 1, served: '2026-10-15T09:01:00.000Z' },
        { item: V2.iA2, section: V2.sA, position: 2, served: '2026-10-15T09:02:00.000Z' },
        {
          item: V2.b2,
          section: V2.sP,
          position: 1,
          served: '2026-10-15T09:03:00.000Z',
          variant: V2.v2b,
          order: ['d', 'c', 'b', 'a'],
          seed: SEED_P,
        },
        {
          item: V2.b1,
          section: V2.sP,
          position: 2,
          served: '2026-10-15T09:04:00.000Z',
          order: ['c', 'a', 'd', 'b'],
          seed: SEED_P,
        },
        { item: V2.b3, section: V2.sP, position: 3, served: null },
        {
          item: V2.w1,
          section: V2.sW,
          position: 1,
          served: '2026-10-15T09:06:00.000Z',
          seed: SEED_W,
        },
      ]
        .map((r) => ({ variant: null, order: null, seed: null, ...r }))
        .sort(
          (a, b) => a.section.localeCompare(b.section) || Number(a.position) - Number(b.position),
        ),
    );
    // Every answer is attached to the row of the item served at its candidate position.
    const itemOf = new Map(
      table(w.db, 'session_items').map((r) => [r['id'], r['item_version_id']]),
    );
    expect(
      table(w.db, 'responses').map((r) => [
        itemOf.get(r['session_item_id']),
        r['final_choice'] ?? r['final_text'],
      ]),
    ).toEqual([
      [V2.iA1, 'b'],
      [V2.iA2, 'a'],
      [V2.b2, 'c'],
      [V2.b1, 'a'],
      [V2.w1, 'The queue will retry the message.'],
    ]);
    expect(table(w.db, 'idempotency_keys')).toHaveLength(1);
  });

  it('a re-delivery stores nothing new and keeps the ids', async () => {
    const w = await sessionWorldV2();
    await run(w);
    const before = structuredClone(w.db.tables);
    await run(w);
    expect(w.db.tables).toEqual(before);
  });

  it('an answer at a position with no served[] row is malformed and nothing is stored (R5-59 a)', async () => {
    // Position 5 is b3's candidate slot: drawn, never served.
    const w = await sessionWorldV2({
      answers: (all) => [
        ...all,
        // the same choice as position 1, so its hash is valid and only the position is wrong
        { position: 5, kind: 'choice', choice: 'b', sha256: all[0]?.sha256 ?? '', finalSeq: 9 },
      ],
    });
    await expect(run(w)).rejects.toThrow(/^mirror_final_invalid$/);
    expect(table(w.db, 'session_items')).toHaveLength(0);
    expect(table(w.db, 'idempotency_keys')).toHaveLength(0);
  });

  it('a served pool item absent from the draw is refused before any write', async () => {
    const w = await sessionWorldV2({
      patch: (m) => ({
        ...m,
        draws: m.draws.map((d) => ({ ...d, itemVersionIds: [V2.b2, V2.b4, V2.b3] })),
      }),
    });
    await expect(run(w)).rejects.toThrow(/^mirror_invariant_served_missing_from_draw$/);
    expect(table(w.db, 'sessions')).toHaveLength(0);
  });

  it('a draw longer than the section draw count is refused by the guard, and nothing commits', async () => {
    const w = await sessionWorldV2({
      patch: (m) => ({
        ...m,
        draws: m.draws.map((d) => ({
          ...d,
          itemVersionIds: [V2.b2, V2.b1, V2.b3, V2.b4],
          itemVariantIds: [V2.v2b, null, null, null],
        })),
      }),
    });
    await expect(run(w)).rejects.toThrow(/^mirror_failed$/);
    expect(table(w.db, 'session_items')).toHaveLength(0);
  });

  it('an item outside the published snapshot of its section is refused by the guard', async () => {
    const w = await sessionWorldV2({
      patch: (m) => ({
        ...m,
        draws: m.draws.map((d) => ({ ...d, itemVersionIds: [V2.b2, V2.b1, V2.w2] })),
      }),
    });
    await expect(run(w)).rejects.toThrow(/^mirror_failed$/);
    expect(table(w.db, 'session_items')).toHaveLength(0);
  });

  it('a v1 message keeps D1 rows: no variant, option order or seed, the served position', async () => {
    // A package v1 version serves inline items only; its message is v1 (no sections, draws or variants).
    const w = await sessionWorldV2({
      packageVersion: 1,
      answers: (all) => all.filter((a) => a.position <= 2),
    });
    const { poolSectionIds: _p, draws: _d, served, ...rest } = w.message;
    void _p;
    void _d;
    const v1 = {
      ...rest,
      v: 1 as const,
      served: served
        .filter((s) => s.sectionId === V2.sA)
        .map((s) => ({
          position: s.position,
          itemVersionId: s.itemVersionId,
          servedAt: s.servedAt,
        })),
    };
    await inTx(w.db, v1.orgId, mirrorHandlers, (tx) => runMirror(v1, { tx, evidence: w.evidence }));
    const none = { variant: null, order: null, seed: null };
    expect(items(w)).toEqual([
      { item: V2.iA1, section: V2.sA, position: 1, served: '2026-10-15T09:01:00.000Z', ...none },
      { item: V2.iA2, section: V2.sA, position: 2, served: '2026-10-15T09:02:00.000Z', ...none },
    ]);
  });
});
