-- MT-5c (spec specs/m0-foundations.md §8.5, rule 1, separate worker roles, build-notes Q12): a role, other than
-- the owner and superusers, that holds privileges on objects in both quality and integrity, or a non-superuser
-- member of pg_read_all_data or pg_write_all_data that is not on the Supabase list below.
-- ACL entries counted, from the quality and integrity schemas: relations (and every relation in an inheritance tree,
-- INHERITS or partitions, that has a member there, whatever schema it lives in), columns, functions, the schemas
-- themselves, and per-schema default ACLs (pg_default_acl rows for those schemas). A null relacl, proacl or nspacl
-- is read as acldefault(), so a function with a null proacl gives EXECUTE to PUBLIC. Extension members are skipped
-- by the README rule. Also counted: EXECUTE on a SECURITY DEFINER function anywhere (outside pg_catalog and
-- information_schema) holds every schema its MT-5a closure reaches (shared:graph and shared:closure below, the same
-- text in MT-5a, 5b, 5c and 5d), because the function reads with its owner's rights. Likewise any privilege on a
-- materialized view, or on a view without the literal security_invoker=true, outside quality and integrity (outside
-- pg_catalog and information_schema too), from its relacl (acldefault when null) and column ACLs, holds every schema
-- its closure reaches. PUBLIC (grantee 0) is expanded to every role. Grantees are expanded recursively to their members through pg_auth_members memberships with
-- inherit, set or ADMIN OPTION (an ADMIN-only member can grant itself inherit and set). An entry naming the object's
-- owner (for a default ACL, defaclrole) is not counted, and the owner is never expanded to its members.
-- Branches, first match wins for the two-schema rule: direct_grantee (the role is a grantee in both schemas, by
-- name or as PUBLIC), role_membership (it needs a membership with inherit or set for at least one schema),
-- admin_membership (it needs an ADMIN-only membership), definer_bridge (it needs EXECUTE on a SECURITY DEFINER
-- function for at least one schema), owner_rights_relation (it needs a privilege on a view or materialized view
-- that reads with its owner's rights). read_write_all_data (pg_read_all_data or pg_write_all_data: any direct
-- membership, then members with inherit, set or ADMIN OPTION, not expanded through postgres, the owner).
with recursive
-- Supabase roles that are members of pg_read_all_data or pg_write_all_data on the local stack
-- (day-one check, supabase/catalog-checks/README.md, 2026-10-11). Add a role only with that evidence.
supabase_data_role (rolname) as (
  values
    ('postgres'::name),
    ('supabase_etl_admin'::name),
    ('supabase_read_only_user'::name)
),
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
scope_rel as (
  select rr.nspname, c.oid, c.relkind, c.relowner, c.relacl
  from rel_reach as rr
  join pg_class as c on c.oid = rr.oid
  where not exists (
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
-- seed: the SECURITY DEFINER functions, and the materialized views and views without security_invoker=true outside
-- quality and integrity (all read with their owner's rights), walked by the shared closure.
seed (classid, oid) as (
  select 'pg_proc'::regclass::oid, p.oid
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname not in ('pg_catalog', 'information_schema')
  union all
  select 'pg_class'::regclass::oid, c.oid
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema', 'quality', 'integrity')
    and (
      c.relkind = 'm'
      or (c.relkind = 'v' and not ('security_invoker=true' = any(coalesce(c.reloptions, '{}'::text[]))))
    )
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
-- src: acl (an ACL entry of an object there), definer (EXECUTE on a SECURITY DEFINER function that reaches it) or
-- owner_rights (a privilege on a seeded view or materialized view that reaches it).
acl_entry (nspname, owner_oid, grantee, src) as (
  select sr.nspname, sr.relowner, a.grantee, 'acl'::text
  from scope_rel as sr
  cross join lateral aclexplode(
    coalesce(sr.relacl, acldefault(case when sr.relkind = 'S' then 's' else 'r' end::"char", sr.relowner))
  ) as a
  union
  select sr.nspname, sr.relowner, a.grantee, 'acl'::text
  from scope_rel as sr
  join pg_attribute as att on att.attrelid = sr.oid
  cross join lateral aclexplode(att.attacl) as a
  where att.attnum > 0
    and not att.attisdropped
    and att.attacl is not null
  union
  select t.nspname, p.proowner, a.grantee, 'acl'::text
  from pg_proc as p
  join target as t on t.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) as a
  where not exists (
    select 1
    from pg_depend as d
    join pg_extension as x on x.oid = d.refobjid
    where d.classid = 'pg_proc'::regclass
      and d.objid = p.oid
      and d.refclassid = 'pg_extension'::regclass
      and d.deptype = 'e'
      and x.extnamespace = p.pronamespace
  )
  union
  select t.nspname, n.nspowner, a.grantee, 'acl'::text
  from target as t
  join pg_namespace as n on n.oid = t.oid
  cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner))) as a
  union
  select t.nspname, da.defaclrole, a.grantee, 'acl'::text
  from pg_default_acl as da
  join target as t on t.oid = da.defaclnamespace
  cross join lateral aclexplode(da.defaclacl) as a
  union
  select rc.nspname, p.proowner, a.grantee, 'definer'::text
  from reach as rc
  join pg_proc as p on p.oid = rc.seed_oid
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) as a
  where rc.seed_classid = 'pg_proc'::regclass
    and a.privilege_type = 'EXECUTE'
  union
  select rs.nspname, c.relowner, a.grantee, 'owner_rights'::text
  from (select distinct rc.seed_oid, rc.nspname from reach as rc where rc.seed_classid = 'pg_class'::regclass) as rs
  join pg_class as c on c.oid = rs.seed_oid
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) as a
  union
  select rs.nspname, c.relowner, a.grantee, 'owner_rights'::text
  from (select distinct rc.seed_oid, rc.nspname from reach as rc where rc.seed_classid = 'pg_class'::regclass) as rs
  join pg_class as c on c.oid = rs.seed_oid
  join pg_attribute as att on att.attrelid = c.oid
  cross join lateral aclexplode(att.attacl) as a
  where att.attnum > 0
    and not att.attisdropped
    and att.attacl is not null
),
-- hop: 0 a named grantee or PUBLIC, 1 through role memberships with inherit or set, 2 through at least one
-- membership with ADMIN OPTION only (the member can grant itself inherit and set). pub: a grant to PUBLIC.
holder (role_oid, nspname, owner_oid, hop, pub, src) as (
  select e.grantee, e.nspname, e.owner_oid, 0, false, e.src
  from acl_entry as e
  where e.grantee <> 0
    and e.grantee <> e.owner_oid
  union
  select r.oid, e.nspname, e.owner_oid, 0, true, e.src
  from acl_entry as e
  cross join pg_roles as r
  where e.grantee = 0
  union
  select
    m.member,
    h.nspname,
    h.owner_oid,
    greatest(h.hop, case when m.inherit_option or m.set_option then 1 else 2 end),
    h.pub,
    h.src
  from holder as h
  join pg_auth_members as m on m.roleid = h.role_oid
  where (m.inherit_option or m.set_option or m.admin_option)
    and h.role_oid <> h.owner_oid
),
held as (
  select h.role_oid, h.nspname, h.hop, h.pub, h.src
  from holder as h
  join pg_roles as r on r.oid = h.role_oid
  where not r.rolsuper
    and h.role_oid <> h.owner_oid
),
both_schemas as (
  select
    hd.role_oid,
    count(distinct hd.nspname) filter (where hd.hop = 0 and hd.src = 'acl') = 2 as direct,
    count(distinct hd.nspname) filter (where hd.hop <= 1 and hd.src = 'acl') = 2 as by_membership,
    count(distinct hd.nspname) filter (where hd.src = 'acl') = 2 as by_acl,
    count(distinct hd.nspname) filter (where hd.src in ('acl', 'definer')) = 2 as by_definer,
    bool_or(hd.pub) as through_public
  from held as hd
  group by hd.role_oid
  having count(distinct hd.nspname) = 2
),
data_member (role_oid, data_role) as (
  select m.member, m.roleid
  from pg_auth_members as m
  where m.roleid in ('pg_read_all_data'::regrole, 'pg_write_all_data'::regrole)
  union
  select m.member, dm.data_role
  from data_member as dm
  join pg_auth_members as m on m.roleid = dm.role_oid
  where (m.inherit_option or m.set_option or m.admin_option)
    and dm.role_oid <> 'postgres'::regrole
)
select
  case
    when b.direct then 'direct_grantee'
    when b.by_membership then 'role_membership'
    when b.by_acl then 'admin_membership'
    when b.by_definer then 'definer_bridge'
    else 'owner_rights_relation'
  end::text as branch,
  pg_get_userbyid(b.role_oid)::text as object,
  (
    'role holds privileges in quality and integrity '
    || case
      when b.direct then 'as a grantee'
      when b.by_membership then 'through role membership'
      when b.by_acl then 'through a membership with ADMIN OPTION only'
      when b.by_definer then 'through EXECUTE on a SECURITY DEFINER function'
      else 'through a view or materialized view that reads with its owner''s rights'
    end
    || case when b.through_public then ' (counting grants to PUBLIC)' else '' end
  )::text as detail
from both_schemas as b
union all
select
  'read_write_all_data'::text,
  r.rolname::text,
  format('member of %s and not on the Supabase list', pg_get_userbyid(dm.data_role))::text
from data_member as dm
join pg_roles as r on r.oid = dm.role_oid
where not r.rolsuper
  and r.rolname not in (select s.rolname from supabase_data_role as s)
