-- rls_m1_review_fixes (M1 FIX of docs/reviews/M1.md: M1-REV-1, M1-REV-2, M1-REV-7; spec specs/m1-test-authoring.md revision 5 R5-72). RED first: each section was written before its migration (M1-t, M1-u). Personas and items are synthetic.
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
-- live_digest(version key): what the api sends as snapshotDigest (R5-56 d): the rows a package built now would use
-- (approved pool items of pool sections, inline items of inline sections) as @trace/shared snapshotDigest computes
-- it: section:item lines, no exposure (R5-60 a). publish() sends it, so a v2 publish passes the digest check.
create function pg_temp.live_digest(p_tv text) returns text language sql stable as $f$
  select encode(sha256(convert_to(coalesce(string_agg(x.l, E'\n' order by x.l collate "C"), ''), 'UTF8')), 'hex')
  from (
    select s.id::text || ':' || i.id::text as l
    from public.sections as s
    join public.pool_items as pi on pi.org_id = s.org_id and pi.pool_id = s.pool_id
    join public.item_versions as i on i.org_id = pi.org_id and i.id = pi.item_version_id and i.status = 'approved'
    where s.test_version_id = pg_temp.id(p_tv)
    union all
    select s.id::text || ':' || i.id::text
    from public.sections as s
    join public.item_versions as i on i.org_id = s.org_id and i.section_id = s.id
    where s.test_version_id = pg_temp.id(p_tv) and s.pool_id is null
  ) as x
$f$;
grant execute on function pg_temp.live_digest(text) to public;
create function pg_temp.publish(p_tv text) returns void language plpgsql as $f$
declare v_digest text := pg_temp.live_digest(p_tv);
begin
  update public.test_versions set status = 'published', content_sha256 = repeat('b', 64), snapshot_digest = v_digest
    where id = pg_temp.id(p_tv);
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
select plan(26);

-- ===== M1-REV-1: trace_authoring_worker reads only the item_versions columns of its SQL (workers/jobs/src/drafting/store.ts) =====
select pg_temp.op();
select pg_temp.bank('r1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select is(has_table_privilege('trace_authoring_worker', 'public.item_versions', 'SELECT'), false, 'M1-REV-1: the authoring worker holds no table-wide SELECT on item_versions');
select is((select string_agg(a.attname::text, ',' order by a.attname) from pg_attribute as a where a.attrelid = 'public.item_versions'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('trace_authoring_worker', a.attrelid, a.attnum, 'SELECT')), 'ai_draft_job_id,created_at,id,item_id,org_id,section_id,skill_key,status,stem', 'M1-REV-1: it may select exactly the columns the drafting SQL reads');
select is(has_column_privilege('trace_authoring_worker', 'public.item_versions', 'param_spec', 'SELECT') or has_column_privilege('trace_authoring_worker', 'public.item_versions', 'options', 'SELECT'), false, 'M1-REV-1: param_spec (correctOptionId, the key of every variant) and options are not readable by the worker');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try('select param_spec from public.item_versions'), '^42501 permission denied', 'M1-REV-1: the worker selecting param_spec is refused');
select matches(pg_temp.try('select * from public.item_versions'), '^42501 permission denied', 'M1-REV-1: select * is refused too');
select is(pg_temp.try(format($$select stem from public.item_versions where org_id = %L and section_id is null and status = 'approved' and skill_key = 'verbal' order by created_at desc, id limit 5$$, pg_temp.id('A'))), 'OK 1', 'M1-REV-1 control: the approved-stems read of the drafting job still runs');
select is(pg_temp.try(format($$select count(*)::int as n from public.item_versions where org_id = %L and ai_draft_job_id = %L$$, pg_temp.id('A'), gen_random_uuid())), 'OK 1', 'M1-REV-1 control: the stored-drafts count still runs');
select is(pg_temp.try(format($$select distinct btrim(lower(regexp_replace(v.stem, '[ \t\n\r\f\v]+', ' ', 'g')), ' ') from public.item_versions as v where v.org_id = %L$$, pg_temp.id('A'))), 'OK 1', 'M1-REV-1 control: the existing-stems read still runs');
select pg_temp.op();

-- ===== M1-REV-2: a retired library copy is never reused, so a recruiter's retire does not block later copies or from-template =====
select pg_temp.bank('rlib', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'verbal', 0.50, 'approved');
create table pg_temp.copies (k text primary key, v uuid[] not null);
grant select, insert on pg_temp.copies to public;
create table pg_temp.batch (k text primary key, j jsonb not null);
grant select on pg_temp.batch to public;
create table pg_temp.res (k text primary key, j jsonb);
grant select, insert on pg_temp.res to public;
insert into pg_temp.ids select 'tpl', t.id from public.role_templates as t where t.org_id = pg_temp.id('L') and t.status = 'published' order by t.template_key, t.version limit 1;
insert into pg_temp.batch values ('tpl', jsonb_build_object('workspaceId', pg_temp.id('A1'), 'jobTitle', '[synthetic] Retired copy job', 'roleTemplateVersionId', pg_temp.id('tpl'), 'jdSha256', repeat('a', 64), 'templateMatchPermille', 500, 'totalTimeSeconds', 1800, 'qualityCutoff', 40, 'presetKey', 'standard', 'presetVersion', 1,
  'settings', (select p.preset_values from public.integrity_presets as p where p.preset_key = 'standard' and p.version = 1),
  'sections', jsonb_build_array(jsonb_build_object('name', '[synthetic] Verbal', 'format', 'mcq', 'weight', 100, 'drawCount', 1, 'skillKey', 'verbal', 'shuffleItems', true, 'shuffleOptions', true, 'navigation', 'free', 'libraryItemVersionIds', jsonb_build_array(pg_temp.id('rlib'))))));
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$with r as (insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values (%L, %L, array[%L]::uuid[]) returning result_item_version_ids) insert into pg_temp.copies select 'c1', result_item_version_ids from r$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('rlib'))), 'OK 1', 'M1-REV-2 setup: a recruiter copies an approved library item');
select is(pg_temp.try(format($$update public.item_versions set status = 'retired' where id = %L$$, (select v[1] from pg_temp.copies where k = 'c1'))), 'OK 1', 'M1-REV-2 setup: the recruiter retires the copy (bank retire route)');
select is(pg_temp.try(format($$with r as (insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values (%L, %L, array[%L]::uuid[]) returning result_item_version_ids) insert into pg_temp.copies select 'c2', result_item_version_ids from r$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('rlib'))), 'OK 1', 'M1-REV-2: copying the same library item again succeeds');
select pg_temp.op();
select is((select (c2.v[1] <> c1.v[1])::text || '|' || (select v.status::text from public.item_versions as v where v.id = c2.v[1]) || '|' || (select v.status::text from public.item_versions as v where v.id = c1.v[1]) from pg_temp.copies as c1, pg_temp.copies as c2 where c1.k = 'c1' and c2.k = 'c2'), 'true|approved|retired', 'M1-REV-2: the new request makes a fresh approved copy; the retired copy stays retired');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$with r as (insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values (%L, %L, array[%L]::uuid[]) returning result_item_version_ids) insert into pg_temp.copies select 'c3', result_item_version_ids from r$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('rlib'))), 'OK 1', 'M1-REV-2: a third request runs');
select pg_temp.op();
select is((select c3.v = c2.v from pg_temp.copies as c2, pg_temp.copies as c3 where c2.k = 'c2' and c3.k = 'c3'), true, 'M1-REV-2: a live copy is still reused (one copy per org, workspace and library version, R3-8)');
select is((select string_agg(x.c, ',' order by x.c) from (select (l.details ->> 'count') || '/' || (l.details ->> 'reused') as c from public.audit_log as l where l.org_id = pg_temp.id('A') and l.action = 'library.copy' and l.object_id in (select r.id from public.library_copy_requests as r where pg_temp.id('rlib') = any (r.library_item_version_ids))) as x), '0/1,1/0,1/0', 'M1-REV-2: the audit (count/reused) counts the fresh copy as new, as the daily cap does: two new, one reused');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.item_versions set status = 'retired' where id = %L$$, (select v[1] from pg_temp.copies where k = 'c2'))), 'OK 1', 'M1-REV-2 setup: the recruiter retires the second copy too');
select is(pg_temp.try($$insert into pg_temp.res select 'ct', public.create_test_from_template(pg_temp.id('A'), (select j from pg_temp.batch where k = 'tpl'))$$), 'OK 1', 'M1-REV-2: from-template naming a library item whose copies are all retired succeeds');
select pg_temp.op();
select is((select string_agg(i.origin::text || '/' || i.status::text || '/' || (i.source_item_version_id = pg_temp.id('rlib'))::text || '/' || (i.id <> all (array(select c.v[1] from pg_temp.copies as c)))::text, ',') from public.sections as s join public.pool_items as pi on pi.pool_id = s.pool_id join public.item_versions as i on i.id = pi.item_version_id where s.test_version_id = (select (j ->> 'versionId')::uuid from pg_temp.res where k = 'ct')), 'library/approved/true/true', 'M1-REV-2: its pool holds one fresh approved copy of that library item');
select is((select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'item_versions' and indexname = 'item_versions_library_copy' and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%status <> ''retired''%'), 1, 'M1-REV-2: one live copy per org, workspace and library version (a partial unique index that leaves retired copies out)');

-- ===== M1-REV-7: AT-M1-02, the skill_key and approved_by arms of CHECK item_versions_bank_approved (operator path) =====
-- Org-role approvals force approved_by := auth.uid() and the guard fills skill_key from its item, so only the operator
-- path reaches these arms; the skill_key arm is reached with the user triggers off, to test the CHECK on its own.
select pg_temp.op();
select pg_temp.bank('r7a', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'in_review');
select pg_temp.bank('r7b', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'in_review');
select matches(pg_temp.try(format($$update public.item_versions set status = 'approved', approved_by = null, approved_at = now() where id = %L$$, pg_temp.id('r7a'))), '^23514 .*"item_versions_bank_approved"', 'AT-M1-02: an approved bank item needs its approver (CHECK, operator path)');
select matches(pg_temp.try(format($$update public.item_versions set skill_key = null where id = %L$$, pg_temp.id('r7b'))), '^42501 TRACE_GUARD', 'AT-M1-02 control: the guard refuses a skill change outside draft');
alter table public.item_versions disable trigger user;
select matches(pg_temp.try(format($$update public.item_versions set status = 'approved', approved_by = %L, approved_at = now(), skill_key = null where id = %L$$, pg_temp.id('owner'), pg_temp.id('r7b'))), '^23514 .*"item_versions_bank_approved"', 'AT-M1-02: an approved bank item needs its skill (CHECK alone, guard off)');
-- Re-enable each trigger as it was (FIX re-review note: `enable trigger user` would leave the ALWAYS ones at origin).
alter table public.item_versions enable trigger item_versions_audit;
alter table public.item_versions enable always trigger item_versions_guard;
alter table public.item_versions enable always trigger item_versions_variants_numbered;
select is((select string_agg(t.tgname::text || ':' || t.tgenabled::text, ',' order by t.tgname) from pg_trigger as t where t.tgrelid = 'public.item_versions'::regclass and not t.tgisinternal), 'item_versions_audit:O,item_versions_guard:A,item_versions_variants_numbered:A', 'AT-M1-02: the triggers are back as they were (guard and variant numbering ENABLE ALWAYS)');
select is((select string_agg(v.status::text || '/' || coalesce(v.skill_key, 'null') || '/' || (v.approved_by is null)::text, ',' order by v.stem) from public.item_versions as v where v.id in (pg_temp.id('r7a'), pg_temp.id('r7b'))), 'in_review/verbal/true,in_review/verbal/true', 'AT-M1-02: both refused approvals left the versions in review');

-- ===== M1-REV-8: the E26 lookup states that it is not bound to the invite's address (comment; no behaviour change) =====
select is((select obj_description('private.auth_user_id_for_invite(uuid, text)'::regprocedure, 'pg_proc') like '%which the worker sets itself%Not bound to the invite''s address%M1-REV-8%Skips SSO, anonymous and deleted users%'), true, 'M1-REV-8: the function comment records that p_email is not bound to email_hmac, and the accepted residual risk');
select is((select has_function_privilege('trace_admin_worker', 'private.auth_user_id_for_invite(uuid, text)', 'EXECUTE')::text || '|' || has_function_privilege('authenticated', 'private.auth_user_id_for_invite(uuid, text)', 'EXECUTE')::text || '|' || has_function_privilege('trace_authoring_worker', 'private.auth_user_id_for_invite(uuid, text)', 'EXECUTE')::text), 'true|false|false', 'M1-REV-8: only trace_admin_worker may execute the lookup');
select * from finish();
rollback;
