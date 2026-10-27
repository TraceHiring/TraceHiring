-- rls_m2_invitations (spec specs/m2-scheduling-invites.md revision 5 §10 row rls_m2_invitations; §3.2 invitations; §3.3; §3.4 row invitations; §4 Invitation; I-M2-2, I-M2-5; M2-5, M2-18, R2-1, R2-15, R2-19, R3-3, R3-9, R4-4, R5-5, R5-11, R5-12, R5-17, R5-41, R5-42, R5-47, R5-48, R5-51, R5-64, R5-65, R5-66; AT-M2-03, AT-M2-04, AT-M2-17, AT-M2-27, AT-M2-28). RED first: written from the spec before migration M2-b. Synthetic data.
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
select plan(69);
-- Fixtures: ta = a 10x version (A1) and ta2 its newer version; drive ds (scheduled mode) with slots s1 (+48 h) and s2
-- (+72 h), scheduled; drive dw (open window, scheduled); drive dd (draft). Candidates c1 and c2 share phone p1.
select pg_temp.pooltv('ta', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.test_versions (org_id, test_id, total_time_seconds, quality_cutoff)
  values (pg_temp.id('A'), pg_temp.id('ta_test'), 1800, 40);
insert into pg_temp.ids select 'ta2', id from public.test_versions where test_id = pg_temp.id('ta_test') and version_no = 2;
select pg_temp.sec('ta2_s', 'ta2', 1, 'mcq', pg_temp.id('ta_pool'), 1, 100);
select pg_temp.preset('ta2', 'standard');
select pg_temp.publish('ta2');
select pg_temp.drive('ds', 'ta', 'scheduled');
select pg_temp.slot('s1', 'ds', 48, 5);
select pg_temp.slot('s2', 'ds', 72, 5);
update public.drives set status = 'scheduled' where id = pg_temp.id('ds');
select pg_temp.drive('dw', 'ta', 'open_window', 'scheduled');
select pg_temp.drive('dd', 'ta', 'open_window');
select pg_temp.cand('c1', pg_temp.id('A'), pg_temp.id('A1'), 'p1');
select pg_temp.cand('c2', pg_temp.id('A'), pg_temp.id('A1'), 'p1');
select pg_temp.cand('c' || n, pg_temp.id('A'), pg_temp.id('A1')) from generate_series(3, 9) as n;
insert into public.assignments (org_id, membership_id, scope, test_id, as_role)
  select m.org_id, m.id, 'test', pg_temp.id('ta_test'), 'reviewer'
  from public.memberships as m where m.org_id = pg_temp.id('A') and m.user_id = pg_temp.id('reviewer');
-- rinv(key, drive, slot, candidate, confirmed by): the INSERT a recruiter sends through ingest_invite_batch.
create function pg_temp.rinv(p_key text, p_drive text, p_slot text, p_cand text, p_conf uuid default null) returns text
language sql as $f$
  select pg_temp.try(format($s$insert into public.invitations (org_id, test_id, test_version_id, drive_id, slot_id, candidate_ref_id, link_token_hash, adult_confirmed_by_inviter, expires_at, shared_contact_confirmed_by) values (%L, %L, %L, %L, %L, %L, %L, true, now() + interval '1 hour', %L)$s$,
    pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'), pg_temp.id(p_drive), pg_temp.id(p_slot), pg_temp.id(p_cand),
    pg_temp.h('l-' || p_key), p_conf))
$f$;
grant execute on function pg_temp.rinv(text, text, text, text, uuid) to public;

-- ===== Insert rules (label trigger, R5-11) =====
select pg_temp.u('recruiter');
select is(pg_temp.rinv('i1', 'ds', 's1', 'c1'), 'OK 1', 'I recruiter: a drive invitation');
select pg_temp.op();
insert into pg_temp.ids select 'i1', id from public.invitations where link_token_hash = pg_temp.h('l-i1');
select is((select status::text || '|' || (expires_at = private.drive_end(org_id, drive_id) + interval '7 days')::text || '|' || (email_bidx = pg_temp.h('e-c1'))::text || '|' || (phone_bidx = pg_temp.h('p-p1'))::text || '|' || coalesce(session_grant_exp::text, 'null') || '|' || token_version || '|' || plan_no || '|' || self_reschedules_used || '|' || language from public.invitations where id = pg_temp.id('i1')), 'created|true|true|true|null|1|0|0|en', 'R5-11: expires_at = drive end + 7 days (client value ignored), blind indexes copied from the contact, session_grant_exp null, counters at their start');
select is((select expires_at from public.invitations where id = pg_temp.id('i1')), (select greatest(d.deadline_at, (select max(s.starts_at + make_interval(mins => s.start_window_minutes)) from public.slots as s where s.drive_id = d.id and s.status <> 'cancelled')) + interval '7 days' from public.drives as d where d.id = pg_temp.id('ds')), 'R5-51: drive end is the later of the deadline and the last slot''s window end');
select pg_temp.op();
select pg_temp.slot('s9', 'ds', 24 * 30 - 0.1, 5);
select is((select expires_at = (select s.starts_at + interval '15 minutes' + interval '7 days' from public.slots as s where s.id = pg_temp.id('s9')) from public.invitations where id = pg_temp.id('i1')), true, 'R5-51, R5-65 e: a slot whose window ends after the deadline moves expires_at forward (statement-level slots trigger)');
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$insert into public.invitations (org_id, test_id, test_version_id, drive_id, slot_id, candidate_ref_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values (%L, %L, %L, %L, %L, %L, 'm2-x@example.test', %L, true, now() + interval '1 day')$$, pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'), pg_temp.id('ds'), pg_temp.id('s1'), pg_temp.id('c3'), pg_temp.h('l-x1'))), '^23514', 'R5-17: a drive row has no plaintext contact_email');
select matches(pg_temp.try(format($$insert into public.invitations (org_id, test_id, test_version_id, drive_id, slot_id, link_token_hash, adult_confirmed_by_inviter, expires_at) values (%L, %L, %L, %L, %L, %L, true, now() + interval '1 day')$$, pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'), pg_temp.id('ds'), pg_temp.id('s1'), pg_temp.h('l-x2'))), '^23514', 'R2-1: a drive row needs its candidate link');
select matches(pg_temp.rinv('x3', 'ds', null, 'c3'), '^42501 TRACE_GUARD: a scheduled-mode drive invitation needs a slot', 'I: a scheduled-mode drive invitation names a slot');
select matches(pg_temp.rinv('x4', 'dd', null, 'c3'), '^42501 TRACE_GUARD: invitations need a scheduled drive', 'I: a draft drive takes no invitation');
select is(pg_temp.rinv('w1', 'dw', null, 'c3'), 'OK 1', 'I: an open-window drive invitation has no slot');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.rinv('x5', 'ds', 's1', 'c4'), '^42501', 'I ws_recruiter: refused outside its workspace');
select pg_temp.u('reviewer');
select matches(pg_temp.rinv('x6', 'ds', 's1', 'c4'), '^42501', 'I reviewer: refused');

-- ===== Email dedupe per drive (I-M2-2, AT-M2-03) =====
select pg_temp.u('recruiter');
select matches(pg_temp.rinv('x7', 'ds', 's2', 'c1'), '^23505', 'AT-M2-03: the same email cannot be invited twice to a drive');
select is(pg_temp.rinv('w2', 'dw', null, 'c1'), 'OK 1', 'E3: the same person may be invited to another drive of the workspace');

-- ===== Phone rule (M2-5, R2-15, AT-M2-04) =====
select matches(pg_temp.rinv('x8', 'ds', 's1', 'c2'), '^42501 TRACE_GUARD: phone shared with another candidate', 'AT-M2-04: a phone-only match with another email is held for confirmation');
select matches(pg_temp.rinv('x9', 'ds', 's1', 'c2', pg_temp.id('owner')), '^42501 TRACE_GUARD: the shared-contact confirmation names the caller', 'AT-M2-04: the confirmation must name the caller');
select is(pg_temp.rinv('i2', 'ds', 's1', 'c2', pg_temp.id('recruiter')), 'OK 1', 'AT-M2-04: allowed with the caller''s confirmation');
select pg_temp.op();
insert into pg_temp.ids select 'i2', id from public.invitations where link_token_hash = pg_temp.h('l-i2');
select is((select count(*)::int from public.audit_log where action = 'invitation.shared_contact_confirmed' and object_id = pg_temp.id('i2') and actor_user_id = pg_temp.id('recruiter')), 1, 'AT-M2-04: the confirmation is audited with the actor');

-- ===== Column grants (R3-9, R5-64 d, R5-66 d) =====
select pg_temp.u('recruiter');
select is((select count(*)::int from public.invitations where drive_id = pg_temp.id('ds')), 2, 'S recruiter: drive_id is selectable (R5-64 d)');
select matches(pg_temp.try('select email_bidx from public.invitations'), '^42501 permission denied', 'R3-9: email_bidx is outside the staff grant');
select matches(pg_temp.try('select candidate_ref_id from public.invitations'), '^42501 permission denied', 'R3-9: candidate_ref_id is outside the staff grant');
select matches(pg_temp.try('select shared_contact_confirmed_by from public.invitations'), '^42501 permission denied', 'R3-9: shared_contact_confirmed_by is outside the staff grant');
select matches(pg_temp.try(format($$update public.invitations set expires_at = now() + interval '90 days' where id = %L$$, pg_temp.id('i1'))), '^42501 permission denied', 'R5-42: no UPDATE grant on expires_at for staff');
select set_config('trace.drive_end_trigger', 'on', true);
select matches(pg_temp.try(format($$update public.invitations set expires_at = now() + interval '90 days' where id = %L$$, pg_temp.id('i1'))), '^42501 permission denied', 'R5-42: a custom setting changes nothing');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.invitations where test_id = pg_temp.id('ta_test')), 4, 'S reviewer: D1''s status read of the assigned test''s invitations still works');
select pg_temp.api(pg_temp.id('A'));
select is((select count(*)::int from public.invitations where drive_id = pg_temp.id('ds') and slot_id is not null and session_grant_exp is null), 2, 'S api (R5-66 d): drive_id, slot_id and session_grant_exp are selectable');
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$update public.invitations set token_version = 2 where id = %L$$, pg_temp.id('i1'))), '^42501 permission denied', 'R5-42: the messaging worker holds no UPDATE grant (rotation is DEFINER-only)');
select pg_temp.op();

-- ===== expires_at follows the drive end, forward only (R3-10, R5-42, R5-51, R5-65 c) =====
select matches(pg_temp.try(format($$update public.invitations set expires_at = expires_at + interval '1 day' where id = %L$$, pg_temp.id('i1'))), '^42501 TRACE_GUARD: invitation identity, pin, contact and inviter answer are immutable', 'R5-42: expires_at moves only to drive end + 7 days');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.drives set deadline_at = deadline_at + interval '10 days' where id = %L$$, pg_temp.id('ds'))), 'OK 1', 'R3-10: the recruiter extends the deadline');
select pg_temp.op();
select is((select bool_and(expires_at = private.drive_end(org_id, drive_id) + interval '7 days') from public.invitations where drive_id = pg_temp.id('ds')), true, 'R3-10: every live invitation of the drive follows the new end');
select is((select count(*)::int from public.audit_log where object_table = 'invitations' and action like 'invitation.%' and object_id = pg_temp.id('i1') and action <> 'invitation.create'), 0, 'R5-42: the follow-up move writes no invitation audit row');

-- ===== Version pin (I-M2-5, AT-M2-17) =====
select is((select bool_and(test_version_id = pg_temp.id('ta')) from public.invitations where drive_id = pg_temp.id('ds')), true, 'AT-M2-17: each invitation pins the drive''s default version at creation');
select matches(pg_temp.try(format($$update public.invitations set test_version_id = %L where id = %L$$, pg_temp.id('ta2'), pg_temp.id('w1'))), '^42501 TRACE_GUARD: invitation identity, pin, contact and inviter answer are immutable', 'AT-M2-17: the pin never changes');

-- ===== Staff moves and revokes (R3-3, R4-4, R5-12, R5-48) =====
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.invitations set slot_id = %L where id = %L$$, pg_temp.id('s2'), pg_temp.id('i1'))), 'OK 1', 'U recruiter: a created invitation moves to another slot');
select is((select plan_no::text || '|' || (select booked from public.slots where id = pg_temp.id('s1')) || '|' || (select booked from public.slots where id = pg_temp.id('s2')) from public.invitations where id = pg_temp.id('i1')), '1|1|1', 'R4-2, R2-15: plan_no +1 and the seat moves with the invitation');
select matches(pg_temp.try(format($$update public.invitations set plan_no = 7 where id = %L$$, pg_temp.id('i1'))), '^42501', 'U: plan_no is the guard''s');
-- i3: consented (otp_verified), no session yet; i4: session_id set with a live grant; i5: a grant that has passed.
select pg_temp.dinv('i3', 'ds', 's1', 'c3');
select pg_temp.dinv('i4', 'ds', 's1', 'c4');
select pg_temp.dinv('i5', 'ds', 's1', 'c5');
select pg_temp.dinv('i6', 'ds', 's1', 'c6');
select pg_temp.consent('i3');
select pg_temp.consent('i4');
select pg_temp.consent('i5');
select pg_temp.consent('i6');
select pg_temp.api(pg_temp.id('A'));
select is(pg_temp.try(format($$update public.invitations set session_id = gen_random_uuid() where id = %L$$, pg_temp.id('i4'))), 'OK 1', 'R5-41: trace_api sets session_id alone (D1 code)');
select is((select session_grant_exp between now() + interval '16199 seconds' and now() + interval '16201 seconds' from public.invitations where id = pg_temp.id('i4')), true, 'R5-41: the guard defaults session_grant_exp to now() + 16,200 s');
select is(pg_temp.try(format($$update public.invitations set session_id = gen_random_uuid(), session_grant_exp = now() - interval '1 minute' where id = %L$$, pg_temp.id('i5'))), 'OK 1', 'R5-66 a: an explicit session_grant_exp with session_id wins');
select matches(pg_temp.try(format($$update public.invitations set session_id = gen_random_uuid(), session_grant_exp = now() + interval '16300 seconds' where id = %L$$, pg_temp.id('i6'))), '^42501 TRACE_GUARD: session_grant_exp is past the cap', 'R5-65 e: an explicit value past now() + 16,200 s is refused');
select matches(pg_temp.try(format($$update public.invitations set session_grant_exp = now() where id = %L$$, pg_temp.id('i4'))), '^42501 TRACE_GUARD: session_grant_exp moves forward only', 'R5-5: session_grant_exp moves forward only');
select matches(pg_temp.try(format($$update public.invitations set session_grant_exp = now() + interval '1 hour' where id = %L$$, pg_temp.id('i3'))), '^42501 TRACE_GUARD: session_grant_exp needs the session id', 'R5-5: never before session_id');
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$update public.invitations set slot_id = %L where id = %L$$, pg_temp.id('s2'), pg_temp.id('i3'))), '^(42501|OK 0)', '§4: an otp_verified invitation is not moved by staff');
select is(pg_temp.try(format($$update public.invitations set status = 'revoked' where id = %L$$, pg_temp.id('i3'))), 'OK 1', 'R3-3: staff revoke a drive row from otp_verified (no session id)');
select matches(pg_temp.try(format($$update public.invitations set status = 'revoked' where id = %L$$, pg_temp.id('i4'))), '^42501 TRACE_GUARD: a live session grant blocks this change', 'R4-4, AT-M2-27: refused while now() <= session_grant_exp');
select is(pg_temp.try(format($$update public.invitations set status = 'revoked' where id = %L$$, pg_temp.id('i5'))), 'OK 1', 'R4-4, AT-M2-27: allowed after session_grant_exp with no sessions row');
select pg_temp.op();
select is((select count(*)::int from public.audit_log where action = 'invitation.revoke' and object_id = pg_temp.id('i5') and details ->> 'old_status' = 'otp_verified' and details ->> 'drive_id' = pg_temp.id('ds')::text), 1, 'R5-13: the revoke is audited with the old status and the drive id');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try(format($$update public.invitations set status = 'expired' where id = %L$$, pg_temp.id('i4'))), '^42501 TRACE_GUARD: a live session grant blocks this change', 'AT-M2-27: trace_api cannot expire while the grant lives');
select matches(pg_temp.try(format($$update public.invitations set slot_id = %L where id = %L$$, pg_temp.id('s2'), pg_temp.id('i4'))), '^42501', 'R5-12: trace_api moves a slot only with the self-reschedule counter (private.self_reschedule)');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$update public.invitations set status = 'expired' where id = %L$$, pg_temp.id('i4'))), '^42501 TRACE_GUARD: the mirror may only set submitted', 'R5-6: trace_worker cannot expire an invitation (no sweep)');
-- A sessions row blocks both, even after the grant (R4-4).
select pg_temp.api(pg_temp.id('A'));
update public.invitations set status = 'started', started_at = now() where id = pg_temp.id('i4');
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$update public.invitations set status = 'revoked' where id = %L$$, pg_temp.id('i4'))), '^(42501|OK 0)', 'AT-M2-27: a started invitation is never revoked');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try(format($$update public.invitations set status = 'expired' where id = %L$$, pg_temp.id('i4'))), '^42501', 'AT-M2-27: nor expired');

-- ===== D1 rows keep D1's rules (R5-48, AT-M2-28) =====
select pg_temp.session('d1s', 'ta', 1);
select pg_temp.op();
select is((select session_grant_exp is not null from public.invitations where session_id = pg_temp.id('d1s')), true, 'R5-41: a D1 row that sets session_id alone gets the default too, so the CHECK holds for old code');
select pg_temp.op();
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at)
  values ('42000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'), 'm2-d1b@example.test', pg_temp.h('l-d1b'), true, now() + interval '1 day');
insert into pg_temp.ids values ('d1b', '42000000-0000-4000-8000-000000000001');
select pg_temp.consent('d1b');
select pg_temp.api(pg_temp.id('A'));
update public.invitations set session_id = gen_random_uuid(), session_grant_exp = now() - interval '1 minute' where id = pg_temp.id('d1b');
select matches(pg_temp.try(format($$update public.invitations set status = 'expired' where id = %L$$, pg_temp.id('d1b'))), '^42501 TRACE_GUARD: an invitation with a session cannot expire', 'R5-48: a D1 row with a session id keeps L-32, whatever session_grant_exp says');
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$update public.invitations set status = 'revoked' where id = %L$$, pg_temp.id('d1b'))), '^(42501|OK 0)', 'R5-48: staff revoke a D1 row only from created or sent');

-- ===== The CHECK and the backfill (R5-5, R5-58 b, R5-64 c, R5-65 a) =====
select pg_temp.op();
alter table public.invitations disable trigger invitations_guard;
select matches(pg_temp.try(format($$update public.invitations set session_grant_exp = null where id = %L$$, pg_temp.id('d1b'))), '^23514', 'R5-64 c: the CHECK refuses session_id without session_grant_exp (guard off)');
alter table public.invitations drop constraint invitations_session_grant_exp_check;
update public.invitations set session_grant_exp = null where id in (pg_temp.id('d1b'), (select id from public.invitations where session_id = pg_temp.id('d1s')));
alter table public.invitations enable always trigger invitations_guard;
select is((select private.backfill_session_grant_exp()), 2, 'R5-65 a: the backfill fills the two rows with the guard enabled (submitted and otp_verified)');
select is((select session_grant_exp from public.invitations where session_id = pg_temp.id('d1s')), '2026-10-14 11:31:00+00'::timestamptz, 'R5-5: a row with a sessions row gets server deadline + 3,600 s');
select is((select session_grant_exp = (select c.occurred_at + interval '10800 seconds' from public.consents as c where c.invitation_id = pg_temp.id('d1b')) from public.invitations where id = pg_temp.id('d1b')), true, 'R5-5: a row without one gets consent time + 10,800 s');
select is((select tgenabled::text from pg_catalog.pg_trigger where tgrelid = 'public.invitations'::regclass and tgname = 'invitations_guard'), 'A', 'R5-65 a: the guard is ENABLE ALWAYS again');
alter table public.invitations add constraint invitations_session_grant_exp_check check (session_id is null or session_grant_exp is not null);
select is((select count(*)::int from unnest(array['authenticated', 'trace_api', 'trace_worker', 'trace_messaging_worker']) as r where has_function_privilege(r, 'private.backfill_session_grant_exp()', 'EXECUTE')), 0, 'R5-58 b: no app role may run the backfill');

-- ===== private functions for trace_api (R2-19, R5-47, R5-66 d) =====
select is((select proargnames::text from pg_proc where oid = 'private.resolve_invitation_by_hash(text)'::regprocedure), '{p_hash,org_id,id,status,candidate_id,session_id,started_at,test_id,test_version_id,expires_at,drive_id,slot_id,slot_starts_at,start_window_minutes,lobby_opens_minutes,self_reschedules_used}', 'R2-19: resolve is widened with the drive, the slot times and the reschedule counter (never contacts)');
select pg_temp.api(null);
select is((select drive_id::text || '|' || (slot_starts_at = (select starts_at from public.slots where id = pg_temp.id('s2')))::text || '|' || start_window_minutes || '|' || lobby_opens_minutes || '|' || self_reschedules_used from private.resolve_invitation_by_hash(pg_temp.h('l-i1'))), pg_temp.id('ds')::text || '|true|15|30|0', 'R2-19: resolve returns the current slot''s times');
select pg_temp.api(pg_temp.id('A'));
select is((select mode::text || '|' || (nb = (select starts_at from public.slots where id = pg_temp.id('s2')))::text || '|' || (na - nb = interval '15 minutes')::text || '|' || (nb - lobby_opens_at = interval '30 minutes')::text from private.invitation_window(pg_temp.id('i1'))), 'scheduled|true|true|true', 'R5-66 d: a scheduled row''s window is [starts_at, +15 min], lobby 30 min early');
select is((select mode::text || '|' || (na = drive_end)::text || '|' || (nb = lobby_opens_at)::text from private.invitation_window(pg_temp.id('w1'))), 'open_window|true|true', 'R5-66 d: an open-window row''s window is [opens_at, drive end]');
select is((select count(*)::int from private.invitation_window(pg_temp.id('d1b'))), 0, 'R5-66 d: a D1 row has no window');
select is((select email_ct = pg_temp.ct('e-c1') from private.invitation_recipient_ct(pg_temp.id('i1'))), true, 'R5-47: trace_api reads a drive row''s recipient ciphertext');
select is((select count(*)::int from private.invitation_recipient_ct(pg_temp.id('d1b'))), 0, 'R5-47: nothing for a D1 row');
select pg_temp.api(pg_temp.id('B'));
select is((select count(*)::int from private.invitation_window(pg_temp.id('i1'))) + (select count(*)::int from private.invitation_recipient_ct(pg_temp.id('i1'))), 0, 'R5-47, R5-66 d: bound to the api org');
select pg_temp.u('owner');
select matches(pg_temp.try(format($$select * from private.invitation_recipient_ct(%L)$$, pg_temp.id('i1'))), '^42501 permission denied', 'R5-47: no app role may call it');
select pg_temp.op();
select * from finish();
rollback;
