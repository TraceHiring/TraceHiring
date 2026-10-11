-- MT-10 (spec specs/m0-foundations.md §8.5, rule 5, views cannot bypass RLS): in the schemas public, private,
-- quality and integrity (extension members skipped by the README rule):
--   view_without_security_invoker: a view (relkind v) whose reloptions lack the literal security_invoker=true.
--     PostgreSQL stores the value as written, so security_invoker=on, =1 or =yes is reported too (migrations write
--     exactly with (security_invoker = true)). A missing option and security_invoker=false are reported.
--   matview_in_public: a materialized view in public.
--   matview_privilege: a materialized view, in any of the four schemas, on which a role on the list below holds a
--     table or column privilege (has_*_privilege, so grants through PUBLIC and role membership count).
with
-- Roles that must never read a materialized view directly. M0b adds the candidate roles here (spec §8.5). A
-- listed role that does not exist makes the check raise an error rather than pass.
client_role (rolname) as (
  values
    ('anon'::name),
    ('authenticated'::name)
),
scope_rel as (
  select c.oid, c.relkind, c.reloptions, n.nspname, format('%I.%I', n.nspname, c.relname)::text as qualified_name
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private', 'quality', 'integrity')
    and c.relkind in ('v', 'm')
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
)
select
  'view_without_security_invoker'::text as branch,
  sr.qualified_name as object,
  format(
    'view reloptions are %s, not security_invoker=true',
    coalesce(array_to_string(sr.reloptions, ','), 'empty')
  )::text as detail
from scope_rel as sr
where sr.relkind = 'v'
  and not ('security_invoker=true' = any(coalesce(sr.reloptions, '{}'::text[])))
union all
select
  'matview_in_public'::text,
  sr.qualified_name,
  'materialized view in schema public'::text
from scope_rel as sr
where sr.relkind = 'm'
  and sr.nspname = 'public'
union all
select
  'matview_privilege'::text,
  sr.qualified_name,
  format('%s holds a privilege on a materialized view', cr.rolname)::text
from scope_rel as sr
cross join client_role as cr
where sr.relkind = 'm'
  and (
    has_table_privilege(cr.rolname, sr.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_any_column_privilege(cr.rolname, sr.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
  )
