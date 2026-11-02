-- rls_d1_responses (spec specs/d1-demo-slice.md §3.6 row "rls_d1_responses"; §3.2 responses, session_items; §3.3 note 3; I-1, I-2 column scans). RED first: written from the spec, targets migration <ts2>_d1_invites_sessions.sql (migration 2) on top of
-- migration 1 (authoring) and, where NOTES.md says so, migration 3 (L-8 trigger and org seed). Personas are synthetic (p-<persona>@example.test); no PII.
-- try() returns 'OK <rows>' or '<sqlstate> <message>'.
begin;
-- Helpers live in pg_temp (rolled back with the transaction). try() runs one statement as the current
-- role and returns 'OK <rows>' or '<sqlstate> <message>', so a denial is an assertion, not an abort.
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
grant usage on schema extensions to authenticated, anon, service_role;
select plan(67);
grant trace_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_worker;
grant trace_quality_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_quality_worker;
grant trace_integrity_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_integrity_worker;
grant trace_api to postgres with inherit false, set true;
grant usage on schema extensions to trace_api;
grant trace_candidate to postgres with inherit false, set true;
grant usage on schema extensions to trace_candidate;
grant trace_candidate_gateway to postgres with inherit false, set true;
grant usage on schema extensions to trace_candidate_gateway;
-- ruleset / notice ids of a test version are set by the L-8 trigger (migration 3); fixtures read them through these
-- operator-owned helpers (the workers and trace_api cannot read test_versions freely).
create function pg_temp.rs(p_v uuid) returns uuid language sql security definer as $f$
  select ruleset_version_id from public.test_versions where id = p_v
$f$;
grant execute on function pg_temp.rs(uuid) to public;
create function pg_temp.nt(p_v uuid) returns uuid language sql security definer as $f$
  select notice_version_id from public.test_versions where id = p_v
$f$;
grant execute on function pg_temp.nt(uuid) to public;

-- D1-M1-SHIM (remove when migration 3 lands): stands in for migration 3's L-8 trigger, which pins a new
-- ruleset row and the org notice on every draft insert (spec §3.1 row 3, L-8, L-34). It is created only
-- while integrity.band_rule_versions does not exist, inside this rolled-back transaction, so publish paths
-- can be exercised against migration 1 alone. Same trigger name as planned for L-8 (sorts after the guard).
do $shim$
begin
  if to_regclass('integrity.band_rule_versions') is null then
    create function private.d1_m1_shim_pin() returns trigger
    language plpgsql security definer set search_path = '' as $f$
    declare
      v_notice uuid;
      v_rs uuid;
    begin
      select n.id into v_notice from public.notice_versions as n
      where n.org_id = new.org_id and n.notice_key = 'd1-m1-shim' and n.version = 1;
      if v_notice is null then
        insert into public.notice_versions (org_id, notice_key, version, language, body_template, template_sha256)
        values (new.org_id, 'd1-m1-shim', 1, 'en', 'Synthetic notice body.', repeat('0', 64))
        returning id into v_notice;
      end if;
      insert into public.ruleset_versions (org_id, workspace_id, test_id, version_no, band_rule_version_id, signal_settings)
      values (new.org_id, new.workspace_id, new.test_id, new.version_no, gen_random_uuid(),
        '{"paste":{"enabled":true},"drop":{"enabled":true},"untrusted_input":{"enabled":true},'
        '"tab_hidden":{"enabled":true},"fullscreen_exit":{"enabled":true}}'::jsonb)
      returning id into v_rs;
      new.ruleset_version_id := v_rs;
      new.notice_version_id := v_notice;
      return new;
    end
    $f$;
    create trigger test_versions_ruleset_seed before insert on public.test_versions
      for each row execute function private.d1_m1_shim_pin();
  end if;
end
$shim$;

-- Personas: synthetic users, fixed ids, created on the operator path (postgres, no claims).
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p-owner-admin@example.test'),
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'p-admin@example.test'),
  ('00000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'p-recruiter-otp@example.test'),
  ('00000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'p-recruiter-pw-aal1@example.test'),
  ('00000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'p-reviewer-asg@example.test'),
  ('00000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'p-hm@example.test'),
  ('00000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'p-ws-recruiter@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'p-removed@example.test'),
  ('00000000-0000-4000-8000-00000000000c', 'authenticated', 'authenticated', 'p-suspended@example.test'),
  ('00000000-0000-4000-8000-00000000000e', 'authenticated', 'authenticated', 'p-b-admin@example.test'),
  ('00000000-0000-4000-8000-000000000014', 'authenticated', 'authenticated', 'p-reviewer-other@example.test');
insert into public.orgs (id, kind, name, slug) values
  ('a1000000-0000-4000-8000-000000000001', 'customer', 'Org A', 'org-a-test'),
  ('a1000000-0000-4000-8000-000000000003', 'customer', 'Org B', 'org-b-test');
insert into public.workspaces (id, org_id, name, kind, is_default) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Default', 'default', true),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Client A2', 'client', false),
  ('b1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000003', 'Default', 'default', true);
insert into public.memberships (org_id, user_id, roles, workspace_id, display_name, status) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '{org_owner,admin}', null, 'Persona Owner Admin', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '{admin}', null, 'Persona Admin', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', '{recruiter}', null, 'Persona Recruiter Otp', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', '{recruiter}', null, 'Persona Recruiter Pw', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', '{reviewer}', null, 'Persona Reviewer Assigned', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000014', '{reviewer}', null, 'Persona Reviewer Other', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000008', '{hiring_manager}', null, 'Persona Hiring Manager', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000009', '{recruiter}', 'b1000000-0000-4000-8000-000000000002', 'Persona Ws Recruiter', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', '{recruiter}', null, 'Persona Removed', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000c', '{recruiter}', null, 'Persona Suspended', 'active'),
  ('a1000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000e', '{org_owner,admin}', null, 'Persona B Admin', 'active');
update public.memberships set status = 'removed' where user_id = '00000000-0000-4000-8000-00000000000b';
update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-00000000000c';

-- Authoring fixtures on the operator path (migration 1; publishing needs the L-8 trigger and the org seed of migration 3).
-- T1 (ws A1, owner), T2 (ws A2, ws recruiter), T3 (ws A1, retired version), TB (org B). Versions V1/V2/V3/VB are published below;
-- V3 is then retired; V1D is a second (draft) version of T1. Only org_id, parents and content are supplied.
insert into public.tests (id, org_id, workspace_id, name, created_by) values
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test One', '00000000-0000-4000-8000-000000000001'),
  ('e1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'Test Two', '00000000-0000-4000-8000-000000000009'),
  ('e1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test Three', '00000000-0000-4000-8000-000000000005'),
  ('e1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 'Test B', '00000000-0000-4000-8000-00000000000e');
insert into public.rubric_versions (id, org_id, rubric_key, version_no, criteria, content_sha256, created_by) values
  ('71000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'writing-basic', 1,
   '[{"id": "c1", "label": "Clarity", "max_points": 5, "anchors": []}]', repeat('a', 64), '00000000-0000-4000-8000-000000000001');
insert into public.test_versions (id, org_id, test_id, version_no, total_time_seconds, quality_cutoff, created_by) values
  ('f1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 1, 1800, 40, '00000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 1, 1800, 40, '00000000-0000-4000-8000-000000000009'),
  ('f1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', 1, 1800, 40, '00000000-0000-4000-8000-000000000005'),
  ('f1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 1, 1800, 40, '00000000-0000-4000-8000-00000000000e');
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 1, 'Choices', 'mcq', 1),
  ('51000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 2, 'Writing', 'written', 1),
  ('51000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 1, 'Choices Two', 'mcq', 1),
  ('51000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', 1, 'Choices Three', 'mcq', 1),
  ('51000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', 1, 'Choices B', 'mcq', 1);
insert into public.item_versions (id, org_id, test_version_id, section_id, format, position, stem, options, rubric_version_id, origin, content_sha256, created_by) values
  ('61000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64), '00000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', 'written', 1, 'Describe a recent project.', null, '71000000-0000-4000-8000-000000000001', 'human', repeat('c', 64), '00000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000003', 'mcq', 1, 'Pick one, again.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64), '00000000-0000-4000-8000-000000000009'),
  ('61000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000004', 'mcq', 1, 'Pick one, third.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64), '00000000-0000-4000-8000-000000000005'),
  ('61000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', '51000000-0000-4000-8000-00000000000b', 'mcq', 1, 'Pick one, B.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64), '00000000-0000-4000-8000-00000000000e');
insert into public.item_answer_keys (org_id, item_version_id, format, key, created_by) values
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'mcq', '{"option_id": "o1"}', '00000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000003', 'mcq', '{"option_id": "o1"}', '00000000-0000-4000-8000-000000000009'),
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000004', 'mcq', '{"option_id": "o1"}', '00000000-0000-4000-8000-000000000005'),
  ('a1000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-00000000000b', 'mcq', '{"option_id": "o1"}', '00000000-0000-4000-8000-00000000000e');
-- Publish on the operator path (needs migration 3: the L-8 trigger pins the ruleset and notice ids on the draft insert above).
update public.test_versions set status = 'published', content_sha256 = repeat('b', 64)
  where id in ('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b');
update public.test_versions set status = 'retired' where id = 'f1000000-0000-4000-8000-000000000003';
-- A second, draft version of T1 (one open draft per test) and the reviewer assignment (S* arm).
insert into public.test_versions (id, org_id, test_id, total_time_seconds, quality_cutoff, created_by) values
  ('f1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 1800, 40, '00000000-0000-4000-8000-000000000001');
insert into public.assignments (org_id, membership_id, scope, test_id, as_role, created_by)
  select m.org_id, m.id, 'test', 'e1000000-0000-4000-8000-000000000001', 'reviewer', '00000000-0000-4000-8000-000000000001'
  from public.memberships m where m.org_id = 'a1000000-0000-4000-8000-000000000001' and m.user_id = '00000000-0000-4000-8000-000000000007';

-- Fixtures. Sessions: k1 on T1 (items 1: IT1), k2 on T2 (item 2: IT2), k3 in org B (item 3: ITB). One choice response for k1/item 1.
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand01@example.test', '0101010101010101010101010101010101010101010101010101010101010101', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000001';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000001';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000001';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000001' where id = '41000000-0000-4000-8000-000000000001';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000001';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000001');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'cand02@example.test', '0202020202020202020202020202020202020202020202020202020202020202', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000002';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000002';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000002';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', pg_temp.rs('f1000000-0000-4000-8000-000000000002'), pg_temp.nt('f1000000-0000-4000-8000-000000000002'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000002' where id = '41000000-0000-4000-8000-000000000002';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000002';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', pg_temp.rs('f1000000-0000-4000-8000-000000000002'), '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000002');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', 'cand03@example.test', '0303030303030303030303030303030303030303030303030303030303030303', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000003';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000003';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000003';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', pg_temp.rs('f1000000-0000-4000-8000-00000000000b'), pg_temp.nt('f1000000-0000-4000-8000-00000000000b'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000003' where id = '41000000-0000-4000-8000-000000000003';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000003';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', pg_temp.rs('f1000000-0000-4000-8000-00000000000b'), '41000000-0000-4000-8000-000000000003', '42000000-0000-4000-8000-000000000003', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000003');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 1, '2026-10-14 10:00:05+00');
insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-000000000003', 1, '2026-10-14 10:00:05+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', '43000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-00000000000b', '61000000-0000-4000-8000-00000000000b', 1, '2026-10-14 10:00:05+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.responses (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at) values ('45000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', 'choice', null, 'o1', repeat('9', 64), 3, '2026-10-14 10:30:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;

-- ===== session_items cells (A: 2 on T1... k1 has 1 item, k2 has 1; B: 1) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.session_items), 2, 'session_items S: org_owner sees both org A items');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.session_items), 2, 'session_items S: admin sees both org A items');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.session_items), 2, 'session_items S: recruiter (aal1, email OTP) sees both org A items');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.session_items), 1, 'session_items S: workspace-A2 recruiter sees only the T2 item');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.session_items), 1, 'session_items S: assigned reviewer sees the T1 item (S*)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000014", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.session_items), 0, 'session_items S: unassigned reviewer sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.session_items), 0, 'session_items S: hiring_manager sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.session_items), 0, 'session_items S: password-only recruiter at aal1 sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.session_items), 1, 'session_items S: org B admin sees only the org B item (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.session_items), 2, 'session_items S: trace_worker with job org A sees the org A items');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.session_items), 1, 'session_items S: trace_worker with job org B sees only org B');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select is((select count(*)::int from public.session_items), 0, 'session_items S: trace_worker without a job org sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.session_items), 2, 'session_items S: trace_quality_worker with job org A sees the org A items');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select id from public.session_items$$), '^42501 permission denied', 'session_items S: trace_integrity_worker has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select id from public.session_items$$), '^42501 permission denied', 'session_items S: trace_api has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$select id from public.session_items$$), '^42501 permission denied', 'session_items S: anon has no privilege');
-- ===== session_items writes: trace_worker insert-only =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', 2, '2026-10-14 10:00:05+00')$$), 'OK 1', 'session_items I: trace_worker inserts a served item');
select matches(pg_temp.try($$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', 3, '2026-10-14 10:00:05+00')$$), '^23505', 'session_items I: the same item version twice in a session is refused');
select matches(pg_temp.try($$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 9, '2026-10-14 10:00:05+00')$$), '^23505', 'session_items I: the same item version at another position is still refused');
select matches(pg_temp.try($$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-00000000000b', '61000000-0000-4000-8000-00000000000b', 2, '2026-10-14 10:00:05+00')$$), '^42501', 'session_items I: trace_worker with job org A cannot insert into an org B session (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select matches(pg_temp.try($$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', 4, '2026-10-14 10:00:05+00')$$), '^42501', 'session_items I: trace_worker with job org B cannot insert for org A');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select matches(pg_temp.try($$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', 4, '2026-10-14 10:00:05+00')$$), '^42501', 'session_items I: trace_worker without a job org cannot insert');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', 4, '2026-10-14 10:00:05+00')$$), '^42501 permission denied', 'session_items I: trace_quality_worker cannot insert');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', 4, '2026-10-14 10:00:05+00')$$), '^42501 permission denied', 'session_items I: an org_owner cannot insert');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.session_items set position = 5 where id = '44000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'session_items U: trace_worker cannot update (insert-only)');
select matches(pg_temp.try($$delete from public.session_items where id = '44000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'session_items D: trace_worker cannot delete');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.session_items set position = 5 where id = '44000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'session_items U: an org_owner cannot update');
-- ===== responses: no app-role access at all (R-8, D1 has no answer view) =====
select matches(pg_temp.try($$select id from public.responses$$), '^42501 permission denied', 'responses S: org_owner has no privilege (no answer text for org users in D1)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select id from public.responses$$), '^42501 permission denied', 'responses S: admin has no privilege (no answer text for org users in D1)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$select id from public.responses$$), '^42501 permission denied', 'responses S: recruiter has no privilege (no answer text for org users in D1)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select id from public.responses$$), '^42501 permission denied', 'responses S: assigned reviewer has no privilege (no answer text for org users in D1)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$select id from public.responses$$), '^42501 permission denied', 'responses S: hiring_manager has no privilege (no answer text for org users in D1)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select id from public.responses$$), '^42501 permission denied', 'responses S: org B admin has no privilege (no answer text for org users in D1)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.responses (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at) values ('45000000-0000-4000-8000-000000000014', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', 'choice', null, 'o1', repeat('9', 64), 3, '2026-10-14 10:30:00+00')$$), '^42501 permission denied', 'responses I: authenticated cannot insert');
select matches(pg_temp.try($$update public.responses set final_seq = 9$$), '^42501 permission denied', 'responses U: authenticated cannot update');
select matches(pg_temp.try($$delete from public.responses$$), '^42501 permission denied', 'responses D: authenticated cannot delete');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$select id from public.responses$$), '^42501 permission denied', 'responses S: anon has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate;
select matches(pg_temp.try($$select id from public.responses$$), '^42501 permission denied', 'responses S: trace_candidate has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select id from public.responses$$), '^42501 permission denied', 'responses S: trace_api has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select id from public.responses$$), '^42501 permission denied', 'responses S: trace_integrity_worker has no privilege (it never sees answers)');
-- ===== responses: trace_worker S I, trace_quality_worker S =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.responses), 1, 'responses S: trace_worker with job org A sees the org A response');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.responses), 0, 'responses S: trace_worker with job org B sees none of it (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select is((select count(*)::int from public.responses), 0, 'responses S: trace_worker without a job org sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.responses), 1, 'responses S: trace_quality_worker with job org A reads the response to grade it');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.responses), 0, 'responses S: trace_quality_worker with job org B sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
select is((select count(*)::int from public.responses), 0, 'responses S: trace_quality_worker without a job org sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into public.responses (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at) values ('45000000-0000-4000-8000-000000000015', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000004', 'text', 'my answer', null, repeat('9', 64), 3, '2026-10-14 10:30:00+00')$$), 'OK 1', 'responses I: trace_worker inserts the rebuilt final text answer');
select matches(pg_temp.try($$insert into public.responses (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at) values ('45000000-0000-4000-8000-000000000016', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000004', 'text', 'again', null, repeat('9', 64), 3, '2026-10-14 10:30:00+00')$$), '^23505', 'responses unique: one response per session item');
select matches(pg_temp.try($$insert into public.responses (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at) values ('45000000-0000-4000-8000-000000000017', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000004', 'text', null, null, repeat('9', 64), 3, '2026-10-14 10:30:00+00')$$), '^23514', 'CHECK: answer_kind text needs final_text');
select matches(pg_temp.try($$insert into public.responses (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at) values ('45000000-0000-4000-8000-000000000018', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000004', 'choice', 'x', null, repeat('9', 64), 3, '2026-10-14 10:30:00+00')$$), '^23514', 'CHECK: answer_kind choice needs final_choice and no text');
select matches(pg_temp.try($$insert into public.responses (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at) values ('45000000-0000-4000-8000-000000000019', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000004', 'text', 'x', 'o1', repeat('9', 64), 3, '2026-10-14 10:30:00+00')$$), '^23514', 'CHECK: a text answer carries no final_choice');
select matches(pg_temp.try($$insert into public.responses (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at) values ('45000000-0000-4000-8000-00000000001a', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000004', 'audio', 'x', null, repeat('9', 64), 3, '2026-10-14 10:30:00+00')$$), '^23514', 'CHECK: answer_kind is text or choice only');
select matches(pg_temp.try($$insert into public.responses (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at) values ('45000000-0000-4000-8000-00000000001b', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000004', 'text', repeat('x', 20001), null, repeat('9', 64), 3, '2026-10-14 10:30:00+00')$$), '^23514', 'CHECK: final_text is at most 20000 characters');
select matches(pg_temp.try($$insert into public.responses (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at) values ('45000000-0000-4000-8000-00000000001c', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000003', '44000000-0000-4000-8000-000000000003', 'choice', null, 'o1', repeat('9', 64), 3, '2026-10-14 10:30:00+00')$$), '^42501', 'responses I: trace_worker with job org A cannot write an org B response (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select matches(pg_temp.try($$insert into public.responses (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at) values ('45000000-0000-4000-8000-00000000001d', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000002', '44000000-0000-4000-8000-000000000002', 'choice', null, 'o1', repeat('9', 64), 3, '2026-10-14 10:30:00+00')$$), '^42501', 'responses I: trace_worker with job org B cannot write for org A');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select matches(pg_temp.try($$insert into public.responses (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at) values ('45000000-0000-4000-8000-00000000001e', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000002', '44000000-0000-4000-8000-000000000002', 'choice', null, 'o1', repeat('9', 64), 3, '2026-10-14 10:30:00+00')$$), '^42501', 'responses I: trace_worker without a job org cannot write');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.responses (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at) values ('45000000-0000-4000-8000-00000000001f', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000002', '44000000-0000-4000-8000-000000000002', 'choice', null, 'o1', repeat('9', 64), 3, '2026-10-14 10:30:00+00')$$), '^42501 permission denied', 'responses I: trace_quality_worker cannot write (S only)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.responses set final_seq = 9$$), '^42501 permission denied', 'responses U: trace_worker cannot update (insert-only)');
select matches(pg_temp.try($$delete from public.responses$$), '^42501 permission denied', 'responses D: trace_worker cannot delete');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.responses set final_seq = 9$$), '^42501 permission denied', 'responses U: trace_quality_worker cannot update');
-- ===== column-name scans (I-1, I-2): no score, grade, band, outcome or reject column =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is(((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'responses' and column_name ~* '(score|grade|band|outcome)')), 0, 'I-1: public.responses has no score, grade, band or outcome column');
select is(((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'invitations' and column_name ~* '(score|grade|band|outcome)')), 0, 'I-1: public.invitations has no score, grade, band or outcome column');
select is(((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name ~* '(score|grade|band|outcome)')), 0, 'I-1: public.sessions has no score, grade, band or outcome column');
select is(((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'session_items' and column_name ~* '(score|grade|band|outcome)')), 0, 'I-1: public.session_items has no score, grade, band or outcome column');
select is(((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'media_objects' and column_name ~* '(score|grade|band|outcome)')), 0, 'I-1: public.media_objects has no score, grade, band or outcome column');
select is(((select count(*)::int from information_schema.columns where table_schema in ('public', 'quality', 'integrity') and column_name ~* 'reject')), 0, 'I-2: no column named like reject exists in public, quality or integrity');
select is(((select count(*)::int from pg_enum e join pg_type t on t.oid = e.enumtypid where e.enumlabel ~* 'reject')), 0, 'I-2: no enum label named like reject exists');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;

select * from finish();
rollback;
