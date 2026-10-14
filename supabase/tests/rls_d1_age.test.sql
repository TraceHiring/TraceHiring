-- rls_d1_age (spec specs/d1-demo-slice.md §3.6 row "rls_d1_age"; D1-12, L-31; rule 9; MT-3). RED first: written from the spec, targets migration <ts2>_d1_invites_sessions.sql (migration 2) on top of
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
select plan(49);
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

-- Fixtures. k1 inviter said adult, k2 inviter stated nothing (null), k3 inviter said under 18 (forced blocked_age), k4 and k5 otp_verified (age step open),
-- k6 self-declared adult, k7 consented and started, k8 otp_verified (CHECK probes).
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand01@example.test', '0101010101010101010101010101010101010101010101010101010101010101', true, '2026-12-31 00:00:00+00');
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand02@example.test', '0202020202020202020202020202020202020202020202020202020202020202', null, '2026-12-31 00:00:00+00');
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand03@example.test', '0303030303030303030303030303030303030303030303030303030303030303', false, '2026-12-31 00:00:00+00');
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand04@example.test', '0404040404040404040404040404040404040404040404040404040404040404', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000004';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000004';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand05@example.test', '0505050505050505050505050505050505050505050505050505050505050505', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000005';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000005';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand06@example.test', '0606060606060606060606060606060606060606060606060606060606060606', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000006';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000006';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000006';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand07@example.test', '0707070707070707070707070707070707070707070707070707070707070707', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000007';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000007';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000007';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000007' where id = '41000000-0000-4000-8000-000000000007';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000007';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand08@example.test', '0808080808080808080808080808080808080808080808080808080808080808', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000008';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000008';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;

-- ===== inviter under 18 forces blocked_age (D1-12) =====
select is((select status::text from public.invitations where id = '41000000-0000-4000-8000-000000000003'), 'blocked_age', 'inviter false: the BEFORE INSERT trigger forces status blocked_age (operator insert)');
select is((select age_block_source from public.invitations where id = '41000000-0000-4000-8000-000000000003'), 'inviter', 'inviter false: age_block_source is inviter');
select is((select status::text from public.invitations where id = '41000000-0000-4000-8000-000000000001'), 'created', 'inviter true: the invitation starts as created');
select is((select age_block_source is null from public.invitations where id = '41000000-0000-4000-8000-000000000001'), true, 'inviter true: no block source');
select is((select status::text || '/' || coalesce(adult_confirmed_by_inviter::text, 'null') from public.invitations where id = '41000000-0000-4000-8000-000000000002'), 'created/null', 'inviter unknown (null): not blocked, stays null ("not yet stated")');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'minor01@example.test', '4646464646464646464646464646464646464646464646464646464646464646', false, '2026-12-31 00:00:00+00')$$), 'OK 1', 'inviter false: a recruiter can create the invitation (it is born blocked)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select status::text || '/' || age_block_source from public.invitations where contact_email = 'minor01@example.test'), 'blocked_age/inviter', 'inviter false: the recruiter-created row is blocked_age with source inviter');
select matches(pg_temp.try($$update public.invitations set adult_confirmed_by_inviter = true where id = '41000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'inviter false: the inviter statement is immutable (no unblocking by flipping it)');
-- ===== blocked_age is terminal for every role =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'terminal: trace_api cannot move a blocked invitation to sent');
select matches(pg_temp.try($$update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'terminal: trace_api cannot move it to otp_verified');
select matches(pg_temp.try($$update public.invitations set status = 'expired' where id = '41000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'terminal: trace_api cannot expire it');
select matches(pg_temp.try($$update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'terminal: a blocked invitation cannot be started');
select matches(pg_temp.try($$update public.invitations set session_id = '43000000-0000-4000-8000-000000000003' where id = '41000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'terminal: a blocked invitation cannot get a session_id');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|OK 0)', 'terminal: an org_owner cannot revoke a blocked invitation');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.invitations set status = 'submitted' where id = '41000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'terminal: trace_worker cannot mark a blocked invitation submitted');
-- ===== self-declared under 18 (the age step) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$update public.invitations set adult_self_declared = false, status = 'blocked_age', age_block_source = 'self_declared' where id = '41000000-0000-4000-8000-000000000004'$$), 'OK 1', 'self-declared: trace_api blocks the invitation in one statement (flags and status agree, L-31)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select status::text || '/' || age_block_source || '/' || adult_self_declared::text from public.invitations where id = '41000000-0000-4000-8000-000000000004'), 'blocked_age/self_declared/false', 'self-declared: stored as blocked_age, source self_declared, flag false (a boolean and a source only)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$update public.invitations set adult_self_declared = false, status = 'blocked_age', age_block_source = 'self_declared' where id = '41000000-0000-4000-8000-000000000005'$$), 'OK 1', 'self-declared: a second minor is blocked the same way (k5)');
select matches(pg_temp.try($$update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000005'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'no undo: a self-declared minor cannot go back to otp_verified');
select matches(pg_temp.try($$update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000005'$$), '^(23514|42501 TRACE_GUARD)', 'no undo: flipping the self-declaration to adult is refused (CHECK or set-once)');
select matches(pg_temp.try($$update public.invitations set adult_self_declared = true, status = 'otp_verified', age_block_source = null where id = '41000000-0000-4000-8000-000000000005'$$), '^(23514|42501 TRACE_GUARD)', 'no undo: flags, status and source cannot be rewritten together either');
select matches(pg_temp.try($$update public.invitations set adult_self_declared = false where id = '41000000-0000-4000-8000-000000000006'$$), '^(23514|42501 TRACE_GUARD)', 'set-once: an adult self-declaration cannot be flipped to false without the blocked_age status (CHECK L-31)');
select matches(pg_temp.try($$update public.invitations set adult_self_declared = false where id = '41000000-0000-4000-8000-000000000007'$$), '^(23514|42501 TRACE_GUARD)', 'set-once: the declaration of a consented, started invitation cannot be flipped to false either (k7)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
select is(pg_temp.try($$update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000004'$$), 'OK 0', 'cross-org: api org B cannot declare on an org A invitation (0 rows)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
select is(pg_temp.try($$update public.invitations set adult_self_declared = false, status = 'blocked_age', age_block_source = 'self_declared' where id = '41000000-0000-4000-8000-000000000008'$$), 'OK 0', 'cross-org: api without an api org cannot block an invitation');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000008'$$), '^42501 permission denied', 'U(c): authenticated cannot set adult_self_declared (no grant)');
select matches(pg_temp.try($$update public.invitations set age_block_source = 'self_declared' where id = '41000000-0000-4000-8000-000000000008'$$), '^42501 permission denied', 'U(c): authenticated cannot set age_block_source (no grant)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000008'$$), '^42501 permission denied', 'U(c): trace_worker cannot set adult_self_declared');
-- ===== L-31 CHECK: ((inviter is false) or (self is false)) = (status = blocked_age); (status = blocked_age) = (source is not null) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select matches(pg_temp.try($$update public.invitations set status = 'blocked_age' where id = '41000000-0000-4000-8000-000000000008'$$), '^(23514|42501 TRACE_GUARD)', 'L-31: blocked_age with no minor flag and no source is refused');
select matches(pg_temp.try($$update public.invitations set status = 'blocked_age', age_block_source = 'self_declared' where id = '41000000-0000-4000-8000-000000000008'$$), '^(23514|42501 TRACE_GUARD)', 'L-31: blocked_age with both flags adult (self null, inviter true) is refused even with a source');
select matches(pg_temp.try($$update public.invitations set adult_self_declared = false where id = '41000000-0000-4000-8000-000000000008'$$), '^(23514|42501 TRACE_GUARD)', 'L-31: a minor flag without status blocked_age is refused');
select matches(pg_temp.try($$update public.invitations set age_block_source = 'self_declared' where id = '41000000-0000-4000-8000-000000000008'$$), '^(23514|42501 TRACE_GUARD)', 'L-31: a block source without status blocked_age is refused');
select matches(pg_temp.try($$update public.invitations set adult_self_declared = false, status = 'blocked_age', age_block_source = null where id = '41000000-0000-4000-8000-000000000008'$$), '^(23514|42501 TRACE_GUARD)', 'L-31: blocked_age without a source is refused');
select matches(pg_temp.try($$update public.invitations set adult_self_declared = false, status = 'blocked_age', age_block_source = 'parent' where id = '41000000-0000-4000-8000-000000000008'$$), '^(23514|42501 TRACE_GUARD)', 'CHECK: age_block_source is ''inviter'' or ''self_declared'' only');
select matches(pg_temp.try($$update public.invitations set status = 'blocked_age', age_block_source = 'self_declared' where id = '41000000-0000-4000-8000-000000000006'$$), '^(23514|42501 TRACE_GUARD)', 'L-31: an adult-declared invitation (k6) cannot be marked blocked_age');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, status, age_block_source, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'minor02@example.test', '4747474747474747474747474747474747474747474747474747474747474747', true, 'blocked_age', 'inviter', '2026-12-31 00:00:00+00')$$), '^OK 1$', 'L-31: an insert that says blocked_age while the inviter said adult is stored as created (the label trigger sets the status from the inviter''s answer)');
-- ===== a blocked invitation gets no consent and no session (rule 9) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-00000000001e', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'blocked: no consent for the inviter-blocked invitation (k3)');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-00000000001f', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'blocked: no consent for the self-declared minor (k4)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000003', '42000000-0000-4000-8000-000000000007', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000003')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'blocked: no session row for the inviter-blocked invitation (k3, borrowing the consent of k7)');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000004', '42000000-0000-4000-8000-000000000007', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000004')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'blocked: no session row for the self-declared minor (k4, borrowing the consent of k7)');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000007', '42000000-0000-4000-8000-000000000007', 'in_progress', null, null, false, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000007')$$), '^23514', 'CHECK: adult_confirmed_at_start must be true on a session row (rule 9)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.sessions where invitation_id in ('41000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000004', '41000000-0000-4000-8000-000000000005')), 0, 'blocked: no session exists for any blocked invitation');
select is((select count(*)::int from public.consents where invitation_id in ('41000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000004', '41000000-0000-4000-8000-000000000005')), 0, 'blocked: no consent exists for any blocked invitation');
-- ===== only a boolean and a source are stored (MT-3 column scan) =====
select is((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'invitations' and column_name = 'adult_confirmed_by_inviter'), 'boolean', 'MT-3: invitations.adult_confirmed_by_inviter is a boolean');
select is((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'invitations' and column_name = 'adult_self_declared'), 'boolean', 'MT-3: invitations.adult_self_declared is a boolean');
select is((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'invitations' and column_name = 'age_block_source'), 'text', 'MT-3: invitations.age_block_source is a text');
select is(((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'adult_confirmed_at_start')), 'boolean', 'MT-3: sessions.adult_confirmed_at_start is a boolean');
select is(((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name in ('invitations', 'consents', 'sessions', 'session_items', 'responses', 'media_objects') and column_name ~* '(dob|birth|^age$|age_years|years_old|full_name|first_name|last_name|phone|passport|aadhaar|pan_)')), 0, 'MT-3: no date-of-birth, age, name, phone or government-id column exists in the D1 candidate tables');
select is(((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'invitations' and column_name in ('candidate_label', 'contact_email'))), 2, 'D1-1: the only identity columns on invitations are the generated label and the example.test address');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;

select * from finish();
rollback;
