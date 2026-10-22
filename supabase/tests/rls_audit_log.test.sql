-- rls_audit_log (spec specs/m0b-tenancy.md §6, row "rls_audit_log"; §2.4 audit log, §2.5 sign-in events, §4.5 details keys,
-- §10 edge cases, AT-B3). Written from the spec, not from the migration. Personas are synthetic (p-<persona>@example.test).
-- try() returns 'OK <rows>' or '<sqlstate> <message>'. Far-future months (2098, 2099) are used for every uncreated-month
-- fixture; no assertion reads now() [R6, V1].
begin;
-- V1: the first statement, before any persona row (persona setup writes audit rows at now()), creates the current UTC
-- month's partition if it is missing, so the file passes after 2027-12 too.
do $$
begin
  perform private.create_audit_partition(date_trunc('month', now(), 'UTC')::date);
end
$$;
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
select plan(195);
grant trace_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_worker;
grant trace_quality_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_quality_worker;
grant trace_integrity_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_integrity_worker;
grant trace_candidate to postgres with inherit false, set true;
grant usage on schema extensions to trace_candidate;
grant trace_candidate_gateway to postgres with inherit false, set true;
grant usage on schema extensions to trace_candidate_gateway;
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

-- ===== The fixed range and an empty DEFAULT [R6] =====
select is((select count(*)::int from pg_catalog.pg_inherits as i join pg_catalog.pg_class as c on c.oid = i.inhrelid where i.inhparent = 'public.audit_log'::regclass and c.relname ~ '^audit_log_20(26_1[0-2]|27_(0[1-9]|1[0-2]))$'), 15, 'partitions: the fixed range 2026-10 to 2027-12 exists as 15 partitions of audit_log');
select is((select pg_catalog.pg_get_partkeydef('public.audit_log'::regclass)), 'RANGE (occurred_at)', 'partitions: audit_log is partitioned by range on occurred_at');
select is((select count(*)::int from pg_catalog.pg_inherits where inhparent = 'public.audit_log'::regclass and inhrelid = 'public.audit_log_default'::regclass), 1, 'partitions: audit_log_default is a partition of audit_log');
select is((select count(*)::int from public.audit_log_default), 0, 'partitions: DEFAULT is empty after the persona setup');
select is((select count(*) > 0 from public.audit_log), true, 'persona setup wrote audit rows');

-- ===== S: owner and admin read their own org's rows only =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*) > 0 from public.audit_log), true, 'S: org_owner reads audit rows');
select is((select count(*)::int from public.audit_log where org_id <> 'a1000000-0000-4000-8000-000000000001'), 0, 'S: org_owner reads no audit row of another org (cross-org)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*) > 0 from public.audit_log), true, 'S: admin reads audit rows');
select is((select count(*)::int from public.audit_log where org_id <> 'a1000000-0000-4000-8000-000000000001'), 0, 'S: admin reads no audit row of another org (cross-org)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*) > 0 from public.audit_log), true, 'S: org B admin reads org B audit rows');
select is((select count(*)::int from public.audit_log where org_id <> 'a1000000-0000-4000-8000-000000000003'), 0, 'S: org B admin reads no org A audit row (cross-org)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.audit_log), 0, 'S: recruiter reads no audit row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.audit_log), 0, 'S: reviewer reads no audit row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.audit_log), 0, 'S: hiring_manager reads no audit row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.audit_log), 0, 'S: admin at aal1 reads no audit row [AT-B6]');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000a", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.audit_log), 0, 'S: invited member reads no audit row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000f", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.audit_log), 0, 'S: staff with an active grant reads no audit row');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000011", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.audit_log), 0, 'S: a user without a membership reads no audit row');
reset role;
reset request.jwt.claims;

-- ===== I denied for every non-owner role =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.audit_log (org_id, actor_kind, action) values ('a1000000-0000-4000-8000-000000000001', 'org_user', 'forged.event')$$), '^42501 permission denied', 'I: authenticated (an org owner) cannot write an audit row');
set local role trace_worker;
select matches(pg_temp.try($$insert into public.audit_log (org_id, actor_kind, action) values ('a1000000-0000-4000-8000-000000000001', 'system', 'forged.event')$$), '^42501 permission denied', 'I: trace_worker cannot write an audit row');
reset role;
reset request.jwt.claims;
set local role service_role;
select matches(pg_temp.try($$insert into public.audit_log (org_id, actor_kind, action) values ('a1000000-0000-4000-8000-000000000001', 'system', 'forged.event')$$), '^42501 permission denied', 'I: service_role cannot write an audit row');
reset role;
reset request.jwt.claims;
set local role anon;
select matches(pg_temp.try($$insert into public.audit_log (org_id, actor_kind, action) values ('a1000000-0000-4000-8000-000000000001', 'system', 'forged.event')$$), '^42501 permission denied', 'I: anon cannot write an audit row');
select matches(pg_temp.try($$select * from public.audit_log$$), '^42501 permission denied', 'S: anon cannot read audit rows');
reset role;
reset request.jwt.claims;
set local role trace_candidate;
select matches(pg_temp.try($$insert into public.audit_log (org_id, actor_kind, action) values ('a1000000-0000-4000-8000-000000000001', 'candidate', 'forged.event')$$), '^42501 permission denied', 'I: trace_candidate cannot write an audit row');
reset role;
reset request.jwt.claims;
set local role trace_quality_worker;
select matches(pg_temp.try($$insert into public.audit_log (org_id, actor_kind, action) values ('a1000000-0000-4000-8000-000000000001', 'system', 'forged.event')$$), '^42501 permission denied', 'I: trace_quality_worker cannot write an audit row');
reset role;
reset request.jwt.claims;
set local role trace_integrity_worker;
select matches(pg_temp.try($$insert into public.audit_log (org_id, actor_kind, action) values ('a1000000-0000-4000-8000-000000000001', 'system', 'forged.event')$$), '^42501 permission denied', 'I: trace_integrity_worker cannot write an audit row');
reset role;
reset request.jwt.claims;
select matches(pg_temp.try($$insert into public.audit_log (org_id, actor_kind, action, details) values ('a1000000-0000-4000-8000-000000000001', 'system', 'x.y', '{"Bad Key": 1}')$$), '^23514', 'I: details keys must match ^[a-z_]{1,40}$ (even for the owner)');
select matches(pg_temp.try($$insert into public.audit_log (org_id, actor_kind, action) values ('a1000000-0000-4000-8000-000000000001', 'system', 'NoDot')$$), '^23514', 'I: the action must look like object.verb');

-- ===== Events: one case per action of §2.4, exact details keys of §4.5 =====
-- org.create (operator path, create_org)
select is(pg_temp.try($$select private.create_org('Org C', 'org-c-test', 'customer', '00000000-0000-4000-8000-000000000030', 'Persona C Owner', 'e1000000-0000-4000-8000-000000000001')$$), 'OK 1', 'event setup: the operator creates org C');
select is((select pg_temp.keys(a.details) || '|' || a.actor_kind::text || '|' || (a.details ->> 'kind') from public.audit_log a join public.orgs o on o.id = a.object_id where a.action = 'org.create' and o.slug = 'org-c-test'), 'default_workspace_id,first_membership_id,kind|system|customer', 'event org.create: exact keys, actor_kind system');
-- org.update (owner)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.orgs set name = 'Org A Renamed' where id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 1', 'event setup: owner renames org A');
reset role;
reset request.jwt.claims;
select is((select pg_temp.keys(details) || '|' || (details -> 'changed')::text from public.audit_log where action = 'org.update' and object_id = 'a1000000-0000-4000-8000-000000000001'), 'changed|["name"]', 'event org.update: exact keys, changed lists the column name only');
-- workspace.create / update / archive (admin)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.workspaces (org_id, name, kind) values ('a1000000-0000-4000-8000-000000000001', 'Client Two', 'client')$$), 'OK 1', 'event setup: admin adds a workspace');
select is(pg_temp.try($$update public.workspaces set name = 'Client Two Renamed' where name = 'Client Two'$$), 'OK 1', 'event setup: admin renames the workspace');
select is(pg_temp.try($$update public.workspaces set archived_at = now() where name = 'Client Two Renamed'$$), 'OK 1', 'event setup: admin archives the workspace');
reset role;
reset request.jwt.claims;
select is((select pg_temp.keys(a.details) from public.audit_log a join public.workspaces w on w.id = a.object_id where a.action = 'workspace.create' and w.name = 'Client Two Renamed'), 'kind', 'event workspace.create: exact keys');
select is((select pg_temp.keys(a.details) from public.audit_log a join public.workspaces w on w.id = a.object_id where a.action = 'workspace.update' and w.name = 'Client Two Renamed'), 'changed,kind', 'event workspace.update: exact keys');
select is((select pg_temp.keys(a.details) from public.audit_log a join public.workspaces w on w.id = a.object_id where a.action = 'workspace.archive' and w.name = 'Client Two Renamed'), 'kind', 'event workspace.archive: exact keys');
-- team.create / update / delete (admin)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.teams (org_id, name) values ('a1000000-0000-4000-8000-000000000001', 'Team Two')$$), 'OK 1', 'event setup: admin adds a team');
select is(pg_temp.try($$update public.teams set name = 'Team Two Renamed' where name = 'Team Two'$$), 'OK 1', 'event setup: admin renames the team');
reset role;
reset request.jwt.claims;
select is((select pg_temp.keys(a.details) from public.audit_log a join public.teams t on t.id = a.object_id where a.action = 'team.create' and t.name = 'Team Two Renamed'), '', 'event team.create: empty details');
select is((select pg_temp.keys(a.details) from public.audit_log a join public.teams t on t.id = a.object_id where a.action = 'team.update' and t.name = 'Team Two Renamed'), 'changed', 'event team.update: exact keys');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$delete from public.teams where name = 'Team Two Renamed'$$), 'OK 1', 'event setup: admin deletes the team');
reset role;
reset request.jwt.claims;
select is((select pg_temp.keys(details) from public.audit_log where action = 'team.delete'), '', 'event team.delete: empty details');
-- membership.create / update / remove (admin)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.memberships (org_id, user_id, roles, display_name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020', '{recruiter}', 'Hire One')$$), 'OK 1', 'event setup: admin adds a member');
select is(pg_temp.try($$update public.memberships set roles = '{recruiter,reviewer}' where user_id = '00000000-0000-4000-8000-000000000020'$$), 'OK 1', 'event setup: admin changes the member''s roles');
select is(pg_temp.try($$update public.memberships set status = 'removed' where user_id = '00000000-0000-4000-8000-000000000020'$$), 'OK 1', 'event setup: admin removes the member');
reset role;
reset request.jwt.claims;
select is((select pg_temp.keys(a.details) from public.audit_log a join public.memberships m on m.id = a.object_id where a.action = 'membership.create' and m.user_id = '00000000-0000-4000-8000-000000000020'), 'roles,status,team_id,workspace_id', 'event membership.create: exact keys');
select is((select pg_temp.keys(a.details) from public.audit_log a join public.memberships m on m.id = a.object_id where a.action = 'membership.update' and m.user_id = '00000000-0000-4000-8000-000000000020'), 'changed,new_roles,new_status,old_roles,old_status', 'event membership.update: exact keys');
select is((select pg_temp.keys(a.details) from public.audit_log a join public.memberships m on m.id = a.object_id where a.action = 'membership.remove' and m.user_id = '00000000-0000-4000-8000-000000000020'), 'old_status', 'event membership.remove: exact keys');
-- staff_grant.create / revoke
select is(pg_temp.try($$select private.grant_staff_access('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-000000000010', 'TKT-002', 'support_read', now() + interval '2 hours', 'e1000000-0000-4000-8000-000000000002')$$), 'OK 1', 'event setup: the operator grants staff access');
select is((select pg_temp.keys(a.details) from public.audit_log a join public.staff_access_grants g on g.id = a.object_id where a.action = 'staff_grant.create' and g.ticket_ref = 'TKT-002'), 'expires_at,scope', 'event staff_grant.create: exact keys');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.staff_access_grants set revoked_at = now() where ticket_ref = 'TKT-002'$$), 'OK 1', 'event setup: admin revokes the grant');
reset role;
reset request.jwt.claims;
select is((select pg_temp.keys(a.details) from public.audit_log a join public.staff_access_grants g on g.id = a.object_id where a.action = 'staff_grant.revoke' and g.ticket_ref = 'TKT-002'), '', 'event staff_grant.revoke: empty details');
-- auth.sign_in / auth.step_up (rows inserted and updated in auth.sessions as the operator)
insert into auth.sessions (id, user_id, aal) values ('51000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'aal1');
select is((select pg_temp.keys(details) || '|' || (details ->> 'aal') || '|' || actor_kind::text || '|' || actor_user_id::text || '|' || array_to_string(actor_roles, '+') from public.audit_log where action = 'auth.sign_in' and object_id = '51000000-0000-4000-8000-000000000001'), 'aal|aal1|org_user|00000000-0000-4000-8000-000000000003|admin', 'event auth.sign_in: exact keys, one row per active membership, the actor and roles at event time');
insert into auth.sessions (id, user_id, aal) values ('51000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000c', 'aal1'), ('51000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000011', 'aal1');
select is((select count(*)::int from public.audit_log where action = 'auth.sign_in' and object_id in ('51000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000003')), 0, 'event auth.sign_in: a suspended member and a user without a membership write no event');
-- B0-SP3 (spec §2.5): an active membership in a suspended org writes no sign-in event; the same user did while the org was active.
insert into auth.sessions (id, user_id, aal) values ('51000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000012', 'aal1');
select is((select count(*)::int from public.audit_log where action = 'auth.sign_in' and object_id = '51000000-0000-4000-8000-000000000004' and org_id = 'a1000000-0000-4000-8000-000000000002'), 1, 'event auth.sign_in: an active member of an active org writes one event (control for the suspended-org case)');
update public.orgs set status = 'suspended' where id = 'a1000000-0000-4000-8000-000000000002';
insert into auth.sessions (id, user_id, aal) values ('51000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000012', 'aal1');
select is((select count(*)::int from public.audit_log where action = 'auth.sign_in' and object_id = '51000000-0000-4000-8000-000000000005'), 0, 'event auth.sign_in: an active member of a suspended org writes no event');
update auth.sessions set aal = 'aal2' where id = '51000000-0000-4000-8000-000000000001';
select is((select pg_temp.keys(details) || '|' || (details ->> 'aal') || '|' || actor_kind::text from public.audit_log where action = 'auth.step_up' and object_id = '51000000-0000-4000-8000-000000000001'), 'aal|aal2|org_user', 'event auth.step_up: exact keys, written when aal changes');
update auth.sessions set aal = 'aal2', updated_at = now() where id = '51000000-0000-4000-8000-000000000001';
update auth.sessions set updated_at = now() where id = '51000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.audit_log where action = 'auth.step_up' and object_id = '51000000-0000-4000-8000-000000000001'), 1, 'event auth.step_up: an update that leaves aal unchanged writes nothing');
select is((select count(*)::int from public.audit_log where action = 'auth.sign_in' and object_id = '51000000-0000-4000-8000-000000000001'), 1, 'event auth.sign_in: an update never writes another sign-in');
-- No free text in any row
select is((select count(*)::int from public.audit_log where details::text ~* '(example\.test|Persona|Hire One|Renamed|TKT-|@)'), 0, 'events: no row stores a name, email, ticket text or other free text');
select is((select count(*)::int from public.audit_log where object_id is not null and object_table is null), 0, 'events: every row with an object id names its table');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(distinct action)::int from public.audit_log where action in ('org.update', 'workspace.create', 'workspace.update', 'workspace.archive', 'team.create', 'team.update', 'team.delete', 'membership.create', 'membership.update', 'membership.remove', 'staff_grant.create', 'staff_grant.revoke', 'auth.sign_in', 'auth.step_up')), 14, 'S: the org owner reads the events of its own org through the policy');
reset role;
reset request.jwt.claims;

-- ===== create_audit_partition: validation, UTC bounds [E2] =====
select is(pg_temp.try($$select private.create_audit_partition(date '2098-05-15')$$), '22023 TRACE_BAD_MONTH', 'create_audit_partition: a month that is not a month start is refused [E2]');
select is(pg_temp.try($$select private.create_audit_partition(null)$$), '22023 TRACE_BAD_MONTH', 'create_audit_partition: null is refused');
select is(pg_temp.try($$select private.create_audit_partition(date '2026-11-01')$$), 'OK 1', 'create_audit_partition: an existing month is a no-op');
set local timezone = 'Asia/Kolkata';
select is(pg_temp.try($$select private.create_audit_partition(date '2098-04-01')$$), 'OK 1', 'create_audit_partition: 2098-04 is created from an Asia/Kolkata session [E2]');
select is(pg_temp.try($$select private.create_audit_partition(date '2098-05-01')$$), 'OK 1', 'create_audit_partition: 2098-05 is created next to it without an overlap [E2]');
set local timezone = 'UTC';
select is((select pg_catalog.pg_get_expr(relpartbound, oid) from pg_catalog.pg_class where oid = 'public.audit_log_2098_05'::regclass), 'FOR VALUES FROM (''2098-05-01 00:00:00+00'') TO (''2098-06-01 00:00:00+00'')', 'create_audit_partition: bounds are UTC month starts whatever the session timezone [E2]');
insert into public.audit_log (org_id, occurred_at, actor_kind, action) values
  ('a1000000-0000-4000-8000-000000000001', '2098-04-30 23:59:59+00', 'system', 'x.y'),
  ('a1000000-0000-4000-8000-000000000001', '2098-05-01 00:00:00+00', 'system', 'x.y'),
  ('a1000000-0000-4000-8000-000000000001', '2098-05-31 23:59:59+00', 'system', 'x.y');
select is((select string_agg(tableoid::regclass::text, ',' order by occurred_at) from public.audit_log where action = 'x.y' and occurred_at between '2098-04-30' and '2098-06-01'), 'audit_log_2098_04,audit_log_2098_05,audit_log_2098_05', 'create_audit_partition: rows on the month edges land in the right UTC partition [E2]');
select is((select pg_catalog.pg_get_expr(relpartbound, oid) from pg_catalog.pg_class where oid = 'public.audit_log_2098_04'::regclass), 'FOR VALUES FROM (''2098-04-01 00:00:00+00'') TO (''2098-05-01 00:00:00+00'')', 'create_audit_partition: the previous month ends exactly where the next begins [E2]');
select is((select string_agg(tgname || ':' || tgenabled::text, ',' order by tgname) from pg_catalog.pg_trigger where tgrelid = 'public.audit_log_2098_05'::regclass and not tgisinternal), 'audit_log_no_truncate:A,audit_log_no_update_delete:A', 'create_audit_partition: a new partition gets both append-only triggers in ENABLE ALWAYS mode');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.audit_log_2098_05'::regclass), true, 'create_audit_partition: a new partition has row level security on');
select is((select count(*)::int from pg_catalog.pg_class as c cross join unnest(array['anon', 'authenticated', 'service_role', 'trace_worker']) as r(rolname) where c.oid = 'public.audit_log_2098_05'::regclass and has_table_privilege(r.rolname, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES')), 0, 'create_audit_partition: a new partition grants nothing to non-owners');
select is(has_table_privilege('postgres', 'public.audit_log_2098_05', 'UPDATE, DELETE, TRUNCATE'), false, 'create_audit_partition: a new partition revokes UPDATE, DELETE and TRUNCATE from the owner too');

-- ===== DEFAULT-partition recovery [N1, E8] =====
select is((select count(*)::int from public.audit_log_default), 0, 'recovery: DEFAULT is empty before the fixture rows');
insert into public.audit_log (org_id, occurred_at, actor_kind, action) values
  ('a1000000-0000-4000-8000-000000000001', '2099-01-05 10:00:00+00', 'system', 'x.y'),
  ('a1000000-0000-4000-8000-000000000001', '2099-01-15 10:00:00+00', 'system', 'x.y'),
  ('a1000000-0000-4000-8000-000000000001', '2099-01-25 10:00:00+00', 'system', 'x.y'),
  ('a1000000-0000-4000-8000-000000000003', '2099-01-15 12:00:00+00', 'system', 'x.y');
select is((select count(*)::int from public.audit_log_default), 4, 'recovery: rows of an uncreated month (2099-01) from two orgs land in DEFAULT');
select is(pg_temp.try($$select private.create_audit_partition(date '2099-01-01')$$), 'OK 1', 'recovery: creating 2099-01 succeeds although rows sit in DEFAULT');
select is((select count(*)::int from public.audit_log_default), 0, 'recovery: DEFAULT ends empty');
select is((select count(*)::int from public.audit_log_2099_01 where action = 'x.y'), 4, 'recovery: all four rows moved into the new month partition');
select is((select count(*)::int from public.audit_log where action = 'audit.repartition'), 2, 'recovery: exactly one audit.repartition row per org that had rows moved');
select is((select pg_temp.keys(details) || '|' || (details ->> 'month') || '|' || (details ->> 'rows_moved') || '|' || actor_kind::text from public.audit_log where action = 'audit.repartition' and org_id = 'a1000000-0000-4000-8000-000000000001'), 'month,rows_moved|2099-01|3|system', 'recovery: org A gets one event counting only its 3 rows [N1]');
select is((select pg_temp.keys(details) || '|' || (details ->> 'month') || '|' || (details ->> 'rows_moved') || '|' || actor_kind::text from public.audit_log where action = 'audit.repartition' and org_id = 'a1000000-0000-4000-8000-000000000003'), 'month,rows_moved|2099-01|1|system', 'recovery: org B gets one event counting only its 1 row [N1]');
select is((select count(*)::int from public.audit_log_default), 0, 'recovery: the repartition events did not land in DEFAULT');
select is((select string_agg(tgname || ':' || tgenabled::text, ',' order by tgname) from pg_catalog.pg_trigger where tgrelid = 'public.audit_log_default'::regclass and not tgisinternal), 'audit_log_no_truncate:A,audit_log_no_update_delete:A', 'recovery: the new DEFAULT has both append-only triggers in ENABLE ALWAYS mode');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.audit_log_default'::regclass), true, 'recovery: the new DEFAULT has row level security on');
-- E8 step 1: with the current month's partition missing, the recovery refuses.
insert into public.audit_log (org_id, occurred_at, actor_kind, action) values ('a1000000-0000-4000-8000-000000000001', '2099-03-05 10:00:00+00', 'system', 'x.y');
do $$
begin
  execute format('alter table public.audit_log_%s rename to audit_log_%s_hidden',
    to_char(date_trunc('month', now() at time zone 'UTC'), 'YYYY_MM'), to_char(date_trunc('month', now() at time zone 'UTC'), 'YYYY_MM'));
end
$$;
select is(pg_temp.try($$select private.create_audit_partition(date '2099-03-01')$$), '55000 TRACE_CURRENT_PARTITION_MISSING', 'recovery: refused while the current month''s partition is missing [E8 step 1]');
select is(to_regclass('public.audit_log_2099_03') is null and (select count(*)::int from public.audit_log_default) = 1, true, 'recovery: the refusal changed nothing (no 2099-03 partition, the row is still in DEFAULT)');
do $$
begin
  execute format('alter table public.audit_log_%s_hidden rename to audit_log_%s',
    to_char(date_trunc('month', now() at time zone 'UTC'), 'YYYY_MM'), to_char(date_trunc('month', now() at time zone 'UTC'), 'YYYY_MM'));
end
$$;
select is(pg_temp.try($$select private.create_audit_partition(date '2099-03-01')$$), 'OK 1', 'recovery: with the current partition present the same call succeeds');
select is((select count(*)::int from public.audit_log_default), 0, 'recovery: DEFAULT is empty again');
select is((select count(*)::int from public.audit_log where action = 'audit.repartition' and details ->> 'month' = '2099-03' and details ->> 'rows_moved' = '1'), 1, 'recovery: the second recovery wrote its own event');

-- ===== U/D/TRUNCATE denied for every role, on the parent, a monthly partition and DEFAULT (privilege) [S6, D3] =====
-- anon
set local role anon;
select matches(pg_temp.try('update public.audit_log set action = ''x.y'''), '^42501 permission denied', 'UPDATE: anon cannot update audit_log (privilege)');
select matches(pg_temp.try('delete from public.audit_log'), '^42501 permission denied', 'DELETE: anon cannot delete audit_log (privilege)');
select matches(pg_temp.try('truncate public.audit_log'), '^42501 permission denied', 'TRUNCATE: anon cannot truncate audit_log (privilege)');
select matches(pg_temp.try('update public.audit_log_2026_11 set action = ''x.y'''), '^42501 permission denied', 'UPDATE: anon cannot update audit_log_2026_11 (privilege)');
select matches(pg_temp.try('delete from public.audit_log_2026_11'), '^42501 permission denied', 'DELETE: anon cannot delete audit_log_2026_11 (privilege)');
select matches(pg_temp.try('truncate public.audit_log_2026_11'), '^42501 permission denied', 'TRUNCATE: anon cannot truncate audit_log_2026_11 (privilege)');
select matches(pg_temp.try('update public.audit_log_default set action = ''x.y'''), '^42501 permission denied', 'UPDATE: anon cannot update audit_log_default (privilege)');
select matches(pg_temp.try('delete from public.audit_log_default'), '^42501 permission denied', 'DELETE: anon cannot delete audit_log_default (privilege)');
select matches(pg_temp.try('truncate public.audit_log_default'), '^42501 permission denied', 'TRUNCATE: anon cannot truncate audit_log_default (privilege)');
reset role;
reset request.jwt.claims;
-- authenticated
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try('update public.audit_log set action = ''x.y'''), '^42501 permission denied', 'UPDATE: authenticated (an org owner) cannot update audit_log (privilege)');
select matches(pg_temp.try('delete from public.audit_log'), '^42501 permission denied', 'DELETE: authenticated (an org owner) cannot delete audit_log (privilege)');
select matches(pg_temp.try('truncate public.audit_log'), '^42501 permission denied', 'TRUNCATE: authenticated (an org owner) cannot truncate audit_log (privilege)');
select matches(pg_temp.try('update public.audit_log_2026_11 set action = ''x.y'''), '^42501 permission denied', 'UPDATE: authenticated (an org owner) cannot update audit_log_2026_11 (privilege)');
select matches(pg_temp.try('delete from public.audit_log_2026_11'), '^42501 permission denied', 'DELETE: authenticated (an org owner) cannot delete audit_log_2026_11 (privilege)');
select matches(pg_temp.try('truncate public.audit_log_2026_11'), '^42501 permission denied', 'TRUNCATE: authenticated (an org owner) cannot truncate audit_log_2026_11 (privilege)');
select matches(pg_temp.try('update public.audit_log_default set action = ''x.y'''), '^42501 permission denied', 'UPDATE: authenticated (an org owner) cannot update audit_log_default (privilege)');
select matches(pg_temp.try('delete from public.audit_log_default'), '^42501 permission denied', 'DELETE: authenticated (an org owner) cannot delete audit_log_default (privilege)');
select matches(pg_temp.try('truncate public.audit_log_default'), '^42501 permission denied', 'TRUNCATE: authenticated (an org owner) cannot truncate audit_log_default (privilege)');
reset role;
reset request.jwt.claims;
-- service_role
set local role service_role;
select matches(pg_temp.try('update public.audit_log set action = ''x.y'''), '^42501 permission denied', 'UPDATE: service_role cannot update audit_log (privilege)');
select matches(pg_temp.try('delete from public.audit_log'), '^42501 permission denied', 'DELETE: service_role cannot delete audit_log (privilege)');
select matches(pg_temp.try('truncate public.audit_log'), '^42501 permission denied', 'TRUNCATE: service_role cannot truncate audit_log (privilege)');
select matches(pg_temp.try('update public.audit_log_2026_11 set action = ''x.y'''), '^42501 permission denied', 'UPDATE: service_role cannot update audit_log_2026_11 (privilege)');
select matches(pg_temp.try('delete from public.audit_log_2026_11'), '^42501 permission denied', 'DELETE: service_role cannot delete audit_log_2026_11 (privilege)');
select matches(pg_temp.try('truncate public.audit_log_2026_11'), '^42501 permission denied', 'TRUNCATE: service_role cannot truncate audit_log_2026_11 (privilege)');
select matches(pg_temp.try('update public.audit_log_default set action = ''x.y'''), '^42501 permission denied', 'UPDATE: service_role cannot update audit_log_default (privilege)');
select matches(pg_temp.try('delete from public.audit_log_default'), '^42501 permission denied', 'DELETE: service_role cannot delete audit_log_default (privilege)');
select matches(pg_temp.try('truncate public.audit_log_default'), '^42501 permission denied', 'TRUNCATE: service_role cannot truncate audit_log_default (privilege)');
reset role;
reset request.jwt.claims;
-- trace_worker
set local role trace_worker;
select matches(pg_temp.try('update public.audit_log set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_worker cannot update audit_log (privilege)');
select matches(pg_temp.try('delete from public.audit_log'), '^42501 permission denied', 'DELETE: trace_worker cannot delete audit_log (privilege)');
select matches(pg_temp.try('truncate public.audit_log'), '^42501 permission denied', 'TRUNCATE: trace_worker cannot truncate audit_log (privilege)');
select matches(pg_temp.try('update public.audit_log_2026_11 set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_worker cannot update audit_log_2026_11 (privilege)');
select matches(pg_temp.try('delete from public.audit_log_2026_11'), '^42501 permission denied', 'DELETE: trace_worker cannot delete audit_log_2026_11 (privilege)');
select matches(pg_temp.try('truncate public.audit_log_2026_11'), '^42501 permission denied', 'TRUNCATE: trace_worker cannot truncate audit_log_2026_11 (privilege)');
select matches(pg_temp.try('update public.audit_log_default set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_worker cannot update audit_log_default (privilege)');
select matches(pg_temp.try('delete from public.audit_log_default'), '^42501 permission denied', 'DELETE: trace_worker cannot delete audit_log_default (privilege)');
select matches(pg_temp.try('truncate public.audit_log_default'), '^42501 permission denied', 'TRUNCATE: trace_worker cannot truncate audit_log_default (privilege)');
reset role;
reset request.jwt.claims;
-- trace_quality_worker
set local role trace_quality_worker;
select matches(pg_temp.try('update public.audit_log set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_quality_worker cannot update audit_log (privilege)');
select matches(pg_temp.try('delete from public.audit_log'), '^42501 permission denied', 'DELETE: trace_quality_worker cannot delete audit_log (privilege)');
select matches(pg_temp.try('truncate public.audit_log'), '^42501 permission denied', 'TRUNCATE: trace_quality_worker cannot truncate audit_log (privilege)');
select matches(pg_temp.try('update public.audit_log_2026_11 set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_quality_worker cannot update audit_log_2026_11 (privilege)');
select matches(pg_temp.try('delete from public.audit_log_2026_11'), '^42501 permission denied', 'DELETE: trace_quality_worker cannot delete audit_log_2026_11 (privilege)');
select matches(pg_temp.try('truncate public.audit_log_2026_11'), '^42501 permission denied', 'TRUNCATE: trace_quality_worker cannot truncate audit_log_2026_11 (privilege)');
select matches(pg_temp.try('update public.audit_log_default set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_quality_worker cannot update audit_log_default (privilege)');
select matches(pg_temp.try('delete from public.audit_log_default'), '^42501 permission denied', 'DELETE: trace_quality_worker cannot delete audit_log_default (privilege)');
select matches(pg_temp.try('truncate public.audit_log_default'), '^42501 permission denied', 'TRUNCATE: trace_quality_worker cannot truncate audit_log_default (privilege)');
reset role;
reset request.jwt.claims;
-- trace_integrity_worker
set local role trace_integrity_worker;
select matches(pg_temp.try('update public.audit_log set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_integrity_worker cannot update audit_log (privilege)');
select matches(pg_temp.try('delete from public.audit_log'), '^42501 permission denied', 'DELETE: trace_integrity_worker cannot delete audit_log (privilege)');
select matches(pg_temp.try('truncate public.audit_log'), '^42501 permission denied', 'TRUNCATE: trace_integrity_worker cannot truncate audit_log (privilege)');
select matches(pg_temp.try('update public.audit_log_2026_11 set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_integrity_worker cannot update audit_log_2026_11 (privilege)');
select matches(pg_temp.try('delete from public.audit_log_2026_11'), '^42501 permission denied', 'DELETE: trace_integrity_worker cannot delete audit_log_2026_11 (privilege)');
select matches(pg_temp.try('truncate public.audit_log_2026_11'), '^42501 permission denied', 'TRUNCATE: trace_integrity_worker cannot truncate audit_log_2026_11 (privilege)');
select matches(pg_temp.try('update public.audit_log_default set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_integrity_worker cannot update audit_log_default (privilege)');
select matches(pg_temp.try('delete from public.audit_log_default'), '^42501 permission denied', 'DELETE: trace_integrity_worker cannot delete audit_log_default (privilege)');
select matches(pg_temp.try('truncate public.audit_log_default'), '^42501 permission denied', 'TRUNCATE: trace_integrity_worker cannot truncate audit_log_default (privilege)');
reset role;
reset request.jwt.claims;
-- trace_candidate
set local role trace_candidate;
select matches(pg_temp.try('update public.audit_log set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_candidate cannot update audit_log (privilege)');
select matches(pg_temp.try('delete from public.audit_log'), '^42501 permission denied', 'DELETE: trace_candidate cannot delete audit_log (privilege)');
select matches(pg_temp.try('truncate public.audit_log'), '^42501 permission denied', 'TRUNCATE: trace_candidate cannot truncate audit_log (privilege)');
select matches(pg_temp.try('update public.audit_log_2026_11 set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_candidate cannot update audit_log_2026_11 (privilege)');
select matches(pg_temp.try('delete from public.audit_log_2026_11'), '^42501 permission denied', 'DELETE: trace_candidate cannot delete audit_log_2026_11 (privilege)');
select matches(pg_temp.try('truncate public.audit_log_2026_11'), '^42501 permission denied', 'TRUNCATE: trace_candidate cannot truncate audit_log_2026_11 (privilege)');
select matches(pg_temp.try('update public.audit_log_default set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_candidate cannot update audit_log_default (privilege)');
select matches(pg_temp.try('delete from public.audit_log_default'), '^42501 permission denied', 'DELETE: trace_candidate cannot delete audit_log_default (privilege)');
select matches(pg_temp.try('truncate public.audit_log_default'), '^42501 permission denied', 'TRUNCATE: trace_candidate cannot truncate audit_log_default (privilege)');
reset role;
reset request.jwt.claims;
-- trace_candidate_gateway
set local role trace_candidate_gateway;
select matches(pg_temp.try('update public.audit_log set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_candidate_gateway cannot update audit_log (privilege)');
select matches(pg_temp.try('delete from public.audit_log'), '^42501 permission denied', 'DELETE: trace_candidate_gateway cannot delete audit_log (privilege)');
select matches(pg_temp.try('truncate public.audit_log'), '^42501 permission denied', 'TRUNCATE: trace_candidate_gateway cannot truncate audit_log (privilege)');
select matches(pg_temp.try('update public.audit_log_2026_11 set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_candidate_gateway cannot update audit_log_2026_11 (privilege)');
select matches(pg_temp.try('delete from public.audit_log_2026_11'), '^42501 permission denied', 'DELETE: trace_candidate_gateway cannot delete audit_log_2026_11 (privilege)');
select matches(pg_temp.try('truncate public.audit_log_2026_11'), '^42501 permission denied', 'TRUNCATE: trace_candidate_gateway cannot truncate audit_log_2026_11 (privilege)');
select matches(pg_temp.try('update public.audit_log_default set action = ''x.y'''), '^42501 permission denied', 'UPDATE: trace_candidate_gateway cannot update audit_log_default (privilege)');
select matches(pg_temp.try('delete from public.audit_log_default'), '^42501 permission denied', 'DELETE: trace_candidate_gateway cannot delete audit_log_default (privilege)');
select matches(pg_temp.try('truncate public.audit_log_default'), '^42501 permission denied', 'TRUNCATE: trace_candidate_gateway cannot truncate audit_log_default (privilege)');
reset role;
reset request.jwt.claims;
-- postgres
select matches(pg_temp.try('update public.audit_log set action = ''x.y'''), '^42501 permission denied', 'UPDATE: postgres cannot update audit_log (privilege)');
select matches(pg_temp.try('delete from public.audit_log'), '^42501 permission denied', 'DELETE: postgres cannot delete audit_log (privilege)');
select matches(pg_temp.try('truncate public.audit_log'), '^42501 permission denied', 'TRUNCATE: postgres cannot truncate audit_log (privilege)');
select matches(pg_temp.try('update public.audit_log_2026_11 set action = ''x.y'''), '^42501 permission denied', 'UPDATE: postgres cannot update audit_log_2026_11 (privilege)');
select matches(pg_temp.try('delete from public.audit_log_2026_11'), '^42501 permission denied', 'DELETE: postgres cannot delete audit_log_2026_11 (privilege)');
select matches(pg_temp.try('truncate public.audit_log_2026_11'), '^42501 permission denied', 'TRUNCATE: postgres cannot truncate audit_log_2026_11 (privilege)');
select matches(pg_temp.try('update public.audit_log_default set action = ''x.y'''), '^42501 permission denied', 'UPDATE: postgres cannot update audit_log_default (privilege)');
select matches(pg_temp.try('delete from public.audit_log_default'), '^42501 permission denied', 'DELETE: postgres cannot delete audit_log_default (privilege)');
select matches(pg_temp.try('truncate public.audit_log_default'), '^42501 permission denied', 'TRUNCATE: postgres cannot truncate audit_log_default (privilege)');

-- ===== E5 traps: a row trigger never fires on an empty table, so put one row in the monthly partition and one in DEFAULT =====
select is(pg_temp.try($$insert into public.audit_log (org_id, occurred_at, actor_kind, action) values ('a1000000-0000-4000-8000-000000000001', '2026-11-15 00:00:00+00', 'system', 'x.y')$$), 'OK 1', 'trap: the owner can still insert into the monthly partition (INSERT is not revoked)');
select is(pg_temp.try($$insert into public.audit_log (org_id, occurred_at, actor_kind, action) values ('a1000000-0000-4000-8000-000000000001', '2099-02-10 00:00:00+00', 'system', 'x.y')$$), 'OK 1', 'trap: and into DEFAULT (month 2099-02 has no partition)');
select is((select count(*)::int from public.audit_log_default) || '/' || (select count(*)::int from public.audit_log_2026_11 where action = 'x.y'), '1/1', 'trap: each target holds a row, so the row triggers have something to fire on');

-- ===== N3: the triggers on their own, behind a test-local re-grant to the owner =====
grant update, delete, truncate on public.audit_log, public.audit_log_2026_11, public.audit_log_default to postgres;
select is(pg_temp.try($$update public.audit_log set action = 'x.y'$$), 'P0001 TRACE_APPEND_ONLY', 'trigger: UPDATE on the parent raises TRACE_APPEND_ONLY (privilege re-granted)');
select is(pg_temp.try($$delete from public.audit_log$$), 'P0001 TRACE_APPEND_ONLY', 'trigger: DELETE on the parent raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$truncate public.audit_log$$), 'P0001 TRACE_APPEND_ONLY', 'trigger: TRUNCATE on the parent raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$update public.audit_log_2026_11 set action = 'x.y'$$), 'P0001 TRACE_APPEND_ONLY', 'trigger: UPDATE on a monthly partition raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$delete from public.audit_log_2026_11$$), 'P0001 TRACE_APPEND_ONLY', 'trigger: DELETE on a monthly partition raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$truncate public.audit_log_2026_11$$), 'P0001 TRACE_APPEND_ONLY', 'trigger: TRUNCATE on a monthly partition raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$update public.audit_log_default set action = 'x.y'$$), 'P0001 TRACE_APPEND_ONLY', 'trigger: UPDATE on DEFAULT raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$delete from public.audit_log_default$$), 'P0001 TRACE_APPEND_ONLY', 'trigger: DELETE on DEFAULT raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$truncate public.audit_log_default$$), 'P0001 TRACE_APPEND_ONLY', 'trigger: TRUNCATE on DEFAULT raises TRACE_APPEND_ONLY');

-- ===== The same in replica mode (ENABLE ALWAYS) [D3]; these come last, and replica mode is switched off right after =====
set local session_replication_role = replica;
select is(pg_temp.try($$update public.audit_log set action = 'x.y'$$), 'P0001 TRACE_APPEND_ONLY', 'replica: UPDATE on the parent still raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$delete from public.audit_log$$), 'P0001 TRACE_APPEND_ONLY', 'replica: DELETE on the parent still raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$truncate public.audit_log$$), 'P0001 TRACE_APPEND_ONLY', 'replica: TRUNCATE on the parent still raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$update public.audit_log_2026_11 set action = 'x.y'$$), 'P0001 TRACE_APPEND_ONLY', 'replica: UPDATE on a monthly partition still raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$delete from public.audit_log_2026_11$$), 'P0001 TRACE_APPEND_ONLY', 'replica: DELETE on a monthly partition still raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$truncate public.audit_log_2026_11$$), 'P0001 TRACE_APPEND_ONLY', 'replica: TRUNCATE on a monthly partition still raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$update public.audit_log_default set action = 'x.y'$$), 'P0001 TRACE_APPEND_ONLY', 'replica: UPDATE on DEFAULT still raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$delete from public.audit_log_default$$), 'P0001 TRACE_APPEND_ONLY', 'replica: DELETE on DEFAULT still raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$truncate public.audit_log_default$$), 'P0001 TRACE_APPEND_ONLY', 'replica: TRUNCATE on DEFAULT still raises TRACE_APPEND_ONLY');
set local session_replication_role = origin;
select is((select count(*)::int from public.audit_log where action = 'x.y' and occurred_at in ('2026-11-15 00:00:00+00', '2099-02-10 00:00:00+00')), 2, 'trigger: both trap rows survived every refused statement');

select * from finish();
rollback;
