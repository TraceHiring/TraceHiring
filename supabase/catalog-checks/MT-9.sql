-- MT-9 (spec specs/m0-foundations.md §8.5, default-ACL integrity, database review F2): an in-scope relation (any
-- relkind, partitions included) or function not owned by postgres, an extension whose extnamespace is one of the
-- four in-scope schemas, or a relation or function in schema extensions that is owned by postgres and is not a
-- member of any extension (our own migrations made it). Supabase's own non-member helpers in extensions are owned
-- by supabase_admin, so they are not reported. Same scope and extension-member skip as MT-1 for wrong_owner.
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
)
select
  'wrong_owner'::text as branch,
  format('%I.%I', n.nspname, c.relname)::text as object,
  format('relation (relkind %s) owned by %s, not postgres', c.relkind, pg_get_userbyid(c.relowner))::text as detail
from pg_class as c
join scope_rel as s on s.oid = c.oid
join pg_namespace as n on n.oid = c.relnamespace
where pg_get_userbyid(c.relowner) <> 'postgres'
  and not exists (
    select 1
    from pg_depend as d
    join pg_extension as e on e.oid = d.refobjid
    where d.classid = 'pg_class'::regclass
      and d.objid = c.oid
      and d.refclassid = 'pg_extension'::regclass
      and d.deptype = 'e'
      and e.extnamespace = c.relnamespace
  )
union all
select
  'wrong_owner'::text,
  format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))::text,
  format('function owned by %s, not postgres', pg_get_userbyid(p.proowner))::text
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where p.pronamespace in (select s.oid from scope_schema as s)
  and pg_get_userbyid(p.proowner) <> 'postgres'
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
union all
select
  'extension_in_scope'::text,
  e.extname::text,
  format('extension installed in schema %I, not extensions', n.nspname)::text
from pg_extension as e
join pg_namespace as n on n.oid = e.extnamespace
where e.extnamespace in (select s.oid from scope_schema as s)
union all
select
  'handmade_in_extensions'::text,
  format('extensions.%I', c.relname)::text,
  format('relation (relkind %s) owned by postgres and not an extension member', c.relkind)::text
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'extensions'
  and pg_get_userbyid(c.relowner) = 'postgres'
  and not exists (
    select 1
    from pg_depend as d
    where d.classid = 'pg_class'::regclass
      and d.objid = c.oid
      and d.refclassid = 'pg_extension'::regclass
      and d.deptype = 'e'
  )
union all
select
  'handmade_in_extensions'::text,
  format('extensions.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))::text,
  'function owned by postgres and not an extension member'::text
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'extensions'
  and pg_get_userbyid(p.proowner) = 'postgres'
  and not exists (
    select 1
    from pg_depend as d
    where d.classid = 'pg_proc'::regclass
      and d.objid = p.oid
      and d.refclassid = 'pg_extension'::regclass
      and d.deptype = 'e'
  )
