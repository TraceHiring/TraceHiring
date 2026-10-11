-- MT-1 (spec specs/m0-foundations.md §8.5, tenancy): a table (relkind r or p) in scope with row level security off.
-- Scope: the schemas public, private, quality and integrity, plus every member of pg_partition_tree() of a
-- partitioned table in them and every pg_inherits descendant (recursive) of a relation in scope, wherever the member
-- or descendant lives. Partitions and INHERITS children do not inherit relrowsecurity, so each one is checked on its
-- own: a partition is partition_without_rls, any other table outside the four schemas (an INHERITS child) is
-- inheritance_without_rls, and a table in the four schemas is table_without_rls. foreign_table_in_scope is any
-- foreign table (relkind f) in scope, a partition or INHERITS child included: foreign tables cannot have row level
-- security at all. Extension members that live in their extension's own namespace are skipped.
with recursive scope_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in ('public', 'private', 'quality', 'integrity')
),
scope_rel (oid) as (
  select c.oid
  from pg_class as c
  where c.relnamespace in (select s.oid from scope_schema as s)
  union
  select t.relid
  from pg_class as c
  cross join lateral pg_partition_tree(c.oid) as t
  where c.relkind = 'p'
    and c.relnamespace in (select s.oid from scope_schema as s)
  union
  select i.inhrelid
  from pg_inherits as i
  join scope_rel as r on r.oid = i.inhparent
),
scope_class as (
  select c.oid, c.relkind, c.relispartition, c.relrowsecurity, c.relnamespace, n.nspname, c.relname
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
)
select
  case
    when sc.relispartition then 'partition_without_rls'
    when sc.relnamespace in (select s.oid from scope_schema as s) then 'table_without_rls'
    else 'inheritance_without_rls'
  end::text as branch,
  format('%I.%I', sc.nspname, sc.relname)::text as object,
  case
    when sc.relispartition then 'partition has row level security off'
    when sc.relnamespace in (select s.oid from scope_schema as s) then 'table has row level security off'
    else 'INHERITS child outside the in-scope schemas has row level security off'
  end::text as detail
from scope_class as sc
where sc.relkind in ('r', 'p')
  and not sc.relrowsecurity
union all
select
  'foreign_table_in_scope'::text,
  format('%I.%I', sc.nspname, sc.relname)::text,
  'foreign table in scope (foreign tables cannot have row level security)'::text
from scope_class as sc
where sc.relkind = 'f'
