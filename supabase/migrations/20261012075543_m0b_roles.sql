-- M0b roles (spec specs/m0b-tenancy.md §1.1 item 1, §2.3). NOLOGIN group roles only: login roles with
-- passwords are created per environment by an operator runbook (M2/M3a), never in a migration.
-- Roles are cluster-global and survive `supabase db reset`, so each is created only if missing and
-- its attributes are then set explicitly (DC-3: reset twice).

do $$
declare
  r text;
begin
  foreach r in array array[
    'trace_worker',
    'trace_quality_worker',
    'trace_integrity_worker',
    'trace_candidate',
    'trace_candidate_gateway'
  ] loop
    if not exists (select from pg_catalog.pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
    -- SUPERUSER and REPLICATION need a superuser to set or clear, which postgres is not; MT-14 (a)
    -- checks that none of these roles holds them.
    execute format('alter role %I nologin nocreatedb nocreaterole nobypassrls', r);
  end loop;
end
$$;

-- The gateway inherits nothing: its only membership is trace_candidate, usable only through
-- SET ROLE (Q6; MT-14 (b)).
alter role trace_candidate_gateway noinherit;
grant trace_candidate to trace_candidate_gateway with inherit false, set true;

-- Rule 1: Answer Quality and Integrity Signals have separate worker roles; no role reaches both
-- schemas (MT-5c, MT-14 (f)). The schemas stay empty in M0b.
grant usage on schema quality to trace_quality_worker;
grant usage on schema integrity to trace_integrity_worker;
