-- rls_m1_draft_sweep (spec specs/m1-test-authoring.md revision 5 §4.4, §6.4; R5-64 m; A2a security S2 and database D10 in docs/reviews/M1-wave2-first-reviews.md). RED first: written before migration M1-n. A drafting job whose queue message was never sent stays queued (no org role may fail it); the jobs cron calls private.fail_stranded_ai_draft_jobs as the authoring worker, which fails queued jobs older than 15 minutes with error_code timeout. Personas and jobs are synthetic.
-- Fixtures (operator path): queued, running and completed jobs in orgs A and B; four are aged past 15 minutes.
select pg_temp.op();
insert into public.ai_draft_jobs (id, org_id, workspace_id, requested_by, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values
  ('a8000000-0000-4000-8000-0000000000a1', pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('owner'), 'mcq', 'verbal', 0.50, 1, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1'),
  ('a8000000-0000-4000-8000-0000000000a2', pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('owner'), 'mcq', 'verbal', 0.50, 1, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1'),
  ('a8000000-0000-4000-8000-0000000000a3', pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('owner'), 'mcq', 'verbal', 0.50, 1, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1'),
  ('a8000000-0000-4000-8000-0000000000a4', pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('owner'), 'mcq', 'verbal', 0.50, 1, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1'),
  ('a8000000-0000-4000-8000-0000000000b1', pg_temp.id('B'), pg_temp.id('BW'), pg_temp.id('b_admin'), 'mcq', 'verbal', 0.50, 1, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1');
-- a3 is claimed by the worker (running): the sweep never touches a running job.
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
update public.ai_draft_jobs set status = 'running' where id = 'a8000000-0000-4000-8000-0000000000a3';
select pg_temp.op();
-- Age a1, a3, b1 by 20 minutes and a4 by 10 minutes (the guard keeps created_at immutable, so it is set with the guard
-- off, inside this rolled-back transaction).
alter table public.ai_draft_jobs disable trigger ai_draft_jobs_guard;
update public.ai_draft_jobs set created_at = now() - interval '20 minutes'
  where id in ('a8000000-0000-4000-8000-0000000000a1', 'a8000000-0000-4000-8000-0000000000a3', 'a8000000-0000-4000-8000-0000000000b1');
update public.ai_draft_jobs set created_at = now() - interval '10 minutes' where id = 'a8000000-0000-4000-8000-0000000000a4';
alter table public.ai_draft_jobs enable always trigger ai_draft_jobs_guard;

-- ===== Who may run the sweep =====
select is((select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') from pg_proc as p where p.oid = 'private.fail_stranded_ai_draft_jobs(int)'::regprocedure), 'true|search_path=""', 'sweep: SECURITY DEFINER with an empty search_path');
select is(has_function_privilege('trace_authoring_worker', 'private.fail_stranded_ai_draft_jobs(int)', 'EXECUTE'), true, 'sweep: the authoring worker may execute it');
select is((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role', 'trace_worker', 'trace_api', 'trace_admin_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_candidate']) as r where has_function_privilege(r, 'private.fail_stranded_ai_draft_jobs(int)', 'EXECUTE')), null, 'sweep: no other role may execute it');
select pg_temp.u('owner');
select matches(pg_temp.try($$select private.fail_stranded_ai_draft_jobs(50)$$), '^42501', 'sweep: an org owner cannot fail drafting jobs');
select pg_temp.op();
select matches(pg_temp.try($$select private.fail_stranded_ai_draft_jobs(50)$$), '^42501 TRACE_GUARD: the drafting sweep runs as the authoring worker', 'sweep: the operator path is refused too (the cron is the only caller)');

-- ===== The sweep =====
select pg_temp.w('trace_authoring_worker', null);
select is(private.fail_stranded_ai_draft_jobs(1), 1, 'sweep: the limit caps one call (oldest first)');
select is(private.fail_stranded_ai_draft_jobs(50), 1, 'sweep: the next call fails the other stranded queued job, across orgs');
select is(private.fail_stranded_ai_draft_jobs(50), 0, 'sweep: a repeated call fails nothing (idempotent)');
select matches(pg_temp.try($$select private.fail_stranded_ai_draft_jobs(0)$$), '^22023', 'sweep: a limit outside 1..500 is refused');
select pg_temp.op();
select is((select string_agg(right(id::text, 2) || '=' || status || ':' || coalesce(error_code, '-') || ':' || (completed_at is not null)::text || ':' || drafts_created, ',' order by id) from public.ai_draft_jobs where id::text like 'a8000000-0000-4000-8000-0000000000%' and right(id::text, 2) in ('a1', 'a2', 'a3', 'a4', 'b1')), 'a1=failed:timeout:true:0,a2=queued:-:false:0,a3=running:-:false:0,a4=queued:-:false:0,b1=failed:timeout:true:0', 'sweep: only queued jobs older than 15 minutes fail, with timeout; fresh, younger and running jobs are untouched');
select is((select string_agg(pg_temp.keys(details) || '|' || (details ->> 'error_code') || '|' || actor_kind::text, ',') from public.audit_log where action = 'ai_draft.fail' and object_id in ('a8000000-0000-4000-8000-0000000000a1', 'a8000000-0000-4000-8000-0000000000b1')), 'ai_draft_job_id,error_code|timeout|system,ai_draft_job_id,error_code|timeout|system', 'sweep: each failure is audited ai_draft.fail by the system with ids and the code only');
-- A late delivery finds the job finished: the guard keeps it frozen.
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try($$update public.ai_draft_jobs set status = 'running' where id = 'a8000000-0000-4000-8000-0000000000a1'$$), '^42501 TRACE_GUARD: a finished drafting job is frozen', 'sweep: a late message cannot restart a swept job');
