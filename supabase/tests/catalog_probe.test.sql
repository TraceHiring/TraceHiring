-- MT-4b (spec specs/m0-foundations.md §8.5): proves the baseline default ACLs now, not only when the first
-- table appears. Inside this rolled-back transaction a throwaway table, sequence and function is created as
-- postgres in each of the four in-scope schemas. Each assertion also reports any probe object that is missing,
-- so it can never pass vacuously. Hand-written; not generated.
begin;
select plan(4);

create table public.mt_4b_t (id int);
create table private.mt_4b_t (id int);
create table quality.mt_4b_t (id int);
create table integrity.mt_4b_t (id int);
create sequence public.mt_4b_s;
create sequence private.mt_4b_s;
create sequence quality.mt_4b_s;
create sequence integrity.mt_4b_s;
create function public.mt_4b_f() returns int language sql as 'select 1';
create function private.mt_4b_f() returns int language sql as 'select 1';
create function quality.mt_4b_f() returns int language sql as 'select 1';
create function integrity.mt_4b_f() returns int language sql as 'select 1';

select is_empty(
  $q$
  select 'missing table' as problem, s.nspname as object
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  where to_regclass(format('%I.mt_4b_t', s.nspname)) is null
  union all
  select r.rolname || ' has a table privilege', format('%I.mt_4b_t', s.nspname)
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  cross join unnest(array['anon', 'authenticated', 'service_role']) as r(rolname)
  where to_regclass(format('%I.mt_4b_t', s.nspname)) is not null
    and (
      has_table_privilege(r.rolname, to_regclass(format('%I.mt_4b_t', s.nspname)),
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
      or has_any_column_privilege(r.rolname, to_regclass(format('%I.mt_4b_t', s.nspname)),
        'SELECT, INSERT, UPDATE, REFERENCES')
    )
  $q$,
  'MT-4b: anon, authenticated and service_role get no privilege on a new table in any in-scope schema'
);

select is_empty(
  $q$
  select 'missing sequence' as problem, s.nspname as object
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  where to_regclass(format('%I.mt_4b_s', s.nspname)) is null
  union all
  select r.rolname || ' has a sequence privilege', format('%I.mt_4b_s', s.nspname)
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  cross join unnest(array['anon', 'authenticated', 'service_role']) as r(rolname)
  where to_regclass(format('%I.mt_4b_s', s.nspname)) is not null
    and has_sequence_privilege(r.rolname, to_regclass(format('%I.mt_4b_s', s.nspname)), 'USAGE, SELECT, UPDATE')
  $q$,
  'MT-4b: anon, authenticated and service_role get no privilege on a new sequence in any in-scope schema'
);

select is_empty(
  $q$
  select 'missing function' as problem, s.nspname as object
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  where to_regprocedure(format('%I.mt_4b_f()', s.nspname)) is null
  union all
  select r.rolname || ' can execute', format('%I.mt_4b_f()', s.nspname)
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  cross join unnest(array['anon', 'authenticated', 'service_role']) as r(rolname)
  where to_regprocedure(format('%I.mt_4b_f()', s.nspname)) is not null
    and has_function_privilege(r.rolname, to_regprocedure(format('%I.mt_4b_f()', s.nspname)), 'EXECUTE')
  $q$,
  'MT-4b: anon, authenticated and service_role cannot execute a new function in any in-scope schema'
);

select is_empty(
  $q$
  select 'missing function' as problem, s.nspname as object
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  where to_regprocedure(format('%I.mt_4b_f()', s.nspname)) is null
  union all
  select 'PUBLIC can execute', p.oid::regprocedure::text
  from pg_proc as p
  where p.proname = 'mt_4b_f'
    and p.pronamespace::regnamespace::text in ('public', 'private', 'quality', 'integrity')
    and exists (
      select 1
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    )
  $q$,
  'MT-4b: PUBLIC has no EXECUTE on a new function in any in-scope schema'
);

select * from finish();
rollback;
