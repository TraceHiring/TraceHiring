-- rls_m1_members (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_members; §3.2 member_invites; §3.3 memberships guard v2; §3.4 provision_invited_member; §3.5; §4.5; M1-20; AT-M1-26 (DB half), AT-M1-25; R2-6, R2-14, R2-15, R2-23, R3-8, R5-26, R5-30, R5-35; E26, E27). RED first: written from the spec before migration M1-d. Personas are synthetic; no e-mail address is stored by M1 (the HMACs below are fixed hex strings).
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
select plan(129);
-- Extra personas: pure_owner (…030, org A owner only), invitee (…031), invitee two (…032) and three (…033).
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000030', 'authenticated', 'authenticated', 'p-pure-owner@example.test'),
  ('00000000-0000-4000-8000-000000000031', 'authenticated', 'authenticated', 'p-invitee@example.test'),
  ('00000000-0000-4000-8000-000000000032', 'authenticated', 'authenticated', 'p-invitee-two@example.test'),
  ('00000000-0000-4000-8000-000000000033', 'authenticated', 'authenticated', 'p-invitee-three@example.test');
insert into public.memberships (org_id, user_id, roles, display_name, status) values
  (pg_temp.id('A'), '00000000-0000-4000-8000-000000000030', '{org_owner}', 'Persona Pure Owner', 'active');
insert into pg_temp.ids values ('invitee', '00000000-0000-4000-8000-000000000031'), ('invitee2', '00000000-0000-4000-8000-000000000032'),
  ('invitee3', '00000000-0000-4000-8000-000000000033'), ('outsider', '00000000-0000-4000-8000-000000000011');
-- as_sub(user, aal2): an authenticated session of a user that has no named persona (OTP at aal1, or OTP + TOTP at aal2).
create function pg_temp.as_sub(p_sub uuid, p_aal2 boolean) returns void language plpgsql as $f$
begin
  perform pg_temp.op();
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', case when p_aal2
    then '{"sub": "' || p_sub || '", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}'
    else '{"sub": "' || p_sub || '", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}' end, true);
end
$f$;
grant execute on function pg_temp.as_sub(uuid, boolean) to public;
create table pg_temp.res (k text primary key, v uuid);
grant select, insert on pg_temp.res to public;

-- ===== member_invites: I (AD aal2; an owner invite only by an owner, R2-14) =====
select pg_temp.u('admin');
select is(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('1', 64), '{recruiter}')$$), 'OK 1', 'member_invites I: admin invites a recruiter');
select is(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles, workspace_id) values ('a1000000-0000-4000-8000-000000000001', repeat('3', 64), '{recruiter}', 'b1000000-0000-4000-8000-000000000002')$$), 'OK 1', 'member_invites I: admin invites a recruiter scoped to workspace A2');
select is(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('4', 64), '{reviewer}'), ('a1000000-0000-4000-8000-000000000001', repeat('5', 64), '{hiring_manager}'), ('a1000000-0000-4000-8000-000000000001', repeat('6', 64), '{recruiter}'), ('a1000000-0000-4000-8000-000000000001', repeat('7', 64), '{reviewer}')$$), 'OK 4', 'member_invites I: admin invites a reviewer, a hiring manager and two more');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('8', 64), '{org_owner}')$$), '^42501 TRACE_GUARD: only an owner invites an owner', 'R2-14: an admin who is not an owner cannot invite an owner');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles, workspace_id) values ('a1000000-0000-4000-8000-000000000001', repeat('8', 64), '{admin}', 'b1000000-0000-4000-8000-000000000002')$$), '^23514', 'member_invites I: an admin invite is org-wide (D16b)');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', 'p-someone@example.test', '{recruiter}')$$), '^23514', 'member_invites I: only a 64-hex HMAC fits, never an address (R2-14)');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('1', 64), '{reviewer}')$$), '^23505', 'member_invites I: one pending invite per address per org');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles, status) values ('a1000000-0000-4000-8000-000000000001', repeat('9', 64), '{recruiter}', 'provisioned')$$), '^42501 permission denied', 'member_invites I: status is outside the insert grant (an invite starts pending)');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles, invited_by) values ('a1000000-0000-4000-8000-000000000001', repeat('9', 64), '{recruiter}', '00000000-0000-4000-8000-000000000001')$$), '^42501 permission denied', 'member_invites I: invited_by is outside the insert grant (the guard sets the caller)');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('9', 64), '{recruiter,recruiter}')$$), '^23514', 'member_invites I: roles follow valid_roles');
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('2', 64), '{org_owner}')$$), 'OK 1', 'R2-14: an owner (with admin) invites an owner');
select pg_temp.u('pure_owner');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501', 'member_invites I: an owner without the admin role cannot invite (matrix I: AD)');
select pg_temp.u('admin_aal1');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501', 'member_invites I: an admin at aal1 cannot invite (aal2)');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501', 'member_invites I: recruiter cannot invite');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles, workspace_id) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}', 'b1000000-0000-4000-8000-000000000002')$$), '^42501', 'member_invites I: workspace recruiter cannot invite, even into their workspace');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501', 'member_invites I: reviewer cannot invite');
select pg_temp.u('hm');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501', 'member_invites I: hiring manager cannot invite');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501', 'member_invites I: org B admin cannot invite into org A');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501 permission denied', 'member_invites I: the admin worker never creates an invite');
select pg_temp.op();
insert into pg_temp.ids select 'i' || substr(email_hmac, 1, 1), id from public.member_invites where org_id = pg_temp.id('A');
select is((select string_agg(substr(email_hmac, 1, 1) || ':' || status || ':' || (invited_by = case when roles = '{org_owner}' then pg_temp.id('owner') else pg_temp.id('admin') end)::text, ',' order by email_hmac) from public.member_invites), '1:pending:true,2:pending:true,3:pending:true,4:pending:true,5:pending:true,6:pending:true,7:pending:true', 'member_invites I: invites start pending, invited by the caller');
select is((select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'member_invites'), 'id,org_id,email_hmac,roles,workspace_id,status,membership_id,invited_by,created_at', 'member_invites: no address, name or other personal column (R2-14)');
select is((select pg_temp.keys(details) || '|' || (details -> 'roles')::text || '|' || (actor_user_id = pg_temp.id('admin'))::text from public.audit_log where action = 'member_invite.create' and object_id = pg_temp.id('i1')), 'member_invite_id,roles|["recruiter"]|true', 'AT-M1-25: member_invite.create carries the invite id and roles, by the admin');

-- ===== member_invites: S (OW AD) =====
select pg_temp.u('owner');
select is((select count(*)::int from public.member_invites), 7, 'member_invites S: owner sees the org A invites');
select pg_temp.u('admin');
select is((select count(*)::int from public.member_invites), 7, 'member_invites S: admin sees the org A invites');
select pg_temp.u('pure_owner');
select is((select count(*)::int from public.member_invites), 7, 'member_invites S: an owner without admin sees them (matrix S: OW AD)');
select pg_temp.u('admin_aal1');
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: an admin at aal1 sees none');
select pg_temp.u('recruiter');
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: recruiter sees none');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: workspace recruiter sees none, not even the A2 invite');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: reviewer sees none');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: org B admin sees no org A invite');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select is((select count(*)::int from public.member_invites), 7, 'member_invites S: the admin worker sees its job org''s invites');
select pg_temp.w('trace_admin_worker', pg_temp.id('B'));
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: an admin worker bound to org B sees no org A invite (R5-35)');
select pg_temp.w('trace_admin_worker', null);
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: an unbound admin worker sees nothing');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.member_invites'), '^42501 permission denied', 'member_invites S: the authoring worker has no grant (R2-23)');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.member_invites'), '^42501 permission denied', 'member_invites S: trace_api has no grant (provisioning runs in workers/jobs, M1-20)');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try('select * from public.member_invites'), '^42501 permission denied', 'member_invites S: trace_candidate has no privilege');
select pg_temp.op();
set local role service_role;
select matches(pg_temp.try('select * from public.member_invites'), '^42501 permission denied', 'member_invites S: service_role has no privilege');
select pg_temp.op();

-- ===== member_invites: U (admin cancels; the admin worker marks failed) =====
select pg_temp.u('admin_aal1');
select is(pg_temp.try(format($$update public.member_invites set status = 'cancelled' where id = %L$$, pg_temp.id('i4'))), 'OK 0', 'member_invites U (DB review M2): an admin at aal1 cannot cancel (aal2 role)');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.member_invites set status = 'cancelled' where id = %L$$, pg_temp.id('i4'))), 'OK 0', 'member_invites U: recruiter cannot cancel');
select pg_temp.u('pure_owner');
select is(pg_temp.try(format($$update public.member_invites set status = 'cancelled' where id = %L$$, pg_temp.id('i4'))), 'OK 0', 'member_invites U: an owner without admin cannot cancel (matrix U: AD)');
select pg_temp.u('b_admin');
select is(pg_temp.try(format($$update public.member_invites set status = 'cancelled' where id = %L$$, pg_temp.id('i4'))), 'OK 0', 'member_invites U: org B admin cannot cancel an org A invite');
select pg_temp.u('admin');
select matches(pg_temp.try(format($$update public.member_invites set status = 'failed' where id = %L$$, pg_temp.id('i4'))), '^42501', 'member_invites U: an admin only cancels');
select matches(pg_temp.try(format($$update public.member_invites set roles = '{admin}' where id = %L$$, pg_temp.id('i4'))), '^42501 permission denied', 'member_invites U: roles are outside the update grant');
select is(pg_temp.try(format($$update public.member_invites set status = 'cancelled' where id = %L$$, pg_temp.id('i4'))), 'OK 1', 'member_invites U: admin cancels a pending invite');
select is(pg_temp.try(format($$update public.member_invites set status = 'pending' where id = %L$$, pg_temp.id('i4'))), 'OK 0', 'member_invites U: a cancelled invite is final');
select pg_temp.op();
select matches(pg_temp.try(format($$update public.member_invites set status = 'pending' where id = %L$$, pg_temp.id('i4'))), '^42501 TRACE_GUARD: a settled invite is final', 'member_invites U: a cancelled invite is final, even on the operator path');
select matches(pg_temp.try(format($$delete from public.member_invites where id = %L$$, pg_temp.id('i4'))), '^42501 TRACE_GUARD: invites are kept', 'member_invites D: kept, even on the operator path');
select is((select pg_temp.keys(details) || '|' || (actor_user_id = pg_temp.id('admin'))::text from public.audit_log where action = 'member_invite.cancel' and object_id = pg_temp.id('i4')), 'member_invite_id|true', 'AT-M1-25: member_invite.cancel carries the invite id only');
select pg_temp.w('trace_admin_worker', pg_temp.id('B'));
select is(pg_temp.try(format($$update public.member_invites set status = 'failed' where id = %L$$, pg_temp.id('i5'))), 'OK 0', 'member_invites U: an admin worker bound to org B cannot touch an org A invite (R5-35)');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$update public.member_invites set status = 'cancelled' where id = %L$$, pg_temp.id('i5'))), '^42501 TRACE_GUARD: an org admin cancels an invite', 'member_invites U: the admin worker does not cancel');
select matches(pg_temp.try(format($$update public.member_invites set status = 'provisioned' where id = %L$$, pg_temp.id('i5'))), '^42501 TRACE_GUARD: a provisioned invite names its invited membership', 'member_invites U: the admin worker cannot mark an invite provisioned by hand');
select matches(pg_temp.try(format($$update public.member_invites set membership_id = gen_random_uuid() where id = %L$$, pg_temp.id('i5'))), '^42501 permission denied', 'member_invites U: membership_id is outside every grant');
select is(pg_temp.try(format($$update public.member_invites set status = 'failed' where id = %L$$, pg_temp.id('i5'))), 'OK 1', 'member_invites U: the admin worker marks an invite failed');
select pg_temp.op();
select is((select pg_temp.keys(details) || '|' || actor_kind::text from public.audit_log where action = 'member_invite.failed' and object_id = pg_temp.id('i5')), 'member_invite_id|system', 'AT-M1-25: member_invite.failed carries the invite id, written as system');

-- ===== provision_invited_member: who may call it (M1-20, R5-35) =====
select pg_temp.u('admin');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), '^42501 permission denied', 'provision: an org admin cannot call it');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), '^42501 permission denied', 'provision: trace_api cannot call it (service keys stay in workers/jobs)');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), '^42501 permission denied', 'provision: the authoring worker cannot call it');
select pg_temp.w('trace_admin_worker', pg_temp.id('B'));
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), '^42501 TRACE_GUARD: member invite not found in the job org', 'R5-35: an admin worker bound to org B cannot provision an org A invite');
select pg_temp.w('trace_admin_worker', null);
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), '^42501 TRACE_GUARD: member invite not found in the job org', 'R5-35: an unbound admin worker provisions nothing');
select pg_temp.op();
select is((select string_agg(r, ',' order by r) from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_authoring_worker', 'trace_admin_worker', 'trace_candidate']) as r where has_function_privilege(r, 'private.provision_invited_member(uuid, uuid, text)', 'EXECUTE')), 'trace_admin_worker', 'provision: EXECUTE is granted to trace_admin_worker only');

-- ===== provision_invited_member: the invited membership (roles only from the invite, R2-14) =====
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select is(pg_temp.try(format($$insert into pg_temp.res select 'm1', private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), 'OK 1', 'AT-M1-26: the admin worker provisions the recruiter invite');
select is(pg_temp.try(format($$insert into pg_temp.res select 'm2', private.provision_invited_member(%L, %L, 'Persona Invitee Two')$$, pg_temp.id('i2'), pg_temp.id('invitee2'))), 'OK 1', 'AT-M1-26: the admin worker provisions the owner invite (an owner invited it)');
select is(pg_temp.try(format($$insert into pg_temp.res select 'm3', private.provision_invited_member(%L, %L, 'Persona Invitee Three')$$, pg_temp.id('i3'), pg_temp.id('invitee3'))), 'OK 1', 'AT-M1-26: the admin worker provisions the workspace A2 invite');
select is(pg_temp.try(format($$insert into pg_temp.res select 'm1b', private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), 'OK 1', 'provision: a re-delivered job for the same user succeeds');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Someone Else')$$, pg_temp.id('i1'), pg_temp.id('outsider'))), '^42501 TRACE_GUARD: the invite is not pending', 'provision: a provisioned invite serves no other user');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Outsider')$$, pg_temp.id('i4'), pg_temp.id('outsider'))), '^42501 TRACE_GUARD: the invite is not pending', 'provision: a cancelled invite is not provisioned');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Outsider')$$, pg_temp.id('i5'), pg_temp.id('outsider'))), '^42501 TRACE_GUARD: the invite is not pending', 'provision: a failed invite is not provisioned');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Recruiter Again')$$, pg_temp.id('i6'), pg_temp.id('recruiter'))), '^23505 TRACE_GUARD: the user already has a membership in this org', 'E26: an existing Auth user who is already a member gets no second membership');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, gen_random_uuid(), 'Persona Nobody')$$, pg_temp.id('i6'))), '^23503', 'provision: the user must exist in Auth');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, repeat('n', 121))$$, pg_temp.id('i6'), pg_temp.id('outsider'))), '^22023 TRACE_BAD_INPUT: display name', 'provision (security review L-1): a display name outside 1-120 characters is refused before the insert, so the name never reaches an error detail');
select matches(pg_temp.try(format($$insert into public.memberships (org_id, user_id, roles, display_name, status) values (%L, %L, '{recruiter}', 'Direct', 'invited')$$, pg_temp.id('A'), pg_temp.id('outsider'))), '^42501 permission denied', 'provision: the admin worker cannot insert a membership directly');
select set_config('trace.provision_invite', pg_temp.id('i6')::text, true);
select matches(pg_temp.try(format($$insert into public.memberships (org_id, user_id, roles, display_name, status) values (%L, %L, '{recruiter}', 'Direct', 'invited')$$, pg_temp.id('A'), pg_temp.id('outsider'))), '^42501 permission denied', 'provision: setting the marker by hand does not open a direct insert');
select set_config('trace.provision_invite', '', true);
select pg_temp.op();
select is((select (select v from pg_temp.res where k = 'm1b') = (select v from pg_temp.res where k = 'm1')), true, 'provision: the re-delivered job returns the same membership (exactly once)');
select is((select string_agg(m.status::text || ':' || array_to_string(m.roles, '+') || ':' || coalesce(w.name, 'org-wide') || ':' || (m.created_by = i.invited_by)::text || ':' || m.display_name || ':' || (i.status = 'provisioned' and i.membership_id = m.id)::text, ',' order by m.display_name) from public.memberships as m join public.member_invites as i on i.membership_id = m.id left join public.workspaces as w on w.id = m.workspace_id where m.user_id in (pg_temp.id('invitee'), pg_temp.id('invitee2'), pg_temp.id('invitee3'))),
  'invited:recruiter:org-wide:true:Persona Invitee:true,invited:recruiter:Client A2:true:Persona Invitee Three:true,invited:org_owner:org-wide:true:Persona Invitee Two:true',
  'AT-M1-26: each membership is invited, with the invite''s roles and workspace, created by the inviter, and its invite is provisioned');
select is((select count(*)::int from public.memberships where user_id = pg_temp.id('invitee')), 1, 'provision: one membership for the invitee');
select is((select status from public.member_invites where id = pg_temp.id('i6')), 'pending', 'E26: the refused invite stays pending for the worker to mark failed');
select is((select pg_temp.keys(a.details) || '|' || (a.details ->> 'status') || '|' || (a.details -> 'roles')::text || '|' || a.actor_kind::text from public.audit_log as a where a.action = 'membership.create' and a.object_id = (select v from pg_temp.res where k = 'm1')), 'roles,status,team_id,workspace_id|invited|["recruiter"]|system', 'R5-14: provisioning writes membership.create in the M0b shape with status invited, as system');
select is((select pg_temp.keys(details) || '|' || actor_kind::text from public.audit_log where action = 'member_invite.provisioned' and object_id = pg_temp.id('i1')), 'member_invite_id|system', 'AT-M1-25: member_invite.provisioned carries the invite id only');

-- ===== E27: an invited member has no access until they accept =====
select pg_temp.u('invitee');
select is((select string_agg(status::text, ',') from public.memberships), 'invited', 'E27: the invitee sees their own invited row');
select is((select count(*)::int from public.orgs), 0, 'E27: an invited member sees no org');
select is((select count(*)::int from public.tests), 0, 'E27: an invited member sees no test');
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: the invitee never reads invites');

-- ===== R2-15: the invitee moves their own row invited → active, nothing else =====
select is(pg_temp.try($$update public.memberships set display_name = 'Invited Self' where user_id = '00000000-0000-4000-8000-000000000031'$$), '42501 TRACE_GUARD: an invited member can only accept', 'R2-15: an invited member cannot change their display name before accepting');
select is(pg_temp.try($$update public.memberships set roles = '{admin}' where user_id = '00000000-0000-4000-8000-000000000031'$$), '42501 TRACE_GUARD: an invited member can only accept', 'R2-15: an invited member cannot change their roles');
select is(pg_temp.try($$update public.memberships set status = 'active', display_name = 'Renamed' where user_id = '00000000-0000-4000-8000-000000000031'$$), '42501 TRACE_GUARD: accepting an invitation changes the status only', 'R2-15: accepting changes the status only');
select matches(pg_temp.try($$update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-000000000031'$$), '^42501', 'R2-15: the invitee can only move to active');
select pg_temp.u('admin');
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000031'$$), '42501 TRACE_GUARD: only the invitee accepts an invitation', 'R2-15: an admin cannot accept for the invitee');
select pg_temp.op();
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000031'$$), '42501 TRACE_GUARD: only the invitee accepts an invitation', 'R2-15: nor can the operator');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select matches(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000031'$$), '^42501 permission denied', 'R2-15: nor can the admin worker');
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000031'$$), 'OK 0', 'R2-15: another member cannot reach the invited row');
select pg_temp.u('b_admin');
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000031'$$), 'OK 0', 'R2-15: org B admin cannot reach the invited row');
select pg_temp.u('invitee');
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000031'$$), 'OK 1', 'R2-15: the invitee accepts at aal1 (any aal)');
select is((select count(*)::int from public.orgs), 1, 'R2-15: once active, the recruiter membership counts (org A visible)');
select matches(pg_temp.try($$update public.memberships set status = 'invited' where user_id = '00000000-0000-4000-8000-000000000031'$$), '^42501', 'R2-15: an accepted membership never goes back to invited');
select pg_temp.op();
select is((select (a.details -> 'changed')::text || '|' || (a.details ->> 'old_status') || '>' || (a.details ->> 'new_status') || '|' || a.actor_kind::text || '|' || (a.actor_user_id = pg_temp.id('invitee'))::text from public.audit_log as a where a.action = 'membership.update' and a.object_id = (select v from pg_temp.res where k = 'm1')), '["status"]|invited>active|org_user|true', 'R2-15: the acceptance is audited as the invitee''s own status change');
select pg_temp.as_sub(pg_temp.id('invitee2'), false);
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000032'$$), 'OK 1', 'R2-15: an invited owner accepts at aal1');
select is((select count(*)::int from public.orgs), 0, 'ADR-029: the accepted owner membership counts only at aal2');
select pg_temp.as_sub(pg_temp.id('invitee2'), true);
select is((select count(*)::int from public.orgs), 1, 'ADR-029: at aal2 the owner sees org A');

-- ===== E27 / §4.5: an owner or admin removes an unaccepted invitation =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.memberships set status = 'removed' where user_id = '00000000-0000-4000-8000-000000000033'$$), 'OK 0', 'E27: a recruiter cannot remove an invited member');
select pg_temp.u('ws_recruiter');
select is(pg_temp.try($$update public.memberships set status = 'removed' where user_id = '00000000-0000-4000-8000-000000000033'$$), 'OK 0', 'E27: a workspace recruiter cannot remove an invited member of their workspace');
select pg_temp.u('admin');
select is(pg_temp.try($$update public.memberships set status = 'removed' where user_id = '00000000-0000-4000-8000-000000000033'$$), 'OK 1', 'E27: an admin removes an invited member');
select pg_temp.op();
select is((select status::text || '|' || (removed_at is not null)::text from public.memberships where user_id = pg_temp.id('invitee3')), 'removed|true', 'E27: the invited row is removed');
select is((select pg_temp.keys(details) || '|' || (details ->> 'old_status') from public.audit_log where action = 'membership.remove' and object_id = (select v from pg_temp.res where k = 'm3')), 'old_status|invited', 'E27: membership.remove records the invited status');

-- ===== M0b paths kept (memberships guard v2, R5-30) =====
select is(pg_temp.try(format($$insert into public.memberships (org_id, user_id, roles, display_name, status) values (%L, %L, '{reviewer}', 'Operator Invited', 'invited')$$, pg_temp.id('B'), pg_temp.id('invitee3'))), 'OK 1', 'M0b: the operator may still insert an invited membership (fixtures)');
select pg_temp.u('admin');
select is(pg_temp.try(format($$insert into public.memberships (org_id, user_id, roles, display_name, status) values (%L, %L, '{recruiter}', 'App Invited', 'invited')$$, pg_temp.id('A'), pg_temp.id('outsider'))), '42501 TRACE_GUARD: an invited membership is created by the invite worker only', 'M1-20: an app caller cannot insert an invited membership');
select is(pg_temp.try(format($$insert into public.memberships (org_id, user_id, roles, display_name) values (%L, %L, '{recruiter}', 'App Active')$$, pg_temp.id('A'), pg_temp.id('outsider'))), 'OK 1', 'M0b: an admin still adds an active member');
select is(pg_temp.try($$update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-000000000011' and org_id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 1', 'M0b: an admin still suspends a member');
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.memberships set display_name = 'Recruiter Renamed' where user_id = '00000000-0000-4000-8000-000000000005'$$), 'OK 1', 'M0b: an active member still renames themselves');
select matches(pg_temp.try($$update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-000000000005'$$), '^42501 TRACE_GUARD: nobody changes their own roles, status or scope', 'M0b: nobody changes their own status');

-- ===== R2-14: the inviter is re-checked at provisioning and again at acceptance (security review M-1) =====
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select is(pg_temp.try(format($$insert into pg_temp.res select 'm7', private.provision_invited_member(%L, %L, 'Persona Invitee Three')$$, pg_temp.id('i7'), pg_temp.id('invitee3'))), 'OK 1', 'R2-14: an invite of an active admin is provisioned');
select pg_temp.op();
insert into public.member_invites (id, org_id, email_hmac, roles, invited_by) values ('a9000000-0000-4000-8000-000000000008', pg_temp.id('A'), repeat('b', 64), '{recruiter}', pg_temp.id('admin'));
update public.memberships set status = 'suspended' where org_id = pg_temp.id('A') and user_id = pg_temp.id('admin');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$select private.provision_invited_member('a9000000-0000-4000-8000-000000000008', %L, 'Persona Invitee Three')$$, pg_temp.id('invitee3'))), '^42501 TRACE_GUARD: the inviter is no longer an active admin or owner', 'R2-14: an invite from an admin who was suspended is not provisioned');
select pg_temp.as_sub(pg_temp.id('invitee3'), false);
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000033' and org_id = 'a1000000-0000-4000-8000-000000000001'$$), '42501 TRACE_GUARD: the inviter is no longer an active admin or owner', 'R2-14 (security review M-1): an invitation cannot be accepted after its inviter was suspended');
select pg_temp.op();
update public.memberships set status = 'removed' where org_id = pg_temp.id('A') and user_id = pg_temp.id('admin');
select pg_temp.as_sub(pg_temp.id('invitee3'), false);
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000033' and org_id = 'a1000000-0000-4000-8000-000000000001'$$), '42501 TRACE_GUARD: the inviter is no longer an active admin or owner', 'R2-14 (security review M-1): nor after the inviter was removed');
select pg_temp.op();
select is((select status::text from public.memberships where org_id = pg_temp.id('A') and user_id = pg_temp.id('invitee3') and status <> 'removed'), 'invited', 'R2-14: the invitation stays unaccepted (an admin may remove it, E27)');

-- ===== R2-6, R2-23: the admin worker holds nothing else =====
select is((select array_agg(c.relname::text || case when has_any_column_privilege('trace_admin_worker', c.oid, 'INSERT, UPDATE') then ':write' else '' end order by c.relname) from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace, 'private'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_admin_worker', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_admin_worker', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), array['member_invites:write'], 'R2-23: the admin worker holds exactly member_invites (select, update status)');
select is(has_function_privilege('trace_admin_worker', 'private.valid_roles(public.org_role[])', 'EXECUTE') and has_function_privilege('trace_admin_worker', 'private.job_org_id()', 'EXECUTE'), true, 'R2-6: the admin worker executes the roles CHECK helper and its org helper');
select is(has_schema_privilege('trace_admin_worker', 'quality', 'USAGE') or has_schema_privilege('trace_admin_worker', 'integrity', 'USAGE'), false, 'R2-23: the admin worker holds nothing in quality or integrity');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.memberships'), '^42501 permission denied', 'R2-23: the admin worker cannot read memberships');
select matches(pg_temp.try('select * from public.items'), '^42501 permission denied', 'R2-23: the admin worker cannot read items');
select matches(pg_temp.try('select * from public.sessions'), '^42501 permission denied', 'R2-23: the admin worker cannot read sessions');
select matches(pg_temp.try('select * from public.audit_log'), '^42501 permission denied', 'R2-23: the admin worker cannot read the audit log');
select pg_temp.op();

-- ===== AT-M1-25: invite audit details are ids and role enums only =====
select is((select count(*)::int from public.audit_log where action like 'member_invite.%' and not (pg_temp.keys(details) in ('member_invite_id', 'member_invite_id,roles') and (details ->> 'member_invite_id') ~ '^[0-9a-f-]{36}$' and (not (details ? 'roles') or (jsonb_typeof(details -> 'roles') = 'array' and not exists (select 1 from jsonb_array_elements(details -> 'roles') as r where jsonb_typeof(r) <> 'string' or (r #>> '{}') not in ('org_owner', 'admin', 'recruiter', 'reviewer', 'hiring_manager')))))), 0, 'AT-M1-25: every member_invite.* row carries the invite id and, on create, role enums only');
select is((select count(*)::int from public.audit_log where action like 'member_invite.%'), 14, 'AT-M1-25: eight creates (one on the operator path), one cancel, one failure and four provisionings; the re-delivered job writes no second row');

-- ===== R2-14 for an owner invitation (R5-51 a; Wave 0c confirming re-review Low): its inviter must still be an active owner at acceptance =====
-- Last in the file, so the audit count above is unchanged. Invites on the operator path, from the owner persona.
select pg_temp.op();
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000034', 'authenticated', 'authenticated', 'p-invitee-four@example.test'),
  ('00000000-0000-4000-8000-000000000035', 'authenticated', 'authenticated', 'p-invitee-five@example.test');
insert into pg_temp.ids values ('invitee4', '00000000-0000-4000-8000-000000000034'), ('invitee5', '00000000-0000-4000-8000-000000000035');
insert into public.member_invites (id, org_id, email_hmac, roles, invited_by) values
  ('a9000000-0000-4000-8000-00000000000a', pg_temp.id('A'), repeat('c', 64), '{org_owner}', pg_temp.id('owner')),
  ('a9000000-0000-4000-8000-00000000000b', pg_temp.id('A'), repeat('d', 64), '{org_owner}', pg_temp.id('owner'));
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select is(pg_temp.try(format($$insert into pg_temp.res select 'm10', private.provision_invited_member('a9000000-0000-4000-8000-00000000000a', %L, 'Persona Invitee Four')$$, pg_temp.id('invitee4'))), 'OK 1', 'R2-14: an owner invite from an active owner is provisioned');
select is(pg_temp.try(format($$insert into pg_temp.res select 'm11', private.provision_invited_member('a9000000-0000-4000-8000-00000000000b', %L, 'Persona Invitee Five')$$, pg_temp.id('invitee5'))), 'OK 1', 'R2-14: a second owner invite from the same owner is provisioned');
select pg_temp.as_sub(pg_temp.id('invitee5'), false);
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000035' and org_id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 1', 'R2-14: an owner invitation is accepted while its inviter is an active owner');
select pg_temp.op();
update public.memberships set roles = '{admin}' where org_id = pg_temp.id('A') and user_id = pg_temp.id('owner');
select pg_temp.as_sub(pg_temp.id('invitee4'), false);
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000034' and org_id = 'a1000000-0000-4000-8000-000000000001'$$), '42501 TRACE_GUARD: the inviter is no longer an active admin or owner', 'R2-14 (confirming re-review): an owner invitation cannot be accepted after its inviter lost the owner role, though still an active admin');
select pg_temp.op();
-- The inviter is an owner again before the removal, so only the status check can refuse (database review L1).
update public.memberships set roles = '{org_owner,admin}' where org_id = pg_temp.id('A') and user_id = pg_temp.id('owner');
update public.memberships set status = 'removed' where org_id = pg_temp.id('A') and user_id = pg_temp.id('owner');
select pg_temp.as_sub(pg_temp.id('invitee4'), false);
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000034' and org_id = 'a1000000-0000-4000-8000-000000000001'$$), '42501 TRACE_GUARD: the inviter is no longer an active admin or owner', 'R2-14 (confirming re-review): nor after its owner inviter was removed');
select pg_temp.op();
select is((select status::text from public.memberships where org_id = pg_temp.id('A') and user_id = pg_temp.id('invitee4')), 'invited', 'R2-14: the owner invitation stays unaccepted');
select * from finish();
rollback;
