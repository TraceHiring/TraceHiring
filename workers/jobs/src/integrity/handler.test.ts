// The integrity stage over the fake SqlTx and evidence bucket: AT-D5 (T3 cap, unvalidated never raises, evidence
// wins), AT-D6 (low coverage never Clear, a missing photo lowers coverage only), AT-D14 (rule 6 paths from
// meets_cutoff only; awaiting -> final once), AT-D16 (exactly-once, out-of-order events, the two-stream gseq case).
import { describe, expect, it } from 'vitest';
import { inTx, integrityHandlers, shared, table, type FakeDb } from './fake-db.test-helpers.js';
import { runIntegrity } from './handler.js';
import { SQL } from './store.js';
import {
  IDS,
  PHOTO_BYTES,
  PHOTO_SHA,
  addQualityCard,
  fullscreenExit,
  heartbeat,
  integrityWorld,
  paste,
  tabHidden,
  untrusted,
  type IntegrityWorld,
} from './world.test-helpers.js';

const KEY = `${IDS.session}:integrity_band:${IDS.ruleset}`;

const run = (w: IntegrityWorld, message = w.message) =>
  inTx(w.db, message.orgId, integrityHandlers, (tx) =>
    runIntegrity(message, { tx, evidence: w.evidence }),
  );

const card = (db: FakeDb) => table(db, 'integrity_cards')[0];

describe('integrity bands from browser facts (AT-D5)', () => {
  it('a paste gives Review (T3 cap), a pending flag, a reviewed card, timeline, pointer and key', async () => {
    const w = await integrityWorld();
    await run(w);
    expect(card(w.db)).toMatchObject({
      band: 'review',
      review_state: 'reviewed',
      photo_missing: false,
    });
    expect(table(w.db, 'flags')).toEqual([
      expect.objectContaining({
        rule_id: 'D1-PASTE',
        state: 'pending',
        tier: 'T3',
        severity: 'medium',
        untrusted: false,
        count: 1,
        signal_seqs: [2],
        first_offset_ms: 20_000,
      }),
    ]);
    // heartbeats are not signals; the paste keeps its gseq and no content
    expect(table(w.db, 'signals')).toEqual([
      expect.objectContaining({
        seq: 2,
        kind: 'paste',
        offset_ms: 20_000,
        item_position: 1,
        details: { len: 42 },
      }),
    ]);
    expect(table(w.db, 'timeline')).toEqual([
      expect.objectContaining({
        position: 1,
        entry_kind: 'flag',
        signal_kind: 'paste',
        rule_id: 'D1-PASTE',
        flag_state: 'pending',
        observed: { len: 42 },
        signal_seqs: [2],
      }),
    ]);
    expect(table(w.db, 'reports')[0]?.['integrity_card_id']).toBe(card(w.db)?.['id']);
    expect(table(w.db, 'idempotency_keys')).toEqual([
      { org_id: IDS.org, scope: 'integrity_band', key: KEY, result_ref: card(w.db)?.['id'] },
    ]);
    expect(table(w.db, 'results')[0]).toMatchObject({
      band: 'review',
      engine_version: 'band-engine-2',
      evidence_strength: '1.00',
      coverage_permille: 1000,
      coverage_floor_permille: 700,
    });
    expect(table(w.db, 'results')[0]?.['input_hash']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('untrusted input gives Strong concern', async () => {
    const w = await integrityWorld({ lines: [heartbeat(1, 5_000), untrusted(2, 9_000)] });
    await run(w);
    expect(card(w.db)).toMatchObject({ band: 'strong_concern', review_state: 'reviewed' });
    expect(table(w.db, 'flags')[0]).toMatchObject({
      rule_id: 'D1-UNTRUSTED-INPUT',
      untrusted: true,
      severity: 'hard',
    });
  });

  it('a paste plus untrusted input is Strong concern', async () => {
    const w = await integrityWorld({ lines: [paste(1, 1_000), untrusted(2, 2_000)] });
    await run(w);
    expect(card(w.db)?.['band']).toBe('strong_concern');
    expect(table(w.db, 'flags')).toHaveLength(2);
  });

  it('50 tab_hidden events stay Clear: unvalidated rules are context only', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => tabHidden(i + 1, (i + 1) * 20_000, 8_000));
    const w = await integrityWorld({ lines });
    await run(w);
    expect(card(w.db)).toMatchObject({ band: 'clear', review_state: 'reviewed' });
    expect(table(w.db, 'flags')).toHaveLength(0);
    const timeline = table(w.db, 'timeline');
    expect(timeline).toHaveLength(50);
    expect(timeline.every((e) => e['entry_kind'] === 'context' && e['family'] === 'focus')).toBe(
      true,
    );
    expect(timeline.map((e) => e['position'])).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('a fullscreen exit is context only', async () => {
    const w = await integrityWorld({ lines: [fullscreenExit(1, 3_000)] });
    await run(w);
    expect(card(w.db)?.['band']).toBe('clear');
    expect(table(w.db, 'timeline')[0]).toMatchObject({
      entry_kind: 'context',
      rule_id: null,
      flag_state: null,
    });
  });
});

describe('coverage and the start photo (AT-D6)', () => {
  it('coverage 50% with no event is Insufficient evidence, never Clear', async () => {
    const w = await integrityWorld({
      lines: [],
      coverage: { activeMs: 1_000_000, coveredMs: 500_000 },
    });
    await run(w);
    expect(card(w.db)).toMatchObject({ band: 'insufficient_evidence', coverage_permille: 500 });
  });

  it('coverage 50% with a paste is still Review (evidence wins)', async () => {
    const w = await integrityWorld({
      lines: [paste(1, 1_000)],
      coverage: { activeMs: 1_000_000, coveredMs: 500_000 },
    });
    await run(w);
    expect(card(w.db)?.['band']).toBe('review');
  });

  it('a missing photo lowers coverage only: 90% becomes 675 permille, flags unchanged', async () => {
    const coverage = { activeMs: 1_000_000, coveredMs: 900_000 };
    const withPhoto = await integrityWorld({ lines: [], coverage });
    await run(withPhoto);
    expect(card(withPhoto.db)).toMatchObject({
      band: 'clear',
      coverage_permille: 900,
      photo_missing: false,
    });

    const noPhoto = await integrityWorld({ lines: [], coverage, photo: 'none' });
    await run(noPhoto);
    expect(card(noPhoto.db)).toMatchObject({
      band: 'insufficient_evidence',
      coverage_permille: 675,
      photo_missing: true,
    });
    // no timeline entry for a missing photo
    expect(table(noPhoto.db, 'timeline')).toHaveLength(0);

    const pasteNoPhoto = await integrityWorld({
      lines: [paste(1, 1_000)],
      coverage,
      photo: 'none',
    });
    await run(pasteNoPhoto);
    const pastePhoto = await integrityWorld({ lines: [paste(1, 1_000)], coverage });
    await run(pastePhoto);
    expect(card(pasteNoPhoto.db)?.['band']).toBe('review');
    const flagsOf = (db: FakeDb) => table(db, 'flags').map((f) => ({ ...f, id: undefined }));
    expect(flagsOf(pasteNoPhoto.db)).toEqual(flagsOf(pastePhoto.db));
  });

  it('fails closed: a canonical photo that is absent or has another sha256 counts as missing', async () => {
    for (const photo of ['missing_object', 'other_sha'] as const) {
      const w = await integrityWorld({ lines: [], photo });
      await run(w);
      expect(card(w.db)?.['photo_missing']).toBe(true);
    }
  });
});

describe('score-first triage from meets_cutoff only (AT-D14, rule 6)', () => {
  it('below the cutoff: flags not_used, card not_reviewed_below_cutoff, no timeline, no pointer, key stored', async () => {
    const w = await integrityWorld({ meetsCutoff: false });
    await run(w);
    expect(card(w.db)).toMatchObject({ review_state: 'not_reviewed_below_cutoff', band: 'review' });
    expect(table(w.db, 'flags').map((f) => f['state'])).toEqual(['not_used']);
    expect(table(w.db, 'timeline')).toHaveLength(0);
    expect(table(w.db, 'reports')[0]?.['integrity_card_id']).toBeNull();
    expect(table(w.db, 'idempotency_keys')).toHaveLength(1);
  });

  it('no quality card yet: awaiting_quality with no flag, timeline, pointer or key; a later run flips it once', async () => {
    const w = await integrityWorld({ meetsCutoff: null });
    await run(w);
    expect(card(w.db)).toMatchObject({ review_state: 'awaiting_quality', band: 'review' });
    expect(table(w.db, 'signals')).toHaveLength(1);
    expect(table(w.db, 'results')).toHaveLength(1);
    expect(table(w.db, 'flags')).toHaveLength(0);
    expect(table(w.db, 'timeline')).toHaveLength(0);
    expect(table(w.db, 'reports')[0]?.['integrity_card_id']).toBeNull();
    expect(table(w.db, 'idempotency_keys')).toHaveLength(0);

    // still no quality card: a retry changes nothing
    const before = structuredClone(w.db.tables);
    await run(w);
    expect(w.db.tables).toEqual(before);

    addQualityCard(w.db, true);
    const cardId = card(w.db)?.['id'];
    await run(w);
    expect(table(w.db, 'integrity_cards')).toHaveLength(1);
    expect(card(w.db)).toMatchObject({ id: cardId, review_state: 'reviewed' });
    expect(table(w.db, 'results')).toHaveLength(1);
    expect(table(w.db, 'signals')).toHaveLength(1);
    expect(table(w.db, 'flags').map((f) => f['state'])).toEqual(['pending']);
    expect(table(w.db, 'timeline')).toHaveLength(1);
    expect(table(w.db, 'reports')[0]?.['integrity_card_id']).toBe(cardId);
    expect(table(w.db, 'idempotency_keys')).toHaveLength(1);

    const after = structuredClone(w.db.tables);
    await run(w);
    expect(w.db.tables).toEqual(after);
  });

  it('awaiting then a below-cutoff quality card flips to not_reviewed_below_cutoff with not_used flags', async () => {
    const w = await integrityWorld({ meetsCutoff: null });
    await run(w);
    addQualityCard(w.db, false);
    await run(w);
    expect(card(w.db)?.['review_state']).toBe('not_reviewed_below_cutoff');
    expect(table(w.db, 'flags').map((f) => f['state'])).toEqual(['not_used']);
    expect(table(w.db, 'timeline')).toHaveLength(0);
    expect(table(w.db, 'reports')[0]?.['integrity_card_id']).toBeNull();
  });

  it('a quality card landing between the gate read and the awaiting insert is a retry, and nothing commits', async () => {
    // Shared tables: the "other connection" (the quality stage) commits its card right after our gate read.
    const w = await integrityWorld({ meetsCutoff: null });
    const err = await shared(w.db, IDS.org, integrityHandlers, (tx) =>
      runIntegrity(w.message, {
        tx: {
          query: async <R extends object>(
            text: string,
            params?: readonly (string | number | boolean | null)[],
          ) => {
            const rows = await tx.query<R>(text, params);
            if (text === SQL.meetsCutoff) addQualityCard(w.db, true);
            return rows;
          },
        },
        evidence: w.evidence,
      }),
    ).catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe('integrity_retry');
    expect(table(w.db, 'integrity_cards')).toHaveLength(0);
  });
});

describe('the stored result is checked on every path (spec F1, F2; rule 3)', () => {
  const awaiting = async (opts: Parameters<typeof integrityWorld>[0] = {}) => {
    const w = await integrityWorld({ ...opts, meetsCutoff: null });
    await run(w);
    expect(card(w.db)?.['review_state']).toBe('awaiting_quality');
    return w;
  };
  const result = (db: FakeDb) => table(db, 'results')[0]!;

  it.each([
    ['another engine_version', 'engine_version', 'band-engine-0.0.0-other'],
    ['another band', 'band', 'clear'],
  ])(
    'F1: a stored result with %s fails the flip with integrity_input_changed',
    async (_n, col, value) => {
      const w = await awaiting();
      result(w.db)[col] = value;
      addQualityCard(w.db, true);
      const before = structuredClone(w.db.tables);
      await expect(run(w)).rejects.toThrow(/^integrity_input_changed$/);
      expect(w.db.tables).toEqual(before);
    },
  );

  it.each([
    ['another engine_version', 'engine_version', 'band-engine-0.0.0-other'],
    ['another band', 'band', 'clear'],
  ])(
    'F1: a stored result with %s fails the direct path with integrity_input_changed',
    async (_n, col, value) => {
      // a result row without a card (as if the card insert of an earlier run had not committed)
      const w = await awaiting();
      w.db.tables['integrity_cards'] = [];
      result(w.db)[col] = value;
      addQualityCard(w.db, true);
      await expect(run(w)).rejects.toThrow(/^integrity_input_changed$/);
      expect(table(w.db, 'integrity_cards')).toHaveLength(0);
    },
  );

  it('F2: the flip takes photo_missing from the stored result, so a photo deleted since does not dead-letter it', async () => {
    const w = await awaiting();
    expect(result(w.db)['photo_missing']).toBe(false);
    w.evidence.objects.delete(`media/${IDS.org}/${IDS.session}/start_photo.jpg`);
    addQualityCard(w.db, true);
    await run(w);
    expect(card(w.db)).toMatchObject({ review_state: 'reviewed', photo_missing: false });
    expect(table(w.db, 'results')).toHaveLength(1);
  });

  it('F2: the flip keeps a stored photo_missing true even when the photo shows up later', async () => {
    const w = await awaiting({ photo: 'missing_object' });
    expect(result(w.db)['photo_missing']).toBe(true);
    w.evidence.put(`media/${IDS.org}/${IDS.session}/start_photo.jpg`, new Uint8Array(PHOTO_BYTES), {
      sha256: PHOTO_SHA,
      blurred: '1',
    });
    addQualityCard(w.db, true);
    await run(w);
    expect(card(w.db)).toMatchObject({ review_state: 'reviewed', photo_missing: true });
  });

  it('F2: the flip still checks the events: changed events.ndjson is integrity_events_hash_mismatch', async () => {
    const w = await awaiting();
    w.evidence.put(w.message.evidence.eventsKey, '');
    addQualityCard(w.db, true);
    await expect(run(w)).rejects.toThrow(/^integrity_events_hash_mismatch$/);
  });
});

describe('exactly-once (AT-D16)', () => {
  it('the same message twice stores one row of each and keeps the ids', async () => {
    const w = await integrityWorld();
    await run(w);
    const before = structuredClone(w.db.tables);
    await run(w);
    expect(w.db.tables).toEqual(before);
  });

  it('two concurrent runs give one row each and the same ids', async () => {
    const w = await integrityWorld();
    const go = () =>
      shared(w.db, IDS.org, integrityHandlers, (tx) =>
        runIntegrity(w.message, { tx, evidence: w.evidence }),
      );
    const outcomes = await Promise.allSettled([go(), go()]);
    // one may be refused by a guard (as Postgres would); it is then retried and finds the key
    for (const o of outcomes) if (o.status === 'rejected') await go();
    for (const t of [
      'integrity_cards',
      'results',
      'signals',
      'flags',
      'timeline',
      'idempotency_keys',
    ]) {
      expect(table(w.db, t)).toHaveLength(1);
    }
    expect(table(w.db, 'reports')[0]?.['integrity_card_id']).toBe(card(w.db)?.['id']);
  });

  it('out-of-order lines give the same rows as ordered ones', async () => {
    const lines = [
      heartbeat(1, 1_000),
      paste(2, 2_000),
      tabHidden(3, 9_000),
      untrusted(4, 12_000),
      paste(5, 15_000),
    ];
    const ordered = await integrityWorld({ lines });
    await run(ordered);
    const shuffled = await integrityWorld({
      lines: [lines[3]!, lines[0]!, lines[4]!, lines[2]!, lines[1]!],
    });
    await run(shuffled);
    const strip = (db: FakeDb, t: string) =>
      table(db, t).map((r) => ({
        ...r,
        id: undefined,
        integrity_card_id: undefined,
        integrity_result_id: undefined,
      }));
    for (const t of ['signals', 'flags', 'timeline', 'integrity_cards']) {
      expect(strip(shuffled.db, t)).toEqual(strip(ordered.db, t));
    }
    expect(table(shuffled.db, 'results')[0]?.['input_hash']).toBe(
      table(ordered.db, 'results')[0]?.['input_hash'],
    );
  });

  it('two streams, reload then paste: each paste keeps its session-global gseq and the session is Review', async () => {
    // Stream A: per-stream seq 1, 2; the page reloads; stream B starts again at per-stream seq 1, 2.
    const lines = [
      heartbeat(1, 1_000, IDS.streamA),
      paste(2, 5_000, IDS.streamA),
      heartbeat(3, 40_000, IDS.streamB),
      paste(4, 45_000, IDS.streamB),
    ];
    const w = await integrityWorld({ lines });
    await run(w);
    const seqs = table(w.db, 'signals').map((s) => s['seq']);
    expect(seqs).toEqual([2, 4]);
    expect(new Set(seqs.map((s) => `${IDS.org}:${IDS.session}:${String(s)}`)).size).toBe(2);
    expect(card(w.db)?.['band']).toBe('review');
    expect(table(w.db, 'flags')[0]).toMatchObject({ count: 2, signal_seqs: [2, 4] });
  });

  it('connectivity gaps become context signals numbered after lastEventSeq, labelled connectivity', async () => {
    const w = await integrityWorld({
      lines: [heartbeat(1, 1_000), paste(2, 2_000)],
      lastEventSeq: 7,
      gaps: [
        { from: '2026-10-15T09:10:00.000Z', to: '2026-10-15T09:11:00.000Z', label: 'connectivity' },
        { from: '2026-10-15T09:20:00.000Z', to: '2026-10-15T09:20:30.000Z', label: 'connectivity' },
      ],
    });
    await run(w);
    expect(table(w.db, 'signals').map((s) => [s['seq'], s['kind']])).toEqual([
      [2, 'paste'],
      [8, 'connectivity_gap'],
      [9, 'connectivity_gap'],
    ]);
    const gapEntries = table(w.db, 'timeline').filter(
      (e) => e['signal_kind'] === 'connectivity_gap',
    );
    expect(gapEntries).toHaveLength(2);
    expect(
      gapEntries.every((e) => e['family'] === 'connectivity' && e['entry_kind'] === 'context'),
    ).toBe(true);
    expect(gapEntries[0]?.['observed']).toEqual({ duration_ms: 60_000 });
  });
});

describe('errors leave the stage as constant codes', () => {
  it('a database error becomes integrity_failed, keeping only its SQLSTATE', async () => {
    const w = await integrityWorld();
    const tx = {
      query: () => Promise.reject(Object.assign(new Error('detail: (len 42)'), { code: '40001' })),
    };
    const err = (await runIntegrity(w.message, { tx, evidence: w.evidence }).catch(
      (e: unknown) => e,
    )) as Error;
    expect(err.message).toBe('integrity_failed');
    expect((err as Error & { code?: string }).code).toBe('40001');
  });

  // DB review #2: only the card guard's 42501 on the awaiting insert is a retry; every other error keeps its SQLSTATE.
  const failAwaitingInsert = async (fault: Error) => {
    const w = await integrityWorld({ meetsCutoff: null });
    return (await shared(w.db, IDS.org, integrityHandlers, (tx) =>
      runIntegrity(w.message, {
        tx: {
          query: <R extends object>(
            text: string,
            params?: readonly (string | number | boolean | null)[],
          ) => (text === SQL.insertCard ? Promise.reject(fault) : tx.query<R>(text, params)),
        },
        evidence: w.evidence,
      }),
    ).catch((e: unknown) => e)) as Error & { code?: string };
  };

  it('the card guard 42501 on the awaiting insert is integrity_retry', async () => {
    const guard = Object.assign(
      new Error('TRACE_GUARD: awaiting_quality needs no quality card and no flags'),
      { code: '42501' },
    );
    expect((await failAwaitingInsert(guard)).message).toBe('integrity_retry');
  });

  it.each([
    ['a serialization failure', '40001', 'could not serialize access'],
    ['a deadlock', '40P01', 'deadlock detected'],
    ['an RLS refusal (42501, not the card guard)', '42501', 'new row violates row-level security'],
  ])('%s on the awaiting insert keeps its SQLSTATE', async (_name, code, text) => {
    const err = await failAwaitingInsert(Object.assign(new Error(text), { code }));
    expect(err.message).toBe('integrity_failed');
    expect(err.code).toBe(code);
  });

  it('a connection error on the awaiting insert is integrity_failed, not a retry', async () => {
    const err = await failAwaitingInsert(new Error('write CONNECTION_CLOSED 127.0.0.1:54322'));
    expect(err.message).toBe('integrity_failed');
    expect(err.code).toBeUndefined();
  });
});

describe('fail closed', () => {
  it('a hash mismatch stores nothing and throws a constant code', async () => {
    const w = await integrityWorld();
    const message = {
      ...w.message,
      evidence: { ...w.message.evidence, eventsSha256: '0'.repeat(64) },
    };
    await expect(run(w, message)).rejects.toThrow(/^integrity_events_hash_mismatch$/);
    expect(table(w.db, 'signals')).toHaveLength(0);
    expect(table(w.db, 'integrity_cards')).toHaveLength(0);
  });

  it('a message naming another session events key is refused', async () => {
    const w = await integrityWorld();
    const message = {
      ...w.message,
      evidence: {
        ...w.message.evidence,
        eventsKey: `sessions/${IDS.org}/${IDS.otherOrg}/events.ndjson`,
      },
    };
    await expect(run(w, message)).rejects.toThrow(/^integrity_bad_message$/);
  });

  it('another org sees no session (trace.job_org_id)', async () => {
    const w = await integrityWorld();
    await expect(
      inTx(w.db, IDS.otherOrg, integrityHandlers, (tx) =>
        runIntegrity(w.message, { tx, evidence: w.evidence }),
      ),
    ).rejects.toThrow(/^integrity_session_missing$/);
  });
});
