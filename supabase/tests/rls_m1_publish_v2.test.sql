-- rls_m1_publish_v2 (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_publish_v2; §3.3 sections, test_versions; §3.4 publish guard v2; §4.2; AT-M1-08 (publish half), AT-M1-13, AT-M1-14; R2-1, R2-13, R3-1, R5-9, R5-33; E1, E4). RED first: written from the spec before migration M1-b. Personas and items are synthetic.
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
-- package-v2 navigation (written sections forward-only). A null pool makes an inline section. Records <key>.
create function pg_temp.sec(p_key text, p_tv text, p_pos int, p_format text, p_pool uuid, p_draw int, p_weight numeric)
returns uuid language plpgsql as $f$
declare v_id uuid;
begin
  insert into public.sections (org_id, test_version_id, position, name, format, weight, pool_id, draw_count, navigation)
    select v.org_id, v.id, p_pos, 'Section ' || p_key, p_format::public.section_format, p_weight, p_pool, p_draw,
      case when p_format = 'written' then 'forward_only' else 'free' end
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
-- ai_draft(key, org, workspace): an AI-drafted MCQ bank version left in_review (the operator path names origin, as the
-- authoring worker's write path would; its answer key is added by the authoring worker). Records <key>, <key>_item.
create function pg_temp.ai_draft(p_key text, p_org uuid, p_ws uuid) returns uuid language plpgsql as $f$
declare v_item uuid; v_ver uuid;
begin
  perform pg_temp.op();
  insert into public.items (org_id, workspace_id, format, skill_key) values (p_org, p_ws, 'mcq', 'verbal')
    returning id into v_item;
  insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, origin, content_sha256)
    values (p_org, v_item, 'mcq', '[synthetic] AI draft ' || p_key,
      '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'ai_draft', repeat('c', 64))
    returning id into v_ver;
  perform pg_temp.w('trace_authoring_worker', p_org);
  insert into public.item_answer_keys (org_id, item_version_id, format, key) values (p_org, v_ver, 'mcq', '{"option_id": "o1"}');
  perform pg_temp.op();
  insert into pg_temp.ids values (p_key, v_ver), (p_key || '_item', v_item);
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
select plan(47);
-- Fixtures (operator path): pool PA = approved MCQ items pa1..pa11 plus the parameterised item pq; written pool PW =
-- approved written items pw1..pw10; pool PX (archived); pool PBIG = 101 approved MCQ items; an AI draft ai1 (in review).
select pg_temp.bank('pa' || n, pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved') from generate_series(1, 11) as n;
select pg_temp.bank('pw' || n, pg_temp.id('A'), pg_temp.id('A1'), 'written', 'written_communication', 0.50, 'approved') from generate_series(1, 10) as n;
select pg_temp.bank('big' || n, pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'reading', 0.50, 'approved') from generate_series(1, 101) as n;
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
insert into pg_temp.ids values ('pq', 'c2100000-0000-4000-8000-000000000001'), ('pqv', 'c2200000-0000-4000-8000-000000000001');
select pg_temp.ai_draft('ai1', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.pools (id, org_id, workspace_id, name, format) values
  ('d1000000-0000-4000-8000-0000000000a1', pg_temp.id('A'), pg_temp.id('A1'), 'Pool PA', 'mcq'),
  ('d1000000-0000-4000-8000-0000000000a2', pg_temp.id('A'), pg_temp.id('A1'), 'Pool PW', 'written'),
  ('d1000000-0000-4000-8000-0000000000a3', pg_temp.id('A'), pg_temp.id('A1'), 'Pool PX', 'mcq'),
  ('d1000000-0000-4000-8000-0000000000a4', pg_temp.id('A'), pg_temp.id('A1'), 'Pool PBIG', 'mcq');
insert into public.pool_items (org_id, pool_id, item_version_id)
  select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000a1'::uuid, pg_temp.id('pa' || n) from generate_series(1, 11) as n
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000a1'::uuid, pg_temp.id('pq')
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000a2'::uuid, pg_temp.id('pw' || n) from generate_series(1, 10) as n
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000a3'::uuid, pg_temp.id('pa1')
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000a4'::uuid, pg_temp.id('big' || n) from generate_series(1, 101) as n;
update public.pools set status = 'archived' where id = 'd1000000-0000-4000-8000-0000000000a3';
-- Draft p: s1 draws 1 from PA (mcq), s2 draws 1 from PW (written), s3 is inline with one item. No settings yet.
select pg_temp.tv('p', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('ps1', 'p', 1, 'mcq', 'd1000000-0000-4000-8000-0000000000a1', 1, 40);
select pg_temp.sec('ps2', 'p', 2, 'written', 'd1000000-0000-4000-8000-0000000000a2', 1, 30);
select pg_temp.sec('ps3', 'p', 3, 'mcq', null, null, 30);
select pg_temp.inline('pi1', 'ps3');
insert into pg_temp.ids select 'p_rs', ruleset_version_id from public.test_versions where id = pg_temp.id('p');

-- ===== Publish refusals (§3.4, each checked alone; a refused publish changes nothing) =====
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a version that uses M1 features needs its integrity settings', 'publish (R3-1): a version with pool sections needs its settings');
select pg_temp.preset('p', 'standard');
update public.sections set navigation = null where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: every section of a version 2 test has its navigation', 'publish (R2-1): every v2 section names its navigation');
update public.sections set navigation = 'free' where id = pg_temp.id('ps1');
update public.sections set draw_count = 13 where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: the pool has fewer approved items than the section draws', 'publish (E4): a draw larger than the approved pool is refused');
update public.sections set draw_count = 1 where id = pg_temp.id('ps1');
select pg_temp.inline('pi_bad', 'ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a section either serves its own items or draws from one pool', 'publish (M1-1): a pool section with its own items is refused');
delete from public.item_answer_keys where item_version_id = pg_temp.id('pi_bad');
delete from public.item_versions where id = pg_temp.id('pi_bad');
update public.sections set pool_id = 'd1000000-0000-4000-8000-0000000000a3' where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a section draws from an active pool of its format', 'publish: an archived pool is refused');
update public.sections set pool_id = 'd1000000-0000-4000-8000-0000000000a2' where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a section draws from an active pool of its format', 'publish: an MCQ section cannot draw from a written pool');
update public.sections set pool_id = 'd1000000-0000-4000-8000-0000000000a1' where id = pg_temp.id('ps1');
update public.sections set weight = 50 where id = pg_temp.id('ps3');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: section weights must sum to 100', 'publish (R2-13, Q26): v2 section weights sum to 100');
update public.sections set weight = 30 where id = pg_temp.id('ps3');
update public.sections set time_limit_seconds = 600 where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: either every section is timed or none is', 'publish (M1-11): section timers are all or none');
update public.sections set time_limit_seconds = 500 where test_version_id = pg_temp.id('p');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: the total time is the sum of the section times', 'publish (M1-11): a timed version''s total is the sum of its sections');
update public.sections set time_limit_seconds = null where test_version_id = pg_temp.id('p');
update public.sections set pool_id = 'd1000000-0000-4000-8000-0000000000a4', draw_count = 101 where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a candidate is served at most 100 items', 'publish (R5-9): more than 100 served items are refused');
update public.sections set pool_id = 'd1000000-0000-4000-8000-0000000000a1', draw_count = 1 where id = pg_temp.id('ps1');
select pg_temp.sec('ps4', 'p', 4, 'mcq', null, null, 1);
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: every section needs at least one item', 'publish (R2-1): an inline section without items is refused');
delete from public.sections where id = pg_temp.id('ps4');
update public.sections set shuffle_options = true, shuffle_items = true where id = pg_temp.id('ps1');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('p')), 0, 'publish: refused publishes wrote no snapshot');
select is((select status::text from public.test_versions where id = pg_temp.id('p')), 'draft', 'publish: the version is still a draft');

-- ===== AT-M1-08 (publish half): an unapproved AI draft never enters a snapshot =====
select matches(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values (%L, 'd1000000-0000-4000-8000-0000000000a1', %L)$$, pg_temp.id('A'), pg_temp.id('ai1'))), '^42501 TRACE_GUARD: a pool holds approved bank items of its format', 'AT-M1-08: an in-review AI draft cannot join a pool, even on the operator path');
select pg_temp.u('reviewer');
select is(pg_temp.try(format($$update public.item_versions set status = 'approved' where id = %L$$, pg_temp.id('ai1'))), 'OK 1', 'AT-M1-08: a reviewer of the workspace approves the AI draft');
select pg_temp.op();
select is((select (approved_by = pg_temp.id('reviewer'))::text || '|' || (approved_at is not null)::text from public.item_versions where id = pg_temp.id('ai1')), 'true|true', 'AT-M1-08: the approver is logged on the version');
insert into public.pool_items (org_id, pool_id, item_version_id) values (pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000a1', pg_temp.id('ai1'));

-- ===== Publish (R3-2): the snapshot holds every approved pool item and the inline item =====
select is(pg_temp.try($$select pg_temp.publish('p')$$), 'OK 1', 'publish: the corrected v2 version publishes');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('p')), 11 + 1 + 1 + 10 + 1, 'publish: the snapshot holds pa1..pa11, pq, ai1, pw1..pw10 and the inline item');
select is((select bool_and(i.status = 'approved' and (i.origin <> 'ai_draft' or i.approved_by is not null)) from public.section_pool_snapshot as sp join public.item_versions as i on i.id = sp.item_version_id where sp.test_version_id = pg_temp.id('p')), true, 'AT-M1-08: every snapshotted item is approved, every AI draft with its approver');
select is((select package_version::text || '|' || min_pool_ratio::text from public.test_versions where id = pg_temp.id('p')), '2|10.00', 'publish: package 2; min ratio = PW 10 items / draw 1');
select is((select published_at is not null from public.ruleset_versions where id = pg_temp.id('p_rs')), true, 'publish: the ruleset freezes with the version');

-- ===== AT-M1-13 / R5-33: nothing a published version references can change, for any role or the operator =====
create function pg_temp.frozen_probe() returns text language plpgsql as $f$
declare v_out text := ''; v_sql text; v_r text;
begin
  foreach v_sql in array array[
    $$update public.test_versions set quality_cutoff = 41 where id = pg_temp.id('p')$$,
    $$update public.test_versions set min_pool_ratio = 1, package_version = 1 where id = pg_temp.id('p')$$,
    $$update public.test_versions set status = 'draft', published_at = null where id = pg_temp.id('p')$$,
    $$delete from public.test_versions where id = pg_temp.id('p')$$,
    $$update public.sections set weight = 1 where test_version_id = pg_temp.id('p')$$,
    $$update public.sections set draw_count = 2, shuffle_items = false where id = pg_temp.id('ps1')$$,
    $$delete from public.sections where test_version_id = pg_temp.id('p')$$,
    $$update public.item_versions set stem = 'changed' where id = pg_temp.id('pi1')$$,
    $$delete from public.item_versions where id = pg_temp.id('pi1')$$,
    $$update public.item_answer_keys set key = '{"option_id": "o2"}' where item_version_id = pg_temp.id('pi1')$$,
    $$delete from public.item_answer_keys where item_version_id = pg_temp.id('pi1')$$,
    $$update public.ruleset_versions set settings = settings || '{"paste_written": "blocked"}' where id = pg_temp.id('p_rs')$$,
    $$update public.ruleset_versions set signal_settings = '{}' where id = pg_temp.id('p_rs')$$,
    $$update public.section_pool_snapshot set exposure_at_publish = 7 where test_version_id = pg_temp.id('p')$$,
    $$delete from public.section_pool_snapshot where test_version_id = pg_temp.id('p')$$,
    $$update public.item_versions set stem = 'changed' where id = pg_temp.id('pa1')$$,
    $$update public.item_versions set difficulty = 0.9 where id = pg_temp.id('pw1')$$,
    $$update public.item_versions set approved_by = null, approved_at = null where id = pg_temp.id('pa1')$$,
    $$update public.item_versions set approved_at = now() where id = pg_temp.id('ai1')$$,
    $$update public.item_versions set reviewed_by = approved_by, key_reviewed_by = approved_by where id = pg_temp.id('pa2')$$,
    $$update public.item_versions set status = 'draft' where id = pg_temp.id('pa1')$$,
    $$delete from public.item_versions where id = pg_temp.id('pa1')$$,
    $$update public.item_answer_keys set key = '{"option_id": "o2"}' where item_version_id = pg_temp.id('pa1')$$,
    $$delete from public.item_answer_keys where item_version_id = pg_temp.id('pa1')$$,
    $$update public.item_variants set stem = 'changed' where item_version_id = pg_temp.id('pq')$$,
    $$delete from public.item_variants where item_version_id = pg_temp.id('pq')$$,
    $$update public.item_variant_keys set key = '{"option_id": "o2"}' where item_variant_id = pg_temp.id('pqv')$$,
    $$delete from public.item_variant_keys where item_variant_id = pg_temp.id('pqv')$$
  ] loop
    v_r := pg_temp.try(v_sql);
    if v_r ~ '^OK [1-9]' then
      v_out := v_out || v_sql || '; ';
    end if;
  end loop;
  return v_out;
end
$f$;
grant execute on function pg_temp.frozen_probe() to public;
select pg_temp.u('owner');
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: owner changes nothing a published version references');
select pg_temp.u('admin');
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: admin changes nothing');
select pg_temp.u('recruiter');
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: recruiter changes nothing');
select pg_temp.u('reviewer');
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: reviewer changes nothing');
select pg_temp.api(pg_temp.id('A'));
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: trace_api changes nothing');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: trace_worker changes nothing');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: trace_quality_worker changes nothing');
select pg_temp.w('trace_integrity_worker', pg_temp.id('A'));
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: trace_integrity_worker changes nothing');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: trace_authoring_worker changes nothing');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: trace_admin_worker changes nothing');
select pg_temp.op();
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: the operator changes nothing (ENABLE ALWAYS, no bypass)');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('p')), 24, 'AT-M1-13: the snapshot is whole after every probe');
-- What may still change: a snapshotted bank item may be retired (approved -> retired only), and the version retires.
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.item_versions set status = 'retired' where id = %L$$, pg_temp.id('pa3'))), 'OK 1', 'R5-33: a snapshotted item may go approved -> retired');
select pg_temp.op();
select matches(pg_temp.try($$update public.test_versions set status = 'retired', min_pool_ratio = 1 where id = pg_temp.id('p')$$), '^42501 TRACE_GUARD: a published test version is frozen', 'R5-33: publish -> retire keeps min_pool_ratio frozen');
select matches(pg_temp.try($$update public.test_versions set status = 'retired', package_version = 1 where id = pg_temp.id('p')$$), '^42501 TRACE_GUARD: a published test version is frozen', 'R5-33: publish -> retire keeps package_version frozen');
select matches(pg_temp.try($$update public.test_versions set status = 'retired', role_template_version_id = gen_random_uuid() where id = pg_temp.id('p')$$), '^42501 TRACE_GUARD: a published test version is frozen', 'R5-33: publish -> retire keeps role_template_version_id frozen');

-- ===== AT-M1-14 / Q20: "Edit as new version" is a new draft; invitations keep their version =====
insert into public.invitations (id, org_id, workspace_id, test_id, test_version_id, candidate_label, contact_email, link_token_hash, adult_confirmed_by_inviter, status, expires_at) values
  ('a2000000-0000-4000-8000-0000000000e1', pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('p_test'), pg_temp.id('p'), 'Candidate 0', 'm1-q20@example.test', repeat('e', 64), true, 'created', '2030-01-01 00:00:00+00');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$insert into public.test_versions (org_id, test_id, total_time_seconds, quality_cutoff) values (%L, %L, 1800, 40)$$, pg_temp.id('A'), pg_temp.id('p_test'))), 'OK 1', 'AT-M1-14: a recruiter opens version 2 of a published test');
select pg_temp.op();
insert into pg_temp.ids select 'p2', id from public.test_versions where test_id = pg_temp.id('p_test') and version_no = 2;
select is((select version_no::text || '|' || status::text || '|' || package_version::text || '|' || coalesce(min_pool_ratio::text, 'null') from public.test_versions where id = pg_temp.id('p2')), '2|draft|1|null', 'AT-M1-14: the new version is draft number 2; the guard owns the M1 columns');
select is((select (r.settings is null)::text || '|' || (r.published_at is null)::text from public.ruleset_versions as r join public.test_versions as v on v.ruleset_version_id = r.id where v.id = pg_temp.id('p2')), 'true|true', 'AT-M1-14 (R3-1): the new draft gets the D1 seed ruleset');
select is((select pg_temp.keys(details) || '|' || (details ->> 'version_no') from public.audit_log where action = 'test.new_version' and object_id = pg_temp.id('p2')), 'version_no|2', 'AT-M1-14 (R5-26): test.new_version carries the version number only');
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.ruleset_versions as r set preset_key = 'standard', settings = (select s.settings from public.ruleset_versions as s where s.id = pg_temp.id('p_rs')) where r.id = (select v.ruleset_version_id from public.test_versions as v where v.id = pg_temp.id('p2'))$$), 'OK 1', 'AT-M1-14: the source version''s settings are copied into the new draft');
select pg_temp.op();
select is((select r.signal_settings = s.signal_settings from public.ruleset_versions as r, public.ruleset_versions as s where r.id = (select v.ruleset_version_id from public.test_versions as v where v.id = pg_temp.id('p2')) and s.id = pg_temp.id('p_rs')), true, 'AT-M1-14: the copy derives the same signal settings');
select matches(pg_temp.try($$update public.invitations set test_version_id = pg_temp.id('p2') where id = 'a2000000-0000-4000-8000-0000000000e1'$$), '^42501', 'AT-M1-14 (Q20): an invitation keeps the version it was sent with');
select is((select test_version_id from public.invitations where id = 'a2000000-0000-4000-8000-0000000000e1'), pg_temp.id('p'), 'AT-M1-14: the invitation still pins version 1');
-- E1: the published version stays frozen while the new draft is edited.
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.test_versions set quality_cutoff = 50 where id = pg_temp.id('p2')$$), 'OK 1', 'E1: the new draft is editable');
select matches(pg_temp.try($$update public.test_versions set quality_cutoff = 50 where id = pg_temp.id('p')$$), '^(42501|OK 0)', 'E1: the published version is not');
select pg_temp.op();
select * from finish();
rollback;
