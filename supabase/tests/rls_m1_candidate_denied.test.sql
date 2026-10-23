-- rls_m1_candidate_denied (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_candidate_denied; §3.5 last line: trace_candidate, anon, service_role, hiring_manager and client viewer hold nothing on any M1 table; rule 5). rls_d1_candidate_denied already scans the whole catalogue for trace_candidate, trace_candidate_gateway and anon; this file adds service_role, the M1 functions, the RLS personas and direct calls. RED first: written from the spec before migration M1-b. Personas and content are synthetic.
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
select plan(14);
-- m1_tables(): every M1 table and view (M1-a, M1-b, M1-c, M1-d).
create function pg_temp.m1_tables() returns text[] language sql as $f$
  select array['skill_taxonomy', 'items', 'item_variants', 'item_variant_keys', 'item_exposure_events', 'pools', 'pool_items',
    'library_copy_requests', 'role_templates', 'jobs', 'section_pool_snapshot', 'integrity_setting_defs', 'integrity_presets',
    'org_integrity_locks', 'v_item_exposure', 'v_item_bank_quant_share', 'import_jobs', 'import_row_errors', 'ai_draft_jobs',
    'member_invites']
$f$;
grant execute on function pg_temp.m1_tables() to public;
-- m1_functions(): every function M1 adds in private or public (M1-a, M1-b, M1-c, M1-d).
create function pg_temp.m1_functions() returns text[] language sql as $f$
  select array['library_org_id', 'param_spec_valid', 'media_refs_valid', 'skill_key_exists', 'ai_draft_job_running',
    'import_job_open', 'item_version_ready', 'library_copy', 'library_viewer_ok', 'library_browse', 'library_exposure',
    'blueprint_valid', 'current_settings_catalog', 'integrity_settings_check', 'derive_signal_settings',
    'assert_drive_pool_ratio', 'library_reference', 'session_items_a_ai_gate', 'session_items_exposure',
    'ai_draft_job_running_in', 'item_media_in_org', 'bank_no_truncate', 'sealed_settings_catalogs', 'settings_catalog_sealed',
    'import_jobs_guard', 'import_jobs_audit', 'import_row_errors_guard', 'ai_draft_jobs_guard', 'ai_draft_jobs_audit',
    'save_item_variants', 'import_item_batch', 'save_test_draft', 'member_invites_guard', 'member_invites_audit',
    'provision_invited_member', 'ai_draft_job_has_room']
$f$;
grant execute on function pg_temp.m1_functions() to public;
-- held(role): the M1 tables and functions the role holds any privilege on (table, any column, EXECUTE), sorted.
create function pg_temp.held(p_role text) returns text language sql as $f$
  select coalesce(string_agg(x, ',' order by x), '') from (
    select 'table:' || t as x from unnest(pg_temp.m1_tables()) as t
    where has_table_privilege(p_role, 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(p_role, 'public.' || t, 'SELECT,INSERT,UPDATE,REFERENCES')
    union all
    select 'function:' || n.nspname || '.' || p.proname from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname = any (pg_temp.m1_functions())
      and has_function_privilege(p_role, p.oid, 'EXECUTE')
  ) as h
$f$;
grant execute on function pg_temp.held(text) to public;

-- ===== Grants: nothing for the candidate side or service_role =====
select is(pg_temp.held('anon'), '', 'anon holds nothing on any M1 table or function');
select is(pg_temp.held('trace_candidate'), '', 'trace_candidate holds nothing on any M1 table or function');
select is(pg_temp.held('trace_candidate_gateway'), '', 'trace_candidate_gateway holds nothing on any M1 table or function');
select is(pg_temp.held('service_role'), '', 'service_role holds nothing on any M1 table or function (service keys stay out of M1)');
select is((select count(*)::int from unnest(pg_temp.m1_tables()) as t), (select count(*)::int from pg_class as c join pg_namespace as n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any (pg_temp.m1_tables())), 'every listed M1 table and view exists (the list is not stale)');

-- Fixtures (operator path): one of every M1 row kind in org A, workspace A1.
select pg_temp.bank('b1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('b2', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('lib1', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'verbal', 0.50, 'approved');
insert into public.items (id, org_id, workspace_id, format, skill_key) values
  ('c2000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant');
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256) values
  ('c2100000-0000-4000-8000-000000000001', pg_temp.id('A'), 'c2000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] What is a + 1?',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64));
insert into public.item_variants (id, org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values
  ('c2200000-0000-4000-8000-000000000001', pg_temp.id('A'), 'c2100000-0000-4000-8000-000000000001', 1, '{"a": 3}',
   '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.50, repeat('c', 64));
insert into public.item_variant_keys (org_id, item_variant_id, key) values
  (pg_temp.id('A'), 'c2200000-0000-4000-8000-000000000001', '{"option_id": "o1"}');
select pg_temp.u('owner');
insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values
  (pg_temp.id('A'), pg_temp.id('A1'), array[pg_temp.id('lib1')]);
select pg_temp.op();
insert into public.pools (id, org_id, workspace_id, name, format) values
  ('d1000000-0000-4000-8000-0000000000c1', pg_temp.id('A'), pg_temp.id('A1'), 'Denied pool', 'mcq');
insert into public.pool_items (org_id, pool_id, item_version_id) values
  (pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000c1', pg_temp.id('b1')),
  (pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000c1', pg_temp.id('b2'));
insert into public.jobs (org_id, workspace_id, title) values (pg_temp.id('A'), pg_temp.id('A1'), 'Denied job');
insert into public.role_templates (org_id, template_key, version, name, keywords, blueprint, preset_key) values
  (pg_temp.id('A'), 'denied_tpl', 1, 'Denied template', '{night}',
   '{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "verbal", "drawCount": 1, "available": true}], "totalTimeSeconds": 600}', 'standard');
insert into public.org_integrity_locks (org_id, setting_key, locked_value) values (pg_temp.id('A'), 'question_copy', 'on');
select pg_temp.tv('v2', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sp', 'v2', 1, 'mcq', 'd1000000-0000-4000-8000-0000000000c1', 1, 100);
select pg_temp.preset('v2', 'standard');
select pg_temp.publish('v2');
select pg_temp.session('a', 'v2', 31);
select pg_temp.w('trace_worker', pg_temp.id('A'));
insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) values
  (pg_temp.id('A'), pg_temp.id('a'), pg_temp.id('sp'), pg_temp.id('b1'), 1, '2026-10-14 10:05:00+00');
select pg_temp.op();
-- visible(): rows of each M1 table and view the current role can read ('-' when it has no grant at all).
create function pg_temp.visible() returns text language plpgsql as $f$
declare v_out text := ''; t text; n bigint;
begin
  foreach t in array pg_temp.m1_tables() loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      v_out := v_out || t || '=' || n || ' ';
    exception when insufficient_privilege then
      v_out := v_out || t || '=- ';
    end;
  end loop;
  return trim(v_out);
end
$f$;
grant execute on function pg_temp.visible() to public;
select is((select string_agg(t, ',' order by t) from unnest(pg_temp.m1_tables()) as t where t not like 'v\_%' and not exists (select 1 from information_schema.columns as c where c.table_schema = 'public' and c.table_name = t and c.column_name = 'org_id')), null, 'every M1 table has org_id (tenancy rule)');

-- ===== RLS personas: a hiring manager and an outsider read nothing =====
select pg_temp.u('hm');
select is(pg_temp.visible(), 'skill_taxonomy=- items=0 item_variants=0 item_variant_keys=0 item_exposure_events=0 pools=0 pool_items=0 library_copy_requests=0 role_templates=0 jobs=0 section_pool_snapshot=0 integrity_setting_defs=- integrity_presets=- org_integrity_locks=0 v_item_exposure=0 v_item_bank_quant_share=0 import_jobs=0 import_row_errors=0 ai_draft_jobs=0 member_invites=0', 'a hiring manager of org A reads no M1 row');
select pg_temp.u('outsider');
select is(pg_temp.visible(), 'skill_taxonomy=- items=0 item_variants=0 item_variant_keys=0 item_exposure_events=0 pools=0 pool_items=0 library_copy_requests=0 role_templates=0 jobs=0 section_pool_snapshot=0 integrity_setting_defs=- integrity_presets=- org_integrity_locks=0 v_item_exposure=0 v_item_bank_quant_share=0 import_jobs=0 import_row_errors=0 ai_draft_jobs=0 member_invites=0', 'a user with no membership reads no M1 row');
select pg_temp.u('owner');
select is(pg_temp.visible(), 'skill_taxonomy=- items=4 item_variants=1 item_variant_keys=1 item_exposure_events=1 pools=1 pool_items=2 library_copy_requests=1 role_templates=1 jobs=1 section_pool_snapshot=2 integrity_setting_defs=- integrity_presets=- org_integrity_locks=1 v_item_exposure=1 v_item_bank_quant_share=1 import_jobs=0 import_row_errors=0 ai_draft_jobs=0 member_invites=0', 'control: the owner reads the fixtures (so the zeros above are denials)');
select pg_temp.op();

-- ===== Direct calls by the candidate roles =====
set local role trace_candidate;
select is(pg_temp.visible(), 'skill_taxonomy=- items=- item_variants=- item_variant_keys=- item_exposure_events=- pools=- pool_items=- library_copy_requests=- role_templates=- jobs=- section_pool_snapshot=- integrity_setting_defs=- integrity_presets=- org_integrity_locks=- v_item_exposure=- v_item_bank_quant_share=- import_jobs=- import_row_errors=- ai_draft_jobs=- member_invites=-', 'trace_candidate: every M1 table and view is permission denied');
select matches(pg_temp.try($$select * from private.library_browse(null, null, null, null, null, null, null, null, 10)$$), '^42501 permission denied', 'trace_candidate: library_browse is denied');
select matches(pg_temp.try($$select private.library_reference(null, null, null, 'templates')$$), '^42501 permission denied', 'trace_candidate: library_reference is denied');
reset role;
set local role anon;
select is(pg_temp.visible(), 'skill_taxonomy=- items=- item_variants=- item_variant_keys=- item_exposure_events=- pools=- pool_items=- library_copy_requests=- role_templates=- jobs=- section_pool_snapshot=- integrity_setting_defs=- integrity_presets=- org_integrity_locks=- v_item_exposure=- v_item_bank_quant_share=- import_jobs=- import_row_errors=- ai_draft_jobs=- member_invites=-', 'anon: every M1 table and view is permission denied');
reset role;
set local role service_role;
select is(pg_temp.visible(), 'skill_taxonomy=- items=- item_variants=- item_variant_keys=- item_exposure_events=- pools=- pool_items=- library_copy_requests=- role_templates=- jobs=- section_pool_snapshot=- integrity_setting_defs=- integrity_presets=- org_integrity_locks=- v_item_exposure=- v_item_bank_quant_share=- import_jobs=- import_row_errors=- ai_draft_jobs=- member_invites=-', 'service_role: every M1 table and view is permission denied');
reset role;
select * from finish();
rollback;
