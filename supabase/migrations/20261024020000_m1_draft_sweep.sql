-- Migration M1-n (specs/m1-test-authoring.md R5-64 m; A2a security S2 and database D10 in
-- docs/reviews/M1-wave2-first-reviews.md). A drafting job whose queue message was never sent (a failed queue.send)
-- stays queued, and no org role may fail it. The topic text is never stored (topic_sha256 only, §6.4), so the job
-- cannot be re-enqueued: the jobs cron fails it instead. private.fail_stranded_ai_draft_jobs runs as the authoring
-- worker (the role ai_draft_jobs_guard lets move a job; the guard still checks every transition and the audit trigger
-- records ai_draft.fail by the system) and fails queued jobs older than 15 minutes with error_code timeout, oldest
-- first, at most p_limit per call. A late message then finds the job finished and frozen.

create index ai_draft_jobs_queued_idx on public.ai_draft_jobs (created_at, id) where status = 'queued';

create function private.fail_stranded_ai_draft_jobs(p_limit int)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if current_setting('role') is distinct from 'trace_authoring_worker' then
    raise exception 'TRACE_GUARD: the drafting sweep runs as the authoring worker' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'TRACE_BAD_INPUT: the sweep limit is 1 to 500' using errcode = '22023';
  end if;
  -- SKIP LOCKED: a job a consumer is claiming right now is left for that consumer.
  with stranded as (
    select j.org_id, j.id
    from public.ai_draft_jobs as j
    where j.status = 'queued' and j.created_at < now() - interval '15 minutes'
    order by j.created_at, j.id
    limit p_limit
    for update skip locked
  )
  update public.ai_draft_jobs as j
  set status = 'failed', error_code = 'timeout'
  from stranded as s
  where j.org_id = s.org_id and j.id = s.id;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke execute on function private.fail_stranded_ai_draft_jobs(int) from public, anon, authenticated, service_role;
grant execute on function private.fail_stranded_ai_draft_jobs(int) to trace_authoring_worker;
