-- rls_m1_serving (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_serving; §3.3 session_items; §3.4; M1-6; AT-M1-03, AT-M1-08 (serving half), AT-M1-21 (db case), AT-M1-28; I-M1-1, I-M1-8; R2-1, R2-7, R2-16, R3-2, R5-19, R5-36, R5-39 a, R5-41, R5-42, R5-43; E28). RED first: written from the spec before migration M1-b. Personas, items and sessions are synthetic.
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
select plan(63);
-- Fixtures (operator path): pool P (mcq, workspace A1) = approved s1..s8, the parameterised pq (two variants) and cp1, a
-- copy of the library item lib1; s9 is approved but in no pool; ai1 is an AI draft in review. Version v2 (Standard):
-- section sp draws 3 from P, section si is inline with ii1. Version v1: D1-style inline section with iv1.
select pg_temp.bank('s' || n, pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved') from generate_series(1, 9) as n;
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
   '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.50, repeat('c', 64)),
  ('c2200000-0000-4000-8000-000000000002', pg_temp.id('A'), 'c2100000-0000-4000-8000-000000000001', 2, '{"a": 5}',
   '[synthetic] What is 5 + 1?', '[{"id": "o1", "text": "6"}, {"id": "o2", "text": "5"}]', 0.55, repeat('c', 64));
insert into public.item_variant_keys (org_id, item_variant_id, key) values
  (pg_temp.id('A'), 'c2200000-0000-4000-8000-000000000001', '{"option_id": "o1"}'),
  (pg_temp.id('A'), 'c2200000-0000-4000-8000-000000000002', '{"option_id": "o1"}');
update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000001';
update public.item_versions set status = 'approved', approved_by = pg_temp.id('owner') where id = 'c2100000-0000-4000-8000-000000000001';
insert into pg_temp.ids values ('pq', 'c2100000-0000-4000-8000-000000000001'), ('pq_item', 'c2000000-0000-4000-8000-000000000001'),
  ('pqv1', 'c2200000-0000-4000-8000-000000000001'), ('pqv2', 'c2200000-0000-4000-8000-000000000002');
select pg_temp.ai_draft('ai1', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.u('owner');
insert into public.library_copy_requests (id, org_id, workspace_id, library_item_version_ids) values
  ('e5000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), array[pg_temp.id('lib1')]);
select pg_temp.op();
insert into pg_temp.ids select 'cp1', result_item_version_ids[1] from public.library_copy_requests where id = 'e5000000-0000-4000-8000-000000000001';
insert into public.pools (id, org_id, workspace_id, name, format) values
  ('d1000000-0000-4000-8000-0000000000e1', pg_temp.id('A'), pg_temp.id('A1'), 'Serving pool', 'mcq');
insert into public.pool_items (org_id, pool_id, item_version_id)
  select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000e1'::uuid, pg_temp.id(k)
  from unnest(array['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 'pq', 'cp1']) as k;
select pg_temp.tv('v2', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sp', 'v2', 1, 'mcq', 'd1000000-0000-4000-8000-0000000000e1', 3, 50);
select pg_temp.sec('si', 'v2', 2, 'mcq', null, null, 50);
select pg_temp.inline('ii1', 'si');
select pg_temp.preset('v2', 'standard');
select pg_temp.publish('v2');
select pg_temp.tv('v1', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-0000000000d1', pg_temp.id('A'), pg_temp.id('v1'), 1, 'Choices', 'mcq', 1);
insert into pg_temp.ids values ('sv1', '51000000-0000-4000-8000-0000000000d1');
select pg_temp.inline('iv1', 'sv1');
select pg_temp.publish('v1');
select pg_temp.session('a', 'v2', 11);
select pg_temp.session('b', 'v2', 12);
select pg_temp.session('d', 'v2', 14);
select pg_temp.session('c', 'v1', 13);
-- si(key, session, section, item, position, served, variant, option order): one session_items insert as the mirror
-- (trace_worker bound to org A); returns try()'s result. Records <key> = the row id.
create function pg_temp.si(p_key text, p_sess text, p_sec text, p_item text, p_pos int, p_served boolean,
  p_variant text default null, p_order jsonb default null) returns text language plpgsql as $f$
declare v_id uuid := gen_random_uuid(); v_r text;
begin
  perform pg_temp.w('trace_worker', pg_temp.id('A'));
  v_r := pg_temp.try(format($s$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at, item_variant_id, option_order) values (%L, %L, %L, %L, %L, %s, %s, %L, %L)$s$,
    v_id, pg_temp.id('A'), pg_temp.id(p_sess), pg_temp.id(p_sec), pg_temp.id(p_item), p_pos,
    case when p_served then '''2026-10-14 10:05:00+00''' else 'null' end,
    case when p_variant is null then null else pg_temp.id(p_variant) end, p_order));
  perform pg_temp.op();
  if v_r like 'OK%' then
    insert into pg_temp.ids values (p_key, v_id);
  end if;
  return v_r;
end
$f$;

-- ===== AT-M1-08 (exit gate): an unapproved AI draft is never served, nor stored as drawn =====
select matches(pg_temp.si('x1', 'a', 'sp', 'ai1', 1, true), '^42501 TRACE_GUARD: unapproved item cannot be served$', 'AT-M1-08: the mirror cannot serve an AI draft without its approver (session_items_a_ai_gate)');
select matches(pg_temp.si('x2', 'a', 'sp', 'ai1', 1, false), '^42501 TRACE_GUARD: unapproved item cannot be served$', 'AT-M1-08 (R5-43): nor store it as drawn but unserved');
select is((select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.session_items'::regclass and not tgisinternal and tgtype & 2 = 2), 'session_items_a_ai_gate,session_items_guard', 'AT-M1-08 (R2-16): the gate is the first BEFORE trigger by name');
select is((select tgenabled::text from pg_trigger where tgrelid = 'public.session_items'::regclass and tgname = 'session_items_a_ai_gate'), 'A', 'AT-M1-08: the gate is ENABLE ALWAYS');

-- ===== Package v2: snapshot membership, draws, variants, option order (R2-1, R5-19, R5-39 a, R5-43) =====
select is(pg_temp.si('a_s1', 'a', 'sp', 's1', 1, true), 'OK 1', 'v2: a served pool item of the snapshot is stored');
select is(pg_temp.si('a_s2', 'a', 'sp', 's2', 2, false), 'OK 1', 'v2 (R5-19): a drawn but unserved pool item is stored with served_at null');
select is(pg_temp.si('a_pq', 'a', 'sp', 'pq', 3, true, 'pqv2', '["o2", "o1"]'), 'OK 1', 'v2: a parameterised item is stored as one of its variants, with its served option order');
select is(pg_temp.si('a_ii1', 'a', 'si', 'ii1', 1, true), 'OK 1', 'v2: a served inline item is stored');
select matches(pg_temp.si('x3', 'a', 'sp', 's9', 4, true), '^42501 TRACE_GUARD: the item is not in the published snapshot of its section', 'v2: an approved item outside the snapshot is refused');
select matches(pg_temp.si('x4', 'a', 'si', 's3', 2, true), '^42501 TRACE_GUARD: the item is not in the published snapshot of its section', 'v2: a snapshot item named under another section is refused');
select matches(pg_temp.si('x5', 'b', 'si', 'ii1', 1, false), '^42501 TRACE_GUARD: an inline item is stored when served', 'v2 (R5-43, R5-47): an inline item is stored only when served');
select matches(pg_temp.si('x6', 'b', 'sp', 'pq', 1, true), '^42501 TRACE_GUARD: a parameterised item is served as one of its variants', 'v2 (R5-39 a): a parameterised item needs its variant');
select matches(pg_temp.si('x7', 'b', 'sp', 's3', 1, true, 'pqv1'), '^(42501 TRACE_GUARD: a parameterised item is served as one of its variants|23503)', 'v2 (R5-39 a): a plain item takes no variant');
select matches(pg_temp.si('x8', 'b', 'sp', 's3', 1, true, null, '["o1", "o1"]'), '^42501 TRACE_GUARD: the option order is a permutation of the served options', 'v2: a repeated option id is not a permutation');
select matches(pg_temp.si('x9', 'b', 'sp', 's3', 1, true, null, '["o1"]'), '^42501 TRACE_GUARD: the option order is a permutation of the served options', 'v2: a missing option id is not a permutation');
select matches(pg_temp.si('x10', 'b', 'sp', 'pq', 1, true, 'pqv1', '["o1", "o3"]'), '^42501 TRACE_GUARD: the option order is a permutation of the served options', 'v2: a variant''s order permutes the variant''s options');
select is(pg_temp.si('b_s3', 'b', 'sp', 's3', 1, true, null, '["o2", "o1"]'), 'OK 1', 'v2: a shuffled option order is stored');
select is(pg_temp.si('b_cp1', 'b', 'sp', 'cp1', 2, true), 'OK 1', 'v2: a library copy in the pool is served');
select matches(pg_temp.si('x11', 'b', 'sp', 's3', 3, true), '^23505', 'v2: the same item twice in a session is refused by the unique key');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at, draw_seed_sha256) values (%L, %L, %L, %L, 3, now(), 'not a hash')$$, pg_temp.id('A'), pg_temp.id('b'), pg_temp.id('sp'), pg_temp.id('s4'))), '^23514', 'v2: the draw seed is a SHA-256 hex digest');
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) values (%L, %L, null, %L, 3, now())$$, pg_temp.id('A'), pg_temp.id('b'), pg_temp.id('s4'))), '^42501 TRACE_GUARD: a version 2 item names its section', 'v2 (R2-1): a v2 row names its section');
select matches(pg_temp.try(format($$update public.session_items set served_at = now() where id = %L$$, pg_temp.id('a_s2'))), '^42501', 'R5-41: session items are insert-only (a drawn row is never marked served later)');
select pg_temp.op();
-- A retired item stays servable from a published snapshot (E3; the gate allows approved and retired).
select pg_temp.u('owner');
select is(pg_temp.try(format($$update public.item_versions set status = 'retired' where id = %L$$, pg_temp.id('s5'))), 'OK 1', 'E3: a snapshotted item is retired');
select pg_temp.op();
select is(pg_temp.si('b_s5', 'b', 'sp', 's5', 3, true), 'OK 1', 'E3: a retired item of the published snapshot is still served');

-- ===== DB-M1-4 (R5-19 slots): a pool section stores at most its draw, in positions 1..draw_count =====
select matches(pg_temp.si('x13', 'a', 'sp', 's4', 2, true), '^42501 TRACE_GUARD: the section''s draw is full', 'DB-M1-4: a fourth row in a section that draws 3 is refused');
select matches(pg_temp.si('x14', 'd', 'sp', 's4', 4, false), '^42501 TRACE_GUARD: the position is outside the section''s draw', 'DB-M1-4: a position past the draw is refused');
select is(pg_temp.si('d_s4', 'd', 'sp', 's4', 3, false), 'OK 1', 'DB-M1-4: a position within the draw is stored');
select is((select count(*)::int from public.item_exposure_events where session_item_id = pg_temp.id('d_s4')), 0, 'DB-M1-4: the drawn row writes no exposure');

-- ===== Package v1 (AT-M1-28): the D1 rule stands =====
select is(pg_temp.si('c_iv1', 'c', 'sv1', 'iv1', 1, true), 'OK 1', 'v1 (AT-M1-28): a D1-style version still serves its inline item');
select matches(pg_temp.si('x12', 'c', 'sv1', 's1', 2, true), '^42501 TRACE_GUARD: the item belongs to another test version', 'v1: a bank item is not part of a v1 version');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) values (%L, %L, %L, %L, 2, null)$$, pg_temp.id('A'), pg_temp.id('c'), pg_temp.id('sv1'), pg_temp.id('iv1'))), '^(42501 TRACE_GUARD: a version 1 item is stored when served|23505)', 'v1 (R5-43): a v1 row is stored only when served');
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at, option_order) values (%L, %L, %L, %L, 1, now(), '["o1", "o2"]')$$, pg_temp.id('A'), pg_temp.id('a'), pg_temp.id('sv1'), pg_temp.id('iv1'))), '^42501 TRACE_GUARD: the item is not in the published snapshot of its section', 'v2: a v1 version''s item cannot be served in a v2 session');
select pg_temp.op();

-- ===== Exposure (AT-M1-03; I-M1-8; R5-41) =====
select is((select count(*)::int from public.item_exposure_events where session_item_id = pg_temp.id('a_s1')), 1, 'AT-M1-03: a served item writes exactly one exposure event');
select is((select (item_id = pg_temp.id('s1_item'))::text || '|' || coalesce(source_item_id::text, 'null') || '|' || (workspace_id = pg_temp.id('A1'))::text from public.item_exposure_events where session_item_id = pg_temp.id('a_s1')), 'true|null|true', 'AT-M1-03: the event names the item and the workspace');
select is((select count(*)::int from public.item_exposure_events where session_item_id = pg_temp.id('a_s2')), 0, 'AT-M1-03 (R5-41): a drawn, unserved row writes no event');
select is((select count(*)::int from public.item_exposure_events where item_id = pg_temp.id('s3_item')), 1, 'AT-M1-03: the refused duplicate counted nothing');
select is((select source_item_id from public.item_exposure_events where session_item_id = pg_temp.id('b_cp1')), pg_temp.id('lib1_item'), 'AT-M1-03 (R2-7): a library copy''s event carries the library item');
select is((select count(*)::int from public.item_exposure_events where session_item_id = pg_temp.id('c_iv1')), 1, 'AT-M1-03: a v1 served item counts too');
select pg_temp.u('owner');
select is((select served_count from public.v_item_exposure where item_id = pg_temp.id('s1_item')), 1, 'AT-M1-03: v_item_exposure counts the served item');
select is((select count(*)::int from public.v_item_exposure where item_id = pg_temp.id('s2_item')), 0, 'AT-M1-03: the drawn-only item has no exposure');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.v_item_exposure), 0, 'exposure S: a workspace A2 recruiter sees no workspace A1 exposure');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.item_exposure_events where org_id = pg_temp.id('A')), 0, 'exposure S: org B sees nothing of org A');
select pg_temp.api(pg_temp.id('L'));
select is((select served_count from private.library_exposure(pg_temp.id('lib_author'), 'aal2', '{otp,totp}') where source_item_id = pg_temp.id('lib1_item')), 1::bigint, 'E28 (R5-36): a library member reads the library item''s total across customer copies');
select pg_temp.api(pg_temp.id('A'));
select is((select count(*)::int from private.library_exposure(pg_temp.id('owner'), 'aal2', '{otp,totp}')), 0, 'R5-36: a customer viewer reads no library exposure');
select pg_temp.op();
select matches(pg_temp.try(format($$update public.item_exposure_events set served_at = now() where session_item_id = %L$$, pg_temp.id('a_s1'))), '^(42501 permission denied|P0001 TRACE_APPEND_ONLY)', 'exposure: append-only, even on the operator path (UPDATE revoked from the owner, ALWAYS trigger behind it)');

-- ===== The quality worker reads the whole draw (R5-19, AT-M1-21 db case) =====
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select is((select count(*)::int || '|' || count(*) filter (where served_at is null)::int from public.session_items where session_id = pg_temp.id('a')), '4|1', 'R5-19: the quality worker reads the drawn-but-unserved row with the served ones');
select is((select item_variant_id from public.session_items where id = pg_temp.id('a_pq')), pg_temp.id('pqv2'), 'R5-19: and the variant served');
select is((select count(*)::int from public.item_variant_keys where item_variant_id = pg_temp.id('pqv2')), 1, 'R5-19: and the variant key, to score it');
select pg_temp.op();

-- ===== responses guard v2 (R5-43): only a served item has a response =====
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$insert into public.responses (org_id, session_id, session_item_id, answer_kind, final_choice, answer_sha256, final_seq, submitted_at) values (%L, %L, %L, 'choice', 'o1', %L, 3, now())$$, pg_temp.id('A'), pg_temp.id('a'), pg_temp.id('a_s2'), repeat('a', 64))), '^42501 TRACE_GUARD: an item that was not served has no response', 'R5-43: a drawn, unserved item has no response');
select is(pg_temp.try(format($$insert into public.responses (org_id, session_id, session_item_id, answer_kind, final_choice, answer_sha256, final_seq, submitted_at) values (%L, %L, %L, 'choice', 'o1', %L, 3, now())$$, pg_temp.id('A'), pg_temp.id('a'), pg_temp.id('a_s1'), repeat('a', 64))), 'OK 1', 'R5-43: a served item takes its response');
select pg_temp.op();

-- ===== Who may write session_items (D1 unchanged) =====
select pg_temp.u('owner');
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) values (%L, %L, %L, %L, 4, now())$$, pg_temp.id('A'), pg_temp.id('b'), pg_temp.id('sp'), pg_temp.id('s6'))), '^42501 permission denied', 'session_items I: an org user cannot write');
select pg_temp.w('trace_worker', pg_temp.id('B'));
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) values (%L, %L, %L, %L, 4, now())$$, pg_temp.id('A'), pg_temp.id('b'), pg_temp.id('sp'), pg_temp.id('s6'))), '^42501', 'session_items I: a mirror bound to org B cannot write org A');
select pg_temp.op();

-- ===== exposure_at_publish (R3-2): a later publish freezes the served counts =====
select pg_temp.tv('v3', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sp3', 'v3', 1, 'mcq', 'd1000000-0000-4000-8000-0000000000e1', 1, 100);
select pg_temp.preset('v3', 'standard');
select is(pg_temp.try($$select pg_temp.publish('v3')$$), 'OK 1', 'R3-2: a second version of the pool publishes');
select is((select string_agg(k || '=' || sp.exposure_at_publish, ',' order by k) from unnest(array['s1', 's2', 's3', 'cp1']) as k join public.section_pool_snapshot as sp on sp.item_version_id = pg_temp.id(k) and sp.test_version_id = pg_temp.id('v3')), 'cp1=1,s1=1,s2=0,s3=1', 'R3-2: exposure_at_publish freezes each item''s served count (drawn-only s2 counts 0)');

-- ===== Migration M1-i (R5-62 b): trace_worker reads only the layout columns of sections and item_versions =====
select pg_temp.w('trace_worker', pg_temp.id('A'));
select ok((select count(*) from (select id, org_id, test_version_id, position, draw_count from public.sections) as s) > 0, 'M1-i: trace_worker bound to org A reads the section layout columns');
select ok((select count(*) from (select id, org_id, section_id, test_version_id from public.item_versions where section_id is not null) as v) > 0, 'M1-i: trace_worker bound to org A reads the inline item placement columns');
select matches(pg_temp.try('select name from public.sections'), '^42501 permission denied', 'M1-i: trace_worker cannot read a section name');
select matches(pg_temp.try('select stem from public.item_versions'), '^42501 permission denied', 'M1-i: trace_worker cannot read item content');
select matches(pg_temp.try('select options from public.item_versions'), '^42501 permission denied', 'M1-i: trace_worker cannot read options');
select matches(pg_temp.try($$update public.sections set position = position$$), '^42501 permission denied', 'M1-i: trace_worker cannot update sections');
select pg_temp.w('trace_worker', pg_temp.id('B'));
select is((select count(*)::int from public.sections where org_id = pg_temp.id('A')), 0, 'M1-i: trace_worker bound to org B sees no org A section');
select is((select count(*)::int from public.item_versions where org_id = pg_temp.id('A')), 0, 'M1-i: trace_worker bound to org B sees no org A item version');
select pg_temp.w('trace_worker', null);
select is((select count(*)::int from public.sections), 0, 'M1-i: an unbound trace_worker sees no section');
select pg_temp.op();
select * from finish();
rollback;
