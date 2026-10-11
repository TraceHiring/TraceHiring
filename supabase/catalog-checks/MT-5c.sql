-- MT-5c (spec specs/m0-foundations.md §8.5, rule 1, separate worker roles, build-notes Q12): a role, other than
-- the owner and superusers, that holds privileges on objects in both quality and integrity, or a non-superuser
-- member of pg_read_all_data or pg_write_all_data that is not on the Supabase list below.
-- ACL entries counted, from the quality and integrity schemas: relations (and every relation in an inheritance tree,
-- INHERITS or partitions, that has a member there, whatever schema it lives in), columns, functions, the schemas
-- themselves, and
-- per-schema default ACLs (pg_default_acl rows for those schemas). A null relacl, proacl or nspacl is read as
-- acldefault(), so a function with a null proacl gives EXECUTE to PUBLIC. Extension members are skipped by the
-- README rule. PUBLIC (grantee 0) is expanded to every role. Grantees are expanded recursively to their members
-- through pg_auth_members memberships with inherit or set. An entry naming the object's owner (for a default ACL,
-- defaclrole) is not counted, and the owner is never expanded to its members.
-- Branches: direct_grantee (the role is a grantee in both schemas, by name or as PUBLIC), role_membership (it
-- needs a membership for at least one schema), read_write_all_data (pg_read_all_data or pg_write_all_data:
-- any direct membership, then members with inherit or set, not expanded through postgres, the owner).
with recursive
-- Supabase roles that are members of pg_read_all_data or pg_write_all_data on the local stack
-- (day-one check, supabase/catalog-checks/README.md, 2026-10-11). Add a role only with that evidence.
supabase_data_role (rolname) as (
  values
    ('postgres'::name),
    ('supabase_etl_admin'::name),
    ('supabase_read_only_user'::name)
),
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
acl_entry (nspname, owner_oid, grantee) as (
  select sr.nspname, sr.relowner, a.grantee
  from scope_rel as sr
  cross join lateral aclexplode(
    coalesce(sr.relacl, acldefault(case when sr.relkind = 'S' then 's' else 'r' end::"char", sr.relowner))
  ) as a
  union
  select sr.nspname, sr.relowner, a.grantee
  from scope_rel as sr
  join pg_attribute as att on att.attrelid = sr.oid
  cross join lateral aclexplode(att.attacl) as a
  where att.attnum > 0
    and not att.attisdropped
    and att.attacl is not null
  union
  select t.nspname, p.proowner, a.grantee
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
  select t.nspname, n.nspowner, a.grantee
  from target as t
  join pg_namespace as n on n.oid = t.oid
  cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner))) as a
  union
  select t.nspname, da.defaclrole, a.grantee
  from pg_default_acl as da
  join target as t on t.oid = da.defaclnamespace
  cross join lateral aclexplode(da.defaclacl) as a
),
-- via: direct (named grantee), public (through PUBLIC) or member (through a role membership).
holder (role_oid, nspname, owner_oid, via) as (
  select e.grantee, e.nspname, e.owner_oid, 'direct'::text
  from acl_entry as e
  where e.grantee <> 0
    and e.grantee <> e.owner_oid
  union
  select r.oid, e.nspname, e.owner_oid, 'public'::text
  from acl_entry as e
  cross join pg_roles as r
  where e.grantee = 0
  union
  select m.member, h.nspname, h.owner_oid, 'member'::text
  from holder as h
  join pg_auth_members as m on m.roleid = h.role_oid
  where (m.inherit_option or m.set_option)
    and h.role_oid <> h.owner_oid
),
held as (
  select h.role_oid, h.nspname, h.via
  from holder as h
  join pg_roles as r on r.oid = h.role_oid
  where not r.rolsuper
    and h.role_oid <> h.owner_oid
),
both_schemas as (
  select
    hd.role_oid,
    count(distinct hd.nspname) filter (where hd.via <> 'member') = 2 as direct,
    count(distinct hd.nspname) filter (where hd.via = 'public') > 0 as through_public
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
  where (m.inherit_option or m.set_option)
    and dm.role_oid <> 'postgres'::regrole
)
select
  case when b.direct then 'direct_grantee' else 'role_membership' end::text as branch,
  pg_get_userbyid(b.role_oid)::text as object,
  (
    'role holds privileges in quality and integrity '
    || case when b.direct then 'as a grantee' else 'through role membership' end
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
