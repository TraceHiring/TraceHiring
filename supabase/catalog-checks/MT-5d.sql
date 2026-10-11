-- MT-5d (spec specs/m0-foundations.md §8.5, rule 1): a link between quality and integrity that is not a view or
-- a function. A relation reaches a schema when it lives there, and also reaches the schema of every member of every
-- inheritance tree it belongs to (INHERITS children and partitions alike, wherever they live). Branches:
--   foreign_key: a foreign key (pg_constraint contype f) whose table reaches one of the two schemas and whose
--     referenced table reaches the other.
--   trigger_function: a trigger (not internal, so not the foreign-key triggers) on a table that reaches one schema,
--     whose pg_depend rows (skipping the reference to its own table) reach the other by the MT-5a rule.
--   policy_expression: a policy (pg_depend classid pg_policy, skipping the reference to its own table) on a table
--     that reaches one schema, whose expressions reach the other by the MT-5a rule.
--   inheritance_link: an inheritance tree (INHERITS or partitions) with members in both schemas, reported at its
--     root, so a scan of one schema's table returns the other schema's rows.
-- The MT-5a rule: a closure through pg_class and pg_proc refs, recursively through the rules of views (pg_rewrite,
-- skipping a rule's reference to its own relation) and functions, plus pg_type and pg_namespace refs. A node
-- reaches a schema when it lives there, when it is a type or schema ref there, or, for a function, when its prosrc
-- names it (quality. or "quality". or 'quality' as a format() argument, case-insensitive) or its proconfig
-- search_path lists it. Extension members are not skipped here: an extension installed in quality or integrity is
-- already an MT-9 violation.
with recursive
target as (
  select n.oid, n.nspname::text as nspname
  from pg_namespace as n
  where n.nspname in ('quality', 'integrity')
),
-- family: every inheritance tree (INHERITS children and partitions are both pg_inherits rows) as (root, member)
-- pairs, the root included. A relation under several parents is a member of each parent's tree.
family (root_oid, member_oid) as (
  select i.inhparent, i.inhparent
  from pg_inherits as i
  where not exists (select 1 from pg_inherits as up where up.inhrelid = i.inhparent)
  union
  select f.root_oid, i.inhrelid
  from family as f
  join pg_inherits as i on i.inhparent = f.member_oid
),
-- rel_reach: a relation reaches a target schema when it lives there, or when a member of an inheritance tree it
-- belongs to lives there, whatever schema the relation itself is in.
rel_reach as (
  select c.oid, t.nspname
  from pg_class as c
  join target as t on t.oid = c.relnamespace
  union
  select f.member_oid, t.nspname
  from family as f
  join family as g on g.root_oid = f.root_oid
  join pg_class as gc on gc.oid = g.member_oid
  join target as t on t.oid = gc.relnamespace
),
foreign_key as (
  select
    format('%I on %I.%I', con.conname, n.nspname, c.relname)::text as object,
    format('foreign key from %s to %s', src.nspname, ref.nspname)::text as detail
  from pg_constraint as con
  join pg_class as c on c.oid = con.conrelid
  join pg_namespace as n on n.oid = c.relnamespace
  join rel_reach as src on src.oid = con.conrelid
  join rel_reach as ref on ref.oid = con.confrelid
  where con.contype = 'f'
    and src.nspname <> ref.nspname
),
host as (
  select 'pg_trigger'::regclass::oid as classid, tg.oid, tg.tgrelid as relid, tg.tgname::text as name
  from pg_trigger as tg
  where not tg.tgisinternal
    and tg.tgrelid in (select rr.oid from rel_reach as rr)
  union all
  select 'pg_policy'::regclass::oid, pol.oid, pol.polrelid, pol.polname::text
  from pg_policy as pol
  where pol.polrelid in (select rr.oid from rel_reach as rr)
),
edge as (
  select h.classid, h.oid as objid, d.refclassid, d.refobjid
  from host as h
  join pg_depend as d on d.classid = h.classid and d.objid = h.oid
  where not (d.refclassid = 'pg_class'::regclass and d.refobjid = h.relid)
  union
  select 'pg_class'::regclass::oid, r.ev_class, d.refclassid, d.refobjid
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
closure (root_classid, root_oid, classid, objid) as (
  select h.classid, h.oid, h.classid, h.oid
  from host as h
  union
  select cl.root_classid, cl.root_oid, e.refclassid, e.refobjid
  from closure as cl
  join node_edge as e on e.classid = cl.classid and e.objid = cl.objid
),
reach as (
  select cl.root_classid, cl.root_oid, rr.nspname
  from closure as cl
  join rel_reach as rr on rr.oid = cl.objid
  where cl.classid = 'pg_class'::regclass
  union
  select cl.root_classid, cl.root_oid, t.nspname
  from closure as cl
  join pg_type as ty on ty.oid = cl.objid
  join target as t on t.oid = ty.typnamespace
  where cl.classid = 'pg_type'::regclass
  union
  select cl.root_classid, cl.root_oid, t.nspname
  from closure as cl
  join target as t on t.oid = cl.objid
  where cl.classid = 'pg_namespace'::regclass
  union
  select cl.root_classid, cl.root_oid, t.nspname
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
crossing as (
  select distinct h.classid, h.oid, h.relid, h.name, hr.nspname as host_nspname, rc.nspname as other_nspname
  from host as h
  join rel_reach as hr on hr.oid = h.relid
  join reach as rc on rc.root_classid = h.classid and rc.root_oid = h.oid
  where rc.nspname <> hr.nspname
)
select
  'foreign_key'::text as branch,
  fk.object,
  fk.detail
from foreign_key as fk
union all
select
  case when x.classid = 'pg_trigger'::regclass then 'trigger_function' else 'policy_expression' end::text,
  format('%I on %I.%I', x.name, n.nspname, c.relname)::text,
  format(
    '%s on a table of schema %s reaches %s',
    case when x.classid = 'pg_trigger'::regclass then 'trigger' else 'policy' end,
    x.host_nspname,
    x.other_nspname
  )::text
from crossing as x
join pg_class as c on c.oid = x.relid
join pg_namespace as n on n.oid = c.relnamespace
union all
select
  'inheritance_link'::text,
  format('%I.%I', n.nspname, c.relname)::text,
  'inheritance tree has members in quality and integrity'::text
from family as f
join pg_class as mc on mc.oid = f.member_oid
join target as t on t.oid = mc.relnamespace
join pg_class as c on c.oid = f.root_oid
join pg_namespace as n on n.oid = c.relnamespace
group by f.root_oid, n.nspname, c.relname
having count(distinct t.nspname) = 2
