-- MT-8 (spec specs/m0-foundations.md §8.5, rule 1 and tenancy): one of the reserved schemas private, quality and
-- integrity is missing or is not owned by postgres, anon or authenticated holds USAGE on one of them (directly,
-- through PUBLIC or through membership), or CREATE on schema public is held by PUBLIC (an ACL entry for grantee 0)
-- or by anon, authenticated or service_role (has_schema_privilege, so membership counts). The role names are
-- Supabase's fixed API roles, so a missing one fails the check loudly instead of passing it.
with reserved (nspname) as (
  values ('private'), ('quality'), ('integrity')
)
select
  'schema_missing'::text as branch,
  r.nspname::text as object,
  'reserved schema does not exist'::text as detail
from reserved as r
where not exists (
  select 1
  from pg_namespace as n
  where n.nspname = r.nspname
)
union all
select
  'schema_wrong_owner'::text,
  n.nspname::text,
  format('owned by %s, not postgres', pg_get_userbyid(n.nspowner))::text
from pg_namespace as n
join reserved as r on r.nspname = n.nspname
where pg_get_userbyid(n.nspowner) <> 'postgres'
union all
select
  'usage_granted'::text,
  n.nspname::text,
  format('%s holds USAGE', g.rolname)::text
from pg_namespace as n
join reserved as r on r.nspname = n.nspname
cross join (values ('anon'), ('authenticated')) as g (rolname)
where has_schema_privilege(g.rolname, n.oid, 'USAGE')
union all
select
  'public_create'::text,
  n.nspname::text,
  'PUBLIC holds CREATE'::text
from pg_namespace as n
cross join lateral aclexplode(n.nspacl) as a
where n.nspname = 'public'
  and a.grantee = 0
  and a.privilege_type = 'CREATE'
union all
select
  'public_create'::text,
  n.nspname::text,
  format('%s holds CREATE', g.rolname)::text
from pg_namespace as n
cross join (values ('anon'), ('authenticated'), ('service_role')) as g (rolname)
where n.nspname = 'public'
  and has_schema_privilege(g.rolname, n.oid, 'CREATE')
