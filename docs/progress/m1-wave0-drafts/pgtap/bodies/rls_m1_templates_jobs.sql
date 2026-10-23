-- rls_m1_templates_jobs (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_templates_jobs; §3.2 jobs, role_templates; §3.3 tests.job_id, test_versions.role_template_version_id; §3.5; §6.1; M1-16, M1-17; R2-5, R2-9, R3-7, R5-26, R5-27, R5-29). RED first: written from the spec before migration M1-b. Personas and templates are synthetic.
insert into pg_temp.ids select 'tpl_cs', id from public.role_templates where org_id = pg_temp.id('L') and template_key = 'customer_support' and version = 1;
insert into pg_temp.ids select 'tpl_bpo', id from public.role_templates where org_id = pg_temp.id('L') and template_key = 'bpo_voice' and version = 1;
-- An org B published template, for the cross-org case.
insert into public.role_templates (id, org_id, template_key, version, name, keywords, blueprint, preset_key, status, published_at) values
  ('e3000000-0000-4000-8000-0000000000bb', pg_temp.id('B'), 'b_only', 1, 'Org B template', '{alpha,beta}',
   '{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "verbal", "drawCount": 5, "available": true}], "totalTimeSeconds": 600}',
   'standard', 'published', now());

-- ===== The wedge templates (plan-conflicts #13; §6.1; R5-27) =====
select is((select string_agg(template_key || ':' || status || ':' || preset_key, ',' order by template_key) from public.role_templates where org_id = pg_temp.id('L')), 'bpo_voice:published:standard,customer_support:published:standard', 'templates: the library holds the two wedge templates, published, Standard');
select is((select string_agg((s ->> 'format') || '/' || (s ->> 'skillKey') || '/' || (s ->> 'drawCount') || '/' || (s ->> 'available'), ',' order by n) from public.role_templates as t, jsonb_array_elements(t.blueprint -> 'sections') with ordinality as x(s, n) where t.id = pg_temp.id('tpl_cs')), 'mcq/verbal/10/true,mcq/customer_service_sjt/10/true,written/written_communication/1/true,typing/typing/1/false', 'templates: Customer Support = verbal 10, SJT 10, written 1, typing unavailable');
select is((select string_agg((s ->> 'format') || '/' || (s ->> 'skillKey') || '/' || (s ->> 'drawCount') || '/' || (s ->> 'available'), ',' order by n) from public.role_templates as t, jsonb_array_elements(t.blueprint -> 'sections') with ordinality as x(s, n) where t.id = pg_temp.id('tpl_bpo')), 'mcq/verbal/10/true,mcq/reading/8/true,written/written_communication/1/true,voice/spoken_english/1/false,typing/typing/1/false', 'templates: BPO Voice = verbal 10, reading 8, written 1, voice and typing unavailable');
select is((select (blueprint ->> 'totalTimeSeconds') || '|' || (select blueprint ->> 'totalTimeSeconds' from public.role_templates where id = pg_temp.id('tpl_bpo')) from public.role_templates where id = pg_temp.id('tpl_cs')), '2400|2100', 'templates: Customer Support 40 min, BPO Voice 35 min');

-- ===== blueprint_valid (§5 shape) =====
select is(private.blueprint_valid('{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "verbal", "drawCount": 5, "available": true}], "totalTimeSeconds": 600}'), true, 'blueprint_valid: a minimal blueprint is valid');
select is(private.blueprint_valid('{"sections": [{"title": "Voice", "format": "voice", "skillKey": "spoken_english", "drawCount": 1, "available": true}], "totalTimeSeconds": 600}'), false, 'blueprint_valid (M1-16): a voice section cannot be available in M1');
select is(private.blueprint_valid('{"sections": [], "totalTimeSeconds": 600}'), false, 'blueprint_valid: at least one section');
select is(private.blueprint_valid('{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "verbal", "drawCount": 5, "available": true, "extra": 1}], "totalTimeSeconds": 600}'), false, 'blueprint_valid: no unknown section key');
select is(private.blueprint_valid('{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "verbal", "drawCount": 101, "available": true}], "totalTimeSeconds": 600}'), false, 'blueprint_valid: a draw is 1 to 100');
select is(private.blueprint_valid('{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "verbal", "drawCount": 5, "available": true}], "totalTimeSeconds": 30}'), false, 'blueprint_valid: the total time is 60 to 7200 s');

-- ===== role_templates: S =====
select pg_temp.u('owner');
select is((select count(*)::int from public.role_templates), 0, 'templates S (R2-5): an org A owner reads no library or org B template');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.role_templates'), '^42501 permission denied', 'templates S: trace_api has no table grant');
select is((select string_agg(e ->> 'templateKey', ',' order by e ->> 'templateKey') from jsonb_array_elements(private.library_reference(pg_temp.id('recruiter'), 'aal1', '{otp}', 'templates')) as e), 'bpo_voice,customer_support', 'library_reference(templates): a recruiter of the api org gets the published library templates');
select is((select jsonb_array_length(private.library_reference(pg_temp.id('recruiter'), 'aal1', '{otp}', 'skills'))), 9, 'library_reference(skills): the 9 wedge skills');
select is((select private.library_reference(null, null, null, 'templates')), '[]'::jsonb, 'library_reference (R3-7): no viewer gets no template');
select pg_temp.op();

-- ===== role_templates: I / U (own org; admin; immutable from published) =====
select pg_temp.u('admin');
select is(pg_temp.try($$insert into public.role_templates (id, org_id, template_key, version, name, keywords, blueprint, preset_key) values ('e3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'night_shift_support', 1, 'Night shift support', '{night,shift,support}', '{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "verbal", "drawCount": 5, "available": true}], "totalTimeSeconds": 600}', 'strict')$$), 'OK 1', 'templates I: an admin adds an own-org template');
select matches(pg_temp.try($$insert into public.role_templates (org_id, template_key, version, name, keywords, blueprint, preset_key) values ('a1000000-0000-4000-8000-000000000001', 'bad_tpl', 1, 'Bad', '{a,support}', '{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "verbal", "drawCount": 5, "available": true}], "totalTimeSeconds": 600}', 'strict')$$), '^23514 TRACE_GUARD: a template keyword has 2 to 40 characters', 'templates I: a one-letter keyword is refused');
select matches(pg_temp.try($$insert into public.role_templates (org_id, template_key, version, name, keywords, blueprint, preset_key) values ('a1000000-0000-4000-8000-000000000001', 'astro_tpl', 1, 'Astro', '{night}', '{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "astrology", "drawCount": 5, "available": true}], "totalTimeSeconds": 600}', 'strict')$$), '^23503 TRACE_GUARD: skill not found', 'templates I (DB-M1-12): every blueprint skill is a key of the library taxonomy');
select matches(pg_temp.try($$insert into public.role_templates (org_id, template_key, version, name, keywords, blueprint, preset_key) values ('a1000000-0000-4000-8000-000000000001', 'bad_tpl', 1, 'Bad', '{night}', '{"sections": [], "totalTimeSeconds": 600}', 'strict')$$), '^23514', 'templates I: an invalid blueprint is refused');
select matches(pg_temp.try($$insert into public.role_templates (org_id, template_key, version, name, keywords, blueprint, preset_key, status) values ('a1000000-0000-4000-8000-000000000001', 'bad_tpl', 1, 'Bad', '{night}', '{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "verbal", "drawCount": 5, "available": true}], "totalTimeSeconds": 600}', 'strict', 'published')$$), '^42501 permission denied', 'templates I: status is outside the insert grant (a template starts as a draft)');
select pg_temp.u('admin_aal1');
select matches(pg_temp.try($$insert into public.role_templates (org_id, template_key, version, name, keywords, blueprint, preset_key) values ('a1000000-0000-4000-8000-000000000001', 'aal1_tpl', 1, 'Aal1', '{night}', '{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "verbal", "drawCount": 5, "available": true}], "totalTimeSeconds": 600}', 'strict')$$), '^42501', 'templates I: an admin at aal1 cannot add a template');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$insert into public.role_templates (org_id, template_key, version, name, keywords, blueprint, preset_key) values ('a1000000-0000-4000-8000-000000000001', 'rc_tpl', 1, 'Recruiter', '{night}', '{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "verbal", "drawCount": 5, "available": true}], "totalTimeSeconds": 600}', 'strict')$$), '^42501', 'templates I: a recruiter cannot add a template (matrix: AD)');
select is((select count(*)::int from public.role_templates), 1, 'templates S: a recruiter reads the own-org template');
select is(pg_temp.try($$update public.role_templates set name = 'Renamed'$$), 'OK 0', 'templates U: a recruiter cannot edit a template');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.role_templates (org_id, template_key, version, name, keywords, blueprint, preset_key) values ('a1000000-0000-4000-8000-000000000001', 'cross_tpl', 1, 'Cross', '{night}', '{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "verbal", "drawCount": 5, "available": true}], "totalTimeSeconds": 600}', 'strict')$$), '^42501', 'templates I: org B admin cannot add an org A template');
select pg_temp.u('hm');
select is((select count(*)::int from public.role_templates), 0, 'templates S: a hiring manager reads no template');
select pg_temp.u('admin');
select is(pg_temp.try($$update public.role_templates set name = 'Night support' where id = 'e3000000-0000-4000-8000-000000000001'$$), 'OK 1', 'templates U: an admin edits the draft');
select matches(pg_temp.try($$update public.role_templates set blueprint = '{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "palmistry", "drawCount": 5, "available": true}], "totalTimeSeconds": 600}' where id = 'e3000000-0000-4000-8000-000000000001'$$), '^23503 TRACE_GUARD: skill not found', 'templates U (DB-M1-12): a draft blueprint cannot name an unknown skill');
select is(pg_temp.try($$update public.role_templates set status = 'published' where id = 'e3000000-0000-4000-8000-000000000001'$$), 'OK 1', 'templates U: an admin publishes it');
select matches(pg_temp.try($$update public.role_templates set keywords = '{night,support}' where id = 'e3000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: a published template is frozen', 'templates U: a published template is frozen');
select matches(pg_temp.try($$update public.role_templates set status = 'draft' where id = 'e3000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: a published template is frozen', 'templates U: a published template never returns to draft');
select pg_temp.op();
select is((select (published_at is not null)::text from public.role_templates where id = 'e3000000-0000-4000-8000-000000000001'), 'true', 'templates U: publish stamps published_at');
select is((select pg_temp.keys(details) || '|' || (details ->> 'version') from public.audit_log where action = 'role_template.publish' and object_id = 'e3000000-0000-4000-8000-000000000001'), 'version|1', 'templates event (R5-26): role_template.publish carries the version only');
select matches(pg_temp.try(format($$update public.role_templates set blueprint = blueprint where id = %L$$, pg_temp.id('tpl_cs'))), '^42501 TRACE_GUARD: a published template is frozen', 'templates U: a library template is frozen, even on the operator path');
select matches(pg_temp.try($$update public.role_templates set version = 2 where id = 'e3000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: template id, org, key, version and creator are immutable', 'templates U: the key and version are immutable');
select pg_temp.u('admin');
select is(pg_temp.try($$update public.role_templates set status = 'retired' where id = 'e3000000-0000-4000-8000-000000000001'$$), 'OK 1', 'templates U: published -> retired');
select matches(pg_temp.try($$delete from public.role_templates$$), '^42501 permission denied', 'templates D: templates are retired, never deleted');
select pg_temp.op();

-- ===== jobs: I (no JD text; the template is a published own-org or library template) =====
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$insert into public.jobs (id, org_id, workspace_id, title, role_template_version_id, jd_sha256, template_match_permille) values ('e4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Support associate', %L, %L, 420)$$, pg_temp.id('tpl_cs'), repeat('a', 64))), 'OK 1', 'jobs I: a recruiter creates a job from a library template with the JD hash and match');
select matches(pg_temp.try($$insert into public.jobs (org_id, workspace_id, title, role_template_version_id) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Cross', 'e3000000-0000-4000-8000-0000000000bb')$$), '^23503 TRACE_GUARD: role template not found', 'jobs I: another customer org''s template is not found');
select matches(pg_temp.try($$insert into public.jobs (org_id, workspace_id, title, role_template_version_id) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Retired', 'e3000000-0000-4000-8000-000000000001')$$), '^23503 TRACE_GUARD: role template not found', 'jobs I: a retired template is not found');
select matches(pg_temp.try($$insert into public.jobs (org_id, workspace_id, title, template_match_permille) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Bad match', 1001)$$), '^23514', 'jobs I (R5-29): the match is 0 to 1000 permille');
select matches(pg_temp.try($$insert into public.jobs (org_id, workspace_id, title, jd_sha256) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Bad hash', 'not a hash')$$), '^23514', 'jobs I: the JD hash is 64 hex');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$insert into public.jobs (org_id, workspace_id, title) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Fence')$$), '^42501', 'jobs I: a workspace A2 recruiter cannot create a job in A1');
select is(pg_temp.try($$insert into public.jobs (id, org_id, workspace_id, title) values ('e4000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'A2 job')$$), 'OK 1', 'jobs I: a workspace A2 recruiter creates a job in A2');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$insert into public.jobs (org_id, workspace_id, title) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Reviewer')$$), '^42501', 'jobs I: a reviewer cannot create a job');
select pg_temp.u('hm');
select matches(pg_temp.try($$insert into public.jobs (org_id, workspace_id, title) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Hm')$$), '^42501', 'jobs I: a hiring manager cannot create a job');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.jobs (org_id, workspace_id, title) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Cross')$$), '^42501', 'jobs I: org B admin cannot create an org A job');
select pg_temp.op();
select is((select (created_by = pg_temp.id('recruiter'))::text from public.jobs where id = 'e4000000-0000-4000-8000-000000000001'), 'true', 'jobs I: created_by is the caller');
select is((select string_agg(column_name::text, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'jobs'), 'archived_at,created_at,created_by,id,jd_sha256,org_id,role_template_version_id,template_match_permille,title,workspace_id', 'jobs (M1-17, R5-29): no JD text column and no score-like column');

-- ===== jobs: S / U / D =====
select pg_temp.u('recruiter');
select is((select count(*)::int from public.jobs), 2, 'jobs S: an org-wide recruiter reads the jobs of every workspace');
select is(pg_temp.try($$update public.jobs set title = 'Support associate (night)' where id = 'e4000000-0000-4000-8000-000000000001'$$), 'OK 1', 'jobs U: the title is editable');
select pg_temp.u('ws_recruiter');
select is((select array_agg(id) from public.jobs), array['e4000000-0000-4000-8000-000000000002'::uuid], 'jobs S: a workspace A2 recruiter reads the A2 job only');
select is(pg_temp.try($$update public.jobs set archived_at = now() where id = 'e4000000-0000-4000-8000-000000000001'$$), 'OK 0', 'jobs U: a workspace A2 recruiter cannot touch the A1 job');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$update public.jobs set jd_sha256 = null where id = 'e4000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'jobs U: the JD hash is outside the update grant');
select matches(pg_temp.try($$delete from public.jobs$$), '^42501 permission denied', 'jobs D: no delete grant (archive instead)');
select pg_temp.op();
select matches(pg_temp.try($$update public.jobs set role_template_version_id = null where id = 'e4000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: job id, org, workspace, template match and creator are immutable', 'jobs U: the template match is immutable, even on the operator path');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.jobs), 0, 'jobs S: a reviewer with no assigned test reads no job');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.jobs where org_id = pg_temp.id('A')), 0, 'jobs S: org B admin reads no org A job');

-- ===== tests.job_id (R2-9 fence-preserving key) and test_versions.role_template_version_id =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into public.tests (org_id, workspace_id, name, job_id) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Support test', 'e4000000-0000-4000-8000-000000000001')$$), 'OK 1', 'tests.job_id: a test takes its own workspace''s job');
select pg_temp.op();
insert into pg_temp.ids select 'jt', id from public.tests where name = 'Support test';
select pg_temp.u('recruiter');
select matches(pg_temp.try($$insert into public.tests (org_id, workspace_id, name, job_id) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Fence test', 'e4000000-0000-4000-8000-000000000002')$$), '^23503', 'tests.job_id: a job of another workspace is refused by the fence key');
select is(pg_temp.try($$insert into public.test_versions (org_id, test_id, total_time_seconds, quality_cutoff) values ('a1000000-0000-4000-8000-000000000001', pg_temp.id('jt'), 2400, 40)$$), 'OK 1', 'tests.job_id: the recruiter opens the first version');
select pg_temp.op();
select is((select role_template_version_id from public.test_versions where test_id = pg_temp.id('jt')), pg_temp.id('tpl_cs'), 'test_versions: the version records its job''s template');
insert into public.assignments (org_id, membership_id, scope, test_id, as_role)
  select m.org_id, m.id, 'test', pg_temp.id('jt'), 'reviewer'
  from public.memberships as m where m.org_id = pg_temp.id('A') and m.user_id = pg_temp.id('reviewer');
select pg_temp.u('reviewer');
select is((select array_agg(id) from public.jobs), array['e4000000-0000-4000-8000-000000000001'::uuid], 'jobs S: a reviewer reads the job of an assigned test');
select pg_temp.op();
