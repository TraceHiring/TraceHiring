-- Migration M1-h (specs/m1-test-authoring.md R5-62; A3b confirming re-review L1). The E26 lookup also refuses once the
-- invite's inviter is no longer an active admin (an owner, for an owner invite) of an active org: the same check as
-- private.provision_invited_member, made before the job calls the Auth API, so a demoted inviter's invite fails
-- without leaving an Auth user behind (DPDP: no orphan address in auth.users).
create or replace function private.auth_user_id_for_invite(p_invite uuid, p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.member_invites%rowtype;
  v_ids uuid[];
begin
  select i.* into v_inv
  from public.member_invites as i
  where i.id = p_invite and i.org_id = private.job_org_id() and i.status = 'pending';
  if not found then
    raise exception 'TRACE_GUARD: the invite is not pending in the job org' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships as m
    join public.orgs as o on o.id = m.org_id
    where m.org_id = v_inv.org_id and m.user_id = v_inv.invited_by and m.status = 'active' and o.status = 'active'
      and m.roles && '{org_owner,admin}'::public.org_role[]
      and (not ('org_owner' = any (v_inv.roles)) or 'org_owner' = any (m.roles))
  ) then
    raise exception 'TRACE_GUARD: the inviter is no longer an active admin or owner' using errcode = '42501';
  end if;
  select array_agg(u.id) into v_ids
  from auth.users as u
  where lower(u.email) = lower(btrim(p_email))
    and u.is_sso_user = false
    and coalesce(u.is_anonymous, false) = false
    and u.deleted_at is null;
  if coalesce(cardinality(v_ids), 0) = 0 then
    return null;
  end if;
  if cardinality(v_ids) > 1 then
    -- Never names the address.
    raise exception 'TRACE_GUARD: more than one account holds the invited address' using errcode = '42501';
  end if;
  return v_ids[1];
end
$$;
revoke execute on function private.auth_user_id_for_invite(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.auth_user_id_for_invite(uuid, text) to trace_admin_worker;
