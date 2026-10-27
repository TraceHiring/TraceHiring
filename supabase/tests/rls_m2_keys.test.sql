-- rls_m2_keys (spec specs/m2-scheduling-invites.md revision 5 §10 row rls_m2_keys; §3.2 org_keys; §3.4 row org_keys; M2-3, M2-20, R2-15, R5-9). RED first: written from the spec before migration M2-a. Key material is synthetic.
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
grant trace_messaging_worker to postgres with inherit false, set true;
grant usage on schema extensions to authenticated, anon, service_role, trace_worker, trace_quality_worker,
  trace_integrity_worker, trace_api, trace_candidate, trace_authoring_worker, trace_admin_worker, trace_messaging_worker;

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

-- ===== M2 fixtures (specs/m2-scheduling-invites.md revision 5). Synthetic only: ciphertexts, hashes and hints are made
-- from fixture keys, never from a real contact. =====
-- h(text): the hex SHA-256 of a fixture string (blind indexes, fingerprints, link hashes). ct(text): a v1 ciphertext shape.
create function pg_temp.h(p_s text) returns text language sql immutable as $f$
  select encode(sha256(convert_to(p_s, 'UTF8')), 'hex')
$f$;
grant execute on function pg_temp.h(text) to public;
create function pg_temp.ct(p_s text) returns text language sql immutable as $f$
  select 'v1.1.' || translate(encode(convert_to(p_s, 'UTF8'), 'base64'), E'+/=\n', '-_')
$f$;
grant execute on function pg_temp.ct(text) to public;
-- pooltv(key, org, workspace, items): a published version drawing 1 item from a pool of <items> approved MCQ items
-- (ratio <items>x; 10 = the drive minimum, R5-10), on the operator path. Records <key>, <key>_test, <key>_pool.
create function pg_temp.pooltv(p_key text, p_org uuid, p_ws uuid, p_items int default 10) returns uuid language plpgsql as $f$
declare v_pool uuid := gen_random_uuid();
begin
  perform pg_temp.op();
  perform pg_temp.bank(p_key || '_i' || n, p_org, p_ws, 'mcq', 'verbal', 0.50, 'approved') from generate_series(1, p_items) as n;
  insert into public.pools (id, org_id, workspace_id, name, format) values (v_pool, p_org, p_ws, 'Pool ' || p_key, 'mcq');
  insert into public.pool_items (org_id, pool_id, item_version_id)
    select p_org, v_pool, pg_temp.id(p_key || '_i' || n) from generate_series(1, p_items) as n;
  perform pg_temp.tv(p_key, p_org, p_ws);
  perform pg_temp.sec(p_key || '_s', p_key, 1, 'mcq', v_pool, 1, 100);
  perform pg_temp.preset(p_key, 'standard');
  perform pg_temp.publish(p_key);
  insert into pg_temp.ids values (p_key || '_pool', v_pool);
  return pg_temp.id(p_key);
end
$f$;
-- drive(key, version key, mode, status): a drive on the version's test, open from a day ago to 30 days ahead, on the
-- operator path (the guard copies the workspace). Records <key>.
create function pg_temp.drive(p_key text, p_tv text, p_mode text, p_status text default 'draft') returns uuid
language plpgsql as $f$
declare v_id uuid;
begin
  perform pg_temp.op();
  insert into public.drives (org_id, test_id, default_test_version_id, name, mode, status, opens_at, deadline_at)
    select v.org_id, v.test_id, v.id, 'Drive ' || p_key, p_mode::public.drive_mode, p_status::public.drive_status,
      now() - interval '1 day', now() + interval '30 days'
    from public.test_versions as v where v.id = pg_temp.id(p_tv)
    returning id into v_id;
  insert into pg_temp.ids values (p_key, v_id);
  return v_id;
end
$f$;
-- slot(key, drive key, hours from now, capacity): an open slot of a drive on the operator path. Records <key>.
create function pg_temp.slot(p_key text, p_drive text, p_hours numeric, p_capacity int) returns uuid
language plpgsql as $f$
declare v_id uuid;
begin
  perform pg_temp.op();
  insert into public.slots (org_id, drive_id, starts_at, capacity)
    select d.org_id, d.id, now() + make_interval(secs => (p_hours * 3600)::double precision), p_capacity
    from public.drives as d where d.id = pg_temp.id(p_drive)
    returning id into v_id;
  insert into pg_temp.ids values (p_key, v_id);
  return v_id;
end
$f$;
-- cand(key, org, workspace, phone key): a candidate and its contact on the operator path; two candidates given the same
-- phone key share a phone blind index. Records <key>.
create function pg_temp.cand(p_key text, p_org uuid, p_ws uuid, p_phone text default null) returns uuid
language plpgsql as $f$
declare v_id uuid;
begin
  perform pg_temp.op();
  insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint)
    values (p_org, p_ws, pg_temp.ct('n-' || p_key), 1, pg_temp.h('e-' || p_key))
    returning id into v_id;
  insert into public.candidate_contacts (org_id, candidate_id, workspace_id, email_ct, phone_ct, email_bidx, phone_bidx,
      email_hint, phone_hint, key_version)
    values (p_org, v_id, p_ws, pg_temp.ct('e-' || p_key), case when p_phone is not null then pg_temp.ct('p-' || p_phone) end,
      pg_temp.h('e-' || p_key), case when p_phone is not null then pg_temp.h('p-' || p_phone) end, 'c•••@example.test',
      case when p_phone is not null then '••••1234' end, 1);
  insert into pg_temp.ids values (p_key, v_id);
  return v_id;
end
$f$;
-- dinv(key, drive key, slot key or null, candidate key): a drive invitation on the operator path (the label trigger pins
-- the drive's default version and sets expires_at). Records <key>.
create function pg_temp.dinv(p_key text, p_drive text, p_slot text, p_cand text) returns uuid language plpgsql as $f$
declare v_id uuid;
begin
  perform pg_temp.op();
  insert into public.invitations (org_id, test_id, test_version_id, drive_id, slot_id, candidate_ref_id, link_token_hash,
      adult_confirmed_by_inviter, expires_at)
    select d.org_id, d.test_id, d.default_test_version_id, d.id, pg_temp.id(p_slot), pg_temp.id(p_cand),
      pg_temp.h('l-' || p_key), true, now() + interval '1 day'
    from public.drives as d where d.id = pg_temp.id(p_drive)
    returning id into v_id;
  insert into pg_temp.ids values (p_key, v_id);
  return v_id;
end
$f$;
-- consent(invitation key): trace_api moves the invitation to otp_verified with an adult self-declaration and records the
-- consent (D1 order); the caller then sets session_id. Records <key>_consent.
create function pg_temp.consent(p_inv text) returns void language plpgsql as $f$
declare v_org uuid; v_tv uuid; v_rs uuid; v_nv uuid; v_c uuid := gen_random_uuid();
begin
  perform pg_temp.op();
  select i.org_id, i.test_version_id, v.ruleset_version_id, v.notice_version_id into v_org, v_tv, v_rs, v_nv
  from public.invitations as i join public.test_versions as v on v.org_id = i.org_id and v.id = i.test_version_id
  where i.id = pg_temp.id(p_inv);
  perform pg_temp.api(v_org);
  update public.invitations set status = 'sent' where id = pg_temp.id(p_inv) and status = 'created';
  update public.invitations set status = 'otp_verified', adult_self_declared = true where id = pg_temp.id(p_inv);
  insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id,
      rendered_sha256, language, event)
    values (v_c, v_org, pg_temp.id(p_inv), v_tv, v_rs, v_nv, repeat('d', 64), 'en', 'granted');
  perform pg_temp.op();
  insert into pg_temp.ids values (p_inv || '_consent', v_c);
end
$f$;
select plan(27);
-- Fixtures: a version-1 contacts key for org A on the operator path.
insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek)
  values (pg_temp.id('A'), 'contacts', 1, 'dev:1', 'AAAAAAAAAAAAAAAAAAAAAA==');

-- ===== Role trace_messaging_worker (M2-20, R5-9) =====
select is((select rolcanlogin::text || '|' || rolbypassrls::text || '|' || rolsuper::text from pg_catalog.pg_roles where rolname = 'trace_messaging_worker'), 'false|false|false', 'role: trace_messaging_worker exists, NOLOGIN, no bypass, no superuser');
select is(has_schema_privilege('trace_messaging_worker', 'private', 'USAGE'), true, 'role: the messaging worker has USAGE on private (it calls its functions by name)');
select is(has_function_privilege('trace_messaging_worker', 'private.job_org_id()', 'EXECUTE'), true, 'role: the messaging worker may call private.job_org_id()');
select is(has_schema_privilege('trace_messaging_worker', 'quality', 'USAGE') or has_schema_privilege('trace_messaging_worker', 'integrity', 'USAGE'), false, 'role (rule 1): the messaging worker has no USAGE on quality or integrity');

-- ===== Shape (M2-3) =====
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'names', 1, 'dev:1', 'AAAAAAAAAAAAAAAAAAAAAA==')$$), '^23514', 'shape: purpose is contacts or bidx');
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'bidx', 0, 'dev:1', 'AAAAAAAAAAAAAAAAAAAAAA==')$$), '^23514', 'shape: key_version starts at 1');
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'bidx', 1, 'plain key', 'AAAAAAAAAAAAAAAAAAAAAA==')$$), '^23514', 'shape: kms_key_ref is an ARN or dev:<n>');
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'bidx', 1, 'dev:1', repeat('A', 1028))$$), '^23514', 'shape: a wrapped key over 1 KB is refused');
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'bidx', 1, 'dev:1', 'not base64!')$$), '^23514', 'shape: the wrapped key is base64');
select is(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'bidx', 1, 'arn:aws:kms:ap-south-1:123456789012:key/mrk-0000', 'AAAAAAAAAAAAAAAAAAAAAA==')$$), 'OK 1', 'shape: an ap-south-1 KMS ARN is accepted');

-- ===== trace_api (S, I through the api org; R2-15 first-use race) =====
select pg_temp.api(pg_temp.id('A'));
select is((select count(*)::int from public.org_keys), 2, 'S api: trace_api reads its api org''s keys');
select is(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'contacts', 1, 'dev:1', 'BBBBBBBBBBBBBBBBBBBBBB==') on conflict do nothing$$), 'OK 0', 'I api (R2-15): a racing first use does nothing on conflict; the caller re-selects the stored key');
select is((select wrapped_dek from public.org_keys where purpose = 'contacts' and key_version = 1), 'AAAAAAAAAAAAAAAAAAAAAA==', 'I api (R2-15): the stored key is the first one');
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000003', 'contacts', 1, 'dev:1', 'AAAAAAAAAAAAAAAAAAAAAA==')$$), '^42501', 'I api: trace_api cannot write another org''s key');
select matches(pg_temp.try($$update public.org_keys set retired_at = now()$$), '^42501', 'U api: no UPDATE grant');
select matches(pg_temp.try($$delete from public.org_keys$$), '^42501', 'D api: no DELETE grant');
select pg_temp.api(pg_temp.id('B'));
select is((select count(*)::int from public.org_keys), 0, 'S api: with org B as the api org, org A''s keys are invisible');
select pg_temp.api(null);
select is((select count(*)::int from public.org_keys), 0, 'S api: with no api org, nothing is visible');

-- ===== trace_messaging_worker (S through the job org) =====
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select is((select count(*)::int from public.org_keys), 2, 'S worker: the messaging worker reads its job org''s keys');
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'contacts', 2, 'dev:1', 'AAAAAAAAAAAAAAAAAAAAAA==')$$), '^42501', 'I worker: the messaging worker cannot write keys');
select pg_temp.w('trace_messaging_worker', pg_temp.id('B'));
select is((select count(*)::int from public.org_keys), 0, 'S worker: another job org sees nothing');

-- ===== Every app role is denied =====
select pg_temp.u('owner');
select matches(pg_temp.try('select * from public.org_keys'), '^42501 permission denied', 'S owner: no app-role grant (M2-3)');
select pg_temp.u('recruiter');
select matches(pg_temp.try('select * from public.org_keys'), '^42501 permission denied', 'S recruiter: denied');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.org_keys'), '^42501 permission denied', 'S trace_worker: denied');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.org_keys'), '^42501 permission denied', 'S authoring worker: denied');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try('select * from public.org_keys'), '^42501 permission denied', 'S candidate: denied');
reset role;
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.org_keys'::regclass), true, 'RLS: enabled on org_keys');
select * from finish();
rollback;
