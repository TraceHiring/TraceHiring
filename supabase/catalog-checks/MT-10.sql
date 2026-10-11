-- MT-10 (spec specs/m0-foundations.md §8.5, rule 5, views cannot bypass RLS): in the schemas public, private,
-- quality and integrity, and among the views and materialized views that postgres can SET ROLE to the owner of in a
-- system-list schema where a migration can still create objects (escape_schema below), extension members skipped
-- by the README rule:
--   view_without_security_invoker: a view (relkind v) whose reloptions lack the literal security_invoker=true.
--     PostgreSQL stores the value as written, so security_invoker=on, =1 or =yes is reported too (migrations write
--     exactly with (security_invoker = true)). A missing option and security_invoker=false are reported.
--   matview_in_public: a materialized view in public.
--   matview_privilege: a materialized view, in any of the four schemas, on which a role on the list below holds a
--     table or column privilege (has_*_privilege, so grants through PUBLIC and role membership count).
--   system_schema_view: a view or materialized view in a system-list schema that breaks one of the rules above (the
--     rule is named in the detail).
with
-- Roles that must never read a materialized view directly. M0b adds the candidate roles here (spec §8.5). A
-- listed role that does not exist makes the check raise an error rather than pass.
client_role (rolname) as (
  values
    ('anon'::name),
    ('authenticated'::name)
),
-- shared:escape begin (the same text in MT-5a, MT-5b, MT-5d, MT-10 and MT-11)
-- escape_schema: system-list schemas where a migration can still create objects (spec §8.5 revision 12): postgres
-- can SET ROLE to the schema owner, or to a role with CREATE on it. Locally: extensions, _realtime,
-- supabase_functions and supabase_migrations, plus any listed schema that a migration creates (cron, net and so on).
escape_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in (
      'auth', 'storage', 'extensions', 'realtime', '_realtime', 'graphql', 'graphql_public', 'supabase_functions',
      'supabase_migrations', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics'
    )
    and (
      pg_has_role('postgres', n.nspowner, 'SET')
      or exists (
        select 1
        from pg_roles as r
        where pg_has_role('postgres', r.oid, 'SET')
          and has_schema_privilege(r.oid, n.oid, 'CREATE')
      )
    )
),
-- shared:escape end
scope_rel as (
  select
    c.oid,
    c.relkind,
    c.reloptions,
    n.nspname,
    format('%I.%I', n.nspname, c.relname)::text as qualified_name,
    n.nspname not in ('public', 'private', 'quality', 'integrity') as in_system_schema
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
  where c.relkind in ('v', 'm')
    and (
      n.nspname in ('public', 'private', 'quality', 'integrity')
      or (
        n.oid in (select es.oid from escape_schema as es)
        and pg_has_role('postgres', c.relowner, 'SET')
      )
    )
    and not exists (
      select 1
      from pg_depend as d
      join pg_extension as x on x.oid = d.refobjid
      where d.classid = 'pg_class'::regclass
        and d.objid = c.oid
        and d.refclassid = 'pg_extension'::regclass
        and d.deptype = 'e'
        and x.extnamespace = c.relnamespace
    )
),
finding (oid, branch, detail) as (
  select
    sr.oid,
    'view_without_security_invoker'::text,
    format(
      'view reloptions are %s, not security_invoker=true',
      coalesce(array_to_string(sr.reloptions, ','), 'empty')
    )::text
  from scope_rel as sr
  where sr.relkind = 'v'
    and not ('security_invoker=true' = any(coalesce(sr.reloptions, '{}'::text[])))
  union all
  select
    sr.oid,
    'matview_in_public'::text,
    'materialized view in schema public'::text
  from scope_rel as sr
  where sr.relkind = 'm'
    and sr.nspname = 'public'
  union all
  select
    sr.oid,
    'matview_privilege'::text,
    format('%s holds a privilege on a materialized view', cr.rolname)::text
  from scope_rel as sr
  cross join client_role as cr
  where sr.relkind = 'm'
    and (
      has_table_privilege(cr.rolname, sr.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(cr.rolname, sr.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
    )
)
select
  case when sr.in_system_schema then 'system_schema_view' else f.branch end::text as branch,
  sr.qualified_name as object,
  case
    when sr.in_system_schema then format('in a system schema: %s (%s)', f.detail, f.branch)
    else f.detail
  end::text as detail
from finding as f
join scope_rel as sr on sr.oid = f.oid
