-- MT-9 (spec specs/m0-foundations.md §8.5, default-ACL integrity, database review F2): wrong_owner is an in-scope
-- relation (any relkind, partitions and INHERITS descendants included) or function not owned by postgres.
-- extension_in_scope is an extension whose extnamespace is one of the four in-scope schemas. The hand-made branches
-- cover every system-list schema where postgres can create objects (has_schema_privilege, so membership counts:
-- locally extensions, _realtime, supabase_functions and supabase_migrations). There, a relation, function or type that
-- is not a member of any extension, is owned by postgres and is not on the list of Supabase's own objects below was
-- made by our own migrations: handmade_in_extensions in extensions, handmade_in_system_schema in the others. Types
-- skip relation row types (the relation is checked itself) and true array types (their element type is checked).
-- Same scope and extension-member skip as MT-1 for wrong_owner.
with recursive scope_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in ('public', 'private', 'quality', 'integrity')
),
scope_rel (oid) as (
  select c.oid
  from pg_class as c
  where c.relnamespace in (select s.oid from scope_schema as s)
  union
  select t.relid
  from pg_class as c
  cross join lateral pg_partition_tree(c.oid) as t
  where c.relkind = 'p'
    and c.relnamespace in (select s.oid from scope_schema as s)
  union
  select i.inhrelid
  from pg_inherits as i
  join scope_rel as r on r.oid = i.inhparent
),
writable_system_schema as (
  select n.oid, n.nspname
  from pg_namespace as n
  where n.nspname in (
    'pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'realtime', '_realtime',
    'graphql', 'graphql_public', 'supabase_functions', 'supabase_migrations', 'vault', 'pgsodium',
    'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics'
  )
    and has_schema_privilege('postgres', n.oid, 'CREATE')
),
supabase_object (kind, schema_name, object_name, owner_name) as (
  -- Supabase's own non-member objects in those schemas whose owner postgres is or can become (day-one check, local
  -- stack, 2026-10-11). A relation by relname (indexes and sequences too), a function by name and identity arguments.
  values
    ('relation'::text, 'supabase_migrations'::name, 'schema_migrations'::text, 'postgres'::name),
    ('relation', 'supabase_migrations', 'schema_migrations_pkey', 'postgres'),
    ('relation', 'supabase_migrations', 'seed_files', 'postgres'),
    ('relation', 'supabase_migrations', 'seed_files_pkey', 'postgres')
),
system_object as (
  select
    'relation'::text as kind,
    ws.nspname,
    c.relname::text as object_name,
    format('%I.%I', ws.nspname, c.relname) as qualified_name,
    format('relation (relkind %s)', c.relkind) as what,
    c.relowner as owner_oid
  from pg_class as c
  join writable_system_schema as ws on ws.oid = c.relnamespace
  where not exists (
    select 1
    from pg_depend as d
    where d.classid = 'pg_class'::regclass
      and d.objid = c.oid
      and d.refclassid = 'pg_extension'::regclass
      and d.deptype = 'e'
  )
  union all
  select
    'function'::text,
    ws.nspname,
    format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
    format('%I.%I(%s)', ws.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
    'function',
    p.proowner
  from pg_proc as p
  join writable_system_schema as ws on ws.oid = p.pronamespace
  where not exists (
    select 1
    from pg_depend as d
    where d.classid = 'pg_proc'::regclass
      and d.objid = p.oid
      and d.refclassid = 'pg_extension'::regclass
      and d.deptype = 'e'
  )
  union all
  select
    'type'::text,
    ws.nspname,
    t.typname::text,
    format('%I.%I', ws.nspname, t.typname),
    format('type (typtype %s)', t.typtype),
    t.typowner
  from pg_type as t
  join writable_system_schema as ws on ws.oid = t.typnamespace
  where t.typrelid = 0
    and not (t.typelem <> 0 and t.typsubscript = 'array_subscript_handler'::regproc)
    and not exists (
      select 1
      from pg_depend as d
      where d.classid = 'pg_type'::regclass
        and d.objid = t.oid
        and d.refclassid = 'pg_extension'::regclass
        and d.deptype = 'e'
    )
)
select
  'wrong_owner'::text as branch,
  format('%I.%I', n.nspname, c.relname)::text as object,
  format('relation (relkind %s) owned by %s, not postgres', c.relkind, pg_get_userbyid(c.relowner))::text as detail
from pg_class as c
join scope_rel as s on s.oid = c.oid
join pg_namespace as n on n.oid = c.relnamespace
where pg_get_userbyid(c.relowner) <> 'postgres'
  and not exists (
    select 1
    from pg_depend as d
    join pg_extension as e on e.oid = d.refobjid
    where d.classid = 'pg_class'::regclass
      and d.objid = c.oid
      and d.refclassid = 'pg_extension'::regclass
      and d.deptype = 'e'
      and e.extnamespace = c.relnamespace
  )
union all
select
  'wrong_owner'::text,
  format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))::text,
  format('function owned by %s, not postgres', pg_get_userbyid(p.proowner))::text
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where p.pronamespace in (select s.oid from scope_schema as s)
  and pg_get_userbyid(p.proowner) <> 'postgres'
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
union all
select
  'extension_in_scope'::text,
  e.extname::text,
  format('extension installed in schema %I, not extensions', n.nspname)::text
from pg_extension as e
join pg_namespace as n on n.oid = e.extnamespace
where e.extnamespace in (select s.oid from scope_schema as s)
union all
select
  case when so.nspname = 'extensions' then 'handmade_in_extensions' else 'handmade_in_system_schema' end::text,
  so.qualified_name::text,
  format('%s owned by postgres and not an extension member', so.what)::text
from system_object as so
where pg_get_userbyid(so.owner_oid) = 'postgres'
  and not exists (
    select 1
    from supabase_object as o
    where o.kind = so.kind
      and o.schema_name = so.nspname
      and o.object_name = so.object_name
      and o.owner_name = pg_get_userbyid(so.owner_oid)
  )
