-- rls_m1_templates_jobs (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_templates_jobs; §3.2 jobs, role_templates; §3.3 tests.job_id, test_versions.role_template_version_id; §3.5; §6.1; M1-16, M1-17; R2-5, R2-9, R3-7, R5-26, R5-27, R5-29). RED first: written from the spec before migration M1-b. Personas and templates are synthetic.
begin;
-- Helpers live in pg_temp (rolled back with the transaction). try() runs one statement as the current role and returns
-- 'OK <rows>' or '<sqlstate> <message>', so a denial is an assertion, not an abort.
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'OK ' || n;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end
$f$;
grant execute on function pg_temp.try(text) to public;
-- keys() lists the top-level keys of an audit details object, sorted and comma-joined.
create function pg_temp.keys(p_details jsonb) returns text language sql as $f$
  select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(p_details) as k
$f$;
grant execute on function pg_temp.keys(jsonb) to public;
-- id(name): a fixture id recorded by the fixture helpers below (readable by every role in this transaction).
create table pg_temp.ids (k text primary key, v uuid not null);
grant select on pg_temp.ids to public;
create function pg_temp.id(p_k text) returns uuid language sql stable as $f$
  select v from pg_temp.ids where k = p_k
$f$;
grant execute on function pg_temp.id(text) to public;
-- Persona switching. u(name) = an org user (role authenticated plus JWT claims); w(role, org) = a worker role bound to a
-- job org; api(org) = trace_api bound to an api org; op() = the operator path (postgres, no role, no claims).
create function pg_temp.u(p_who text) returns void language plpgsql as $f$
declare v_sub text; v_amr text;
begin
  select x.sub, x.amr into v_sub, v_amr from (values
    ('owner', '00000000-0000-4000-8000-000000000001', 'aal2'),
    ('admin', '00000000-0000-4000-8000-000000000003', 'aal2'),
    ('admin_aal1', '00000000-0000-4000-8000-000000000004', 'otp'),
    ('recruiter', '00000000-0000-4000-8000-000000000005', 'otp'),
    ('recruiter_pw', '00000000-0000-4000-8000-000000000006', 'pw'),
    ('reviewer', '00000000-0000-4000-8000-000000000007', 'aal2'),
    ('reviewer_aal1', '00000000-0000-4000-8000-000000000007', 'otp'),
    ('hm', '00000000-0000-4000-8000-000000000008', 'otp'),
    ('ws_recruiter', '00000000-0000-4000-8000-000000000009', 'otp'),
    ('ws_reviewer', '00000000-0000-4000-8000-00000000000a', 'aal2'),
    ('b_admin', '00000000-0000-4000-8000-00000000000e', 'aal2'),
    ('outsider', '00000000-0000-4000-8000-000000000011', 'otp'),
    ('lib_author', '00000000-0000-4000-8000-000000000020', 'aal2'),
    ('lib_expert', '00000000-0000-4000-8000-000000000021', 'aal2'),
    ('pure_owner', '00000000-0000-4000-8000-000000000030', 'aal2'),
    ('invitee', '00000000-0000-4000-8000-000000000031', 'otp')
  ) as x(who, sub, amr) where x.who = p_who;
  if v_sub is null then
    raise exception 'unknown persona %', p_who;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('trace.job_org_id', '', true);
  perform set_config('trace.api_org_id', '', true);
  perform set_config('request.jwt.claims', case v_amr
    when 'aal2' then '{"sub": "' || v_sub || '", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}'
    when 'pw' then '{"sub": "' || v_sub || '", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}'
    else '{"sub": "' || v_sub || '", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}'
  end, true);
end
$f$;
grant execute on function pg_temp.u(text) to public;
create function pg_temp.op() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('trace.job_org_id', '', true);
  perform set_config('trace.api_org_id', '', true);
end
$f$;
grant execute on function pg_temp.op() to public;
create function pg_temp.w(p_role text, p_org uuid) returns void language plpgsql as $f$
begin
  perform pg_temp.op();
  perform set_config('role', p_role, true);
  perform set_config('trace.job_org_id', coalesce(p_org::text, ''), true);
end
$f$;
grant execute on function pg_temp.w(text, uuid) to public;
create function pg_temp.api(p_org uuid) returns void language plpgsql as $f$
begin
  perform pg_temp.op();
  perform set_config('role', 'trace_api', true);
  perform set_config('trace.api_org_id', coalesce(p_org::text, ''), true);
end
$f$;
grant execute on function pg_temp.api(uuid) to public;
grant trace_worker to postgres with inherit false, set true;
grant trace_quality_worker to postgres with inherit false, set true;
grant trace_integrity_worker to postgres with inherit false, set true;
grant trace_api to postgres with inherit false, set true;
grant trace_candidate to postgres with inherit false, set true;
grant trace_authoring_worker to postgres with inherit false, set true;
grant trace_admin_worker to postgres with inherit false, set true;
grant usage on schema extensions to authenticated, anon, service_role, trace_worker, trace_quality_worker,
  trace_integrity_worker, trace_api, trace_candidate, trace_authoring_worker, trace_admin_worker;

-- Personas (synthetic, p-<persona>@example.test), orgs A and B (customers) and the library org of migration M1-a.
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p-owner-admin@example.test'),
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'p-admin@example.test'),
  ('00000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'p-admin-aal1@example.test'),
  ('00000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'p-recruiter-otp@example.test'),
  ('00000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'p-recruiter-pw@example.test'),
  ('00000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'p-reviewer@example.test'),
  ('00000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'p-hm@example.test'),
  ('00000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'p-ws-recruiter@example.test'),
  ('00000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'p-ws-reviewer@example.test'),
  ('00000000-0000-4000-8000-00000000000e', 'authenticated', 'authenticated', 'p-b-admin@example.test'),
  ('00000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'p-outsider@example.test'),
  ('00000000-0000-4000-8000-000000000020', 'authenticated', 'authenticated', 'p-lib-author@example.test'),
  ('00000000-0000-4000-8000-000000000021', 'authenticated', 'authenticated', 'p-lib-expert@example.test');
insert into public.orgs (id, kind, name, slug) values
  ('a1000000-0000-4000-8000-000000000001', 'customer', 'Org A', 'org-a-m1-test'),
  ('a1000000-0000-4000-8000-000000000003', 'customer', 'Org B', 'org-b-m1-test');
insert into public.workspaces (id, org_id, name, kind, is_default) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Default', 'default', true),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Client A2', 'client', false),
  ('b1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000003', 'Default', 'default', true);
insert into pg_temp.ids values
  ('A', 'a1000000-0000-4000-8000-000000000001'), ('B', 'a1000000-0000-4000-8000-000000000003'),
  ('A1', 'b1000000-0000-4000-8000-000000000001'), ('A2', 'b1000000-0000-4000-8000-000000000002'),
  ('BW', 'b1000000-0000-4000-8000-000000000004'),
  ('L', (select id from public.orgs where kind = 'trace_library')),
  ('LW', (select w.id from public.workspaces as w join public.orgs as o on o.id = w.org_id
          where o.kind = 'trace_library' and w.is_default)),
  ('owner', '00000000-0000-4000-8000-000000000001'), ('admin', '00000000-0000-4000-8000-000000000003'),
  ('recruiter', '00000000-0000-4000-8000-000000000005'), ('reviewer', '00000000-0000-4000-8000-000000000007'),
  ('ws_recruiter', '00000000-0000-4000-8000-000000000009'), ('b_admin', '00000000-0000-4000-8000-00000000000e'),
  ('lib_author', '00000000-0000-4000-8000-000000000020'), ('lib_expert', '00000000-0000-4000-8000-000000000021');
insert into public.memberships (org_id, user_id, roles, workspace_id, display_name, status) values
  (pg_temp.id('A'), pg_temp.id('owner'), '{org_owner,admin}', null, 'Persona Owner Admin', 'active'),
  (pg_temp.id('A'), pg_temp.id('admin'), '{admin}', null, 'Persona Admin', 'active'),
  (pg_temp.id('A'), '00000000-0000-4000-8000-000000000004', '{admin}', null, 'Persona Admin Aal1', 'active'),
  (pg_temp.id('A'), pg_temp.id('recruiter'), '{recruiter}', null, 'Persona Recruiter', 'active'),
  (pg_temp.id('A'), '00000000-0000-4000-8000-000000000006', '{recruiter}', null, 'Persona Recruiter Pw', 'active'),
  (pg_temp.id('A'), pg_temp.id('reviewer'), '{reviewer}', null, 'Persona Reviewer', 'active'),
  (pg_temp.id('A'), '00000000-0000-4000-8000-000000000008', '{hiring_manager}', null, 'Persona Hm', 'active'),
  (pg_temp.id('A'), pg_temp.id('ws_recruiter'), '{recruiter}', pg_temp.id('A2'), 'Persona Ws Recruiter', 'active'),
  (pg_temp.id('A'), '00000000-0000-4000-8000-00000000000a', '{reviewer}', pg_temp.id('A2'), 'Persona Ws Reviewer', 'active'),
  (pg_temp.id('B'), pg_temp.id('b_admin'), '{org_owner,admin}', null, 'Persona B Admin', 'active'),
  (pg_temp.id('L'), pg_temp.id('lib_author'), '{org_owner,admin,recruiter}', null, 'Persona Lib Author', 'active'),
  (pg_temp.id('L'), pg_temp.id('lib_expert'), '{reviewer}', null, 'Persona Lib Expert', 'active');

-- bank(key, org, workspace, format, skill, difficulty, status): a bank item and its version on the operator path, an
-- answer key for MCQ, then the transitions up to the asked status (approver = the org's owner, or the library expert).
-- Records ids <key> (version) and <key>_item.
create function pg_temp.bank(p_key text, p_org uuid, p_ws uuid, p_format text, p_skill text, p_diff numeric,
  p_status text) returns uuid language plpgsql as $f$
declare v_item uuid; v_ver uuid; v_lib boolean := p_org = pg_temp.id('L');
begin
  insert into public.items (org_id, workspace_id, format, skill_key, created_by)
    values (p_org, p_ws, p_format::public.section_format, p_skill,
      case when v_lib then pg_temp.id('lib_author') else pg_temp.id('owner') end)
    returning id into v_item;
  insert into public.item_versions (org_id, item_id, format, stem, options, rubric_version_id, skill_key, difficulty,
      content_sha256, created_by)
    values (p_org, v_item, p_format::public.section_format, '[synthetic] Bank item ' || p_key,
      case when p_format = 'mcq' then '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]'::jsonb end,
      case when p_format = 'written' then (select r.id from public.rubric_versions as r
                                           where r.org_id = p_org and r.rubric_key = 'default') end,
      p_skill, p_diff, repeat('c', 64),
      case when v_lib then pg_temp.id('lib_author') else pg_temp.id('owner') end)
    returning id into v_ver;
  if p_format = 'mcq' then
    insert into public.item_answer_keys (org_id, item_version_id, format, key) values (p_org, v_ver, 'mcq', '{"option_id": "o1"}');
  end if;
  if p_status in ('in_review', 'approved', 'retired', 'not_approved') then
    update public.item_versions set status = 'in_review' where id = v_ver;
  end if;
  if p_status = 'not_approved' then
    update public.item_versions set status = 'not_approved' where id = v_ver;
  end if;
  if p_status in ('approved', 'retired') then
    update public.item_versions set status = 'approved',
      approved_by = case when v_lib then pg_temp.id('lib_expert') when p_org = pg_temp.id('B') then pg_temp.id('b_admin')
                         else pg_temp.id('owner') end,
      reviewed_by = case when v_lib then pg_temp.id('lib_expert') end,
      key_reviewed_by = case when v_lib then pg_temp.id('lib_expert') end
    where id = v_ver;
  end if;
  if p_status = 'retired' then
    update public.item_versions set status = 'retired' where id = v_ver;
  end if;
  insert into pg_temp.ids values (p_key, v_ver), (p_key || '_item', v_item);
  return v_ver;
end
$f$;

-- tv(key, org, workspace): a test and its draft version 1 on the operator path (the D1 seed trigger adds the draft
-- ruleset and pins the notice). Records <key> (version) and <key>_test.
create function pg_temp.tv(p_key text, p_org uuid, p_ws uuid) returns uuid language plpgsql as $f$
declare v_test uuid; v_tv uuid;
begin
  insert into public.tests (org_id, workspace_id, name) values (p_org, p_ws, 'Test ' || p_key) returning id into v_test;
  insert into public.test_versions (org_id, test_id, total_time_seconds, quality_cutoff)
    values (p_org, v_test, 1800, 40) returning id into v_tv;
  insert into pg_temp.ids values (p_key, v_tv), (p_key || '_test', v_test);
  return v_tv;
end
$f$;
-- sec(key, version key, position, format, pool, draw, weight): a section of a draft version on the operator path, with
-- package-v2 navigation (written sections forward-only, with the Standard preset's paste rule allowed_logged, DB-M1-1).
-- A null pool makes an inline section. Records <key>.
create function pg_temp.sec(p_key text, p_tv text, p_pos int, p_format text, p_pool uuid, p_draw int, p_weight numeric)
returns uuid language plpgsql as $f$
declare v_id uuid;
begin
  insert into public.sections (org_id, test_version_id, position, name, format, weight, pool_id, draw_count, navigation,
      paste_rule)
    select v.org_id, v.id, p_pos, 'Section ' || p_key, p_format::public.section_format, p_weight, p_pool, p_draw,
      case when p_format = 'written' then 'forward_only' else 'free' end,
      case when p_format = 'written' then 'allowed_logged' end
    from public.test_versions as v where v.id = pg_temp.id(p_tv)
    returning id into v_id;
  insert into pg_temp.ids values (p_key, v_id);
  return v_id;
end
$f$;
-- inline(key, section key): an inline MCQ item of a draft section and its key, on the operator path. Records <key>.
create function pg_temp.inline(p_key text, p_sec text) returns uuid language plpgsql as $f$
declare v_id uuid; v_org uuid; v_pos int;
begin
  select s.org_id into v_org from public.sections as s where s.id = pg_temp.id(p_sec);
  select coalesce(max(i.position), 0) + 1 into v_pos from public.item_versions as i where i.section_id = pg_temp.id(p_sec);
  insert into public.item_versions (org_id, section_id, format, position, stem, options, content_sha256)
    values (v_org, pg_temp.id(p_sec), 'mcq', v_pos, '[synthetic] Inline ' || p_key,
      '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', repeat('c', 64))
    returning id into v_id;
  insert into public.item_answer_keys (org_id, item_version_id, format, key) values (v_org, v_id, 'mcq', '{"option_id": "o1"}');
  insert into pg_temp.ids values (p_key, v_id);
  return v_id;
end
$f$;
-- preset(version key, preset): the version's draft ruleset gets the preset's settings (the guard derives signal_settings).
create function pg_temp.preset(p_tv text, p_preset text) returns void language plpgsql as $f$
begin
  update public.ruleset_versions as r set preset_key = p_preset,
    settings = (select p.preset_values from public.integrity_presets as p where p.preset_key = p_preset and p.version = 1)
  where r.id = (select v.ruleset_version_id from public.test_versions as v where v.id = pg_temp.id(p_tv));
end
$f$;
-- publish(version key): operator-path publish with a content hash (the publish guard runs in full).
create function pg_temp.publish(p_tv text) returns void language plpgsql as $f$
begin
  update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id = pg_temp.id(p_tv);
end
$f$;
-- session(key, version key, n): one submitted session of a published version through the real roles, in D1's order:
-- the operator inserts the invitation; trace_api sends, verifies, consents and starts; trace_worker mirrors the session.
-- Records <key>.
create function pg_temp.session(p_key text, p_tv text, p_n int) returns uuid language plpgsql as $f$
declare v_org uuid; v_ws uuid; v_test uuid; v_rs uuid; v_nv uuid;
  v_inv uuid := gen_random_uuid(); v_cons uuid := gen_random_uuid(); v_sid uuid := gen_random_uuid();
begin
  perform pg_temp.op();
  select v.org_id, v.workspace_id, v.test_id, v.ruleset_version_id, v.notice_version_id into v_org, v_ws, v_test, v_rs, v_nv
  from public.test_versions as v where v.id = pg_temp.id(p_tv);
  insert into public.invitations (id, org_id, workspace_id, test_id, test_version_id, candidate_label, contact_email,
      link_token_hash, adult_confirmed_by_inviter, status, expires_at)
    values (v_inv, v_org, v_ws, v_test, pg_temp.id(p_tv), 'Candidate 0', 'm1-c' || p_n || '@example.test',
      encode(sha256(convert_to('m1-session-' || p_key, 'UTF8')), 'hex'), true, 'created', '2030-01-01 00:00:00+00');
  perform pg_temp.api(v_org);
  update public.invitations set status = 'sent' where id = v_inv;
  update public.invitations set status = 'otp_verified', adult_self_declared = true where id = v_inv;
  insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id,
      rendered_sha256, language, event)
    values (v_cons, v_org, v_inv, pg_temp.id(p_tv), v_rs, v_nv, repeat('d', 64), 'en', 'granted');
  update public.invitations set session_id = v_sid where id = v_inv;
  update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = v_inv;
  perform pg_temp.w('trace_worker', v_org);
  insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state,
      submit_kind, adult_confirmed_at_start, started_at, server_deadline_at, submitted_at, mirror_seq, receipt_ref)
    values (v_sid, v_org, pg_temp.id(p_tv), v_rs, v_inv, v_cons, 'submitted', 'candidate', true,
      '2026-10-14 10:00:00+00', '2026-10-14 10:31:00+00', '2026-10-14 10:20:00+00', 1,
      'RCPTM' || lpad(p_n::text, 3, '0'));
  update public.invitations set status = 'submitted' where id = v_inv;
  perform pg_temp.op();
  insert into pg_temp.ids values (p_key, v_sid);
  return v_sid;
end
$f$;
-- ai_draft(key, org, workspace): an AI-drafted MCQ bank version left in_review, written the way the drafting job writes
-- it (R5-35): the operator requests a drafting job, the authoring worker (bound to the org) moves it to running and
-- inserts the item, the version naming the job and its answer key. Records <key>, <key>_item and <key>_job.
create function pg_temp.ai_draft(p_key text, p_org uuid, p_ws uuid) returns uuid language plpgsql as $f$
declare v_job uuid; v_item uuid; v_ver uuid;
begin
  perform pg_temp.op();
  insert into public.ai_draft_jobs (org_id, workspace_id, requested_by, format, skill_key, difficulty, count, topic_sha256,
      provider, model_id, prompt_version)
    values (p_org, p_ws, case when p_org = pg_temp.id('B') then pg_temp.id('b_admin') else pg_temp.id('owner') end, 'mcq',
      'verbal', 0.50, 10, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')
    returning id into v_job;
  perform pg_temp.w('trace_authoring_worker', p_org);
  update public.ai_draft_jobs set status = 'running' where id = v_job;
  insert into public.items (org_id, workspace_id, format, skill_key) values (p_org, p_ws, 'mcq', 'verbal')
    returning id into v_item;
  insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id,
      content_sha256)
    values (p_org, v_item, 'mcq', '[synthetic] AI draft ' || p_key,
      '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, v_job, repeat('c', 64))
    returning id into v_ver;
  insert into public.item_answer_keys (org_id, item_version_id, format, key) values (p_org, v_ver, 'mcq', '{"option_id": "o1"}');
  perform pg_temp.op();
  insert into pg_temp.ids values (p_key, v_ver), (p_key || '_item', v_item), (p_key || '_job', v_job);
  return v_ver;
end
$f$;
-- qcard(session key): the session's quality score (meets the cutoff) and public quality card, as the quality worker.
create function pg_temp.qcard(p_sess text) returns void language plpgsql as $f$
declare v_score uuid := gen_random_uuid(); v_tv uuid;
begin
  perform pg_temp.w('trace_quality_worker', pg_temp.id('A'));
  select s.test_version_id into v_tv from public.sessions as s where s.id = pg_temp.id(p_sess);
  insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff,
      scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at)
    values (v_score, pg_temp.id('A'), pg_temp.id(p_sess), v_tv, 80, '[{"position": 1, "weight": 100, "score": 80}]', 40,
      true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00');
  insert into public.quality_cards (org_id, session_id, quality_score_id) values (pg_temp.id('A'), pg_temp.id(p_sess), v_score);
  perform pg_temp.op();
end
$f$;
-- flag(session key, rule, family, severity, untrusted): one integrity flag insert as the integrity worker; try()'s result.
create function pg_temp.flag(p_sess text, p_rule text, p_family text, p_severity text, p_untrusted boolean) returns text language plpgsql as $f$
declare v_r text;
begin
  perform pg_temp.w('trace_integrity_worker', pg_temp.id('A'));
  v_r := pg_temp.try(format($s$insert into integrity.flags (org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values (%L, %L, %L, %L, 'T3', %L, %L, false, 1, 1000, 'pending', '{1}')$s$,
    pg_temp.id('A'), pg_temp.id(p_sess), p_rule, p_family, p_severity, p_untrusted));
  perform pg_temp.op();
  return v_r;
end
$f$;
select plan(63);
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
select * from finish();
rollback;
