-- MT-7 (spec specs/m0-foundations.md §8.5, database-reviewer standard): missing_search_path is a SECURITY DEFINER
-- function in scope whose proconfig does not contain exactly search_path="" (what set search_path = '' stores).
-- outside_private is a SECURITY DEFINER function in public, quality or integrity, because SECURITY DEFINER helpers
-- live only in private (functions in public are callable as PostgREST RPCs). Scope for both: functions in the four
-- schemas, every prokind, skipping extension members in their extension's own namespace. definer_in_system_schema
-- is a SECURITY DEFINER function in any other schema that is not a member of any extension, is not owned by one of
-- the Supabase service roles below and is not on the list of Supabase's own objects below (the same lists as MT-9).
-- body_search_path is a function in scope (same scope as the first two, SECURITY DEFINER or not) whose body changes
-- the search path: SET [LOCAL|SESSION] search_path, or a call of set_config('search_path', ...), case-insensitive.
-- After it an unqualified table name can mean a quality table without any schema name in the text, which no MT-5
-- reach rule can see (rule 1). The body is read without SQL comments, by the same single pass as caller in MT-5a to
-- 5d: a quoted literal is kept, so execute 'set local search_path = ...' counts and so does a message that spells
-- it out, but a comment that mentions it does not. c and internal functions have a symbol in prosrc, not a body, and
-- are skipped. An UPDATE that sets a column called search_path matches too: rename the column.
with scope_function as (
  select
    p.oid,
    p.prosecdef,
    p.proconfig,
    n.nspname,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as qualified_name,
    case
      when l.lanname in ('c', 'internal') then ''
      else regexp_replace(
        p.prosrc,
        '(''(?:[^'']|'''')*''|"(?:[^"]|"")*")|--[^\n]*|/\*(?:[^*]|\*+[^*/])*\*+/',
        '\1 ',
        'g'
      )
    end as src
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  join pg_language as l on l.oid = p.prolang
  where n.nspname in ('public', 'private', 'quality', 'integrity')
    and not exists (
      select 1
      from pg_depend as d
      join pg_extension as e on e.oid = d.refobjid
      where d.classid = 'pg_proc'::regclass
        and d.objid = p.oid
        and d.refclassid = 'pg_extension'::regclass
        and d.deptype = 'e'
        and e.extnamespace = p.pronamespace
    )
),
supabase_owner as (
  -- Supabase service roles that own Supabase's own objects. postgres is not a member of any of them and cannot be
  -- granted one (supautils.reserved_memberships), so no migration can create an object they own. A listed role that
  -- postgres is a member of is not trusted, and a role that does not exist is ignored.
  select r.oid
  from pg_roles as r
  where r.rolname in (
    'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin', 'supabase_realtime_admin',
    'supabase_replication_admin', 'supabase_etl_admin', 'supabase_read_only_user', 'dashboard_user', 'pgbouncer'
  )
    and not pg_has_role('postgres', r.oid, 'MEMBER')
),
supabase_object (kind, schema_name, object_name, owner_name) as (
  -- Supabase's own non-member objects whose owner postgres is or can become (postgres itself, and
  -- supabase_functions_admin, of which postgres is a member), from the day-one check on the local stack
  -- (2026-10-11). A relation by relname (indexes and sequences too), a function by name and identity arguments.
  values
    ('relation'::text, 'supabase_migrations'::name, 'schema_migrations'::text, 'postgres'::name),
    ('relation', 'supabase_migrations', 'schema_migrations_pkey', 'postgres'),
    ('relation', 'supabase_migrations', 'seed_files', 'postgres'),
    ('relation', 'supabase_migrations', 'seed_files_pkey', 'postgres'),
    ('relation', 'supabase_functions', 'hooks', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'hooks_pkey', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'hooks_id_seq', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'supabase_functions_hooks_h_table_id_h_name_idx', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'supabase_functions_hooks_request_id_idx', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'migrations', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'migrations_pkey', 'supabase_functions_admin'),
    ('function', 'supabase_functions', 'http_request()', 'supabase_functions_admin')
),
outside_definer as (
  select
    n.nspname,
    format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) as object_name,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as qualified_name,
    p.proowner
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname not in ('public', 'private', 'quality', 'integrity')
    and not exists (
      select 1
      from pg_depend as d
      where d.classid = 'pg_proc'::regclass
        and d.objid = p.oid
        and d.refclassid = 'pg_extension'::regclass
        and d.deptype = 'e'
    )
)
select
  'missing_search_path'::text as branch,
  sf.qualified_name::text as object,
  format('SECURITY DEFINER without search_path="" (proconfig %s)', coalesce(sf.proconfig::text, 'null'))::text
    as detail
from scope_function as sf
where sf.prosecdef
  and not ('search_path=""' = any(coalesce(sf.proconfig, '{}'::text[])))
union all
select
  'outside_private'::text,
  sf.qualified_name::text,
  format('SECURITY DEFINER function in schema %I, not private', sf.nspname)::text
from scope_function as sf
where sf.prosecdef
  and sf.nspname <> 'private'
union all
select
  'definer_in_system_schema'::text,
  od.qualified_name::text,
  format('SECURITY DEFINER function in schema %I owned by %s', od.nspname, pg_get_userbyid(od.proowner))::text
from outside_definer as od
where od.proowner not in (select sr.oid from supabase_owner as sr)
  and not exists (
    select 1
    from supabase_object as o
    where o.kind = 'function'
      and o.schema_name = od.nspname
      and o.object_name = od.object_name
      and o.owner_name = pg_get_userbyid(od.proowner)
  )
union all
select
  'body_search_path'::text,
  sf.qualified_name::text,
  'function body changes the search path (SET search_path or set_config)'::text
from scope_function as sf
where sf.src ~* '(^|[^[:alnum:]_$])set[[:space:]]+((local|session)[[:space:]]+)?"?search_path"?([^[:alnum:]_$"]|$)'
  or sf.src ~* '(^|[^[:alnum:]_$])set_config[[:space:]]*\([[:space:]]*''search_path'''
