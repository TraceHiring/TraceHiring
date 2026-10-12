-- MT-12 (spec specs/m0-foundations.md §8.5, default ACLs stay locked, on staging too): in pg_default_acl for
-- defaclrole postgres:
--   global_function_entry_missing: the global (defaclnamespace 0) function row is missing. PostgreSQL deletes the
--     row when it equals the built-in default, which includes EXECUTE for PUBLIC, so a missing row means new
--     functions are executable by PUBLIC again.
--   global_entry_grant: a global row, of any objtype, grants anything to PUBLIC (grantee 0), anon, authenticated
--     or service_role.
--   schema_entry_grant: a per-schema row for public, private, quality or integrity does the same.
-- One exception in both: USAGE on types (objtype T) to PUBLIC is PostgreSQL's built-in type default.
with entry as (
  select
    da.defaclnamespace,
    da.defaclobjtype,
    case da.defaclobjtype
      when 'r' then 'tables'
      when 'S' then 'sequences'
      when 'f' then 'functions'
      when 'T' then 'types'
      when 'n' then 'schemas'
      when 'L' then 'large objects'
      else da.defaclobjtype::text
    end as objtype_name,
    a.grantee,
    a.privilege_type
  from pg_default_acl as da
  cross join lateral aclexplode(da.defaclacl) as a
  where da.defaclrole = 'postgres'::regrole
),
granted as (
  select
    e.defaclnamespace,
    e.objtype_name,
    case when e.grantee = 0 then 'PUBLIC' else pg_get_userbyid(e.grantee)::text end as grantee_name,
    e.privilege_type
  from entry as e
  where (e.grantee = 0 or pg_get_userbyid(e.grantee) in ('anon', 'authenticated', 'service_role'))
    and not (e.defaclobjtype = 'T' and e.grantee = 0 and e.privilege_type = 'USAGE')
)
select
  'global_function_entry_missing'::text as branch,
  'postgres'::text as object,
  'no global default ACL row for functions, so new functions get EXECUTE for PUBLIC'::text as detail
where not exists (
  select 1
  from pg_default_acl as da
  where da.defaclrole = 'postgres'::regrole
    and da.defaclnamespace = 0
    and da.defaclobjtype = 'f'
)
union all
select
  'global_entry_grant'::text,
  format('global default ACL of postgres on %s', g.objtype_name)::text,
  format('grants %s to %s', g.privilege_type, g.grantee_name)::text
from granted as g
where g.defaclnamespace = 0
union all
select
  'schema_entry_grant'::text,
  format('default ACL of postgres in schema %I on %s', n.nspname, g.objtype_name)::text,
  format('grants %s to %s', g.privilege_type, g.grantee_name)::text
from granted as g
join pg_namespace as n on n.oid = g.defaclnamespace
where n.nspname in ('public', 'private', 'quality', 'integrity')
