-- D1 migration 4: media grant functions (spec specs/d1-demo-slice.md §3.1 row 4, §3.4 media rows; L-2, L-25, L-26, R-7,
-- R-15; rule 8). Nothing else: the audit actions are text in audit_log.action (the zod list is in @trace/shared).
-- Tests: supabase/tests/rls_d1_media_view.test.sql. Reviews: docs/reviews/D1-db-review-m4.md,
-- docs/reviews/D1-security-review-m4.md (fixed in place: this migration was never applied to a shared database).
--
-- Error contract:
--   any refusal (unknown media, wrong api org, no counting membership, no assignment for a held role, workspace fence,
--   a link that was not issued to this viewer for this media in the last 330 s, or was already viewed)
--                                        SQLSTATE 42501, message 'TRACE_GUARD: media access denied'
-- One message for every refusal, so the api learns nothing about why (no existence oracle for media ids).
--
-- The api calls the two grant functions as trace_api with the user id, aal and amr it verified from the Supabase JWT
-- (auth.uid() / auth.jwt() are NULL on that connection, L-25, R-7), with trace.api_org_id set to the media's org. They
-- run as the owner, read public tables only and write the audit row before they return anything: within the caller's
-- transaction there is no link and no key without an audit row. The api commits before it hands out a link or bytes
-- (spec §6.2 R3-2), and only the key returned here is streamed (R3-3: the key itself is deterministic, D1-5).

-- ---------------------------------------------------------------------------------------------
-- private.media_viewer_check: the viewer may see this media object, or it raises. Returns the viewer's roles (for
-- actor_roles, L-26). Rules: the media belongs to the api's org of this transaction (private.api_org_id(); unset
-- means nothing, §3.4); an active membership in that active org that counts for the given aal and amr
-- (membership_counts_for over all of the membership's roles: aal2 for owner/admin/reviewer; a recruiter also at aal1 by
-- OTP without a password), inside the workspace fence (M0b D16b), and an assignment on the media's test for a role the
-- membership still holds (owner, admin, recruiter and reviewer alike, R-15). EXECUTE to nobody.
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
    and mo.org_id = private.api_org_id()
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
-- private.media_link_grant (L-2): called when the api issues a 5-minute link. Runs the check, refuses a link id that
-- was already issued (a jti is never reused), writes media.link_issued {media_id, session_id, link_id, ttl_seconds}
-- with the viewer as actor (L-26) and returns the session id. The per-link advisory lock serialises it with the view.
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media_link:' || p_link_id::text, 0));
  if exists (
    select 1 from public.audit_log as l
    where l.org_id = v_org and l.occurred_at >= now() - interval '330 seconds'
      and l.action in ('media.link_issued', 'media.view') and l.details ->> 'link_id' = p_link_id::text
  ) then
    raise exception 'TRACE_GUARD: media access denied' using errcode = '42501';
  end if;
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
-- the jti. Re-runs the check (a membership removed or demoted after issue is denied), then requires that this link was
-- issued to this viewer for this media in the last 330 s (300 s TTL plus clock skew) and was never viewed: rule 8's
-- 5-minute, single-use link holds in the database too, not only in MediaLinkDO (security review m4 F2). Writes one
-- media.view {media_id, session_id, link_id} with the viewer as actor, and only then returns the R2 key.
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media_link:' || p_link_id::text, 0));
  if not exists (
    select 1 from public.audit_log as l
    where l.org_id = v_org and l.occurred_at >= now() - interval '330 seconds'
      and l.action = 'media.link_issued' and l.object_id = p_media_id and l.actor_user_id = p_viewer
      and l.details ->> 'link_id' = p_link_id::text
  ) or exists (
    select 1 from public.audit_log as l
    where l.org_id = v_org and l.occurred_at >= now() - interval '330 seconds'
      and l.action = 'media.view' and l.details ->> 'link_id' = p_link_id::text
  ) then
    raise exception 'TRACE_GUARD: media access denied' using errcode = '42501';
  end if;
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
