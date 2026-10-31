// The stranded drafting-job sweep (specs/m1-test-authoring.md R5-64 m, migration M1-n): one constant call of
// private.fail_stranded_ai_draft_jobs on the authoring sweep stage, no org, its count logged. Synthetic values only.
import type { SqlTx } from '@trace/shared/jobs';
import { createLogger } from '@trace/shared/log';
import { describe, expect, it } from 'vitest';
import type { OpenStage } from './wiring.js';
import { DRAFT_SWEEP_LIMIT, FAIL_STRANDED_SQL, draftSweepFor, runDraftSweep } from './sweep.js';

const txReturning = (rows: object[], seen: { text: string; params: unknown }[]): SqlTx => ({
  query: <R extends object>(
    text: string,
    params: readonly (string | number | boolean | null)[] = [],
  ) => {
    seen.push({ text, params });
    return Promise.resolve(rows as R[]);
  },
});

const logger = (lines: string[]) =>
  createLogger({ service: 'jobs', version: 'abcdef1', sink: (l) => lines.push(l) });

describe('runDraftSweep', () => {
  it('calls the sweep function once with the limit and returns its count', async () => {
    const seen: { text: string; params: unknown }[] = [];
    const lines: string[] = [];
    const failed = await runDraftSweep({
      run: (fn) => fn(txReturning([{ failed: 2 }], seen)),
      log: logger(lines),
    });
    expect(failed).toBe(2);
    expect(seen).toEqual([{ text: FAIL_STRANDED_SQL, params: [DRAFT_SWEEP_LIMIT] }]);
    expect(FAIL_STRANDED_SQL).toBe('select private.fail_stranded_ai_draft_jobs($1::int) as failed');
    expect(DRAFT_SWEEP_LIMIT).toBe(100);
    expect(lines.map((l) => JSON.parse(l) as { event: string; data?: unknown })).toEqual([
      expect.objectContaining({ event: 'drafting.sweep_failed_stranded', data: { failed: 2 } }),
    ]);
  });

  it('logs nothing when no job was stranded', async () => {
    const lines: string[] = [];
    const failed = await runDraftSweep({
      run: (fn) => fn(txReturning([{ failed: 0 }], [])),
      log: logger(lines),
    });
    expect(failed).toBe(0);
    expect(lines).toEqual([]);
  });

  it.each([[[]], [[{ failed: -1 }]], [[{ failed: 'x' }]], [[{ failed: 1.5 }]]])(
    'refuses a malformed result %j with a constant error',
    async (rows) => {
      await expect(
        runDraftSweep({ run: (fn) => fn(txReturning(rows, [])), log: logger([]) }),
      ).rejects.toThrow('draft_sweep_bad_result');
    },
  );

  it('passes a database failure through, so the cron reports it', async () => {
    await expect(
      runDraftSweep({ run: () => Promise.reject(new Error('db down')), log: logger([]) }),
    ).rejects.toThrow('db down');
  });
});

describe('draftSweepFor (lead wiring)', () => {
  it('runs on the authoring_sweep stage with no org, with the env of the call', async () => {
    const calls: { env: Env; stage: string; orgId: string | null }[] = [];
    const open: OpenStage = (env, stage, orgId, fn) => {
      calls.push({ env, stage, orgId });
      return fn(txReturning([{ failed: 1 }], []));
    };
    const env = { VERSION: 'abcdef1' } as unknown as Env;
    await expect(draftSweepFor(env, open, { sink: () => {} })).resolves.toBe(1);
    expect(calls).toEqual([{ env, stage: 'authoring_sweep', orgId: null }]);
  });
});
