// One SQL session per stage (spec d1 §5.1 "Each stage is its own transaction on its own connection"; ADR-031;
// MT-14, L-29). The consumer opens the stage's own login URL, runs BEGIN, `SET LOCAL ROLE` to the stage's
// NOLOGIN worker role, binds `trace.job_org_id` (read by private.job_org_id()) and a server-generated
// `trace.request_id`, runs the stage, then COMMIT; a stage result counts only after the COMMIT.
import { describe, expect, it } from 'vitest';
import { STAGE_DB, createStageDb, jobsDbSsl, type BeginTx, type StageDbName } from './stage-db.js';

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
  it('maps each stage to its own secret and NOLOGIN role; the sweep runs as trace_worker', () => {
    expect(STAGE_DB).toEqual({
      mirror: { secret: 'JOBS_MIRROR_DB_URL', role: 'trace_worker' },
      quality: { secret: 'JOBS_QUALITY_DB_URL', role: 'trace_quality_worker' },
      integrity: { secret: 'JOBS_INTEGRITY_DB_URL', role: 'trace_integrity_worker' },
      sweep: { secret: 'JOBS_MIRROR_DB_URL', role: 'trace_worker' },
    });
    const roles = new Set(
      (['mirror', 'quality', 'integrity'] as const).map((s) => STAGE_DB[s].role),
    );
    expect(roles.size).toBe(3);
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

describe('jobsDbSsl: TLS for the jobs logins (security review R3 #1 rule, ADR-031)', () => {
  const url = (host: string, q = ''): string => `postgres://u:p@${host}:5432/postgres${q}`;
  it('requires TLS for a remote host and allows verify-full', () => {
    expect(jobsDbSsl(url('db.example.test'))).toBe('require');
    expect(jobsDbSsl(url('db.example.test', '?sslmode=require'))).toBe('require');
    expect(jobsDbSsl(url('db.example.test', '?sslmode=verify-full'))).toBe('verify-full');
  });
  it('refuses weak or unknown modes, repeated modes and other parameters', () => {
    for (const q of [
      '?sslmode=disable',
      '?sslmode=prefer',
      '?sslmode=allow',
      '?sslmode=verify-ca',
      '?sslmode=require&sslmode=require',
      '?options=x',
    ]) {
      expect(jobsDbSsl(url('db.example.test', q))).toBeNull();
    }
    expect(jobsDbSsl('mysql://h/db')).toBeNull();
    expect(jobsDbSsl('not a url')).toBeNull();
  });
  it('the local stack may run without TLS', () => {
    expect(jobsDbSsl(url('127.0.0.1'))).toBe(false);
    expect(jobsDbSsl(url('localhost'))).toBe(false);
  });
});
