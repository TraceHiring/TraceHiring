-- rls_m1_bank (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_bank; §3.2 items, §3.3 item_versions, §3.4, §3.5, §4.1; AT-M1-02, AT-M1-06, AT-M1-09, AT-M1-25; R2-2, R2-5, R3-8, R5-22, R5-28 c, R5-38, R5-40; library copy E7, E8). RED first: written from the spec before migration M1-a. Personas and items are synthetic.
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
select plan(140);
-- Fixtures (operator path): approved, draft and in-review bank items in orgs A, B and the library.
select pg_temp.bank('qa1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant', 0.50, 'approved');
select pg_temp.bank('qa2', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant', 0.40, 'approved');
select pg_temp.bank('qx', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant', 0.40, 'retired');
select pg_temp.bank('qdq', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant', 0.40, 'draft');
select pg_temp.bank('va1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('qr1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'in_review');
select pg_temp.bank('qr2', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'in_review');
select pg_temp.bank('q2r', pg_temp.id('A'), pg_temp.id('A2'), 'mcq', 'verbal', 0.50, 'in_review');
select pg_temp.bank('qb1', pg_temp.id('B'), pg_temp.id('BW'), 'mcq', 'verbal', 0.50, 'in_review');
select pg_temp.bank('la1', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('la2', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'verbal', 0.50, 'in_review');
-- A parameterised quant item (approved) for the share metric: version, one variant and its key, then review.
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
update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000001';
update public.item_versions set status = 'approved', approved_by = pg_temp.id('owner') where id = 'c2100000-0000-4000-8000-000000000001';
-- An inline (D1-mode) test version with one section, for the inline-row cases.
insert into public.tests (id, org_id, workspace_id, name, created_by) values
  ('e1000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'Test One', pg_temp.id('owner'));
insert into public.test_versions (id, org_id, test_id, total_time_seconds, quality_cutoff, created_by) values
  ('f1000000-0000-4000-8000-000000000001', pg_temp.id('A'), 'e1000000-0000-4000-8000-000000000001', 1800, 40, pg_temp.id('owner'));
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-000000000001', pg_temp.id('A'), 'f1000000-0000-4000-8000-000000000001', 1, 'Choices', 'mcq', 1);

-- ===== items: I =====
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'quant')$$), 'OK 1', 'items I: owner creates a bank item in workspace A1');
select is(pg_temp.try($$insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'logical')$$), 'OK 1', 'items I: owner creates a second bank item');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'astrology')$$), '^23503 TRACE_GUARD: skill not found', 'items I: a skill outside the library taxonomy is refused');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'Bad Skill')$$), '^23503 TRACE_GUARD: skill not found', 'items I: a malformed skill key is not in the taxonomy either');
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'written', 'written_communication')$$), 'OK 1', 'items I: recruiter creates a bank item');
select pg_temp.u('ws_recruiter');
select is(pg_temp.try($$insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'mcq', 'verbal')$$), 'OK 1', 'items I: workspace recruiter creates a bank item in workspace A2');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), '^42501', 'items I: workspace recruiter cannot create an item in workspace A1 (fence)');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), '^42501', 'items I: reviewer cannot create an item');
select pg_temp.u('hm');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), '^42501', 'items I: hiring manager cannot create an item');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), '^42501', 'items I: org B admin cannot create an item in org A (cross-org)');
select pg_temp.op();
select is((select created_by from public.items where id = 'c1000000-0000-4000-8000-000000000002'), pg_temp.id('recruiter'), 'items I: created_by is the caller');
select is((select pg_temp.keys(details) || '|' || actor_kind::text || '|' || (actor_user_id = pg_temp.id('recruiter'))::text from public.audit_log where action = 'item.create' and object_id = 'c1000000-0000-4000-8000-000000000002'), 'format|org_user|true', 'items event: item.create carries only the format, by the creating user');

-- ===== items: S =====
select pg_temp.u('owner');
select is((select count(*)::int from public.items where org_id = pg_temp.id('A')) > 10, true, 'items S: owner sees the org A bank');
select is((select count(*)::int from public.items where org_id <> pg_temp.id('A')), 0, 'items S: owner sees no other org (library and B hidden)');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.items where workspace_id = pg_temp.id('A1')), 0, 'items S: workspace recruiter sees nothing in workspace A1');
select is((select count(*)::int from public.items where workspace_id = pg_temp.id('A2')) >= 2, true, 'items S: workspace recruiter sees workspace A2 items');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.items where org_id = pg_temp.id('A')) > 10, true, 'items S: reviewer sees the workspace bank (approval arm)');
select pg_temp.u('reviewer_aal1');
select is((select count(*)::int from public.items), 0, 'items S: reviewer at aal1 sees nothing');
select pg_temp.u('hm');
select is((select count(*)::int from public.items), 0, 'items S: hiring manager sees nothing');
select pg_temp.u('outsider');
select is((select count(*)::int from public.items), 0, 'items S: a user without a membership sees nothing');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.items where org_id = pg_temp.id('A')), 0, 'items S: org B admin sees no org A item');

-- ===== items: U / D =====
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.items set format = 'written' where id = 'c1000000-0000-4000-8000-000000000001'$$), '^42501', 'items U: format is immutable');
select matches(pg_temp.try($$update public.items set workspace_id = 'b1000000-0000-4000-8000-000000000002' where id = 'c1000000-0000-4000-8000-000000000001'$$), '^42501', 'items U: workspace is immutable');
select is(pg_temp.try($$update public.items set archived_at = now() where id = 'c1000000-0000-4000-8000-000000000001'$$), 'OK 1', 'items U: owner archives an item');
select is(pg_temp.try($$delete from public.items where id = 'c1000000-0000-4000-8000-000000000004'$$), 'OK 1', 'items D: an item without versions is deleted');
select matches(pg_temp.try(format($$delete from public.items where id = %L$$, pg_temp.id('qa1_item'))), '^42501 TRACE_GUARD: an item with versions cannot be deleted', 'items D: an item with versions is not deleted (R3-8)');
select pg_temp.u('reviewer');
select is(pg_temp.try(format($$delete from public.items where id = %L$$, pg_temp.id('va1_item'))), 'OK 0', 'items D: reviewer deletes nothing');

-- ===== item_versions (bank): I =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, skill_key, difficulty, content_sha256, origin) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] Bank written v1', (select id from public.rubric_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and rubric_key = 'default'), 'written_communication', 0.50, repeat('d', 64), 'library')$$), 'OK 1', 'versions I: recruiter adds a bank version (client origin value supplied)');
select is(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, skill_key, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] Bank written v2', (select id from public.rubric_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and rubric_key = 'default'), 'written_communication', 0.50, repeat('d', 64))$$), 'OK 1', 'versions I: recruiter adds a second version');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, content_sha256, status) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] x', (select id from public.rubric_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and rubric_key = 'default'), repeat('d', 64), 'approved')$$), '^42501 permission denied', 'versions I: status is outside the insert grant');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, content_sha256, origin) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] x', (select id from public.rubric_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and rubric_key = 'default'), repeat('d', 64), 'ai')$$), '^23514', 'versions I: an origin outside the CHECK still fails the CHECK (rls_d1_tests unchanged, R5-28)');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'mcq', '[synthetic] x', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', repeat('d', 64))$$), '^42501 TRACE_GUARD: the version format differs from its item', 'versions I: the version format is the item format');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, content_sha256, position) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] x', (select id from public.rubric_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and rubric_key = 'default'), repeat('d', 64), 3)$$), '^23514', 'versions I: a bank row with a position breaks the placement CHECK (R2-2)');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, skill_key, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] No rubric', 'written_communication', 0.50, repeat('d', 64))$$), '^23514', 'versions I (carried Medium): a written bank version without a rubric is refused, so none reaches review, approval or a pool');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000009', 'mcq', '[synthetic] x', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', repeat('d', 64))$$), '^23503 TRACE_GUARD: item not found', 'versions I: a bank version needs its item');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] x', (select id from public.rubric_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and rubric_key = 'default'), repeat('d', 64))$$), '^42501', 'versions I: workspace recruiter cannot add a version to a workspace A1 item (the workspace comes from the item)');
select pg_temp.op();
select is((select origin || '|' || status::text || '|' || version_no || '|' || (workspace_id = pg_temp.id('A1'))::text || '|' || (created_by = pg_temp.id('recruiter'))::text || '|' || coalesce(approved_by::text, 'null') from public.item_versions where stem = '[synthetic] Bank written v1'), 'human|draft|1|true|true|null', 'versions I: origin from the write path, draft, version 1, workspace from the item, created by the caller');
select is((select version_no from public.item_versions where stem = '[synthetic] Bank written v2'), 2::smallint, 'versions I: the next version gets the next number');
-- Inline rows (D1 mode): the test comes from the section; an inline row cannot take a bank identity (R2-1, R5-28 c).
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.item_versions (org_id, section_id, format, position, stem, options, origin, content_sha256) values ('a1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'mcq', 1, '[synthetic] Inline one', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'human', repeat('c', 64))$$), 'OK 1', 'inline I: owner adds an inline item without naming the test or version');
select matches(pg_temp.try(format($$insert into public.item_versions (org_id, section_id, item_id, format, position, stem, options, content_sha256) values ('a1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', %L, 'mcq', 2, '[synthetic] Inline two', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', repeat('c', 64))$$, pg_temp.id('qa1_item'))), '^42501 TRACE_GUARD: an inline item cannot take a bank item identity', 'inline I: an inline item cannot reuse a bank item id');
select pg_temp.op();
select is((select (test_id = 'e1000000-0000-4000-8000-000000000001')::text || '|' || status::text from public.item_versions where stem = '[synthetic] Inline one'), 'true|approved', 'inline I: test filled from the section; an inline item is approved with its version (R5-28 c inline proof)');
select is((select count(*)::int from public.item_versions where section_id is not null and test_id is null), 0, 'inline I: no inline row exists without its test');

-- ===== trace_authoring_worker writes (R5-35, DB-M1-5, SEC-M1-2, SEC-M1-3). No drafting job can be running before
-- migration M1-c creates ai_draft_jobs, so every worker write is refused here; M1-c adds the allowed cases. =====
insert into public.items (id, org_id, workspace_id, format, skill_key) values
  ('c3000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal');
-- The operator path names the drafting job id (no ai_draft_jobs row exists before M1-c; M1-c adds the FK and the job).
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, origin, ai_draft_job_id, content_sha256) values
  ('c3100000-0000-4000-8000-000000000001', pg_temp.id('A'), 'c3000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] AI draft without its key',
   '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'ai_draft', 'c3900000-0000-4000-8000-000000000001', repeat('c', 64));
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), '^42501 TRACE_GUARD: the authoring worker writes only for a running drafting job', 'worker items I (SEC-M1-3): no item without a running drafting job of its org and workspace');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 'mcq', 'verbal')$$), '^42501', 'worker items I: a worker bound to org A writes no org B item (cross-org)');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] Worker v2', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, repeat('c', 64))$$), '^42501 TRACE_GUARD: an AI draft needs its running drafting job', 'worker versions I (R5-35): no version without a running drafting job');
select matches(pg_temp.try(format($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000003', %L, 'mcq', '[synthetic] Worker cross', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, repeat('c', 64))$$, pg_temp.id('qb1_item'))), '^42501', 'worker versions I: a worker bound to org A writes no org B version (cross-org)');
select matches(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) values ('a1000000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 'mcq', '{"option_id": "o1"}')$$), '^42501 TRACE_GUARD: the authoring worker keys only an AI draft of its running job', 'worker keys I (SEC-M1-3): no key for an in-review AI draft without its running job');
select matches(pg_temp.try(format($$insert into public.item_answer_keys (org_id, item_version_id, format, key) values ('a1000000-0000-4000-8000-000000000001', %L, 'mcq', '{"option_id": "o2"}')$$, pg_temp.id('qdq'))), '^42501 TRACE_GUARD: the authoring worker keys only an AI draft of its running job', 'worker keys I (SEC-M1-3): never the key of a human draft');
select matches(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) select org_id, id, 'mcq', '{"option_id": "o1"}' from public.item_versions where stem = '[synthetic] Inline one'$$), '^42501 TRACE_GUARD: the authoring worker keys only an AI draft of its running job', 'worker keys I (SEC-M1-3): never the key of an inline item');
select matches(pg_temp.try(format($$insert into public.item_answer_keys (org_id, item_version_id, format, key) values ('a1000000-0000-4000-8000-000000000003', %L, 'mcq', '{"option_id": "o1"}')$$, pg_temp.id('qb1'))), '^42501', 'worker keys I: a worker bound to org A writes no org B key (cross-org)');
select matches(pg_temp.try('select * from public.item_answer_keys'), '^42501 permission denied', 'worker keys S (SEC-M1-2): the authoring worker reads no answer key');
select is(private.media_refs_valid('[{"key": "item-media/a1000000-0000-4000-8000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", "alt": "A chart"}]'), true, 'validators (R2-6): media_refs_valid runs for the authoring worker');
select is(private.param_spec_valid('{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "count": 5}'), true, 'validators (R2-6, SEC-M1-1): param_spec_valid runs for the authoring worker; a spec without correctOptionId has a valid shape');
select pg_temp.op();

-- ===== SEC-M1-5: an item image lives under its own org's prefix (bank and inline rows, insert and edit) =====
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), 'OK 1', 'media: owner creates an item for the image cases');
select is(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, media, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000005', 'mcq', '[synthetic] With image', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', '[{"key": "item-media/a1000000-0000-4000-8000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", "alt": "A chart"}]', repeat('d', 64))$$), 'OK 1', 'media: a bank version takes an image under its org''s prefix');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, media, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000005', 'mcq', '[synthetic] Foreign image', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', '[{"key": "item-media/a1000000-0000-4000-8000-000000000003/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", "alt": "A chart"}]', repeat('d', 64))$$), '^42501 TRACE_GUARD: an item image belongs to the item''s org', 'media (SEC-M1-5): a bank version cannot name an org B image');
select matches(pg_temp.try(format($$insert into public.item_versions (org_id, item_id, format, stem, options, media, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000005', 'mcq', '[synthetic] Library image', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', %L, repeat('d', 64))$$, jsonb_build_array(jsonb_build_object('key', 'item-media/' || pg_temp.id('L') || '/' || repeat('a', 64) || '.png', 'alt', 'A chart')))), '^42501 TRACE_GUARD: an item image belongs to the item''s org', 'media (SEC-M1-5): a human version cannot name a library image (only a library copy may)');
select matches(pg_temp.try($$update public.item_versions set media = '[{"key": "item-media/a1000000-0000-4000-8000-000000000003/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png", "alt": "A chart"}]' where stem = '[synthetic] With image'$$), '^42501 TRACE_GUARD: an item image belongs to the item''s org', 'media (SEC-M1-5): a draft edit cannot switch to an org B image');
select matches(pg_temp.try($$update public.item_versions set media = '[{"key": "elsewhere/a.png", "alt": "A chart"}]' where stem = '[synthetic] With image'$$), '^23514', 'media (media_refs_valid): a key outside the item-media prefix breaks the CHECK');
select matches(pg_temp.try($$insert into public.item_versions (org_id, section_id, format, position, stem, options, media, content_sha256) values ('a1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'mcq', 5, '[synthetic] Inline foreign image', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', '[{"key": "item-media/a1000000-0000-4000-8000-000000000003/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", "alt": "A chart"}]', repeat('c', 64))$$), '^42501 TRACE_GUARD: an item image belongs to the item''s org', 'media (SEC-M1-5): an inline item cannot name an org B image');
select matches(pg_temp.try($$update public.item_versions set media = '[{"key": "item-media/a1000000-0000-4000-8000-000000000003/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", "alt": "A chart"}]' where stem = '[synthetic] Inline one'$$), '^42501 TRACE_GUARD: an item image belongs to the item''s org', 'media (SEC-M1-5): an inline edit cannot switch to an org B image');
select is(pg_temp.try($$update public.item_versions set media = '[{"key": "item-media/a1000000-0000-4000-8000-000000000001/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.webp", "alt": "A chart"}]' where stem = '[synthetic] Inline one'$$), 'OK 1', 'media: an inline draft item takes an image under its org''s prefix');

-- ===== Lifecycle (§4.1) =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.item_versions set stem = '[synthetic] Bank written v1 edited' where stem = '[synthetic] Bank written v1'$$), 'OK 1', 'lifecycle: a draft is edited');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 1', 'lifecycle: the author submits the draft');
select matches(pg_temp.try($$update public.item_versions set stem = 'changed' where stem = '[synthetic] Bank written v1 edited'$$), '^42501 TRACE_GUARD: an item version is frozen once it leaves draft', 'lifecycle: content is frozen once in review (I-M1-3)');
select matches(pg_temp.try($$update public.item_versions set status = 'draft' where stem = '[synthetic] Bank written v1 edited'$$), '^42501 TRACE_GUARD: item status change not allowed', 'lifecycle: in_review never goes back to draft');
select pg_temp.u('reviewer_aal1');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 0', 'approval: reviewer at aal1 approves nothing');
select pg_temp.u('ws_reviewer');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 0', 'approval: a reviewer fenced to workspace A2 cannot approve a workspace A1 item (R5-38)');
select pg_temp.u('b_admin');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 0', 'approval: org B admin approves nothing in org A (cross-org)');
select pg_temp.u('hm');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 0', 'approval: hiring manager approves nothing');
select pg_temp.u('reviewer');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 1', 'approval: the reviewer approves an in-review item (M1-3)');
select pg_temp.op();
select is((select (approved_by = pg_temp.id('reviewer'))::text || '|' || (approved_at is not null)::text || '|' || coalesce(reviewed_by::text, 'null') from public.item_versions where stem = '[synthetic] Bank written v1 edited'), 'true|true|null', 'approval: approved_by is the approver and approved_at is set (AT-M1-09)');
select is((select pg_temp.keys(a.details) || '|' || (a.actor_user_id = pg_temp.id('reviewer'))::text || '|' || (a.details ->> 'self_approved') || '|' || (a.details ->> 'from') || '>' || (a.details ->> 'to') from public.audit_log as a join public.item_versions as v on v.id = a.object_id where a.action = 'item.approve' and v.stem = '[synthetic] Bank written v1 edited'), 'from,item_version_id,self_approved,to|true|false|in_review>approved', 'approval event: item.approve names the approver, ids and enums only (AT-M1-09, AT-M1-25)');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$update public.item_versions set difficulty = 0.9 where stem = '[synthetic] Bank written v1 edited'$$), '^42501 TRACE_GUARD: an item version is frozen once it leaves draft', 'lifecycle: approved content is frozen');
select matches(pg_temp.try(format($$update public.item_versions set approved_by = %L where stem = '[synthetic] Bank written v1 edited'$$, pg_temp.id('recruiter'))), '^42501 permission denied', 'lifecycle: approved_by is outside the update grant');
select pg_temp.u('reviewer');
select is(pg_temp.try($$update public.item_versions set status = 'retired' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 0', 'lifecycle: a reviewer cannot retire an item');
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.item_versions set status = 'retired' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 1', 'lifecycle: a recruiter retires an approved item');
select matches(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v1 edited'$$), '^42501', 'lifecycle: retired is terminal');
-- Self-approval in a customer org is allowed and audited (M1-3).
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where stem = '[synthetic] Bank written v2'$$), 'OK 1', 'self-approval: the recruiter submits their own draft');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v2'$$), 'OK 1', 'self-approval: the recruiter approves their own item');
select pg_temp.op();
select is((select a.details ->> 'self_approved' from public.audit_log as a join public.item_versions as v on v.id = a.object_id where a.action = 'item.approve' and v.stem = '[synthetic] Bank written v2'), 'true', 'self-approval event: self_approved is true');
select pg_temp.u('owner');
select is(pg_temp.try(format($$update public.item_versions set status = 'approved' where id = %L$$, pg_temp.id('qr1'))), 'OK 1', 'approval: an owner is an approver (R5-40)');
-- Send back (R5-22): not_approved is terminal.
select pg_temp.u('reviewer');
select is(pg_temp.try(format($$update public.item_versions set status = 'not_approved' where id = %L$$, pg_temp.id('qr2'))), 'OK 1', 'send back: the reviewer sends an item back');
select pg_temp.u('owner');
select matches(pg_temp.try(format($$update public.item_versions set status = 'approved' where id = %L$$, pg_temp.id('qr2'))), '^42501', 'send back: not_approved is terminal');
select pg_temp.op();
select is((select pg_temp.keys(a.details) || '|' || (a.details ->> 'to') from public.audit_log as a where a.action = 'item.not_approved' and a.object_id = pg_temp.id('qr2')), 'from,item_version_id,self_approved,to|not_approved', 'send back event: item.not_approved');
-- Readiness: an MCQ item needs its key before review; a servable bank item is tagged (AT-M1-02).
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] No difficulty', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'quant', repeat('d', 64))$$), 'OK 1', 'readiness: owner adds an MCQ draft without difficulty or key');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where stem = '[synthetic] No difficulty'$$), '^42501 TRACE_GUARD: a multiple-choice item needs its answer key', 'readiness: an MCQ item without its key cannot be submitted');
select is(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) select org_id, id, 'mcq', '{"option_id": "o2"}' from public.item_versions where stem = '[synthetic] No difficulty'$$), 'OK 1', 'readiness: the key is added to the draft');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where stem = '[synthetic] No difficulty'$$), 'OK 1', 'readiness: then it is submitted');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] No difficulty'$$), '^23514', 'AT-M1-02: an approved bank item needs a difficulty (CHECK)');
select pg_temp.u('owner');
select matches(pg_temp.try($$delete from public.item_versions where stem = '[synthetic] No difficulty'$$), '^42501 TRACE_GUARD: only a draft item version can be deleted', 'versions D: an in-review version is not deleted');
select matches(pg_temp.try(format($$delete from public.item_versions where id = %L$$, pg_temp.id('qa1'))), '^42501 TRACE_GUARD: only a draft item version can be deleted', 'versions D: an approved version is not deleted');
select is(pg_temp.try(format($$delete from public.item_answer_keys where item_version_id = %L$$, pg_temp.id('qdq'))), 'OK 1', 'versions D: the key of a draft version is deleted');
select is(pg_temp.try(format($$delete from public.item_versions where id = %L$$, pg_temp.id('qdq'))), 'OK 1', 'versions D: then the draft version itself');

-- ===== Library expert review (M1-3, ABH-6, AT-M1-02) =====
select pg_temp.u('lib_author');
select is(pg_temp.try(format($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256) values (%L, %L, 'mcq', '[synthetic] Library v2', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, repeat('e', 64))$$, pg_temp.id('L'), pg_temp.id('la1_item'))), 'OK 1', 'library: the author adds a new library version');
select is(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) select org_id, id, 'mcq', '{"option_id": "o1"}' from public.item_versions where stem = '[synthetic] Library v2'$$), 'OK 1', 'library: the author adds its key');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where stem = '[synthetic] Library v2'$$), 'OK 1', 'library: the author submits it');
-- SEC-M1-4 (ABH-6): the key review is an attested action of its own: the reviewer records it on the in-review version
-- (key_reviewed_by null -> themselves, nothing else changes); the approval then requires it and cannot name it.
select matches(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L where stem = '[synthetic] Library v2'$$, pg_temp.id('lib_author'))), '^42501 TRACE_GUARD: a library item needs a reviewer and a key reviewer other than its author', 'library (SEC-M1-4): the author cannot review their own key');
select matches(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Library v2'$$), '^42501 TRACE_GUARD: a library item needs a reviewer and a key reviewer other than its author', 'library: the author cannot be the reviewer');
select pg_temp.u('owner');
select is(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L where stem = '[synthetic] Library v2'$$, pg_temp.id('owner'))), 'OK 0', 'library (SEC-M1-4): a customer owner records no library key review');
select matches(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L where stem = '[synthetic] No difficulty'$$, pg_temp.id('owner'))), '^42501 TRACE_GUARD: an item version is frozen once it leaves draft', 'library (SEC-M1-4): a customer item has no key review step');
select pg_temp.u('lib_expert');
select matches(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Library v2'$$), '^42501 TRACE_GUARD: a library item needs a reviewer and a key reviewer other than its author', 'library: the key review comes before the approval');
select matches(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L where stem = '[synthetic] Library v2'$$, pg_temp.id('lib_author'))), '^42501 TRACE_GUARD: the key reviewer records their own review', 'library (SEC-M1-4): an expert cannot record a key review in another member''s name');
select matches(pg_temp.try(format($$update public.item_versions set status = 'approved', key_reviewed_by = %L where stem = '[synthetic] Library v2'$$, pg_temp.id('lib_expert'))), '^42501 TRACE_GUARD: the key review is recorded in its own update', 'library (SEC-M1-4): the approval does not name the key reviewer');
select matches(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L, difficulty = 0.60 where stem = '[synthetic] Library v2'$$, pg_temp.id('lib_expert'))), '^42501 TRACE_GUARD: an item version is frozen once it leaves draft', 'library (SEC-M1-4): the key review changes nothing else');
select is(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L where stem = '[synthetic] Library v2'$$, pg_temp.id('lib_expert'))), 'OK 1', 'library (SEC-M1-4): the expert records their own key review');
select matches(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L where stem = '[synthetic] Library v2'$$, pg_temp.id('lib_author'))), '^42501 TRACE_GUARD: an item version is frozen once it leaves draft', 'library (SEC-M1-4): a recorded key review is final');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Library v2'$$), 'OK 1', 'library: an expert other than the author approves after the key review');
select pg_temp.op();
select is((select (reviewed_by = pg_temp.id('lib_expert'))::text || '|' || (key_reviewed_by = pg_temp.id('lib_expert'))::text || '|' || (approved_by = pg_temp.id('lib_expert'))::text from public.item_versions where stem = '[synthetic] Library v2'), 'true|true|true', 'library: reviewer, key reviewer and approver recorded');
select is((select pg_temp.keys(details) || '|' || actor_kind::text || '|' || (actor_user_id = pg_temp.id('lib_expert'))::text || '|' || (details ->> 'item_version_id' = object_id::text)::text from public.audit_log where action = 'item.key_review' and object_id = (select id from public.item_versions where stem = '[synthetic] Library v2')), 'item_version_id|org_user|true|true', 'library (carried Low): the key review is audited as item.key_review by its reviewer');

-- ===== Library copy (R2-5, R3-4, R3-8, E7, E8) =====
select pg_temp.u('owner');
select is(pg_temp.try(format($$insert into public.library_copy_requests (id, org_id, workspace_id, library_item_version_ids) values ('c4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('la1'))), 'OK 1', 'library copy: owner copies an approved library item into workspace A1');
select pg_temp.op();
select is((select v.origin || '|' || v.status::text || '|' || (v.approved_by = pg_temp.id('owner'))::text || '|' || coalesce(v.reviewed_by::text, 'null') || '|' || (v.workspace_id = pg_temp.id('A1'))::text || '|' || (r.result_item_version_ids = array[v.id])::text from public.item_versions as v join public.library_copy_requests as r on r.id = 'c4000000-0000-4000-8000-000000000001' where v.org_id = pg_temp.id('A') and v.source_item_version_id = pg_temp.id('la1')), 'library|approved|true|null|true|true', 'library copy: an approved copy by the copier, no expert reviewer in the customer org, ids returned (R2-10, R3-4)');
select is((select count(*)::int from public.item_answer_keys as k join public.item_versions as v on v.id = k.item_version_id where v.org_id = pg_temp.id('A') and v.source_item_version_id = pg_temp.id('la1') and k.library_sourced), 1, 'library copy: the key is copied as library_sourced');
select pg_temp.u('owner');
select is(pg_temp.try(format($$insert into public.library_copy_requests (id, org_id, workspace_id, library_item_version_ids) values ('c4000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('la1'))), 'OK 1', 'library copy: a second request for the same item succeeds');
select pg_temp.op();
select is((select count(*)::int from public.item_versions where org_id = pg_temp.id('A') and source_item_version_id = pg_temp.id('la1')), 1, 'library copy: the existing copy is reused (one copy per workspace and library version)');
select is((select pg_temp.keys(details) || '|' || (details ->> 'count') || '|' || (details ->> 'reused') from public.audit_log where action = 'library.copy' and object_id = 'c4000000-0000-4000-8000-000000000002'), 'count,reused|0|1', 'library copy event: counts only');
select pg_temp.u('owner');
select matches(pg_temp.try(format($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('la2'))), '^42501 TRACE_GUARD: only approved library items can be copied', 'library copy: an in-review library item cannot be copied');
select matches(pg_temp.try(format($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('qa1'))), '^42501 TRACE_GUARD: only approved library items can be copied', 'library copy: a customer item is not a library item');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try(format($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('la1'))), '^42501', 'library copy: workspace recruiter cannot copy into workspace A1 (fence)');
select pg_temp.u('reviewer');
select matches(pg_temp.try(format($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('la1'))), '^42501', 'library copy: a reviewer cannot copy');
select pg_temp.u('lib_author');
select matches(pg_temp.try(format($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values (%L, %L, array[%L]::uuid[])$$, pg_temp.id('L'), pg_temp.id('LW'), pg_temp.id('la1'))), '^42501 TRACE_GUARD: a copy goes from the library into a customer org', 'library copy: the library does not copy into itself');
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.library_copy_requests set result_item_version_ids = null where id = 'c4000000-0000-4000-8000-000000000001'$$), '^42501', 'library copy: a request is immutable');
-- E8: the daily cap. 1,998 more copies made today (operator path) bring org A to 1,999; one more copy fits, the next does not.
select pg_temp.op();
create temp table cap_src as select gen_random_uuid() as item, gen_random_uuid() as ver, n from generate_series(1, 2000) as n;
grant select on cap_src to public;
insert into public.items (id, org_id, workspace_id, format, skill_key, created_by)
  select item, pg_temp.id('L'), pg_temp.id('LW'), 'written', 'written_communication', pg_temp.id('lib_author') from cap_src;
insert into public.item_versions (id, org_id, item_id, format, stem, rubric_version_id, skill_key, difficulty, content_sha256, created_by)
  select ver, pg_temp.id('L'), item, 'written', '[synthetic] Cap ' || n, (select id from public.rubric_versions where org_id = pg_temp.id('L') and rubric_key = 'default'), 'written_communication', 0.50, repeat('e', 64), pg_temp.id('lib_author') from cap_src;
update public.item_versions set status = 'in_review' where id in (select ver from cap_src);
update public.item_versions set status = 'approved', approved_by = pg_temp.id('lib_expert'), reviewed_by = pg_temp.id('lib_expert'), key_reviewed_by = pg_temp.id('lib_expert') where id in (select ver from cap_src);
create temp table cap_copy as select gen_random_uuid() as item, ver as src, n from cap_src where n <= 1998;
insert into public.items (id, org_id, workspace_id, format, skill_key) select item, pg_temp.id('A'), pg_temp.id('A2'), 'written', 'written_communication' from cap_copy;
insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, skill_key, difficulty, content_sha256, origin, source_item_version_id)
  select pg_temp.id('A'), item, 'written', '[synthetic] Copy ' || n, (select id from public.rubric_versions where org_id = pg_temp.id('A') and rubric_key = 'default'), 'written_communication', 0.50, repeat('e', 64), 'library', src from cap_copy;
select is((select count(*)::int from public.item_versions where org_id = pg_temp.id('A') and origin = 'library'), 1999, 'library cap: org A holds 1,999 library copies made today');
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) select 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[ver] from cap_src where n = 1999$$), 'OK 1', 'library cap: the 2,000th copy of the day is made');
select matches(pg_temp.try($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) select 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[ver] from cap_src where n = 2000$$), '^42501 TRACE_GUARD: library copy cap reached', 'library cap: the 2,001st is refused (E8)');
select is(pg_temp.try(format($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('la1'))), 'OK 1', 'library cap: reusing an existing copy is not counted');

-- ===== AT-M1-06: the share metric counts approved quant items only =====
select pg_temp.u('owner');
select is((select quant_items_approved || '/' || quant_items_parameterised from public.v_item_bank_quant_share where workspace_id = pg_temp.id('A1')), '3/1', 'AT-M1-06: workspace A1 has 3 approved quant items, 1 parameterised (retired, draft, other skills and inline items not counted)');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.v_item_bank_quant_share where org_id = pg_temp.id('A')), 0, 'AT-M1-06: org B sees no org A share row');

-- ===== Reads by other roles =====
select pg_temp.u('reviewer');
select is((select count(*)::int from public.item_versions where section_id is null and status = 'in_review') >= 1, true, 'versions S: the reviewer sees in-review bank rows of their workspaces');
select pg_temp.u('ws_reviewer');
select is((select count(*)::int from public.item_versions where section_id is null and workspace_id = pg_temp.id('A1')), 0, 'versions S: a workspace-fenced reviewer sees no workspace A1 bank row');
select is((select count(*)::int from public.item_versions where id = pg_temp.id('q2r')), 1, 'versions S: a workspace-fenced reviewer sees the workspace A2 row');
select pg_temp.u('hm');
select is((select count(*)::int from public.item_versions), 0, 'versions S: hiring manager sees nothing');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select is((select count(*)::int from public.item_versions where section_id is null) > 0, true, 'versions S: the quality worker reads bank rows of its job org');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select is((select count(*)::int from public.item_versions where org_id <> pg_temp.id('A')), 0, 'versions S: the authoring worker reads only its job org');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.item_versions'), '^42501 permission denied', 'versions S: trace_api has no grant on item_versions');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try('select * from public.items'), '^42501 permission denied', 'items S: trace_candidate has no privilege');
select pg_temp.op();

-- ===== AT-M1-25: M1 audit details are ids, enums, booleans and counts only =====
select is((select count(*)::int from public.audit_log where (action like 'item.%' or action = 'library.copy') and exists (select 1 from jsonb_each(details) as e where jsonb_typeof(e.value) not in ('string', 'boolean', 'number'))), 0, 'AT-M1-25: no item or library audit row carries a nested or free-text structure');
select is((select count(*)::int from public.audit_log where action in ('item.submit', 'item.approve', 'item.not_approved', 'item.retire') and pg_temp.keys(details) <> 'from,item_version_id,self_approved,to'), 0, 'AT-M1-25: every item transition carries exactly item_version_id, from, to, self_approved');
select is((select count(*)::int from public.audit_log where action in ('item.submit', 'item.approve', 'item.not_approved', 'item.retire') and ((details ->> 'item_version_id') !~ '^[0-9a-f-]{36}$' or (details ->> 'from') not in ('draft', 'in_review', 'approved') or (details ->> 'to') not in ('in_review', 'approved', 'not_approved', 'retired'))), 0, 'AT-M1-25: transition values are an id and status enums');

-- ===== DB-M1-10: the indexes behind the workspace reads and the library copy cap =====
select is((select string_agg(indexname || ':' || indexdef, '; ' order by indexname) from pg_indexes where schemaname = 'public' and indexname in ('item_exposure_events_workspace_idx', 'section_pool_snapshot_workspace_idx', 'item_versions_library_copy_day_idx')), 'item_exposure_events_workspace_idx:CREATE INDEX item_exposure_events_workspace_idx ON public.item_exposure_events USING btree (org_id, workspace_id); item_versions_library_copy_day_idx:CREATE INDEX item_versions_library_copy_day_idx ON public.item_versions USING btree (org_id, origin, created_at) WHERE (origin = ''library''::text); section_pool_snapshot_workspace_idx:CREATE INDEX section_pool_snapshot_workspace_idx ON public.section_pool_snapshot USING btree (org_id, workspace_id)', 'DB-M1-10: exposure events and snapshot rows are indexed by workspace, library copies by org and day');
select * from finish();
rollback;
