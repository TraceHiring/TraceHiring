import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LEVELS,
  demoteSql,
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
