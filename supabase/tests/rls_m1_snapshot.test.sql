-- rls_m1_snapshot (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_snapshot; §3.2 section_pool_snapshot; §3.4 publish guard v2 and private.assert_drive_pool_ratio; §3.5; AT-M1-12; R2-8, R3-1, R3-2, R3-3, R5-33). RED first: written from the spec before migration M1-b. Personas and items are synthetic.
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
select plan(79);
-- Fixtures (operator path): approved MCQ bank items v1..v10 and w1..w100 in workspace A1; pools PA = v1..v10,
-- PB = w1..w99, PC = w1..w100, PD = {v1, w1} (overlaps PA); org B pool PBB = 10 items.
select pg_temp.bank('v' || n, pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved') from generate_series(1, 10) as n;
select pg_temp.bank('w' || n, pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved') from generate_series(1, 100) as n;
select pg_temp.bank('bv' || n, pg_temp.id('B'), pg_temp.id('BW'), 'mcq', 'verbal', 0.50, 'approved') from generate_series(1, 10) as n;
insert into public.pools (id, org_id, workspace_id, name, format) values
  ('d1000000-0000-4000-8000-00000000000a', pg_temp.id('A'), pg_temp.id('A1'), 'Pool A', 'mcq'),
  ('d1000000-0000-4000-8000-00000000000b', pg_temp.id('A'), pg_temp.id('A1'), 'Pool B', 'mcq'),
  ('d1000000-0000-4000-8000-00000000000c', pg_temp.id('A'), pg_temp.id('A1'), 'Pool C', 'mcq'),
  ('d1000000-0000-4000-8000-00000000000d', pg_temp.id('A'), pg_temp.id('A1'), 'Pool D', 'mcq'),
  ('d1000000-0000-4000-8000-0000000000bb', pg_temp.id('B'), pg_temp.id('BW'), 'Pool BB', 'mcq');
insert into public.pool_items (org_id, pool_id, item_version_id)
  select pg_temp.id('A'), 'd1000000-0000-4000-8000-00000000000a'::uuid, pg_temp.id('v' || n) from generate_series(1, 10) as n
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-00000000000b'::uuid, pg_temp.id('w' || n) from generate_series(1, 99) as n
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-00000000000c'::uuid, pg_temp.id('w' || n) from generate_series(1, 100) as n
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-00000000000d'::uuid, pg_temp.id('v1')
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-00000000000d'::uuid, pg_temp.id('w1');
insert into public.pool_items (org_id, pool_id, item_version_id)
  select pg_temp.id('B'), 'd1000000-0000-4000-8000-0000000000bb'::uuid, pg_temp.id('bv' || n) from generate_series(1, 10) as n;
-- Versions: ta = PA draw 1 (10x); tb = PB draw 10 (9.9x); tc = PC draw 10 (10x); td = one inline section; te = PA draw
-- 1 + an inline section; tf = PA and PD (overlap); tg = a D1-style v1 version (inline, no settings, no M1 column);
-- tbb = org B, PBB draw 1.
select pg_temp.tv('ta', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sa', 'ta', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000a', 1, 100);
select pg_temp.preset('ta', 'standard');
select pg_temp.tv('tb', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sb', 'tb', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000b', 10, 100);
select pg_temp.preset('tb', 'standard');
select pg_temp.tv('tc', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sc', 'tc', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000c', 10, 100);
select pg_temp.preset('tc', 'standard');
select pg_temp.tv('td', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sd', 'td', 1, 'mcq', null, null, 100);
select pg_temp.inline('id1', 'sd');
select pg_temp.preset('td', 'standard');
select pg_temp.tv('te', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('se1', 'te', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000a', 1, 50);
select pg_temp.sec('se2', 'te', 2, 'mcq', null, null, 50);
select pg_temp.inline('ie1', 'se2');
select pg_temp.preset('te', 'standard');
select pg_temp.tv('tf', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sf1', 'tf', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000a', 1, 50);
select pg_temp.sec('sf2', 'tf', 2, 'mcq', 'd1000000-0000-4000-8000-00000000000d', 1, 50);
select pg_temp.preset('tf', 'standard');
select pg_temp.tv('tg', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-0000000000a7', pg_temp.id('A'), pg_temp.id('tg'), 1, 'Choices', 'mcq', 1);
insert into pg_temp.ids values ('sg', '51000000-0000-4000-8000-0000000000a7');
select pg_temp.inline('ig1', 'sg');
select pg_temp.tv('tbb', pg_temp.id('B'), pg_temp.id('BW'));
select pg_temp.sec('sbb', 'tbb', 1, 'mcq', 'd1000000-0000-4000-8000-0000000000bb', 1, 100);
select pg_temp.preset('tbb', 'standard');
-- The assigned reviewer persona is assigned to test ta.
insert into public.assignments (org_id, membership_id, scope, test_id, as_role)
  select m.org_id, m.id, 'test', pg_temp.id('ta_test'), 'reviewer'
  from public.memberships as m where m.org_id = pg_temp.id('A') and m.user_id = pg_temp.id('reviewer');

-- ===== Publish writes the snapshot (R3-2) and the ratio (AT-M1-12) =====
select is(pg_temp.try($$select pg_temp.publish('ta')$$), 'OK 1', 'publish: a pool version (10 approved items, draw 1) publishes');
select is((select count(*)::int from public.section_pool_snapshot where section_id = pg_temp.id('sa')), 10, 'snapshot: the pool section holds its 10 approved pool items');
select is((select bool_and(test_version_id = pg_temp.id('ta') and test_id = pg_temp.id('ta_test') and workspace_id = pg_temp.id('A1') and exposure_at_publish = 0) from public.section_pool_snapshot where section_id = pg_temp.id('sa')), true, 'snapshot: rows carry the version, test, workspace and the frozen exposure (0 here)');
select is((select min_pool_ratio::text || '|' || package_version::text from public.test_versions where id = pg_temp.id('ta')), '10.00|2', 'publish: min_pool_ratio 10.00, package version 2');
select is(pg_temp.try($$select pg_temp.publish('tb')$$), 'OK 1', 'publish: a 9.9x pool version publishes (the 10x rule is for drives)');
select is((select min_pool_ratio::text from public.test_versions where id = pg_temp.id('tb')), '9.90', 'publish: min_pool_ratio 9.90');
select is(pg_temp.try($$select pg_temp.publish('tc')$$), 'OK 1', 'publish: a 10x pool version (100 items, draw 10) publishes');
select is(pg_temp.try($$select pg_temp.publish('td')$$), 'OK 1', 'publish: an inline-only v2 version publishes');
select is((select count(*)::int || '|' || bool_and(item_version_id = pg_temp.id('id1'))::text from public.section_pool_snapshot where test_version_id = pg_temp.id('td')), '1|true', 'snapshot: an inline section snapshots its own items');
select is((select coalesce(min_pool_ratio::text, 'null') || '|' || package_version::text from public.test_versions where id = pg_temp.id('td')), 'null|2', 'publish: no drawing section, so min_pool_ratio is null');
select is(pg_temp.try($$select pg_temp.publish('te')$$), 'OK 1', 'publish: a pool section and an inline section publish together');
select is(pg_temp.try($$select pg_temp.publish('tg')$$), 'OK 1', 'publish (R3-1, AT-M1-28): a D1-style version without settings publishes as D1');
select is((select package_version::text || '|' || coalesce(min_pool_ratio::text, 'null') || '|' || (select count(*) from public.section_pool_snapshot where test_version_id = pg_temp.id('tg'))::text from public.test_versions where id = pg_temp.id('tg')), '1|null|0', 'publish (R3-1): a v1 version has package 1, no ratio and no snapshot');
-- R3-3: an item may be drawn by only one section of a version.
select matches(pg_temp.try($$select pg_temp.publish('tf')$$), '^42501 TRACE_GUARD: an item may appear in only one section', 'publish (R3-3): overlapping pools in two sections are refused');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('tf')), 0, 'publish (R3-3): a refused publish writes no snapshot');
select is(pg_temp.try($$select pg_temp.publish('tbb')$$), 'OK 1', 'publish: an org B pool version publishes');

-- ===== private.assert_drive_pool_ratio (AT-M1-12; called by M2's drive trigger) =====
select is(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('ta'))), 'OK 1', 'pool ratio: 10x (10 items, draw 1) passes');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('tb'))), '^42501 TRACE_GUARD: pool must be at least 10x the draw for drives', 'pool ratio: 9.9x raises');
select is(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('tc'))), 'OK 1', 'pool ratio: 10x (100 items, draw 10) passes');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('td'))), '^42501 TRACE_GUARD: pool must be at least 10x the draw for drives', 'pool ratio: an inline-only version raises');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('te'))), '^42501 TRACE_GUARD: pool must be at least 10x the draw for drives', 'pool ratio: an inline section next to a 10x pool section still raises');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('tg'))), '^42501 TRACE_GUARD: pool must be at least 10x the draw for drives', 'pool ratio: a D1 v1 version raises (inline)');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('tf'))), '^23503 TRACE_GUARD: published test version not found', 'pool ratio: a draft version is not found');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('B'), pg_temp.id('ta'))), '^23503 TRACE_GUARD: published test version not found', 'pool ratio: another org''s version is not found');
select pg_temp.u('owner');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('ta'))), '^42501 permission denied', 'pool ratio: no app role may call it');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('ta'))), '^42501 permission denied', 'pool ratio: trace_api may not call it');
select pg_temp.op();

-- ===== section_pool_snapshot: S =====
select pg_temp.u('owner');
select is((select count(*)::int from public.section_pool_snapshot), 10 + 99 + 100 + 1 + 10 + 1, 'snapshot S: owner sees every org A snapshot row');
select pg_temp.u('recruiter');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('ta')), 10, 'snapshot S: recruiter sees the workspace A1 rows');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.section_pool_snapshot), 0, 'snapshot S: workspace A2 recruiter sees no workspace A1 row');
select pg_temp.u('reviewer');
select is((select count(*)::int || '|' || bool_and(test_id = pg_temp.id('ta_test'))::text from public.section_pool_snapshot), '10|true', 'snapshot S: the reviewer sees the rows of the assigned test only');
select pg_temp.u('ws_reviewer');
select is((select count(*)::int from public.section_pool_snapshot), 0, 'snapshot S: an unassigned reviewer sees nothing');
select pg_temp.u('hm');
select is((select count(*)::int from public.section_pool_snapshot), 0, 'snapshot S: hiring manager sees nothing');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.section_pool_snapshot where org_id = pg_temp.id('A')), 0, 'snapshot S: org B admin sees no org A row');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('ta')), 10, 'snapshot S: the quality worker reads its job org''s snapshot');
select is((select count(*)::int from public.section_pool_snapshot where org_id = pg_temp.id('B')), 0, 'snapshot S: the quality worker bound to org A reads nothing of org B');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.section_pool_snapshot'), '^42501 permission denied', 'snapshot S: trace_worker has no grant');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.section_pool_snapshot'), '^42501 permission denied', 'snapshot S: trace_api has no grant');
select pg_temp.op();

-- ===== section_pool_snapshot: I / U / D (I-M1-2: written by publish only, immutable for every role) =====
select pg_temp.u('owner');
select matches(pg_temp.try(format($$insert into public.section_pool_snapshot (org_id, section_id, item_version_id, workspace_id, test_id, test_version_id, exposure_at_publish) values (%L, %L, %L, %L, %L, %L, 0)$$, pg_temp.id('A'), pg_temp.id('sa'), pg_temp.id('w1'), pg_temp.id('A1'), pg_temp.id('ta_test'), pg_temp.id('ta'))), '^42501 permission denied', 'snapshot I: owner has no insert grant');
select matches(pg_temp.try('update public.section_pool_snapshot set exposure_at_publish = 5'), '^42501 permission denied', 'snapshot U: owner has no update grant');
select matches(pg_temp.try('delete from public.section_pool_snapshot'), '^42501 permission denied', 'snapshot D: owner has no delete grant');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select matches(pg_temp.try('update public.section_pool_snapshot set exposure_at_publish = 5'), '^42501 permission denied', 'snapshot U: the quality worker has no update grant');
select pg_temp.op();
select matches(pg_temp.try(format($$insert into public.section_pool_snapshot (org_id, section_id, item_version_id, workspace_id, test_id, test_version_id, exposure_at_publish) values (%L, %L, %L, %L, %L, %L, 0)$$, pg_temp.id('A'), pg_temp.id('sa'), pg_temp.id('w1'), pg_temp.id('A1'), pg_temp.id('ta_test'), pg_temp.id('ta'))), '^42501 TRACE_GUARD: the snapshot is written by publish only and is immutable', 'snapshot I: the operator cannot add a row outside publish');
select matches(pg_temp.try('update public.section_pool_snapshot set exposure_at_publish = 5'), '^42501 TRACE_GUARD: the snapshot is written by publish only and is immutable', 'snapshot U: the operator cannot change a row');
select matches(pg_temp.try('delete from public.section_pool_snapshot'), '^42501 TRACE_GUARD: the snapshot is written by publish only and is immutable', 'snapshot D: the operator cannot delete a row');
select matches(pg_temp.try('truncate public.section_pool_snapshot'), '^42501 TRACE_GUARD: the snapshot is written by publish only and is immutable', 'snapshot TRUNCATE: refused for the operator');
select is((select count(*)::int from public.section_pool_snapshot), 10 + 99 + 100 + 1 + 10 + 1 + 10, 'snapshot: every published row is still there');

-- ===== Later pool changes never touch a published snapshot (E3) =====
select pg_temp.u('owner');
select is(pg_temp.try(format($$delete from public.pool_items where pool_id = 'd1000000-0000-4000-8000-00000000000a' and item_version_id = %L$$, pg_temp.id('v2'))), 'OK 1', 'E3: an item leaves pool A after publish');
select is(pg_temp.try(format($$update public.item_versions set status = 'retired' where id = %L$$, pg_temp.id('v3'))), 'OK 1', 'E3: a snapshotted item is retired after publish');
select pg_temp.op();
select is((select count(*)::int from public.section_pool_snapshot where section_id = pg_temp.id('sa')), 10, 'E3: the published snapshot keeps all 10 items');
select is((select min_pool_ratio::text from public.test_versions where id = pg_temp.id('ta')), '10.00', 'E3: the published ratio is unchanged');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('ta'))), '^OK', 'E3: the drive check reads the frozen snapshot, so ta still passes');

-- ===== E22 (DB-M1-12): a version holds at most 5,000 items, which also bounds min_pool_ratio =====
-- Pool PH = 5,001 approved written items in workspace A1 (operator path); version th draws 1 from it.
select pg_temp.op();
create temp table huge_src as select gen_random_uuid() as item, gen_random_uuid() as ver, n from generate_series(1, 5001) as n;
insert into public.items (id, org_id, workspace_id, format, skill_key, created_by)
  select item, pg_temp.id('A'), pg_temp.id('A1'), 'written', 'written_communication', pg_temp.id('owner') from huge_src;
insert into public.item_versions (id, org_id, item_id, format, stem, rubric_version_id, skill_key, difficulty, content_sha256, created_by)
  select ver, pg_temp.id('A'), item, 'written', '[synthetic] Huge ' || n, (select r.id from public.rubric_versions as r where r.org_id = pg_temp.id('A') and r.rubric_key = 'default'), 'written_communication', 0.50, repeat('e', 64), pg_temp.id('owner') from huge_src;
update public.item_versions set status = 'in_review' where id in (select ver from huge_src);
update public.item_versions set status = 'approved', approved_by = pg_temp.id('owner') where id in (select ver from huge_src);
insert into public.pools (id, org_id, workspace_id, name, format) values
  ('d1000000-0000-4000-8000-0000000000ee', pg_temp.id('A'), pg_temp.id('A1'), 'Pool huge', 'written');
insert into public.pool_items (org_id, pool_id, item_version_id)
  select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000ee'::uuid, ver from huge_src;
select pg_temp.tv('th', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sh', 'th', 1, 'written', 'd1000000-0000-4000-8000-0000000000ee', 1, 100);
select pg_temp.preset('th', 'standard');
select matches(pg_temp.try($$select pg_temp.publish('th')$$), '^42501 TRACE_GUARD: a version holds at most 5,000 items', 'publish (E22, DB-M1-12): a snapshot of more than 5,000 items is refused');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('th')), 0, 'publish (E22): the refused publish wrote no snapshot');
delete from public.pool_items where pool_id = 'd1000000-0000-4000-8000-0000000000ee' and item_version_id = (select ver from huge_src where n = 5001);
select is(pg_temp.try($$select pg_temp.publish('th')$$), 'OK 1', 'publish (E22): exactly 5,000 items publish');
select is((select min_pool_ratio::text from public.test_versions where id = pg_temp.id('th')), '5000.00', 'publish (E22): min_pool_ratio stays within numeric(6, 2)');

-- ===== Publish race (R5-56 d, migration M1-e): the guard recomputes the digest of the snapshot it writes =====
select pg_temp.op();
select is(private.snapshot_digest_of(array['d2000000-0000-4000-8000-00000000000b:d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-00000000000a:d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a:d3000000-0000-4000-8000-000000000003']), '82eef2b94352364281abc6e08e377aa99232a34f8c82f19ed16efe139c35e475', 'digest (M1-f): the SQL digest equals @trace/shared snapshotDigest on the pinned vector (item-hash.test.ts)');
select is((select snapshot_digest from public.test_versions where id = pg_temp.id('ta')), (select private.snapshot_digest_of(array_agg(sp.section_id::text || ':' || sp.item_version_id::text)) from public.section_pool_snapshot as sp where sp.test_version_id = pg_temp.id('ta')), 'digest (M1-f): a published v2 version stores the digest of its snapshot''s section:item lines');
select is((select snapshot_digest is null from public.test_versions where id = pg_temp.id('tg')), true, 'digest: a v1 version stores none (it has no snapshot), even when one is sent');
select pg_temp.tv('tk', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sk', 'tk', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000a', 1, 100);
select pg_temp.preset('tk', 'standard');
select matches(pg_temp.try($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id = pg_temp.id('tk')$$), '^42501 TRACE_GUARD: publish needs the snapshot digest', 'digest: a v2 publish without a digest is refused');
select matches(pg_temp.try($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64), snapshot_digest = repeat('0', 64) where id = pg_temp.id('tk')$$), '^40001 TRACE_GUARD: the package was built from another snapshot', 'digest: a digest of other rows is refused with 40001 (the api rebuilds and retries)');
select is((select count(*)::int || '|' || (select status::text from public.test_versions where id = pg_temp.id('tk')) from public.section_pool_snapshot where test_version_id = pg_temp.id('tk')), '0|draft', 'digest: a refused publish writes no snapshot and leaves the draft');
create temp table stale_digest as select pg_temp.live_digest('tk') as d;
delete from public.pool_items where pool_id = 'd1000000-0000-4000-8000-00000000000a' and item_version_id = pg_temp.id('v4');
select matches(pg_temp.try(format($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64), snapshot_digest = %L where id = %L$$, (select d from stale_digest), pg_temp.id('tk'))), '^40001 TRACE_GUARD: the package was built from another snapshot', 'digest: a package built before a pool change is refused (A1 DB review Medium, R3-2)');
select is(pg_temp.try($$select pg_temp.publish('tk')$$), 'OK 1', 'digest: rebuilt from the live pool, the publish passes');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('tk')), 7, 'digest: the snapshot holds the 7 approved items left in pool A');
select matches(pg_temp.try($$update public.test_versions set status = 'retired', snapshot_digest = repeat('1', 64) where id = pg_temp.id('tk')$$), '^42501 TRACE_GUARD: a published test version is frozen', 'digest: the digest freezes with the version');
select pg_temp.tv('tl', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sl', 'tl', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000c', 1, 100);
select pg_temp.preset('tl', 'standard');
select pg_temp.u('owner');
select is(pg_temp.try($$update public.test_versions set snapshot_digest = repeat('2', 64) where id = pg_temp.id('tl')$$), 'OK 1', 'digest: a draft update may name the column (the owner holds its update grant)');
select is((select snapshot_digest is null from public.test_versions where id = pg_temp.id('tl')), true, 'digest: a draft keeps none (only the publish update carries it)');
select is(pg_temp.try($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64), snapshot_digest = pg_temp.live_digest('tl') where id = pg_temp.id('tl')$$), 'OK 1', 'digest: the owner publishes a v2 version with its digest');
select pg_temp.op();

-- ===== Migration M1-f (R5-60): exposure is not in the digest; trigger states; the column grant's denied cases =====
select is((select string_agg(tgname || '=' || tgenabled::text, ',' order by tgname) from pg_trigger where tgname in ('test_versions_snapshot_digest', 'item_versions_variants_numbered')), 'item_versions_variants_numbered=A,test_versions_snapshot_digest=A', 'R5-60 d: both M1-e triggers are ENABLE ALWAYS');
select is((select string_agg(tgname, ',' order by tgname collate "C") from pg_trigger where tgrelid = 'public.test_versions'::regclass and tgname in ('test_versions_guard', 'test_versions_snapshot_digest')), 'test_versions_guard,test_versions_snapshot_digest', 'R5-60 d: the digest trigger sorts after the publish guard on test_versions');
select is((select string_agg(tgname, ',' order by tgname collate "C") from pg_trigger where tgrelid = 'public.item_versions'::regclass and tgname in ('item_versions_guard', 'item_versions_variants_numbered')), 'item_versions_guard,item_versions_variants_numbered', 'R5-60 d: the numbering trigger sorts after the item guard on item_versions');
select is((select string_agg(r, ',' order by r) from unnest(array['anon', 'trace_api', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_authoring_worker', 'trace_admin_worker', 'trace_candidate']) as r where has_column_privilege(r, 'public.test_versions', 'snapshot_digest', 'UPDATE')), null, 'R5-60 d: no role but authenticated may update snapshot_digest');
select pg_temp.tv('tm', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sm', 'tm', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000c', 1, 100);
select pg_temp.preset('tm', 'standard');
select pg_temp.u('reviewer');
select is(pg_temp.try($$update public.test_versions set snapshot_digest = repeat('3', 64) where id = pg_temp.id('tm')$$), 'OK 0', 'R5-60 d: a reviewer updates no test version (RLS)');
select pg_temp.u('hm');
select is(pg_temp.try($$update public.test_versions set snapshot_digest = repeat('3', 64) where id = pg_temp.id('tm')$$), 'OK 0', 'R5-60 d: a hiring manager updates no test version (RLS)');
select pg_temp.u('b_admin');
select is(pg_temp.try($$update public.test_versions set snapshot_digest = repeat('3', 64) where id = pg_temp.id('tm')$$), 'OK 0', 'R5-60 d: another org''s admin updates no test version (RLS)');
select pg_temp.op();
create temp table exposure_digest as select pg_temp.live_digest('tm') as d;
select pg_temp.session('sx', 'tl', 91);
select pg_temp.w('trace_worker', pg_temp.id('A'));
select is(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) select %L, %L, %L, sp.item_version_id, 1, now() from public.section_pool_snapshot as sp where sp.section_id = %L and exists (select 1 from public.pool_items as pi where pi.pool_id = 'd1000000-0000-4000-8000-00000000000c' and pi.item_version_id = sp.item_version_id) order by sp.item_version_id limit 1$$, pg_temp.id('A'), pg_temp.id('sx'), pg_temp.id('sl'), pg_temp.id('sl'))), 'OK 1', 'R5-60 a: an item of pool C is served in a live session of the published version');
select pg_temp.op();
select is((select count(*)::int from public.item_exposure_events where session_item_id in (select id from public.session_items where session_id = pg_temp.id('sx'))), 1, 'R5-60 a: the serve counted one exposure');
select is(pg_temp.try(format($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64), snapshot_digest = %L where id = %L$$, (select d from exposure_digest), pg_temp.id('tm'))), 'OK 1', 'R5-60 a (DB review Medium): a package built before an item was served still publishes (exposure is not in the digest)');
select is((select max(exposure_at_publish) from public.section_pool_snapshot where test_version_id = pg_temp.id('tm')), 1, 'R5-60 a: the snapshot still freezes the exposure count at publish');
select * from finish();
rollback;
