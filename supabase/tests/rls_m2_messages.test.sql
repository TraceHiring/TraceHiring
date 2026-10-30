-- rls_m2_messages (spec specs/m2-scheduling-invites.md revision 5 §10 row rls_m2_messages; §3.2 message_templates, outbound_messages, message_events, message_events_unmatched; §3.3; §3.4; §4 Outbound message; I-M2-6, I-M2-7; M2-13, M2-14, R2-4, R2-11, R2-14, R2-15, R2-16, R2-18, R2-21, R3-1, R3-5, R3-6, R4-2, R4-5, R4-6, R4-7, R5-7, R5-14, R5-32, R5-44, R5-45, R5-52 a; AT-M2-02, AT-M2-05, AT-M2-06, AT-M2-19, AT-M2-24, AT-M2-26, AT-M2-29). RED first: written from the spec before migration M2-c. Synthetic data.
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
grant execute on function pg_temp.pooltv(text, uuid, uuid, int), pg_temp.drive(text, text, text, text),
  pg_temp.slot(text, text, numeric, int), pg_temp.cand(text, uuid, uuid, text), pg_temp.dinv(text, text, text, text),
  pg_temp.consent(text), pg_temp.session(text, text, int) to public;
select plan(127);
-- Fixtures: ta = a 10x version (A1); drive ds (scheduled mode, slots s1 at +48 h, s2 at +72 h, s3 at +2 h; reminders
-- 24 h and 1 h); drive dw (open window, deadline +30 days); drive dx (scheduled mode, slot x1s at +48 h) for the cancel
-- case. Candidates c1 to c12 in A1. The reviewer persona is assigned to ta's test.
select pg_temp.pooltv('ta', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.drive('ds', 'ta', 'scheduled');
select pg_temp.slot('s1', 'ds', 48, 5);
select pg_temp.slot('s2', 'ds', 72, 5);
select pg_temp.slot('s3', 'ds', 2, 5);
update public.drives set status = 'scheduled' where id = pg_temp.id('ds');
select pg_temp.drive('dw', 'ta', 'open_window', 'scheduled');
select pg_temp.drive('dx', 'ta', 'scheduled');
select pg_temp.slot('x1s', 'dx', 48, 5);
update public.drives set status = 'scheduled' where id = pg_temp.id('dx');
select pg_temp.cand('c' || n, pg_temp.id('A'), pg_temp.id('A1')) from generate_series(1, 12) as n;
insert into public.assignments (org_id, membership_id, scope, test_id, as_role)
  select m.org_id, m.id, 'test', pg_temp.id('ta_test'), 'reviewer'
  from public.memberships as m where m.org_id = pg_temp.id('A') and m.user_id = pg_temp.id('reviewer');
-- plan(invitation): its messages as purpose:status in send order (read on the operator path).
create function pg_temp.plan(p_inv text) returns text language sql as $f$
  select coalesce(string_agg(m.purpose || ':' || m.status, ',' order by m.scheduled_for, m.purpose, m.idempotency_key), '')
  from public.outbound_messages as m where m.invitation_id = pg_temp.id(p_inv)
$f$;
-- claimed: what each claim returned. claim(p_now): the operator's claim (time travel); wclaim(p_now): the worker's.
create table pg_temp.claimed (org_id uuid, id uuid, claim_id uuid, reclaimed boolean, at timestamptz default clock_timestamp());
grant all on pg_temp.claimed to public;
create function pg_temp.claim(p_now timestamptz) returns int language plpgsql as $f$
declare v_n int;
begin
  perform pg_temp.op();
  insert into pg_temp.claimed (org_id, id, claim_id, reclaimed) select * from private.claim_due_messages(p_now, 1000);
  get diagnostics v_n = row_count;
  return v_n;
end
$f$;
create function pg_temp.wclaim(p_now timestamptz) returns int language plpgsql as $f$
declare v_n int;
begin
  perform pg_temp.w('trace_messaging_worker', null);
  insert into pg_temp.claimed (org_id, id, claim_id, reclaimed) select * from private.claim_due_messages(p_now, 1000);
  get diagnostics v_n = row_count;
  perform pg_temp.op();
  return v_n;
end
$f$;
-- msg(invitation, purpose): the invitation's first message of that purpose, a queued one first.
create function pg_temp.msg(p_inv text, p_purpose text) returns uuid language sql as $f$
  select m.id from public.outbound_messages as m where m.invitation_id = pg_temp.id(p_inv) and m.purpose = p_purpose
  order by (m.status = 'queued') desc, m.scheduled_for, m.id limit 1
$f$;
-- send(invitation, purpose, provider message id, claim): record_send as the worker of the message's org, with the
-- message's current claim unless one is given. fail(...): record_send_failure the same way.
create function pg_temp.send(p_inv text, p_purpose text, p_pmid text, p_claim uuid default null) returns text
language plpgsql as $f$
declare v_org uuid; v_id uuid; v_claim uuid; v_r boolean;
begin
  perform pg_temp.op();
  select m.org_id, m.id, coalesce(p_claim, m.claim_id) into v_org, v_id, v_claim
  from public.outbound_messages as m where m.id = pg_temp.msg(p_inv, p_purpose);
  perform pg_temp.w('trace_messaging_worker', v_org);
  v_r := private.record_send(v_org, v_id, v_claim, 'loadsim', p_pmid);
  perform pg_temp.op();
  return coalesce(v_r::text, 'null');
end
$f$;
create function pg_temp.fail(p_inv text, p_purpose text, p_code text, p_final boolean) returns text
language plpgsql as $f$
declare v_org uuid; v_id uuid; v_claim uuid; v_r text;
begin
  perform pg_temp.op();
  select m.org_id, m.id, m.claim_id into v_org, v_id, v_claim
  from public.outbound_messages as m where m.id = pg_temp.msg(p_inv, p_purpose);
  perform pg_temp.w('trace_messaging_worker', v_org);
  v_r := private.record_send_failure(v_org, v_id, v_claim, p_code, p_final);
  perform pg_temp.op();
  return coalesce(v_r, 'null');
end
$f$;
-- ev(provider message id, event id, event, bounce kind, tag org): record_message_event as trace_api (the webhook).
create function pg_temp.ev(p_pmid text, p_evid text, p_event text, p_bounce text, p_org uuid) returns text
language plpgsql as $f$
declare v_r text;
begin
  perform pg_temp.api(null);
  v_r := private.record_message_event('loadsim', p_evid, p_pmid, p_event, p_bounce, now(), p_org);
  perform pg_temp.op();
  return v_r;
end
$f$;
-- di(viewer, aal, amr): the drive list of ds through trace_api bound to org A, one page of 200.
create function pg_temp.di(p_viewer text, p_aal text, p_amr text[]) returns int language sql as $f$
  select count(*)::int from private.drive_invitations(pg_temp.id(p_viewer), p_aal, p_amr, pg_temp.id('ds'), null, null, 200)
$f$;
grant execute on function pg_temp.plan(text), pg_temp.claim(timestamptz), pg_temp.wclaim(timestamptz),
  pg_temp.msg(text, text), pg_temp.send(text, text, text, uuid), pg_temp.fail(text, text, text, boolean),
  pg_temp.ev(text, text, text, text, uuid), pg_temp.di(text, text, text[]) to public;

-- ===== Templates (R2-14, R5-32) =====
select pg_temp.op();
select is((select string_agg(t.purpose || ':' || t.channel || ':' || t.language || ':' || t.version, ',' order by t.purpose) from public.message_templates as t join public.orgs as o on o.id = t.org_id where o.kind = 'trace_library'), 'invite:email:en:1,otp:email:en:1,reminder:email:en:1,reschedule:email:en:1', 'R2-14: the seed is the four EN email templates of the library org');
select is((select string_agg(purpose || ':' || (body_template like '%{{invite_url}}%')::text, ',' order by purpose) from public.message_templates), 'invite:true,otp:false,reminder:false,reschedule:true', 'R2-4: invites and reschedules carry the link; reminders never do');
select is((select count(*)::int from public.message_templates where body_template ~* 'device' or subject_template ~* 'device'), 0, 'R5-32: no template uses the banned word');
select is((select (body_template like '%{{equipment_note}}%' and body_template like '%recorded%' and body_template like '%{{duration_minutes}}%' and body_template like '%{{starts_at_ist}}%')::text from public.message_templates where purpose = 'invite'), 'true', 'plan §3.2 step 1: the invite says the time, the duration, the equipment and what is recorded');
select is((select count(*)::int from public.message_templates where body_sha256 <> encode(sha256(convert_to(body_template, 'UTF8')), 'hex')), 0, 'R2-14: body_sha256 is the body''s hash');
select matches(pg_temp.try(format($$insert into public.message_templates (org_id, purpose, channel, language, version, subject_template, body_template, body_sha256) values (%L, 'invite', 'email', 'en', 9, 'S', 'Hello {{email}}', encode(sha256(convert_to('Hello {{email}}', 'UTF8')), 'hex'))$$, pg_temp.id('L'))), '^23514', 'R5-32: a template variable outside the list is refused');
select matches(pg_temp.try(format($$insert into public.message_templates (org_id, purpose, channel, language, version, subject_template, body_template, body_sha256) values (%L, 'invite', 'email', 'en', 9, 'S', 'Use any device', encode(sha256(convert_to('Use any device', 'UTF8')), 'hex'))$$, pg_temp.id('L'))), '^23514', 'R5-32: a template with the banned word is refused');
select matches(pg_temp.try($$update public.message_templates set version = 2 where purpose = 'invite'$$), '^42501 TRACE_GUARD: message templates are insert-once', '§3.2: templates are immutable');
select matches(pg_temp.try($$delete from public.message_templates where purpose = 'invite'$$), '^42501 TRACE_GUARD: message templates are insert-once', '§3.2: templates are never deleted');
select pg_temp.api(pg_temp.id('A'));
select is((select language || ':' || (subject_template is not null)::text from private.message_template('reminder', 'email', 'hi')), 'en:true', 'R2-14: a language without a template yet falls back to English');
select matches(pg_temp.try('select * from public.message_templates'), '^42501 permission denied', 'R2-14: trace_api reads templates only through message_template');
select pg_temp.u('owner');
select matches(pg_temp.try('select * from public.message_templates'), '^42501 permission denied', 'R2-14: no authenticated grant on message_templates');
select matches(pg_temp.try($$select * from private.message_template('invite', 'email', 'en')$$), '^42501 permission denied', 'R2-14: staff see previews through the api only');
select pg_temp.op();

-- ===== Planning on insert (R3-1, M2-13, AT-M2-05, AT-M2-06) =====
select pg_temp.dinv('i1', 'ds', 's1', 'c1');
select is(pg_temp.plan('i1'), 'invite:planned,reminder:planned,reminder:planned', 'R3-1: an insert plans the invite now and the drive''s two reminders');
select is((select string_agg(replace(m.idempotency_key, pg_temp.id('i1')::text, 'I'), ',' order by m.scheduled_for) from public.outbound_messages as m where m.invitation_id = pg_temp.id('i1') and m.purpose = 'invite'), 'I:invite:0', 'R3-1: the invite key is invitation:invite:resend_no');
select is((select array_agg(m.scheduled_for order by m.scheduled_for) from public.outbound_messages as m where m.invitation_id = pg_temp.id('i1') and m.purpose = 'reminder'), (select array[s.starts_at - interval '24 hours', s.starts_at - interval '1 hour'] from public.slots as s where s.id = pg_temp.id('s1')), 'AT-M2-05: reminders at T-24 h and T-1 h of the slot');
select is((select count(*)::int from public.outbound_messages as m where m.invitation_id = pg_temp.id('i1') and m.purpose = 'reminder' and m.idempotency_key = m.invitation_id::text || ':reminder:0:' || floor(extract(epoch from m.scheduled_for))::bigint), 2, 'R4-2: reminder keys are invitation:reminder:plan_no:epoch');
select is((select count(*)::int from public.outbound_messages where invitation_id = pg_temp.id('i1') and (claim_id is not null or provider is not null or attempts <> 0 or queued_at is not null)), 0, 'M2-13: planned rows carry no claim, provider or attempt');
select pg_temp.dinv('i3', 'ds', 's3', 'c3');
select is(pg_temp.plan('i3'), 'invite:planned,reminder:planned', 'E8: a reminder that would fall in the past (T-24 h of a slot 2 h away) is skipped');
select pg_temp.dinv('w1', 'dw', null, 'c4');
select is((select array_agg(m.scheduled_for order by m.scheduled_for) from public.outbound_messages as m where m.invitation_id = pg_temp.id('w1') and m.purpose = 'reminder'), (select array[d.deadline_at - interval '24 hours', d.deadline_at - interval '1 hour'] from public.drives as d where d.id = pg_temp.id('dw')), 'M2-13: open-window reminders anchor to the deadline');
update public.drives set reminder_offsets = '{2 hours}' where id = pg_temp.id('dw');
select pg_temp.dinv('w2', 'dw', null, 'c5');
select is((select array_agg(m.scheduled_for) from public.outbound_messages as m where m.invitation_id = pg_temp.id('w2') and m.purpose = 'reminder'), (select array[d.deadline_at - interval '2 hours'] from public.drives as d where d.id = pg_temp.id('dw')), 'AT-M2-06: the plan follows the drive''s offsets');
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at)
  values ('43000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'), 'm2-msg-d1@example.test', pg_temp.h('l-d1m'), true, now() + interval '1 day');
select is((select count(*)::int from public.outbound_messages where invitation_id = '43000000-0000-4000-8000-000000000001'), 0, 'R2-16: a D1 row (no drive) plans nothing');

-- ===== Claim and time travel (R2-16, AT-M2-05) =====
select is(pg_temp.claim(now()) >= 1, true, 'AT-M2-05: the claim at now takes the due invites');
select is(pg_temp.plan('i1'), 'invite:queued,reminder:planned,reminder:planned', 'AT-M2-05: nothing but the invite is claimed before T-24 h');
select is(pg_temp.send('i1', 'invite', 'pm-i1-inv'), 'true', 'R2-16: the worker records the send under its claim');
select is((select status::text from public.invitations where id = pg_temp.id('i1')), 'sent', 'R2-16: the drive invitation moves created -> sent');
select is((select status || '|' || provider || '|' || attempts || '|' || (sent_at is not null)::text from public.outbound_messages where id = pg_temp.msg('i1', 'invite')), 'sent|loadsim|1|true', 'R2-16: sent with the provider and its message id, one attempt');
select pg_temp.claim((select starts_at - interval '24 hours 1 minute' from public.slots where id = pg_temp.id('s1')));
select is(pg_temp.plan('i1'), 'invite:sent,reminder:planned,reminder:planned', 'AT-M2-05: a minute before T-24 h nothing more is claimed');
select pg_temp.claim((select starts_at - interval '24 hours' from public.slots where id = pg_temp.id('s1')));
select is(pg_temp.plan('i1'), 'invite:sent,reminder:queued,reminder:planned', 'AT-M2-05: the 24 h reminder is claimed at T-24 h');
select is(pg_temp.send('i1', 'reminder', 'pm-i1-r1'), 'true', 'AT-M2-05: and sent');
select is((select status::text from public.invitations where id = pg_temp.id('i1')), 'sent', 'R3-1: a reminder moves no invitation status');
select pg_temp.claim((select starts_at - interval '1 hour 1 minute' from public.slots where id = pg_temp.id('s1')));
select is(pg_temp.plan('i1'), 'invite:sent,reminder:sent,reminder:planned', 'AT-M2-05: a minute before T-1 h the second reminder waits');
select pg_temp.claim((select starts_at - interval '1 hour' from public.slots where id = pg_temp.id('s1')));
select is(pg_temp.plan('i1'), 'invite:sent,reminder:sent,reminder:queued', 'AT-M2-05: the 1 h reminder is claimed at T-1 h');
select pg_temp.dinv('i2', 'ds', 's2', 'c2');
select is(pg_temp.wclaim(now() + interval '30 days') >= 1, true, 'R2-8: the worker''s claim runs');
select is(pg_temp.plan('i2'), 'invite:queued,reminder:planned,reminder:planned', 'R2-8: p_now from a non-operator is ignored (now() is used)');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from private.claim_due_messages(now(), 10)'), '^42501 permission denied', 'R3-11: trace_api cannot claim');
select pg_temp.u('owner');
select matches(pg_temp.try('select * from private.claim_due_messages(now(), 10)'), '^42501 permission denied', 'R3-11: nor can staff');
select pg_temp.op();
select matches(pg_temp.try('select * from private.claim_due_messages(now(), 0)'), '^22023', 'R5-45: the claim limit is bounded');

-- ===== Reclaim and lease (R2-15, R3-6, R4-7, AT-M2-26) =====
insert into pg_temp.ids select 'i2_claim1', claim_id from public.outbound_messages where id = pg_temp.msg('i2', 'invite');
select pg_temp.claim(now() + interval '16 minutes');
select is((select claim_id <> pg_temp.id('i2_claim1') and status = 'queued' from public.outbound_messages where id = pg_temp.msg('i2', 'invite')), true, 'R2-15, R3-6: a queued row older than 15 minutes is reclaimed with a new claim id');
select is((select reclaimed from pg_temp.claimed where id = pg_temp.msg('i2', 'invite') order by at desc limit 1), true, 'R4-7: the claim reports the reclaim');
select is(pg_temp.send('i2', 'invite', 'pm-i2-old', pg_temp.id('i2_claim1')), 'false', 'AT-M2-26: the old claim cannot record the send');
select is((select status from public.outbound_messages where id = pg_temp.msg('i2', 'invite')), 'queued', 'AT-M2-26: nothing changed');
insert into pg_temp.ids select 'i2_claim2', claim_id from public.outbound_messages where id = pg_temp.msg('i2', 'invite');
select is(pg_temp.send('i2', 'invite', 'pm-i2'), 'true', 'AT-M2-26: the current claim records it');
select is(pg_temp.send('i2', 'invite', 'pm-i2-dup', pg_temp.id('i2_claim2')), 'false', 'E17: a second delivery of the same queue message records nothing');
select is((select provider_message_id || '|' || attempts from public.outbound_messages where id = pg_temp.msg('i2', 'invite')), 'pm-i2|1', 'E17: one provider id, one attempt');

-- ===== Provider events (R2-15, R2-18, R3-5, R4-6, AT-M2-26) =====
select is(pg_temp.ev('pm-i1-inv', 'ev-1', 'delivery', null, null), 'applied', 'R2-18: an event finds its message by the provider id, with no org context');
select is((select status || '|' || (delivered_at is not null)::text from public.outbound_messages where id = pg_temp.msg('i1', 'invite')), 'delivered|true', 'M2-14: delivered');
select is(pg_temp.ev('pm-i1-inv', 'ev-1', 'delivery', null, null), 'duplicate', 'E15: a replayed event is a no-op');
select is((select count(*)::int from public.message_events where provider_event_id = 'ev-1'), 1, 'E15: stored once');
select is(pg_temp.ev('pm-i1-inv', 'ev-2', 'send', null, null), 'applied', 'R2-15: a late send event is stored');
select is((select status from public.outbound_messages where id = pg_temp.msg('i1', 'invite')), 'delivered', 'R2-15: a lower rank never moves the status back');
select is(pg_temp.ev('pm-i1-inv', 'ev-3', 'bounce', 'permanent', null), 'applied', 'R2-15: a bounce after delivery is stored');
select is((select status from public.outbound_messages where id = pg_temp.msg('i1', 'invite')), 'delivered', 'R2-15: an equal rank is ignored');
select is(pg_temp.ev('pm-i1-inv', 'ev-4', 'complaint', null, null), 'applied', 'R2-15: a complaint is stored');
select is((select status from public.outbound_messages where id = pg_temp.msg('i1', 'invite')), 'complained', 'R2-15: a complaint after delivery is accepted');
select is(pg_temp.ev('pm-i1-r1', 'ev-4b', 'bounce', 'transient', null), 'applied', 'R2-15: a transient bounce is stored');
select is((select status from public.outbound_messages where invitation_id = pg_temp.id('i1') and provider_message_id = 'pm-i1-r1'), 'sent', 'R2-15: a transient bounce moves nothing');
select is(pg_temp.ev('pm-early', 'ev-5', 'delivery', null, pg_temp.id('A')), 'unmatched', 'R3-5: an event before the send is kept under its tag org');
select is(pg_temp.ev('pm-untagged', 'ev-6', 'delivery', null, null), 'dropped', 'R4-6: an unknown event without the org tag is dropped');
select is((select count(*)::int from public.message_events_unmatched where provider_message_id = 'pm-early' and org_id = pg_temp.id('A')), 1, 'R3-5: the unmatched row has the org');
select is(pg_temp.send('i3', 'invite', 'pm-early'), 'true', 'R3-5: the send is recorded');
select is((select status from public.outbound_messages where id = pg_temp.msg('i3', 'invite')) || '|' || (select count(*) from public.message_events_unmatched where provider_message_id = 'pm-early') || '|' || (select count(*) from public.message_events where provider_event_id = 'ev-5'), 'delivered|0|1', 'R3-5, AT-M2-26: record_send reconciles the early event and removes it');
select pg_temp.w('trace_messaging_worker', pg_temp.id('B'));
select matches(pg_temp.try($$select private.record_message_event('loadsim', 'ev-7', 'pm-i1-inv', 'delivery', null, now(), null)$$), '^42501 TRACE_GUARD: not the job org', 'R2-18: the worker records events of its job org only');
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select is((select private.record_message_event('loadsim', 'ev-8', 'pm-i2', 'delivery', null, now(), pg_temp.id('A'))), 'applied', 'M2-1: the load-sim adapter''s events go through the same function as the worker');
select pg_temp.api(null);
select matches(pg_temp.try($$select private.record_message_event('loadsim', 'ev-9', 'pm-i2', 'open', null, now(), null)$$), '^22023', 'R2-18: an event kind outside the list is refused');
select matches(pg_temp.try($$select private.record_message_event('loadsim', 'ev-9', 'pm-i2', 'bounce', null, now(), null)$$), '^22023', 'R2-18: a bounce names its kind');
select pg_temp.u('owner');
select matches(pg_temp.try($$select private.record_message_event('loadsim', 'ev-9', 'pm-i2', 'delivery', null, now(), null)$$), '^42501 permission denied', 'R3-11: staff cannot record provider events');
select pg_temp.op();
insert into public.message_events_unmatched (org_id, provider, provider_event_id, provider_message_id, event, occurred_at, received_at)
  values (pg_temp.id('A'), 'loadsim', 'ev-old', 'pm-old', 'delivery', now() - interval '25 hours', now() - interval '25 hours'),
         (pg_temp.id('A'), 'loadsim', 'ev-new', 'pm-new', 'delivery', now(), now());
select pg_temp.w('trace_messaging_worker', null);
select is((select private.purge_unmatched_events()), 1, 'R3-5, R5-45: the purge deletes unmatched events older than 24 h only');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select private.purge_unmatched_events()'), '^42501 permission denied', 'R5-45: only the messaging worker purges');
select pg_temp.op();

-- ===== Failures (AT-M2-24, AT-M2-30 database side) =====
select pg_temp.dinv('i4', 'ds', 's1', 'c6');
select pg_temp.dinv('i5', 'ds', 's1', 'c7');
select pg_temp.claim(now() + interval '20 minutes');
select is(pg_temp.fail('i4', 'invite', 'throttled', false), 'queued', 'AT-M2-30: a transient failure keeps the row queued for the Queue''s retry');
select is((select attempts || '|' || last_error_code from public.outbound_messages where id = pg_temp.msg('i4', 'invite')), '1|throttled', 'AT-M2-30: the attempt and its code are counted');
select is(pg_temp.fail('i4', 'invite', 'bad_recipient', true), 'failed', 'AT-M2-24: a permanent error fails the message');
select is((select count(*)::int from public.audit_log where action = 'message.failed' and object_id = pg_temp.msg('i4', 'invite') and actor_kind = 'system' and details ->> 'error_code' = 'bad_recipient'), 1, 'R2-21, AT-M2-24: the failure is audited as the system with its code');
select is(pg_temp.fail('i4', 'invite', 'throttled', false), 'null', 'R3-6: a failed message holds no claim any more');
select is((select string_agg(x.r, ',' order by x.n) from (select n, pg_temp.fail('i5', 'invite', 'provider_unavailable', false) as r from generate_series(1, 8) as n) as x),'queued,queued,queued,queued,queued,queued,queued,failed', 'AT-M2-30: the 8th failed attempt fails the message');
insert into pg_temp.ids select 'i5_msg', pg_temp.msg('i5', 'invite');
select matches(pg_temp.try(format($$select private.record_send_failure(%L, %L, %L, 'oops', false)$$, pg_temp.id('A'), pg_temp.id('i5_msg'), gen_random_uuid())), '^42501', 'the failure path runs as the messaging worker only');
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$select private.record_send_failure(%L, %L, %L, 'oops', false)$$, pg_temp.id('A'), pg_temp.id('i5_msg'), gen_random_uuid())), '^22023', 'error codes come from the list');
select pg_temp.op();

-- ===== Slot moves, revoke, resend and drive cancel (R3-1, R4-2, §4, E9, E24) =====
select pg_temp.dinv('i6', 'ds', 's1', 'c8');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$select public.reschedule_invitation(%L, %L)$$, pg_temp.id('i6'), pg_temp.id('s2'))), 'OK 1', 'E9: the recruiter moves the invitation to s2');
select pg_temp.op();
select is(pg_temp.plan('i6'), 'invite:planned,reschedule:planned,reminder:cancelled,reminder:cancelled,reminder:planned,reminder:planned', 'E9, R3-1: the old reminders are cancelled, new ones planned, one reschedule message');
select is((select count(*)::int from public.outbound_messages as m join public.reschedule_events as e on m.idempotency_key = m.invitation_id::text || ':reschedule:' || e.id::text where m.invitation_id = pg_temp.id('i6')), 1, 'R3-1: the reschedule key names the reschedule event');
select is((select count(*)::int from public.outbound_messages where invitation_id = pg_temp.id('i6') and status = 'planned' and idempotency_key like '%:reminder:1:%'), 2, 'R4-2: the new reminders carry plan_no 1');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$select public.reschedule_invitation(%L, %L)$$, pg_temp.id('i6'), pg_temp.id('s1'))), 'OK 1', 'R4-2: and back to s1');
select pg_temp.op();
select is((select count(*) filter (where purpose = 'reminder' and status = 'planned' and idempotency_key like '%:reminder:2:%') || '|' || count(*) filter (where purpose = 'reminder' and status = 'cancelled') || '|' || count(*) filter (where purpose = 'reschedule') from public.outbound_messages where invitation_id = pg_temp.id('i6')), '2|4|2', 'AT-M2-05, R4-2: A -> B -> A plans fresh reminders; none is lost to an old key');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.invitations set status = 'revoked' where id = %L$$, pg_temp.id('i6'))), 'OK 1', '§4: the recruiter revokes i6');
select pg_temp.op();
select is((select count(*)::int from public.outbound_messages where invitation_id = pg_temp.id('i6') and status = 'planned'), 0, 'R3-1: a revoke cancels every planned message');
select pg_temp.dinv('i7', 'ds', 's1', 'c9');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.invitations set invite_resend_no = 1 where id = %L$$, pg_temp.id('i7'))), 'OK 1', 'R2-4: "Resend invite" bumps the counter');
select pg_temp.op();
select is((select string_agg(replace(idempotency_key, pg_temp.id('i7')::text, 'I'), ',' order by idempotency_key) from public.outbound_messages where invitation_id = pg_temp.id('i7') and purpose = 'invite'), 'I:invite:0,I:invite:1', 'R3-1: the resend plans a new invite under the new key');
select pg_temp.dinv('x1', 'dx', 'x1s', 'c10');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.drives set status = 'cancelled' where id = %L$$, pg_temp.id('dx'))), 'OK 1', '§4: the recruiter cancels drive dx');
select pg_temp.op();
select is((select (select status::text from public.invitations where id = pg_temp.id('x1')) || '|' || pg_temp.plan('x1')), 'created|invite:cancelled,reminder:cancelled,reminder:cancelled', 'E24: a cancelled drive cancels its planned messages; the invitation stays as it is');

-- ===== Guard (I-M2-6) =====
select matches(pg_temp.try(format($$update public.outbound_messages set status = 'queued' where id = %L$$, pg_temp.msg('i1', 'invite'))), '^42501 TRACE_GUARD: message status moves forward only', 'I-M2-6: status moves forward only, even for the owner');
select matches(pg_temp.try(format($$update public.outbound_messages set status = 'cancelled' where id = %L$$, pg_temp.msg('i2', 'invite'))), '^42501 TRACE_GUARD: only a planned message is cancelled', '§4: only a planned message is cancelled');
select matches(pg_temp.try(format($$update public.outbound_messages set idempotency_key = idempotency_key || 'x' where id = %L$$, pg_temp.msg('i1', 'invite'))), '^42501 TRACE_GUARD: an outbound message keeps its identity', 'I-M2-6: the key is immutable');
select matches(pg_temp.try(format($$delete from public.outbound_messages where id = %L$$, pg_temp.msg('i1', 'invite'))), '^42501 TRACE_GUARD: outbound messages are never deleted', 'I-M2-6: never deleted');
select matches(pg_temp.try($$update public.message_events set event = 'send' where provider_event_id = 'ev-1'$$), '^P0001 TRACE_APPEND_ONLY', 'I-M2-7: message events are append-only');
select matches(pg_temp.try($$delete from public.message_events where provider_event_id = 'ev-1'$$), '^P0001 TRACE_APPEND_ONLY', 'I-M2-7: and never deleted');
select is((select workspace_id from public.message_events where provider_event_id = 'ev-1'), pg_temp.id('A1'), 'R5-4: the event''s workspace is copied from its message');

-- ===== Reads (§3.4, R2-11, AT-M2-19) =====
select pg_temp.u('owner');
select is((select count(*) > 0 from public.outbound_messages) and (select count(*) > 0 from public.message_events), true, 'S owner: the org''s messages and events');
select pg_temp.u('recruiter');
select is((select count(*) > 0 from public.outbound_messages), true, 'S recruiter: the workspace''s messages');
select matches(pg_temp.try(format($$insert into public.outbound_messages (org_id, workspace_id, drive_id, invitation_id, template_id, channel, purpose, idempotency_key, scheduled_for) select org_id, workspace_id, drive_id, invitation_id, template_id, channel, purpose, invitation_id || ':invite:9', now() from public.outbound_messages where id = %L$$, pg_temp.msg('i1', 'invite'))), '^42501 permission denied', 'I recruiter: messages are planned by the trigger only');
select matches(pg_temp.try($$update public.outbound_messages set attempts = 0$$), '^42501 permission denied', 'U recruiter: no update grant');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.outbound_messages) + (select count(*)::int from public.message_events), 0, 'S ws_recruiter: nothing outside its workspace');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.outbound_messages) + (select count(*)::int from public.message_events), 0, 'R2-11: an assigned reviewer reads no message');
select pg_temp.u('hm');
select is((select count(*)::int from public.outbound_messages), 0, 'S hiring manager: nothing');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.outbound_messages) + (select count(*)::int from public.message_events), 0, 'S org B admin: nothing of org A');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.outbound_messages'), '^42501 permission denied', 'S api: no grant on outbound_messages');
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.outbound_messages'), '^42501 permission denied', 'lead decision (a): the worker reads messages only through its functions');
select matches(pg_temp.try('select email_ct from public.candidate_contacts'), '^42501 permission denied', 'M2-20: the worker has no direct read of contacts');
select pg_temp.op();
select is((select count(*)::int from unnest(array['authenticated', 'trace_api', 'trace_messaging_worker', 'trace_worker', 'trace_candidate', 'anon', 'service_role']) as r cross join unnest(array['public.message_events_unmatched', 'public.message_templates']) as t where has_table_privilege(r, t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege(r, t, 'SELECT, INSERT, UPDATE, REFERENCES')), 0, 'R5-14, R5-45, R2-14: no role holds anything on message_events_unmatched or message_templates');
select is((select count(*)::int from pg_catalog.pg_attribute where attrelid in ('public.outbound_messages'::regclass, 'public.message_events'::regclass, 'public.message_events_unmatched'::regclass) and attnum > 0 and not attisdropped and attname ~ '(body|subject|recipient|otp|token|email|phone|name|address|payload|diagnostic)'), 0, 'M2-14, AT-M2-19: no column holds a body, subject, recipient, OTP, token or provider payload');
select is((select count(*)::int from public.audit_log where action = 'message.sent' and actor_kind = 'system' and pg_temp.keys(details) = 'invitation_id,old_status,purpose'), 4, 'R2-21: each recorded send is audited as the system with ids and statuses only');

-- ===== The worker's send context (lead decision a) =====
select pg_temp.op();
insert into pg_temp.ids select 'i3_rem', id from public.outbound_messages where invitation_id = pg_temp.id('i3') and purpose = 'reminder';
insert into pg_temp.ids select 'i3_rem_claim', claim_id from public.outbound_messages where invitation_id = pg_temp.id('i3') and purpose = 'reminder';
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select is((select (email_ct = pg_temp.ct('e-c3') and full_name_ct = pg_temp.ct('n-c3') and test_name = 'Test ta' and duration_seconds = 1800 and purpose = 'reminder' and invitation_status = 'sent' and drive_mode = 'scheduled')::text from private.message_send_context(pg_temp.id('A'), pg_temp.id('i3_rem'), pg_temp.id('i3_rem_claim'))), 'true', 'lead decision (a): the claimed message''s render facts and recipient ciphertext');
select is((select count(*)::int from private.message_send_context(pg_temp.id('A'), pg_temp.id('i3_rem'), gen_random_uuid())), 0, 'R3-6: nothing without the current claim');
select pg_temp.w('trace_messaging_worker', pg_temp.id('B'));
select matches(pg_temp.try(format($$select * from private.message_send_context(%L, %L, %L)$$, pg_temp.id('A'), pg_temp.id('i3_rem'), pg_temp.id('i3_rem_claim'))), '^42501 TRACE_GUARD: not the job org', 'R5-9: bound to the job org');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try(format($$select * from private.message_send_context(%L, %L, %L)$$, pg_temp.id('A'), pg_temp.id('i3_rem'), pg_temp.id('i3_rem_claim'))), '^42501 permission denied', 'only the messaging worker may read a send context');

-- ===== Drive invitation list (R4-5, R5-7, R5-44, R5-52 a; AT-M2-02, AT-M2-29) =====
select pg_temp.api(pg_temp.id('A'));
select is(pg_temp.di('owner', 'aal2', array['otp', 'totp']), 7, 'AT-M2-02: an owner at aal2 lists the drive''s seven invitations');
select is(pg_temp.di('recruiter', 'aal1', array['otp']), 7, 'R5-7: a recruiter-only member at aal1 after an email OTP counts');
select is(pg_temp.di('owner', 'aal1', array['otp']), 0, 'R5-7: an owner without MFA does not');
select is(pg_temp.di('ws_recruiter', 'aal1', array['otp']), 0, 'R4-5: a recruiter fenced to another workspace gets nothing');
select is(pg_temp.di('reviewer', 'aal2', array['otp', 'totp']), 0, 'R2-11: an assigned reviewer gets nothing');
select is(pg_temp.di('b_admin', 'aal2', array['otp', 'totp']), 0, 'R4-5: a member of another org gets nothing');
select is((select invite_status || '|' || coalesce(reminder_status, 'none') || '|' || coalesce(reschedule_status, 'none') || '|' || (full_name_ct = pg_temp.ct('n-c1'))::text || '|' || email_hint from private.drive_invitations(pg_temp.id('owner'), 'aal2', array['otp', 'totp'], pg_temp.id('ds'), null, null, 200) where invitation_id = pg_temp.id('i1')), 'complained|queued|none|true|c•••@example.test', 'AT-M2-02: the latest delivery status per purpose, the name ciphertext and the hint');
select is((select array_agg(x.invitation_id order by x.created_at, x.invitation_id) from (select * from private.drive_invitations(pg_temp.id('owner'), 'aal2', array['otp', 'totp'], pg_temp.id('ds'), null, null, 3) union all select * from private.drive_invitations(pg_temp.id('owner'), 'aal2', array['otp', 'totp'], pg_temp.id('ds'), (select max(created_at) from private.drive_invitations(pg_temp.id('owner'), 'aal2', array['otp', 'totp'], pg_temp.id('ds'), null, null, 3)), (select invitation_id from private.drive_invitations(pg_temp.id('owner'), 'aal2', array['otp', 'totp'], pg_temp.id('ds'), null, null, 3) order by created_at desc, invitation_id desc limit 1), 200)) as x), (select array_agg(invitation_id order by created_at, invitation_id) from private.drive_invitations(pg_temp.id('owner'), 'aal2', array['otp', 'totp'], pg_temp.id('ds'), null, null, 200)), 'AT-M2-29: a keyset page on (created_at, id) returns every row once across pages');
select matches(pg_temp.try(format($$select * from private.drive_invitations(%L, 'aal2', array['otp', 'totp'], %L, now(), null, 10)$$, pg_temp.id('owner'), pg_temp.id('ds'))), '^22023', 'R5-44: the cursor has both parts');
select matches(pg_temp.try(format($$select * from private.drive_invitations(%L, 'aal2', array['otp', 'totp'], %L, null, null, 500)$$, pg_temp.id('owner'), pg_temp.id('ds'))), '^22023', 'R5-31: a page holds at most 200 rows');
select pg_temp.api(pg_temp.id('B'));
select is(pg_temp.di('owner', 'aal2', array['otp', 'totp']), 0, 'R4-5: bound to the api org');
select pg_temp.op();
select is((select count(*)::int from unnest(array['authenticated', 'trace_messaging_worker', 'trace_worker', 'trace_candidate', 'anon', 'service_role']) as r where has_function_privilege(r, 'private.drive_invitations(uuid, text, text[], uuid, timestamptz, uuid, int)', 'EXECUTE')), 0, 'R4-5: only trace_api executes drive_invitations');
select is((select relrowsecurity::text from pg_catalog.pg_class where oid = 'public.outbound_messages'::regclass) || (select relrowsecurity::text from pg_catalog.pg_class where oid = 'public.message_events'::regclass) || (select relrowsecurity::text from pg_catalog.pg_class where oid = 'public.message_events_unmatched'::regclass) || (select relrowsecurity::text from pg_catalog.pg_class where oid = 'public.message_templates'::regclass), 'truetruetruetrue', 'RLS: enabled on every M2-c table');
select * from finish();
rollback;
