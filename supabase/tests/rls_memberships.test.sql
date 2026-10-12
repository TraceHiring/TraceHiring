-- rls_memberships (spec specs/m0b-tenancy.md §6, row "rls_memberships"; §2.2 own-row exception, §2.4/§2.6 request_id,
-- §2.8 operator path, §3.5 state machine and guard, §3.9 matrix, §4.5 membership.* details, §10 edge cases).
-- Written from the spec, not from the migration. Personas are synthetic (p-<persona>@example.test).
-- Org C (operator-inserted below) is the sandbox for the last-owner rule. try() returns 'OK <rows>' or '<sqlstate> <message>'.
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
select plan(139);
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

-- Org C: one owner, used by the deferred last-owner cases only.
insert into public.orgs (id, kind, name, slug) values ('a1000000-0000-4000-8000-000000000005', 'customer', 'Org C', 'org-c-test');
insert into public.memberships (org_id, user_id, roles, display_name, status) values
  ('a1000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000030', '{org_owner,admin}', 'Persona C Owner', 'active');

-- ===== S: own row at any aal, whatever the status =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array_agg(user_id) from public.memberships), array['00000000-0000-4000-8000-000000000006']::uuid[], 'S: a password recruiter at aal1 sees its own membership row only [S18, AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array_agg(user_id) from public.memberships), array['00000000-0000-4000-8000-000000000004']::uuid[], 'S: admin at aal1 sees its own membership row only (not the org directory) [S18, AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000b", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array_agg(status::text) from public.memberships), array['removed'], 'S: a removed member still sees its own row, and only that');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000a", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array_agg(status::text) from public.memberships), array['invited'], 'S: an invited member sees its own row only [N2]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000c", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array_agg(status::text) from public.memberships), array['suspended'], 'S: a suspended member sees its own row only');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000011", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.memberships), 0, 'S: a user without any membership sees no row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000f", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.memberships), 0, 'S: staff with an active grant on org A sees no membership row');

-- ===== S: owner and admin see every row of their org =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.memberships where org_id = 'a1000000-0000-4000-8000-000000000001'), 12, 'S: org_owner sees all 12 org A rows, whatever their status');
select is((select count(*)::int from public.memberships where org_id <> 'a1000000-0000-4000-8000-000000000001'), 0, 'S: org_owner sees no row of org S, B, C or T (cross-org)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.memberships where org_id = 'a1000000-0000-4000-8000-000000000001'), 12, 'S: admin sees all 12 org A rows, whatever their status');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(user_id) from public.memberships), array['00000000-0000-4000-8000-00000000000e']::uuid[], 'S: org B admin sees org B rows only (org A denied)');

-- ===== S: recruiter and reviewer see the directory (invited and active rows) =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.memberships), 10, 'S: recruiter sees the 10 invited or active org A rows');
select is((select count(*)::int from public.memberships where status in ('removed', 'suspended')), 0, 'S: the recruiter directory excludes removed and suspended rows');
select is((select array_agg(distinct status::text order by status::text) from public.memberships), array['active', 'invited'], 'S: the recruiter directory holds exactly the active and invited statuses');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.memberships), 10, 'S: reviewer (aal2) sees the same 10-row directory');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.memberships), 10, 'S: a workspace-scoped recruiter sees the org-wide directory');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array_agg(user_id) from public.memberships), array['00000000-0000-4000-8000-000000000008']::uuid[], 'S: hiring_manager sees its own row only');

-- ===== S: roles without a grant =====
reset role;
reset request.jwt.claims;
set local role anon;
select matches(pg_temp.try('select * from public.memberships'), '^42501 permission denied', 'S: anon has no privilege on memberships');
reset role;
reset request.jwt.claims;
set local role trace_candidate;
select matches(pg_temp.try('select * from public.memberships'), '^42501 permission denied', 'S: trace_candidate has no privilege on memberships');
reset role;
reset request.jwt.claims;

-- ===== S: org S, suspended by the operator, hides everything except the member's own rows [N6, AT-B5] =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000d", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.memberships), 2, 'S: org S admin sees both org S rows while org S is active');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000012", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.memberships), 2, 'S: org S recruiter sees the org S directory while org S is active');
reset role;
reset request.jwt.claims;
update public.orgs set status = 'suspended' where id = 'a1000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000d", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(user_id) from public.memberships), array['00000000-0000-4000-8000-00000000000d']::uuid[], 'S: with the same claims, the admin of suspended org S sees its own row only [N6, AT-B5]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000012", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array_agg(user_id) from public.memberships), array['00000000-0000-4000-8000-000000000012']::uuid[], 'S: the recruiter of suspended org S sees its own row only [N6]');
reset role;
reset request.jwt.claims;

-- ===== AT-B5: the same claims before and after a membership is suspended =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*) > 1 from public.memberships), true, 'S: recruiter sees the directory while its membership is active');
reset role;
reset request.jwt.claims;
update public.memberships set status = 'suspended' where org_id = 'a1000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-000000000005';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.memberships), 1, 'S: with the same claims, a suspended recruiter sees its own row only [AT-B5]');
reset role;
reset request.jwt.claims;
update public.memberships set status = 'active' where org_id = 'a1000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-000000000005';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*) > 1 from public.memberships), true, 'S: reinstated, the same claims see the directory again [AT-B5]');
reset role;
reset request.jwt.claims;

-- ===== Operator detection [R2, D1, V2] =====
select is(private.is_operator_session('postgres', 'none', null), true, 'operator: (postgres, none, no uid) is the operator');
select is(private.is_operator_session('postgres', 'postgres', null), true, 'operator: (postgres, postgres, no uid) is the operator');
select is(private.is_operator_session('authenticator', 'none', null), false, 'operator: authenticator is not the operator');
select is(private.is_operator_session('supabase_auth_admin', 'none', null), false, 'operator: supabase_auth_admin is not the operator');
select is(private.is_operator_session('supabase_admin', 'none', null), false, 'operator: supabase_admin is not the operator');
select is(private.is_operator_session('postgres', 'authenticated', null), false, 'operator: postgres after SET ROLE authenticated is not the operator');
select is(private.is_operator_session('postgres', 'none', '00000000-0000-4000-8000-000000000003'), false, 'operator: postgres with a user id is not the operator');
select is(private.is_operator(), true, 'operator: a plain postgres session without claims is the operator');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(private.is_operator(), false, 'operator: postgres with the claims of admin is not the operator');
reset role;
reset request.jwt.claims;
select matches(pg_get_functiondef('private.is_operator()'::regprocedure), 'is_operator_session\(\s*session_user,\s*current_setting\(''role''\)', 'operator: is_operator() passes session_user and current_setting(role) to is_operator_session [V2]');
select doesnt_match(pg_get_functiondef('private.is_operator()'::regprocedure), 'current_user', 'operator: is_operator() never mentions current_user [V2]');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020', '{org_owner}', 'Hire One')$$), '^42501 TRACE_GUARD', 'operator: postgres with the claims of admin cannot add org_owner [D1]');
reset role;
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020', '{org_owner}', 'Hire One')$$), '^42501 TRACE_GUARD', 'operator: authenticated admin cannot add org_owner [D1]');
reset role;
reset request.jwt.claims;
set local role authenticated;
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020', '{recruiter}', 'Hire One')$$), '^42501', 'operator: authenticated without claims holds no role and is refused (fails closed)');
reset role;
reset request.jwt.claims;

-- ===== I: operator path (add_member, invited) =====
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name, status) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000024', '{recruiter}', 'Hire Five', 'invited')$$), '^OK 1$', 'I: the operator may insert an invited membership [N2]');
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name, status) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', '{recruiter}', 'Hire Two', 'suspended')$$), '^42501 TRACE_GUARD', 'I: the operator cannot insert a suspended membership [N2]');
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name, status) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', '{recruiter}', 'Hire Two', 'removed')$$), '^42501 TRACE_GUARD', 'I: the operator cannot insert a removed membership [N2]');
select matches(pg_temp.try($$select private.add_member('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000025', '{recruiter}', 'Hire Six', 'e1000000-0000-4000-8000-000000000011')$$), '^OK 1$', 'I: private.add_member adds a recruiter [N4]');
select is((select m.status::text || '|' || array_to_string(m.roles, '+') from public.memberships m where m.user_id = '00000000-0000-4000-8000-000000000025'), 'active|recruiter', 'I: add_member inserts the membership as active');
select is((select pg_temp.keys(a.details) || '|' || a.actor_kind::text || '|' || a.request_id::text from public.audit_log a join public.memberships m on m.id = a.object_id where a.action = 'membership.create' and m.user_id = '00000000-0000-4000-8000-000000000025'), 'roles,status,team_id,workspace_id|system|e1000000-0000-4000-8000-000000000011', 'event: add_member writes membership.create with actor_kind system and its request id [N4]');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$select private.add_member('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', '{recruiter}', 'Hire Two', 'e1000000-0000-4000-8000-000000000012')$$), '42501 TRACE_OPERATOR_ONLY', 'I: add_member refuses a session that carries a user id [N4]');
reset role;
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select private.add_member('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', '{recruiter}', 'Hire Two', 'e1000000-0000-4000-8000-000000000012')$$), '^42501 permission denied', 'I: an org admin cannot execute add_member [N4]');
reset role;
reset request.jwt.claims;

-- ===== I: org admin and owner =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name, status) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', '{recruiter}', 'Hire Two', 'active')$$), 'OK 1', 'I: admin adds a recruiter as active');
select is(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020', '{recruiter}', 'Hire One')$$), 'OK 1', 'I: status defaults to active');
select is(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, workspace_id, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000022', '{recruiter}', 'b1000000-0000-4000-8000-000000000002', 'Hire Three')$$), 'OK 1', 'I: admin adds a recruiter scoped to workspace A2');
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name, status) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000023', '{recruiter}', 'Hire Four', 'invited')$$), '^42501 TRACE_GUARD', 'I: an app caller cannot insert an invited membership in M0b [N2]');
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name, status) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000023', '{recruiter}', 'Hire Four', 'suspended')$$), '^42501 TRACE_GUARD', 'I: an app caller cannot insert a suspended membership');
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000023', '{org_owner}', 'Hire Four')$$), '^42501 TRACE_GUARD', 'I: admin adding an org_owner is refused (rule 1'')');
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, workspace_id, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000023', '{admin}', 'b1000000-0000-4000-8000-000000000002', 'Hire Four')$$), '^23514', 'I: an admin scoped to a workspace violates the org-wide CHECK');
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '{recruiter}', 'Self Add')$$), '^42501 TRACE_GUARD', 'I: nobody adds themselves');
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000023', '{recruiter,recruiter}', 'Hire Four')$$), '^23514', 'I: duplicate roles violate valid_roles (EXECUTE on valid_roles works for the writer) [D7]');
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000023', '{}', 'Hire Four')$$), '^23514', 'I: an empty roles array violates valid_roles');
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000bb', '{recruiter}', 'Nobody')$$), '^23503', 'I: a user that is not an auth user is refused');
select matches(pg_temp.try($$insert into public.memberships (id, org_id, user_id, roles, display_name) values ('f1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000023', '{recruiter}', 'Hire Four')$$), '^42501 permission denied', 'I: the id column is not writable');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000023', '{org_owner}', 'Hire Four')$$), 'OK 1', 'I: org_owner adds another owner');
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name, status) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000bc', '{recruiter}', 'Nobody', 'invited')$$), '^42501', 'I: org_owner cannot insert an invited membership either [N2]');
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000bd', '{recruiter}', 'Cross Org')$$), '^42501', 'I: org A owner cannot add a member to org B (cross-org)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000be', '{recruiter}', 'Nobody')$$), '^42501', 'I: recruiter cannot add a member');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000be', '{recruiter}', 'Nobody')$$), '^42501', 'I: reviewer cannot add a member');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000be', '{recruiter}', 'Nobody')$$), '^42501', 'I: hiring_manager cannot add a member');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000be', '{recruiter}', 'Nobody')$$), '^42501', 'I: admin at aal1 cannot add a member [AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000be', '{recruiter}', 'Nobody')$$), '^42501', 'I: org B admin cannot add a member to org A (cross-org)');
set local role trace_candidate;
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000be', '{recruiter}', 'Nobody')$$), '^42501 permission denied', 'I: trace_candidate cannot insert');
reset role;
reset request.jwt.claims;
select is(has_function_privilege('authenticated', 'private.valid_roles(public.org_role[])', 'EXECUTE'), true, 'I: authenticated holds EXECUTE on private.valid_roles [D7]');

-- ===== Events: membership.create =====
select is((select pg_temp.keys(a.details) || '|' || a.actor_kind::text || '|' || array_to_string(a.actor_roles, '+') || '|' || coalesce(a.request_id::text, 'null') from public.audit_log a join public.memberships m on m.id = a.object_id where a.action = 'membership.create' and m.user_id = '00000000-0000-4000-8000-000000000021'), 'roles,status,team_id,workspace_id|org_user|admin|null', 'event: an admin insert after add_member writes request_id null (the saved value was restored) [R3]');
select is((select (a.details -> 'roles')::text || '|' || (a.details ->> 'status') from public.audit_log a join public.memberships m on m.id = a.object_id where a.action = 'membership.create' and m.user_id = '00000000-0000-4000-8000-000000000021'), '["recruiter"]|active', 'event: membership.create records roles and status');
select is((select m.created_by from public.memberships m where m.user_id = '00000000-0000-4000-8000-000000000021'), '00000000-0000-4000-8000-000000000003'::uuid, 'I: created_by is set to the caller''s user id');
select is((select m.created_by from public.memberships m where m.user_id = '00000000-0000-4000-8000-000000000025'), null, 'I: created_by is null on the operator path');

-- ===== Status transitions [R1] =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-00000000000a'$$), '^42501 TRACE_GUARD', 'R1: admin cannot move invited to active (M1 acceptance flow)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.memberships set status = 'invited' where user_id = '00000000-0000-4000-8000-000000000005'$$), '^42501 TRACE_GUARD', 'R1: owner cannot move active to invited');
reset role;
reset request.jwt.claims;
select matches(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-00000000000a'$$), '^42501 TRACE_GUARD', 'R1: even the operator cannot move invited to active');
select matches(pg_temp.try($$update public.memberships set status = 'invited' where user_id = '00000000-0000-4000-8000-000000000005'$$), '^42501 TRACE_GUARD', 'R1: even the operator cannot move active to invited');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-00000000000c'$$), 'OK 1', 'R1: owner moves suspended to active');
select is(pg_temp.try($$update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-00000000000c'$$), 'OK 1', 'R1: owner moves active to suspended');
select matches(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-00000000000b'$$), '^42501 TRACE_GUARD', 'R1: removed is terminal, even for an owner');
reset role;
reset request.jwt.claims;
select matches(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-00000000000b'$$), '^42501 TRACE_GUARD', 'R1: removed is terminal, even for the operator');
select is((select pg_temp.keys(a.details) || '|' || (a.details ->> 'old_status') || '>' || (a.details ->> 'new_status') || '|' || (a.details -> 'changed')::text from public.audit_log a join public.memberships m on m.id = a.object_id where a.action = 'membership.update' and m.user_id = '00000000-0000-4000-8000-00000000000c' and a.actor_kind = 'org_user' and a.details ->> 'new_status' = 'active'), 'changed,new_roles,new_status,old_roles,old_status|suspended>active|["status"]', 'event: membership.update has the exact keys and records the transition');
select is((select count(*)::int from public.audit_log where action = 'membership.update' and details::text like '%Persona%'), 0, 'event: membership.update never stores a display name');

-- ===== U: self-service limits =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.memberships set roles = '{admin}' where user_id = '00000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD', 'U: an owner cannot change their own roles');
select matches(pg_temp.try($$update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD', 'U: an owner cannot suspend themselves');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.memberships set roles = '{org_owner,admin}' where user_id = '00000000-0000-4000-8000-000000000003'$$), '^42501 TRACE_GUARD', 'U: an admin cannot make themselves an owner');
select matches(pg_temp.try($$update public.memberships set status = 'removed' where user_id = '00000000-0000-4000-8000-000000000003'$$), '^42501 TRACE_GUARD', 'U: an admin cannot remove themselves');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.memberships set roles = '{admin}' where user_id = '00000000-0000-4000-8000-000000000005'$$), '^42501 TRACE_GUARD', 'U: a recruiter cannot promote themselves');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.memberships set workspace_id = null where user_id = '00000000-0000-4000-8000-000000000009'$$), '^42501 TRACE_GUARD', 'U: a scoped recruiter cannot widen their own workspace scope');
select matches(pg_temp.try($$update public.memberships set team_id = 'c1000000-0000-4000-8000-000000000001' where user_id = '00000000-0000-4000-8000-000000000009'$$), '^42501 TRACE_GUARD', 'U: a member cannot change their own team');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.memberships set display_name = 'Recruiter Renamed' where user_id = '00000000-0000-4000-8000-000000000005'$$), 'OK 1', 'U: any member may change their own display_name');
select is(pg_temp.try($$update public.memberships set display_name = 'Someone Else' where user_id = '00000000-0000-4000-8000-000000000007'$$), 'OK 0', 'U: a recruiter cannot change another member''s display_name');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.memberships set display_name = 'Admin Renamed' where user_id = '00000000-0000-4000-8000-000000000003'$$), 'OK 1', 'U: an admin may change their own display_name');
reset role;
reset request.jwt.claims;
select is((select pg_temp.keys(a.details) || '|' || (a.details -> 'changed')::text from public.audit_log a join public.memberships m on m.id = a.object_id where a.action = 'membership.update' and m.user_id = '00000000-0000-4000-8000-000000000005' and a.actor_kind = 'org_user' and a.details -> 'changed' = '["display_name"]'::jsonb), 'changed,new_roles,new_status,old_roles,old_status|["display_name"]', 'event: a display_name change writes membership.update with changed = display_name');

-- ===== U: owner protection (rule 1'), D2 =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-000000000002'$$), '^42501 TRACE_GUARD', 'D2: admin cannot suspend an owner');
select matches(pg_temp.try($$update public.memberships set workspace_id = 'b1000000-0000-4000-8000-000000000002' where user_id = '00000000-0000-4000-8000-000000000002'$$), '^42501 TRACE_GUARD', 'D2: admin cannot set an owner''s workspace_id');
select matches(pg_temp.try($$update public.memberships set roles = '{org_owner}' where user_id = '00000000-0000-4000-8000-000000000002'$$), '^42501 TRACE_GUARD', 'D2: admin cannot drop the admin role from an owner');
select matches(pg_temp.try($$update public.memberships set status = 'removed' where user_id = '00000000-0000-4000-8000-000000000002'$$), '^42501 TRACE_GUARD', 'D2: admin cannot remove an owner');
select matches(pg_temp.try($$update public.memberships set roles = '{org_owner,admin}' where user_id = '00000000-0000-4000-8000-000000000005'$$), '^42501 TRACE_GUARD', 'D2: admin cannot escalate a recruiter to owner');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-000000000002'$$), 'OK 1', 'D2: an owner suspends the other owner');
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000002'$$), 'OK 1', 'D2: an owner reinstates the other owner');
reset role;
reset request.jwt.claims;
select is((select count(*)::int from public.memberships where org_id = 'a1000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-000000000002' and status = 'active' and roles = '{org_owner,admin}'), 1, 'D2: owner2 is back to active org_owner+admin after every refused change');

-- ===== U: admin edits non-owner rows =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.memberships set workspace_id = null where user_id = '00000000-0000-4000-8000-000000000009'$$), 'OK 1', 'U: admin widens a recruiter''s workspace scope');
select is(pg_temp.try($$update public.memberships set workspace_id = 'b1000000-0000-4000-8000-000000000002' where user_id = '00000000-0000-4000-8000-000000000009'$$), 'OK 1', 'U: admin narrows a recruiter''s workspace scope');
select is(pg_temp.try($$update public.memberships set team_id = 'c1000000-0000-4000-8000-000000000001' where user_id = '00000000-0000-4000-8000-000000000007'$$), 'OK 1', 'U: admin assigns a team');
select is(pg_temp.try($$update public.memberships set roles = '{reviewer,hiring_manager}' where user_id = '00000000-0000-4000-8000-000000000007'$$), 'OK 1', 'U: admin changes a reviewer''s roles');
select matches(pg_temp.try($$update public.memberships set org_id = 'a1000000-0000-4000-8000-000000000003' where user_id = '00000000-0000-4000-8000-000000000007'$$), '^42501 permission denied', 'U: org_id is not an updatable column');
select matches(pg_temp.try($$update public.memberships set user_id = '00000000-0000-4000-8000-000000000021' where user_id = '00000000-0000-4000-8000-000000000007'$$), '^42501 permission denied', 'U: user_id is not an updatable column');
select matches(pg_temp.try($$update public.memberships set display_name = 'Zombie' where user_id = '00000000-0000-4000-8000-00000000000b'$$), '^42501 TRACE_GUARD', 'U: nothing changes on a removed membership');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-000000000007'$$), 'OK 0', 'U: a recruiter cannot suspend another member');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.memberships set status = 'suspended' where org_id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD', 'U: a hiring_manager reaches only their own row, and cannot change its status');
reset role;
reset request.jwt.claims;
select is((select status::text from public.memberships where org_id = 'a1000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-000000000008'), 'active', 'U: the hiring_manager''s own status change was refused, not applied');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.memberships set display_name = 'Cross Org' where org_id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: org B admin cannot update org A rows (cross-org)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.memberships set display_name = 'Aal1 Edit' where user_id = '00000000-0000-4000-8000-000000000005'$$), 'OK 0', 'U: admin at aal1 cannot update other members [AT-B6]');
reset role;
reset request.jwt.claims;
select matches(pg_temp.try($$update public.memberships set user_id = '00000000-0000-4000-8000-000000000021' where user_id = '00000000-0000-4000-8000-000000000007'$$), '^42501 TRACE_GUARD', 'U: even the operator cannot change user_id');
select matches(pg_temp.try($$update public.memberships set org_id = 'a1000000-0000-4000-8000-000000000003' where user_id = '00000000-0000-4000-8000-000000000007'$$), '^42501 TRACE_GUARD', 'U: even the operator cannot change org_id');
select matches(pg_temp.try($$update public.memberships set display_name = 'Zombie' where user_id = '00000000-0000-4000-8000-00000000000b'$$), '^42501 TRACE_GUARD', 'U: even the operator cannot update a removed membership');

-- ===== Remove and re-add =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.memberships set status = 'removed' where user_id = '00000000-0000-4000-8000-000000000020'$$), 'OK 1', 'U: admin removes a recruiter');
reset role;
reset request.jwt.claims;
select is((select removed_at is not null from public.memberships where user_id = '00000000-0000-4000-8000-000000000020'), true, 'U: removing sets removed_at');
select is((select pg_temp.keys(a.details) || '|' || (a.details ->> 'old_status') from public.audit_log a join public.memberships m on m.id = a.object_id where a.action = 'membership.remove' and m.user_id = '00000000-0000-4000-8000-000000000020'), 'old_status|active', 'event: membership.remove has the key old_status only');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020', '{recruiter}', 'Hire One Again')$$), 'OK 1', 'I: a removed user is re-added as a new row');
reset role;
reset request.jwt.claims;
select is((select count(*)::int || '|' || count(*) filter (where status = 'removed')::int from public.memberships where user_id = '00000000-0000-4000-8000-000000000020'), '2|1', 'I: the old removed row stays and the new row is a second one');
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020', '{recruiter}', 'Hire One Twice')$$), '^23505', 'I: a second live membership for the same user is refused (the partial unique index)');

-- ===== Last owner: deferred constraint, rule 3 [D10] =====
select matches(pg_temp.try($$set constraints memberships_last_owner immediate; update public.memberships set roles = '{admin}' where user_id = '00000000-0000-4000-8000-000000000030'$$), '^23514 TRACE_LAST_OWNER', 'rule 3: demoting the last owner is refused');
select matches(pg_temp.try($$set constraints memberships_last_owner immediate; update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-000000000030'$$), '^23514 TRACE_LAST_OWNER', 'rule 3: suspending the last owner is refused');
select matches(pg_temp.try($$set constraints memberships_last_owner immediate; update public.memberships set status = 'removed' where user_id = '00000000-0000-4000-8000-000000000030'$$), '^23514 TRACE_LAST_OWNER', 'rule 3: removing the last owner is refused');
select is((select roles::text || '|' || status::text from public.memberships where user_id = '00000000-0000-4000-8000-000000000030'), '{org_owner,admin}|active', 'rule 3: the refused changes left the last owner untouched');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-00000000000e'$$), '^42501 TRACE_GUARD', 'rule 2: the sole owner of org B cannot suspend themselves');
select matches(pg_temp.try($$update public.memberships set roles = '{admin}' where user_id = '00000000-0000-4000-8000-00000000000e'$$), '^42501 TRACE_GUARD', 'rule 2: the sole owner of org B cannot demote themselves');
reset role;
reset request.jwt.claims;
select matches(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000031', '{org_owner}', 'Persona C Owner Two'); update public.memberships set roles = '{admin}' where user_id = '00000000-0000-4000-8000-000000000030'; set constraints memberships_last_owner immediate$$), '^OK ', 'rule 3: a hand-over inside one transaction is allowed');
set constraints memberships_last_owner deferred;
select is((select string_agg(user_id::text || ':' || roles::text, ',' order by user_id) from public.memberships where org_id = 'a1000000-0000-4000-8000-000000000005'), '00000000-0000-4000-8000-000000000030:{admin},00000000-0000-4000-8000-000000000031:{org_owner}', 'rule 3: after the hand-over the old owner is an admin and the new owner holds org_owner');

-- ===== D denied for everyone; erasure =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$delete from public.memberships where user_id = '00000000-0000-4000-8000-000000000005'$$), '^42501 permission denied', 'D: org_owner cannot delete a membership');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$delete from public.memberships where user_id = '00000000-0000-4000-8000-000000000005'$$), '^42501 permission denied', 'D: admin cannot delete a membership');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$delete from public.memberships where user_id = '00000000-0000-4000-8000-000000000005'$$), '^42501 permission denied', 'D: a member cannot delete their own membership');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$delete from public.memberships where org_id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'D: org B admin cannot delete org A memberships (cross-org)');
reset role;
reset request.jwt.claims;
select is(has_table_privilege('authenticated', 'public.memberships', 'DELETE'), false, 'D: authenticated holds no DELETE grant on memberships');
select matches(pg_temp.try($$delete from auth.users where id = '00000000-0000-4000-8000-000000000002'$$), '^23503', 'D13: a hard delete of a member''s auth.users row is refused');
select is((select count(*)::int from auth.users where id = '00000000-0000-4000-8000-000000000002'), 1, 'D13: the member''s auth.users row is still there');

select * from finish();
rollback;
