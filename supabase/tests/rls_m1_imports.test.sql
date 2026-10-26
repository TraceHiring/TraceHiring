-- rls_m1_imports (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_imports; §3.2 import_jobs, import_row_errors; §3.4 import_item_batch; §3.5; §4.3; §6.9; AT-M1-11 (DB half), AT-M1-25; Q23, R2-23, R3-4, R3-5, R5-26, R5-37, R5-40; E13, E14). RED first: written from the spec before migration M1-c. Personas, rows and images are synthetic.
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
select plan(135);
-- R5-64 g: a client never chooses a job id, so org-user fixture inserts name none; next_id(id) sets the id the next
-- import_jobs / ai_draft_jobs insert takes through this one-shot BEFORE trigger (rolled back with the transaction).
create function private.pgtap_next_id() returns trigger language plpgsql set search_path = '' as $f$
begin
  if coalesce(current_setting('trace_test.next_id', true), '') <> '' then
    new.id := current_setting('trace_test.next_id')::uuid;
    perform set_config('trace_test.next_id', '', true);
  end if;
  return new;
end
$f$;
create trigger a_pgtap_next_id before insert on public.import_jobs for each row execute function private.pgtap_next_id();
create trigger a_pgtap_next_id before insert on public.ai_draft_jobs for each row execute function private.pgtap_next_id();
create function pg_temp.next_id(p_id uuid) returns void language sql as $f$
  select set_config('trace_test.next_id', p_id::text, true)
$f$;
grant execute on function pg_temp.next_id(uuid) to public;
-- Fixtures (operator path): an approved bank item in workspace A1 (content hash c…c, for duplicate_in_bank); batches as
-- jsonb (pg_temp.batch) and function results (pg_temp.res), readable by every persona.
select pg_temp.bank('dup', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
create table pg_temp.batch (k text primary key, j jsonb not null);
grant select on pg_temp.batch to public;
create table pg_temp.res (k text primary key, j jsonb);
grant select, insert on pg_temp.res to public;
insert into pg_temp.batch values ('b1', jsonb_build_array(
  jsonb_build_object('rowNo', 2, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.4, 'stem', '[synthetic] Import row two', 'options', jsonb_build_array('Alpha', 'Beta', 'Gamma'), 'correct', 'b', 'contentSha256', repeat('1', 64)),
  jsonb_build_object('rowNo', 3, 'format', 'written', 'skillKey', 'written_communication', 'difficulty', 0.5, 'stem', '[synthetic] Import row three', 'rubricKey', 'default', 'contentSha256', repeat('2', 64)),
  jsonb_build_object('rowNo', 4, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 1.5, 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('4', 64)),
  jsonb_build_object('rowNo', 5, 'format', 'mcq', 'skillKey', 'astrology', 'difficulty', 0.5, 'stem', '[synthetic] Import row five', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('5', 64)),
  jsonb_build_object('rowNo', 6, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.5, 'stem', '[synthetic] Import row six', 'options', jsonb_build_array('Alpha', 'Beta', 'Gamma'), 'correct', 'e', 'contentSha256', repeat('6', 64)),
  jsonb_build_object('rowNo', 7, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.4, 'stem', '[synthetic] Import row seven', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('1', 64)),
  jsonb_build_object('rowNo', 8, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.5, 'stem', '[synthetic] Import row eight', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('c', 64)),
  jsonb_build_object('rowNo', 9, 'contentSha256', repeat('9', 64), 'errors', jsonb_build_array(jsonb_build_object('field', 'image_file', 'code', 'image_missing'))),
  jsonb_build_object('rowNo', 10, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.5, 'stem', '[synthetic] Import row ten', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'imageKey', 'item-media/' || pg_temp.id('B') || '/' || repeat('f', 64) || '.png', 'imageAlt', 'A synthetic chart', 'contentSha256', repeat('a', 64)),
  jsonb_build_object('rowNo', 11, 'format', 'mcq', 'skillKey', 'quant', 'difficulty', 0.5, 'stem', '[synthetic] What is {{a}} plus one?', 'options', jsonb_build_array('{{a+1}}', '{{a+2}}'),
    'paramSpec', '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "[synthetic] What is {{a}} plus one?", "options": [{"id": "o1", "text": "{{a+1}}"}, {"id": "o2", "text": "{{a+2}}"}], "correctOptionId": "o1", "count": 5}'::jsonb,
    'variants', '[{"variantNo": 1, "params": {"a": 2}, "stem": "[synthetic] What is 2 plus one?", "options": [{"id": "o1", "text": "3"}, {"id": "o2", "text": "4"}], "difficulty": 0.5, "contentSha256": "3333333333333333333333333333333333333333333333333333333333333333", "correctOptionId": "o1"}, {"variantNo": 2, "params": {"a": 5}, "stem": "[synthetic] What is 5 plus one?", "options": [{"id": "o1", "text": "6"}, {"id": "o2", "text": "7"}], "difficulty": 0.55, "contentSha256": "3333333333333333333333333333333333333333333333333333333333333334", "correctOptionId": "o1"}]'::jsonb,
    'contentSha256', repeat('b', 64)),
  jsonb_build_object('rowNo', 12, 'format', 'mcq', 'skillKey', 'quant', 'difficulty', 0.5, 'stem', '[synthetic] What is {{a}} plus two?', 'options', jsonb_build_array('{{a+2}}', '{{a+3}}'),
    'paramSpec', '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "[synthetic] What is {{a}} plus two?", "options": [{"id": "o1", "text": "{{a+2}}"}, {"id": "o2", "text": "{{a+3}}"}], "correctOptionId": "o1", "count": 5}'::jsonb,
    'variants', '[{"variantNo": 1, "params": {"a": 2}, "stem": "[synthetic] What is 2 plus two?", "options": [{"id": "o1", "text": "4"}, {"id": "o2", "text": "5"}], "difficulty": 0.75, "contentSha256": "3333333333333333333333333333333333333333333333333333333333333335", "correctOptionId": "o1"}]'::jsonb,
    'contentSha256', repeat('d', 64)),
  jsonb_build_object('rowNo', 13, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.5, 'stem', repeat('x', 4001), 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('e', 64)),
  jsonb_build_object('rowNo', 14, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.6, 'stem', '[synthetic] Import row fourteen', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'imageKey', 'item-media/' || pg_temp.id('A') || '/' || repeat('f', 64) || '.webp', 'imageAlt', 'A synthetic diagram', 'contentSha256', repeat('7', 64))
));
insert into pg_temp.batch values
  ('lib', jsonb_build_array(jsonb_build_object('rowNo', 2, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.5, 'stem', '[synthetic] Library import row', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('8', 64)))),
  ('a2', jsonb_build_array(jsonb_build_object('rowNo', 2, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.5, 'stem', '[synthetic] Workspace A2 import row', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('8', 64)))),
  ('big', (select jsonb_agg(jsonb_build_object('rowNo', n, 'contentSha256', repeat('0', 64), 'errors', jsonb_build_array(jsonb_build_object('field', 'row', 'code', 'row_limit')))) from generate_series(2, 102) as n)),
  ('twice', jsonb_build_array(jsonb_build_object('rowNo', 30, 'contentSha256', repeat('0', 64), 'errors', '[{"field": "row", "code": "row_limit"}]'::jsonb), jsonb_build_object('rowNo', 30, 'contentSha256', repeat('0', 64), 'errors', '[{"field": "row", "code": "row_limit"}]'::jsonb))),
  ('header', jsonb_build_array(jsonb_build_object('rowNo', 1, 'contentSha256', repeat('0', 64), 'errors', '[{"field": "row", "code": "row_limit"}]'::jsonb))),
  ('cell', jsonb_build_array(jsonb_build_object('rowNo', 40, 'contentSha256', repeat('0', 64), 'errors', '[{"field": "[synthetic] Cell Value", "code": "missing_field"}]'::jsonb)));

-- ===== import_jobs: I (OW AD RC in their workspaces) =====
select pg_temp.u('owner');
select pg_temp.next_id('a7000000-0000-4000-8000-000000000001');
select is(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), 'OK 1', 'import_jobs I: owner starts an xlsx import in workspace A1');
select pg_temp.next_id('a7000000-0000-4000-8000-000000000004');
select is(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'docx', 'trace-items-v1')$$), 'OK 1', 'import_jobs I: owner starts a docx import');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'csv', 'trace-items-v1')$$), '^23514', 'import_jobs I: only the xlsx and docx templates (§6.9)');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version, status) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1', 'completed')$$), '^42501 permission denied', 'import_jobs I: status is outside the insert grant (a job starts open)');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version, rows_ok) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1', 500)$$), '^42501 permission denied', 'import_jobs I: counts are outside the insert grant');
select pg_temp.u('recruiter');
select pg_temp.next_id('a7000000-0000-4000-8000-000000000002');
select is(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), 'OK 1', 'import_jobs I: recruiter starts an import');
select pg_temp.u('ws_recruiter');
select pg_temp.next_id('a7000000-0000-4000-8000-000000000003');
select is(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'xlsx', 'trace-items-v1')$$), 'OK 1', 'import_jobs I: workspace recruiter starts an import in workspace A2');
select pg_temp.next_id('a7000000-0000-4000-8000-000000000005');
select is(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'xlsx', 'trace-items-v1')$$), 'OK 1', 'import_jobs I: workspace recruiter starts a second A2 import');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), '^42501', 'import_jobs I: workspace recruiter cannot import into workspace A1');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), '^42501', 'import_jobs I: reviewer cannot import');
select pg_temp.u('hm');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), '^42501', 'import_jobs I: hiring manager cannot import');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), '^42501', 'import_jobs I: org B admin cannot import into org A');
select pg_temp.u('lib_author');
select pg_temp.next_id('a7000000-0000-4000-8000-00000000000a');
select is(pg_temp.try(format($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values (%L, %L, 'xlsx', 'trace-items-v1')$$, pg_temp.id('L'), pg_temp.id('LW'))), 'OK 1', 'import_jobs I: library staff import into the library org');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), '^42501 permission denied', 'import_jobs I: the authoring worker holds nothing on imports (R2-23)');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), '^42501 permission denied', 'import_jobs I: the admin worker holds nothing on imports (R2-23)');
select pg_temp.op();
select is((select status || '|' || rows_total || '|' || rows_ok || '|' || rows_error || '|' || images_ok || '|' || (created_by = pg_temp.id('owner'))::text || '|' || coalesce(completed_at::text, 'null') from public.import_jobs where id = 'a7000000-0000-4000-8000-000000000001'), 'open|0|0|0|0|true|null', 'import_jobs I: a new job is open, empty and created by the caller');

-- ===== import_jobs: S =====
select pg_temp.u('owner');
select is((select count(*)::int from public.import_jobs), 5, 'import_jobs S: owner sees the five org A imports');
select pg_temp.u('admin');
select is((select count(*)::int from public.import_jobs), 5, 'import_jobs S (DB review M2): admin sees the five org A imports');
select pg_temp.u('recruiter');
select is((select count(*)::int from public.import_jobs), 5, 'import_jobs S (DB review M2): an org-wide recruiter sees the five org A imports');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.import_jobs), 2, 'import_jobs S: workspace recruiter sees only the workspace A2 imports');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.import_jobs), 0, 'import_jobs S: reviewer sees no import (matrix OW AD RC)');
select pg_temp.u('hm');
select is((select count(*)::int from public.import_jobs), 0, 'import_jobs S: hiring manager sees no import');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.import_jobs), 0, 'import_jobs S: org B admin sees no org A or library import');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.import_jobs'), '^42501 permission denied', 'import_jobs S: trace_api has no grant');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.import_row_errors'), '^42501 permission denied', 'import_row_errors S: the quality worker has no grant');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try('select * from public.import_jobs'), '^42501 permission denied', 'import_jobs S: trace_candidate has no privilege');
select pg_temp.op();

-- ===== import_item_batch: who may call it =====
select pg_temp.op();
set local role anon;
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', '[]')$$), '^42501 permission denied', 'batch: anon cannot execute import_item_batch');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', '[]')$$), '^42501 permission denied', 'batch: trace_candidate cannot execute import_item_batch');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), '^42501 permission denied', 'batch: trace_api cannot execute import_item_batch (the api calls it with the user JWT)');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), '^42501 permission denied', 'batch: the authoring worker cannot execute import_item_batch');
select is(has_function_privilege('service_role', 'public.import_item_batch(uuid, jsonb)', 'EXECUTE'), false, 'batch: service_role holds no EXECUTE on import_item_batch');
select is((select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') from pg_proc as p where p.oid = 'public.import_item_batch(uuid, jsonb)'::regprocedure), 'false|search_path=""', 'batch: import_item_batch is SECURITY INVOKER with an empty search_path (M1-18, R2-5)');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), '^23503 TRACE_GUARD: import job not found', 'batch: a workspace A2 recruiter cannot write into a workspace A1 import');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), '^23503 TRACE_GUARD: import job not found', 'batch: org B admin cannot write into an org A import');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), '^23503 TRACE_GUARD: import job not found', 'batch: reviewer cannot import');

-- ===== import_item_batch: input caps =====
select pg_temp.u('recruiter');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000004', (select j from pg_temp.batch where k = 'big'))$$), '^22023 TRACE_BAD_INPUT', 'batch: more than 100 rows is refused');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000004', (select j from pg_temp.batch where k = 'twice'))$$), '^22023 TRACE_BAD_INPUT', 'batch: a row number twice in one batch is refused');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000004', (select j from pg_temp.batch where k = 'header'))$$), '^22023 TRACE_BAD_INPUT', 'batch: row 1 is the header, never an item');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000004', (select j from pg_temp.batch where k = 'cell'))$$), '^23514', 'AT-M1-11: an error field outside the template columns is refused (no cell value can be stored as a field)');

-- ===== import_item_batch: the batch (Q23 approved by the importer; E14 per-row; AT-M1-11 codes) =====
select is(pg_temp.try($$insert into pg_temp.res select 'r1', public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), 'OK 1', 'batch: recruiter sends 13 rows to the A1 import');
select is((select (j ->> 'accepted')::int from pg_temp.res where k = 'r1'), 4, 'batch: rows 2, 3, 11 and 14 are accepted');
select is((select string_agg((e ->> 'rowNo') || ':' || (e ->> 'field') || ':' || (e ->> 'code'), ',' order by (e ->> 'rowNo')::int, e ->> 'field') from pg_temp.res, jsonb_array_elements(j -> 'errors') as e where k = 'r1'),
  '4:difficulty:bad_difficulty,4:stem:missing_field,5:skill:bad_skill,6:correct:bad_key,7:row:duplicate_in_file,8:row:duplicate_in_bank,9:image_file:image_missing,10:image_file:bad_image_ref,12:param_spec_json:variant_generation_failed,13:stem:too_long',
  'AT-M1-11: every bad row comes back with its field and code (api-found, value, taxonomy, key, duplicate, image, variant and length errors)');
select is((select bool_and(pg_temp.keys(e) = 'code,field,rowNo') from pg_temp.res, jsonb_array_elements(j -> 'errors') as e where k = 'r1'), true, 'AT-M1-11: an error carries a row number, a field and a code, never a cell value');
select pg_temp.op();
select is((select status from public.import_jobs where id = 'a7000000-0000-4000-8000-000000000001'), 'validating', 'batch: the first batch moves the job from open to validating (§4.3)');
select is((select string_agg(import_row_no || ':' || origin || ':' || status::text || ':' || (approved_by = pg_temp.id('recruiter'))::text || ':' || (created_by = pg_temp.id('recruiter'))::text || ':' || (workspace_id = pg_temp.id('A1'))::text, ',' order by import_row_no) from public.item_versions where import_job_id = 'a7000000-0000-4000-8000-000000000001'),
  '2:import:approved:true:true:true,3:import:approved:true:true:true,11:import:approved:true:true:true,14:import:approved:true:true:true',
  'Q23: each accepted row is an imported version approved by the importer in the same call, in the job workspace');
select is((select count(*)::int from public.items where org_id = pg_temp.id('A') and created_by = pg_temp.id('recruiter')), 4, 'E14: a row that fails inside the insert (bad skill, bad variant) leaves no items row behind');
select is((select v.options::text || '|' || (k.key ->> 'option_id') from public.item_versions as v join public.item_answer_keys as k on k.item_version_id = v.id where v.import_job_id = 'a7000000-0000-4000-8000-000000000001' and v.import_row_no = 2), '[{"id": "a", "text": "Alpha"}, {"id": "b", "text": "Beta"}, {"id": "c", "text": "Gamma"}]|b', 'batch: MCQ options get ids a..f and the key names the correct one');
select is((select (rubric_version_id = (select r.id from public.rubric_versions as r where r.org_id = pg_temp.id('A') and r.rubric_key = 'default' order by r.version_no desc limit 1))::text from public.item_versions where import_job_id = 'a7000000-0000-4000-8000-000000000001' and import_row_no = 3), 'true', 'batch: a written row takes the latest version of its org rubric');
select is((select v.is_parameterised::text || '|' || count(var.id) || '|' || count(k.item_variant_id) from public.item_versions as v join public.item_variants as var on var.item_version_id = v.id left join public.item_variant_keys as k on k.item_variant_id = var.id where v.import_job_id = 'a7000000-0000-4000-8000-000000000001' and v.import_row_no = 11 group by v.is_parameterised), 'true|2|2', 'batch: a parameterised row stores its variants and their keys (R3-4)');
select is((select media::text from public.item_versions where import_job_id = 'a7000000-0000-4000-8000-000000000001' and import_row_no = 14), '[{"alt": "A synthetic diagram", "key": "item-media/a1000000-0000-4000-8000-000000000001/' || repeat('f', 64) || '.webp"}]', 'batch: an image under the org prefix is stored as a media ref');
select is((select count(*)::int from public.audit_log as a join public.item_versions as v on v.id = a.object_id where a.action = 'item.approve' and v.import_job_id = 'a7000000-0000-4000-8000-000000000001' and a.actor_user_id = pg_temp.id('recruiter') and a.details ->> 'from' = 'draft' and a.details ->> 'self_approved' = 'true'), 4, 'Q23: each import approval is audited draft > approved, self-approved by the importer');
select is((select string_agg(row_no || ':' || field || ':' || error_code, ',' order by row_no, field) from public.import_row_errors where import_job_id = 'a7000000-0000-4000-8000-000000000001'),
  '4:difficulty:bad_difficulty,4:stem:missing_field,5:skill:bad_skill,6:correct:bad_key,7:row:duplicate_in_file,8:row:duplicate_in_bank,9:image_file:image_missing,10:image_file:bad_image_ref,12:param_spec_json:variant_generation_failed,13:stem:too_long',
  'AT-M1-11: the per-row errors are stored as codes');
select is((select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'import_row_errors'), 'org_id,import_job_id,row_no,field,error_code,workspace_id,created_at', 'AT-M1-11: import_row_errors has no column that could hold a cell value');
select is((select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'import_jobs' and data_type = 'text'), 'source_kind,template_version,status,error_code', 'M1-9: import_jobs stores no file, file name or cell (text columns are enums only)');

-- ===== E13: a re-sent batch is idempotent on (import_job_id, row_no) (R3-5) =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into pg_temp.res select 'r1b', public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), 'OK 1', 'E13: the same batch is sent again');
select is((select (select j from pg_temp.res where k = 'r1b') = (select j from pg_temp.res where k = 'r1')), true, 'E13: the re-sent batch gets the same answer');
select pg_temp.op();
select is((select count(*)::int from public.item_versions where import_job_id = 'a7000000-0000-4000-8000-000000000001') || '|' || (select count(*)::int from public.import_row_errors where import_job_id = 'a7000000-0000-4000-8000-000000000001') || '|' || (select count(*)::int from public.items where org_id = pg_temp.id('A') and created_by = pg_temp.id('recruiter')), '4|10|4', 'E13: no row, error or item is written twice');

-- ===== R5-37: a library import lands in review, not approved =====
select pg_temp.u('lib_author');
select is(pg_temp.try($$insert into pg_temp.res select 'rl', public.import_item_batch('a7000000-0000-4000-8000-00000000000a', (select j from pg_temp.batch where k = 'lib'))$$), 'OK 1', 'R5-37: library staff send a batch to the library import');
select pg_temp.op();
select is((select status::text || '|' || origin || '|' || coalesce(approved_by::text, 'null') from public.item_versions where import_job_id = 'a7000000-0000-4000-8000-00000000000a'), 'in_review|import|null', 'R5-37: a library import row is in_review with no approver (expert review stays)');
select is((select (j ->> 'accepted')::int from pg_temp.res where k = 'rl'), 1, 'R5-37: the library row is accepted');

-- ===== Fences on the job hook (§4.3, R2-9) =====
select pg_temp.u('ws_recruiter');
select is(pg_temp.try($$insert into pg_temp.res select 'ra2', public.import_item_batch('a7000000-0000-4000-8000-000000000005', (select j from pg_temp.batch where k = 'a2'))$$), 'OK 1', 'fence: workspace recruiter imports into their own A2 job');
select pg_temp.op();
select is((select workspace_id from public.item_versions where import_job_id = 'a7000000-0000-4000-8000-000000000005'), pg_temp.id('A2'), 'fence: the imported row lives in the job workspace A2');
select pg_temp.u('owner');
insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c7000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256, import_job_id, import_row_no) values ('a1000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] Fenced', '[{"id": "a", "text": "A"}, {"id": "b", "text": "B"}]', 'verbal', 0.5, repeat('6', 64), 'a7000000-0000-4000-8000-000000000005', 50)$$), '^42501 TRACE_GUARD: the import job is not open', 'fence: an A1 item cannot name an A2 import job');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256, import_row_no) values ('a1000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] Row without job', '[{"id": "a", "text": "A"}, {"id": "b", "text": "B"}]', 'verbal', 0.5, repeat('6', 64), 50)$$), '^23514', 'R3-5: a row number needs its import job');

-- ===== import_row_errors: I / S / U / D =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into public.import_row_errors (org_id, import_job_id, row_no, field, error_code) values ('a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', 20, 'stem', 'too_long')$$), 'OK 1', 'import_row_errors I: staff record an error code for an open job of their workspace');
select matches(pg_temp.try($$insert into public.import_row_errors (org_id, import_job_id, row_no, field, error_code) values ('a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', 21, 'stem', 'the stem said hello')$$), '^23514', 'import_row_errors I: the code is an enum, never text from the file');
select matches(pg_temp.try($$insert into public.import_row_errors (org_id, import_job_id, row_no, field, error_code) values ('a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', 2002, 'stem', 'row_limit')$$), '^23514', 'import_row_errors I: at most 2,000 data rows (rows 2..2001)');
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.import_row_errors (org_id, import_job_id, row_no, field, error_code) values ('a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', 23, 'stem', 'too_long')$$), 'OK 1', 'import_row_errors I (DB review M2): the owner records a row error');
select pg_temp.u('admin');
select is(pg_temp.try($$insert into public.import_row_errors (org_id, import_job_id, row_no, field, error_code) values ('a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', 24, 'stem', 'too_long')$$), 'OK 1', 'import_row_errors I (DB review M2): an admin records a row error');
select pg_temp.u('hm');
select matches(pg_temp.try($$insert into public.import_row_errors (org_id, import_job_id, row_no, field, error_code) values ('a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', 25, 'stem', 'too_long')$$), '^42501', 'import_row_errors I (DB review M2): a hiring manager records no row error');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$insert into public.import_row_errors (org_id, import_job_id, row_no, field, error_code) values ('a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', 22, 'stem', 'too_long')$$), '^42501', 'import_row_errors I: workspace recruiter cannot write errors of a workspace A1 job');
select is((select count(*)::int from public.import_row_errors), 0, 'import_row_errors S: workspace recruiter sees no workspace A1 error');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.import_row_errors), 0, 'import_row_errors S: reviewer sees nothing');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.import_row_errors), 0, 'import_row_errors S: org B admin sees nothing');
select pg_temp.u('owner');
select is((select count(*)::int from public.import_row_errors where import_job_id = 'a7000000-0000-4000-8000-000000000001'), 10, 'import_row_errors S: owner sees the A1 job errors');
select matches(pg_temp.try($$update public.import_row_errors set error_code = 'bad_key'$$), '^42501 permission denied', 'import_row_errors U: no update grant');
select matches(pg_temp.try($$delete from public.import_row_errors$$), '^42501 permission denied', 'import_row_errors D: no delete grant');
select pg_temp.op();
select matches(pg_temp.try($$update public.import_row_errors set error_code = 'bad_key'$$), '^42501 TRACE_GUARD: import row errors are never changed', 'import_row_errors U: never changed, even on the operator path');

-- ===== import_jobs: U (state machine §4.3; counts by the guard) =====
select pg_temp.u('recruiter');
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.import_jobs set images_ok = 1 where id = 'a7000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'import_jobs U (A2a DB review D6, R5-64 c): the owner cannot write images_ok (the guard counts it)');
select pg_temp.u('admin');
select matches(pg_temp.try($$update public.import_jobs set images_ok = 1 where id = 'a7000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'import_jobs U (D6): an admin cannot write images_ok');
select pg_temp.u('hm');
select matches(pg_temp.try($$update public.import_jobs set images_ok = 1 where id = 'a7000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'import_jobs U (D6): a hiring manager holds no images_ok grant either');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$update public.import_jobs set images_ok = 1 where id = 'a7000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'import_jobs U (D6): staff cannot write images_ok while validating');
select matches(pg_temp.try($$update public.import_jobs set rows_ok = 999 where id = 'a7000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'import_jobs U: counts are outside the update grant');
select matches(pg_temp.try($$update public.import_jobs set source_kind = 'docx' where id = 'a7000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'import_jobs U: the source is outside the update grant');
select pg_temp.op();
select matches(pg_temp.try($$update public.import_jobs set images_ok = 5 where id = 'a7000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: import counts are written when the job ends', 'import_jobs U (D6): images_ok is counted by the guard at the end, even on the operator path');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$update public.import_jobs set status = 'open' where id = 'a7000000-0000-4000-8000-000000000005'$$),'^42501 TRACE_GUARD: import job status change not allowed', 'import_jobs U: a validating import never goes back to open');
select matches(pg_temp.try($$update public.import_jobs set status = 'failed' where id = 'a7000000-0000-4000-8000-000000000004'$$), '^23514', 'import_jobs U: a failure names its error code');
select is(pg_temp.try($$update public.import_jobs set status = 'completed' where id = 'a7000000-0000-4000-8000-000000000001'$$), 'OK 1', 'import_jobs U: recruiter completes the A1 import');
select pg_temp.op();
select is((select status || '|' || rows_total || '|' || rows_ok || '|' || rows_error || '|' || images_ok || '|' || (completed_at is not null)::text from public.import_jobs where id = 'a7000000-0000-4000-8000-000000000001'), 'completed|13|4|9|1|true', 'import_jobs U: completion counts the stored rows (4 items, 9 rows with errors, 1 distinct image key; D6)');
select is((select pg_temp.keys(details) || '|' || (details ->> 'rows_ok') || '|' || (details ->> 'rows_error') || '|' || (details ->> 'images_ok') || '|' || (actor_user_id = pg_temp.id('recruiter'))::text from public.audit_log where action = 'import.complete' and object_id = 'a7000000-0000-4000-8000-000000000001'), 'images_ok,import_job_id,rows_error,rows_ok|4|9|1|true', 'AT-M1-25: import.complete carries the job id and counts only (R5-26)');
select matches(pg_temp.try($$update public.import_jobs set images_ok = 2 where id = 'a7000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: a finished import job is frozen', 'import_jobs U: a finished job is frozen, even on the operator path');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$update public.import_jobs set images_ok = 2 where id = 'a7000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'import_jobs U (D6): staff hold no images_ok grant on a finished job');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), '^42501 TRACE_GUARD: the import job is not open', 'batch: a completed job takes no more rows');
select matches(pg_temp.try($$update public.import_jobs set status = 'completed' where id = 'a7000000-0000-4000-8000-000000000002'$$), '^42501 TRACE_GUARD: import job status change not allowed', 'import_jobs U (DB review L1, §4.3): an open job never completes before a batch has validated it');
select is(pg_temp.try($$update public.import_jobs set status = 'cancelled' where id = 'a7000000-0000-4000-8000-000000000002'$$), 'OK 1', 'import_jobs U: recruiter cancels an open import');
select pg_temp.u('ws_recruiter');
select is(pg_temp.try($$update public.import_jobs set status = 'cancelled' where id = 'a7000000-0000-4000-8000-000000000004'$$), 'OK 0', 'import_jobs U: workspace recruiter cannot end a workspace A1 import');
select is(pg_temp.try($$update public.import_jobs set status = 'failed', error_code = 'timeout' where id = 'a7000000-0000-4000-8000-000000000003'$$), 'OK 1', 'import_jobs U: workspace recruiter marks their own A2 import failed');
select pg_temp.u('reviewer');
select is(pg_temp.try($$update public.import_jobs set status = 'cancelled' where id = 'a7000000-0000-4000-8000-000000000004'$$), 'OK 0', 'import_jobs U: reviewer cannot end an import');
select pg_temp.u('b_admin');
select is(pg_temp.try($$update public.import_jobs set status = 'cancelled' where id = 'a7000000-0000-4000-8000-000000000004'$$), 'OK 0', 'import_jobs U: org B admin cannot end an org A import');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try($$update public.import_jobs set status = 'cancelled' where id = 'a7000000-0000-4000-8000-000000000004'$$), '^42501 permission denied', 'import_jobs U: the authoring worker cannot touch an import');
select pg_temp.u('owner');
select matches(pg_temp.try($$delete from public.import_jobs where id = 'a7000000-0000-4000-8000-000000000004'$$), '^42501 permission denied', 'import_jobs D: no delete grant');
select pg_temp.op();
select matches(pg_temp.try($$delete from public.import_jobs where id = 'a7000000-0000-4000-8000-000000000004'$$), '^42501 TRACE_GUARD: import jobs are kept', 'import_jobs D: kept even on the operator path');
select is((select pg_temp.keys(details) || '|' || (details ->> 'import_job_id') from public.audit_log where action = 'import.cancel'), 'import_job_id|a7000000-0000-4000-8000-000000000002', 'AT-M1-25: import.cancel carries the job id only');
select is((select pg_temp.keys(details) || '|' || (details ->> 'error_code') from public.audit_log where action = 'import.fail'), 'error_code,import_job_id|timeout', 'AT-M1-25: import.fail carries the job id and an error code enum');
select is((select count(*)::int from public.audit_log where action like 'import.%' and exists (select 1 from jsonb_each(details) as e where jsonb_typeof(e.value) not in ('string', 'number'))), 0, 'AT-M1-25: no import audit row carries a nested or free-text structure');

-- ===== public.save_test_draft (M1-18: one transaction as the caller; E1) =====
select pg_temp.op();
select pg_temp.tv('d1', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.tv('pub', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('spub', 'pub', 1, 'mcq', null, null, 100);
select pg_temp.inline('ipub', 'spub');
select pg_temp.preset('pub', 'standard');
select pg_temp.publish('pub');
insert into pg_temp.batch values
  ('draft', jsonb_build_object('name', '[synthetic] Saved draft', 'totalTimeSeconds', 1500, 'qualityCutoff', 45, 'presetKey', 'standard',
    'settings', (select p.preset_values from public.integrity_presets as p where p.preset_key = 'standard' and p.version = 1),
    'sections', jsonb_build_array(
      jsonb_build_object('name', 'Choices', 'format', 'mcq', 'weight', 60, 'navigation', 'free', 'items', jsonb_build_array(jsonb_build_object('format', 'mcq', 'stem', '[synthetic] Saved MCQ', 'options', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]'::jsonb, 'correctOptionId', 'o2', 'contentSha256', repeat('1', 64)))),
      jsonb_build_object('name', 'Writing', 'format', 'written', 'weight', 40, 'navigation', 'forward_only', 'pasteRule', 'blocked', 'items', jsonb_build_array(jsonb_build_object('format', 'written', 'stem', '[synthetic] Saved prompt', 'rubric', jsonb_build_object('criteria', '[{"id": "c1", "label": "Clarity", "max_points": 5, "anchors": ["clear"], "min_hits": 1}]'::jsonb, 'contentSha256', repeat('2', 64)), 'contentSha256', repeat('3', 64))))))),
  ('draft_small', jsonb_build_object('name', '[synthetic] Saved draft', 'totalTimeSeconds', 1500, 'qualityCutoff', 45,
    'sections', jsonb_build_array(jsonb_build_object('name', 'Choices only', 'format', 'mcq', 'weight', 100, 'items', jsonb_build_array(jsonb_build_object('format', 'mcq', 'stem', '[synthetic] Saved MCQ again', 'options', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]'::jsonb, 'correctOptionId', 'o1', 'contentSha256', repeat('4', 64))))))),
  ('draft_badkey', jsonb_build_object('name', '[synthetic] Bad', 'totalTimeSeconds', 1500, 'qualityCutoff', 45,
    'sections', jsonb_build_array(jsonb_build_object('name', 'Choices', 'format', 'mcq', 'weight', 100, 'items', jsonb_build_array(jsonb_build_object('format', 'mcq', 'stem', '[synthetic] Bad key', 'options', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]'::jsonb, 'correctOptionId', 'zz', 'contentSha256', repeat('5', 64))))))),
  ('draft_poolitems', jsonb_build_object('name', '[synthetic] Bad', 'totalTimeSeconds', 1500, 'qualityCutoff', 45,
    'sections', jsonb_build_array(jsonb_build_object('name', 'Pool', 'format', 'mcq', 'weight', 100, 'poolId', gen_random_uuid(), 'drawCount', 1, 'items', jsonb_build_array(jsonb_build_object('format', 'mcq', 'stem', 'x', 'contentSha256', repeat('5', 64)))))));
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft'))$$), '^42501 permission denied', 'save_test_draft: trace_api cannot execute it');
select is((select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') || '|' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text from pg_proc as p where p.oid = 'public.save_test_draft(uuid, jsonb)'::regprocedure), 'false|search_path=""|false|true', 'save_test_draft: SECURITY INVOKER, empty search_path, EXECUTE to authenticated only (R2-5)');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft'))$$), '^23503 TRACE_GUARD: test version not found', 'save_test_draft: a workspace A2 recruiter cannot save a workspace A1 draft');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft'))$$), '^23503 TRACE_GUARD: test version not found', 'save_test_draft: org B admin cannot save an org A draft');
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into pg_temp.res select 'sd1', public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft'))$$), 'OK 1', 'save_test_draft: recruiter saves sections, items, keys and settings in one call');
select is((select j::text from pg_temp.res where k = 'sd1'), '{"items": 2, "sections": 2}', 'save_test_draft: the counts written come back');
select is((select string_agg(s.position || ':' || s.name || ':' || coalesce(s.navigation, 'null') || ':' || coalesce(s.paste_rule, 'null') || ':' || i.stem || ':' || coalesce(k.key ->> 'option_id', 'rubric'), ',' order by s.position) from public.sections as s join public.item_versions as i on i.section_id = s.id left join public.item_answer_keys as k on k.item_version_id = i.id where s.test_version_id = pg_temp.id('d1')), '1:Choices:free:null:[synthetic] Saved MCQ:o2,2:Writing:forward_only:blocked:[synthetic] Saved prompt:rubric', 'save_test_draft: sections, inline items and keys are stored in order');
select is((select v.total_time_seconds || '|' || v.quality_cutoff || '|' || t.name || '|' || r.preset_key || '|' || (r.signal_settings -> 'paste' ->> 'enabled') from public.test_versions as v join public.tests as t on t.id = v.test_id join public.ruleset_versions as r on r.id = v.ruleset_version_id where v.id = pg_temp.id('d1')), '1500|45|[synthetic] Saved draft|standard|false', 'save_test_draft: time, cutoff, name and settings saved; signal_settings derived by the guard (I-M1-7)');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft_small'))$$), 'OK 1', 'save_test_draft: a second save replaces the draft children');
select is((select count(*)::int || '|' || string_agg(s.name, ',') from public.sections as s where s.test_version_id = pg_temp.id('d1')) || '|' || (select count(*)::int from public.item_versions where test_version_id = pg_temp.id('d1')) || '|' || (select preset_key from public.ruleset_versions as r join public.test_versions as v on v.ruleset_version_id = r.id where v.id = pg_temp.id('d1')), '1|Choices only|1|standard', 'save_test_draft: old sections and items are gone; omitted settings are kept');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft_badkey'))$$), '23514 TRACE_BAD_ANSWER_KEY', 'save_test_draft: a bad key fails the whole call');
select is((select string_agg(s.name, ',') from public.sections as s where s.test_version_id = pg_temp.id('d1')), 'Choices only', 'save_test_draft: after a failed call the draft is as before (atomic, fixes D1 r3 m-4)');
select matches(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft_poolitems'))$$), '^22023 TRACE_BAD_INPUT', 'save_test_draft: a pool section carries no inline items');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('pub'), (select j from pg_temp.batch where k = 'draft_small'))$$), '42501 TRACE_GUARD: a published test version is frozen', 'E1: saving a published version is refused by the database');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft_small'))$$), '^23503 TRACE_GUARD: test version not found', 'save_test_draft: reviewer cannot save a draft');

-- ===== public.save_item_variants (ABH-7 generation lands through it; R2-22, R3-4) =====
select pg_temp.u('recruiter');
insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c7000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'quant');
insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000002', 'mcq', '[synthetic] Param draft', '[{"id": "o1", "text": "{{a+1}}"}, {"id": "o2", "text": "{{a+2}}"}]', 'quant', 0.50, true, '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "[synthetic] Param draft {{a}}", "options": [{"id": "o1", "text": "{{a+1}}"}, {"id": "o2", "text": "{{a+2}}"}], "correctOptionId": "o1", "count": 5}', repeat('9', 64));
select pg_temp.op();
insert into pg_temp.ids select 'pv', id from public.item_versions where stem = '[synthetic] Param draft';
insert into pg_temp.batch values
  ('vars2', '[{"variantNo": 1, "params": {"a": 2}, "stem": "[synthetic] 2 plus one", "options": [{"id": "o1", "text": "3"}, {"id": "o2", "text": "4"}], "difficulty": 0.5, "contentSha256": "4444444444444444444444444444444444444444444444444444444444444441", "correctOptionId": "o1"}, {"variantNo": 2, "params": {"a": 3}, "stem": "[synthetic] 3 plus one", "options": [{"id": "o1", "text": "4"}, {"id": "o2", "text": "5"}], "difficulty": 0.6, "contentSha256": "4444444444444444444444444444444444444444444444444444444444444442", "correctOptionId": "o1"}]'),
  ('vars1', '[{"variantNo": 1, "params": {"a": 7}, "stem": "[synthetic] 7 plus one", "options": [{"id": "o1", "text": "8"}, {"id": "o2", "text": "9"}], "difficulty": 0.45, "contentSha256": "4444444444444444444444444444444444444444444444444444444444444443", "correctOptionId": "o1"}]'),
  ('vars_far', '[{"variantNo": 1, "params": {"a": 7}, "stem": "[synthetic] 7 plus one", "options": [{"id": "o1", "text": "8"}, {"id": "o2", "text": "9"}], "difficulty": 0.61, "contentSha256": "4444444444444444444444444444444444444444444444444444444444444443", "correctOptionId": "o1"}]'),
  ('vars_badkey', '[{"variantNo": 1, "params": {"a": 7}, "stem": "[synthetic] 7 plus one", "options": [{"id": "o1", "text": "8"}, {"id": "o2", "text": "9"}], "difficulty": 0.5, "contentSha256": "4444444444444444444444444444444444444444444444444444444444444443", "correctOptionId": "o7"}]');
select is((select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') || '|' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text from pg_proc as p where p.oid = 'public.save_item_variants(uuid, jsonb)'::regprocedure), 'false|search_path=""|false|true', 'save_item_variants: SECURITY INVOKER, empty search_path, EXECUTE to authenticated only (R2-5)');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$select public.save_item_variants(pg_temp.id('pv'), (select j from pg_temp.batch where k = 'vars2'))$$), '^23503 TRACE_GUARD: item version not found', 'save_item_variants: a workspace A2 recruiter cannot reach a workspace A1 item');
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into pg_temp.res select 'sv2', to_jsonb(public.save_item_variants(pg_temp.id('pv'), (select j from pg_temp.batch where k = 'vars2')))$$), 'OK 1', 'save_item_variants: recruiter stores two variants and their keys');
select is((select j::text from pg_temp.res where k = 'sv2') || '|' || (select count(*)::int from public.item_variants where item_version_id = pg_temp.id('pv')) || '|' || (select count(*)::int from public.item_variant_keys as k join public.item_variants as v on v.id = k.item_variant_id where v.item_version_id = pg_temp.id('pv')), '2|2|2', 'save_item_variants: two variants, two keys');
select is(pg_temp.try($$select public.save_item_variants(pg_temp.id('pv'), (select j from pg_temp.batch where k = 'vars1'))$$), 'OK 1', 'save_item_variants: regeneration replaces the variants while the item is a draft');
select is((select string_agg(variant_no || ':' || difficulty, ',') from public.item_variants where item_version_id = pg_temp.id('pv')), '1:0.45', 'save_item_variants: only the new variant remains');
select is(pg_temp.try($$select public.save_item_variants(pg_temp.id('pv'), (select j from pg_temp.batch where k = 'vars_far'))$$), '23514 TRACE_GUARD: a variant difficulty must be within 0.10 of its item', 'AT-M1-05: a variant 0.11 away is refused');
select is(pg_temp.try($$select public.save_item_variants(pg_temp.id('pv'), (select j from pg_temp.batch where k = 'vars_badkey'))$$), '23514 TRACE_BAD_ANSWER_KEY', 'save_item_variants: a variant key names one of its options');
select is((select string_agg(variant_no || ':' || difficulty, ',') from public.item_variants where item_version_id = pg_temp.id('pv')), '1:0.45', 'save_item_variants: a failed call leaves the variants as they were');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where id = pg_temp.id('pv')$$), 'OK 1', 'save_item_variants: the item is submitted with its variants');
select is(pg_temp.try($$select public.save_item_variants(pg_temp.id('pv'), (select j from pg_temp.batch where k = 'vars2'))$$), '42501 TRACE_GUARD: the item version is frozen', 'R2-22: variants and their keys are frozen once the item leaves draft');
select is((select count(*)::int from public.item_variants where item_version_id = pg_temp.id('pv')), 1, 'R2-22: the submitted item keeps its variant');
select pg_temp.op();
-- ===== DB review H1, M3: a batch and the end of its job are serialised; duplicate_in_bank has its index =====
select is((select provolatile::text from pg_proc where oid = 'private.import_job_open(uuid,uuid,uuid)'::regprocedure), 'v', 'H1: import_job_open is volatile (it takes a row lock)');
select matches(pg_get_functiondef('private.import_job_open(uuid,uuid,uuid)'::regprocedure), 'from public\.import_jobs as j\s+where j\.org_id = p_org and j\.id = p_job and j\.workspace_id = p_workspace and j\.status in \(''open'', ''validating''\)\s+for share', 'H1: a batch holds the job row FOR SHARE, so a cancel or completion waits for it (and the batch waits for an ending job, then sees it ended)');
select is((select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'item_versions' and indexdef like '%(org_id, workspace_id, content_sha256)%' and indexdef like '%section_id IS NULL%'), 1, 'M3: duplicate_in_bank reads a partial index on bank rows (org, workspace, content hash)');
select * from finish();
rollback;
