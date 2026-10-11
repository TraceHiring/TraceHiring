-- MT-1 (spec specs/m0-foundations.md §8.5, tenancy): a table (relkind r or p, partitions included) with row level
-- security off. Scope: the schemas public, private, quality and integrity, plus every member of pg_partition_tree()
-- of a partitioned table in them, wherever the member lives. Partitions do not inherit relrowsecurity, so each one
-- is checked on its own. Extension members that live in their extension's own namespace are skipped.
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
  case when c.relispartition then 'partition_without_rls' else 'table_without_rls' end::text as branch,
  format('%I.%I', n.nspname, c.relname)::text as object,
  case
    when c.relispartition then 'partition has row level security off'
    else 'table has row level security off'
  end::text as detail
from pg_class as c
join scope_rel as s on s.oid = c.oid
join pg_namespace as n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and not c.relrowsecurity
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
