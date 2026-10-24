import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LEVELS,
  WORKER_USER,
  cancelSql,
  cancelVerdict,
  demoteSql,
  draftInsertSql,
  draftSetupSql,
  draftVerdict,
  draftWorkerSetupSql,
  draftsSql,
  importBatchSql,
  importCountsSql,
  importSetupSql,
  ownersSql,
  setupSql,
  upFrontVerdict,
  verdict,
  waitingSql,
} from '../test-concurrency-local.mjs';

describe('test-concurrency-local (M0B-DB-5)', () => {
  it('runs both isolation levels, READ COMMITTED first', () => {
    expect(LEVELS).toEqual(['read committed', 'repeatable read']);
  });

  it('builds SQL only from validated ids and a fixed isolation level', () => {
    const orgId = randomUUID();
    const userId = randomUUID();
    const sql = demoteSql({ isolation: 'repeatable read', orgId, userId, marker: 'A_UPDATED' });
    expect(sql).toContain('begin isolation level repeatable read;');
    expect(sql).toContain(`user_id = '${userId}'`);
    expect(sql).toContain('\\echo A_UPDATED');
    expect(() => demoteSql({ isolation: 'serializable', orgId, userId, marker: 'x' })).toThrow();
    expect(() =>
      demoteSql({ isolation: 'read committed', orgId: "x' or true --", userId, marker: 'x' }),
    ).toThrow();
    expect(() => ownersSql("'; drop table x; --")).toThrow();
    expect(waitingSql("'; drop table x; --")).not.toContain('drop');
  });

  it('creates synthetic users with example.test addresses and refuses a bad suffix', () => {
    const sql = setupSql({ ownerA: randomUUID(), ownerB: randomUUID(), suffix: '0a1b2c3d' });
    expect(sql).toMatch(/p-conc-a-0a1b2c3d@example\.test/);
    expect(sql).toContain("'{org_owner,admin}'");
    expect(() => setupSql({ ownerA: randomUUID(), ownerB: randomUUID(), suffix: "x'" })).toThrow();
  });

  it('outside READ COMMITTED, passes only when the change is refused and both owners stay', () => {
    expect(upFrontVerdict({ refused: true, owners: 2 })).toBeNull();
    expect(upFrontVerdict({ refused: false, owners: 1 })).toMatch(/was not refused/);
    expect(upFrontVerdict({ refused: true, owners: 1 })).toMatch(/1 active owners, not 2/);
  });

  it('passes only when the first commits, the second is refused and one owner is left', () => {
    expect(verdict({ firstErrored: false, secondErrored: true, owners: 1 })).toBeNull();
    expect(verdict({ firstErrored: false, secondErrored: false, owners: 0 })).toBe(
      'the second demotion was not refused',
    );
    expect(verdict({ firstErrored: true, secondErrored: true, owners: 2 })).toBe(
      'the first demotion failed',
    );
    expect(verdict({ firstErrored: false, secondErrored: true, owners: 0 })).toMatch(
      /0 active owners/,
    );
  });
});

describe('test-concurrency-local: import cancel during a batch (M1 DB review H1)', () => {
  it('builds SQL only from validated ids, row numbers and markers', () => {
    const owner = randomUUID();
    const jobId = randomUUID();
    const setup = importSetupSql({ owner, suffix: '0a1b2c3d' });
    expect(setup).toMatch(/p-conc-imp-0a1b2c3d@example\.test/);
    expect(setup).toContain('public.import_item_batch');
    expect(() => importSetupSql({ owner, suffix: "x'" })).toThrow();
    const batch = importBatchSql({ owner, jobId, rowNo: 3, marker: 'A_BATCHED' });
    expect(batch).toContain('begin isolation level read committed;');
    expect(batch).toContain(`'${jobId}'`);
    expect(batch).toContain('"rowNo": 3');
    expect(batch).toContain('\\echo A_BATCHED');
    expect(() => importBatchSql({ owner, jobId, rowNo: '3; drop', marker: 'x' })).toThrow();
    expect(() => importBatchSql({ owner, jobId, rowNo: 3, marker: "x'" })).toThrow();
    expect(cancelSql({ owner, jobId, marker: 'B_CANCELLED' })).toContain(
      "set status = 'cancelled'",
    );
    expect(() => cancelSql({ owner: "x' or true --", jobId, marker: 'x' })).toThrow();
    expect(() => importCountsSql("'; drop table x; --")).toThrow();
  });

  it('passes only when the cancel waited, both committed and the counts match the stored rows', () => {
    const ok = { waited: true, batchErrored: false, cancelErrored: false, counts: 'cancelled|2|2' };
    expect(cancelVerdict(ok)).toBeNull();
    expect(cancelVerdict({ ...ok, waited: false })).toMatch(/did not wait/);
    expect(cancelVerdict({ ...ok, batchErrored: true })).toMatch(/batch failed/);
    expect(cancelVerdict({ ...ok, cancelErrored: true })).toMatch(/cancel failed/);
    expect(cancelVerdict({ ...ok, counts: 'cancelled|1|2' })).toMatch(
      /1 error rows .* 2 are stored/,
    );
    expect(cancelVerdict({ ...ok, counts: 'validating|0|2' })).toMatch(/not cancelled/);
  });
});

describe('test-concurrency-local: two deliveries of a count-1 drafting job (M1 DB review M1)', () => {
  it('builds SQL only from validated ids and markers', () => {
    const owner = randomUUID();
    const setup = draftSetupSql({ owner, suffix: '0a1b2c3d' });
    expect(setup).toMatch(/p-conc-draft-0a1b2c3d@example\.test/);
    expect(setup).toMatch(/'mcq', 'verbal', 0\.50, 1,/);
    expect(setup).not.toContain('trace_authoring_worker');
    expect(() => draftSetupSql({ owner, suffix: 'zz' })).toThrow();
    const worker = draftWorkerSetupSql({
      orgId: randomUUID(),
      wsId: randomUUID(),
      jobId: randomUUID(),
    });
    expect(worker).toContain("set_config('role', 'trace_authoring_worker', true)");
    expect(worker).toContain("set status = 'running'");
    expect(() =>
      draftWorkerSetupSql({ orgId: 'x', wsId: randomUUID(), jobId: randomUUID() }),
    ).toThrow();
    expect(WORKER_USER).toBe('supabase_admin');
    const ids = { orgId: randomUUID(), jobId: randomUUID(), itemId: randomUUID() };
    const insert = draftInsertSql({ ...ids, shaChar: 'c', marker: 'A_DRAFTED' });
    expect(insert).toContain('begin isolation level read committed;');
    expect(insert).toContain("set_config('role', 'trace_authoring_worker', true)");
    expect(insert).toContain(`'${ids.itemId}'`);
    expect(insert).toContain("repeat('c', 64)");
    expect(() => draftInsertSql({ ...ids, shaChar: "c'", marker: 'x' })).toThrow();
    expect(() => draftInsertSql({ ...ids, itemId: 'nope', shaChar: 'c', marker: 'x' })).toThrow();
    expect(() => draftsSql("'; drop table x; --")).toThrow();
  });

  it('passes only when the second delivery waited, was refused, one draft is stored and the job still runs', () => {
    const ok = { waited: true, firstErrored: false, secondErrored: true, state: 'running|1' };
    expect(draftVerdict(ok)).toBeNull();
    expect(draftVerdict({ ...ok, waited: false })).toMatch(/did not wait/);
    expect(draftVerdict({ ...ok, firstErrored: true })).toMatch(/first delivery failed/);
    expect(draftVerdict({ ...ok, secondErrored: false, state: 'running|2' })).toMatch(
      /was not refused/,
    );
    expect(draftVerdict({ ...ok, state: 'running|2' })).toMatch(/2 drafts, not 1/);
    // Database review L3: the refusal text is shared with "job not running"; a job that ended is a failure.
    expect(draftVerdict({ ...ok, state: 'completed|1' })).toBe('the job is completed, not running');
    expect(draftsSql(randomUUID())).toContain('from public.ai_draft_jobs as j');
  });
});
