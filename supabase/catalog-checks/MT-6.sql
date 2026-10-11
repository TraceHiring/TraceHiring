-- MT-6 (spec specs/m0-foundations.md §8.5, rule 2): an enum with a label where lower(enumlabel) like '%reject%', if
-- the enum type is in schema integrity, or is used by a column of a relation (table, partitioned table, view,
-- materialized view or foreign table) in integrity. Column use is resolved recursively: directly, through an array
-- type (typelem of a true array), or through a domain (typbasetype, nested domains and domains over arrays too).
-- A use that passes through any domain is domain_column, else through an array is array_column, else
-- direct_column. unused_integrity_enum covers an integrity enum that no integrity column uses. Extension members in
-- their extension's own namespace are skipped.
with recursive integrity_column (relid, attname, typid, via_domain, via_array) as (
  select a.attrelid, a.attname, a.atttypid, false, false
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
    case when t.typtype = 'd' then t.typbasetype else t.typelem end,
    ic.via_domain or t.typtype = 'd',
    ic.via_array or t.typtype <> 'd'
  from integrity_column as ic
  join pg_type as t on t.oid = ic.typid
  where t.typtype = 'd'
    or (t.typelem <> 0 and t.typsubscript = 'array_subscript_handler'::regproc)
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
  select ic.relid, ic.attname, ic.via_domain, ic.via_array, re.oid as enum_oid, re.nspname, re.typname
  from integrity_column as ic
  join reject_enum as re on re.oid = ic.typid
)
select
  case
    when ru.via_domain then 'domain_column'
    when ru.via_array then 'array_column'
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
