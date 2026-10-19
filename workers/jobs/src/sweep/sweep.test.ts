// AT-D16 sweep case (spec d1 §5.1 "Sweep (L-18)"): a missing card or an `awaiting_quality` card is re-run from the
// R2 mirror.json once; a second sweep is a no-op. The fake below answers private.sweep_pending with the §3.4
// conditions over the shared fake tables (the age threshold is left out; the real function is proven in db-test/ and
// pgTAP rls_d1_sweep).
import type { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { createLogger } from '@trace/shared/log';
import { MockLlmGrader, type LlmGrader } from '@trace/vendors';
import { describe, expect, it } from 'vitest';
import { inTx, table, type FakeDb, type Handler } from '../mirror/fake-db.test-helpers.js';
import {
  ALL_HANDLERS,
  fakeStages,
  sessionWorld,
  type SessionWorld,
} from '../mirror/world.test-helpers.js';
import { processBatch } from '../queue/consumer.js';
import { runSweep } from '../queue/sweep.js';
import { fakeBatch, fakeMessage } from '../queue/test-fixtures.js';
import { MAX_SWEEP_LIMIT, SWEEP_SQL, sweepPending } from './pending.js';

const log = createLogger({ service: 'jobs', version: 'dev', sink: () => undefined });

/** private.sweep_pending over the fake: DEFINER, so it sees every org whatever trace.job_org_id is. */
const sweepHandler: Handler = (db: FakeDb, [limit]) => {
  const out: Record<string, unknown>[] = [];
  const sessions = table(db, 'sessions');
  for (const i of table(db, 'invitations')) {
    if (
      i['status'] === 'started' &&
      i['session_id'] != null &&
      !sessions.some((s) => s['id'] === i['session_id'])
    ) {
      const rs = table(db, 'consents').find((c) => c['invitation_id'] === i['id'])?.[
        'ruleset_version_id'
      ];
      out.push({
        org_id: i['org_id'],
        session_id: i['session_id'],
        ruleset_version_id: rs,
        stage: 'session_mirror',
      });
    }
  }
  for (const s of sessions) {
    if (s['state'] === 'in_progress') continue;
    const q = table(db, 'quality_cards').some((c) => c['session_id'] === s['id']);
    const card = table(db, 'integrity_cards').find((c) => c['session_id'] === s['id']);
    const row = {
      org_id: s['org_id'],
      session_id: s['id'],
      ruleset_version_id: s['ruleset_version_id'],
    };
    if (!q) out.push({ ...row, stage: 'quality_score' });
    if (card === undefined || (card['review_state'] === 'awaiting_quality' && q)) {
      out.push({ ...row, stage: 'integrity_band' });
    }
  }
  return out.slice(0, Number(limit));
};
const HANDLERS: Record<string, Handler> = { ...ALL_HANDLERS, [SWEEP_SQL]: sweepHandler };

/** One cron tick: sweep_pending as trace_worker (no job org), mirror.json from R2, sends collected. */
const tick = async (w: SessionWorld) => {
  const sent: SessionMirrorMessage[] = [];
  const result = await runSweep({
    pendingStages: (limit) => inTx(w.db, null, HANDLERS, (tx) => sweepPending(tx, limit)),
    readMirror: async (key) => {
      const o = await w.evidence.get(key);
      return o === null ? null : o.text();
    },
    send: (m) => {
      sent.push(m);
      return Promise.resolve();
    },
    log,
  });
  return { result, sent };
};

/** The consumer delivering what the sweep re-enqueued. */
const deliver = async (
  w: SessionWorld,
  messages: readonly SessionMirrorMessage[],
  grader: LlmGrader,
) => {
  const raws = messages.map((m, i) => fakeMessage(m, `m${i}`));
  await processBatch(fakeBatch(raws), { stages: fakeStages(w, grader), log });
  return raws.map((r) => (r.acked() === 1 ? 'ack' : 'retry'));
};

describe('sweep (AT-D16, L-18)', () => {
  it('a late quality card: awaiting_quality is re-run from mirror.json once, and the next sweep is a no-op', async () => {
    const w = await sessionWorld();
    const down: LlmGrader = { grade: () => Promise.reject(new Error('down')) };
    expect(await deliver(w, [w.message], down)).toEqual(['retry']); // the message then dead-letters
    expect(table(w.db, 'quality_cards')).toHaveLength(0);
    expect(table(w.db, 'integrity_cards')[0]?.['review_state']).toBe('awaiting_quality');

    const first = await tick(w);
    expect(first.result).toMatchObject({ pending: 1, enqueued: 1, skipped: 0 });
    expect(first.sent).toEqual([w.message]);
    expect(await deliver(w, first.sent, new MockLlmGrader())).toEqual(['ack']);
    expect(table(w.db, 'quality_cards')).toHaveLength(1);
    expect(table(w.db, 'integrity_cards')).toHaveLength(1);
    expect(table(w.db, 'integrity_cards')[0]?.['review_state']).toBe('reviewed');

    const second = await tick(w);
    expect(second.result).toEqual({ pending: 0, enqueued: 0, skipped: 0 });
    expect(second.sent).toHaveLength(0);
  });

  it('a lost enqueue: the session is mirrored from mirror.json once, all three stages run, then nothing is pending', async () => {
    const w = await sessionWorld();
    const first = await tick(w);
    expect(first.sent).toEqual([w.message]);
    expect(await deliver(w, first.sent, new MockLlmGrader())).toEqual(['ack']);
    expect(table(w.db, 'sessions')).toHaveLength(1);
    expect(table(w.db, 'quality_cards')).toHaveLength(1);
    expect(table(w.db, 'integrity_cards')).toHaveLength(1);
    expect((await tick(w)).sent).toHaveLength(0);
  });

  it('one message per session even when two stages are pending (missing quality and integrity cards)', async () => {
    const w = await sessionWorld();
    await fakeStages(w, new MockLlmGrader()).mirror(w.message);
    const { result, sent } = await tick(w);
    expect(result.pending).toBe(2);
    expect(sent).toHaveLength(1);
  });

  it('a missing mirror.json is skipped (the DO gave up; session.mirror_failed is the signal)', async () => {
    const w = await sessionWorld();
    w.evidence.objects.delete(`sessions/${w.message.orgId}/${w.message.sessionId}/mirror.json`);
    const { result, sent } = await tick(w);
    expect(result).toMatchObject({ pending: 1, enqueued: 0, skipped: 1 });
    expect(sent).toHaveLength(0);
  });

  it('refuses a limit outside 0..MAX', async () => {
    const w = await sessionWorld();
    for (const bad of [-1, 1.5, MAX_SWEEP_LIMIT + 1]) {
      await expect(inTx(w.db, null, HANDLERS, (tx) => sweepPending(tx, bad))).rejects.toThrow(
        /^sweep_bad_limit$/,
      );
    }
  });
});
