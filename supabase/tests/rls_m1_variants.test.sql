-- rls_m1_variants (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_variants; §3.2 item_variants, §4.1, §6.3, I-M1-4; AT-M1-05; R2-22, R3-4). RED first: written from the spec before migration M1-a. Personas and items are synthetic.
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
select plan(49);
-- Fixtures: a parameterised MCQ draft P (difficulty 0.50) in workspace A1, one in A2, and a plain approved MCQ item.
select pg_temp.bank('qa1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant', 0.50, 'approved');
insert into public.items (id, org_id, workspace_id, format, skill_key) values
  ('c2000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant'),
  ('c2000000-0000-4000-8000-000000000002', pg_temp.id('A'), pg_temp.id('A2'), 'mcq', 'quant');
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256) values
  ('c2100000-0000-4000-8000-000000000001', pg_temp.id('A'), 'c2000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] P',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64)),
  ('c2100000-0000-4000-8000-000000000002', pg_temp.id('A'), 'c2000000-0000-4000-8000-000000000002', 'mcq', '[synthetic] P2',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64));

-- ===== param_spec shape (§5 ParamSpec) =====
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.item_versions set param_spec = '{"params": {}, "stem": "x", "options": [], "correctOptionId": "o1", "count": 5}' where id = 'c2100000-0000-4000-8000-000000000001'$$), '^23514', 'param_spec: a spec without parameters or options violates its CHECK');
select matches(pg_temp.try($$update public.item_versions set is_parameterised = true, param_spec = null where id = 'c2100000-0000-4000-8000-000000000001'$$), '^23514', 'param_spec: a parameterised item needs its spec');

-- ===== I: variants of a draft, ±0.10 (AT-M1-05) =====
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 1, '{"a": 3}', '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.60, repeat('c', 64))$$), 'OK 1', 'AT-M1-05: a variant 0.10 above its item is accepted');
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 2, '{"a": 4}', '[synthetic] What is 4 + 1?', '[{"id": "o1", "text": "5"}, {"id": "o2", "text": "4"}]', 0.40, repeat('c', 64))$$), 'OK 1', 'AT-M1-05: a variant 0.10 below its item is accepted');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 3, '{"a": 5}', '[synthetic] What is 5 + 1?', '[{"id": "o1", "text": "6"}, {"id": "o2", "text": "5"}]', 0.61, repeat('c', 64))$$), '^23514 TRACE_GUARD: a variant difficulty must be within 0.10 of its item', 'AT-M1-05: a variant 0.11 away is refused');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 3, '{"a": 5}', '[synthetic] What is 5 + 1?', '[{"id": "o1", "text": "6"}, {"id": "o2", "text": "5"}]', 0.39, repeat('c', 64))$$), '^23514 TRACE_GUARD: a variant difficulty must be within 0.10 of its item', 'AT-M1-05: a variant 0.11 below is refused');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 1, '{"a": 6}', '[synthetic] What is 6 + 1?', '[{"id": "o1", "text": "7"}, {"id": "o2", "text": "6"}]', 0.50, repeat('c', 64))$$), '^23505', 'variants I: variant numbers are unique per item version');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 4, '{"a": {"nested": 1}}', '[synthetic] x', '[{"id": "o1", "text": "7"}, {"id": "o2", "text": "6"}]', 0.50, repeat('c', 64))$$), '^23514', 'variants I: params are scalars only');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 4, '{"a": 7}', '[synthetic] x', '[{"id": "o1", "text": "7"}]', 0.50, repeat('c', 64))$$), '^23514', 'variants I: variant options are 2 to 6 MCQ options');
select matches(pg_temp.try(format($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', %L, 1, '{"a": 7}', '[synthetic] x', '[{"id": "o1", "text": "7"}, {"id": "o2", "text": "6"}]', 0.50, repeat('c', 64))$$, pg_temp.id('qa1'))), '^42501 TRACE_GUARD: variants change only while their parameterised item is a draft', 'variants I: an item that is not parameterised (and approved) takes no variant');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 5, '{"a": 8}', '[synthetic] x', '[{"id": "o1", "text": "9"}, {"id": "o2", "text": "8"}]', 0.50, repeat('c', 64))$$), '^42501', 'variants I: workspace recruiter cannot add a variant to a workspace A1 item');
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000002', 1, '{"a": 8}', '[synthetic] What is 8 + 1?', '[{"id": "o1", "text": "9"}, {"id": "o2", "text": "8"}]', 0.50, repeat('c', 64))$$), 'OK 1', 'variants I: workspace recruiter adds a variant to a workspace A2 item');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 6, '{"a": 2}', '[synthetic] x', '[{"id": "o1", "text": "3"}, {"id": "o2", "text": "2"}]', 0.50, repeat('c', 64))$$), '^42501', 'variants I: a reviewer cannot add a variant');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 6, '{"a": 2}', '[synthetic] x', '[{"id": "o1", "text": "3"}, {"id": "o2", "text": "2"}]', 0.50, repeat('c', 64))$$), '^42501', 'variants I: org B admin cannot add a variant in org A');
select pg_temp.op();
select is((select workspace_id from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000002'), pg_temp.id('A2'), 'variants I: the workspace comes from the item version');

-- ===== S =====
select pg_temp.u('reviewer');
select is((select count(*)::int from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001'), 2, 'variants S: the reviewer reads the variants of their workspace');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001'), 0, 'variants S: workspace recruiter reads no workspace A1 variant');
select pg_temp.u('hm');
select is((select count(*)::int from public.item_variants), 0, 'variants S: hiring manager reads nothing');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select is((select count(*)::int from public.item_variants), 3, 'variants S: the quality worker reads the variants of its job org');
select pg_temp.w('trace_quality_worker', pg_temp.id('B'));
select is((select count(*)::int from public.item_variants), 0, 'variants S: the quality worker bound to org B reads no org A variant');

-- ===== Readiness on leaving draft, immutability (I-M1-4, R2-22) =====
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: every variant needs its answer key', 'readiness: a parameterised item needs a key on every variant');
select is(pg_temp.try($$insert into public.item_variant_keys (org_id, item_variant_id, key) select org_id, id, '{"option_id": "o1"}' from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001'$$), 'OK 2', 'readiness: both variants are keyed');
select is(pg_temp.try($$update public.item_versions set difficulty = 0.70 where id = 'c2100000-0000-4000-8000-000000000001'$$), 'OK 1', 'readiness: the draft item difficulty moves to 0.70');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000001'$$), '^23514 TRACE_GUARD: a variant difficulty must be within 0.10 of its item', 'readiness: the 0.40 variant is now 0.30 away, so the item cannot be submitted');
select is(pg_temp.try($$delete from public.item_variant_keys where item_variant_id in (select id from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001' and variant_no = 2)$$), 'OK 1', 'regeneration: the key of the far variant is deleted while the item is a draft');
select is(pg_temp.try($$delete from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001' and variant_no = 2$$), 'OK 1', 'regeneration: the far variant itself is deleted (R2-22)');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000001'$$), 'OK 1', 'readiness: with one keyed variant within 0.10, the item is submitted');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 7, '{"a": 2}', '[synthetic] x', '[{"id": "o1", "text": "3"}, {"id": "o2", "text": "2"}]', 0.70, repeat('c', 64))$$), '^42501 TRACE_GUARD: variants change only while their parameterised item is a draft', 'immutability: no variant is added once the item leaves draft');
select matches(pg_temp.try($$delete from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: variants change only while their parameterised item is a draft', 'immutability: no variant is deleted once the item leaves draft');
select pg_temp.op();
select matches(pg_temp.try($$update public.item_variants set stem = 'changed' where item_version_id = 'c2100000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: variants are immutable', 'immutability: a variant is never updated, even on the operator path');
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.item_variants set stem = 'changed'$$), '^42501 permission denied', 'immutability: no update grant on variants');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000002'$$), '^42501 TRACE_GUARD: every variant needs its answer key', 'readiness: the A2 item without variant keys cannot be submitted');
select is(pg_temp.try($$delete from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000002'$$), 'OK 1', 'regeneration: the A2 variant is deleted');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000002'$$), '^42501 TRACE_GUARD: a parameterised item needs its variants', 'readiness: a parameterised item without variants cannot be submitted');

-- ===== DB-M1-6 (R5-33): variants and their keys are never truncated, even by the owner =====
select pg_temp.op();
-- TRUNCATE CASCADE from item_variants reaches the append-only D1 tables whose TRUNCATE is revoked from the owner; the
-- privilege is re-granted for this rolled-back test (as rls_d1_consents does), so only a trigger can refuse it. The named
-- table's BEFORE TRUNCATE trigger fires first.
do $do$
declare
  r record;
begin
  for r in
    select c.oid::regclass as rel from pg_class as c
    where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace)
      and c.relkind in ('r', 'p') and not has_table_privilege('postgres', c.oid, 'TRUNCATE')
  loop
    execute format('grant truncate on %s to postgres', r.rel);
  end loop;
end
$do$;
select matches(pg_temp.try('truncate public.item_variants cascade'), '^42501 TRACE_GUARD: bank content is never truncated', 'DB-M1-6: TRUNCATE item_variants is refused on the operator path');
select matches(pg_temp.try('truncate public.item_variant_keys'), '^42501 TRACE_GUARD: bank content is never truncated', 'DB-M1-6: TRUNCATE item_variant_keys is refused on the operator path');
select is((select string_agg(tgname || '=' || tgenabled::text, ',' order by tgname) from pg_trigger where tgname in ('item_variants_no_truncate', 'item_variant_keys_no_truncate')), 'item_variant_keys_no_truncate=A,item_variants_no_truncate=A', 'DB-M1-6: both truncate triggers are ENABLE ALWAYS');
select is((select count(*)::int from public.item_variants) > 0, true, 'DB-M1-6: the variants are still there');

-- ===== Migration M1-e (A1 DB review Lows): a difficulty has at most two decimals (never rounded); variants are 1..n =====
select pg_temp.op();
insert into public.items (id, org_id, workspace_id, format, skill_key) values
  ('c2000000-0000-4000-8000-000000000003', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant');
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256) values
  ('c2100000-0000-4000-8000-000000000003', pg_temp.id('A'), 'c2000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] P3',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64));
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.item_versions set difficulty = 0.505 where id = 'c2100000-0000-4000-8000-000000000003'$$), '^23514', 'M1-e: an item difficulty with a third decimal is refused, never rounded to 0.51');
select is((select difficulty::text from public.item_versions where id = 'c2100000-0000-4000-8000-000000000003'), '0.50', 'M1-e: the item difficulty is unchanged');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000003', 1, '{"a": 3}', '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.405, repeat('c', 64))$$), '^23514', 'M1-e: a variant difficulty of 0.405 is refused, never rounded to 0.41');
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000003', 1, '{"a": 3}', '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.55, repeat('c', 64))$$), 'OK 1', 'M1-e: variant 1 at 0.55 is stored');
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000003', 3, '{"a": 5}', '[synthetic] What is 5 + 1?', '[{"id": "o1", "text": "6"}, {"id": "o2", "text": "5"}]', 0.45, repeat('c', 64))$$), 'OK 1', 'M1-e: variant 3 is stored (number 2 is missing)');
select is(pg_temp.try($$insert into public.item_variant_keys (org_id, item_variant_id, key) select org_id, id, '{"option_id": "o1"}' from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000003'$$), 'OK 2', 'M1-e: both variants are keyed');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000003'$$), '^42501 TRACE_GUARD: variants are numbered 1 to n', 'M1-e: variants 1 and 3 without 2 cannot be submitted');
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000003', 2, '{"a": 4}', '[synthetic] What is 4 + 1?', '[{"id": "o1", "text": "5"}, {"id": "o2", "text": "4"}]', 0.50, repeat('c', 64))$$), 'OK 1', 'M1-e: variant 2 fills the gap');
select is(pg_temp.try($$insert into public.item_variant_keys (org_id, item_variant_id, key) select org_id, id, '{"option_id": "o1"}' from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000003' and variant_no = 2$$), 'OK 1', 'M1-e: variant 2 is keyed');
select pg_temp.op();
create temp table v2_keep as select * from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000003' and variant_no = 2;
create temp table v2_key_keep as select k.* from public.item_variant_keys as k join v2_keep as v on v.id = k.item_variant_id;
delete from public.item_variant_keys where item_variant_id in (select id from v2_keep);
delete from public.item_variants where id in (select id from v2_keep);
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000003'$$), '^42501 TRACE_GUARD: variants are numbered 1 to n', 'M1-f (R5-60 d): variant 2 of 1..3 deleted, the item cannot be submitted');
select pg_temp.op();
insert into public.item_variants select * from v2_keep;
insert into public.item_variant_keys select * from v2_key_keep;
select pg_temp.u('owner');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000003'$$), 'OK 1', 'M1-e: variants 1 to 3 are submitted');
select pg_temp.op();
select * from finish();
rollback;
