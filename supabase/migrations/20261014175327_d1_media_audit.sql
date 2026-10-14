-- D1 migration 4: media grant functions (spec specs/d1-demo-slice.md §3.1 row 4, §3.4 media rows; L-2, L-25, L-26, R-7,
-- R-15; rule 8). Nothing else: the audit actions are text in audit_log.action (the zod list is in @trace/shared).
-- Tests: supabase/tests/rls_d1_media_view.test.sql.
--
-- Error contract:
--   any refusal (unknown media, no counting membership, no assignment, workspace fence)
--                                        SQLSTATE 42501, message 'TRACE_GUARD: media access denied'
-- One message for every refusal, so the api learns nothing about why (no existence oracle for media ids).
--
-- The api calls the two grant functions as trace_api with the user id, aal and amr it verified from the Supabase JWT
-- (auth.uid() / auth.jwt() are NULL on that connection, L-25, R-7). They run as the owner, read public tables only and
-- write the audit row before they return anything: no audit row, no link and no key (fail closed).

-- ---------------------------------------------------------------------------------------------
-- private.media_viewer_check: the viewer may see this media object, or it raises. Returns the viewer's roles (for
-- actor_roles, L-26). Rules: an active membership in the media's org (an active org) that counts for the given aal and
-- amr (membership_counts_for: aal2 for owner/admin/reviewer; a recruiter also at aal1 by OTP without a password),
-- inside the workspace fence (M0b D16b), and an assignment on the media's test for a role the membership holds
-- (owner, admin, recruiter and reviewer alike, R-15). EXECUTE to nobody: only the two grant functions call it.
-- ---------------------------------------------------------------------------------------------
create function private.media_viewer_check(p_media_id uuid, p_viewer uuid, p_aal text, p_amr text[])
returns public.org_role[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_roles public.org_role[];
begin
  select m.roles into v_roles
  from public.media_objects as mo
  join public.orgs as o on o.id = mo.org_id
  join public.memberships as m on m.org_id = mo.org_id
  join public.assignments as a
    on a.org_id = mo.org_id and a.membership_id = m.id and a.test_id = mo.test_id
  where mo.id = p_media_id
    and p_viewer is not null
    and m.user_id = p_viewer
    and m.status = 'active'
    and o.status = 'active'
    and (m.workspace_id is null or m.workspace_id = mo.workspace_id)
    and a.as_role = any (m.roles)
    and private.membership_counts_for(p_viewer, m.roles, p_aal, p_amr);
  if not found then
    raise exception 'TRACE_GUARD: media access denied' using errcode = '42501';
  end if;
  return v_roles;
end
$$;
revoke execute on function private.media_viewer_check(uuid, uuid, text, text[])
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- private.media_link_grant (L-2): called when the api issues a 5-minute link. Runs the check, writes media.link_issued
-- {media_id, session_id, link_id, ttl_seconds} with the viewer as actor (L-26) and returns the session id.
-- ---------------------------------------------------------------------------------------------
create function private.media_link_grant(p_media_id uuid, p_viewer uuid, p_aal text, p_amr text[], p_link_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roles public.org_role[];
  v_org uuid;
  v_ws uuid;
  v_session uuid;
begin
  if p_link_id is null then
    raise exception 'TRACE_GUARD: media access denied' using errcode = '42501';
  end if;
  v_roles := private.media_viewer_check(p_media_id, p_viewer, p_aal, p_amr);
  select mo.org_id, mo.workspace_id, mo.session_id into v_org, v_ws, v_session
  from public.media_objects as mo where mo.id = p_media_id;
  perform private.audit(
    v_org, 'media.link_issued', 'media_objects', p_media_id,
    jsonb_build_object('media_id', p_media_id, 'session_id', v_session, 'link_id', p_link_id, 'ttl_seconds', 300),
    p_workspace_id => v_ws, p_actor_kind => 'org_user', p_actor_user_id => p_viewer, p_actor_roles => v_roles
  );
  return v_session;
end
$$;
revoke execute on function private.media_link_grant(uuid, uuid, text, text[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.media_link_grant(uuid, uuid, text, text[], uuid) to trace_api;

-- ---------------------------------------------------------------------------------------------
-- private.media_view_grant (L-2, R-7): called on every fetch of /media/:jti, after the api verified the HMAC and burnt
-- the jti. Re-runs the check (a membership removed after issue is denied), writes one media.view
-- {media_id, session_id, link_id} per call with the viewer as actor, and only then returns the R2 key.
-- ---------------------------------------------------------------------------------------------
create function private.media_view_grant(p_media_id uuid, p_viewer uuid, p_aal text, p_amr text[], p_link_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roles public.org_role[];
  v_org uuid;
  v_ws uuid;
  v_session uuid;
  v_key text;
begin
  if p_link_id is null then
    raise exception 'TRACE_GUARD: media access denied' using errcode = '42501';
  end if;
  v_roles := private.media_viewer_check(p_media_id, p_viewer, p_aal, p_amr);
  select mo.org_id, mo.workspace_id, mo.session_id, mo.r2_key into v_org, v_ws, v_session, v_key
  from public.media_objects as mo where mo.id = p_media_id;
  perform private.audit(
    v_org, 'media.view', 'media_objects', p_media_id,
    jsonb_build_object('media_id', p_media_id, 'session_id', v_session, 'link_id', p_link_id),
    p_workspace_id => v_ws, p_actor_kind => 'org_user', p_actor_user_id => p_viewer, p_actor_roles => v_roles
  );
  return v_key;
end
$$;
revoke execute on function private.media_view_grant(uuid, uuid, text, text[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.media_view_grant(uuid, uuid, text, text[], uuid) to trace_api;
