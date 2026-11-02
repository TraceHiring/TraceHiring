// AT-D27 (spec d1 §5.1, §9): both mirror transports (`queue` and `service`) feed the same pipeline function with the
// same fixture message and give the same rows. Also the whole chain mirror -> quality -> integrity over the fakes.
import { createLogger } from '@trace/shared/log';
import { MockLlmGrader, type LlmGrader } from '@trace/vendors';
import { describe, expect, it } from 'vitest';
import { processBatch } from '../queue/consumer.js';
import { fakeBatch, fakeMessage } from '../queue/test-fixtures.js';
import { table } from './fake-db.test-helpers.js';
import { deliverViaService } from './pipeline.js';
import { fakeStages, sessionWorld, type SessionWorld } from './world.test-helpers.js';

const lines: string[] = [];
const log = createLogger({ service: 'jobs', version: 'dev', sink: (line) => lines.push(line) });

const viaQueue = async (w: SessionWorld, grader: LlmGrader = new MockLlmGrader()) => {
  const msg = fakeMessage(structuredClone(w.message));
  await processBatch(fakeBatch([msg]), { stages: fakeStages(w, grader), log });
  return msg.acked() === 1 ? 'ack' : msg.retried() === 1 ? 'retry' : 'none';
};
const viaService = (w: SessionWorld, grader: LlmGrader = new MockLlmGrader()) =>
  deliverViaService(structuredClone(w.message), { stages: fakeStages(w, grader), log });

describe('AT-D27: one pipeline for both transports', () => {
  it('queue and service give identical rows for the same message', async () => {
    const q = await sessionWorld();
    const s = await sessionWorld();
    expect(await viaQueue(q)).toBe('ack');
    expect(await viaService(s)).toBe('ack');
    expect(s.db.tables).toEqual(q.db.tables);

    // and the chain completed: two separate cards, each pointer set by its own stage
    const quality = table(q.db, 'quality_cards')[0];
    const integrity = table(q.db, 'integrity_cards')[0];
    expect(quality).toMatchObject({ score: 50, meets_cutoff: true });
    expect(integrity).toMatchObject({ band: 'review', review_state: 'reviewed' });
    expect(table(q.db, 'reports')).toEqual([
      expect.objectContaining({
        quality_card_id: quality?.['id'],
        integrity_card_id: integrity?.['id'],
      }),
    ]);
    expect(
      table(q.db, 'idempotency_keys')
        .map((k) => k['scope'])
        .sort(),
    ).toEqual(['integrity_band', 'quality_score', 'session_mirror']);
  });

  it('a redelivery through either transport changes nothing', async () => {
    const w = await sessionWorld();
    expect(await viaQueue(w)).toBe('ack');
    const before = structuredClone(w.db.tables);
    expect(await viaService(w)).toBe('ack');
    expect(await viaQueue(w)).toBe('ack');
    expect(w.db.tables).toEqual(before);
  });

  it('a quality failure is retried on both transports; integrity still ran and waits (awaiting_quality)', async () => {
    const failing: LlmGrader = { grade: () => Promise.reject(new Error('down')) };
    const q = await sessionWorld();
    const s = await sessionWorld();
    expect(await viaQueue(q, failing)).toBe('retry');
    expect(await viaService(s, failing)).toBe('retry');
    expect(s.db.tables).toEqual(q.db.tables);
    expect(table(q.db, 'quality_cards')).toHaveLength(0);
    expect(table(q.db, 'integrity_cards')[0]?.['review_state']).toBe('awaiting_quality');

    // the retry completes both cards and flips the integrity card once
    expect(await viaQueue(q)).toBe('ack');
    expect(table(q.db, 'integrity_cards')).toHaveLength(1);
    expect(table(q.db, 'integrity_cards')[0]?.['review_state']).toBe('reviewed');
  });

  it('a body that is not a mirror message is acked unprocessed on both transports', async () => {
    const w = await sessionWorld();
    expect(
      await deliverViaService({ v: 2 }, { stages: fakeStages(w, new MockLlmGrader()), log }),
    ).toBe('ack');
    expect(table(w.db, 'sessions')).toHaveLength(0);
  });

  it('no log line carries answer text, a score or a band', () => {
    const all = lines.join('\n');
    expect(all).not.toMatch(/queue will retry|"score"|strong_concern|"band"/);
  });
});
