-- MT-11 (spec specs/m0-foundations.md §8.5, separate per-operation policies, CLAUDE.md): a policy on an in-scope
-- table (the schemas public, private, quality and integrity, plus every member of the partition tree of a
-- partitioned table there, extension members skipped by the README rule) that is:
--   for_all: FOR ALL (polcmd *).
--   insert_without_check: an INSERT policy without WITH CHECK.
--   update_missing_clause: an UPDATE policy without USING or without WITH CHECK.
--   select_delete_without_using: a SELECT or DELETE policy without USING.
--   public_role: applied to PUBLIC (0 in polroles, which is what a policy with no TO clause gets).
--   literal_true: USING or WITH CHECK is literally true, on a table that is not on the reference list below.
--   auth_call_unwrapped: the policy depends on auth.uid() or auth.jwt() (pg_depend classid pg_policy) and, once
--     every scalar sub-select in exactly the deparsed form ( SELECT auth.uid() AS ...) or ( SELECT auth.jwt() AS ...)
--     is removed, its deparsed USING or WITH CHECK still calls one of them. pg_get_expr omits the auth. prefix when
--     auth is on the search_path, so the prefix is optional in both patterns.
with reference_table (schema_name, table_name, adr) as (
  values
    -- One row per reference table whose policies may be literally true, each citing its ADR, e.g.
    -- ('public', 'countries', 'ADR-0NN reference data'),
    -- Empty in M0a. The null row below only types the columns and is ignored.
    (null::name, null::name, null::text)
),
scope_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in ('public', 'private', 'quality', 'integrity')
),
scope_rel as (
  select c.oid
  from pg_class as c
  where c.relnamespace in (select s.oid from scope_schema as s)
  union
  select t.relid
  from pg_class as c
  cross join lateral pg_partition_tree(c.oid) as t
  where c.relkind = 'p'
    and c.relnamespace in (select s.oid from scope_schema as s)
),
auth_function as (
  select p.oid
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'auth'
    and p.proname in ('uid', 'jwt')
),
scope_policy as (
  select
    pol.oid,
    pol.polcmd,
    pol.polroles,
    pol.polqual is not null as has_using,
    pol.polwithcheck is not null as has_check,
    coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') as using_text,
    coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') as check_text,
    n.nspname,
    c.relname,
    format('%I on %I.%I', pol.polname, n.nspname, c.relname)::text as qualified_name
  from pg_policy as pol
  join pg_class as c on c.oid = pol.polrelid
  join scope_rel as s on s.oid = c.oid
  join pg_namespace as n on n.oid = c.relnamespace
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
)
select
  'for_all'::text as branch,
  sp.qualified_name as object,
  'policy is FOR ALL, not one policy per operation'::text as detail
from scope_policy as sp
where sp.polcmd = '*'
union all
select
  'insert_without_check'::text,
  sp.qualified_name,
  'INSERT policy has no WITH CHECK'::text
from scope_policy as sp
where sp.polcmd = 'a'
  and not sp.has_check
union all
select
  'update_missing_clause'::text,
  sp.qualified_name,
  format(
    'UPDATE policy has no %s',
    case
      when not sp.has_using and not sp.has_check then 'USING and no WITH CHECK'
      when not sp.has_using then 'USING'
      else 'WITH CHECK'
    end
  )::text
from scope_policy as sp
where sp.polcmd = 'w'
  and (not sp.has_using or not sp.has_check)
union all
select
  'select_delete_without_using'::text,
  sp.qualified_name,
  format('%s policy has no USING', case when sp.polcmd = 'r' then 'SELECT' else 'DELETE' end)::text
from scope_policy as sp
where sp.polcmd in ('r', 'd')
  and not sp.has_using
union all
select
  'public_role'::text,
  sp.qualified_name,
  'policy applies to PUBLIC'::text
from scope_policy as sp
where 0::oid = any(sp.polroles)
union all
select
  'literal_true'::text,
  sp.qualified_name,
  'USING or WITH CHECK is literally true'::text
from scope_policy as sp
where (sp.using_text = 'true' or sp.check_text = 'true')
  and not exists (
    select 1
    from reference_table as rt
    where rt.schema_name = sp.nspname
      and rt.table_name = sp.relname
      and rt.adr ~ '^ADR-[0-9]+'
  )
union all
select
  'auth_call_unwrapped'::text,
  sp.qualified_name,
  'auth.uid() or auth.jwt() is called outside a ( SELECT ... ) sub-select'::text
from scope_policy as sp
where exists (
    select 1
    from pg_depend as d
    where d.classid = 'pg_policy'::regclass
      and d.objid = sp.oid
      and d.refclassid = 'pg_proc'::regclass
      and d.refobjid in (select af.oid from auth_function as af)
  )
  and regexp_replace(
    sp.using_text || ' ' || sp.check_text,
    '\( SELECT (auth\.)?(uid|jwt)\(\) AS [^)]*\)',
    '',
    'g'
  ) ~ '(^|[^[:alnum:]_$."])(auth\.)?(uid|jwt)\(\)'
