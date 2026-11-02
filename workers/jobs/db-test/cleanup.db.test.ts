// Stale cleanup of the db-test harness never touches a concurrent run and never hangs (DB review #4 and #5,
// security review #3): a temporary login role is dropped only when it has no session and is older than 30 minutes;
// a `jobs-dbtest-%` org is removed only when older than 30 minutes; CLEANUP_SQL gives up on a held lock after 5 s.
// Synthetic roles and orgs only, all removed again.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLEANUP_SQL,
  cleanupOrg,
  cleanupStaleOrgs,
  dropStaleLogins,
  loginTag,
  newId,
  openHarness,
  openOperator,
  roleUrl,
  type Harness,
} from './harness.js';

let h: Harness;
const created: string[] = [];
const orgs: string[] = [];

const HOUR_MS = 60 * 60 * 1000;
const roleExists = async (name: string): Promise<boolean> =>
  (await h.admin.unsafe('select 1 from pg_roles where rolname = $1', [name])).length > 0;
const makeRole = async (tag: string): Promise<{ name: string; password: string }> => {
  const name = `jobs_dbtest_${tag}_worker`;
  const password = randomBytes(24).toString('hex');
  await h.admin.unsafe(`create role ${name} login noinherit password '${password}'`);
  created.push(name);
  return { name, password };
};
const makeOrg = async (ageMs: number): Promise<string> => {
  const id = newId();
  await h.admin.unsafe(
    "insert into public.orgs (id, kind, name, slug, created_at) values ($1, 'customer', 'Jobs DB test', $2, now() - make_interval(secs => $3::int))",
    [id, `jobs-dbtest-${randomBytes(6).toString('hex')}`, String(Math.floor(ageMs / 1000))],
  );
  orgs.push(id);
  return id;
};
const orgExists = async (id: string): Promise<boolean> =>
  (await h.admin.unsafe('select 1 from public.orgs where id = $1', [id])).length > 0;

beforeAll(async () => {
  h = await openHarness();
});

afterAll(async () => {
  if (h === undefined) return;
  try {
    for (const id of orgs) await cleanupOrg(h.admin, id);
    for (const name of created) await h.admin.unsafe(`drop role if exists ${name}`);
  } finally {
    await h.close();
  }
});

describe('stale login roles', () => {
  it('a role older than 30 minutes with a live session is kept; without the session it is dropped', async () => {
    const role = await makeRole(loginTag(Date.now() - HOUR_MS));
    const conn = openOperator(roleUrl(role.name, role.password));
    try {
      await conn.unsafe('select 1');
      await dropStaleLogins(h.admin);
      expect(await roleExists(role.name)).toBe(true);
    } finally {
      await conn.end({ timeout: 2 });
    }
    // the backend leaves pg_stat_activity shortly after the client closes
    for (let i = 0; i < 50; i += 1) {
      const live = await h.admin.unsafe('select 1 from pg_stat_activity where usename = $1', [
        role.name,
      ]);
      if (live.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await dropStaleLogins(h.admin);
    expect(await roleExists(role.name)).toBe(false);
  });

  it('a role younger than 30 minutes without a session is kept (a run that has not connected yet)', async () => {
    const role = await makeRole(loginTag(Date.now() - 60_000));
    await dropStaleLogins(h.admin);
    expect(await roleExists(role.name)).toBe(true);
  });

  it('this run’s own roles survive another run’s stale cleanup', async () => {
    await dropStaleLogins(h.admin);
    await expect(
      h.stage('trace_worker', null, async (tx) => tx.query('select 1 as one')),
    ).resolves.toEqual([{ one: 1 }]);
  });
});

describe('stale orgs', () => {
  it('only jobs-dbtest orgs older than 30 minutes are removed', async () => {
    const old = await makeOrg(HOUR_MS);
    const fresh = await makeOrg(60_000);
    await cleanupStaleOrgs(h.admin);
    expect(await orgExists(old)).toBe(false);
    expect(await orgExists(fresh)).toBe(true);
  });
});

describe('cleanup never hangs', () => {
  it('sets a 5 s lock_timeout first', () => {
    expect(CLEANUP_SQL).toMatch(/^\s*do \$cleanup\$[\s\S]*?begin\s+set local lock_timeout = '5s';/);
  });

  it('a lock held by a concurrent transaction fails the cleanup with 55P03 within the timeout', async () => {
    const other = openOperator();
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = other.begin(async (t) => {
      await t.unsafe('lock table public.integrity_cards in row exclusive mode');
      locked();
      await held;
    });
    try {
      await isLocked;
      const started = Date.now();
      const err = (await cleanupOrg(h.admin, newId()).catch((e: unknown) => e)) as {
        code?: string;
      };
      expect(err.code).toBe('55P03');
      expect(Date.now() - started).toBeLessThan(15_000);
    } finally {
      release();
      await holder;
      await other.end({ timeout: 2 });
    }
  }, 30_000);
});
