// Queue consumer (spec d1 §5.1): per message, mirror -> quality -> integrity, each stage injected.
// The ack/retry matrix, the invalid-message path and the log hygiene are pinned here. The stages
// themselves (stream R2) are tested in their own folders.
import { LogLine } from '@trace/shared/contracts';
import { createLogger, type ErrorReporter, type SerializedError } from '@trace/shared/log';
import { describe, expect, it } from 'vitest';
import {
  NOT_IMPLEMENTED,
  notImplementedStages,
  processBatch,
  type Stages,
  type StageName,
} from './consumer.js';
import { fakeBatch, fakeMessage, validMessage } from './test-fixtures.js';

const setup = (overrides: Partial<Record<StageName, () => Promise<void>>> = {}) => {
  const calls: string[] = [];
  const lines: string[] = [];
  const reports: SerializedError[] = [];
  const reporter: ErrorReporter = {
    capture(err) {
      reports.push(err);
    },
  };
  const stage = (name: StageName) => async (): Promise<void> => {
    calls.push(name);
    await overrides[name]?.();
  };
  const stages: Stages = {
    mirror: stage('mirror'),
    quality: stage('quality'),
    integrity: stage('integrity'),
  };
  const log = createLogger({ service: 'jobs', version: 'dev', sink: (line) => lines.push(line) });
  return { calls, lines, reports, deps: { stages, log, reporter, release: 'dev' } };
};

const fails = (what: string) => (): Promise<void> => Promise.reject(new Error(what));

describe('processBatch: ack and retry matrix (spec §5.1)', () => {
  it('runs mirror, quality, integrity in order and acks when all succeed', async () => {
    const { calls, deps } = setup();
    const message = fakeMessage(validMessage());

    await processBatch(fakeBatch([message]), deps);

    expect(calls).toEqual(['mirror', 'quality', 'integrity']);
    expect(message.acked()).toBe(1);
    expect(message.retried()).toBe(0);
  });

  it('passes the parsed message to every stage', async () => {
    const seen: unknown[] = [];
    const { deps } = setup();
    const stages: Stages = {
      mirror: (m) => Promise.resolve(void seen.push(m)),
      quality: (m) => Promise.resolve(void seen.push(m)),
      integrity: (m) => Promise.resolve(void seen.push(m)),
    };

    await processBatch(fakeBatch([fakeMessage(validMessage())]), { ...deps, stages });

    expect(seen).toEqual([validMessage(), validMessage(), validMessage()]);
  });

  it('skips quality and integrity and retries when the mirror stage fails', async () => {
    const { calls, deps } = setup({ mirror: fails('boom') });
    const message = fakeMessage(validMessage());

    await processBatch(fakeBatch([message]), deps);

    expect(calls).toEqual(['mirror']);
    expect(message.retried()).toBe(1);
    expect(message.acked()).toBe(0);
  });

  it('still runs integrity when quality fails, then retries', async () => {
    const { calls, deps } = setup({ quality: fails('boom') });
    const message = fakeMessage(validMessage());

    await processBatch(fakeBatch([message]), deps);

    expect(calls).toEqual(['mirror', 'quality', 'integrity']);
    expect(message.retried()).toBe(1);
    expect(message.acked()).toBe(0);
  });

  it('retries when only integrity fails', async () => {
    const { calls, deps } = setup({ integrity: fails('boom') });
    const message = fakeMessage(validMessage());

    await processBatch(fakeBatch([message]), deps);

    expect(calls).toEqual(['mirror', 'quality', 'integrity']);
    expect(message.retried()).toBe(1);
    expect(message.acked()).toBe(0);
  });

  it('retries exactly once when both quality and integrity fail', async () => {
    const { calls, deps } = setup({ quality: fails('a'), integrity: fails('b') });
    const message = fakeMessage(validMessage());

    await processBatch(fakeBatch([message]), deps);

    expect(calls).toEqual(['mirror', 'quality', 'integrity']);
    expect(message.retried()).toBe(1);
    expect(message.acked()).toBe(0);
  });

  it('treats a stage that throws synchronously like a rejection', async () => {
    const { deps } = setup();
    const stages: Stages = {
      ...deps.stages,
      quality: () => {
        throw new Error('sync');
      },
    };
    const message = fakeMessage(validMessage());

    await processBatch(fakeBatch([message]), { ...deps, stages });

    expect(message.retried()).toBe(1);
  });

  it('handles each message of a batch on its own', async () => {
    const calls: string[] = [];
    const { deps } = setup();
    const stages: Stages = {
      mirror: (m) => {
        calls.push(`mirror:${m.receiptRef}`);
        return m.receiptRef === 'BADBADBA' ? Promise.reject(new Error('x')) : Promise.resolve();
      },
      quality: (m) => Promise.resolve(void calls.push(`quality:${m.receiptRef}`)),
      integrity: (m) => Promise.resolve(void calls.push(`integrity:${m.receiptRef}`)),
    };
    const bad = fakeMessage(validMessage({ receiptRef: 'BADBADBA' }), 'a');
    const good = fakeMessage(validMessage({ receiptRef: 'G00DG00D' }), 'b');

    await processBatch(fakeBatch([bad, good]), { ...deps, stages });

    expect(calls).toEqual([
      'mirror:BADBADBA',
      'mirror:G00DG00D',
      'quality:G00DG00D',
      'integrity:G00DG00D',
    ]);
    expect(bad.retried()).toBe(1);
    expect(good.acked()).toBe(1);
  });

  it('does nothing for an empty batch', async () => {
    const { calls, deps } = setup();

    await processBatch(fakeBatch([]), deps);

    expect(calls).toEqual([]);
  });
});

describe('processBatch: invalid messages', () => {
  // Built at run time so no PII-shaped literal sits in the repo.
  const email = (): string => ['pat', 'example.test'].join('@');
  const mobile = (): string => ['98765', '43210'].join('');

  it.each([
    ['null', null],
    ['a string', 'not a message'],
    ['an empty object', {}],
    ['a wrong kind', { ...validMessage(), jobKind: 'other' }],
    ['an unknown field (strict)', { ...validMessage(), extra: 1 }],
    ['a bad session id', { ...validMessage(), sessionId: 'not-a-uuid' }],
  ])('acks %s without running a stage', async (_label, body) => {
    const { calls, lines, deps } = setup();
    const message = fakeMessage(body);

    await processBatch(fakeBatch([message]), deps);

    expect(calls).toEqual([]);
    expect(message.acked()).toBe(1);
    expect(message.retried()).toBe(0);
    expect(lines).toHaveLength(1);
    expect(LogLine.parse(JSON.parse(lines[0] ?? ''))).toMatchObject({
      level: 'warn',
      service: 'jobs',
      event: 'queue.message_invalid',
    });
  });

  it('logs no payload field, value or id for an invalid message', async () => {
    const { lines, deps } = setup();
    const body = {
      ...validMessage(),
      jobKind: 'other',
      contact: email(),
      phone: mobile(),
      note: `failed for ${email()}`,
    };

    await processBatch(fakeBatch([fakeMessage(body)]), deps);

    const out = lines.join('\n');
    for (const value of [email(), mobile(), 'contact', 'phone', 'note', validMessage().sessionId]) {
      expect(out).not.toContain(value);
    }
    expect(JSON.parse(lines[0] ?? '')).not.toHaveProperty('data');
  });

  it('keeps going after an invalid message in the same batch', async () => {
    const { calls, deps } = setup();
    const bad = fakeMessage({ nope: true }, 'a');
    const good = fakeMessage(validMessage(), 'b');

    await processBatch(fakeBatch([bad, good]), deps);

    expect(bad.acked()).toBe(1);
    expect(good.acked()).toBe(1);
    expect(calls).toEqual(['mirror', 'quality', 'integrity']);
  });
});

describe('processBatch: logging and reporting', () => {
  it('logs and reports a failing stage by name and ids, never by message or payload', async () => {
    const msg = validMessage();
    const { lines, reports, deps } = setup({
      quality: () =>
        Promise.reject(new Error(`failed for ${msg.receiptRef} ${msg.photoSkippedReason}`)),
    });

    await processBatch(fakeBatch([fakeMessage(msg)]), deps);

    expect(lines).toHaveLength(1);
    const line = LogLine.parse(JSON.parse(lines[0] ?? ''));
    expect(line).toMatchObject({
      level: 'error',
      service: 'jobs',
      event: 'queue.stage_failed',
      data: { stage: 'quality', sessionId: msg.sessionId },
    });
    expect(reports).toHaveLength(1);
    const everything = [...lines, JSON.stringify(reports)].join(' | ');
    for (const sensitive of [msg.receiptRef, 'failed for', msg.invitationId, msg.consentId]) {
      expect(everything).not.toContain(sensitive);
    }
  });

  it('logs nothing and reports nothing when every stage succeeds', async () => {
    const { lines, reports, deps } = setup();

    await processBatch(fakeBatch([fakeMessage(validMessage())]), deps);

    expect(lines).toEqual([]);
    expect(reports).toEqual([]);
  });

  it('still retries when the reporter itself throws', async () => {
    const { deps } = setup({ mirror: fails('boom') });
    const reporter: ErrorReporter = {
      capture() {
        throw new Error('reporter down');
      },
    };
    const message = fakeMessage(validMessage());

    await processBatch(fakeBatch([message]), { ...deps, reporter });

    expect(message.retried()).toBe(1);
  });
});

describe('notImplementedStages (a deploy before stream R2)', () => {
  it.each(['mirror', 'quality', 'integrity'] as const)(
    '%s rejects with a constant error',
    async (name) => {
      await expect(notImplementedStages[name](validMessage())).rejects.toThrow(NOT_IMPLEMENTED);
    },
  );

  it('sends the message to retry (and so the DLQ), never to ack', async () => {
    const { deps } = setup();
    const message = fakeMessage(validMessage());

    await processBatch(fakeBatch([message]), { ...deps, stages: notImplementedStages });

    expect(message.retried()).toBe(1);
    expect(message.acked()).toBe(0);
  });
});
