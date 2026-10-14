-- rls_d1_consents (spec specs/d1-demo-slice.md §3.6 row "rls_d1_consents"; §3.2 consents; §10-DB consent cases; rules 8/9, Q35/Q36). RED first: written from the spec, targets migration <ts2>_d1_invites_sessions.sql (migration 2) on top of
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
select plan(69);
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

-- Fixtures. k1 created, k2 sent, k3 otp_verified (age not stated), k4 and k5 adult-declared (consent-ready), k6 inviter said under 18
-- (blocked_age), k7 self-declared minor (blocked_age), k8 consented on T2 (workspace A2), k9 consented in org B.
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand01@example.test', '0101010101010101010101010101010101010101010101010101010101010101', true, '2026-12-31 00:00:00+00');
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand02@example.test', '0202020202020202020202020202020202020202020202020202020202020202', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000002';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand03@example.test', '0303030303030303030303030303030303030303030303030303030303030303', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000003';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000003';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand04@example.test', '0404040404040404040404040404040404040404040404040404040404040404', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000004';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000004';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000004';
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
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000005';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand06@example.test', '0606060606060606060606060606060606060606060606060606060606060606', false, '2026-12-31 00:00:00+00');
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand07@example.test', '0707070707070707070707070707070707070707070707070707070707070707', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000007';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000007';
update public.invitations set adult_self_declared = false, status = 'blocked_age', age_block_source = 'self_declared' where id = '41000000-0000-4000-8000-000000000007';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'cand08@example.test', '0808080808080808080808080808080808080808080808080808080808080808', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000008';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000008';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000008';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-000000000002', pg_temp.rs('f1000000-0000-4000-8000-000000000002'), pg_temp.nt('f1000000-0000-4000-8000-000000000002'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000008' where id = '41000000-0000-4000-8000-000000000008';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', 'cand09@example.test', '0909090909090909090909090909090909090909090909090909090909090909', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000009';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000009';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000009';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-00000000000b', pg_temp.rs('f1000000-0000-4000-8000-00000000000b'), pg_temp.nt('f1000000-0000-4000-8000-00000000000b'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000009' where id = '41000000-0000-4000-8000-000000000009';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;

-- ===== I: trace_api inserts a consent only for an otp_verified, adult-declared invitation (age before consent, rule 9) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), 'OK 1', 'I: trace_api records the consent of an otp_verified, adult-declared invitation (k4)');
select is(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000028', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00') on conflict (org_id, invitation_id, event) do nothing$$), 'OK 0', 'I: a replayed consent (double click) is on conflict do nothing: 0 rows, no error');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.consents where invitation_id = '41000000-0000-4000-8000-000000000004'), 1, 'I: the replay left exactly one consent for the invitation');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000029', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'guard: a created invitation (no OTP yet) cannot be consented');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000002a', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'guard: a sent invitation (no OTP yet) cannot be consented');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000002b', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'guard: an otp_verified invitation whose age step is not done cannot be consented');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000002c', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'guard: an invitation the inviter marked under 18 (blocked_age) cannot be consented');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000002d', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'guard: a self-declared under-18 invitation (blocked_age) cannot be consented');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.consents where invitation_id in ('41000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000006', '41000000-0000-4000-8000-000000000007')), 0, 'guard: none of the refused invitations has a consent row (so no session_id, no started, no session)');
-- ===== CHECKs and composite FKs =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000032', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), 'abc', 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^23514', 'CHECK: rendered_sha256 must be 64 hex characters');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000033', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('A', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^23514', 'CHECK: upper-case hex is refused');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000034', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), null, 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^23502', 'NOT NULL: rendered_sha256 is required (the rendered text hash is stored per consent)');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000035', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'withdrawn', '2026-10-14 09:55:00+00')$$), '^23514', 'CHECK: event is ''granted'' only in D1');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000036', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-00000000000b'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'FK: another org''s notice version is refused (composite FK on org_id)');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000037', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000002', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'FK: a test version other than the invitation''s is refused (org, invitation, test_version)');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000038', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000002'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'FK: another version''s ruleset is refused (org, test_version, ruleset)');
-- ===== writers: trace_api only =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000003c', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^42501 permission denied', 'I: org_owner cannot insert a consent');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000003c', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^42501 permission denied', 'I: recruiter cannot insert a consent');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000003c', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^42501 permission denied', 'I: trace_worker cannot insert a consent');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000003c', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^42501 permission denied', 'I: trace_quality_worker cannot insert a consent');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000003c', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^42501 permission denied', 'I: trace_integrity_worker cannot insert a consent');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000003c', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^42501 permission denied', 'I: anon cannot insert a consent');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate;
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000003c', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^42501 permission denied', 'I: trace_candidate cannot insert a consent');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate_gateway;
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000003c', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^42501 permission denied', 'I: trace_candidate_gateway cannot insert a consent');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role service_role;
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000003c', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^42501 permission denied', 'I: service_role cannot insert a consent');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000003d', 'a1000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-00000000000b', pg_temp.rs('f1000000-0000-4000-8000-00000000000b'), pg_temp.nt('f1000000-0000-4000-8000-00000000000b'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^OK 0$', 'I: a second consent for the same invitation is a unique violation (the api uses on conflict do nothing); own org is allowed');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000003e', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^42501 TRACE_GUARD: the consent is outside the api org', 'I: api org B cannot record a consent for an org A invitation (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-00000000003f', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00')$$), '^42501 TRACE_GUARD: the consent is outside the api org', 'I: api without an api org cannot record a consent');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select workspace_id::text || '/' || test_id::text from public.consents where id = '42000000-0000-4000-8000-000000000004'), 'b1000000-0000-4000-8000-000000000001/e1000000-0000-4000-8000-000000000001', 'L-27: workspace_id and test_id are copied from the invitation');
select ok((select rendered_sha256 = repeat('a', 64) and language = 'en' and event = 'granted' from public.consents where id = '42000000-0000-4000-8000-000000000004'), 'the stored hash, language and event are what the api sent');
-- ===== S: consents visible to (A: k4 on T1, k8 on T2; B: k9) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.consents), 2, 'S: org_owner sees both org A consents');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.consents), 2, 'S: admin sees both org A consents');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.consents), 2, 'S: recruiter (aal1, email OTP) sees both org A consents');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.consents), 1, 'S: workspace-A2 recruiter sees only the T2 consent');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.consents), 1, 'S: assigned reviewer sees the T1 consent (S*)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000014", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.consents), 0, 'S: unassigned reviewer sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.consents), 0, 'S: hiring_manager sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.consents), 0, 'S: password-only recruiter at aal1 sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.consents), 1, 'S: org B admin sees only the org B consent (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.consents), 2, 'S: trace_worker with job org A sees the org A consents');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.consents), 1, 'S: trace_worker with job org B sees only org B');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select is((select count(*)::int from public.consents), 0, 'S: trace_worker without a job org sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.consents), 2, 'S: trace_api with api org A sees the org A consents');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.consents), 1, 'S: trace_api with api org B sees only org B');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
select is((select count(*)::int from public.consents), 0, 'S: trace_api without an api org sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select id from public.consents$$), '^42501 permission denied', 'S: trace_quality_worker has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select id from public.consents$$), '^42501 permission denied', 'S: trace_integrity_worker has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$select id from public.consents$$), '^42501 permission denied', 'S: anon has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate;
select matches(pg_temp.try($$select id from public.consents$$), '^42501 permission denied', 'S: trace_candidate has no privilege');
-- ===== append-only for every role (the audit_log recipe): revoke 42501, then trigger P0001 in normal and replica mode =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is(((select count(*)::int from unnest(array['postgres', 'authenticated', 'anon', 'service_role', 'trace_api', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_candidate', 'trace_candidate_gateway']) r where has_table_privilege(r, 'public.consents', 'UPDATE') or has_table_privilege(r, 'public.consents', 'DELETE') or has_table_privilege(r, 'public.consents', 'TRUNCATE'))), 0, 'append-only: UPDATE, DELETE and TRUNCATE are granted to no role, the owner included');
select matches(pg_temp.try($$update public.consents set language = 'en'$$), '^42501 permission denied', 'append-only: the owner (postgres) cannot update (privilege revoked)');
select matches(pg_temp.try($$delete from public.consents$$), '^42501 permission denied', 'append-only: the owner cannot delete');
select matches(pg_temp.try($$truncate public.consents$$), '^42501 permission denied', 'append-only: the owner cannot truncate');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.consents set language = 'en'$$), '^42501 permission denied', 'append-only: trace_api cannot update');
select matches(pg_temp.try($$delete from public.consents$$), '^42501 permission denied', 'append-only: trace_api cannot delete');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.consents set language = 'en'$$), '^42501 permission denied', 'append-only: trace_worker cannot update');
select matches(pg_temp.try($$delete from public.consents$$), '^42501 permission denied', 'append-only: trace_worker cannot delete');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.consents set language = 'en'$$), '^42501 permission denied', 'append-only: an org_owner cannot update');
select matches(pg_temp.try($$delete from public.consents$$), '^42501 permission denied', 'append-only: an org_owner cannot delete');
-- ===== immutable notice template (rendered_sha256 refers to it) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select matches(pg_temp.try($$update public.notice_versions set body_template = 'changed' where id = pg_temp.nt('f1000000-0000-4000-8000-000000000001')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'notice_versions: a notice template is immutable (update refused, operator)');
select matches(pg_temp.try($$delete from public.notice_versions where id = pg_temp.nt('f1000000-0000-4000-8000-000000000001')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'notice_versions: a notice template cannot be deleted');
-- ===== no consent, no session =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000063', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000001')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'no consent no session: a session naming a consent that does not exist is refused');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000004', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'no consent no session: a session for k5 naming the consent of k4 (another invitation) is refused');
-- ===== trigger layer: re-grant the revoked privileges to the owner, the append-only trigger still raises =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
grant update, delete, truncate on public.consents to postgres;
select matches(pg_temp.try($$update public.consents set language = 'en'$$), '^P0001 TRACE_APPEND_ONLY', 'trigger: UPDATE raises TRACE_APPEND_ONLY (privilege re-granted)');
select matches(pg_temp.try($$delete from public.consents$$), '^P0001 TRACE_APPEND_ONLY', 'trigger: DELETE raises TRACE_APPEND_ONLY');
select matches(pg_temp.try($$truncate public.consents$$), '^(P0001 TRACE_APPEND_ONLY|0A000 cannot truncate a table referenced in a foreign key)', 'trigger: TRUNCATE raises TRACE_APPEND_ONLY');
set local session_replication_role = replica;
select matches(pg_temp.try($$update public.consents set language = 'en'$$), '^P0001 TRACE_APPEND_ONLY', 'replica: UPDATE still raises TRACE_APPEND_ONLY (ENABLE ALWAYS)');
select matches(pg_temp.try($$delete from public.consents$$), '^P0001 TRACE_APPEND_ONLY', 'replica: DELETE still raises TRACE_APPEND_ONLY');
select matches(pg_temp.try($$truncate public.consents$$), '^(P0001 TRACE_APPEND_ONLY|0A000 cannot truncate a table referenced in a foreign key)', 'replica: TRUNCATE still raises TRACE_APPEND_ONLY');
set local session_replication_role = origin;
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;

select * from finish();
rollback;
