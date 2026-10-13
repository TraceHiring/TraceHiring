-- M0b FIX, review finding M0B-DB-5 (spec specs/m0b-tenancy.md §3.5, §10 C1): the lock-first guard serialises two
-- concurrent owner demotions only under READ COMMITTED. Under REPEATABLE READ (or SERIALIZABLE) the second
-- transaction keeps the snapshot it took before the first committed, so the deferred last-owner check does not see
-- the first demotion and both commit, leaving the org with no owner (scripts/test-concurrency-local.mjs proved it).
-- An update that touches an owner or changes a status (the cases the guard locks for) is refused outside READ
-- COMMITTED. PostgREST, the operator scripts and psql all run READ COMMITTED, so no current path is affected.
create function private.memberships_isolation_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'TRACE_GUARD: owner and status changes run under READ COMMITTED only'
      using errcode = '0A000';
  end if;
  return new;
end
$$;
revoke execute on function private.memberships_isolation_guard() from public, anon, authenticated, service_role;

create trigger memberships_isolation_guard before update on public.memberships
  for each row
  when ('org_owner' = any (old.roles) or 'org_owner' = any (new.roles) or new.status is distinct from old.status)
  execute function private.memberships_isolation_guard();
