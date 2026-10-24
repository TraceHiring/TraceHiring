-- Migration M1-g (specs/m1-test-authoring.md R5-61; Opus first reviews of stream A3b, APPROVE WITH FIXES / PASS WITH
-- FIXES).
-- 1. E26: the member provisioning job finds the Auth user that already holds an invited address (an account in another
--    org, or the user its own earlier try created before provisioning failed), so a retry provisions that same user
--    instead of failing the invite for good. The lookup is bound to a pending invite in the job's org, so the worker
--    cannot use it as a general address-to-user lookup. It returns only the id.
-- 2. A drafting job completes only with at least one draft, and every draft of it keyed (the worker ends a job with no
--    passing draft as failed `no_draft_passed`; the guard now holds that too).
-- 3. drafts_discarded counts every failed attempt and is not bounded by count (R5-51 d); the CHECK forced a cap.

-- ---------------------------------------------------------------------------------------------
-- 1. The Auth user id for a pending invite (E26)
-- ---------------------------------------------------------------------------------------------
create function private.auth_user_id_for_invite(p_invite uuid, p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if not exists (
    select 1 from public.member_invites as i
    where i.id = p_invite and i.org_id = private.job_org_id() and i.status = 'pending'
  ) then
    raise exception 'TRACE_GUARD: the invite is not pending in the job org' using errcode = '42501';
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

-- ---------------------------------------------------------------------------------------------
-- 2. A completed drafting job has keyed drafts (ai_draft_jobs_guard, after the M1 version)
-- ---------------------------------------------------------------------------------------------
create function private.ai_draft_jobs_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.drafts_created = 0 or exists (
      select 1 from public.item_versions as v
      where v.org_id = new.org_id and v.ai_draft_job_id = new.id
        and not exists (
          select 1 from public.item_answer_keys as k where k.org_id = v.org_id and k.item_version_id = v.id
        )
    ) then
      raise exception 'TRACE_GUARD: a completed drafting job has keyed drafts' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke execute on function private.ai_draft_jobs_outcome() from public, anon, authenticated, service_role;
-- BEFORE UPDATE, after ai_draft_jobs_guard by name (the guard counts drafts_created first).
create trigger ai_draft_jobs_outcome before update on public.ai_draft_jobs
  for each row execute function private.ai_draft_jobs_outcome();
alter table public.ai_draft_jobs enable always trigger ai_draft_jobs_outcome;

-- ---------------------------------------------------------------------------------------------
-- 3. drafts_discarded is not capped by count (R5-51 d)
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint as c
  where c.conrelid = 'public.ai_draft_jobs'::regclass and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%drafts_discarded%count%';
  if v_name is null then
    raise exception 'M1-g: the drafts_discarded CHECK was not found';
  end if;
  execute format('alter table public.ai_draft_jobs drop constraint %I', v_name);
end
$$;
alter table public.ai_draft_jobs add constraint ai_draft_jobs_drafts_discarded_check check (drafts_discarded >= 0);
