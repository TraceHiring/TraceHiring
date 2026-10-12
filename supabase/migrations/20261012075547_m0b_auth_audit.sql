-- M0b sign-in audit (spec specs/m0b-tenancy.md §2.5): the only objects on Supabase's `auth` schema
-- besides the auth.users foreign keys. No IP, no user agent. A failure aborts the sign-in (fail closed).

-- auth.sign_in: one row per active membership of the user, in an active org.
create function private.auth_sessions_sign_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
begin
  for m in
    select ms.id, ms.org_id, ms.roles, ms.workspace_id
    from public.memberships as ms
    join public.orgs as o on o.id = ms.org_id
    where ms.user_id = new.user_id and ms.status = 'active' and o.status = 'active'
  loop
    perform private.audit(m.org_id, 'auth.sign_in', 'auth.sessions', new.id,
      jsonb_build_object('aal', new.aal::text), null,
      p_actor_kind => 'org_user', p_actor_user_id => new.user_id, p_actor_roles => m.roles);
  end loop;
  return null;
end
$$;
revoke execute on function private.auth_sessions_sign_in() from public, anon, authenticated, service_role;

-- auth.step_up: GoTrue raises a session from aal1 to aal2 by updating auth.sessions.aal (S19, D12).
create function private.auth_sessions_step_up()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
begin
  for m in
    select ms.id, ms.org_id, ms.roles
    from public.memberships as ms
    join public.orgs as o on o.id = ms.org_id
    where ms.user_id = new.user_id and ms.status = 'active' and o.status = 'active'
  loop
    perform private.audit(m.org_id, 'auth.step_up', 'auth.sessions', new.id,
      jsonb_build_object('aal', new.aal::text), null,
      p_actor_kind => 'org_user', p_actor_user_id => new.user_id, p_actor_roles => m.roles);
  end loop;
  return null;
end
$$;
revoke execute on function private.auth_sessions_step_up() from public, anon, authenticated, service_role;

create trigger trace_audit_sign_in
  after insert on auth.sessions
  for each row execute function private.auth_sessions_sign_in();
create trigger trace_audit_step_up
  after update of aal on auth.sessions
  for each row when (new.aal is distinct from old.aal)
  execute function private.auth_sessions_step_up();
