// Queue consumer (spec d1 §5.1): per message, mirror -> quality -> integrity, each stage injected.
// The ack/retry matrix, the invalid-message path and the log hygiene are pinned here. The stages
// themselves (stream R2) are tested in their own folders.
import { LogLine } from '@trace/shared/contracts';
import { createLogger, type ErrorReporter, type SerializedError } from '@trace/shared/log';
import { describe, expect, it } from 'vitest';
import {
  NOT_IMPLEMENTED,
  SESSION_CONCURRENCY,
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

// e2e-staging run 39791480658 (AT-D17): one message takes ~25 s on staging, so four sessions handled one after
// another put the last one's cards past 90 s. Sessions now run side by side; one session's messages stay in order.
describe('processBatch: concurrency across sessions', () => {
  const sessionId = (n: number): string =>
    `3f2b8c1e-9a47-4d6b-8e15-7c0a2d94c${n.toString(16).padStart(3, '0')}`;
  /** A promise and its resolver, to hold a stage open. */
  const gate = () => {
    let open!: () => void;
    const shut = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { shut, open };
  };
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('runs a second session while the first is still in its mirror stage', async () => {
    const { deps } = setup();
    const held = gate();
    const started: string[] = [];
    const stages: Stages = {
      mirror: (m) => {
        started.push(m.sessionId);
        return m.sessionId === sessionId(1) ? held.shut : Promise.resolve();
      },
      quality: () => Promise.resolve(),
      integrity: () => Promise.resolve(),
    };
    const first = fakeMessage(validMessage({ sessionId: sessionId(1) }), 'a');
    const second = fakeMessage(validMessage({ sessionId: sessionId(2) }), 'b');

    const done = processBatch(fakeBatch([first, second]), { ...deps, stages });
    await tick();

    expect(started).toEqual([sessionId(1), sessionId(2)]);
    expect(second.acked()).toBe(1);
    expect(first.acked()).toBe(0);
    held.open();
    await done;
    expect(first.acked()).toBe(1);
  });

  it("keeps one session's messages in order: the second starts after the first has settled", async () => {
    const { deps } = setup();
    const held = gate();
    const calls: string[] = [];
    const stages: Stages = {
      mirror: (m) => {
        calls.push(`mirror:${m.receiptRef}`);
        return Promise.resolve();
      },
      quality: (m) => {
        calls.push(`quality:${m.receiptRef}`);
        return m.receiptRef === 'F1RST111' ? held.shut : Promise.resolve();
      },
      integrity: (m) => Promise.resolve(void calls.push(`integrity:${m.receiptRef}`)),
    };
    const first = fakeMessage(validMessage({ receiptRef: 'F1RST111' }), 'a');
    const again = fakeMessage(validMessage({ receiptRef: 'AGA1N222' }), 'b');

    const done = processBatch(fakeBatch([first, again]), { ...deps, stages });
    await tick();
    expect(calls).toEqual(['mirror:F1RST111', 'quality:F1RST111']);

    held.open();
    await done;
    expect(calls).toEqual([
      'mirror:F1RST111',
      'quality:F1RST111',
      'integrity:F1RST111',
      'mirror:AGA1N222',
      'quality:AGA1N222',
      'integrity:AGA1N222',
    ]);
    expect(first.acked()).toBe(1);
    expect(again.acked()).toBe(1);
  });

  it('runs at most three stages at once across every stage (DB sockets plus R2 reads stay within six)', async () => {
    const { deps } = setup();
    const held = gate();
    let inFlight = 0;
    let most = 0;
    const counted = async (): Promise<void> => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await held.shut;
      inFlight -= 1;
    };
    const stages: Stages = { mirror: counted, quality: counted, integrity: counted };
    const messages = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      fakeMessage(validMessage({ sessionId: sessionId(n) }), `m${n}`),
    );

    const done = processBatch(fakeBatch(messages), { ...deps, stages });
    await tick();
    expect(SESSION_CONCURRENCY).toBe(3);
    expect(inFlight).toBe(3);

    held.open();
    await done;
    expect(most).toBe(3);
    expect(messages.map((m) => m.acked())).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it("a failed first message of a session is retried and that session's next message still runs", async () => {
    const { deps } = setup();
    const stages: Stages = {
      mirror: (m) =>
        m.receiptRef === 'F1RST111' ? Promise.reject(new Error('x')) : Promise.resolve(),
      quality: () => Promise.resolve(),
      integrity: () => Promise.resolve(),
    };
    const first = fakeMessage(validMessage({ receiptRef: 'F1RST111' }), 'a');
    const again = fakeMessage(validMessage({ receiptRef: 'AGA1N222' }), 'b');

    await processBatch(fakeBatch([first, again]), { ...deps, stages });

    expect([first.retried(), first.acked()]).toEqual([1, 0]);
    expect([again.retried(), again.acked()]).toEqual([0, 1]);
  });

  it('a throw while settling one message retries it and never rejects the batch or stops other sessions', async () => {
    const { deps } = setup();
    let retries = 0;
    const throwing = {
      ...fakeMessage(validMessage({ sessionId: sessionId(1) }), 'a'),
      ack: () => {
        throw new Error('ack failed');
      },
      retry: () => {
        retries += 1;
      },
    } as unknown as Message<unknown>;
    const other = fakeMessage(validMessage({ sessionId: sessionId(2) }), 'b');

    await expect(processBatch(fakeBatch([throwing, other]), deps)).resolves.toBeUndefined();

    expect(retries).toBe(1);
    expect(other.acked()).toBe(1);
  });

  it("one session's failure never holds back or settles another session's message", async () => {
    const { deps } = setup();
    const stages: Stages = {
      mirror: (m) =>
        m.sessionId === sessionId(1) ? Promise.reject(new Error('x')) : Promise.resolve(),
      quality: () => Promise.resolve(),
      integrity: () => Promise.resolve(),
    };
    const bad = fakeMessage(validMessage({ sessionId: sessionId(1) }), 'a');
    const good = fakeMessage(validMessage({ sessionId: sessionId(2) }), 'b');

    await processBatch(fakeBatch([bad, good]), { ...deps, stages });

    expect([bad.retried(), bad.acked()]).toEqual([1, 0]);
    expect([good.retried(), good.acked()]).toEqual([0, 1]);
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
