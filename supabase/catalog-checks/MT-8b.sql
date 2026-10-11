-- MT-8b (spec specs/m0-foundations.md §8.5): a schema that is neither one of the four in-scope schemas nor on the
-- system list. Every other check scopes itself to public, private, quality and integrity, so this check stops an
-- object from escaping them by living in a new schema. Names starting with pg_ are reserved by PostgreSQL.
select
  'unknown_schema'::text as branch,
  n.nspname::text as object,
  'schema is neither in scope nor on the system list'::text as detail
from pg_namespace as n
where n.nspname not in ('public', 'private', 'quality', 'integrity')
  and n.nspname not in (
    'pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'realtime', '_realtime',
    'graphql', 'graphql_public', 'supabase_functions', 'supabase_migrations', 'vault', 'pgsodium',
    'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics'
  )
  and n.nspname !~ '^pg_toast(_temp_[0-9]+)?$'
  and n.nspname !~ '^pg_temp_[0-9]+$'
