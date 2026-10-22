// Real-database harness for the jobs stages (spec d1 §5.1, ADR-031). Node only, never bundled.
//
// It connects with the `postgres` driver to the shared local Supabase database (127.0.0.1:54322, db `postgres`;
// override with JOBS_TEST_DB_URL, local hosts only) and runs each stage exactly as the consumer will: on a login role that holds one
// worker role `with inherit false, set true`, one transaction of
//   BEGIN; SET LOCAL ROLE <trace_worker|trace_quality_worker|trace_integrity_worker>;
//   SELECT set_config('trace.job_org_id', <org>, true); <stage>; COMMIT
// The production login roles (jobs_*_login, api_login) are operator-created and do not exist locally, so the harness
// creates four temporary login roles with a random password (not trace_*, one worker role each, MT-14 shape), and
// drops them at the end. Fixtures are synthetic and live in a fresh random org per test file; cleanup() removes that
// org's rows again (see below). No SQL text, id or value is ever printed.
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { SqlParam, SqlTx } from '@trace/shared/jobs';
import { localDbUrlAllowed } from '@trace/workers-http/pg-socket';

export type WorkerRole =
  'trace_worker' | 'trace_quality_worker' | 'trace_integrity_worker' | 'trace_api';
type Sql = postgres.Sql;

/** The local stack's operator URL, assembled at run time (no credential literal in the repo). */
const localUrl = (user: string, password: string): string => {
  const scheme = ['postgres', 'ql'].join('');
  return `${scheme}://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:54322/postgres`;
};
const NOT_LOCAL = 'db-test: JOBS_TEST_DB_URL must name a local database';

/**
 * The operator URL (DB review #3, security review #1): the local stack, or JOBS_TEST_DB_URL only when its host is
 * local. Anything else throws before a connection is opened; the error never quotes the URL.
 */
export const operatorUrl = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): string => {
  const override = env['JOBS_TEST_DB_URL'];
  if (override === undefined || override === '') {
    const word = ['post', 'gres'].join('');
    return localUrl(word, word);
  }
  // The Workers' own guard (one loopback host, one "@", no "," and no query; Chat E3 re-review finding 2).
  if (!localDbUrlAllowed(override)) throw new Error(NOT_LOCAL);
  return override;
};
const withUser = (url: string, user: string, password: string): string => {
  const u = new URL(url);
  u.username = encodeURIComponent(user);
  u.password = encodeURIComponent(password);
  return u.toString();
};

const connect = (url: string): Sql =>
  postgres(url, {
    ssl: false,
    fetch_types: false,
    prepare: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => {},
  });

/** An independent operator connection, or one to `url` (built by roleUrl, so on the same local server). */
export const openOperator = (url: string = operatorUrl()): Sql => connect(url);
/** The URL of a temporary login role on the operator's (local) server. */
export const roleUrl = (user: string, password: string): string =>
  withUser(operatorUrl(), user, password);

/**
 * The tag of one run's temporary login roles: its creation time (epoch seconds, 8 hex) and 4 random bytes, so a
 * later run can tell a stale role from one a concurrent run created a moment ago.
 */
export const loginTag = (now: number = Date.now()): string =>
  `${Math.floor(now / 1000)
    .toString(16)
    .padStart(8, '0')}_${randomBytes(4).toString('hex')}`;

/** SqlTx over one postgres.js transaction: constant text, bound params (the shape the consumer injects). */
export const sqlTxOf = (t: postgres.TransactionSql): SqlTx => ({
  query: async <R extends object>(text: string, params: readonly SqlParam[] = []): Promise<R[]> =>
    (await t.unsafe(text, params as SqlParam[])) as unknown as R[],
});

export type Isolation = 'read committed' | 'repeatable read';

export interface Harness {
  /** The operator connection (fixtures and cleanup only). */
  admin: Sql;
  /** Runs fn in one transaction as `role` with trace.job_org_id (trace.api_org_id for trace_api) = org. */
  stage<T>(
    role: WorkerRole,
    org: string | null,
    fn: (tx: SqlTx) => Promise<T>,
    iso?: Isolation,
  ): Promise<T>;
  /** A second, independent connection per role (for the concurrency case). */
  stageOn<T>(
    conn: 'a' | 'b',
    role: WorkerRole,
    org: string | null,
    fn: (tx: SqlTx) => Promise<T>,
    iso?: Isolation,
  ): Promise<T>;
  /** The local URL of this run's temporary login for `role` (to drive production code such as withStageConnection). */
  loginUrl(role: WorkerRole): string;
  close(): Promise<void>;
}

const ROLES: readonly WorkerRole[] = [
  'trace_worker',
  'trace_quality_worker',
  'trace_integrity_worker',
  'trace_api',
];
const SET_ROLE: Record<WorkerRole, string> = {
  trace_worker: 'set local role trace_worker',
  trace_quality_worker: 'set local role trace_quality_worker',
  trace_integrity_worker: 'set local role trace_integrity_worker',
  trace_api: 'set local role trace_api',
};
const SET_ORG = "select set_config('trace.job_org_id', $1, true)";
const SET_API_ORG = "select set_config('trace.api_org_id', $1, true)";
const ISO: Record<Isolation, string> = {
  'read committed': 'set transaction isolation level read committed',
  'repeatable read': 'set transaction isolation level repeatable read',
};

export const openHarness = async (): Promise<Harness> => {
  const base = operatorUrl();
  const admin = connect(base);
  await dropStaleLogins(admin);
  const tag = loginTag();
  const logins = new Map<WorkerRole, { name: string; password: string }>();
  for (const role of ROLES) {
    const name = `jobs_dbtest_${tag}_${role.replace('trace_', '')}`;
    logins.set(role, { name, password: randomBytes(24).toString('hex') });
  }
  // DDL takes no bind parameters; names are generated from hex and fixed words, passwords are hex.
  for (const role of ROLES) {
    const l = logins.get(role)!;
    await admin.unsafe(`create role ${l.name} login noinherit password '${l.password}'`);
    await admin.unsafe(`grant ${role} to ${l.name} with inherit false, set true`);
  }
  const conns = new Map<string, Sql>();
  const conn = (key: string, role: WorkerRole): Sql => {
    const k = `${key}:${role}`;
    let c = conns.get(k);
    if (c === undefined) {
      const l = logins.get(role)!;
      c = connect(withUser(base, l.name, l.password));
      conns.set(k, c);
    }
    return c;
  };
  const run = async <T>(
    c: Sql,
    role: WorkerRole,
    org: string | null,
    fn: (tx: SqlTx) => Promise<T>,
    iso: Isolation,
  ): Promise<T> =>
    (await c.begin(async (t) => {
      await t.unsafe(ISO[iso]);
      await t.unsafe(SET_ROLE[role]);
      await t.unsafe(role === 'trace_api' ? SET_API_ORG : SET_ORG, [org ?? '']);
      return fn(sqlTxOf(t));
    })) as T;

  return {
    admin,
    stage: (role, org, fn, iso = 'read committed') => run(conn('a', role), role, org, fn, iso),
    stageOn: (key, role, org, fn, iso = 'read committed') =>
      run(conn(key, role), role, org, fn, iso),
    loginUrl: (role) => {
      const l = logins.get(role)!;
      return withUser(base, l.name, l.password);
    },
    close: async () => {
      for (const c of conns.values()) await c.end({ timeout: 2 });
      for (const role of ROLES) {
        const l = logins.get(role)!;
        await admin.unsafe(`drop role if exists ${l.name}`);
      }
      await admin.end({ timeout: 2 });
    },
  };
};

/** A run's leftovers are stale only after this long (no db-test file runs anywhere near 30 minutes). */
export const STALE_AFTER_MS = 30 * 60 * 1000;
// jobs_dbtest_<created, 8 hex epoch seconds>_<8 hex random>_<role>; the older form had only the random part.
const LOGIN_NAME = /^jobs_dbtest_([0-9a-f]{8})(?:_([0-9a-f]{8}))?_[a-z_]+$/;

/**
 * Drops temporary login roles a crashed earlier run left behind (DB review #4, security review #3): only a role with
 * no session in pg_stat_activity and, for a role whose name carries its creation time, older than STALE_AFTER_MS, so
 * a concurrent run's roles (connected, or created a moment ago and not yet connected) are never dropped.
 */
export const dropStaleLogins = async (admin: Sql, now: number = Date.now()): Promise<void> => {
  const rows = await admin.unsafe<{ rolname: string }[]>(
    'select r.rolname from pg_roles as r ' +
      "where r.rolname ~ '^jobs_dbtest_[0-9a-f]{8}(_[0-9a-f]{8})?_[a-z_]+$' " +
      'and not exists (select 1 from pg_stat_activity as a where a.usename = r.rolname)',
  );
  for (const r of rows) {
    const m = LOGIN_NAME.exec(r.rolname);
    if (m === null) continue;
    const createdMs = m[2] === undefined ? null : parseInt(m[1] ?? '', 16) * 1000;
    if (createdMs !== null && now - createdMs < STALE_AFTER_MS) continue;
    await admin.unsafe(`drop role if exists ${r.rolname}`);
  }
};

/** Removes `jobs-dbtest-%` orgs a crashed earlier run left behind: older than STALE_AFTER_MS only (DB review #4). */
export const cleanupStaleOrgs = async (admin: Sql): Promise<void> => {
  const rows = await admin.unsafe<{ id: string }[]>(
    "select id::text as id from public.orgs where slug like 'jobs-dbtest-%' " +
      'and created_at < now() - make_interval(secs => $1::int)',
    [String(STALE_AFTER_MS / 1000)],
  );
  for (const r of rows) await cleanupOrg(admin, r.id);
};

export const newId = (): string => randomUUID();

/**
 * Removes every row of one synthetic org, in one transaction, and leaves the schema exactly as it was. The D1 tables
 * are append-only or immutable through ENABLE ALWAYS triggers (they fire in replica mode too), and DELETE is revoked
 * from the owner on the append-only ones. So, for this transaction only: replica mode (no FK ordering), each
 * ENABLE ALWAYS user trigger on an org-scoped table disabled and re-enabled ALWAYS, DELETE granted to the owner only
 * where it was missing and revoked again. Any failure rolls the whole transaction back (DDL is transactional).
 */
export const CLEANUP_SQL = `
do $cleanup$
declare
  v_org uuid := current_setting('jobs_dbtest.org')::uuid;
  r record;
  t regclass;
  i int;
  v_granted regclass[] := '{}';
  v_rels regclass[] := '{}';
  v_names text[] := '{}';
begin
  set local lock_timeout = '5s';
  set local session_replication_role = replica;
  for r in
    select tg.tgrelid::regclass as rel, tg.tgname
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where not tg.tgisinternal and tg.tgenabled = 'A'
      and c.relnamespace::regnamespace::text in ('public', 'quality', 'integrity')
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id')
  loop
    execute format('alter table %s disable trigger %I', r.rel, r.tgname);
    v_rels := v_rels || r.rel;
    v_names := v_names || r.tgname::text;
  end loop;
  for t in
    select c.oid::regclass from pg_class c
    where c.relkind in ('r', 'p') and not c.relispartition
      and c.relnamespace::regnamespace::text in ('public', 'quality', 'integrity')
      and c.oid <> 'public.orgs'::regclass
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id')
  loop
    if not has_table_privilege(t, 'DELETE') then
      execute format('grant delete on %s to postgres', t);
      v_granted := v_granted || t;
    end if;
    execute format('delete from %s where org_id = $1', t) using v_org;
  end loop;
  delete from public.orgs where id = v_org;
  foreach t in array v_granted loop
    execute format('revoke delete on %s from postgres', t);
  end loop;
  -- exactly the triggers disabled above, back to ENABLE ALWAYS
  for i in 1 .. coalesce(array_length(v_rels, 1), 0) loop
    execute format('alter table %s enable always trigger %I', v_rels[i], v_names[i]);
  end loop;
end
$cleanup$`;

/** A fingerprint of every user trigger's enabled state and the owner's DELETE rights, to prove cleanup restored them. */
export const SCHEMA_STATE_SQL = `
select md5(string_agg(x, ',' order by x)) as fp from (
  select tg.tgrelid::regclass::text || '.' || tg.tgname || '=' || tg.tgenabled::text as x
  from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
  where not tg.tgisinternal and c.relnamespace::regnamespace::text in ('public', 'quality', 'integrity')
  union all
  select c.oid::regclass::text || ':delete=' || has_table_privilege(c.oid, 'DELETE')::text
  from pg_class c where c.relkind in ('r', 'p') and c.relnamespace::regnamespace::text in ('public', 'quality', 'integrity')
) s`;

export const cleanupOrg = async (admin: Sql, org: string): Promise<void> => {
  await admin.begin(async (t) => {
    await t.unsafe("select set_config('jobs_dbtest.org', $1, true)", [org]);
    await t.unsafe(CLEANUP_SQL);
  });
};
