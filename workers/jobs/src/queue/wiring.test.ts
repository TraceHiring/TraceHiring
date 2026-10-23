// The real stages and the sweep's database part, built from the invocation env (spec d1 §5.1, §11; lead wiring).
// Each stage opens its own connection as its own worker role with the message's org as the job org; the sweep runs
// as trace_worker with no org; a missing evidence binding fails closed; the mock grader is refused in production.
import type { SqlTx } from '@trace/shared/jobs';
import { describe, expect, it } from 'vitest';
import { DRAFTING_NOT_IMPLEMENTED, draftingConsumer } from '../drafting/stub.js';
import { MEMBERS_NOT_IMPLEMENTED, membersConsumer } from '../members/stub.js';
import { BINDING_UNAVAILABLE } from './handlers.js';
import { ORG_ID, fakeBatch, fakeMessage, validMessage } from './test-fixtures.js';
import type { StageDbName } from './stage-db.js';
import {
  GRADER_UNAVAILABLE,
  QUEUE_KINDS,
  UNKNOWN_QUEUE,
  dispatchQueue,
  graderFor,
  pendingStagesFor,
  queueKindOf,
  stagesFor,
  unavailableEvidence,
  type OpenStage,
  type QueueConsumer,
  type QueueKind,
} from './wiring.js';

const recorder = () => {
  const opened: { stage: StageDbName; orgId: string | null }[] = [];
  const open: OpenStage = (_env, stage, orgId) => {
    opened.push({ stage, orgId });
    return Promise.reject(new Error('stop_before_sql'));
  };
  return { opened, open };
};

const env = (extra: Record<string, unknown> = {}): Env =>
  ({ VERSION: 'dev', SENTRY_DSN_WORKERS: '', TRACE_ENV: 'dev', ...extra }) as unknown as Env;

describe('stagesFor', () => {
  it('opens each stage as its own worker role with the message org as the job org', async () => {
    const { opened, open } = recorder();
    const stages = stagesFor(env(), open);
    const message = validMessage();
    for (const name of ['mirror', 'quality', 'integrity'] as const) {
      await expect(stages[name](message)).rejects.toThrow('stop_before_sql');
    }
    expect(opened).toEqual([
      { stage: 'mirror', orgId: ORG_ID },
      { stage: 'quality', orgId: ORG_ID },
      { stage: 'integrity', orgId: ORG_ID },
    ]);
  });
});

describe('pendingStagesFor', () => {
  it('runs the sweep as the sweep stage (trace_worker) with no job org', async () => {
    const { opened, open } = recorder();
    await expect(pendingStagesFor(10, env(), open)).rejects.toThrow('stop_before_sql');
    expect(opened).toEqual([{ stage: 'sweep', orgId: null }]);
  });

  it('passes the limit to sweep_pending as a bound parameter', async () => {
    const seen: unknown[][] = [];
    const tx: SqlTx = {
      query: (_text, params = []) => {
        seen.push([...params]);
        return Promise.resolve([]);
      },
    };
    const open: OpenStage = (_e, _s, _o, fn) => fn(tx);
    await expect(pendingStagesFor(7, env(), open)).resolves.toEqual([]);
    expect(seen).toEqual([[7]]);
  });
});

describe('evidence and grader fail closed', () => {
  it('without the EVIDENCE binding every read is binding_unavailable', async () => {
    await expect(unavailableEvidence.get('k')).rejects.toThrow(BINDING_UNAVAILABLE);
    await expect(unavailableEvidence.head('k')).rejects.toThrow(BINDING_UNAVAILABLE);
  });

  it('the mock grader is refused when TRACE_ENV is production (as the mock Messaging, L-11)', async () => {
    const grader = graderFor(env({ TRACE_ENV: 'production' }));
    await expect(
      grader.grade({
        rubric: { rubricVersionId: 'r', criteria: [] },
        item: { id: 'i', promptText: 'p' },
        answer: 'a',
      }),
    ).rejects.toThrow(GRADER_UNAVAILABLE);
  });

  it('dev and staging use the deterministic mock grader', () => {
    for (const name of ['dev', 'staging']) {
      expect(graderFor(env({ TRACE_ENV: name })).constructor.name).toBe('MockLlmGrader');
    }
  });
});

// M1 R5-13: one Worker consumes three queues, so queue() dispatches on batch.queue (`<name>-<env>`). The D1 mirror
// path is unchanged; the drafting and member provisioning consumers are stubs until stream A3, and they throw, so
// every message is retried and then dead-lettered (never acked); an unknown queue is an error, never an ack.
describe('dispatchQueue', () => {
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const batchOn = (queue: string) => {
    const messages = [fakeMessage(validMessage(), 'a'), fakeMessage(validMessage(), 'b')];
    const counts = { ackAll: 0, retryAll: 0 };
    const batch: MessageBatch<unknown> = {
      ...fakeBatch(messages),
      queue,
      ackAll() {
        counts.ackAll++;
      },
      retryAll() {
        counts.retryAll++;
      },
    };
    return { batch, messages, counts };
  };
  const recorded = () => {
    const seen: [QueueKind, string][] = [];
    const consumer =
      (kind: QueueKind): QueueConsumer =>
      (batch) => {
        seen.push([kind, batch.queue]);
        return Promise.resolve();
      };
    return {
      seen,
      dispatch: dispatchQueue({
        mirror: consumer('mirror'),
        drafting: consumer('drafting'),
        members: consumer('members'),
      }),
    };
  };

  it('names exactly the three queues of R5-13, each with its own consumer', () => {
    expect(QUEUE_KINDS).toEqual({
      'trace-session-mirror': 'mirror',
      'trace-authoring': 'drafting',
      'trace-admin': 'members',
    });
    expect(Object.isFrozen(QUEUE_KINDS)).toBe(true);
  });

  it.each([
    ['trace-session-mirror-dev', 'mirror'],
    ['trace-session-mirror-staging', 'mirror'],
    ['trace-session-mirror-test', 'mirror'],
    ['trace-authoring-dev', 'drafting'],
    ['trace-authoring-staging', 'drafting'],
    ['trace-admin-dev', 'members'],
    ['trace-admin-staging', 'members'],
  ] as const)('hands a batch of %s to the %s consumer only', async (queue, kind) => {
    expect(queueKindOf(queue)).toBe(kind);
    const r = recorded();
    await r.dispatch(batchOn(queue).batch, env(), ctx);
    expect(r.seen).toEqual([[kind, queue]]);
  });

  it.each([
    'trace-session-mirror',
    'trace-session-mirror-dlq-staging',
    'trace-authoring-dlq-staging',
    'trace-admin-dlq-dev',
    'trace-authoring',
    'trace-admin-staging-old',
    'TRACE-ADMIN-STAGING',
    'trace-quality-staging',
    'trace-evidence-staging',
    'constructor-staging',
    '',
  ])('refuses the unknown queue %j with a constant error and calls no consumer', async (queue) => {
    expect(queueKindOf(queue)).toBeNull();
    const r = recorded();
    const { batch, messages, counts } = batchOn(queue);
    await expect(r.dispatch(batch, env(), ctx)).rejects.toThrow(UNKNOWN_QUEUE);
    expect(r.seen).toEqual([]);
    expect(messages.map((m) => [m.acked(), m.retried()])).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(counts).toEqual({ ackAll: 0, retryAll: 0 });
  });

  it('keeps the D1 mirror path: the mirror consumer gets the very batch, env and ctx', async () => {
    const got: unknown[] = [];
    const mirror: QueueConsumer = (b, e, c) => {
      got.push(b, e, c);
      return Promise.resolve();
    };
    const dispatch = dispatchQueue({
      mirror,
      drafting: draftingConsumer,
      members: membersConsumer,
    });
    const { batch } = batchOn('trace-session-mirror-staging');
    const e = env();
    await dispatch(batch, e, ctx);
    expect(got).toHaveLength(3);
    expect(got[0]).toBe(batch);
    expect(got[1]).toBe(e);
    expect(got[2]).toBe(ctx);
  });

  it.each([
    ['trace-authoring-staging', DRAFTING_NOT_IMPLEMENTED],
    ['trace-admin-staging', MEMBERS_NOT_IMPLEMENTED],
  ])(
    'the %s stub acks nothing and throws, so every message goes to retry and then the DLQ',
    async (queue, code) => {
      const dispatch = dispatchQueue({
        mirror: () => Promise.reject(new Error('mirror must not run')),
        drafting: draftingConsumer,
        members: membersConsumer,
      });
      const { batch, messages, counts } = batchOn(queue);
      await expect(dispatch(batch, env(), ctx)).rejects.toThrow(code);
      expect(code).toMatch(/_not_implemented_until_stream_a3$/);
      expect(messages.map((m) => [m.acked(), m.retried()])).toEqual([
        [0, 0],
        [0, 0],
      ]);
      expect(counts).toEqual({ ackAll: 0, retryAll: 0 });
    },
  );
});
