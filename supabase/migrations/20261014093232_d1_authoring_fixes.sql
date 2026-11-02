-- D1 authoring fixes (docs/reviews/D1-db-review-m1.md M-1 and m-1; tests supabase/tests/rls_d1_workspace_fence.test.sql).
-- Fix forward over 20261014065417_d1_authoring.sql (check-migrations: a placed migration is never edited).
-- CREATE OR REPLACE keeps each function's owner, ACL and triggers; the revoke/grant lines are repeated as in
-- migration 1, so the EXECUTE lists stay exactly as the catalog checks expect.
--
-- M-1 (Major): the workspace fence of M0b D16b. A membership scoped to a workspace reaches only tests of that
-- workspace: (a) assignments_guard refuses an assignment across the fence, for every caller including the
-- operator; (b) my_assigned_test_ids, behind every reviewer read policy, ignores an assignment whose test lies
-- outside the membership's current workspace (a membership narrowed after it was assigned); (c) the publish
-- auto-assignment (R-15) skips a creator whose membership is scoped to another workspace.
-- m-1 (Minor): the creator of a test or test version is auth.uid() for every caller except the operator path
-- (private.is_operator()), which alone may name one. A caller with no JWT that is not the operator gets none.

-- my_assigned_test_ids --------------------------------------------------------------------------------
create or replace function private.my_assigned_test_ids(p_roles public.org_role[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct a.test_id), '{}'::uuid[])
  from public.assignments as a
  join public.memberships as m on m.org_id = a.org_id and m.id = a.membership_id
  join public.orgs as o on o.id = m.org_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and o.status = 'active'
    and a.as_role = any (p_roles)
    and a.as_role = any (m.roles)
    and private.membership_counts(m.roles)
    -- M-1: a workspace-scoped membership counts only assignments of tests in its workspace.
    and (m.workspace_id is null or m.workspace_id = a.workspace_id)
$$;
revoke execute on function private.my_assigned_test_ids(public.org_role[]) from public, anon, authenticated, service_role;
grant execute on function private.my_assigned_test_ids(public.org_role[]) to authenticated;

-- tests_guard -----------------------------------------------------------------------------------------
create or replace function private.tests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- created_by is outside every authenticated grant, so an app caller always gets auth.uid(); only the
    -- operator path may name the creator, which the publish auto-assignment then uses (R-15). Any other
    -- caller without a JWT (a definer path, trace_api, a worker) gets none (m-1).
    new.created_by := case when private.is_operator() then new.created_by else (select auth.uid()) end;
    new.invitation_seq := 0;
    return new;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: test id, org, workspace, creator and created_at are immutable'
      using errcode = '42501';
  end if;
  if new.invitation_seq < old.invitation_seq then
    raise exception 'TRACE_GUARD: invitation_seq only grows' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.tests_guard() from public, anon, authenticated, service_role;

-- test_versions_guard ---------------------------------------------------------------------------------
create or replace function private.test_versions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_band uuid;
  v_uid uuid := (select auth.uid());
  v_member uuid;
  v_role public.org_role;
begin
  if tg_op = 'INSERT' then
    -- Lock the test row: serialises version_no assignment and the one-open-draft rule with other inserts.
    select t.workspace_id into v_ws
    from public.tests as t where t.org_id = new.org_id and t.id = new.test_id for no key update;
    if not found then
      raise exception 'TRACE_GUARD: test not found' using errcode = '23503';
    end if;
    if new.status is distinct from 'draft' then
      raise exception 'TRACE_GUARD: a test version starts as a draft' using errcode = '42501';
    end if;
    new.workspace_id := v_ws;
    new.created_by := case when private.is_operator() then new.created_by else v_uid end;  -- as tests_guard (m-1)
    new.published_at := null;
    new.published_by := null;
    if new.version_no is null then
      select coalesce(max(v.version_no), 0) + 1 into new.version_no
      from public.test_versions as v where v.org_id = new.org_id and v.test_id = new.test_id;
    end if;
    return new;
  end if;

  -- UPDATE (DELETE has its own trigger).
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id or new.test_id is distinct from old.test_id
    or new.version_no is distinct from old.version_no or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.ruleset_version_id is distinct from old.ruleset_version_id
    or new.notice_version_id is distinct from old.notice_version_id then
    raise exception 'TRACE_GUARD: test version id, org, workspace, test, number, creator and pins are immutable'
      using errcode = '42501';
  end if;

  if old.status = 'retired' then
    if new is distinct from old then
      raise exception 'TRACE_GUARD: a retired test version is terminal' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'published' then
    if new.status = 'published' then
      -- Even an identical update is refused, so a second (racing) publisher gets an error, not a silent no-op.
      raise exception 'TRACE_GUARD: a published test version is frozen' using errcode = '42501';
    elsif new.status = 'retired' then
      if new.total_time_seconds is distinct from old.total_time_seconds
        or new.quality_cutoff is distinct from old.quality_cutoff
        or new.content_sha256 is distinct from old.content_sha256
        or new.published_at is distinct from old.published_at
        or new.published_by is distinct from old.published_by then
        raise exception 'TRACE_GUARD: a published test version is frozen' using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'TRACE_GUARD: status change not allowed' using errcode = '42501';
  end if;

  -- old.status = 'draft'
  if new.status = 'draft' then
    new.published_at := null;
    new.published_by := null;
    return new;
  end if;
  if new.status <> 'published' then
    raise exception 'TRACE_GUARD: status change not allowed' using errcode = '42501';
  end if;

  -- Publish. The row lock taken before this trigger fired serialises concurrent publishes of this version; the
  -- tests row lock also serialises against a concurrent draft insert (M0b D9 pattern).
  perform 1 from public.tests as t where t.org_id = new.org_id and t.id = new.test_id for no key update;
  if new.content_sha256 is null then
    raise exception 'TRACE_GUARD: publish needs the content hash' using errcode = '42501';
  end if;
  if new.ruleset_version_id is null or new.notice_version_id is null then
    raise exception 'TRACE_GUARD: publish needs the pinned ruleset and notice' using errcode = '42501';
  end if;
  select r.band_rule_version_id into v_band
  from public.ruleset_versions as r where r.org_id = new.org_id and r.id = new.ruleset_version_id;
  if v_band is null then
    raise exception 'TRACE_GUARD: publish needs a ruleset with a band rule version' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sections as s where s.org_id = new.org_id and s.test_version_id = new.id) then
    raise exception 'TRACE_GUARD: publish needs at least one section' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.sections as s
    where s.org_id = new.org_id and s.test_version_id = new.id
      and not exists (select 1 from public.item_versions as i where i.org_id = s.org_id and i.section_id = s.id)
  ) then
    raise exception 'TRACE_GUARD: every section needs at least one item' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.item_versions as i
    where i.org_id = new.org_id and i.test_version_id = new.id and i.format = 'mcq'
      and not exists (
        select 1
        from public.item_answer_keys as k, jsonb_array_elements(i.options) as o
        where k.org_id = i.org_id and k.item_version_id = i.id and o ->> 'id' = k.key ->> 'option_id'
      )
  ) then
    raise exception 'TRACE_GUARD: every multiple-choice item needs a valid answer key' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.item_versions as i
    where i.org_id = new.org_id and i.test_version_id = new.id and i.format = 'written'
      and i.rubric_version_id is null
  ) then
    raise exception 'TRACE_GUARD: every written item needs a rubric' using errcode = '42501';
  end if;

  new.published_at := now();
  new.published_by := v_uid;

  -- The ruleset freezes with the version (Q20).
  update public.ruleset_versions
    set published_at = new.published_at
    where org_id = new.org_id and id = new.ruleset_version_id and published_at is null;

  -- The creator is assigned automatically so they can view evidence (R-15). as_role = the highest of
  -- org_owner | admin | recruiter that their membership holds; skipped if the membership is no longer active, or
  -- is scoped to another workspace than the test's (M-1). Only on the test's first publish (DB review m1 m-2): a
  -- later version's publish never re-adds a creator that an owner or admin unassigned.
  select m.id,
    case
      when 'org_owner' = any (m.roles) then 'org_owner'::public.org_role
      when 'admin' = any (m.roles) then 'admin'::public.org_role
      when 'recruiter' = any (m.roles) then 'recruiter'::public.org_role
    end
  into v_member, v_role
  from public.tests as t
  join public.memberships as m on m.org_id = t.org_id and m.user_id = t.created_by and m.status = 'active'
  where t.org_id = new.org_id and t.id = new.test_id
    and (m.workspace_id is null or m.workspace_id = t.workspace_id)
    and not exists (
      select 1 from public.test_versions as v
      where v.org_id = new.org_id and v.test_id = new.test_id and v.id <> new.id and v.published_at is not null
    );
  if v_member is not null and v_role is not null then
    insert into public.assignments (org_id, membership_id, test_id, as_role)
      values (new.org_id, v_member, new.test_id, v_role)
      on conflict (org_id, membership_id, test_id) do nothing;
  end if;
  return new;
end
$$;
revoke execute on function private.test_versions_guard() from public, anon, authenticated, service_role;

-- assignments_guard -----------------------------------------------------------------------------------
create or replace function private.assignments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select t.workspace_id into v_ws
  from public.tests as t where t.org_id = new.org_id and t.id = new.test_id;
  if not found then
    raise exception 'TRACE_GUARD: test not found' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.memberships as m
    where m.org_id = new.org_id and m.id = new.membership_id and m.status = 'active'
      and new.as_role = any (m.roles)
  ) then
    raise exception 'TRACE_GUARD: the membership must be active and hold the role' using errcode = '42501';
  end if;
  -- M-1: a workspace-scoped membership is assigned only to tests of its workspace, whoever asks.
  if exists (
    select 1 from public.memberships as m
    where m.org_id = new.org_id and m.id = new.membership_id
      and m.workspace_id is not null and m.workspace_id is distinct from v_ws
  ) then
    raise exception 'TRACE_GUARD: the membership is scoped to another workspace' using errcode = '42501';
  end if;
  new.workspace_id := v_ws;
  new.created_by := (select auth.uid());
  return new;
end
$$;
revoke execute on function private.assignments_guard() from public, anon, authenticated, service_role;
