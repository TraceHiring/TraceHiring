// The queue() and scheduled() entrypoints (spec d1 §5.1, §7.1) with injected parts: batches reach the
// consumer, the cron reaches the sweep through ctx.waitUntil, and a missing binding fails closed.
import type { ErrorReporter, SerializedError } from '@trace/shared/log';
import { describe, expect, it } from 'vitest';
import { notImplementedStages, type Stages } from './consumer.js';
import { BINDING_UNAVAILABLE, createQueueHandlers } from './handlers.js';
import {
  fakeBatch,
  fakeMessage,
  mirrorKey,
  ORG_ID,
  SESSION_ID,
  validMessage,
} from './test-fixtures.js';
import type { PendingStage } from './sweep.js';

const okStages: Stages = {
  mirror: () => Promise.resolve(),
  quality: () => Promise.resolve(),
  integrity: () => Promise.resolve(),
};

const pendingRow: PendingStage = {
  orgId: ORG_ID,
  sessionId: SESSION_ID,
  rulesetVersionId: validMessage().rulesetVersionId,
  stage: 'session_mirror',
};

const setup = (stages: Stages = okStages, rows: readonly PendingStage[] = []) => {
  const reports: SerializedError[] = [];
  const lines: string[] = [];
  const limits: number[] = [];
  const reporter: ErrorReporter = {
    capture(err) {
      reports.push(err);
    },
  };
  const handlers = createQueueHandlers({
    reporter,
    stages,
    pendingStages: (limit) => {
      limits.push(limit);
      return Promise.resolve(rows);
    },
    sink: (line) => lines.push(line),
  });
  return { handlers, reports, lines, limits };
};

const execution = () => {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      pending.push(p);
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  return { ctx, pending };
};

const controller = { cron: '* * * * *', scheduledTime: 0, noRetry() {} } as ScheduledController;

const bindings = (files: Record<string, string> = {}) => {
  const sent: { body: unknown; options: unknown }[] = [];
  const queue = {
    send(body: unknown, options: unknown) {
      sent.push({ body, options });
      return Promise.resolve({});
    },
  };
  const evidence = {
    get: (key: string) =>
      Promise.resolve(key in files ? { text: () => Promise.resolve(files[key] ?? '') } : null),
  };
  return { sent, queue, evidence };
};

const envWith = (extra: Record<string, unknown>): Env =>
  ({ VERSION: 'abcdef1', SENTRY_DSN_WORKERS: '', ...extra }) as unknown as Env;

describe('queue()', () => {
  it('runs the stages for each message and acks them', async () => {
    const { handlers, reports } = setup();
    const message = fakeMessage(validMessage());
    const { ctx } = execution();

    await handlers.queue(fakeBatch([message]), envWith({}), ctx);

    expect(message.acked()).toBe(1);
    expect(reports).toEqual([]);
  });

  it('retries and reports a failing stage, labelling the log with the build version', async () => {
    const stages: Stages = { ...okStages, mirror: () => Promise.reject(new Error('boom')) };
    const { handlers, reports, lines } = setup(stages);
    const message = fakeMessage(validMessage());
    const { ctx } = execution();

    await handlers.queue(fakeBatch([message]), envWith({}), ctx);

    expect(message.retried()).toBe(1);
    expect(reports).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ version: 'abcdef1', service: 'jobs' });
  });

  it('with the placeholder stages every message goes to retry, none is acked', async () => {
    const { handlers } = setup(notImplementedStages);
    const messages = [fakeMessage(validMessage(), 'a'), fakeMessage(validMessage(), 'b')];
    const { ctx } = execution();

    await handlers.queue(fakeBatch(messages), envWith({}), ctx);

    expect(messages.map((m) => [m.acked(), m.retried()])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it('needs no binding: an env without MIRROR_QUEUE and EVIDENCE still works', async () => {
    const { handlers } = setup();
    const { ctx } = execution();

    await expect(
      handlers.queue(fakeBatch([fakeMessage(validMessage())]), envWith({}), ctx),
    ).resolves.toBeUndefined();
  });
});

describe('scheduled()', () => {
  it('sweeps through ctx.waitUntil: reads mirror.json from EVIDENCE and sends it on MIRROR_QUEUE', async () => {
    const message = validMessage();
    const { queue, evidence, sent } = bindings({
      [mirrorKey(ORG_ID, SESSION_ID)]: JSON.stringify(message),
    });
    const { handlers, limits } = setup(okStages, [pendingRow]);
    const { ctx, pending } = execution();

    await handlers.scheduled(controller, envWith({ MIRROR_QUEUE: queue, EVIDENCE: evidence }), ctx);

    expect(pending).toHaveLength(1);
    expect(limits).toHaveLength(1);
    expect(sent).toEqual([{ body: message, options: { contentType: 'json' } }]);
  });

  it.each([
    ['MIRROR_QUEUE', (b: ReturnType<typeof bindings>) => ({ EVIDENCE: b.evidence })],
    ['EVIDENCE', (b: ReturnType<typeof bindings>) => ({ MIRROR_QUEUE: b.queue })],
    ['both bindings', () => ({})],
  ])('fails closed with a constant error when %s is missing', async (_label, pick) => {
    const b = bindings();
    const { handlers, limits } = setup(okStages, [pendingRow]);
    const { ctx } = execution();

    await expect(handlers.scheduled(controller, envWith(pick(b)), ctx)).rejects.toThrow(
      BINDING_UNAVAILABLE,
    );

    expect(limits).toEqual([]);
    expect(b.sent).toEqual([]);
  });

  it('rejects when the sweep fails, so the error wrapper can report it', async () => {
    const b = bindings(); // no mirror.json for the row: skipped, not failed
    const failing = createQueueHandlers({
      reporter: { capture() {} },
      stages: okStages,
      pendingStages: () => Promise.reject(new Error('db down')),
    });
    const { ctx, pending } = execution();

    await expect(
      failing.scheduled(controller, envWith({ MIRROR_QUEUE: b.queue, EVIDENCE: b.evidence }), ctx),
    ).rejects.toThrow('db down');

    // The promise handed to waitUntil never rejects: the handler's own rejection carries the error.
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });
});

describe('scheduled(): the stranded drafting-job sweep (R5-64 m)', () => {
  const withDraftSweep = (draftSweep: (env: Env) => Promise<number>) =>
    createQueueHandlers({
      reporter: { capture() {} },
      stages: okStages,
      pendingStages: () => Promise.resolve([]),
      draftSweep,
    });

  it('runs on every cron tick with the env of the call, beside the mirror sweep', async () => {
    const b = bindings();
    const seen: Env[] = [];
    const handlers = withDraftSweep((env) => {
      seen.push(env);
      return Promise.resolve(0);
    });
    const env = envWith({ MIRROR_QUEUE: b.queue, EVIDENCE: b.evidence });
    const { ctx, pending } = execution();

    await handlers.scheduled(controller, env, ctx);

    expect(seen).toEqual([env]);
    expect(pending).toHaveLength(1);
  });

  it('still runs when the mirror bindings are missing; the tick then rejects with the constant error', async () => {
    let ran = 0;
    const handlers = withDraftSweep(() => {
      ran += 1;
      return Promise.resolve(0);
    });
    const { ctx } = execution();

    await expect(handlers.scheduled(controller, envWith({}), ctx)).rejects.toThrow(
      BINDING_UNAVAILABLE,
    );
    expect(ran).toBe(1);
  });

  it('a failed drafting sweep rejects the tick after the mirror sweep has run', async () => {
    const message = validMessage();
    const b = bindings({ [mirrorKey(ORG_ID, SESSION_ID)]: JSON.stringify(message) });
    const handlers = createQueueHandlers({
      reporter: { capture() {} },
      stages: okStages,
      pendingStages: () => Promise.resolve([pendingRow]),
      draftSweep: () => Promise.reject(new Error('db down')),
    });
    const { ctx, pending } = execution();

    await expect(
      handlers.scheduled(controller, envWith({ MIRROR_QUEUE: b.queue, EVIDENCE: b.evidence }), ctx),
    ).rejects.toThrow('db down');
    expect(b.sent).toHaveLength(1);
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });
});

// M2 R5-9: the messaging claim reuses the every-minute trigger as an optional dependency next to draftSweep.
describe('scheduled(): the messaging claim (M2 R5-9)', () => {
  it('runs on every tick with the env of the call, beside both sweeps', async () => {
    const b = bindings();
    const order: string[] = [];
    const seen: Env[] = [];
    const handlers = createQueueHandlers({
      reporter: { capture() {} },
      stages: okStages,
      pendingStages: () => Promise.resolve([]),
      draftSweep: () => {
        order.push('draft');
        return Promise.resolve(0);
      },
      messagesClaim: (env) => {
        order.push('messages');
        seen.push(env);
        return Promise.resolve(0);
      },
    });
    const env = envWith({ MIRROR_QUEUE: b.queue, EVIDENCE: b.evidence });
    const { ctx, pending } = execution();

    await handlers.scheduled(controller, env, ctx);

    expect(seen).toEqual([env]);
    expect(order.sort()).toEqual(['draft', 'messages']);
    expect(pending).toHaveLength(1);
  });

  it('a failed claim rejects the tick after the other sweeps have run', async () => {
    const message = validMessage();
    const b = bindings({ [mirrorKey(ORG_ID, SESSION_ID)]: JSON.stringify(message) });
    let drafted = 0;
    const handlers = createQueueHandlers({
      reporter: { capture() {} },
      stages: okStages,
      pendingStages: () => Promise.resolve([pendingRow]),
      draftSweep: () => {
        drafted += 1;
        return Promise.resolve(0);
      },
      messagesClaim: () => Promise.reject(new Error('claim down')),
    });
    const { ctx, pending } = execution();

    await expect(
      handlers.scheduled(controller, envWith({ MIRROR_QUEUE: b.queue, EVIDENCE: b.evidence }), ctx),
    ).rejects.toThrow('claim down');
    expect(b.sent).toHaveLength(1);
    expect(drafted).toBe(1);
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });

  it('absent, the tick runs only the sweeps (the claim stage arrives with stream B3)', async () => {
    const b = bindings();
    const handlers = createQueueHandlers({
      reporter: { capture() {} },
      stages: okStages,
      pendingStages: () => Promise.resolve([]),
    });
    const { ctx } = execution();
    await expect(
      handlers.scheduled(controller, envWith({ MIRROR_QUEUE: b.queue, EVIDENCE: b.evidence }), ctx),
    ).resolves.toBeUndefined();
  });
});

describe('stages and the sweep database part built per invocation env (lead wiring, spec §11)', () => {
  it('a stages factory receives the env of the queue() call', async () => {
    const seen: Env[] = [];
    const handlers = createQueueHandlers({
      reporter: { capture() {} },
      stages: (env) => {
        seen.push(env);
        return okStages;
      },
      pendingStages: () => Promise.resolve([]),
    });
    const env = envWith({ JOBS_MIRROR_DB_URL: 'synthetic' });
    const message = fakeMessage(validMessage());
    const { ctx } = execution();

    await handlers.queue(fakeBatch([message]), env, ctx);

    expect(seen).toEqual([env]);
    expect(message.acked()).toBe(1);
  });

  it('pendingStages receives the env of the scheduled() call', async () => {
    const b = bindings();
    const seen: Env[] = [];
    const handlers = createQueueHandlers({
      reporter: { capture() {} },
      stages: okStages,
      pendingStages: (_limit, env) => {
        seen.push(env);
        return Promise.resolve([]);
      },
    });
    const env = envWith({ MIRROR_QUEUE: b.queue, EVIDENCE: b.evidence });
    const { ctx } = execution();

    await handlers.scheduled(controller, env, ctx);

    expect(seen).toEqual([env]);
  });
});
