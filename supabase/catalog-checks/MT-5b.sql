-- MT-5b (spec specs/m0-foundations.md §8.5, rule 1): a function (any prokind), in any non-system schema and not an
-- extension member, that reaches both quality and integrity by the MT-5a rule. plpgsql bodies are not in
-- pg_depend, so prosrc and proconfig are read as well. The closure starts at the function and follows its pg_depend
-- rows (classid pg_proc) through pg_class and pg_proc refs, recursively through the rules of views (pg_rewrite,
-- skipping a rule's reference to its own relation) and other functions, plus pg_type and pg_namespace refs. UNION
-- keeps the walk finite on cycles. A node reaches a schema when it lives there (a relation also reaches the schema
-- of every member of its partition tree), when it is a type or schema ref there, or, for a function, when its
-- prosrc names it (quality. or "quality". or 'quality' as a format() argument, case-insensitive) or its proconfig
-- search_path lists it.
-- Branches, first match wins: begin_atomic_depend (pg_depend alone reaches both, as for a BEGIN ATOMIC body),
-- prosrc_reference (a prosrc match is needed, no proconfig), proconfig_search_path (a proconfig match is needed).
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
  select
    p.oid,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))::text as qualified_name
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname not in (
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
      where d.classid = 'pg_proc'::regclass
        and d.objid = p.oid
        and d.refclassid = 'pg_extension'::regclass
        and d.deptype = 'e'
        and x.extnamespace = p.pronamespace
    )
),
closure (root_oid, classid, objid) as (
  select r.oid, 'pg_proc'::regclass::oid, r.oid
  from root as r
  union
  select cl.root_oid, e.refclassid, e.refobjid
  from closure as cl
  join node_edge as e on e.classid = cl.classid and e.objid = cl.objid
),
-- how: dep (the catalog alone), src (a prosrc match), cfg (a proconfig search_path match).
reach as (
  select cl.root_oid, 'dep'::text as how, rr.nspname
  from closure as cl
  join rel_reach as rr on rr.oid = cl.objid
  where cl.classid = 'pg_class'::regclass
  union all
  select cl.root_oid, 'dep'::text, t.nspname
  from closure as cl
  join pg_type as ty on ty.oid = cl.objid
  join target as t on t.oid = ty.typnamespace
  where cl.classid = 'pg_type'::regclass
  union all
  select cl.root_oid, 'dep'::text, t.nspname
  from closure as cl
  join target as t on t.oid = cl.objid
  where cl.classid = 'pg_namespace'::regclass
  union all
  select cl.root_oid, 'dep'::text, t.nspname
  from closure as cl
  join pg_proc as p on p.oid = cl.objid
  join target as t on t.oid = p.pronamespace
  where cl.classid = 'pg_proc'::regclass
  union all
  select cl.root_oid, 'src'::text, t.nspname
  from closure as cl
  join pg_proc as p on p.oid = cl.objid
  join pg_language as l on l.oid = p.prolang
  cross join target as t
  where cl.classid = 'pg_proc'::regclass
    and l.lanname not in ('c', 'internal')
    and p.prosrc ~* (
      '(^|[^[:alnum:]_$])("' || t.nspname || '"|' || t.nspname || ')[[:space:]]*\.|''' || t.nspname || ''''
    )
  union all
  select cl.root_oid, 'cfg'::text, t.nspname
  from closure as cl
  join pg_proc as p on p.oid = cl.objid
  cross join target as t
  where cl.classid = 'pg_proc'::regclass
    and exists (
      select 1
      from unnest(p.proconfig) as cfg(setting)
      where cfg.setting ~* ('^search_path=(.*,)?[[:space:]]*"?' || t.nspname || '"?[[:space:]]*(,|$)')
    )
),
violation as (
  select
    rc.root_oid,
    count(distinct rc.nspname) filter (where rc.how = 'dep') = 2 as by_depend,
    count(distinct rc.nspname) filter (where rc.how in ('dep', 'src')) = 2 as by_prosrc
  from reach as rc
  group by rc.root_oid
  having count(distinct rc.nspname) = 2
)
select
  case
    when v.by_depend then 'begin_atomic_depend'
    when v.by_prosrc then 'prosrc_reference'
    else 'proconfig_search_path'
  end::text as branch,
  r.qualified_name as object,
  (
    'function reaches quality and integrity '
    || case
      when v.by_depend then 'through pg_depend'
      when v.by_prosrc then 'through a schema named in a function body'
      else 'through a function search_path'
    end
  )::text as detail
from violation as v
join root as r on r.oid = v.root_oid
