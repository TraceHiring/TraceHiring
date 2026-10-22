-- MT-14 (spec specs/m0b-tenancy.md §2.3, §5): Postgres principals.
--   attribute: a trace_* role with BYPASSRLS, SUPERUSER, CREATEROLE, CREATEDB, REPLICATION or LOGIN (LOGIN is
--     M0b-only: M2/M3a relax it for named login roles with a spec revision).
--   gateway_edge: trace_candidate_gateway is missing or not NOINHERIT, its membership in trace_candidate is missing,
--     has inherit or lacks set, or it holds any other membership (D14).
--   candidate_member: any other role is a member of trace_candidate with inherit or set. ADMIN-only rows (the
--     PostgreSQL 16+ creator membership of postgres, S5/D4) are ignored.
--   bypassrls: a non-superuser role with BYPASSRLS outside the allow-list postgres (migration owner),
--     service_role, supabase_etl_admin and supabase_read_only_user (D5).
--   supabase_role_membership: any membership between anon, authenticated and service_role (DC-6: postgres can
--     grant them to each other, so this is checked, not assumed).
--   both_schemas: rule 1 (S10). A role other than the schema owner and superusers holds USAGE on both quality
--     and integrity, directly or through any chain of memberships with inherit or set, or is such a member of
--     both trace_quality_worker and trace_integrity_worker.
--   login_dml: a LOGIN role other than postgres and superusers holds INSERT, UPDATE, DELETE or TRUNCATE on a
--     table or view in public, private, quality or integrity (has_table_privilege, so inherited grants count).
--     Login roles act only after SET ROLE, which keeps the operator predicate sound (E6). No allow-list entry.
with recursive bypass_allowed (rolname) as (
  values ('postgres'::name), ('service_role'::name), ('supabase_etl_admin'::name),
    ('supabase_read_only_user'::name)
),
gateway as (
  select r.oid, r.rolinherit
  from pg_roles as r
  where r.rolname = 'trace_candidate_gateway'
),
candidate as (
  select r.oid
  from pg_roles as r
  where r.rolname = 'trace_candidate'
),
worker_schema (rolid, nspname) as (
  select a.grantee, n.nspname
  from pg_namespace as n
  cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) as a
  where n.nspname in ('quality', 'integrity')
    and a.privilege_type = 'USAGE'
    and a.grantee <> n.nspowner
  union
  select m.member, w.nspname
  from worker_schema as w
  join pg_auth_members as m on m.roleid = w.rolid
  where m.inherit_option or m.set_option
),
login_role as (
  select r.oid, r.rolname
  from pg_roles as r
  where r.rolcanlogin
    and not r.rolsuper
    and r.rolname <> 'postgres'
),
scope_table as (
  select c.oid, n.nspname, c.relname
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private', 'quality', 'integrity')
    and c.relkind in ('r', 'p', 'v', 'f')
)
select
  'attribute'::text as branch,
  r.rolname::text as object,
  concat_ws(', ',
    case when r.rolbypassrls then 'BYPASSRLS' end,
    case when r.rolsuper then 'SUPERUSER' end,
    case when r.rolcreaterole then 'CREATEROLE' end,
    case when r.rolcreatedb then 'CREATEDB' end,
    case when r.rolreplication then 'REPLICATION' end,
    case when r.rolcanlogin then 'LOGIN' end)::text as detail
from pg_roles as r
where r.rolname like 'trace\_%'
  and (r.rolbypassrls or r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolcanlogin)
union all
select
  'gateway_edge'::text,
  'trace_candidate_gateway'::text,
  'the gateway role is missing'::text
where not exists (select 1 from gateway)
union all
select
  'gateway_edge'::text,
  'trace_candidate_gateway'::text,
  'the gateway role is not NOINHERIT'::text
from gateway as g
where g.rolinherit
union all
select
  'gateway_edge'::text,
  'trace_candidate_gateway'::text,
  'no membership in trace_candidate with set true and inherit false'::text
from gateway as g
where not exists (
  select 1
  from pg_auth_members as m
  join candidate as c on c.oid = m.roleid
  where m.member = g.oid
    and m.set_option
    and not m.inherit_option
)
union all
select
  'gateway_edge'::text,
  'trace_candidate_gateway'::text,
  format('membership in %s', m.roleid::regrole)::text
from gateway as g
join pg_auth_members as m on m.member = g.oid
where m.roleid not in (select c.oid from candidate as c)
  or m.inherit_option
  or not m.set_option
union all
select
  'candidate_member'::text,
  m.member::regrole::text,
  'member of trace_candidate with inherit or set'::text
from pg_auth_members as m
join candidate as c on c.oid = m.roleid
where m.member not in (select g.oid from gateway as g)
  and (m.inherit_option or m.set_option)
union all
select
  'bypassrls'::text,
  r.rolname::text,
  'BYPASSRLS outside the allow-list'::text
from pg_roles as r
where r.rolbypassrls
  and not r.rolsuper
  and r.rolname not in (select b.rolname from bypass_allowed as b)
union all
select
  'supabase_role_membership'::text,
  m.member::regrole::text,
  format('member of %s', m.roleid::regrole)::text
from pg_auth_members as m
where m.roleid in (select r.oid from pg_roles as r where r.rolname in ('anon', 'authenticated', 'service_role'))
  and m.member in (select r.oid from pg_roles as r where r.rolname in ('anon', 'authenticated', 'service_role'))
union all
select
  'both_schemas'::text,
  case when w.rolid = 0 then 'PUBLIC' else w.rolid::regrole::text end,
  'USAGE on both quality and integrity'::text
from worker_schema as w
where w.nspname = 'quality'
  and exists (
    select 1
    from worker_schema as x
    where x.rolid = w.rolid
      and x.nspname = 'integrity'
  )
  and not exists (
    select 1
    from pg_roles as r
    where r.oid = w.rolid
      and r.rolsuper
  )
union all
select
  'both_schemas'::text,
  m.member::regrole::text,
  'member of both trace_quality_worker and trace_integrity_worker'::text
from pg_auth_members as m
where m.roleid = (select r.oid from pg_roles as r where r.rolname = 'trace_quality_worker')
  and (m.inherit_option or m.set_option)
  and exists (
    select 1
    from pg_auth_members as m2
    where m2.member = m.member
      and m2.roleid = (select r.oid from pg_roles as r where r.rolname = 'trace_integrity_worker')
      and (m2.inherit_option or m2.set_option)
  )
union all
select
  'login_dml'::text,
  l.rolname::text,
  format('can write %I.%I', t.nspname, t.relname)::text
from login_role as l
cross join scope_table as t
where has_table_privilege(l.oid, t.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')
