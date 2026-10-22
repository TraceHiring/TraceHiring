-- M0b FIX, review finding B0-DB7 (spec specs/m0b-tenancy.md §3.7): private.grant_staff_access gave a grant to an
-- inactive staff member, or one without the scope as a capability, approved by another inactive one. The grantee
-- and the approver must now be active staff, and the grantee must hold p_scope in capabilities. CREATE OR REPLACE
-- keeps the owner and the ACL (no EXECUTE grant to any role).
create or replace function private.grant_staff_access(
  p_org_id uuid,
  p_staff_user_id uuid,
  p_approved_by uuid,
  p_ticket_ref text,
  p_scope public.staff_grant_scope,
  p_expires_at timestamptz,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('trace.request_id', true);
  v_grant uuid;
begin
  if not private.is_operator() then
    raise exception 'TRACE_OPERATOR_ONLY' using errcode = '42501';
  end if;
  -- A missing staff row falls through to the foreign keys (23503), as before.
  if exists (
    select 1
    from public.platform_staff as s
    where s.user_id in (p_staff_user_id, p_approved_by)
      and not s.active
  ) then
    raise exception 'TRACE_STAFF_INACTIVE' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.platform_staff as s
    where s.user_id = p_staff_user_id
      and not (p_scope::text = any (s.capabilities))
  ) then
    raise exception 'TRACE_STAFF_SCOPE' using errcode = '42501';
  end if;
  perform set_config('trace.request_id', p_request_id::text, true);
  insert into public.staff_access_grants (org_id, staff_user_id, approved_by, ticket_ref, scope, expires_at)
    values (p_org_id, p_staff_user_id, p_approved_by, p_ticket_ref, p_scope, p_expires_at)
    returning id into v_grant;
  perform set_config('trace.request_id', coalesce(v_prev, ''), true);
  return v_grant;
end
$$;
