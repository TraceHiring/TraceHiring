-- MT-3 (spec specs/m0-foundations.md §8.5, rules 2, 7 and 9): a column (attnum > 0, not dropped) of a table,
-- partitioned table, view, materialized view or foreign table in scope whose lower-cased name matches a banned
-- pattern (birth dates, honesty, trust or cheat scores, emotion, voiceprints, face templates, gaze flags). The
-- pattern reject applies only to relations in schema integrity, because quality-cutoff rejection and item review
-- are legitimate elsewhere. Same scope and skips as MT-1. Underscores are escaped with the default LIKE escape.
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
scope_column as (
  select n.nspname, c.relname, a.attname
  from pg_class as c
  join scope_rel as s on s.oid = c.oid
  join pg_namespace as n on n.oid = c.relnamespace
  join pg_attribute as a on a.attrelid = c.oid
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and a.attnum > 0
    and not a.attisdropped
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
banned (pattern) as (
  values
    ('%dob%'), ('%birth%'), ('%honesty%'), ('%trust\_score%'), ('%cheat%'), ('%emotion%'), ('%voiceprint%'),
    ('%face\_template%'), ('%gaze\_flag%')
)
select
  'banned_column'::text as branch,
  format('%I.%I.%I', sc.nspname, sc.relname, sc.attname)::text as object,
  format('column name matches the banned pattern %s', b.pattern)::text as detail
from scope_column as sc
join banned as b on lower(sc.attname) like b.pattern
union all
select
  'integrity_reject_column'::text,
  format('%I.%I.%I', sc.nspname, sc.relname, sc.attname)::text,
  'column name in schema integrity contains reject'::text
from scope_column as sc
where sc.nspname = 'integrity'
  and lower(sc.attname) like '%reject%'
