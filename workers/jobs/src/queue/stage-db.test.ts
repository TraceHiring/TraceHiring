// One SQL session per stage (spec d1 §5.1 "Each stage is its own transaction on its own connection"; ADR-031;
// MT-14, L-29). The consumer opens the stage's own login URL, runs BEGIN, `SET LOCAL ROLE` to the stage's
// NOLOGIN worker role, binds `trace.job_org_id` (read by private.job_org_id()) and a server-generated
// `trace.request_id`, runs the stage, then COMMIT; a stage result counts only after the COMMIT.
import { describe, expect, it } from 'vitest';
import {
  STAGE_DB,
  STAGE_DB_UNAVAILABLE,
  createStageDb,
  withStageConnection,
  type BeginTx,
  type StageDbName,
} from './stage-db.js';

const ORG = '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b02a';
const REQ = '9b1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e';

interface Recorded {
  statements: { text: string; params: readonly unknown[] }[];
  committed: boolean;
  rolledBack: boolean;
}

const fakeBegin = (rec: Recorded, fail?: (text: string) => boolean): BeginTx => {
  return async (cb) => {
    try {
      const out = await cb(async (text, params) => {
        rec.statements.push({ text, params });
        if (fail?.(text) === true) throw new Error('db_error');
        return [{ ok: 1 }];
      });
      rec.committed = true;
      return out;
    } catch (err) {
      rec.rolledBack = true;
      throw err;
    }
  };
};

const fresh = (): Recorded => ({ statements: [], committed: false, rolledBack: false });

describe('STAGE_DB: one login secret and one worker role per stage (MT-14, L-29)', () => {
  it('maps each stage to its own login (binding and local secret) and NOLOGIN role; the sweep runs as trace_worker', () => {
    expect(STAGE_DB).toEqual({
      mirror: { binding: 'JOBS_MIRROR_DB', secret: 'JOBS_MIRROR_DB_URL', role: 'trace_worker' },
      quality: {
        binding: 'JOBS_QUALITY_DB',
        secret: 'JOBS_QUALITY_DB_URL',
        role: 'trace_quality_worker',
      },
      integrity: {
        binding: 'JOBS_INTEGRITY_DB',
        secret: 'JOBS_INTEGRITY_DB_URL',
        role: 'trace_integrity_worker',
      },
      sweep: { binding: 'JOBS_MIRROR_DB', secret: 'JOBS_MIRROR_DB_URL', role: 'trace_worker' },
      // M1 R5-11, R5-13: the AI drafting and member provisioning jobs, each with its own login and role.
      authoring: {
        binding: 'JOBS_AUTHORING_DB',
        secret: 'JOBS_AUTHORING_DB_URL',
        role: 'trace_authoring_worker',
      },
      admin: { binding: 'JOBS_ADMIN_DB', secret: 'JOBS_ADMIN_DB_URL', role: 'trace_admin_worker' },
      // R5-64 m: the stranded drafting-job sweep reads every org on the authoring login, as the authoring worker.
      authoring_sweep: {
        binding: 'JOBS_AUTHORING_DB',
        secret: 'JOBS_AUTHORING_DB_URL',
        role: 'trace_authoring_worker',
      },
    });
    const roles = new Set(
      (['mirror', 'quality', 'integrity', 'authoring', 'admin'] as const).map(
        (s) => STAGE_DB[s].role,
      ),
    );
    expect(roles.size).toBe(5);
  });
});

describe('createStageDb', () => {
  it.each(['mirror', 'quality', 'integrity', 'sweep'] as StageDbName[])(
    '%s: SET LOCAL ROLE, then the org and request settings, then the stage, in one transaction',
    async (stage) => {
      const rec = fresh();
      const db = createStageDb(stage, fakeBegin(rec), () => REQ);
      const out = await db.withOrg(ORG, async (tx) => {
        await tx.query('select 1 where $1::int = 1', [1]);
        return 'done';
      });
      expect(out).toBe('done');
      expect(rec.statements).toEqual([
        { text: `set local role ${STAGE_DB[stage].role}`, params: [] },
        {
          text: "select set_config('trace.job_org_id', $1, true), set_config('trace.request_id', $2, true)",
          params: [ORG, REQ],
        },
        { text: 'select 1 where $1::int = 1', params: [1] },
      ]);
      expect(rec.committed).toBe(true);
    },
  );

  it('the sweep may run without an org (sweep_pending reads every org)', async () => {
    const rec = fresh();
    const db = createStageDb('sweep', fakeBegin(rec), () => REQ);
    await db.withOrg(null, async () => undefined);
    expect(rec.statements[1]?.params).toEqual(['', REQ]);
  });

  it('the drafting sweep may run without an org (it fails stranded jobs of every org, R5-64 m)', async () => {
    const rec = fresh();
    const db = createStageDb('authoring_sweep', fakeBegin(rec), () => REQ);
    await db.withOrg(null, async () => undefined);
    expect(rec.statements).toEqual([
      { text: 'set local role trace_authoring_worker', params: [] },
      {
        text: "select set_config('trace.job_org_id', $1, true), set_config('trace.request_id', $2, true)",
        params: ['', REQ],
      },
    ]);
  });

  it('the authoring stage itself still refuses a missing org', async () => {
    const rec = fresh();
    const db = createStageDb('authoring', fakeBegin(rec), () => REQ);
    await expect(db.withOrg(null, async () => undefined)).rejects.toThrow('bad_org');
    expect(rec.statements).toEqual([]);
  });

  it('a stage other than the sweep refuses a missing org', async () => {
    const rec = fresh();
    const db = createStageDb('mirror', fakeBegin(rec), () => REQ);
    await expect(db.withOrg(null, async () => undefined)).rejects.toThrow('bad_org');
    expect(rec.statements).toEqual([]);
  });

  it('refuses an org that is not a lower-case uuid before any statement', async () => {
    const rec = fresh();
    const db = createStageDb('quality', fakeBegin(rec), () => REQ);
    await expect(db.withOrg("x'; drop table t; --", async () => undefined)).rejects.toThrow(
      'bad_org',
    );
    expect(rec.statements).toEqual([]);
  });

  it('a failing statement rolls the stage back and the error propagates', async () => {
    const rec = fresh();
    const db = createStageDb(
      'integrity',
      fakeBegin(rec, (t) => t.startsWith('insert')),
      () => REQ,
    );
    await expect(
      db.withOrg(ORG, (tx) => tx.query('insert into x values ($1)', ['a'])),
    ).rejects.toThrow('db_error');
    expect(rec.committed).toBe(false);
    expect(rec.rolledBack).toBe(true);
  });
});

// ADR-031 amendment 1 (d1 revision 4o): a Worker never opens TLS to Postgres itself. On staging each stage reaches its
// login through its own Hyperdrive binding; a URL secret is for the local stack only; one TCP connection per stage, so a
// connect failure fails the stage at once (a retry, then the DLQ) instead of a reconnect loop.
describe('withStageConnection: where each stage connects', () => {
  const url = (host: string, q = '', port = 5432): string =>
    `${['postgres', 'ql'].join('')}://${'u'}:${'p'.repeat(8)}@${host}:${port}/postgres${q}`;
  const hyperdrive = (connectionString: unknown) => ({ connectionString }) as unknown as Hyperdrive;
  const run = (env: Partial<Env>, stage: StageDbName = 'mirror') =>
    withStageConnection(env as Env, stage, stage === 'sweep' ? null : ORG, async () => 'ran');

  it('maps each stage to its own Hyperdrive binding (MT-14: one login per stage)', () => {
    expect(STAGE_DB.mirror.binding).toBe('JOBS_MIRROR_DB');
    expect(STAGE_DB.quality.binding).toBe('JOBS_QUALITY_DB');
    expect(STAGE_DB.integrity.binding).toBe('JOBS_INTEGRITY_DB');
    expect(STAGE_DB.sweep.binding).toBe('JOBS_MIRROR_DB');
  });

  it.each(['', '?sslmode=require', '?sslmode=verify-full'])(
    'a remote URL secret is refused before any connection (%s)',
    async (q) => {
      await expect(run({ JOBS_MIRROR_DB_URL: url('db.example.test', q) })).rejects.toThrow(
        STAGE_DB_UNAVAILABLE,
      );
    },
  );

  it('nothing bound, or a binding without a connection string, is unavailable', async () => {
    await expect(run({})).rejects.toThrow(STAGE_DB_UNAVAILABLE);
    await expect(run({ JOBS_QUALITY_DB: hyperdrive('') }, 'quality')).rejects.toThrow(
      STAGE_DB_UNAVAILABLE,
    );
  });

  it('a stage never uses the binding of another stage', async () => {
    await expect(
      run({ JOBS_MIRROR_DB: hyperdrive(url('127.0.0.1', '', 1)) }, 'integrity'),
    ).rejects.toThrow(STAGE_DB_UNAVAILABLE);
  });

  it('a refused connection fails the stage at once (no reconnect loop)', async () => {
    // Port 1 on the loopback: nothing listens there. Through the binding path and the URL path.
    for (const env of [
      { JOBS_MIRROR_DB: hyperdrive(url('127.0.0.1', '', 1)) },
      { JOBS_MIRROR_DB_URL: url('127.0.0.1', '', 1) },
    ]) {
      const started = Date.now();
      await expect(run(env)).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(3_000);
    }
  });
});
