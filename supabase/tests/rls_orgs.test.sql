-- rls_orgs (spec specs/m0b-tenancy.md §6, rows "rls_orgs"; §2.2 AAL rules, §3.2 orgs guard and audit,
-- §2.6 create_org, AT-B4/B5/B6). Written from the spec, not from the migration.
-- Personas are synthetic (p-<persona>@example.test). Org fixtures are inserted on the operator path
-- with fixed ids; org C is created through private.create_org. try() returns 'OK <rows>' or '<sqlstate> <message>'.
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
select plan(68);
grant trace_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_worker;
grant trace_candidate to postgres with inherit false, set true;
grant usage on schema extensions to trace_candidate;
-- Personas (spec §6): synthetic users, fixed ids, created on the operator path (postgres, no claims).
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p-owner-admin@example.test'),
  ('00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'p-owner2@example.test'),
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'p-admin@example.test'),
  ('00000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'p-admin-aal1@example.test'),
  ('00000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'p-recruiter-otp@example.test'),
  ('00000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'p-recruiter-pw-aal1@example.test'),
  ('00000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'p-reviewer@example.test'),
  ('00000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'p-hm@example.test'),
  ('00000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'p-ws-recruiter@example.test'),
  ('00000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'p-invited@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'p-removed@example.test'),
  ('00000000-0000-4000-8000-00000000000c', 'authenticated', 'authenticated', 'p-suspended@example.test'),
  ('00000000-0000-4000-8000-00000000000d', 'authenticated', 'authenticated', 'p-s-admin@example.test'),
  ('00000000-0000-4000-8000-00000000000e', 'authenticated', 'authenticated', 'p-b-admin@example.test'),
  ('00000000-0000-4000-8000-00000000000f', 'authenticated', 'authenticated', 'p-staff@example.test'),
  ('00000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'p-staff2@example.test'),
  ('00000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'p-outsider@example.test'),
  ('00000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'p-recruiter2@example.test'),
  ('00000000-0000-4000-8000-000000000020', 'authenticated', 'authenticated', 'p-newhire1@example.test'),
  ('00000000-0000-4000-8000-000000000021', 'authenticated', 'authenticated', 'p-newhire2@example.test'),
  ('00000000-0000-4000-8000-000000000022', 'authenticated', 'authenticated', 'p-newhire3@example.test'),
  ('00000000-0000-4000-8000-000000000023', 'authenticated', 'authenticated', 'p-newhire4@example.test'),
  ('00000000-0000-4000-8000-000000000024', 'authenticated', 'authenticated', 'p-newhire5@example.test'),
  ('00000000-0000-4000-8000-000000000025', 'authenticated', 'authenticated', 'p-newhire6@example.test'),
  ('00000000-0000-4000-8000-000000000030', 'authenticated', 'authenticated', 'p-c-owner@example.test'),
  ('00000000-0000-4000-8000-000000000031', 'authenticated', 'authenticated', 'p-c-owner2@example.test');

-- Org A (customer), org S (suspended in the cases that need it), org B (customer), org T (trace_internal, home of staff).
insert into public.orgs (id, kind, name, slug) values
  ('a1000000-0000-4000-8000-000000000001', 'customer', 'Org A', 'org-a-test'),
  ('a1000000-0000-4000-8000-000000000002', 'customer', 'Org S', 'org-s-test'),
  ('a1000000-0000-4000-8000-000000000003', 'customer', 'Org B', 'org-b-test'),
  ('a1000000-0000-4000-8000-000000000004', 'trace_internal', 'Org T', 'org-t-test');

insert into public.workspaces (id, org_id, name, kind, is_default) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Default', 'default', true),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Client A2', 'client', false),
  ('b1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'Default', 'default', true),
  ('b1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000003', 'Default', 'default', true),
  ('b1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000004', 'Default', 'default', true);

insert into public.teams (id, org_id, name) values
  ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Team One'),
  ('c1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', 'Team B');

-- Memberships on the operator path (org A: 12 rows incl. invited, removed, suspended).
insert into public.memberships (org_id, user_id, roles, workspace_id, display_name, status) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '{org_owner,admin}', null, 'Persona Owner Admin', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '{org_owner,admin}', null, 'Persona Owner Two', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '{admin}', null, 'Persona Admin', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', '{admin}', null, 'Persona Admin Aal1', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', '{recruiter}', null, 'Persona Recruiter Otp', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', '{recruiter}', null, 'Persona Recruiter Pw', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', '{reviewer}', null, 'Persona Reviewer', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000008', '{hiring_manager}', null, 'Persona Hiring Manager', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000009', '{recruiter}', 'b1000000-0000-4000-8000-000000000002', 'Persona Ws Recruiter', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', '{recruiter}', null, 'Persona Invited', 'invited'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', '{recruiter}', null, 'Persona Removed', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000c', '{recruiter}', null, 'Persona Suspended', 'active');
update public.memberships set status = 'removed'
  where org_id = 'a1000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-00000000000b';
update public.memberships set status = 'suspended'
  where org_id = 'a1000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-00000000000c';
insert into public.memberships (org_id, user_id, roles, display_name, status) values
  ('a1000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000d', '{org_owner,admin}', 'Persona S Admin', 'active'),
  ('a1000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000012', '{recruiter}', 'Persona Recruiter Two', 'active'),
  ('a1000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000e', '{org_owner,admin}', 'Persona B Admin', 'active');

-- Platform staff live in org T; the grant on org A is inserted with a fixed id (private.grant_staff_access has its own cases).
insert into public.platform_staff (user_id, org_id, capabilities) values
  ('00000000-0000-4000-8000-00000000000f', 'a1000000-0000-4000-8000-000000000004', '{support_read}'),
  ('00000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000004', '{support_read}');
insert into public.staff_access_grants (id, org_id, staff_user_id, ticket_ref, scope, expires_at, approved_by) values
  ('d1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-00000000000f', 'TKT-001', 'support_read', now() + interval '1 hour',
   '00000000-0000-4000-8000-000000000010');

-- ===== S: each of the five roles sees its own org only (org B invisible) =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(slug order by slug) from public.orgs), array['org-a-test'], 'S: org_owner sees org A only, org B invisible');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(slug order by slug) from public.orgs), array['org-a-test'], 'S: admin sees org A only, org B invisible');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array_agg(slug order by slug) from public.orgs), array['org-a-test'], 'S: recruiter (aal1, email OTP) sees org A only');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(slug order by slug) from public.orgs), array['org-a-test'], 'S: reviewer (aal2) sees org A only');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array_agg(slug order by slug) from public.orgs), array['org-a-test'], 'S: hiring_manager (aal1, email OTP) sees org A only');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(slug order by slug) from public.orgs), array['org-b-test'], 'S: org B admin sees org B only, org A invisible');

-- ===== S: callers that must see nothing =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'S: admin at aal1 sees no org (privileged role needs aal2) [AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'S: recruiter with a password sign-in at aal1 sees no org (needs aal2) [AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 1, 'S: the same password recruiter at aal2 sees org A [AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000a", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'S: invited member sees no org');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000b", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'S: removed member sees no org');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000c", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'S: suspended member sees no org');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000011", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'S: signed-in user without any membership sees no org');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000f", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'S: platform staff with an active grant on org A sees no org (no staff read policy)');

-- ===== AT-B5: same claims before and after the operator suspends org S =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000d", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(slug) from public.orgs), array['org-s-test'], 'S: org S admin sees org S while it is active');
reset role;
reset request.jwt.claims;
select is(pg_temp.try($$update public.orgs set status = 'suspended' where id = 'a1000000-0000-4000-8000-000000000002'$$), 'OK 1', 'U: the operator suspends org S');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000d", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'S: with the same claims, org S admin sees nothing once org S is suspended [AT-B5]');

-- ===== S: roles without a table grant =====
set local role anon;
select matches(pg_temp.try('select * from public.orgs'), '^42501 permission denied', 'S: anon has no privilege on orgs');
reset role;
reset request.jwt.claims;
set local role service_role;
select matches(pg_temp.try('select * from public.orgs'), '^42501 permission denied', 'S: service_role has no table grant on orgs');
reset role;
reset request.jwt.claims;
set local role trace_worker;
select matches(pg_temp.try('select * from public.orgs'), '^42501 permission denied', 'S: trace_worker has no privilege on orgs');
reset role;
reset request.jwt.claims;
set local role trace_candidate;
select matches(pg_temp.try('select * from public.orgs'), '^42501 permission denied', 'S: trace_candidate has no privilege on orgs');
reset role;
reset request.jwt.claims;

-- ===== U: owner changes name and residency (audited) =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.orgs set name = 'Org A Renamed', data_residency = 's3_mumbai' where id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 1', 'U: org_owner updates name and data_residency');
select is((select name || '/' || data_residency::text from public.orgs where id = 'a1000000-0000-4000-8000-000000000001'), 'Org A Renamed/s3_mumbai', 'U: the owner update took effect');
reset role;
reset request.jwt.claims;
select is((select details -> 'changed' from public.audit_log where action = 'org.update' and object_id = 'a1000000-0000-4000-8000-000000000001' and actor_user_id = '00000000-0000-4000-8000-000000000001'), '["name", "data_residency"]'::jsonb, 'U: owner update is audited as org.update with changed = name, data_residency');
select is((select pg_temp.keys(details) || '|' || actor_kind::text || '|' || array_to_string(actor_roles, '+') from public.audit_log where action = 'org.update' and object_id = 'a1000000-0000-4000-8000-000000000001' and actor_user_id = '00000000-0000-4000-8000-000000000001'), 'changed|org_user|org_owner+admin', 'U: org.update has only the key changed, actor_kind org_user and the roles at event time');
select is((select count(*)::int from public.audit_log where action = 'org.update' and (details::text like '%Renamed%' or details::text like '%s3_mumbai%')), 0, 'U: org.update never stores the new name or residency value');

-- ===== U: admin changes the name only =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.orgs set name = 'Org A Admin Named' where id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 1', 'U: admin updates the name');
select matches(pg_temp.try($$update public.orgs set data_residency = 'r2_apac' where id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD', 'U: admin changing data_residency is refused by the guard');
select is((select data_residency::text from public.orgs where id = 'a1000000-0000-4000-8000-000000000001'), 's3_mumbai', 'U: the refused residency change left the value unchanged');
select matches(pg_temp.try($$update public.orgs set name = 'Org A Both', data_residency = 'r2_apac' where id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD', 'U: admin changing name and residency together is refused as a whole');
reset role;
reset request.jwt.claims;
select is((select pg_temp.keys(details) || '|' || (details -> 'changed')::text from public.audit_log where action = 'org.update' and object_id = 'a1000000-0000-4000-8000-000000000001' and actor_user_id = '00000000-0000-4000-8000-000000000003'), 'changed|["name"]', 'U: admin update is audited with changed = name');

-- ===== U: callers that cannot update =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.orgs set name = 'Recruiter Edit' where id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: recruiter update affects no row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.orgs set name = 'Hm Edit' where id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: hiring_manager update affects no row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.orgs set name = 'Aal1 Edit' where id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: admin at aal1 update affects no row [AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000f", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.orgs set name = 'Staff Edit' where id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: platform staff update affects no row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.orgs set name = 'Cross Org Edit' where id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: org B admin cannot update org A (cross-org)');
select is(pg_temp.try($$update public.orgs set name = 'Org B Renamed' where id = 'a1000000-0000-4000-8000-000000000003'$$), 'OK 1', 'U: org B admin can update org B');
reset role;
reset request.jwt.claims;
select is((select name from public.orgs where id = 'a1000000-0000-4000-8000-000000000001'), 'Org A Admin Named', 'U: org A keeps the admin''s name after every denied update');

-- ===== U: status, slug and kind are not writable by an app caller (column grant) =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.orgs set status = 'suspended' where id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'U: owner cannot update status');
select matches(pg_temp.try($$update public.orgs set slug = 'org-a-hijack' where id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'U: owner cannot update slug');
select matches(pg_temp.try($$update public.orgs set kind = 'trace_internal' where id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'U: owner cannot update kind');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.orgs set status = 'suspended' where id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'U: admin cannot update status');
-- B0-SP7 matrix gaps: admin slug and kind; a reviewer can read org A but not update it.
select matches(pg_temp.try($$update public.orgs set slug = 'org-a-hijack' where id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'U: admin cannot update slug');
select matches(pg_temp.try($$update public.orgs set kind = 'trace_internal' where id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'U: admin cannot update kind');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.orgs set name = 'Reviewer Edit' where id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: a reviewer cannot update its org');

-- ===== I and D denied for everyone, owner included =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.orgs (kind, name, slug) values ('customer', 'Org X', 'org-x-test')$$), '^42501 permission denied', 'I: owner cannot insert an org');
select matches(pg_temp.try($$delete from public.orgs where id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'D: owner cannot delete an org');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.orgs (kind, name, slug) values ('customer', 'Org X', 'org-x-test')$$), '^42501 permission denied', 'I: admin cannot insert an org');
select matches(pg_temp.try($$delete from public.orgs where id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'D: admin cannot delete an org');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.orgs (id, kind, name, slug) values ('a1000000-0000-4000-8000-0000000000f1', 'customer', 'Org X', 'org-x-test')$$), '^42501 permission denied', 'I: org B admin cannot insert an org');
set local role trace_worker;
select matches(pg_temp.try($$delete from public.orgs$$), '^42501 permission denied', 'D: trace_worker cannot delete orgs');
reset role;
reset request.jwt.claims;

-- ===== U: the operator path (guard on id, kind, slug, created_at) [N7] =====
select matches(pg_temp.try($$update public.orgs set slug = 'org-a-moved' where id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD', 'U: even the operator cannot change slug');
select matches(pg_temp.try($$update public.orgs set kind = 'trace_library' where id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD', 'U: even the operator cannot change kind');
select matches(pg_temp.try($$update public.orgs set created_at = created_at - interval '1 day' where id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD', 'U: even the operator cannot change created_at');
select is(pg_temp.try($$update public.orgs set name = 'Org A Operator Named' where id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 1', 'U: the operator can change name');
select is((select details -> 'changed' from public.audit_log where action = 'org.update' and object_id = 'a1000000-0000-4000-8000-000000000002'), '["status"]'::jsonb, 'U: suspending org S is audited with changed = status [N7]');
select is((select actor_kind::text || '|' || coalesce(actor_user_id::text, 'none') from public.audit_log where action = 'org.update' and object_id = 'a1000000-0000-4000-8000-000000000002'), 'system|none', 'U: the operator''s org.update has actor_kind system and no actor user');
select is((select pg_temp.keys(details) || '|' || actor_kind::text from public.audit_log where action = 'org.update' and object_id = 'a1000000-0000-4000-8000-000000000001' and actor_kind = 'system'), 'changed|system', 'U: the operator''s name change is audited as a system org.update');

-- ===== create_org (operator path, §2.6) =====
select matches(pg_temp.try($$select private.create_org('Org C', 'org-c-test', 'customer', '00000000-0000-4000-8000-000000000030', 'Persona C Owner', 'e1000000-0000-4000-8000-000000000001')$$), '^OK 1$', 'create_org: the operator creates org C');
select is((select count(*)::int from public.orgs where slug = 'org-c-test' and kind = 'customer' and status = 'active'), 1, 'create_org: org C exists, active');
select is((select count(*)::int from public.workspaces w join public.orgs o on o.id = w.org_id where o.slug = 'org-c-test' and w.kind = 'default' and w.is_default), 1, 'create_org: org C has exactly one default workspace');
select is((select array_to_string(m.roles, '+') || '|' || m.status::text from public.memberships m join public.orgs o on o.id = m.org_id where o.slug = 'org-c-test' and m.user_id = '00000000-0000-4000-8000-000000000030'), 'org_owner+admin|active', 'create_org: the first membership is org_owner+admin and active');
select is((select pg_temp.keys(a.details) || '|' || a.actor_kind::text || '|' || a.request_id::text from public.audit_log a join public.orgs o on o.id = a.org_id where o.slug = 'org-c-test' and a.action = 'org.create'), 'default_workspace_id,first_membership_id,kind|system|e1000000-0000-4000-8000-000000000001', 'create_org: org.create carries the exact keys, actor_kind system and the request id');
select matches(pg_temp.try($$select private.create_org('Org C Again', 'org-c-test', 'customer', '00000000-0000-4000-8000-000000000031', 'Persona C Owner Two', 'e1000000-0000-4000-8000-000000000002')$$), '^23505', 'create_org: a duplicate slug is refused');
select matches(pg_temp.try($$select private.create_org('Org D', 'org-d-test', 'customer', '00000000-0000-4000-8000-0000000000aa', 'Persona Nobody', 'e1000000-0000-4000-8000-000000000003')$$), '^23503', 'create_org: an owner that is not an auth user is refused');
select is((select count(*)::int from public.orgs where slug = 'org-d-test'), 0, 'create_org: the refused call left no org behind');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$select private.create_org('Org E', 'org-e-test', 'customer', '00000000-0000-4000-8000-000000000030', 'Persona C Owner', 'e1000000-0000-4000-8000-000000000004')$$), '42501 TRACE_OPERATOR_ONLY', 'create_org: a session with a user id is not the operator, even as postgres');
reset role;
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select private.create_org('Org E', 'org-e-test', 'customer', '00000000-0000-4000-8000-000000000030', 'Persona C Owner', 'e1000000-0000-4000-8000-000000000005')$$), '^42501 permission denied', 'create_org: an org owner cannot call it');
reset role;
reset request.jwt.claims;

select * from finish();
rollback;
