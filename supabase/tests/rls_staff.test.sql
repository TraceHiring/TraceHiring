-- rls_staff (spec specs/m0b-tenancy.md §6, row "rls_staff"; §3.7 platform_staff and staff_access_grants, §3.9 matrix,
-- §1.2 no staff read path in M0b, AT-B4, §10 edge cases). Written from the spec, not from the migration.
-- Personas are synthetic (p-<persona>@example.test). try() returns 'OK <rows>' or '<sqlstate> <message>'.
-- The fixture grant d1000000-...-001 gives `staff` support_read on org A for one hour (approved by `staff2`).
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
select plan(87);
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

-- ===== platform_staff: own active row only =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000f", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(user_id) from public.platform_staff), array['00000000-0000-4000-8000-00000000000f']::uuid[], 'S: staff sees its own platform_staff row only');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000010", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(user_id) from public.platform_staff), array['00000000-0000-4000-8000-000000000010']::uuid[], 'S: another staff member sees only its own row, not the first one''s');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.platform_staff), 0, 'S: an org owner sees no platform_staff row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.platform_staff), 0, 'S: an org B admin sees no platform_staff row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000011", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.platform_staff), 0, 'S: a signed-in user who is not staff sees no platform_staff row');
reset role;
reset request.jwt.claims;
insert into public.platform_staff (user_id, org_id, active) values ('00000000-0000-4000-8000-000000000020', 'a1000000-0000-4000-8000-000000000004', false);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000020", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.platform_staff), 0, 'S: an inactive staff member does not see its own row');
reset role;
reset request.jwt.claims;
set local role anon;
select matches(pg_temp.try('select * from public.platform_staff'), '^42501 permission denied', 'S: anon has no privilege on platform_staff');
reset role;
reset request.jwt.claims;
set local role service_role;
select matches(pg_temp.try('select * from public.platform_staff'), '^42501 permission denied', 'S: service_role has no table grant on platform_staff');
reset role;
reset request.jwt.claims;
set local role trace_worker;
select matches(pg_temp.try('select * from public.platform_staff'), '^42501 permission denied', 'S: trace_worker has no privilege on platform_staff');
reset role;
reset request.jwt.claims;
set local role trace_candidate;
select matches(pg_temp.try('select * from public.platform_staff'), '^42501 permission denied', 'S: trace_candidate has no privilege on platform_staff');
reset role;
reset request.jwt.claims;

-- ===== platform_staff: operator-written only =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000f", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.platform_staff (user_id, org_id) values ('00000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000004')$$), '^42501 permission denied', 'I: staff cannot insert a platform_staff row');
select matches(pg_temp.try($$update public.platform_staff set capabilities = '{}' where user_id = '00000000-0000-4000-8000-00000000000f'$$), '^42501 permission denied', 'U: staff cannot update its own platform_staff row');
select matches(pg_temp.try($$delete from public.platform_staff where user_id = '00000000-0000-4000-8000-00000000000f'$$), '^42501 permission denied', 'D: staff cannot delete its platform_staff row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.platform_staff (user_id, org_id) values ('00000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001')$$), '^42501 permission denied', 'I: an org owner cannot make someone staff');
reset role;
reset request.jwt.claims;
select matches(pg_temp.try($$insert into public.platform_staff (user_id, org_id) values ('00000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001')$$), '^23514 TRACE_STAFF_ORG', 'I: even the operator cannot put staff in a customer org');
select matches(pg_temp.try($$update public.platform_staff set org_id = 'a1000000-0000-4000-8000-000000000001' where user_id = '00000000-0000-4000-8000-00000000000f'$$), '^23514 TRACE_STAFF_ORG', 'U: even the operator cannot move staff to a customer org');
select matches(pg_temp.try($$insert into public.platform_staff (user_id, org_id, capabilities) values ('00000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000004', '{admin}')$$), '^23514', 'I: capabilities are limited to support_read');
select is(pg_temp.try($$insert into public.platform_staff (user_id, org_id) values ('00000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000004')$$), 'OK 1', 'I: the operator can add staff to the trace_internal org');

-- ===== staff_access_grants: read =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(ticket_ref) from public.staff_access_grants), array['TKT-001'], 'S: an org owner sees the grants on its org');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(ticket_ref) from public.staff_access_grants), array['TKT-001'], 'S: an org admin sees the grants on its org');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.staff_access_grants), 0, 'S: org B admin does not see grants on org A (cross-org)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000f", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(ticket_ref) from public.staff_access_grants), array['TKT-001'], 'S: staff sees its own grants');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000010", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.staff_access_grants), 0, 'S: the approving staff member sees no grant it was not given');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.staff_access_grants), 0, 'S: a recruiter sees no grants');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.staff_access_grants), 0, 'S: a reviewer sees no grants');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.staff_access_grants), 0, 'S: admin at aal1 sees no grants [AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000011", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.staff_access_grants), 0, 'S: a user without a membership sees no grants');
reset role;
reset request.jwt.claims;
set local role anon;
select matches(pg_temp.try('select * from public.staff_access_grants'), '^42501 permission denied', 'S: anon has no privilege on staff_access_grants');
reset role;
reset request.jwt.claims;
set local role service_role;
select matches(pg_temp.try('select * from public.staff_access_grants'), '^42501 permission denied', 'S: service_role has no table grant on staff_access_grants');
reset role;
reset request.jwt.claims;
set local role trace_worker;
select matches(pg_temp.try('select * from public.staff_access_grants'), '^42501 permission denied', 'S: trace_worker has no privilege on staff_access_grants');
reset role;
reset request.jwt.claims;

-- ===== Staff with an active grant read zero org A rows (no staff read policy in M0b) =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000f", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'staff with an active grant reads zero orgs');
select is((select count(*)::int from public.memberships), 0, 'staff with an active grant reads zero memberships');
select is((select count(*)::int from public.workspaces), 0, 'staff with an active grant reads zero workspaces');
select is((select count(*)::int from public.teams), 0, 'staff with an active grant reads zero teams');
select is((select count(*)::int from public.audit_log), 0, 'staff with an active grant reads zero audit rows');
select matches(pg_temp.try('select * from public.idempotency_keys'), '^42501 permission denied', 'staff with an active grant has no privilege on idempotency_keys');
reset role;
reset request.jwt.claims;

-- ===== staff_access_grants: written by private.grant_staff_access only =====
select is(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-000000000010', 'TKT-002', 'support_read', now() + interval '2 hours', 'e1000000-0000-4000-8000-000000000021')$$), 'OK 1', 'grant: the operator creates a two hour grant');
select is((select pg_temp.keys(a.details) || '|' || a.actor_kind::text || '|' || (a.staff_grant_id = a.object_id)::text || '|' || a.request_id::text from public.audit_log a join public.staff_access_grants g on g.id = a.object_id where a.action = 'staff_grant.create' and g.ticket_ref = 'TKT-002'), 'expires_at,scope|system|true|e1000000-0000-4000-8000-000000000021', 'event: staff_grant.create has the keys scope and expires_at, actor_kind system, the grant id and the request id');
select is((select a.details ->> 'scope' from public.audit_log a join public.staff_access_grants g on g.id = a.object_id where a.action = 'staff_grant.create' and g.ticket_ref = 'TKT-002'), 'support_read', 'event: staff_grant.create records the scope');
select is((select count(*)::int from public.audit_log where action = 'staff_grant.create' and details::text like '%TKT-%'), 0, 'event: staff_grant.create never stores the ticket reference');
select is(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-000000000010', 'TKT-003', 'support_read', now() + interval '4 hours', 'e1000000-0000-4000-8000-000000000022')$$), 'OK 1', 'grant: exactly four hours is allowed');
select matches(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-000000000010', 'TKT-004', 'support_read', now() + interval '4 hours 1 minute', 'e1000000-0000-4000-8000-000000000023')$$), '^23514', 'grant: longer than four hours violates the CHECK');
select matches(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-00000000000f', 'TKT-005', 'support_read', now() + interval '1 hour', 'e1000000-0000-4000-8000-000000000024')$$), '^23514', 'grant: a self-approved grant violates the CHECK');
select matches(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-000000000010', 'TKT-006', 'support_read', now(), 'e1000000-0000-4000-8000-000000000025')$$), '^23514', 'grant: a grant that expires when it starts violates the CHECK');
select matches(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-000000000010', 'x y', 'support_read', now() + interval '1 hour', 'e1000000-0000-4000-8000-000000000026')$$), '^23514', 'grant: a malformed ticket reference violates the CHECK');
select matches(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-000000000012', 'TKT-007', 'support_read', now() + interval '1 hour', 'e1000000-0000-4000-8000-000000000027')$$), '^23503', 'grant: the approver must be platform staff');
select matches(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000025', '00000000-0000-4000-8000-000000000010', 'TKT-008', 'support_read', now() + interval '1 hour', 'e1000000-0000-4000-8000-000000000028')$$), '^23503', 'grant: the grantee must be platform staff');
-- B0-DB7: the grantee and the approver must be active staff, and the grantee must hold the scope as a capability.
select is(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'TKT-010', 'support_read', now() + interval '1 hour', 'e1000000-0000-4000-8000-00000000002a')$$), '42501 TRACE_STAFF_INACTIVE', 'grant: an inactive staff member cannot be granted access');
select is(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-000000000020', 'TKT-011', 'support_read', now() + interval '1 hour', 'e1000000-0000-4000-8000-00000000002b')$$), '42501 TRACE_STAFF_INACTIVE', 'grant: an inactive staff member cannot approve a grant');
select is(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000010', 'TKT-012', 'support_read', now() + interval '1 hour', 'e1000000-0000-4000-8000-00000000002c')$$), '42501 TRACE_STAFF_SCOPE', 'grant: a staff member without the scope as a capability cannot be granted it');
select is((select count(*)::int from public.staff_access_grants where org_id = 'a1000000-0000-4000-8000-000000000001'), 3, 'grant: only the three valid grants exist (fixture, TKT-002, TKT-003)');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-000000000010', 'TKT-009', 'support_read', now() + interval '1 hour', 'e1000000-0000-4000-8000-000000000029')$$), '42501 TRACE_OPERATOR_ONLY', 'grant: a session with a user id is not the operator');
reset role;
reset request.jwt.claims;

-- ===== staff_access_grants: app callers cannot insert or delete =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.staff_access_grants (org_id, staff_user_id, ticket_ref, expires_at, approved_by) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', 'TKT-010', now() + interval '1 hour', '00000000-0000-4000-8000-000000000010')$$), '^42501 permission denied', 'I: an org owner cannot insert a grant');
select matches(pg_temp.try($$delete from public.staff_access_grants$$), '^42501 permission denied', 'D: an org owner cannot delete a grant');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.staff_access_grants (org_id, staff_user_id, ticket_ref, expires_at, approved_by) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', 'TKT-010', now() + interval '1 hour', '00000000-0000-4000-8000-000000000010')$$), '^42501 permission denied', 'I: an org admin cannot insert a grant');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000f", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.staff_access_grants (org_id, staff_user_id, ticket_ref, expires_at, approved_by) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', 'TKT-010', now() + interval '1 hour', '00000000-0000-4000-8000-000000000010')$$), '^42501 permission denied', 'I: staff cannot grant themselves access');
select matches(pg_temp.try($$delete from public.staff_access_grants$$), '^42501 permission denied', 'D: staff cannot delete a grant');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.staff_access_grants (org_id, staff_user_id, ticket_ref, expires_at, approved_by) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', 'TKT-010', now() + interval '1 hour', '00000000-0000-4000-8000-000000000010')$$), '^42501 permission denied', 'I: org B admin cannot insert a grant on org A (cross-org)');
set local role trace_worker;
select matches(pg_temp.try($$insert into public.staff_access_grants (org_id, staff_user_id, ticket_ref, expires_at, approved_by) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', 'TKT-010', now() + interval '1 hour', '00000000-0000-4000-8000-000000000010')$$), '^42501 permission denied', 'I: trace_worker cannot insert a grant');
reset role;
reset request.jwt.claims;

-- ===== staff_access_grants: revoke once, nothing else changes =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.staff_access_grants set revoked_at = now() where ticket_ref = 'TKT-001'$$), 'OK 0', 'U: a recruiter cannot revoke a grant');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.staff_access_grants set revoked_at = now() where ticket_ref = 'TKT-001'$$), 'OK 0', 'U: admin at aal1 cannot revoke a grant [AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.staff_access_grants set revoked_at = now() where ticket_ref = 'TKT-001'$$), 'OK 0', 'U: org B admin cannot revoke a grant on org A (cross-org)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000f", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.staff_access_grants set revoked_at = now() where ticket_ref = 'TKT-001'$$), 'OK 0', 'U: staff cannot revoke their own grant');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.staff_access_grants set expires_at = expires_at + interval '1 hour' where ticket_ref = 'TKT-002'$$), '^42501 permission denied', 'U: changing expires_at is not allowed (column grant)');
select matches(pg_temp.try($$update public.staff_access_grants set staff_user_id = '00000000-0000-4000-8000-000000000010' where ticket_ref = 'TKT-002'$$), '^42501 permission denied', 'U: changing the grantee is not allowed (column grant)');
select is(pg_temp.try($$update public.staff_access_grants set revoked_at = now(), revoked_by = '00000000-0000-4000-8000-000000000001' where ticket_ref = 'TKT-001'$$), 'OK 1', 'U: an org admin revokes a grant, passing a forged revoked_by');
select matches(pg_temp.try($$update public.staff_access_grants set revoked_at = now() where ticket_ref = 'TKT-001'$$), '^42501 TRACE_GUARD', 'U: a second revoke of the same grant is refused');
select matches(pg_temp.try($$update public.staff_access_grants set revoked_at = null, revoked_by = null where ticket_ref = 'TKT-001'$$), '^42501 TRACE_GUARD', 'U: a revoked grant cannot be un-revoked');
reset role;
reset request.jwt.claims;
select is((select revoked_by from public.staff_access_grants where ticket_ref = 'TKT-001'), '00000000-0000-4000-8000-000000000003'::uuid, 'U: revoked_by is the caller''s user id, not the forged value');
select is((select revoked_at is not null from public.staff_access_grants where ticket_ref = 'TKT-001'), true, 'U: revoked_at is set');
select is((select pg_temp.keys(a.details) || '|' || a.actor_kind::text || '|' || array_to_string(a.actor_roles, '+') || '|' || (a.staff_grant_id = a.object_id)::text from public.audit_log a join public.staff_access_grants g on g.id = a.object_id where a.action = 'staff_grant.revoke' and g.ticket_ref = 'TKT-001'), '|org_user|admin|true', 'event: staff_grant.revoke has empty details, the admin as actor and the grant id');
select matches(pg_temp.try($$update public.staff_access_grants set expires_at = expires_at + interval '1 hour' where ticket_ref = 'TKT-002'$$), '^42501 TRACE_GUARD', 'U: even the operator cannot change expires_at');
select matches(pg_temp.try($$update public.staff_access_grants set ticket_ref = 'TKT-999' where ticket_ref = 'TKT-002'$$), '^42501 TRACE_GUARD', 'U: even the operator cannot change the ticket reference');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000f", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(ticket_ref order by ticket_ref) from public.staff_access_grants), array['TKT-001', 'TKT-002', 'TKT-003'], 'S: staff still sees its own grants after one is revoked');
reset role;
reset request.jwt.claims;

-- ===== EXECUTE on the operator functions (AT-B4) =====
select is(has_function_privilege('postgres', 'private.create_org(text, text, public.org_kind, uuid, text, uuid)', 'EXECUTE'), true, 'EXECUTE: the owner can run create_org');
select is(has_function_privilege('postgres', 'private.add_member(uuid, uuid, public.org_role[], text, uuid)', 'EXECUTE'), true, 'EXECUTE: the owner can run add_member');
select is(has_function_privilege('postgres', 'private.grant_staff_access(uuid, uuid, uuid, text, public.staff_grant_scope, timestamptz, uuid)', 'EXECUTE'), true, 'EXECUTE: the owner can run grant_staff_access');
select is(has_function_privilege('postgres', 'private.create_audit_partition(date)', 'EXECUTE'), true, 'EXECUTE: the owner can run create_audit_partition');
select is((select count(*)::int from unnest(array['authenticated', 'service_role', 'trace_worker', 'anon']) as r(rolname) cross join unnest(array['private.create_org(text, text, public.org_kind, uuid, text, uuid)', 'private.add_member(uuid, uuid, public.org_role[], text, uuid)', 'private.grant_staff_access(uuid, uuid, uuid, text, public.staff_grant_scope, timestamptz, uuid)', 'private.create_audit_partition(date)']) as f(sig) where has_function_privilege(r.rolname, f.sig, 'EXECUTE')), 0, 'EXECUTE: authenticated, service_role, trace_worker and anon hold EXECUTE on none of the four operator functions');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select private.create_org('Org X', 'org-x-test', 'customer', '00000000-0000-4000-8000-000000000030', 'Persona C Owner', 'e1000000-0000-4000-8000-000000000031')$$), '^42501 permission denied', 'EXECUTE: authenticated cannot call create_org');
select matches(pg_temp.try($$select private.add_member('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', '{recruiter}', 'Hire Two', 'e1000000-0000-4000-8000-000000000032')$$), '^42501 permission denied', 'EXECUTE: authenticated cannot call add_member');
select matches(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-000000000010', 'TKT-011', 'support_read', now() + interval '1 hour', 'e1000000-0000-4000-8000-000000000033')$$), '^42501 permission denied', 'EXECUTE: authenticated cannot call grant_staff_access');
select matches(pg_temp.try($$select private.create_audit_partition(date '2098-01-01')$$), '^42501 permission denied', 'EXECUTE: authenticated cannot call create_audit_partition');
reset role;
reset request.jwt.claims;
set local role service_role;
select matches(pg_temp.try($$select private.create_org('Org X', 'org-x-test', 'customer', '00000000-0000-4000-8000-000000000030', 'Persona C Owner', 'e1000000-0000-4000-8000-000000000034')$$), '^42501 permission denied', 'EXECUTE: service_role cannot call create_org');
select matches(pg_temp.try($$select private.create_audit_partition(date '2098-01-01')$$), '^42501 permission denied', 'EXECUTE: service_role cannot call create_audit_partition');
reset role;
reset request.jwt.claims;
set local role trace_worker;
select matches(pg_temp.try($$select private.add_member('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', '{recruiter}', 'Hire Two', 'e1000000-0000-4000-8000-000000000035')$$), '^42501 permission denied', 'EXECUTE: trace_worker cannot call add_member');
select matches(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-000000000010', 'TKT-012', 'support_read', now() + interval '1 hour', 'e1000000-0000-4000-8000-000000000036')$$), '^42501 permission denied', 'EXECUTE: trace_worker cannot call grant_staff_access');
reset role;
reset request.jwt.claims;

select * from finish();
rollback;
