-- MT-6 (spec specs/m0-foundations.md §8.5, rule 2): an enum with a label where lower(enumlabel) like '%reject%', if
-- the enum type is in schema integrity, or is used by a column of a relation (table, partitioned table, view,
-- materialized view or foreign table) in integrity. Column use is resolved recursively, through any mix of: an
-- array type (typelem of a true array), a domain (typbasetype), a composite type (the types of its attributes,
-- through typrelid), a range (pg_range.rngsubtype) or a multirange (its range, pg_range.rngmultitypid). A use that
-- passes through any domain is domain_column, else through an array array_column, else through a composite type
-- composite_column, else through a range or multirange range_column, else direct_column. The depth guard only stops
-- runaway recursion. unused_integrity_enum covers an integrity enum that no integrity column uses. Extension members
-- in their extension's own namespace are skipped.
with recursive integrity_column (relid, attname, typid, via_domain, via_array, via_composite, via_range, depth) as (
  select a.attrelid, a.attname, a.atttypid, false, false, false, false, 0
  from pg_attribute as a
  join pg_class as c on c.oid = a.attrelid
  join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'integrity'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and a.attnum > 0
    and not a.attisdropped
  union all
  select
    ic.relid,
    ic.attname,
    st.typid,
    ic.via_domain or st.step = 'domain',
    ic.via_array or st.step = 'array',
    ic.via_composite or st.step = 'composite',
    ic.via_range or st.step = 'range',
    ic.depth + 1
  from integrity_column as ic
  cross join lateral (
    select 'domain'::text as step, t.typbasetype as typid
    from pg_type as t
    where t.oid = ic.typid
      and t.typtype = 'd'
    union all
    select 'array'::text, t.typelem
    from pg_type as t
    where t.oid = ic.typid
      and t.typelem <> 0
      and t.typsubscript = 'array_subscript_handler'::regproc
    union all
    select 'composite'::text, a.atttypid
    from pg_type as t
    join pg_attribute as a on a.attrelid = t.typrelid
    where t.oid = ic.typid
      and t.typtype = 'c'
      and a.attnum > 0
      and not a.attisdropped
    union all
    select 'range'::text, r.rngsubtype
    from pg_range as r
    where r.rngtypid = ic.typid
    union all
    select 'range'::text, r.rngtypid
    from pg_range as r
    where r.rngmultitypid = ic.typid
  ) as st
  where ic.depth < 32
),
reject_enum as (
  select t.oid, n.nspname, t.typname
  from pg_type as t
  join pg_namespace as n on n.oid = t.typnamespace
  where t.typtype = 'e'
    and exists (
      select 1
      from pg_enum as e
      where e.enumtypid = t.oid
        and lower(e.enumlabel) like '%reject%'
    )
    and not exists (
      select 1
      from pg_depend as d
      join pg_extension as x on x.oid = d.refobjid
      where d.classid = 'pg_type'::regclass
        and d.objid = t.oid
        and d.refclassid = 'pg_extension'::regclass
        and d.deptype = 'e'
        and x.extnamespace = t.typnamespace
    )
),
reject_use as (
  select
    ic.relid,
    ic.attname,
    ic.via_domain,
    ic.via_array,
    ic.via_composite,
    ic.via_range,
    re.oid as enum_oid,
    re.nspname,
    re.typname
  from integrity_column as ic
  join reject_enum as re on re.oid = ic.typid
)
select
  case
    when ru.via_domain then 'domain_column'
    when ru.via_array then 'array_column'
    when ru.via_composite then 'composite_column'
    when ru.via_range then 'range_column'
    else 'direct_column'
  end::text as branch,
  format('%I.%I.%I', n.nspname, c.relname, ru.attname)::text as object,
  format('column uses enum %I.%I, which has a reject label', ru.nspname, ru.typname)::text as detail
from reject_use as ru
join pg_class as c on c.oid = ru.relid
join pg_namespace as n on n.oid = c.relnamespace
union all
select
  'unused_integrity_enum'::text,
  format('%I.%I', re.nspname, re.typname)::text,
  'enum in schema integrity has a reject label'::text
from reject_enum as re
where re.nspname = 'integrity'
  and not exists (
    select 1
    from reject_use as ru
    where ru.enum_oid = re.oid
  )
