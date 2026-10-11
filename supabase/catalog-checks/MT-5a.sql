-- MT-5a (spec specs/m0-foundations.md §8.5, rule 1): a view or materialized view, in any non-system schema,
-- whose recursive dependency closure reaches both quality and integrity. The closure follows each rule of a
-- relation (pg_rewrite.ev_class) to its pg_depend rows (classid pg_rewrite), skipping the rule's reference to
-- its own relation, and each function to its pg_depend rows, through pg_class and pg_proc refs and recursively
-- through other views and functions. UNION keeps the walk finite on cycles. A node reaches a schema when it
-- lives there (a relation also reaches the schema of every member of its partition tree), when it is a type
-- or schema ref there, or, for a function, when its prosrc names it (quality. or "quality". or 'quality' as a
-- format() argument, case-insensitive) or its proconfig search_path lists it.
-- Branches, first match wins: direct_join (the view and the relations it reads directly reach both),
-- nested_view (relations reached through other views, no function), via_function (a function is needed).
with recursive
target as (
  select n.oid, n.nspname::text as nspname
  from pg_namespace as n
  where n.nspname in ('quality', 'integrity')
),
rel_reach as (
  select c.oid, t.nspname
  from pg_class as c
  join target as t on t.oid = c.relnamespace
  union
  select tree.relid::oid, t.nspname
  from pg_class as p
  cross join lateral pg_partition_tree(p.oid) as tree
  cross join lateral pg_partition_tree(p.oid) as member
  join pg_class as mc on mc.oid = member.relid::oid
  join target as t on t.oid = mc.relnamespace
  where p.relkind = 'p'
    and not p.relispartition
),
edge as (
  select 'pg_class'::regclass::oid as classid, r.ev_class as objid, d.refclassid, d.refobjid
  from pg_rewrite as r
  join pg_depend as d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid
  where not (d.refclassid = 'pg_class'::regclass and d.refobjid = r.ev_class)
  union
  select d.classid, d.objid, d.refclassid, d.refobjid
  from pg_depend as d
  where d.classid = 'pg_proc'::regclass
),
node_edge as (
  select e.classid, e.objid, e.refclassid, e.refobjid
  from edge as e
  where e.refclassid in (
    'pg_class'::regclass, 'pg_proc'::regclass, 'pg_type'::regclass, 'pg_namespace'::regclass
  )
),
root as (
  select c.oid, n.nspname::text as nspname, c.relname::text as relname, c.relkind
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
  where c.relkind in ('v', 'm')
    and n.nspname not in (
      'pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'realtime', '_realtime',
      'graphql', 'graphql_public', 'supabase_functions', 'supabase_migrations', 'vault', 'pgsodium',
      'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics'
    )
    and n.nspname !~ '^pg_toast(_temp_[0-9]+)?$'
    and n.nspname !~ '^pg_temp_[0-9]+$'
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
-- lvl: 0 the view itself, 1 a direct ref, 2 reached through other relations only, 3 reached through a function.
closure (root_oid, classid, objid, lvl) as (
  select r.oid, 'pg_class'::regclass::oid, r.oid, 0
  from root as r
  union
  select cl.root_oid, e.refclassid, e.refobjid,
    case
      when cl.lvl = 3 or e.refclassid = 'pg_proc'::regclass then 3
      when cl.lvl = 0 then 1
      else 2
    end
  from closure as cl
  join node_edge as e on e.classid = cl.classid and e.objid = cl.objid
),
reach as (
  select cl.root_oid, cl.lvl, rr.nspname
  from closure as cl
  join rel_reach as rr on rr.oid = cl.objid
  where cl.classid = 'pg_class'::regclass
  union all
  select cl.root_oid, cl.lvl, t.nspname
  from closure as cl
  join pg_type as ty on ty.oid = cl.objid
  join target as t on t.oid = ty.typnamespace
  where cl.classid = 'pg_type'::regclass
  union all
  select cl.root_oid, cl.lvl, t.nspname
  from closure as cl
  join target as t on t.oid = cl.objid
  where cl.classid = 'pg_namespace'::regclass
  union all
  select cl.root_oid, cl.lvl, t.nspname
  from closure as cl
  join pg_proc as p on p.oid = cl.objid
  join pg_language as l on l.oid = p.prolang
  cross join target as t
  where cl.classid = 'pg_proc'::regclass
    and (
      p.pronamespace = t.oid
      or (
        l.lanname not in ('c', 'internal')
        and p.prosrc ~* (
          '(^|[^[:alnum:]_$])("' || t.nspname || '"|' || t.nspname || ')[[:space:]]*\.|''' || t.nspname || ''''
        )
      )
      or exists (
        select 1
        from unnest(p.proconfig) as cfg(setting)
        where cfg.setting ~* ('^search_path=(.*,)?[[:space:]]*"?' || t.nspname || '"?[[:space:]]*(,|$)')
      )
    )
),
violation as (
  select
    rc.root_oid,
    count(distinct rc.nspname) filter (where rc.lvl <= 1) = 2 as direct,
    count(distinct rc.nspname) filter (where rc.lvl <= 2) = 2 as nested
  from reach as rc
  group by rc.root_oid
  having count(distinct rc.nspname) = 2
)
select
  case
    when v.direct then 'direct_join'
    when v.nested then 'nested_view'
    else 'via_function'
  end::text as branch,
  format('%I.%I', r.nspname, r.relname)::text as object,
  (
    case when r.relkind = 'm' then 'materialized view' else 'view' end
    || ' reaches quality and integrity '
    || case
      when v.direct then 'through the relations it reads directly'
      when v.nested then 'through nested views'
      else 'through a function'
    end
  )::text as detail
from violation as v
join root as r on r.oid = v.root_oid
