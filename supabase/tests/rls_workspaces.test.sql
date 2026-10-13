-- rls_workspaces (spec specs/m0b-tenancy.md §6, row "rls_workspaces"; §3.3 workspaces, §3.5 workspace scope,
-- §3.9 matrix, §4.5 workspace.* details). Written from the spec, not from the migration.
-- Personas are synthetic (p-<persona>@example.test). try() returns 'OK <rows>' or '<sqlstate> <message>'.
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
select plan(57);
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

-- ===== S: org-wide members see every workspace of their org; a scoped recruiter sees only its own =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(name order by name) from public.workspaces), array['Client A2', 'Default'], 'S: org_owner sees both org A workspaces and nothing of org S, B or T');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.workspaces), 2, 'S: admin sees both org A workspaces');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.workspaces), 2, 'S: an org-wide recruiter sees both org A workspaces');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.workspaces), 2, 'S: reviewer sees both org A workspaces');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.workspaces), 2, 'S: hiring_manager sees both org A workspaces');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array_agg(id) from public.workspaces), array['b1000000-0000-4000-8000-000000000002']::uuid[], 'S: the recruiter scoped to workspace A2 sees A2 only');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array_agg(id) from public.workspaces), array['b1000000-0000-4000-8000-000000000004']::uuid[], 'S: org B admin sees the org B workspace only (org A denied)');

-- ===== S: callers that must see nothing =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.workspaces), 0, 'S: admin at aal1 sees no workspace [AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.workspaces), 0, 'S: password recruiter at aal1 sees no workspace [AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000a", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.workspaces), 0, 'S: invited member sees no workspace');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000b", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.workspaces), 0, 'S: removed member sees no workspace');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000c", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.workspaces), 0, 'S: suspended member sees no workspace');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000011", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.workspaces), 0, 'S: user without a membership sees no workspace');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000f", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.workspaces), 0, 'S: staff with an active grant on org A sees no workspace');
reset role;
reset request.jwt.claims;
set local role anon;
select matches(pg_temp.try('select * from public.workspaces'), '^42501 permission denied', 'S: anon has no privilege on workspaces');
reset role;
reset request.jwt.claims;
set local role trace_candidate;
select matches(pg_temp.try('select * from public.workspaces'), '^42501 permission denied', 'S: trace_candidate has no privilege on workspaces');
reset role;
reset request.jwt.claims;

-- ===== I: owner and admin add client workspaces; everything else is refused =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.workspaces (org_id, name, kind) values ('a1000000-0000-4000-8000-000000000001', 'Client Two', 'client')$$), 'OK 1', 'I: admin adds a client workspace');
select matches(pg_temp.try($$insert into public.workspaces (org_id, name, kind) values ('a1000000-0000-4000-8000-000000000001', 'Second Default', 'default')$$), '^42501', 'I: admin adding a default workspace is refused');
select matches(pg_temp.try($$insert into public.workspaces (org_id, name, kind, is_default) values ('a1000000-0000-4000-8000-000000000001', 'Flagged', 'client', true)$$), '^42501 permission denied', 'I: is_default is not a writable column');
select matches(pg_temp.try($$insert into public.workspaces (org_id, name, kind) values ('a1000000-0000-4000-8000-000000000003', 'Cross Org', 'client')$$), '^42501', 'I: org A admin cannot add a workspace to org B (cross-org)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.workspaces (org_id, name, kind) values ('a1000000-0000-4000-8000-000000000001', 'Client Three', 'client')$$), 'OK 1', 'I: org_owner adds a client workspace');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.workspaces (org_id, name, kind) values ('a1000000-0000-4000-8000-000000000001', 'Recruiter Ws', 'client')$$), '^42501', 'I: recruiter cannot add a workspace');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.workspaces (org_id, name, kind) values ('a1000000-0000-4000-8000-000000000001', 'Scoped Ws', 'client')$$), '^42501', 'I: a scoped recruiter cannot add a workspace');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.workspaces (org_id, name, kind) values ('a1000000-0000-4000-8000-000000000001', 'Reviewer Ws', 'client')$$), '^42501', 'I: reviewer cannot add a workspace');
-- B0-SP7 matrix gap: a hiring_manager cannot add a workspace either.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.workspaces (org_id, name, kind) values ('a1000000-0000-4000-8000-000000000001', 'Hm Ws', 'client')$$), '^42501', 'I: hiring_manager cannot add a workspace');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.workspaces (org_id, name, kind) values ('a1000000-0000-4000-8000-000000000001', 'Aal1 Ws', 'client')$$), '^42501', 'I: admin at aal1 cannot add a workspace [AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.workspaces (org_id, name, kind) values ('a1000000-0000-4000-8000-000000000001', 'Into A', 'client')$$), '^42501', 'I: org B admin cannot add a workspace to org A (cross-org)');
select is(pg_temp.try($$insert into public.workspaces (org_id, name, kind) values ('a1000000-0000-4000-8000-000000000003', 'B Client', 'client')$$), 'OK 1', 'I: org B admin can add a client workspace to org B');
set local role trace_candidate;
select matches(pg_temp.try($$insert into public.workspaces (org_id, name, kind) values ('a1000000-0000-4000-8000-000000000001', 'Candidate Ws', 'client')$$), '^42501 permission denied', 'I: trace_candidate cannot insert');
reset role;
reset request.jwt.claims;
select is((select count(*)::int from public.workspaces where org_id = 'a1000000-0000-4000-8000-000000000001' and is_default), 1, 'I: org A still has exactly one default workspace');

-- ===== Events workspace.create =====
select is((select pg_temp.keys(a.details) || '|' || a.actor_kind::text || '|' || array_to_string(a.actor_roles, '+') || '|' || (a.workspace_id = a.object_id)::text from public.audit_log a join public.workspaces w on w.id = a.object_id where a.action = 'workspace.create' and w.name = 'Client Two'), 'kind|org_user|admin|true', 'event: workspace.create has the key kind, an org_user actor with its roles and the workspace id');
select is((select a.details ->> 'kind' from public.audit_log a join public.workspaces w on w.id = a.object_id where a.action = 'workspace.create' and w.name = 'Client Two'), 'client', 'event: workspace.create records the kind');

-- ===== U: rename (owner and admin), refusals =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.workspaces set name = 'Client Two Renamed' where name = 'Client Two'$$), 'OK 1', 'U: admin renames a workspace');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.workspaces set name = 'Client Three Renamed' where name = 'Client Three'$$), 'OK 1', 'U: org_owner renames a workspace');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.workspaces set name = 'Recruiter Rename' where org_id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: recruiter update affects no row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.workspaces set name = 'Scoped Rename' where id = 'b1000000-0000-4000-8000-000000000002'$$), 'OK 0', 'U: a scoped recruiter cannot rename even its own workspace');
-- B0-SP7 matrix gap: a reviewer reads every org A workspace but cannot rename one.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.workspaces set name = 'Reviewer Rename' where org_id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: reviewer update affects no row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.workspaces set name = 'Aal1 Rename' where org_id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: admin at aal1 update affects no row [AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.workspaces set name = 'Cross Org Rename' where org_id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: org B admin cannot rename org A workspaces (cross-org)');
reset role;
reset request.jwt.claims;
select is((select array_agg(name order by name) from public.workspaces where org_id = 'a1000000-0000-4000-8000-000000000001'), array['Client A2', 'Client Three Renamed', 'Client Two Renamed', 'Default'], 'U: org A workspace names are exactly the allowed renames');

-- ===== U: archive, default workspace, immutable columns =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.workspaces set archived_at = now() where name = 'Client Three Renamed'$$), 'OK 1', 'U: admin archives a client workspace');
select matches(pg_temp.try($$update public.workspaces set archived_at = now() where id = 'b1000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD', 'U: the default workspace cannot be archived');
select matches(pg_temp.try($$update public.workspaces set kind = 'default' where name = 'Client Two Renamed'$$), '^42501 permission denied', 'U: kind is not an updatable column');
select matches(pg_temp.try($$update public.workspaces set is_default = true where name = 'Client Two Renamed'$$), '^42501 permission denied', 'U: is_default is not an updatable column');
select matches(pg_temp.try($$update public.workspaces set org_id = 'a1000000-0000-4000-8000-000000000003' where name = 'Client Two Renamed'$$), '^42501 permission denied', 'U: org_id is not an updatable column');
reset role;
reset request.jwt.claims;
select is((select archived_at is not null from public.workspaces where name = 'Client Three Renamed'), true, 'U: the client workspace is archived');
select is((select archived_at is null from public.workspaces where id = 'b1000000-0000-4000-8000-000000000001'), true, 'U: the default workspace is not archived');
select matches(pg_temp.try($$update public.workspaces set kind = 'client' where id = 'b1000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD', 'U: even the operator cannot change kind (immutable)');
select matches(pg_temp.try($$update public.workspaces set org_id = 'a1000000-0000-4000-8000-000000000003' where name = 'Client Two Renamed'$$), '^42501 TRACE_GUARD', 'U: even the operator cannot move a workspace to another org');
select matches(pg_temp.try($$update public.workspaces set archived_at = now() where id = 'b1000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD', 'U: even the operator cannot archive the default workspace');

-- ===== D denied =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$delete from public.workspaces where name = 'Client Two Renamed'$$), '^42501 permission denied', 'D: org_owner cannot delete a workspace');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$delete from public.workspaces where name = 'Client Two Renamed'$$), '^42501 permission denied', 'D: admin cannot delete a workspace');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$delete from public.workspaces where org_id = 'a1000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'D: org B admin cannot delete org A workspaces (cross-org)');
reset role;
reset request.jwt.claims;

-- ===== Events workspace.update and workspace.archive =====
select is((select pg_temp.keys(a.details) || '|' || (a.details -> 'changed')::text || '|' || a.actor_kind::text from public.audit_log a join public.workspaces w on w.id = a.object_id where a.action = 'workspace.update' and w.name = 'Client Two Renamed'), 'changed,kind|["name"]|org_user', 'event: workspace.update has the keys kind and changed = name');
select is((select count(*)::int from public.audit_log where action = 'workspace.update' and details::text like '%Renamed%'), 0, 'event: workspace.update never stores the workspace name');
select is((select pg_temp.keys(a.details) || '|' || a.actor_kind::text || '|' || array_to_string(a.actor_roles, '+') from public.audit_log a join public.workspaces w on w.id = a.object_id where a.action = 'workspace.archive' and w.name = 'Client Three Renamed'), 'kind|org_user|admin', 'event: workspace.archive has the key kind and the admin as actor');
select is((select count(*)::int from public.audit_log where action = 'workspace.archive' and object_id = 'b1000000-0000-4000-8000-000000000001'), 0, 'event: the refused archive of the default workspace wrote no event');

select * from finish();
rollback;
