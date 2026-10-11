-- MT-8b (spec specs/m0-foundations.md §8.5): unknown_schema is a schema that is neither one of the four in-scope
-- schemas nor on the system list. Every other check scopes itself to public, private, quality and integrity, so this
-- stops an object from escaping them by living in a new schema. Names starting with pg_ are reserved by PostgreSQL.
-- system_schema_owner is a system-list schema whose owner is not the one recorded on day one (local stack,
-- 2026-10-11): postgres for extensions, _realtime and supabase_migrations, pgbouncer for pgbouncer, and
-- supabase_admin for every other name, including cron, net, pgsodium, pgsodium_masks and _analytics, which do not
-- exist locally. A migration that creates one of those (owned by postgres) is caught. PostgreSQL creates the
-- pg_toast and pg_temp schemas owned by the bootstrap superuser, supabase_admin.
with system_schema (nspname, owner_name) as (
  values
    ('pg_catalog'::name, 'supabase_admin'::name),
    ('information_schema', 'supabase_admin'),
    ('auth', 'supabase_admin'),
    ('storage', 'supabase_admin'),
    ('extensions', 'postgres'),
    ('realtime', 'supabase_admin'),
    ('_realtime', 'postgres'),
    ('graphql', 'supabase_admin'),
    ('graphql_public', 'supabase_admin'),
    ('supabase_functions', 'supabase_admin'),
    ('supabase_migrations', 'postgres'),
    ('vault', 'supabase_admin'),
    ('pgsodium', 'supabase_admin'),
    ('pgsodium_masks', 'supabase_admin'),
    ('net', 'supabase_admin'),
    ('cron', 'supabase_admin'),
    ('pgbouncer', 'pgbouncer'),
    ('_analytics', 'supabase_admin')
),
server_schema as (
  select n.oid, n.nspname, n.nspowner
  from pg_namespace as n
  where n.nspname ~ '^pg_toast(_temp_[0-9]+)?$'
    or n.nspname ~ '^pg_temp_[0-9]+$'
)
select
  'unknown_schema'::text as branch,
  n.nspname::text as object,
  'schema is neither in scope nor on the system list'::text as detail
from pg_namespace as n
where n.nspname not in ('public', 'private', 'quality', 'integrity')
  and n.nspname not in (select s.nspname from system_schema as s)
  and n.oid not in (select v.oid from server_schema as v)
union all
select
  'system_schema_owner'::text,
  n.nspname::text,
  format('system schema owned by %s, not %s', pg_get_userbyid(n.nspowner), s.owner_name)::text
from pg_namespace as n
join system_schema as s on s.nspname = n.nspname
where pg_get_userbyid(n.nspowner) <> s.owner_name
union all
select
  'system_schema_owner'::text,
  v.nspname::text,
  format('server schema owned by %s, not supabase_admin', pg_get_userbyid(v.nspowner))::text
from server_schema as v
where pg_get_userbyid(v.nspowner) <> 'supabase_admin'
