-- MT-5d (spec specs/m0-foundations.md §8.5, rule 1): a link between quality and integrity that is not a view or
-- a function. A relation reaches a schema when it lives there, and also reaches the schema of every member of every
-- inheritance tree it belongs to (INHERITS children and partitions alike, wherever they live). Branches:
--   foreign_key: a foreign key (pg_constraint contype f) whose table reaches one of the two schemas and whose
--     referenced table reaches the other.
--   trigger_function: a trigger (not internal, so not the foreign-key triggers) on a table that reaches one schema,
--     whose pg_depend rows (skipping the reference to its own table) reach the other by the MT-5a rule without a
--     call named in a function body.
--   policy_expression: a policy (pg_depend classid pg_policy, skipping the reference to its own table) on a table
--     that reaches one schema, whose expressions reach the other by the MT-5a rule.
--   inheritance_link: an inheritance tree (INHERITS or partitions) with members in both schemas, reported at its
--     root, so a scan of one schema's table returns the other schema's rows.
--   table_rule: any rewrite rule other than a view's _RETURN rule on an in-scope relation (scope_rel below). A rule
--     runs with the table owner's rights, so it can link the two schemas and bypass RLS. Trace never needs one.
--   trigger_call_chain: as trigger_function, but the other schema is reached only through a call named in a
--     function body (schema.name(, or an unqualified name( resolved through the caller's search_path setting).
--   column_default: a column default or generated column (pg_attrdef) on a table that reaches one schema, whose
--     expression reaches the other.
--   check_constraint: a CHECK constraint (pg_constraint contype c) on such a table whose expression reaches the
--     other.
--   index_expression: an index with expressions or a predicate on such a table that reaches the other.
--   column_domain: a column of such a table typed by a domain (or an array of one) whose default or CHECK
--     constraints reach the other.
-- The MT-5a rule is the closure in shared:graph and shared:closure below (the same text in MT-5a, 5b, 5c and 5d).
-- Extension members are not skipped here: an extension installed in quality or integrity is already an MT-9
-- violation.
with recursive
-- shared:graph begin (the same text in MT-5a, MT-5b, MT-5c and MT-5d)
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
-- caller: a function in any language but c and internal, with its lowercased body and the schemas its search_path
-- setting lists (public and extensions, the database default, when it has none).
caller as materialized (
  select f.oid, f.prosrc, lower(f.prosrc) as lsrc, sp.path
  from pg_proc as f
  join pg_language as l on l.oid = f.prolang
  cross join lateral (
    select coalesce(array_agg(btrim(s.part, ' "')), array['public', 'extensions']) as path
    from unnest(f.proconfig) as cfg(setting)
    cross join lateral regexp_split_to_table(substr(cfg.setting, 13), ',') as s(part)
    where left(cfg.setting, 12) = 'search_path='
  ) as sp
  where l.lanname not in ('c', 'internal')
),
-- callee: a function outside pg_catalog and information_schema, its schema and name escaped for a regex.
callee as materialized (
  select
    g.oid,
    lower(g.proname) as lname,
    n.nspname::text as nspname,
    regexp_replace(n.nspname, '([^[:alnum:]_])', '\\\1', 'g') as nsp,
    regexp_replace(g.proname, '([^[:alnum:]_])', '\\\1', 'g') as fn
  from pg_proc as g
  join pg_namespace as n on n.oid = g.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
),
-- code_edge: one step of the walk, from (classid, objid) to (refclassid, refobjid). bit tags the kind of step:
-- 1 into an operator (node_edge), 4 out of a domain or array type, 8 a call named in a function body, 0 any other.
-- A cast in an expression is recorded in pg_depend as its cast function, so casts need no step of their own.
code_edge (classid, objid, refclassid, refobjid, bit) as (
  -- the rules of a relation (a view body or a table rule), skipping a rule's reference to its own relation
  select 'pg_class'::regclass::oid, r.ev_class, d.refclassid, d.refobjid, 0
  from pg_rewrite as r
  join pg_depend as d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid
  where not (d.refclassid = 'pg_class'::regclass and d.refobjid = r.ev_class)
  union
  -- the pg_depend rows of a function (all of a BEGIN ATOMIC body, only the signature of any other) and of an
  -- operator (its oprcode)
  select d.classid, d.objid, d.refclassid, d.refobjid, 0
  from pg_depend as d
  where d.classid in ('pg_proc'::regclass, 'pg_operator'::regclass)
  union
  -- a CHECK constraint of a table or a domain, skipping its reference to its own table
  select 'pg_constraint'::regclass::oid, con.oid, d.refclassid, d.refobjid, 0
  from pg_constraint as con
  join pg_depend as d on d.classid = 'pg_constraint'::regclass and d.objid = con.oid
  where con.contype = 'c'
    and not (d.refclassid = 'pg_class'::regclass and d.refobjid = con.conrelid)
  union
  -- a column default or generated column, skipping its reference to its own table
  select 'pg_attrdef'::regclass::oid, ad.oid, d.refclassid, d.refobjid, 0
  from pg_attrdef as ad
  join pg_depend as d on d.classid = 'pg_attrdef'::regclass and d.objid = ad.oid
  where not (d.refclassid = 'pg_class'::regclass and d.refobjid = ad.adrelid)
  union
  -- an index with expressions or a predicate, skipping its reference to its own table
  select 'pg_class'::regclass::oid, ix.indexrelid, d.refclassid, d.refobjid, 0
  from pg_index as ix
  join pg_depend as d on d.classid = 'pg_class'::regclass and d.objid = ix.indexrelid
  where (ix.indexprs is not null or ix.indpred is not null)
    and not (d.refclassid = 'pg_class'::regclass and d.refobjid = ix.indrelid)
  union
  -- a domain: its pg_depend rows (such as a default expression) and its CHECK constraints
  select 'pg_type'::regclass::oid, ty.oid, d.refclassid, d.refobjid, 4
  from pg_type as ty
  join pg_depend as d on d.classid = 'pg_type'::regclass and d.objid = ty.oid
  where ty.typtype = 'd'
  union
  select 'pg_type'::regclass::oid, con.contypid, 'pg_constraint'::regclass::oid, con.oid, 4
  from pg_constraint as con
  where con.contypid <> 0
    and con.contype = 'c'
  union
  -- an array type: its element type, so an array of a domain reaches the domain
  select 'pg_type'::regclass::oid, ty.oid, 'pg_type'::regclass::oid, ty.typelem, 4
  from pg_type as ty
  where ty.typelem <> 0
    and ty.typsubscript = 'array_subscript_handler'::regproc
  union
  -- a trigger, skipping its reference to its own table
  select 'pg_trigger'::regclass::oid, tg.oid, d.refclassid, d.refobjid, 0
  from pg_trigger as tg
  join pg_depend as d on d.classid = 'pg_trigger'::regclass and d.objid = tg.oid
  where not (d.refclassid = 'pg_class'::regclass and d.refobjid = tg.tgrelid)
  union
  -- a policy, skipping its reference to its own table
  select 'pg_policy'::regclass::oid, pol.oid, d.refclassid, d.refobjid, 0
  from pg_policy as pol
  join pg_depend as d on d.classid = 'pg_policy'::regclass and d.objid = pol.oid
  where not (d.refclassid = 'pg_class'::regclass and d.refobjid = pol.polrelid)
  union
  -- a call named in a caller's body: schema.name( for any schema, or an unqualified name( when the callee's schema
  -- is on the caller's search_path. Every overload of the name counts.
  select 'pg_proc'::regclass::oid, f.oid, 'pg_proc'::regclass::oid, g.oid, 8
  from caller as f
  join callee as g on position(g.lname in f.lsrc) > 0
  where f.prosrc ~* (
      '(^|[^[:alnum:]_$."])"?' || g.nsp || '"?[[:space:]]*\.[[:space:]]*"?' || g.fn || '"?[[:space:]]*\('
    )
    or (
      g.nspname = any(f.path)
      and f.prosrc ~* ('(^|[^[:alnum:]_$."])"?' || g.fn || '"?[[:space:]]*\(')
    )
),
-- materialized: computed once, not once per step of the recursive walk
node_edge as materialized (
  select
    e.classid,
    e.objid,
    e.refclassid,
    e.refobjid,
    e.bit | case when e.refclassid = 'pg_operator'::regclass then 1 else 0 end as bit
  from code_edge as e
  where e.refclassid in (
    'pg_class'::regclass, 'pg_proc'::regclass, 'pg_type'::regclass, 'pg_namespace'::regclass,
    'pg_operator'::regclass, 'pg_constraint'::regclass
  )
),
-- shared:graph end
-- shared:escape begin (the same text in MT-5a, MT-5b, MT-5d, MT-10 and MT-11)
-- escape_schema: system-list schemas where a migration can still create objects (spec §8.5 revision 12): postgres
-- can SET ROLE to the schema owner, or to a role with CREATE on it. Locally: extensions, _realtime,
-- supabase_functions and supabase_migrations, plus any listed schema that a migration creates (cron, net and so on).
escape_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in (
      'auth', 'storage', 'extensions', 'realtime', '_realtime', 'graphql', 'graphql_public', 'supabase_functions',
      'supabase_migrations', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics'
    )
    and (
      pg_has_role('postgres', n.nspowner, 'SET')
      or exists (
        select 1
        from pg_roles as r
        where pg_has_role('postgres', r.oid, 'SET')
          and has_schema_privilege(r.oid, n.oid, 'CREATE')
      )
    )
),
-- shared:escape end
-- scope_rel: the in-scope relations. Every relation in public, private, quality and integrity, every relation in an
-- escape_schema whose owner postgres can SET ROLE to, every pg_inherits descendant of those, wherever it lives, and
-- every relation that reaches quality or integrity (rel_reach).
scope_rel (oid) as (
  select c.oid
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private', 'quality', 'integrity')
  union
  select c.oid
  from pg_class as c
  where c.relnamespace in (select es.oid from escape_schema as es)
    and pg_has_role('postgres', c.relowner, 'SET')
  union
  select rr.oid
  from rel_reach as rr
  union
  select i.inhrelid
  from scope_rel as s
  join pg_inherits as i on i.inhparent = s.oid
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
-- host: code attached to a table, walked from the host itself (its edges are in code_edge). kind names the branch.
host (classid, oid, relid, name, kind) as (
  select 'pg_trigger'::regclass::oid, tg.oid, tg.tgrelid, format('%I', tg.tgname), 'trigger'::text
  from pg_trigger as tg
  where not tg.tgisinternal
    and tg.tgrelid in (select rr.oid from rel_reach as rr)
  union all
  select 'pg_policy'::regclass::oid, pol.oid, pol.polrelid, format('%I', pol.polname), 'policy'::text
  from pg_policy as pol
  where pol.polrelid in (select rr.oid from rel_reach as rr)
  union all
  select 'pg_attrdef'::regclass::oid, ad.oid, ad.adrelid, format('default of %I', a.attname), 'default'::text
  from pg_attrdef as ad
  join pg_attribute as a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
  where ad.adrelid in (select rr.oid from rel_reach as rr)
  union all
  select 'pg_constraint'::regclass::oid, con.oid, con.conrelid, format('%I', con.conname), 'check'::text
  from pg_constraint as con
  where con.contype = 'c'
    and con.conrelid in (select rr.oid from rel_reach as rr)
  union all
  select 'pg_class'::regclass::oid, ix.indexrelid, ix.indrelid, format('index %I', ic.relname), 'index'::text
  from pg_index as ix
  join pg_class as ic on ic.oid = ix.indexrelid
  where (ix.indexprs is not null or ix.indpred is not null)
    and ix.indrelid in (select rr.oid from rel_reach as rr)
  union all
  select 'pg_type'::regclass::oid, a.atttypid, a.attrelid, format('column %I', a.attname), 'domain'::text
  from pg_attribute as a
  join pg_type as ty on ty.oid = a.atttypid
  left join pg_type as el on el.oid = ty.typelem
  where a.attnum > 0
    and not a.attisdropped
    and (ty.typtype = 'd' or el.typtype = 'd')
    and a.attrelid in (select rr.oid from rel_reach as rr)
),
seed (classid, oid) as (
  select distinct h.classid, h.oid
  from host as h
),
-- shared:closure begin (the same text in MT-5a, MT-5b, MT-5c and MT-5d)
-- closure: the walk from each seed (defined by the check). lvl: 0 the seed, 1 a direct reference of the seed, 2
-- reached through other relations or types only, 3 reached through a function. mask ORs the bits of the steps
-- taken. UNION keeps the walk finite on cycles.
closure (seed_classid, seed_oid, classid, objid, lvl, mask) as (
  select s.classid, s.oid, s.classid, s.oid, 0, 0
  from seed as s
  union
  select
    cl.seed_classid,
    cl.seed_oid,
    e.refclassid,
    e.refobjid,
    case
      when cl.lvl = 3 or e.refclassid = 'pg_proc'::regclass then 3
      when cl.lvl = 0 then 1
      else 2
    end,
    cl.mask | e.bit
  from closure as cl
  join node_edge as e on e.classid = cl.classid and e.objid = cl.objid
),
-- reach: a node of the walk reaches a target schema. how: dep when the node lives there (a relation through its
-- inheritance trees too) or is a type, schema or function there, src when a function body names the schema
-- (quality. or "quality". or 'quality' as a format() argument, case-insensitive), cfg when a function's
-- search_path setting lists it.
reach (seed_classid, seed_oid, nspname, lvl, mask, how) as (
  select cl.seed_classid, cl.seed_oid, rr.nspname, cl.lvl, cl.mask, 'dep'::text
  from closure as cl
  join rel_reach as rr on rr.oid = cl.objid
  where cl.classid = 'pg_class'::regclass
  union all
  select cl.seed_classid, cl.seed_oid, t.nspname, cl.lvl, cl.mask, 'dep'::text
  from closure as cl
  join pg_type as ty on ty.oid = cl.objid
  join target as t on t.oid = ty.typnamespace
  where cl.classid = 'pg_type'::regclass
  union all
  select cl.seed_classid, cl.seed_oid, t.nspname, cl.lvl, cl.mask, 'dep'::text
  from closure as cl
  join target as t on t.oid = cl.objid
  where cl.classid = 'pg_namespace'::regclass
  union all
  select cl.seed_classid, cl.seed_oid, t.nspname, cl.lvl, cl.mask, 'dep'::text
  from closure as cl
  join pg_proc as p on p.oid = cl.objid
  join target as t on t.oid = p.pronamespace
  where cl.classid = 'pg_proc'::regclass
  union all
  select cl.seed_classid, cl.seed_oid, t.nspname, cl.lvl, cl.mask, 'src'::text
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
  select cl.seed_classid, cl.seed_oid, t.nspname, cl.lvl, cl.mask, 'cfg'::text
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
-- shared:closure end
crossing as (
  select
    h.kind,
    h.relid,
    h.name,
    hr.nspname as host_nspname,
    rc.nspname as other_nspname,
    bool_or(rc.mask & 8 = 0) as without_call
  from host as h
  join rel_reach as hr on hr.oid = h.relid
  join reach as rc on rc.seed_classid = h.classid and rc.seed_oid = h.oid
  where rc.nspname <> hr.nspname
  group by h.kind, h.classid, h.oid, h.relid, h.name, hr.nspname, rc.nspname
)
select
  'foreign_key'::text as branch,
  fk.object,
  fk.detail
from foreign_key as fk
union all
select
  case x.kind
    when 'trigger' then case when x.without_call then 'trigger_function' else 'trigger_call_chain' end
    when 'policy' then 'policy_expression'
    when 'default' then 'column_default'
    when 'check' then 'check_constraint'
    when 'index' then 'index_expression'
    else 'column_domain'
  end::text,
  format('%s on %I.%I', x.name, n.nspname, c.relname)::text,
  format(
    '%s on a table of schema %s reaches %s%s',
    case x.kind
      when 'default' then 'column default'
      when 'check' then 'CHECK constraint'
      when 'domain' then 'column domain'
      else x.kind
    end,
    x.host_nspname,
    x.other_nspname,
    case when x.without_call then '' else ' through a call named in a function body' end
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
union all
select
  'table_rule'::text,
  format('%I on %I.%I', r.rulename, n.nspname, c.relname)::text,
  'rewrite rule on an in-scope relation (Trace never needs table rules)'::text
from pg_rewrite as r
join pg_class as c on c.oid = r.ev_class
join pg_namespace as n on n.oid = c.relnamespace
where r.rulename <> '_RETURN'
  and r.ev_class in (select s.oid from scope_rel as s)
