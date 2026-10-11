-- MT-7 (spec specs/m0-foundations.md §8.5, database-reviewer standard): a SECURITY DEFINER function in scope whose
-- proconfig does not contain exactly search_path="" (what set search_path = '' stores), or any SECURITY DEFINER
-- function in public, quality or integrity, because SECURITY DEFINER helpers live only in private (functions in
-- public are callable as PostgREST RPCs). Scope: functions in the four schemas, every prokind. Extension members in
-- their extension's own namespace are skipped.
with scope_function as (
  select
    p.oid,
    p.prosecdef,
    p.proconfig,
    n.nspname,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as qualified_name
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
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
