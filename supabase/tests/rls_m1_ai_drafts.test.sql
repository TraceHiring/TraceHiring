-- rls_m1_ai_drafts (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_ai_drafts; §3.2 ai_draft_jobs; §3.3 item_versions (R5-35 CHECK, job keys); §3.5; §4.4; §6.4; M1-8, M1-19; AT-M1-07, AT-M1-09 (DB half), AT-M1-25; R2-6, R2-23, R5-26, R5-35, R5-38). RED first: written from the spec before migration M1-c. Personas and drafts are synthetic; no topic text exists anywhere.
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
select plan(116);
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
-- Jobs: d1 (recruiter, A1, count 2), d2 (owner, A1, fails), d3 (admin, A1, running), d5 (admin, A1, stays queued),
-- dw (workspace recruiter, A2). Items of the drafts are written by the authoring worker with fixed ids c8…01-04.

-- ===== ai_draft_jobs: I (OW AD RC) =====
select pg_temp.u('recruiter');
select pg_temp.next_id('a8000000-0000-4000-8000-000000000001');
select is(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), 'OK 1', 'ai_draft_jobs I: recruiter requests two MCQ drafts in workspace A1');
select matches(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version, status) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1', 'running')$$), '^42501 permission denied', 'ai_draft_jobs I: status is outside the insert grant (a job starts queued)');
select matches(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version, drafts_created) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1', 2)$$), '^42501 permission denied', 'ai_draft_jobs I: counts are outside the insert grant');
select matches(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'astrology', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), '^23503 TRACE_GUARD: skill not found', 'ai_draft_jobs I: the skill comes from the taxonomy');
select matches(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.405, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), '^23514', 'ai_draft_jobs I (M1-f, R5-60 c): a difficulty of 0.405 is refused, never rounded to 0.41');
select is((select format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'public.ai_draft_jobs'::regclass and attname = 'difficulty'), 'numeric', 'ai_draft_jobs (M1-f, R5-60 c): difficulty is unconstrained numeric (no rounding type)');
select matches(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 11, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), '^23514', 'ai_draft_jobs I: at most 10 drafts per job');
select matches(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'voice', 'spoken_english', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), '^(22P02|23514)', 'ai_draft_jobs I: drafts are MCQ or written only (enum today, CHECK once voice joins section_format)');
select matches(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 2, '[synthetic] Write about a named customer', 'mock', 'mock-drafter-v1', 'draft-v1')$$), '^23514', 'ai_draft_jobs I: the topic is stored only as its SHA-256 (text never fits)');
select pg_temp.u('owner');
select pg_temp.next_id('a8000000-0000-4000-8000-000000000002');
select is(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'written', 'written_communication', 0.40, 3, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), 'OK 1', 'ai_draft_jobs I: owner requests written drafts');
select pg_temp.u('admin');
select pg_temp.next_id('a8000000-0000-4000-8000-000000000003');
select is(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 1, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), 'OK 1', 'ai_draft_jobs I: admin requests drafts');
select pg_temp.next_id('a8000000-0000-4000-8000-000000000005');
select is(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 1, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), 'OK 1', 'ai_draft_jobs I: admin requests a second job');
select pg_temp.u('ws_recruiter');
select pg_temp.next_id('a8000000-0000-4000-8000-000000000004');
select is(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'mcq', 'verbal', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), 'OK 1', 'ai_draft_jobs I: workspace recruiter requests drafts in workspace A2');
select matches(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), '^42501', 'ai_draft_jobs I: workspace recruiter cannot request drafts in workspace A1');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), '^42501', 'ai_draft_jobs I: reviewer cannot request drafts');
select pg_temp.u('hm');
select matches(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), '^42501', 'ai_draft_jobs I: hiring manager cannot request drafts');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), '^42501', 'ai_draft_jobs I: org B admin cannot request drafts in org A');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), '^42501 permission denied', 'ai_draft_jobs I: the authoring worker never creates its own job');
select pg_temp.op();
select is((select status || '|' || drafts_created || '|' || drafts_discarded || '|' || (requested_by = pg_temp.id('recruiter'))::text || '|' || coalesce(completed_at::text, 'null') from public.ai_draft_jobs where id = 'a8000000-0000-4000-8000-000000000001'), 'queued|0|0|true|null', 'ai_draft_jobs I: a new job is queued, empty and requested by the caller');
select is((select string_agg(column_name::text, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'ai_draft_jobs' and column_name like '%topic%'), 'topic_sha256', '§6.4: no topic text column, only its hash');

-- ===== ai_draft_jobs: S =====
select pg_temp.u('owner');
select is((select count(*)::int from public.ai_draft_jobs), 5, 'ai_draft_jobs S: owner sees the five org A jobs');
select pg_temp.u('admin');
select is((select count(*)::int from public.ai_draft_jobs), 5, 'ai_draft_jobs S (DB review M2): admin sees the five org A jobs');
select pg_temp.u('recruiter');
select is((select count(*)::int from public.ai_draft_jobs), 5, 'ai_draft_jobs S (DB review M2): an org-wide recruiter sees the five org A jobs');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.ai_draft_jobs), 1, 'ai_draft_jobs S: workspace recruiter sees only the A2 job');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.ai_draft_jobs), 0, 'ai_draft_jobs S: reviewer sees no job (matrix OW AD RC)');
select pg_temp.u('hm');
select is((select count(*)::int from public.ai_draft_jobs), 0, 'ai_draft_jobs S: hiring manager sees no job');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.ai_draft_jobs), 0, 'ai_draft_jobs S: org B admin sees no org A job');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select is((select count(*)::int from public.ai_draft_jobs), 5, 'ai_draft_jobs S: the authoring worker sees its job org''s jobs');
select pg_temp.w('trace_authoring_worker', pg_temp.id('B'));
select is((select count(*)::int from public.ai_draft_jobs), 0, 'ai_draft_jobs S: an authoring worker bound to org B sees no org A job (R5-35)');
select pg_temp.w('trace_authoring_worker', null);
select is((select count(*)::int from public.ai_draft_jobs), 0, 'ai_draft_jobs S: an unbound authoring worker sees nothing');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.ai_draft_jobs'), '^42501 permission denied', 'ai_draft_jobs S: the admin worker has no grant (R2-23)');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.ai_draft_jobs'), '^42501 permission denied', 'ai_draft_jobs S: the quality worker has no grant');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.ai_draft_jobs'), '^42501 permission denied', 'ai_draft_jobs S: trace_api has no grant');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try('select * from public.ai_draft_jobs'), '^42501 permission denied', 'ai_draft_jobs S: trace_candidate has no privilege');
select pg_temp.op();

-- ===== ai_draft_jobs: U (the authoring worker, status columns only) =====
select pg_temp.u('recruiter');
select matches(pg_temp.try($$update public.ai_draft_jobs set status = 'running' where id = 'a8000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'ai_draft_jobs U: staff cannot move a job');
select pg_temp.w('trace_authoring_worker', pg_temp.id('B'));
select is(pg_temp.try($$update public.ai_draft_jobs set status = 'running' where id = 'a8000000-0000-4000-8000-000000000001'$$), 'OK 0', 'ai_draft_jobs U: an authoring worker bound to org B cannot move an org A job (R5-35)');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select is(pg_temp.try($$update public.ai_draft_jobs set status = 'running' where id = 'a8000000-0000-4000-8000-000000000001'$$), 'OK 1', 'ai_draft_jobs U: the authoring worker starts job d1');
select is(pg_temp.try($$update public.ai_draft_jobs set status = 'running' where id in ('a8000000-0000-4000-8000-000000000003', 'a8000000-0000-4000-8000-000000000004')$$), 'OK 2', 'ai_draft_jobs U: the authoring worker starts jobs d3 and dw');
select matches(pg_temp.try($$update public.ai_draft_jobs set drafts_created = 2 where id = 'a8000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'ai_draft_jobs U: drafts_created is counted by the database, never written');
select matches(pg_temp.try($$update public.ai_draft_jobs set skill_key = 'quant' where id = 'a8000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'ai_draft_jobs U: the request is outside the worker grant');
select matches(pg_temp.try($$update public.ai_draft_jobs set drafts_discarded = 1 where id = 'a8000000-0000-4000-8000-000000000003'$$), '^42501 TRACE_GUARD: drafting counts are written when the job ends', 'ai_draft_jobs U: counts change only with the final status');
select matches(pg_temp.try($$update public.ai_draft_jobs set status = 'queued' where id = 'a8000000-0000-4000-8000-000000000003'$$), '^42501 TRACE_GUARD: drafting job status change not allowed', 'ai_draft_jobs U: a running job never goes back to queued');
select matches(pg_temp.try($$update public.ai_draft_jobs set status = 'completed' where id = 'a8000000-0000-4000-8000-000000000005'$$), '^42501 TRACE_GUARD: drafting job status change not allowed', 'ai_draft_jobs U: a queued job never completes without running');
select matches(pg_temp.try($$update public.ai_draft_jobs set status = 'failed' where id = 'a8000000-0000-4000-8000-000000000003'$$), '^23514', 'ai_draft_jobs U: a failure names its error code');

-- ===== Drafts: the authoring worker writes items, versions and keys for a running job (M1-19, R5-35) =====
select is(pg_temp.try($$insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c8000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal'), ('c8000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal'), ('c8000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal'), ('c8000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'mcq', 'verbal')$$), 'OK 4', 'items I: the authoring worker inserts draft items in its job org');
select is(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, origin, ai_draft_job_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] AI draft one', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'human', 'a8000000-0000-4000-8000-000000000001', repeat('1', 64))$$), 'OK 1', 'versions I: the authoring worker inserts a draft for its running job (any origin it names is overwritten)');
select is(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) select 'a1000000-0000-4000-8000-000000000001', id, 'mcq', '{"option_id": "o1"}' from public.item_versions where stem = '[synthetic] AI draft one'$$), 'OK 1', 'keys I: the authoring worker adds the key of its own in-review draft');
select is(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000002', 'mcq', '[synthetic] AI draft two', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'a8000000-0000-4000-8000-000000000001', repeat('2', 64))$$), 'OK 1', 'versions I: a second draft for job d1');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] AI draft three', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'a8000000-0000-4000-8000-000000000001', repeat('3', 64))$$), '^42501 TRACE_GUARD: an AI draft needs its running drafting job', 'versions I: never more drafts than the job asked for (count 2)');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] AI draft no job', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, repeat('3', 64))$$), '^42501 TRACE_GUARD: an AI draft needs its running drafting job', 'R5-35: an AI draft without a job is refused');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] AI draft queued job', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'a8000000-0000-4000-8000-000000000005', repeat('3', 64))$$), '^42501 TRACE_GUARD: an AI draft needs its running drafting job', 'R5-35: a queued job takes no draft');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] AI draft other workspace', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'a8000000-0000-4000-8000-000000000004', repeat('3', 64))$$), '^42501 TRACE_GUARD: an AI draft needs its running drafting job', 'R5-35: a workspace A1 draft cannot name a running workspace A2 job');
select is(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000004', 'mcq', '[synthetic] AI draft A2', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'a8000000-0000-4000-8000-000000000004', repeat('4', 64))$$), 'OK 1', 'versions I: a workspace A2 draft for the running A2 job');
select is(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) select 'a1000000-0000-4000-8000-000000000001', id, 'mcq', '{"option_id": "o2"}' from public.item_versions where stem in ('[synthetic] AI draft two', '[synthetic] AI draft A2')$$), 'OK 2', 'keys I: the authoring worker keys its other in-review drafts');
select is(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) select 'a1000000-0000-4000-8000-000000000001', id, 'mcq', '{"option_id": "o9"}' from public.item_versions where stem = '[synthetic] AI draft one'$$), '23514 TRACE_BAD_ANSWER_KEY', 'keys I: a drafted key must name one of the draft''s options');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id, content_sha256, status) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] x', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'a8000000-0000-4000-8000-000000000003', repeat('3', 64), 'approved')$$), '^42501 permission denied', 'AT-M1-07: the authoring worker cannot name a status');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id, content_sha256, approved_by) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] x', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'a8000000-0000-4000-8000-000000000003', repeat('3', 64), '00000000-0000-4000-8000-000000000001')$$), '^42501 permission denied', 'AT-M1-07: the authoring worker cannot name an approver');
select matches(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] AI draft one'$$), '^42501 permission denied', 'AT-M1-07: the authoring worker cannot move a draft past in_review');
select matches(pg_temp.try('select * from public.item_answer_keys'), '^42501 permission denied', 'keys S: the authoring worker reads no answer key (lead M1-a fix round)');
select pg_temp.w('trace_authoring_worker', pg_temp.id('B'));
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] Cross org', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'a8000000-0000-4000-8000-000000000003', repeat('3', 64))$$), '^42501', 'R5-35: an authoring worker bound to org B cannot draft into org A');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), '^42501', 'R5-35: an authoring worker bound to org B cannot insert an org A item');
select matches(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) select 'a1000000-0000-4000-8000-000000000001', id, 'mcq', '{"option_id": "o1"}' from public.item_versions where stem = '[synthetic] AI draft two'$$), '^OK 0|^42501', 'R5-35: an authoring worker bound to org B cannot key an org A draft');
select pg_temp.op();
select is((select string_agg(origin || '|' || status::text || '|' || coalesce(created_by::text, 'null') || '|' || coalesce(approved_by::text, 'null') || '|' || (ai_draft_job_id = 'a8000000-0000-4000-8000-000000000001')::text, ',' order by stem) from public.item_versions where stem in ('[synthetic] AI draft one', '[synthetic] AI draft two')), 'ai_draft|in_review|null|null|true,ai_draft|in_review|null|null|true', 'AT-M1-09: drafts land in_review only, with no approver, naming their job');
select is((select pg_temp.keys(a.details) || '|' || a.actor_kind::text || '|' || coalesce(a.actor_user_id::text, 'null') || '|' || (a.details ->> 'ai_draft_job_id') from public.audit_log as a join public.item_versions as v on v.id = a.object_id where a.action = 'item.ai_drafted' and v.stem = '[synthetic] AI draft one'), 'ai_draft_job_id,item_version_id|system|null|a8000000-0000-4000-8000-000000000001', 'AT-M1-25: item.ai_drafted names the version and its job, written as system');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, origin, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] Operator draft without job', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'ai_draft', repeat('3', 64))$$), '^23514 .*item_versions_ai_draft_job', 'R5-35: the CHECK refuses an AI draft without its job, even on the operator path');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, origin, ai_draft_job_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] Human with job', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'human', 'a8000000-0000-4000-8000-000000000003', repeat('3', 64))$$), '^42501 TRACE_GUARD: only an AI draft names a drafting job', 'R5-35: only an AI draft names a drafting job');
select matches(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] AI draft two'$$), '^23514', 'AT-M1-07: an AI draft cannot become approved without its approver, even on the operator path (CHECK)');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] x', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'a8000000-0000-4000-8000-000000000003', repeat('3', 64))$$), '^42501 permission denied', 'R5-35: an org user cannot name a drafting job (outside the insert grant)');
select matches(pg_temp.try($$update public.item_versions set status = 'retired' where stem = '[synthetic] AI draft two'$$), '^42501 TRACE_GUARD: item status change not allowed', 'AT-M1-07: an in-review AI draft cannot be retired');

-- ===== AT-M1-09: approval is by a human approver, logged =====
select pg_temp.u('reviewer_aal1');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] AI draft one'$$), 'OK 0', 'AT-M1-09: a reviewer at aal1 cannot approve (aal2 role, ADR-029)');
select pg_temp.u('ws_reviewer');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] AI draft one'$$), 'OK 0', 'AT-M1-09: a workspace A2 reviewer cannot approve a workspace A1 draft (R5-38)');
select pg_temp.u('b_admin');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] AI draft one'$$), 'OK 0', 'AT-M1-09: org B admin cannot approve an org A draft');
select pg_temp.u('hm');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] AI draft one'$$), 'OK 0', 'AT-M1-09: hiring manager cannot approve');
select pg_temp.u('reviewer');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] AI draft one'$$), 'OK 1', 'AT-M1-09: the reviewer approves the AI draft');
select pg_temp.u('owner');
select is(pg_temp.try($$update public.item_versions set status = 'not_approved' where stem = '[synthetic] AI draft two'$$), 'OK 1', 'R5-22: the owner sends an AI draft back');
select pg_temp.u('ws_reviewer');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] AI draft A2'$$), 'OK 1', 'AT-M1-09: the workspace A2 reviewer approves the A2 draft');
select pg_temp.op();
select is((select (approved_by = pg_temp.id('reviewer'))::text || '|' || (approved_at is not null)::text from public.item_versions where stem = '[synthetic] AI draft one'), 'true|true', 'AT-M1-07/09: the approved AI draft carries its approver and time');
select is((select pg_temp.keys(a.details) || '|' || (a.actor_user_id = pg_temp.id('reviewer'))::text || '|' || a.actor_kind::text || '|' || (a.details ->> 'self_approved') || '|' || (a.details ->> 'from') || '>' || (a.details ->> 'to') from public.audit_log as a join public.item_versions as v on v.id = a.object_id where a.action = 'item.approve' and v.stem = '[synthetic] AI draft one'), 'from,item_version_id,self_approved,to|true|org_user|false|in_review>approved', 'AT-M1-09: item.approve logs the approver of the AI draft');
select is((select status::text || '|' || coalesce(approved_by::text, 'null') from public.item_versions where stem = '[synthetic] AI draft two'), 'not_approved|null', 'R5-22: a sent-back AI draft has no approver');

-- ===== ai_draft_jobs: completion and failure (§4.4, R5-26) =====
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select is(pg_temp.try($$update public.ai_draft_jobs set status = 'completed', drafts_discarded = 1 where id = 'a8000000-0000-4000-8000-000000000001'$$), 'OK 1', 'ai_draft_jobs U: the worker completes job d1 with one draft discarded');
select is(pg_temp.try($$update public.ai_draft_jobs set status = 'failed', error_code = 'drafter_error' where id = 'a8000000-0000-4000-8000-000000000002'$$), 'OK 1', 'ai_draft_jobs U: the worker fails queued job d2 with an error code');
select matches(pg_temp.try($$update public.ai_draft_jobs set status = 'failed', error_code = 'drafter_error' where id = 'a8000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: a finished drafting job is frozen', 'ai_draft_jobs U: a finished job is frozen');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] Late draft', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'a8000000-0000-4000-8000-000000000001', repeat('3', 64))$$), '^42501 TRACE_GUARD: an AI draft needs its running drafting job', 'R5-35: a completed job takes no more drafts');
select pg_temp.op();
select is((select status || '|' || drafts_created || '|' || drafts_discarded || '|' || (completed_at is not null)::text from public.ai_draft_jobs where id = 'a8000000-0000-4000-8000-000000000001'), 'completed|2|1|true', 'ai_draft_jobs U: drafts_created is the count of stored drafts');
select is((select pg_temp.keys(details) || '|' || (details ->> 'drafts_created') || '|' || actor_kind::text from public.audit_log where action = 'ai_draft.complete' and object_id = 'a8000000-0000-4000-8000-000000000001'), 'ai_draft_job_id,drafts_created|2|system', 'AT-M1-25: ai_draft.complete carries the job id and the count, written as system');
select is((select pg_temp.keys(details) || '|' || (details ->> 'error_code') || '|' || actor_kind::text from public.audit_log where action = 'ai_draft.fail' and object_id = 'a8000000-0000-4000-8000-000000000002'), 'ai_draft_job_id,error_code|drafter_error|system', 'AT-M1-25: ai_draft.fail carries the job id and an error code enum');
select is((select count(*)::int from public.audit_log where (action like 'ai_draft.%' or action = 'item.ai_drafted') and exists (select 1 from jsonb_each(details) as e where jsonb_typeof(e.value) not in ('string', 'number'))), 0, 'AT-M1-25: no drafting audit row carries a nested or free-text structure');
select matches(pg_temp.try($$delete from public.ai_draft_jobs where id = 'a8000000-0000-4000-8000-000000000005'$$), '^42501 TRACE_GUARD: drafting jobs are kept', 'ai_draft_jobs D: kept even on the operator path');
select pg_temp.u('owner');
select matches(pg_temp.try($$delete from public.ai_draft_jobs$$), '^42501 permission denied', 'ai_draft_jobs D: no delete grant');

-- ===== idempotency_keys: scope ai_draft for the authoring worker (§6.4) =====
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'ai_draft', 'a8000000-0000-4000-8000-000000000001:ai_draft', now() + interval '7 days')$$), 'OK 1', 'idempotency I: the authoring worker records its job key');
select is((select count(*)::int from public.idempotency_keys), 1, 'idempotency S: the authoring worker reads its own scope');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', 'x', now() + interval '7 days')$$), '^42501', 'idempotency I: only the ai_draft scope');
select matches(pg_temp.try($$delete from public.idempotency_keys$$), '^42501 permission denied', 'idempotency D: no delete grant');
select pg_temp.w('trace_authoring_worker', pg_temp.id('B'));
select is((select count(*)::int from public.idempotency_keys), 0, 'idempotency S: a worker bound to org B reads no org A key (R5-35)');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'ai_draft', 'y', now() + interval '7 days')$$), '^42501', 'idempotency I: a worker bound to org B cannot write an org A key');

-- ===== R2-23, R2-6: the authoring worker holds nothing else =====
select pg_temp.op();
select is((select array_agg(c.relname::text order by c.relname) from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace, 'private'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_authoring_worker', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_authoring_worker', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), array['ai_draft_jobs', 'idempotency_keys', 'item_answer_keys', 'item_versions', 'items'], 'R2-23: the authoring worker holds exactly its five tables');
select is(has_schema_privilege('trace_authoring_worker', 'quality', 'USAGE') or has_schema_privilege('trace_authoring_worker', 'integrity', 'USAGE'), false, 'R2-23: the authoring worker holds nothing in quality or integrity');
select is((select string_agg(f, ',' order by f) from unnest(array['private.mcq_options_valid(jsonb)', 'private.param_spec_valid(jsonb)', 'private.media_refs_valid(jsonb)', 'private.job_org_id()']) as f where has_function_privilege('trace_authoring_worker', f, 'EXECUTE')), 'private.job_org_id(),private.mcq_options_valid(jsonb),private.media_refs_valid(jsonb),private.param_spec_valid(jsonb)', 'R2-6: the authoring worker executes the CHECK helpers of item_versions and its org helper');
select is(has_function_privilege('trace_authoring_worker', 'private.ai_draft_job_running(uuid, uuid, uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'private.ai_draft_job_running(uuid, uuid, uuid)', 'EXECUTE') or has_function_privilege('trace_authoring_worker', 'private.ai_draft_job_running_in(uuid, uuid)', 'EXECUTE'), false, 'R2-6: the drafting hooks are called by the definer guard only');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.sessions'), '^42501 permission denied', 'R2-23: the authoring worker cannot read sessions');
select matches(pg_temp.try('select * from public.pools'), '^42501 permission denied', 'R2-23: the authoring worker cannot read pools');
select matches(pg_temp.try('select * from public.import_jobs'), '^42501 permission denied', 'R2-23: the authoring worker cannot read imports');
select matches(pg_temp.try('select * from public.memberships'), '^42501 permission denied', 'R2-23: the authoring worker cannot read memberships');
select matches(pg_temp.try('select * from quality.scores'), '^42501 permission denied', 'R2-23: the authoring worker cannot reach quality');
select pg_temp.op();
-- ===== DB review M1 / security review L-3: the draft cap holds under concurrent deliveries =====
select is((select provolatile::text from pg_proc where oid = 'private.ai_draft_job_has_room(uuid,uuid)'::regprocedure), 'v', 'M1: ai_draft_job_has_room is volatile (it takes a row lock)');
select matches(pg_get_functiondef('private.ai_draft_job_has_room(uuid,uuid)'::regprocedure), 'for no key update', 'M1: the cap locks the job row before it counts, so two deliveries cannot both take the last slot and a job never ends over its count');
select matches(pg_get_functiondef('private.ai_draft_job_running(uuid,uuid,uuid)'::regprocedure), 'for no key update', 'M1: the running check locks the job row in the same mode as the cap (no lock upgrade), so no draft or key lands after the job ended');

-- ===== Migration M1-g (R5-61 b, c): a completed job has keyed drafts; the discard count is not capped (R5-51 d) =====
select pg_temp.op();
insert into public.ai_draft_jobs (id, org_id, workspace_id, requested_by, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values
  ('a8000000-0000-4000-8000-0000000000f1', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 1, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1'),
  ('a8000000-0000-4000-8000-0000000000f2', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'mcq', 'verbal', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select is(pg_temp.try($$update public.ai_draft_jobs set status = 'running' where id in ('a8000000-0000-4000-8000-0000000000f1', 'a8000000-0000-4000-8000-0000000000f2')$$), 'OK 2', 'M1-g: the worker claims jobs f1 and f2');
select matches(pg_temp.try($$update public.ai_draft_jobs set status = 'completed' where id = 'a8000000-0000-4000-8000-0000000000f1'$$), '^42501 TRACE_GUARD: a completed drafting job has keyed drafts', 'M1-g (DB review A3b L5): a job with no draft cannot complete');
select is(pg_temp.try($$update public.ai_draft_jobs set status = 'failed', error_code = 'no_draft_passed', drafts_discarded = 5 where id = 'a8000000-0000-4000-8000-0000000000f1'$$), 'OK 1', 'M1-g (R5-51 d): drafts_discarded counts every failed attempt, beyond count');
select is(pg_temp.try($$insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c8000000-0000-4000-8000-0000000000f2', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), 'OK 1', 'M1-g: the worker writes a draft item for job f2');
select is(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-0000000000f2', 'mcq', '[synthetic] AI draft without its key', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'a8000000-0000-4000-8000-0000000000f2', repeat('c', 64))$$), 'OK 1', 'M1-g: the worker writes the draft version, no key yet');
select matches(pg_temp.try($$update public.ai_draft_jobs set status = 'completed' where id = 'a8000000-0000-4000-8000-0000000000f2'$$), '^42501 TRACE_GUARD: a completed drafting job has keyed drafts', 'M1-g (DB review A3b L5): a job whose draft has no key cannot complete');
select is(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) select org_id, id, 'mcq', '{"option_id": "o1"}' from public.item_versions where ai_draft_job_id = 'a8000000-0000-4000-8000-0000000000f2'$$), 'OK 1', 'M1-g: the worker keys the draft');
select is(pg_temp.try($$update public.ai_draft_jobs set status = 'completed' where id = 'a8000000-0000-4000-8000-0000000000f2'$$), 'OK 1', 'M1-g: with its keyed draft, job f2 completes');
select pg_temp.op();
select is((select string_agg(tgname || '=' || tgenabled::text, ',' order by tgname collate "C") from pg_trigger where tgrelid = 'public.ai_draft_jobs'::regclass and tgname in ('ai_draft_jobs_guard', 'ai_draft_jobs_outcome')), 'ai_draft_jobs_guard=A,ai_draft_jobs_outcome=A', 'M1-j (DB review L7): the outcome trigger is ENABLE ALWAYS and sorts after the guard');
select * from finish();
rollback;
