// The trace-authoring queue consumer (specs/m1-test-authoring.md R5-13, §6.4): a malformed message is acked and never
// logged; a settled job is acked; a database error retries; the last try ends the job `internal` so it never stays
// running; a report carries a constant error, never a message or SQL detail.
import type { SerializedError } from '@trace/shared/log';
import { MockLlmDrafter } from '@trace/vendors';
import { describe, expect, it } from 'vitest';
import { createDraftingConsumer, FINAL_ATTEMPT } from './consumer.js';
import { JOB, capturedLog, fakeDb, message, world } from './fakes.test-helpers.js';
import type { DraftingDeps } from './handler.js';

interface Settled {
  acks: number;
  retries: number;
}

const fakeMessage = (body: unknown, attempts = 1): Message<unknown> & Settled => {
  const m = {
    id: 'm-1',
    timestamp: new Date(0),
    body,
    attempts,
    acks: 0,
    retries: 0,
    ack() {
      m.acks += 1;
    },
    retry() {
      m.retries += 1;
    },
  };
  return m;
};

const batchOf = (messages: readonly Message<unknown>[]): MessageBatch<unknown> => ({
  queue: 'trace-authoring-dev',
  messages,
  metadata: { metrics: { backlogCount: 0, backlogBytes: 0, oldestMessageTimestamp: new Date(0) } },
  ackAll() {},
  retryAll() {},
});

const ENV = { VERSION: 'dev', TRACE_ENV: 'dev' } as unknown as Env;
const CTX = {} as ExecutionContext;

const setup = (w = world()) => {
  const db = fakeDb(w);
  const { log, lines } = capturedLog();
  const reports: SerializedError[] = [];
  const deps: DraftingDeps = {
    db,
    log,
    drafterFor: (spec) => new MockLlmDrafter('dev', { seed: spec.seed }),
  };
  const consumer = createDraftingConsumer(() => ({
    ...deps,
    reporter: { capture: (e) => reports.push(e) },
    release: 'dev',
  }));
  return { w, db, lines, reports, consumer };
};

describe('createDraftingConsumer', () => {
  it('acks a malformed message without running the job or logging its body', async () => {
    const { w, lines, consumer } = setup();
    const m = fakeMessage({ ...message(), topic: 'zebra', extra: true });
    await consumer(batchOf([m]), ENV, CTX);
    expect(m.acks).toBe(1);
    expect(m.retries).toBe(0);
    expect(w.jobs.get(JOB)!.status).toBe('queued');
    expect(lines.join('\n')).not.toContain('zebra');
    expect(lines.join('\n')).toContain('drafting.message_invalid');
  });

  it('acks a completed job and a re-delivery of it', async () => {
    const { w, consumer } = setup();
    const a = fakeMessage(message());
    const b = fakeMessage(message());
    await consumer(batchOf([a]), ENV, CTX);
    await consumer(batchOf([b]), ENV, CTX);
    expect([a.acks, b.acks]).toEqual([1, 1]);
    expect(w.versions).toHaveLength(3);
  });

  it('retries on a database error and reports a constant error with the SQLSTATE only', async () => {
    const { w, db, lines, reports, consumer } = setup();
    db.failOn('insertDraft');
    const m = fakeMessage(message());
    await consumer(batchOf([m]), ENV, CTX);
    expect(m.retries).toBe(1);
    expect(m.acks).toBe(0);
    expect(w.jobs.get(JOB)!.status).toBe('running');
    expect(reports).toHaveLength(1);
    expect(reports[0]!.code).toBe('drafting_job_error');
    expect(JSON.stringify(reports)).not.toContain('synthetic');
    expect(lines.join('\n')).toContain('"sqlstate":"08006"');
    expect(lines.join('\n')).not.toContain('connection reset');
  });

  it('on the last try ends the job internal and acks, so it never stays running', async () => {
    const { w, db, consumer } = setup();
    db.failOn('insertDraft', true);
    const m = fakeMessage(message(), FINAL_ATTEMPT);
    await consumer(batchOf([m]), ENV, CTX);
    expect(m.acks).toBe(1);
    expect(w.jobs.get(JOB)!).toMatchObject({ status: 'failed', error_code: 'internal' });
  });

  it('retries on the last try when the job cannot be ended either (the DLQ keeps it)', async () => {
    const { db, consumer } = setup();
    db.failOn('lockJob', true);
    const m = fakeMessage(message(), FINAL_ATTEMPT);
    await consumer(batchOf([m]), ENV, CTX);
    expect(m.retries).toBe(1);
    expect(m.acks).toBe(0);
  });

  it('settles each message of a batch on its own', async () => {
    const { consumer } = setup();
    const bad = fakeMessage({ v: 2 });
    const good = fakeMessage(message());
    await consumer(batchOf([bad, good]), ENV, CTX);
    expect([bad.acks, good.acks]).toEqual([1, 1]);
  });

  it('builds its dependencies from the invocation env', async () => {
    const seen: Env[] = [];
    const w = world();
    const { log } = capturedLog();
    const consumer = createDraftingConsumer((env) => {
      seen.push(env);
      return { db: fakeDb(w), log, drafterFor: (s) => new MockLlmDrafter('dev', { seed: s.seed }) };
    });
    await consumer(batchOf([fakeMessage(message())]), ENV, CTX);
    expect(seen).toEqual([ENV]);
  });
});
