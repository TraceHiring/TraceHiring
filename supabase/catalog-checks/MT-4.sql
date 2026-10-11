-- MT-4 (spec specs/m0-foundations.md §8.5, tenancy): (a) any privilege for anon on an in-scope relation, column,
-- sequence or function (has_*_privilege, so grants through PUBLIC and role membership count). anon_column fires only
-- for column privileges that the same table-level privilege does not already explain. (b) an aclexplode(relacl)
-- entry on an in-scope table (relkind r or p) that gives TRUNCATE, TRIGGER or REFERENCES to a grantee other than the
-- owner. (b) reads ACL entries, not has_table_privilege, so superusers do not show up. TRUNCATE ignores RLS.
-- Same scope and skips as MT-1. Functions are those in the four schemas, prokind f, p, a or w. The CASE around
-- has_sequence_privilege keeps the planner from calling it on a non-sequence, which raises an error.
with scope_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in ('public', 'private', 'quality', 'integrity')
),
scope_rel as (
  select c.oid
  from pg_class as c
  where c.relnamespace in (select s.oid from scope_schema as s)
  union
  select t.relid
  from pg_class as c
  cross join lateral pg_partition_tree(c.oid) as t
  where c.relkind = 'p'
    and c.relnamespace in (select s.oid from scope_schema as s)
),
scope_class as (
  select c.oid, c.relkind, c.relowner, c.relacl, format('%I.%I', n.nspname, c.relname) as qualified_name
  from pg_class as c
  join scope_rel as s on s.oid = c.oid
  join pg_namespace as n on n.oid = c.relnamespace
  where not exists (
    select 1
    from pg_depend as d
    join pg_extension as e on e.oid = d.refobjid
    where d.classid = 'pg_class'::regclass
      and d.objid = c.oid
      and d.refclassid = 'pg_extension'::regclass
      and d.deptype = 'e'
      and e.extnamespace = c.relnamespace
  )
),
scope_function as (
  select
    p.oid,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as qualified_name
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where p.pronamespace in (select s.oid from scope_schema as s)
    and p.prokind in ('f', 'p', 'a', 'w')
    and not exists (
      select 1
      from pg_depend as d
      join pg_extension as e on e.oid = d.refobjid
      where d.classid = 'pg_proc'::regclass
        and d.objid = p.oid
        and d.refclassid = 'pg_extension'::regclass
        and d.deptype = 'e'
        and e.extnamespace = p.pronamespace
    )
)
select
  'anon_table'::text as branch,
  sc.qualified_name::text as object,
  'anon holds a table privilege'::text as detail
from scope_class as sc
where sc.relkind in ('r', 'p', 'v', 'm', 'f')
  and has_table_privilege('anon', sc.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
union all
select
  'anon_column'::text,
  sc.qualified_name::text,
  'anon holds a column privilege'::text
from scope_class as sc
where sc.relkind in ('r', 'p', 'v', 'm', 'f')
  and has_any_column_privilege('anon', sc.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
  and not has_table_privilege('anon', sc.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
union all
select
  'anon_sequence'::text,
  sc.qualified_name::text,
  'anon holds a sequence privilege'::text
from scope_class as sc
where case when sc.relkind = 'S' then has_sequence_privilege('anon', sc.oid, 'USAGE,SELECT,UPDATE') else false end
union all
select
  'anon_function'::text,
  sf.qualified_name::text,
  'anon holds EXECUTE'::text
from scope_function as sf
where has_function_privilege('anon', sf.oid, 'EXECUTE')
union all
select
  'acl_truncate_trigger_references'::text,
  sc.qualified_name::text,
  format(
    '%s holds %s',
    case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end,
    a.privilege_type
  )::text
from scope_class as sc
cross join lateral aclexplode(sc.relacl) as a
where sc.relkind in ('r', 'p')
  and a.grantee <> sc.relowner
  and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
