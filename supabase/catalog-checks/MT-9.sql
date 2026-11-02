-- MT-9 (spec specs/m0-foundations.md §8.5, default-ACL integrity, database review F2): wrong_owner is an in-scope
-- relation (any relkind, partitions and INHERITS descendants included) or function not owned by postgres.
-- extension_in_scope is an extension whose extnamespace is one of the four in-scope schemas. The hand-made branches
-- cover every system-list schema where postgres can create objects (has_schema_privilege, so membership counts:
-- locally extensions, _realtime, supabase_functions and supabase_migrations). There, a relation, function or type that
-- is not a member of any extension, is not owned by one of the Supabase service roles below and is not on the list
-- of Supabase's own objects below was made by our own migrations: owned by postgres, it is handmade_in_extensions in
-- extensions and handmade_in_system_schema in the others, and owned by any other role (service_role, a role postgres
-- created or is a member of) it is handmade_nonadmin_owner. Types skip relation row types (the relation is checked
-- itself) and true array types (their element type is checked). Same scope and extension-member skip as MT-1 for
-- wrong_owner. extension_owner is an extension, in any schema, whose owner postgres is a member of (INHERIT, SET or
-- ADMIN): its owner can ALTER EXTENSION … ADD objects it owns, and every check skips extension members (the
-- hand-made branches skip any member). Supabase's extensions are owned by supabase_admin, but a trusted extension
-- that is not on the supautils privileged list (such as lo) is owned by postgres. Hosted Supabase pre-installs
-- pg_stat_statements, uuid-ossp and pgcrypto in extensions owned by postgres (staging, 2026-10-20), so
-- extension_owner skips exactly those three names when the schema and the owner match too (hosted_extension).
-- extension_added_member closes what that allows: a relation, function or type that is a member of any extension
-- and is not owned by a Supabase service role, unless it is a hosted_member (a member of a hosted extension whose
-- code postgres cannot have made or replaced: see that CTE). Their members may be owned by postgres on hosted Supabase
-- (the image's init scripts ran as postgres while it was a superuser), so they are told apart by what they are, not
-- by owner or name. extension_other_member is a member, of any other catalog (operators, casts, text search
-- objects, schemas …), of an extension postgres controls: no check reads those catalogs, so nothing may be added
-- there.
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
supabase_object (kind, schema_name, object_name, relkind, owner_name) as (
  -- Supabase's own non-member objects whose owner postgres is or can become (postgres itself, and
  -- supabase_functions_admin, of which postgres is a member), from the day-one check on the local stack
  -- (2026-10-11), plus the Supabase CLI's idempotency index seen on hosted Supabase (staging, 2026-10-20). A relation
  -- by relname and relkind (indexes and sequences too, so a table cannot take an index name), a function by name and
  -- identity arguments (relkind '').
  values
    ('relation'::text, 'supabase_migrations'::name, 'schema_migrations'::text, 'r'::text, 'postgres'::name),
    ('relation', 'supabase_migrations', 'schema_migrations_pkey', 'i', 'postgres'),
    ('relation', 'supabase_migrations', 'schema_migrations_idempotency_key_key', 'i', 'postgres'),
    ('relation', 'supabase_migrations', 'seed_files', 'r', 'postgres'),
    ('relation', 'supabase_migrations', 'seed_files_pkey', 'i', 'postgres'),
    ('relation', 'supabase_functions', 'hooks', 'r', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'hooks_pkey', 'i', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'hooks_id_seq', 'S', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'supabase_functions_hooks_h_table_id_h_name_idx', 'i', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'supabase_functions_hooks_request_id_idx', 'i', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'migrations', 'r', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'migrations_pkey', 'i', 'supabase_functions_admin'),
    ('function', 'supabase_functions', 'http_request()', '', 'supabase_functions_admin')
),
hosted_extension (extname, schema_name, owner_name) as (
  -- Extensions hosted Supabase pre-installs owned by postgres (staging catalog run, 2026-10-20). Names only, with
  -- the schema and the owner pinned. Any other extension postgres controls still fails extension_owner.
  values
    ('pg_stat_statements'::name, 'extensions'::name, 'postgres'::name),
    ('uuid-ossp', 'extensions', 'postgres'),
    ('pgcrypto', 'extensions', 'postgres')
),
hosted_extension_oid as (
  select e.oid, e.extname, e.extnamespace
  from pg_extension as e
  join pg_namespace as n on n.oid = e.extnamespace
  join hosted_extension as h
    on h.extname = e.extname
    and h.schema_name = n.nspname
    and h.owner_name = pg_get_userbyid(e.extowner)
),
hosted_view as (
  -- The two views pg_stat_statements creates. Every dependency of their rewrite rules must be the view itself or a
  -- function that is a member of the same extension, so a CREATE OR REPLACE VIEW that reads anything else is flagged.
  select c.oid
  from hosted_extension_oid as he
  join pg_depend as d
    on d.refobjid = he.oid
    and d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
    and d.deptype = 'e'
  join pg_class as c on c.oid = d.objid
  where he.extname = 'pg_stat_statements'
    and c.relnamespace = he.extnamespace
    and c.relkind = 'v'
    and c.relname in ('pg_stat_statements', 'pg_stat_statements_info')
    and not exists (
      select 1
      from pg_rewrite as r
      join pg_depend as rd on rd.classid = 'pg_rewrite'::regclass and rd.objid = r.oid
      where r.ev_class = c.oid
        and not (rd.refclassid = 'pg_class'::regclass and rd.refobjid = c.oid)
        and not (
          rd.refclassid = 'pg_proc'::regclass
          and exists (
            select 1
            from pg_depend as fd
            where fd.classid = 'pg_proc'::regclass
              and fd.objid = rd.refobjid
              and fd.refclassid = 'pg_extension'::regclass
              and fd.refobjid = he.oid
              and fd.deptype = 'e'
          )
        )
    )
),
hosted_member (classid, objid) as (
  -- Members of a hosted extension whose code postgres cannot have made or replaced, whoever owns them (the hosted members
  -- may be owned by postgres): a C function loaded from the extension's own library, without SECURITY DEFINER or SET
  -- (C is an untrusted language, so postgres can neither create nor replace one, and changing the language makes it a
  -- non-C function), in the extension's schema. Plus the two pg_stat_statements views above, their row types and the
  -- array types of those. Not pinned (re-review N-1, carried to D1 REVIEW): an owner may still RENAME such a function
  -- or change its volatility or strictness, which stays clean here. No Trace code calls them.
  select 'pg_proc'::regclass::oid, p.oid
  from hosted_extension_oid as he
  join pg_depend as d
    on d.refobjid = he.oid
    and d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_proc'::regclass
    and d.deptype = 'e'
  join pg_proc as p on p.oid = d.objid
  join pg_language as l on l.oid = p.prolang
  where p.pronamespace = he.extnamespace
    and l.lanname = 'c'
    and p.probin = '$libdir/' || he.extname
    and not p.prosecdef
    and p.proconfig is null
  union all
  select 'pg_class'::regclass::oid, hv.oid
  from hosted_view as hv
  union all
  select 'pg_type'::regclass::oid, t.oid
  from pg_type as t
  where t.typrelid in (select hv.oid from hosted_view as hv)
    or t.typelem in (
      select rt.oid
      from pg_type as rt
      where rt.typrelid in (select hv.oid from hosted_view as hv)
    )
),
extension_member as (
  select
    d.classid,
    d.objid,
    format('%I.%I', n.nspname, c.relname) as qualified_name,
    format('relation (relkind %s)', c.relkind) as what,
    e.extname,
    c.relowner as owner_oid
  from pg_depend as d
  join pg_extension as e on e.oid = d.refobjid
  join pg_class as c on c.oid = d.objid
  join pg_namespace as n on n.oid = c.relnamespace
  where d.classid = 'pg_class'::regclass
    and d.refclassid = 'pg_extension'::regclass
    and d.deptype = 'e'
  union all
  select
    d.classid,
    d.objid,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
    'function',
    e.extname,
    p.proowner
  from pg_depend as d
  join pg_extension as e on e.oid = d.refobjid
  join pg_proc as p on p.oid = d.objid
  join pg_namespace as n on n.oid = p.pronamespace
  where d.classid = 'pg_proc'::regclass
    and d.refclassid = 'pg_extension'::regclass
    and d.deptype = 'e'
  union all
  select
    d.classid,
    d.objid,
    format('%I.%I', n.nspname, t.typname),
    format('type (typtype %s)', t.typtype),
    e.extname,
    t.typowner
  from pg_depend as d
  join pg_extension as e on e.oid = d.refobjid
  join pg_type as t on t.oid = d.objid
  join pg_namespace as n on n.oid = t.typnamespace
  where d.classid = 'pg_type'::regclass
    and d.refclassid = 'pg_extension'::regclass
    and d.deptype = 'e'
),
system_object as (
  select
    'relation'::text as kind,
    ws.nspname,
    c.relname::text as object_name,
    format('%I.%I', ws.nspname, c.relname) as qualified_name,
    format('relation (relkind %s)', c.relkind) as what,
    c.relowner as owner_oid,
    c.relkind::text as relkind
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
    p.proowner,
    ''
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
    t.typowner,
    ''
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
  'extension_owner'::text,
  e.extname::text,
  format(
    'extension owned by %s (postgres or a role it is a member of), so objects can be added to it',
    pg_get_userbyid(e.extowner)
  )::text
from pg_extension as e
join pg_namespace as n on n.oid = e.extnamespace
where pg_has_role('postgres', e.extowner, 'MEMBER')
  and not exists (
    select 1
    from hosted_extension as h
    where h.extname = e.extname
      and h.schema_name = n.nspname
      and h.owner_name = pg_get_userbyid(e.extowner)
  )
union all
select
  'extension_added_member'::text,
  em.qualified_name::text,
  format(
    '%s, a member of extension %s, owned by %s (not a Supabase service role)',
    em.what,
    em.extname,
    pg_get_userbyid(em.owner_oid)
  )::text
from extension_member as em
where em.owner_oid not in (select sr.oid from supabase_owner as sr)
  and not exists (
    select 1
    from hosted_member as hm
    where hm.classid = em.classid
      and hm.objid = em.objid
  )
union all
select
  'extension_other_member'::text,
  pg_describe_object(d.classid, d.objid, d.objsubid)::text,
  format(
    'a member of extension %s (owned by %s) in catalog %s, which no check reads',
    e.extname,
    pg_get_userbyid(e.extowner),
    d.classid::regclass
  )::text
from pg_depend as d
join pg_extension as e on e.oid = d.refobjid
where d.refclassid = 'pg_extension'::regclass
  and d.deptype = 'e'
  and d.classid not in ('pg_class'::regclass, 'pg_proc'::regclass, 'pg_type'::regclass)
  and pg_has_role('postgres', e.extowner, 'MEMBER')
union all
select
  case
    when pg_get_userbyid(so.owner_oid) <> 'postgres' then 'handmade_nonadmin_owner'
    when so.nspname = 'extensions' then 'handmade_in_extensions'
    else 'handmade_in_system_schema'
  end::text,
  so.qualified_name::text,
  format('%s owned by %s and not an extension member', so.what, pg_get_userbyid(so.owner_oid))::text
from system_object as so
where so.owner_oid not in (select sr.oid from supabase_owner as sr)
  and not exists (
    select 1
    from supabase_object as o
    where o.kind = so.kind
      and o.schema_name = so.nspname
      and o.object_name = so.object_name
      and o.relkind = so.relkind
      and o.owner_name = pg_get_userbyid(so.owner_oid)
  )
