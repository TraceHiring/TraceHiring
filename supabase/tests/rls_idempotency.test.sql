-- rls_idempotency (spec specs/m0b-tenancy.md §6, row "rls_idempotency"; §3.8 idempotency_keys, ADR-029 worker-only
-- ledger, §2.3 principals). Written from the spec, not from the migration. Personas are synthetic.
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
select plan(37);
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

-- ===== trace_worker: S, I, U, D allowed =====
set local role trace_worker;
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'grade', 'key-1', now() + interval '1 day')$$), 'OK 1', 'I: trace_worker inserts a key');
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000003', 'grade', 'key-1', now() + interval '1 day')$$), 'OK 1', 'I: the same scope and key in another org is a different key');
select is((select count(*)::int from public.idempotency_keys), 2, 'S: trace_worker reads the ledger rows of every org');
select is(pg_temp.try($$update public.idempotency_keys set result_ref = 'result-1' where org_id = 'a1000000-0000-4000-8000-000000000001' and key = 'key-1'$$), 'OK 1', 'U: trace_worker updates a key');
select is((select result_ref from public.idempotency_keys where org_id = 'a1000000-0000-4000-8000-000000000001' and key = 'key-1'), 'result-1', 'U: the update took effect');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'grade', 'key-1', now() + interval '1 day')$$), '^23505', 'I: a repeated (org, scope, key) is refused, which is the idempotency guarantee');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', repeat('s', 65), 'key-2', now() + interval '1 day')$$), '^23514', 'I: a scope longer than 64 characters is refused');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'grade', repeat('k', 201), now() + interval '1 day')$$), '^23514', 'I: a key longer than 200 characters is refused');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-0000000000ee', 'grade', 'key-3', now() + interval '1 day')$$), '^23503', 'I: a key for an org that does not exist is refused');
select matches(pg_temp.try($$truncate public.idempotency_keys$$), '^42501 permission denied', 'D: trace_worker cannot truncate the ledger');
select is(has_table_privilege('trace_worker', 'public.idempotency_keys', 'SELECT, INSERT, UPDATE, DELETE'), true, 'D: trace_worker holds select, insert, update and delete on the ledger');
select is(pg_temp.try($$delete from public.idempotency_keys where org_id = 'a1000000-0000-4000-8000-000000000003'$$), 'OK 1', 'D: trace_worker deletes a key');
select is((select count(*)::int from public.idempotency_keys), 1, 'D: the delete took effect');
reset role;
reset request.jwt.claims;

-- ===== Everybody else is denied on each operation =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select * from public.idempotency_keys$$), '^42501 permission denied', 'S: authenticated (an org owner) cannot read the ledger');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'grade', 'key-9', now() + interval '1 day')$$), '^42501 permission denied', 'I: authenticated cannot insert');
select matches(pg_temp.try($$update public.idempotency_keys set result_ref = 'x'$$), '^42501 permission denied', 'U: authenticated cannot update');
select matches(pg_temp.try($$delete from public.idempotency_keys$$), '^42501 permission denied', 'D: authenticated cannot delete');
set local role service_role;
select matches(pg_temp.try($$select * from public.idempotency_keys$$), '^42501 permission denied', 'S: service_role cannot read the ledger');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'grade', 'key-9', now() + interval '1 day')$$), '^42501 permission denied', 'I: service_role cannot insert');
select matches(pg_temp.try($$update public.idempotency_keys set result_ref = 'x'$$), '^42501 permission denied', 'U: service_role cannot update');
select matches(pg_temp.try($$delete from public.idempotency_keys$$), '^42501 permission denied', 'D: service_role cannot delete');
reset role;
reset request.jwt.claims;
set local role trace_candidate;
select matches(pg_temp.try($$select * from public.idempotency_keys$$), '^42501 permission denied', 'S: trace_candidate cannot read the ledger');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'grade', 'key-9', now() + interval '1 day')$$), '^42501 permission denied', 'I: trace_candidate cannot insert');
select matches(pg_temp.try($$update public.idempotency_keys set result_ref = 'x'$$), '^42501 permission denied', 'U: trace_candidate cannot update');
select matches(pg_temp.try($$delete from public.idempotency_keys$$), '^42501 permission denied', 'D: trace_candidate cannot delete');
reset role;
reset request.jwt.claims;
set local role anon;
select matches(pg_temp.try($$select * from public.idempotency_keys$$), '^42501 permission denied', 'S: anon cannot read the ledger');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'grade', 'key-9', now() + interval '1 day')$$), '^42501 permission denied', 'I: anon cannot insert');
select matches(pg_temp.try($$update public.idempotency_keys set result_ref = 'x'$$), '^42501 permission denied', 'U: anon cannot update');
select matches(pg_temp.try($$delete from public.idempotency_keys$$), '^42501 permission denied', 'D: anon cannot delete');
reset role;
reset request.jwt.claims;
set local role trace_candidate_gateway;
select matches(pg_temp.try($$select * from public.idempotency_keys$$), '^42501 permission denied', 'S: the candidate gateway cannot read the ledger');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'grade', 'key-9', now() + interval '1 day')$$), '^42501 permission denied', 'I: the candidate gateway cannot insert');
reset role;
reset request.jwt.claims;
set local role trace_quality_worker;
select matches(pg_temp.try($$select * from public.idempotency_keys$$), '^42501 permission denied', 'S: trace_quality_worker cannot read the ledger');
select matches(pg_temp.try($$delete from public.idempotency_keys$$), '^42501 permission denied', 'D: trace_quality_worker cannot delete');
reset role;
reset request.jwt.claims;
set local role trace_integrity_worker;
select matches(pg_temp.try($$select * from public.idempotency_keys$$), '^42501 permission denied', 'S: trace_integrity_worker cannot read the ledger');
select matches(pg_temp.try($$update public.idempotency_keys set result_ref = 'x'$$), '^42501 permission denied', 'U: trace_integrity_worker cannot update');
reset role;
reset request.jwt.claims;
select is((select count(*)::int from public.idempotency_keys), 1, 'the denied statements changed nothing: one ledger row is left');
select is((select result_ref from public.idempotency_keys), 'result-1', 'the surviving ledger row is untouched');

select * from finish();
rollback;
