-- rls_m1_keys (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_keys; §3.2 item_variant_keys, §3.3 item_answer_keys, §3.5, I-M1-5; AT-M1-22; R2-4, R3-7, R5-44). RED first: written from the spec before migration M1-a. Personas and items are synthetic.
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
-- (approved pool items of pool sections, inline items of inline sections) with their exposure, as @trace/shared
-- snapshotDigest computes it. publish() sends it, so a v2 publish passes the M1-e digest check.
create function pg_temp.live_digest(p_tv text) returns text language sql stable as $f$
  select encode(sha256(convert_to(coalesce(string_agg(x.l, E'\n' order by x.l collate "C"), ''), 'UTF8')), 'hex')
  from (
    select s.id::text || ':' || i.id::text || ':' ||
      (select count(*) from public.item_exposure_events as e where e.org_id = i.org_id and e.item_id = i.item_id)::text as l
    from public.sections as s
    join public.pool_items as pi on pi.org_id = s.org_id and pi.pool_id = s.pool_id
    join public.item_versions as i on i.org_id = pi.org_id and i.id = pi.item_version_id and i.status = 'approved'
    where s.test_version_id = pg_temp.id(p_tv)
    union all
    select s.id::text || ':' || i.id::text || ':' ||
      (select count(*) from public.item_exposure_events as e where e.org_id = i.org_id and e.item_id = i.item_id)::text
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
select plan(63);
select pg_temp.bank('qa1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('q2a', pg_temp.id('A'), pg_temp.id('A2'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('qd1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'draft');
select pg_temp.bank('qb1', pg_temp.id('B'), pg_temp.id('BW'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('la1', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'verbal', 0.50, 'approved');
-- A parameterised library item (one variant with its key), approved by the expert.
insert into public.items (id, org_id, workspace_id, format, skill_key, created_by) values
  ('c2000000-0000-4000-8000-000000000002', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'quant', pg_temp.id('lib_author'));
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256, created_by) values
  ('c2100000-0000-4000-8000-000000000002', pg_temp.id('L'), 'c2000000-0000-4000-8000-000000000002', 'mcq', '[synthetic] Library param',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64), pg_temp.id('lib_author'));
insert into public.item_variants (id, org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values
  ('c2200000-0000-4000-8000-000000000002', pg_temp.id('L'), 'c2100000-0000-4000-8000-000000000002', 1, '{"a": 3}',
   '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.50, repeat('c', 64));
insert into public.item_variant_keys (org_id, item_variant_id, key) values (pg_temp.id('L'), 'c2200000-0000-4000-8000-000000000002', '{"option_id": "o1"}');
update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000002';
update public.item_versions set status = 'approved', approved_by = pg_temp.id('lib_expert'), reviewed_by = pg_temp.id('lib_expert'), key_reviewed_by = pg_temp.id('lib_expert') where id = 'c2100000-0000-4000-8000-000000000002';
-- A parameterised draft in org A with its own variant (its key is added by the tests).
insert into public.items (id, org_id, workspace_id, format, skill_key) values
  ('c2000000-0000-4000-8000-000000000003', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant');
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256) values
  ('c2100000-0000-4000-8000-000000000003', pg_temp.id('A'), 'c2000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] Org A param',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64));
insert into public.item_variants (id, org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values
  ('c2200000-0000-4000-8000-000000000003', pg_temp.id('A'), 'c2100000-0000-4000-8000-000000000003', 1, '{"a": 5}',
   '[synthetic] What is 5 + 1?', '[{"id": "o1", "text": "6"}, {"id": "o2", "text": "5"}]', 0.50, repeat('c', 64));
-- An inline (D1-mode) draft with one MCQ item.
insert into public.tests (id, org_id, workspace_id, name, created_by) values
  ('e1000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'Test One', pg_temp.id('owner'));
insert into public.test_versions (id, org_id, test_id, total_time_seconds, quality_cutoff, created_by) values
  ('f1000000-0000-4000-8000-000000000001', pg_temp.id('A'), 'e1000000-0000-4000-8000-000000000001', 1800, 40, pg_temp.id('owner'));
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-000000000001', pg_temp.id('A'), 'f1000000-0000-4000-8000-000000000001', 1, 'Choices', 'mcq', 1);
insert into public.item_versions (id, org_id, section_id, format, position, stem, options, content_sha256) values
  ('61000000-0000-4000-8000-000000000001', pg_temp.id('A'), '51000000-0000-4000-8000-000000000001', 'mcq', 1, '[synthetic] Inline', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', repeat('c', 64));
-- The owner copies both library items into workspace A1 (keys arrive library_sourced).
select pg_temp.u('owner');
insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids)
  values (pg_temp.id('A'), pg_temp.id('A1'), array[pg_temp.id('la1'), 'c2100000-0000-4000-8000-000000000002'::uuid]);
select pg_temp.op();
insert into pg_temp.ids select 'copy_la1', id from public.item_versions where org_id = pg_temp.id('A') and source_item_version_id = pg_temp.id('la1');
insert into pg_temp.ids select 'copy_param', id from public.item_versions where org_id = pg_temp.id('A') and source_item_version_id = 'c2100000-0000-4000-8000-000000000002';

-- ===== SEC-M1-1 (I-M1-5): a library copy never carries the key inside its param_spec =====
select is((select (param_spec is not null)::text || '|' || (param_spec ? 'correctOptionId')::text || '|' || (param_spec = (select s.param_spec - 'correctOptionId' from public.item_versions as s where s.id = 'c2100000-0000-4000-8000-000000000002'))::text from public.item_versions where id = pg_temp.id('copy_param')), 'true|false|true', 'SEC-M1-1: the copy keeps the library param_spec without correctOptionId');
select pg_temp.u('owner');
select is((select count(*)::int || '|' || (count(*) filter (where param_spec ? 'correctOptionId'))::int from public.item_versions where source_item_version_id is not null and param_spec is not null), '1|0', 'SEC-M1-1: owner reads the parameterised copy, never its key');
select pg_temp.u('admin');
select is((select count(*)::int || '|' || (count(*) filter (where param_spec ? 'correctOptionId'))::int from public.item_versions where source_item_version_id is not null and param_spec is not null), '1|0', 'SEC-M1-1: admin reads the parameterised copy, never its key');
select pg_temp.u('recruiter');
select is((select count(*)::int || '|' || (count(*) filter (where param_spec ? 'correctOptionId'))::int from public.item_versions where source_item_version_id is not null and param_spec is not null), '1|0', 'SEC-M1-1: recruiter reads the parameterised copy, never its key');
select pg_temp.u('reviewer');
select is((select count(*)::int || '|' || (count(*) filter (where param_spec ? 'correctOptionId'))::int from public.item_versions where source_item_version_id is not null and param_spec is not null), '1|0', 'SEC-M1-1: reviewer reads the parameterised copy, never its key');
select pg_temp.u('owner');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] Org A param v2', '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true, '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "count": 5}', repeat('c', 64))$$), '^23514', 'SEC-M1-1: an authored parameterised item names its correct option (only a library copy omits it)');
select pg_temp.op();
insert into public.items (id, org_id, workspace_id, format, skill_key) values
  ('c2000000-0000-4000-8000-000000000009', pg_temp.id('A'), pg_temp.id('A2'), 'mcq', 'quant');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, origin, source_item_version_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000009', 'mcq', '[synthetic] Copy with key', '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true, '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}', 'library', 'c2100000-0000-4000-8000-000000000002', repeat('c', 64))$$), '^23514', 'SEC-M1-1: a library-origin row carrying correctOptionId breaks its CHECK, even on the operator path');
select is((select pg_get_function_result('private.library_browse(uuid, text, text[], text, public.section_format, numeric, numeric, timestamptz, uuid, int)'::regprocedure) !~ '(param_spec|correct|answer|option_id)'), true, 'SEC-M1-1: library browse returns no param_spec and no key-like column');

-- ===== I-M1-5 / AT-M1-22: library-sourced keys are invisible to every org role =====
select is((select count(*)::int from public.item_answer_keys where library_sourced) || '/' || (select count(*)::int from public.item_variant_keys where library_sourced), '1/1', 'fixture: the copy brought one base key and one variant key, both library_sourced');
select pg_temp.u('owner');
select is((select count(*)::int from public.item_answer_keys where library_sourced) + (select count(*)::int from public.item_variant_keys where library_sourced), 0, 'I-M1-5: owner reads no library-sourced key');
select is((select count(*)::int from public.item_answer_keys where item_version_id = pg_temp.id('qa1')), 1, 'keys S: owner reads the org''s own bank key');
select pg_temp.u('admin');
select is((select count(*)::int from public.item_answer_keys where library_sourced) + (select count(*)::int from public.item_variant_keys where library_sourced), 0, 'I-M1-5: admin reads no library-sourced key');
select pg_temp.u('recruiter');
select is((select count(*)::int from public.item_answer_keys where library_sourced) + (select count(*)::int from public.item_variant_keys where library_sourced), 0, 'I-M1-5: recruiter reads no library-sourced key');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.item_answer_keys where library_sourced) + (select count(*)::int from public.item_variant_keys where library_sourced), 0, 'I-M1-5: reviewer reads no library-sourced key');
select is((select count(*)::int from public.item_answer_keys where item_version_id = pg_temp.id('qa1')), 1, 'keys S: the reviewer reads a bank key of their workspace (approval arm, R2-4)');
select pg_temp.u('ws_reviewer');
select is((select count(*)::int from public.item_answer_keys where item_version_id = pg_temp.id('qa1')), 0, 'keys S: a reviewer fenced to workspace A2 reads no workspace A1 key');
select is((select count(*)::int from public.item_answer_keys where item_version_id = pg_temp.id('q2a')), 1, 'keys S: the fenced reviewer reads the workspace A2 key');
select pg_temp.u('hm');
select is((select count(*)::int from public.item_answer_keys) + (select count(*)::int from public.item_variant_keys), 0, 'keys S: hiring manager reads no key');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.item_answer_keys where org_id = pg_temp.id('A')), 0, 'keys S: org B admin reads no org A key');
select pg_temp.u('lib_author');
select is((select count(*)::int from public.item_answer_keys where org_id = pg_temp.id('A')), 0, 'keys S: library staff read no customer key (the copy is single-tenant)');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select is((select count(*)::int from public.item_answer_keys where library_sourced) || '/' || (select count(*)::int from public.item_variant_keys where library_sourced), '1/1', 'AT-M1-22: the quality worker reads the library-sourced keys of its job org');
select is((select count(*)::int from public.item_answer_keys where org_id <> pg_temp.id('A')), 0, 'keys S: the quality worker reads only its job org');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.item_variant_keys'), '^42501 permission denied', 'keys S: trace_api has no grant on variant keys');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try('select * from public.item_answer_keys'), '^42501 permission denied', 'keys S: trace_candidate has no privilege');
select pg_temp.op();

-- ===== Writes on library-sourced keys =====
select pg_temp.u('owner');
select is(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o2"}' where item_version_id = %L$$, pg_temp.id('copy_la1'))), 'OK 0', 'library keys: owner updates no library-sourced key');
select is(pg_temp.try(format($$delete from public.item_answer_keys where item_version_id = %L$$, pg_temp.id('copy_la1'))), 'OK 0', 'library keys: owner deletes no library-sourced key');
select matches(pg_temp.try(format($$insert into public.item_answer_keys (org_id, item_version_id, format, key, library_sourced) values ('a1000000-0000-4000-8000-000000000001', %L, 'mcq', '{"option_id": "o1"}', true)$$, pg_temp.id('qd1'))), '^42501 permission denied', 'library keys: library_sourced is outside the insert grant');

-- ===== Bank keys: draft only (§3.3) =====
select is(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o2"}' where item_version_id = %L$$, pg_temp.id('qd1'))), 'OK 1', 'bank keys: the key of a draft is changed');
select matches(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o2"}' where item_version_id = %L$$, pg_temp.id('qa1'))), '^42501 TRACE_GUARD: the item version is frozen', 'bank keys: the key of an approved item is frozen');
select matches(pg_temp.try(format($$delete from public.item_answer_keys where item_version_id = %L$$, pg_temp.id('qa1'))), '^42501 TRACE_GUARD: the item version is frozen', 'bank keys: the key of an approved item is not deleted');
select matches(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o9"}' where item_version_id = %L$$, pg_temp.id('qd1'))), '^23514 TRACE_BAD_ANSWER_KEY', 'bank keys: the key names one of the item options');
select pg_temp.op();
select is((select coalesce(test_id::text, 'null') || '|' || (workspace_id = pg_temp.id('A1'))::text from public.item_answer_keys where item_version_id = pg_temp.id('qd1')), 'null|true', 'R5-44: a bank key has no test and the item''s workspace');
select pg_temp.u('ws_recruiter');
select is(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o1"}' where item_version_id = %L$$, pg_temp.id('qd1'))), 'OK 0', 'bank keys: workspace recruiter changes no workspace A1 key');
select pg_temp.u('reviewer');
select is(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o1"}' where item_version_id = %L$$, pg_temp.id('qd1'))), 'OK 0', 'bank keys: a reviewer changes no key');

-- ===== Inline keys take their test from their item (R5-44, replaces D1 I-12 NOT NULL test_id) =====
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) values ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'mcq', '{"option_id": "o1"}')$$), 'OK 1', 'inline keys: owner adds the key of an inline item');
select pg_temp.op();
select is((select test_id from public.item_answer_keys where item_version_id = '61000000-0000-4000-8000-000000000001'), 'e1000000-0000-4000-8000-000000000001'::uuid, 'inline keys: the test comes from the item');
select matches(pg_temp.try($$update public.item_answer_keys set test_id = null where item_version_id = '61000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: answer key org, item and scope are immutable', 'inline keys: an inline key never loses its test, even on the operator path');
select is((select count(*)::int from public.item_answer_keys as k join public.item_versions as i on i.id = k.item_version_id where i.section_id is not null and k.test_id is null), 0, 'inline keys: no inline key without its test');

-- ===== Variant keys =====
select pg_temp.u('owner');
select matches(pg_temp.try($$insert into public.item_variant_keys (org_id, item_variant_id, key) values ('a1000000-0000-4000-8000-000000000001', 'c2200000-0000-4000-8000-000000000003', '{"option_id": "o7"}')$$), '^23514 TRACE_BAD_ANSWER_KEY', 'variant keys: the key names one of the variant options');
select is(pg_temp.try($$insert into public.item_variant_keys (org_id, item_variant_id, key) values ('a1000000-0000-4000-8000-000000000001', 'c2200000-0000-4000-8000-000000000003', '{"option_id": "o1"}')$$), 'OK 1', 'variant keys: owner keys a variant of a draft');
select is((select count(*)::int from public.item_variant_keys where item_variant_id = 'c2200000-0000-4000-8000-000000000003'), 1, 'variant keys: owner reads it');
select matches(pg_temp.try($$insert into public.item_variant_keys (org_id, item_variant_id, key, library_sourced) values ('a1000000-0000-4000-8000-000000000001', 'c2200000-0000-4000-8000-000000000003', '{"option_id": "o1"}', true)$$), '^42501 permission denied', 'variant keys: library_sourced is outside the insert grant');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.item_variant_keys where item_variant_id = 'c2200000-0000-4000-8000-000000000003'), 1, 'variant keys: the reviewer reads a workspace variant key');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.item_variant_keys where item_variant_id = 'c2200000-0000-4000-8000-000000000003'), 0, 'variant keys: workspace recruiter reads no workspace A1 variant key');
select pg_temp.u('owner');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000003'$$), 'OK 1', 'variant keys: the keyed parameterised draft is submitted');
select matches(pg_temp.try($$update public.item_variant_keys set key = '{"option_id": "o2"}' where item_variant_id = 'c2200000-0000-4000-8000-000000000003'$$), '^42501 TRACE_GUARD: the item version is frozen', 'variant keys: frozen once the item leaves draft');
select matches(pg_temp.try($$delete from public.item_variant_keys where item_variant_id = 'c2200000-0000-4000-8000-000000000003'$$), '^42501 TRACE_GUARD: the item version is frozen', 'variant keys: not deleted once the item leaves draft');

-- ===== Library browse never carries a key (R2-5, R3-7, LibraryItemCard) =====
select pg_temp.api(pg_temp.id('A'));
select is((select count(*)::int from private.library_browse('00000000-0000-4000-8000-000000000001', 'aal2', array['otp', 'totp'], null, null, null, null, null, null, 50)), 2, 'library browse: an owner of the api org sees the two approved library items');
select is((select options from private.library_browse('00000000-0000-4000-8000-000000000001', 'aal2', array['otp', 'totp'], 'verbal', null, null, null, null, null, 50)), '["One", "Two"]'::jsonb, 'library browse: options are texts only (no option ids, no key)');
select is((select count(*)::int from private.library_browse(null, null, null, null, null, null, null, null, null, 50)), 0, 'library browse: no viewer (the candidate path) sees nothing (R3-7)');
select is((select count(*)::int from private.library_browse('00000000-0000-4000-8000-000000000008', 'aal1', array['otp'], null, null, null, null, null, null, 50)), 0, 'library browse: a hiring manager sees nothing');
select is((select count(*)::int from private.library_browse('00000000-0000-4000-8000-000000000003', 'aal1', array['otp'], null, null, null, null, null, null, 50)), 0, 'library browse: an admin at aal1 sees nothing');
select is((select count(*)::int from private.library_browse('00000000-0000-4000-8000-00000000000e', 'aal2', array['otp', 'totp'], null, null, null, null, null, null, 50)), 0, 'library browse: an org B admin sees nothing through the org A api context');
-- Migration M1-e: a keyset page on (created_at, id), the PageCursor of the api (R5-53), returning created_at.
select is((select pg_get_function_result('private.library_browse(uuid, text, text[], text, public.section_format, numeric, numeric, timestamptz, uuid, int)'::regprocedure) ~ 'created_at timestamp with time zone'), true, 'library browse (M1-e): each row carries its created_at for the next cursor');
select is((select count(*)::int from private.library_browse('00000000-0000-4000-8000-000000000001', 'aal2', array['otp', 'totp'], null, null, null, null, null, null, 1)), 1, 'library browse (M1-e): a page of one');
select is((with p1 as (select created_at, library_item_version_id from private.library_browse('00000000-0000-4000-8000-000000000001', 'aal2', array['otp', 'totp'], null, null, null, null, null, null, 1)), p2 as (select b.created_at, b.library_item_version_id from p1, lateral private.library_browse('00000000-0000-4000-8000-000000000001', 'aal2', array['otp', 'totp'], null, null, null, null, p1.created_at, p1.library_item_version_id, 1) as b) select count(*)::int from p2 where (p2.created_at, p2.library_item_version_id) > (select p1.created_at, p1.library_item_version_id from p1)), 1, 'library browse (M1-e): the page after the cursor holds the next item in (created_at, id) order');
select is((with p1 as (select created_at, library_item_version_id from private.library_browse('00000000-0000-4000-8000-000000000001', 'aal2', array['otp', 'totp'], null, null, null, null, null, null, 2) order by created_at desc, library_item_version_id desc limit 1) select count(*)::int from p1, lateral private.library_browse('00000000-0000-4000-8000-000000000001', 'aal2', array['otp', 'totp'], null, null, null, null, p1.created_at, p1.library_item_version_id, 50) as b), 0, 'library browse (M1-e): nothing after the last item');
select pg_temp.api(pg_temp.id('L'));
select is((select count(*)::int from private.library_browse('00000000-0000-4000-8000-000000000020', 'aal2', array['otp', 'totp'], null, null, null, null, null, null, 50)), 0, 'library browse: customers only (library staff use the bank itself)');
select pg_temp.u('owner');
select matches(pg_temp.try($$select * from private.library_browse(null, null, null, null, null, null, null, null, null, 50)$$), '^42501', 'library browse: authenticated cannot call it');
select pg_temp.op();

-- ===== SEC-M1-5: a library copy keeps the library prefix of its images (the one cross-org prefix allowed) =====
insert into public.items (id, org_id, workspace_id, format, skill_key, created_by) values
  ('c2000000-0000-4000-8000-0000000000f1', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'verbal', pg_temp.id('lib_author'));
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, media, content_sha256, created_by) values
  ('c2100000-0000-4000-8000-0000000000f1', pg_temp.id('L'), 'c2000000-0000-4000-8000-0000000000f1', 'mcq', '[synthetic] Library item with image',
   '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50,
   jsonb_build_array(jsonb_build_object('key', 'item-media/' || pg_temp.id('L') || '/' || repeat('a', 64) || '.png', 'alt', 'A chart')),
   repeat('c', 64), pg_temp.id('lib_author'));
insert into public.item_answer_keys (org_id, item_version_id, format, key) values (pg_temp.id('L'), 'c2100000-0000-4000-8000-0000000000f1', 'mcq', '{"option_id": "o1"}');
update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-0000000000f1';
update public.item_versions set status = 'approved', approved_by = pg_temp.id('lib_expert'), reviewed_by = pg_temp.id('lib_expert'), key_reviewed_by = pg_temp.id('lib_expert') where id = 'c2100000-0000-4000-8000-0000000000f1';
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', array['c2100000-0000-4000-8000-0000000000f1']::uuid[])$$), 'OK 1', 'SEC-M1-5: a library item with an image is copied into workspace A2');
select pg_temp.op();
select is((select split_part(media -> 0 ->> 'key', '/', 2) from public.item_versions where org_id = pg_temp.id('A') and source_item_version_id = 'c2100000-0000-4000-8000-0000000000f1'), pg_temp.id('L')::text, 'SEC-M1-5: the copy keeps the library image prefix');

-- ===== DB-M1-6 (R5-33): answer keys are never truncated, even by the owner =====
select matches(pg_temp.try('truncate public.item_answer_keys'), '^42501 TRACE_GUARD: bank content is never truncated', 'DB-M1-6: TRUNCATE item_answer_keys is refused on the operator path');
select is((select tgenabled::text from pg_trigger where tgrelid = 'public.item_answer_keys'::regclass and tgname = 'item_answer_keys_no_truncate'), 'A', 'DB-M1-6: the truncate trigger is ENABLE ALWAYS');
select * from finish();
rollback;
