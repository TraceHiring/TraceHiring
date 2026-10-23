// A package-v2 session through the one pipeline (spec m1 R5-8, R5-19, AT-M1-21): the consumer parses v2, runs
// mirror -> quality -> integrity over the fakes and acks; a re-delivery changes nothing; a broken v2 invariant is
// retried (then the DLQ) without running a stage.
import { createLogger } from '@trace/shared/log';
import { MockLlmGrader } from '@trace/vendors';
import { describe, expect, it } from 'vitest';
import { processBatch } from '../queue/consumer.js';
import { fakeBatch, fakeMessage } from '../queue/test-fixtures.js';
import { table } from './fake-db.test-helpers.js';
import { V2, fakeStagesV2, sessionWorldV2, type SessionWorldV2 } from './world-v2.test-helpers.js';

const lines: string[] = [];
const log = createLogger({ service: 'jobs', version: 'dev', sink: (line) => lines.push(line) });

const deliver = async (w: SessionWorldV2, body: unknown = structuredClone(w.message)) => {
  const msg = fakeMessage(body);
  await processBatch(fakeBatch([msg]), { stages: fakeStagesV2(w, new MockLlmGrader()), log });
  return msg.acked() === 1 ? 'ack' : msg.retried() === 1 ? 'retry' : 'none';
};

describe('package v2 through the pipeline (AT-M1-21)', () => {
  it('mirror, quality and integrity all run and the message is acked', async () => {
    const w = await sessionWorldV2();
    expect(await deliver(w)).toBe('ack');
    // sA (100 + 0) / 2 = 50.00 at 40; sP (100 + 100 + 0 for the drawn, unserved b3) / 3 = 66.67 at 30; sW never
    // entered: its one slot scores 0 at 30. (40 * 5000 + 30 * 6667 + 0) / 10000 = 40.001 -> 40.
    expect(table(w.db, 'quality_cards')[0]).toMatchObject({ score: 40, meets_cutoff: true });
    expect(table(w.db, 'integrity_cards')[0]).toMatchObject({
      band: 'review',
      review_state: 'reviewed',
    });
    expect(
      table(w.db, 'idempotency_keys')
        .map((k) => k['scope'])
        .sort(),
    ).toEqual(['integrity_band', 'quality_score', 'session_mirror']);
  });

  it('an entered written pool section is graded from its drawn item', async () => {
    const w = await sessionWorldV2({ writtenEntered: true });
    expect(await deliver(w)).toBe('ack');
    // sW now scores 100: (40 * 5000 + 30 * 6667 + 30 * 10000) / 10000 = 70.001 -> 70.
    expect(table(w.db, 'quality_cards')[0]).toMatchObject({ score: 70 });
    expect(table(w.db, 'grader_runs')).toHaveLength(1);
  });

  it('a re-delivery changes nothing', async () => {
    const w = await sessionWorldV2();
    expect(await deliver(w)).toBe('ack');
    const before = structuredClone(w.db.tables);
    expect(await deliver(w)).toBe('ack');
    expect(await deliver(w, JSON.parse(JSON.stringify(w.message)) as unknown)).toBe('ack');
    expect(w.db.tables).toEqual(before);
  });

  it('a v2 message that breaks an invariant is retried with nothing stored', async () => {
    const w = await sessionWorldV2({
      patch: (m) => ({ ...m, poolSectionIds: [V2.sW] }),
    });
    expect(await deliver(w)).toBe('retry');
    expect(table(w.db, 'sessions')).toHaveLength(0);
  });

  it('no log line carries answer text, a score, a band or an id of the broken message', () => {
    const all = lines.join('\n');
    expect(all).not.toMatch(/queue will retry|"score"|strong_concern|"band"/);
    expect(all).not.toContain(V2.session);
  });
});
