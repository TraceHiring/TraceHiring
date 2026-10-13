-- MT-2 (spec specs/m0-foundations.md §8.5, tenancy): a table (relkind r or p, partitions included) without a column
-- org_id that is uuid, not null and not dropped. Same scope (partitions and INHERITS descendants included) and skips
-- as MT-1. The three branches are independent: a column that is missing, of another type, or nullable. Tables on
-- the exemption list below are not checked. An entry exempts only the exact table it names, and only while its adr
-- starts with ADR-<number>. An entry that names no in-scope table is itself reported under missing_org_id (the
-- branch it exempts from), so a stale entry fails. org_id_not_indexed (M0b, M0a review DB-2, B0-DB6): no valid,
-- non-partial index on the table (or on its partitioned parent) has org_id as its first key column, so every
-- tenant-scoped scan is a full scan.
with recursive exemption (schema_name, table_name, adr) as (
  values
    -- One row per exempt table, each citing its ADR, e.g. ('public', 'countries', 'ADR-0NN reference data'),
    -- Empty in M0a. The null row below only types the columns and is ignored.
    (null::name, null::name, null::text)
),
scope_schema as (
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
scope_table as (
  select c.oid, n.nspname, c.relname
  from pg_class as c
  join scope_rel as s on s.oid = c.oid
  join pg_namespace as n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
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
),
listed_exemption as (
  select x.schema_name, x.table_name, x.adr
  from exemption as x
  where x.schema_name is not null
    or x.table_name is not null
),
valid_exemption as (
  select x.schema_name, x.table_name
  from listed_exemption as x
  where x.adr ~ '^ADR-[0-9]+'
),
checked_table as (
  select t.oid, t.nspname, t.relname
  from scope_table as t
  where not exists (
    select 1
    from valid_exemption as x
    where x.schema_name = t.nspname
      and x.table_name = t.relname
  )
),
org_id as (
  select t.nspname, t.relname, a.atttypid, a.atttypmod, a.attnotnull
  from checked_table as t
  join pg_attribute as a on a.attrelid = t.oid
  where a.attname = 'org_id'
    and a.attnum > 0
    and not a.attisdropped
)
select
  'missing_org_id'::text as branch,
  format('%I.%I', t.nspname, t.relname)::text as object,
  'table has no org_id column'::text as detail
from checked_table as t
where not exists (
  select 1
  from pg_attribute as a
  where a.attrelid = t.oid
    and a.attname = 'org_id'
    and a.attnum > 0
    and not a.attisdropped
)
union all
select
  'org_id_not_uuid'::text,
  format('%I.%I', o.nspname, o.relname)::text,
  format('org_id is %s, not uuid', format_type(o.atttypid, o.atttypmod))::text
from org_id as o
where o.atttypid <> 'uuid'::regtype
union all
select
  'org_id_nullable'::text,
  format('%I.%I', o.nspname, o.relname)::text,
  'org_id is nullable'::text
from org_id as o
where not o.attnotnull
union all
select
  'org_id_not_indexed'::text,
  format('%I.%I', o.nspname, o.relname)::text,
  'no valid, non-partial index on the table or its partitioned parent has org_id as its first key column'::text
from org_id as o
join checked_table as t on t.nspname = o.nspname and t.relname = o.relname
where not exists (
  select 1
  from pg_index as ix
  join pg_attribute as ia on ia.attrelid = ix.indrelid and ia.attnum = ix.indkey[0]
  where ix.indisvalid
    and ix.indpred is null
    and ia.attname = 'org_id'
    and (
      ix.indrelid = t.oid
      or ix.indrelid in (select i.inhparent from pg_inherits as i where i.inhrelid = t.oid)
    )
)
union all
select
  'missing_org_id'::text,
  format('%I.%I', x.schema_name, x.table_name)::text,
  'exemption list names a table that is not an in-scope table'::text
from listed_exemption as x
where not exists (
  select 1
  from scope_table as t
  where t.nspname = x.schema_name
    and t.relname = x.table_name
)
