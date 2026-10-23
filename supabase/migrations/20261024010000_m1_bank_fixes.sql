-- Migration M1-m (specs/m1-test-authoring.md R5-64; A2a database first review in docs/reviews/M1-wave2-first-reviews.md).
-- Fix forward; earlier migrations are not edited.
-- 1. D1: a multiple-choice bank version leaves draft only when its answer key names one of its current options. The
--    draft PUT writes content and key separately, so a key could be left on a deleted option and the approved version
--    would then block every publish that draws it.
-- 2. D4: one open (draft or in-review) version per bank item, as a partial unique index (the api checked it alone).
-- 3. D7: the bank list keyset (created_at desc, id desc) over bank rows has its own index.
-- 4. D2: v_pool_item_counts, a security_invoker view: one row per pool with its items and its approved items, so the
--    api reads pool counts in one call instead of one per 50 items.
-- 5. D6: import_jobs.images_ok leaves the client update grant; the guard counts it from the stored rows when the job
--    ends (distinct image keys of the job's items), like rows_ok and rows_error.

-- 1. D1 -------------------------------------------------------------------------------------------
-- Same signature as M1-a's (CREATE OR REPLACE keeps the owner and the ACL; the revoke below keeps it closed).
create or replace function private.item_version_ready(p_org uuid, p_id uuid, p_format public.section_format,
  p_param boolean, p_difficulty numeric)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_format = 'mcq' and not p_param and not exists (
    select 1
    from public.item_answer_keys as k
    join public.item_versions as i on i.org_id = k.org_id and i.id = k.item_version_id
    where k.org_id = p_org and k.item_version_id = p_id
      and jsonb_typeof(i.options) = 'array'
      and exists (select 1 from jsonb_array_elements(i.options) as o where o ->> 'id' = k.key ->> 'option_id')
  ) then
    raise exception 'TRACE_GUARD: a multiple-choice item needs its answer key' using errcode = '42501';
  end if;
  -- Carried Medium (defence in depth behind D1's shape CHECK): a written item reaches review, approval and a pool only
  -- with its rubric. The stored row is read: content (the rubric) and status never change in the same update.
  if p_format = 'written' and exists (
    select 1 from public.item_versions as i where i.org_id = p_org and i.id = p_id and i.rubric_version_id is null
  ) then
    raise exception 'TRACE_GUARD: a written item needs its rubric' using errcode = '42501';
  end if;
  if p_param then
    if not exists (select 1 from public.item_variants as v where v.org_id = p_org and v.item_version_id = p_id) then
      raise exception 'TRACE_GUARD: a parameterised item needs its variants' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.item_variants as v
      where v.org_id = p_org and v.item_version_id = p_id
        and not exists (select 1 from public.item_variant_keys as k where k.org_id = v.org_id and k.item_variant_id = v.id)
    ) then
      raise exception 'TRACE_GUARD: every variant needs its answer key' using errcode = '42501';
    end if;
    if p_difficulty is null or exists (
      select 1 from public.item_variants as v
      where v.org_id = p_org and v.item_version_id = p_id and abs(v.difficulty - p_difficulty) > 0.10
    ) then
      raise exception 'TRACE_GUARD: a variant difficulty must be within 0.10 of its item' using errcode = '23514';
    end if;
  end if;
end
$$;
revoke execute on function private.item_version_ready(uuid, uuid, public.section_format, boolean, numeric)
  from public, anon, authenticated, service_role;

-- 2. D4 -------------------------------------------------------------------------------------------
create unique index item_versions_one_open_per_item on public.item_versions (org_id, item_id)
  where section_id is null and status in ('draft', 'in_review');

-- 3. D7 -------------------------------------------------------------------------------------------
create index item_versions_bank_page_idx on public.item_versions (org_id, created_at desc, id desc)
  where section_id is null;

-- 4. D2 -------------------------------------------------------------------------------------------
-- RLS of pool_items and item_versions applies to the caller (security_invoker), so a role reads the counts of exactly
-- the pools it can read. A pool with no item has no row (the api reads it as 0 and 0).
create view public.v_pool_item_counts with (security_invoker = true) as
  select p.org_id, p.workspace_id, p.pool_id, count(*)::int as item_count,
    (count(*) filter (where v.status = 'approved'))::int as approved_count
  from public.pool_items as p
  join public.item_versions as v on v.org_id = p.org_id and v.id = p.item_version_id
  group by p.org_id, p.workspace_id, p.pool_id;
revoke all on public.v_pool_item_counts from public, anon, authenticated, service_role;
grant select on public.v_pool_item_counts to authenticated;

-- 5. D6 -------------------------------------------------------------------------------------------
revoke update (images_ok) on public.import_jobs from authenticated;

-- import_jobs guard: M1-c's body (20261023030000_m1_imports_drafts.sql) with images_ok counted like the row counts.
create or replace function private.import_jobs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op boolean := private.is_operator();
begin
  if tg_op = 'INSERT' then
    if not v_op and current_setting('role') <> 'authenticated' then
      raise exception 'TRACE_GUARD: an import job is started by an org user' using errcode = '42501';
    end if;
    new.status := 'open';
    new.rows_total := 0;
    new.rows_ok := 0;
    new.rows_error := 0;
    new.images_ok := 0;
    new.error_code := null;
    new.completed_at := null;
    new.created_by := case when v_op then new.created_by else (select auth.uid()) end;
    new.created_at := now();
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'TRACE_GUARD: import jobs are kept' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id or new.source_kind is distinct from old.source_kind
    or new.template_version is distinct from old.template_version or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: import job id, org, workspace, source and creator are immutable' using errcode = '42501';
  end if;
  if old.status in ('completed', 'cancelled', 'failed') then
    raise exception 'TRACE_GUARD: a finished import job is frozen' using errcode = '42501';
  end if;
  if new.status = old.status or (old.status = 'open' and new.status = 'validating') then
    if new.rows_total is distinct from old.rows_total or new.rows_ok is distinct from old.rows_ok
      or new.rows_error is distinct from old.rows_error or new.images_ok is distinct from old.images_ok
      or new.error_code is distinct from old.error_code or new.completed_at is distinct from old.completed_at then
      raise exception 'TRACE_GUARD: import counts are written when the job ends' using errcode = '42501';
    end if;
    return new;
  end if;
  -- §4.3 (DB review L1): only a validating job completes; an open job may still be cancelled or fail (a file over the
  -- row or image limit fails before any batch).
  if new.status not in ('completed', 'cancelled', 'failed') or (old.status = 'open' and new.status = 'completed') then
    raise exception 'TRACE_GUARD: import job status change not allowed' using errcode = '42501';
  end if;
  select count(*) into new.rows_ok
  from public.item_versions as v where v.org_id = new.org_id and v.import_job_id = new.id;
  select count(distinct e.row_no) into new.rows_error
  from public.import_row_errors as e where e.org_id = new.org_id and e.import_job_id = new.id;
  new.rows_total := new.rows_ok + new.rows_error;
  -- D6: the images accepted are the distinct image keys of the job's stored items.
  select count(distinct m ->> 'key') into new.images_ok
  from public.item_versions as v
  cross join lateral jsonb_array_elements(case when jsonb_typeof(v.media) = 'array' then v.media else '[]'::jsonb end) as m
  where v.org_id = new.org_id and v.import_job_id = new.id;
  new.completed_at := now();
  return new;
end
$$;
revoke execute on function private.import_jobs_guard() from public, anon, authenticated, service_role;
