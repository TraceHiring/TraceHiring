// The real stages and the sweep's database part, built from the invocation env (spec d1 §5.1, §11; lead wiring).
// Each stage opens its own connection as its own worker role with the message's org as the job org; the sweep runs
// as trace_worker with no org; a missing evidence binding fails closed; the mock grader is refused in production.
import type { SqlTx } from '@trace/shared/jobs';
import { describe, expect, it } from 'vitest';
import { BINDING_UNAVAILABLE } from './handlers.js';
import { ORG_ID, validMessage } from './test-fixtures.js';
import type { StageDbName } from './stage-db.js';
import {
  GRADER_UNAVAILABLE,
  graderFor,
  pendingStagesFor,
  stagesFor,
  unavailableEvidence,
  type OpenStage,
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
