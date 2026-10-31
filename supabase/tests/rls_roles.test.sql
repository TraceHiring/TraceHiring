-- rls_roles (spec specs/m0b-tenancy.md §6, row "rls_roles"; §2.1 DC-1, §2.2 AAL rules and suspended org, §2.3 principals,
-- §3.9 EXECUTE grants, rule 1, MT-14 expectations, AT-B7). Written from the spec, not from the migration.
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
select plan(70);
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

-- Rule 1: Answer Quality and Integrity Signals have separate worker roles (schemas stay empty in M0b).
select is(has_schema_privilege('trace_quality_worker', 'quality', 'USAGE'), true, 'rule 1: trace_quality_worker has USAGE on quality');
select is(has_schema_privilege('trace_quality_worker', 'integrity', 'USAGE'), false, 'rule 1: trace_quality_worker has no USAGE on integrity');
select is(has_schema_privilege('trace_integrity_worker', 'integrity', 'USAGE'), true, 'rule 1: trace_integrity_worker has USAGE on integrity');
select is(has_schema_privilege('trace_integrity_worker', 'quality', 'USAGE'), false, 'rule 1: trace_integrity_worker has no USAGE on quality');
select is(has_schema_privilege('trace_quality_worker', 'quality', 'CREATE'), false, 'rule 1: trace_quality_worker cannot create objects in quality');
select is(has_schema_privilege('trace_integrity_worker', 'integrity', 'CREATE'), false, 'rule 1: trace_integrity_worker cannot create objects in integrity');
select is((select count(*)::int from pg_catalog.pg_roles as r where not r.rolsuper and r.rolname !~ '^pg_' and not pg_has_role(r.oid, 'pg_read_all_data', 'USAGE') and r.oid not in (select nspowner from pg_catalog.pg_namespace where nspname in ('quality', 'integrity')) and has_schema_privilege(r.oid, 'quality', 'USAGE') and has_schema_privilege(r.oid, 'integrity', 'USAGE')), 0, 'rule 1: no non-owner role holds USAGE on both quality and integrity, Supabase read-all-data roles aside [S10]');
select is(pg_has_role('trace_quality_worker', 'trace_integrity_worker', 'MEMBER') or pg_has_role('trace_integrity_worker', 'trace_quality_worker', 'MEMBER'), false, 'rule 1: neither worker role is a member of the other');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role', 'trace_worker', 'trace_candidate', 'trace_candidate_gateway', 'trace_authoring_worker', 'trace_admin_worker', 'trace_messaging_worker']) as r(rolname) where has_schema_privilege(r.rolname, 'quality', 'USAGE') or has_schema_privilege(r.rolname, 'integrity', 'USAGE')), 0, 'rule 1: no other principal has USAGE on quality or integrity');
set local role trace_quality_worker;
select matches(pg_temp.try('select * from quality.nothing'), '^42P01', 'rule 1: trace_quality_worker can resolve names in quality (USAGE works)');
select matches(pg_temp.try('select * from integrity.nothing'), '^42501 permission denied for schema integrity', 'rule 1: trace_quality_worker is refused at the integrity schema');
select matches(pg_temp.try('create table integrity.t (i int)'), '^42501 permission denied for schema integrity', 'rule 1: trace_quality_worker cannot create in integrity');
select matches(pg_temp.try('create table quality.t (i int)'), '^42501 permission denied for schema quality', 'rule 1: trace_quality_worker cannot create in quality either');
reset role;
reset request.jwt.claims;
set local role trace_integrity_worker;
select matches(pg_temp.try('select * from integrity.nothing'), '^42P01', 'rule 1: trace_integrity_worker can resolve names in integrity (USAGE works)');
select matches(pg_temp.try('select * from quality.nothing'), '^42501 permission denied for schema quality', 'rule 1: trace_integrity_worker is refused at the quality schema');
select matches(pg_temp.try('create table quality.t (i int)'), '^42501 permission denied for schema quality', 'rule 1: trace_integrity_worker cannot create in quality');
reset role;
reset request.jwt.claims;

-- Role attributes (MT-14 (a) expectations): five NOLOGIN roles with no privileged attribute.
select is((select count(*)::int from pg_catalog.pg_roles where rolname in ('trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_candidate', 'trace_candidate_gateway')), 5, 'roles: all five trace_* roles exist');
select is((select count(*)::int from pg_catalog.pg_roles where rolname like 'trace\_%' and (rolbypassrls or rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolcanlogin)), 0, 'roles: no trace_* role can log in, bypass RLS, or create roles or databases or hold superuser or replication');

-- The candidate gateway (Q6, MT-14 (b)): NOINHERIT, its only membership is trace_candidate, set true / inherit false.
select is((select inherit_option::text || '/' || set_option::text from pg_catalog.pg_auth_members where roleid = 'trace_candidate'::regrole and member = 'trace_candidate_gateway'::regrole), 'false/true', 'gateway: the gateway to trace_candidate edge is set true, inherit false');
select is((select count(*)::int from pg_catalog.pg_auth_members where member = 'trace_candidate_gateway'::regrole), 1, 'gateway: its only membership is trace_candidate');
select is((select rolinherit from pg_catalog.pg_roles where rolname = 'trace_candidate_gateway'), false, 'gateway: the gateway is NOINHERIT');
select is(pg_has_role('trace_candidate_gateway', 'trace_candidate', 'SET'), true, 'gateway: it can set role trace_candidate');
select is(pg_has_role('trace_candidate_gateway', 'trace_candidate', 'USAGE'), false, 'gateway: it inherits nothing from trace_candidate');
select is((select count(*)::int from pg_catalog.pg_auth_members as m join pg_catalog.pg_roles as r on r.oid = m.member where m.roleid = 'trace_candidate'::regrole and r.rolname <> 'trace_candidate_gateway' and r.rolname <> 'postgres' and (m.inherit_option or m.set_option)), 0, 'gateway: no other role can use trace_candidate (ADMIN-only creator rows are ignored) [S5, D4]');
select is((select count(*)::int from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_candidate', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_candidate', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), 0, 'tables: trace_candidate holds no privilege on any table [S10]');
grant select on public.teams to trace_candidate;
set local role trace_candidate_gateway;
select matches(pg_temp.try('select * from public.teams'), '^42501 permission denied', 'gateway: with a privilege granted to trace_candidate, the gateway itself still holds nothing');
reset role;
reset request.jwt.claims;
set local role trace_candidate;
select is(pg_temp.try('select * from public.teams'), 'OK 0', 'gateway: control, trace_candidate itself can use the privilege granted to it (and RLS shows it nothing)');
reset role;
reset request.jwt.claims;

-- trace_candidate and the other non-app roles hold no privilege on any M0b table.
select is((select count(*)::int from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_candidate_gateway', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_candidate_gateway', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), 0, 'tables: the candidate gateway holds no privilege on any table');
select is((select array_agg(c.relname::text || case when has_table_privilege('trace_quality_worker', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_quality_worker', c.oid, 'INSERT, UPDATE, REFERENCES') then ':write' else '' end order by c.relname) from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_quality_worker', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_quality_worker', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), array['grader_runs:write', 'idempotency_keys:write', 'item_answer_keys', 'item_variant_keys', 'item_variants', 'item_versions', 'quality_cards:write', 'reports:write', 'responses', 'rubric_versions', 'scores:write', 'section_pool_snapshot', 'sections', 'session_items', 'sessions', 'test_versions'], 'tables: trace_quality_worker reads exactly the D1 tables it grades from (plus the M1 variants, variant keys and section snapshot, R5-32) and writes only quality.*, its card, its report column and its own idempotency scope (spec §3.3, L-20)');
select is((select array_agg(c.relname::text || case when has_table_privilege('trace_integrity_worker', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_integrity_worker', c.oid, 'INSERT, UPDATE, REFERENCES') then ':write' else '' end order by c.relname) from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_integrity_worker', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_integrity_worker', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), array['band_rule_versions', 'flags:write', 'idempotency_keys:write', 'integrity_cards:write', 'integrity_timeline_entries:write', 'quality_cards', 'reports:write', 'results:write', 'ruleset_versions', 'sessions', 'signals:write'], 'tables: trace_integrity_worker reads exactly ruleset_versions, sessions, band rules and one quality_cards boolean, and writes only integrity.*, its cards, its report column and its own idempotency scope (spec §3.3, L-20)');
select is((select count(*)::int from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), 0, 'tables: anon holds no privilege on any table');
select is((select count(*)::int from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), 0, 'tables: service_role holds no table grant (the baseline revoked the defaults)');
select is((select array_agg(c.relname::text order by c.relname) from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_worker', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_worker', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), array['consents', 'idempotency_keys', 'invitations', 'item_versions', 'media_objects', 'reports', 'responses', 'sections', 'session_items', 'sessions'], 'tables: trace_worker holds privileges on exactly idempotency_keys, the D1 mirror tables (spec §3.3) and the layout columns of sections and item_versions (M1 R5-62 b)');
-- M1 R5-32: the two M1 worker roles, exactly.
select is((select array_agg(c.relname::text || case when has_table_privilege('trace_authoring_worker', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_authoring_worker', c.oid, 'INSERT, UPDATE, REFERENCES') then ':write' else '' end order by c.relname) from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace, 'private'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_authoring_worker', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_authoring_worker', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), array['ai_draft_jobs:write', 'idempotency_keys:write', 'item_answer_keys:write', 'item_versions:write', 'items:write'], 'tables: trace_authoring_worker holds exactly items, item_versions, item_answer_keys, its drafting jobs and its idempotency keys (M1-19, R5-32, M1-c)');
select is((select array_agg(c.relname::text order by c.relname) from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace, 'private'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_authoring_worker', c.oid, 'SELECT') or has_any_column_privilege('trace_authoring_worker', c.oid, 'SELECT'))), array['ai_draft_jobs', 'idempotency_keys', 'item_versions', 'items'], 'tables: trace_authoring_worker reads exactly items and item_versions (its dedupe read), its drafting jobs and idempotency keys (M1-c), never an answer key (M1 SEC-M1-2)');
select is((select count(*)::int from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace, 'private'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_admin_worker', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_admin_worker', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), 1, 'tables: trace_admin_worker holds exactly one table (R5-32)');
select is((select array_agg(c.relname::text || case when has_table_privilege('trace_admin_worker', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_admin_worker', c.oid, 'INSERT, UPDATE, REFERENCES') then ':write' else '' end order by c.relname) from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace, 'private'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_admin_worker', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_admin_worker', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), array['member_invites:write'], 'tables: trace_admin_worker holds exactly member_invites (M1-d, R5-32); memberships only through provision_invited_member');
-- DB review m1 m-4 / m2 n-7: the exact trace_api allow-list, with the operations it may perform on each table (table
-- or column grants); private is included so a helper table can never slip in. Column limits are pinned in rls_d1_api.
select is((select array_agg(c.relname::text || ':' || (select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p where has_table_privilege('trace_api', c.oid, p) or (p in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') and has_any_column_privilege('trace_api', c.oid, p))) order by c.relname) from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace, 'private'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_api', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_api', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), array['consents:INSERT,SELECT', 'invitations:SELECT,UPDATE', 'notice_versions:SELECT', 'org_keys:INSERT,SELECT', 'test_versions:SELECT'], 'tables: trace_api holds exactly S I on consents, S(c) U(c) on invitations, S on notice_versions, S I on org_keys (M2 R5-41) and S(c) on test_versions, nothing else (spec §3.3 matrix column trace_api)');
-- M2 R5-8: the messaging worker role, exactly: its org keys. Everything else it reads or writes goes through M2-c's
-- DEFINER functions bound to its job org and claim (lead decision (a) in 20261027060000_m2_messaging.sql).
select is((select array_agg(c.relname::text || case when has_table_privilege('trace_messaging_worker', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_messaging_worker', c.oid, 'INSERT, UPDATE, REFERENCES') then ':write' else '' end order by c.relname) from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace, 'private'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_messaging_worker', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_messaging_worker', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), array['org_keys'], 'tables: trace_messaging_worker reads exactly its job org''s keys and writes no table directly (M2 R5-8, R5-42)');
set local role trace_candidate;
select matches(pg_temp.try('select * from public.orgs'), '^42501 permission denied', 'tables: trace_candidate cannot read orgs');
select matches(pg_temp.try('select * from public.workspaces'), '^42501 permission denied', 'tables: trace_candidate cannot read workspaces');
select matches(pg_temp.try('select * from public.memberships'), '^42501 permission denied', 'tables: trace_candidate cannot read memberships');
select matches(pg_temp.try('select * from public.audit_log'), '^42501 permission denied', 'tables: trace_candidate cannot read audit_log');
select matches(pg_temp.try('select * from public.platform_staff'), '^42501 permission denied', 'tables: trace_candidate cannot read platform_staff');
select matches(pg_temp.try('select * from public.staff_access_grants'), '^42501 permission denied', 'tables: trace_candidate cannot read staff_access_grants');
select matches(pg_temp.try('select * from public.idempotency_keys'), '^42501 permission denied', 'tables: trace_candidate cannot read idempotency_keys');
select matches(pg_temp.try($$insert into public.audit_log (org_id, actor_kind, action) values ('a1000000-0000-4000-8000-000000000001', 'candidate', 'x.y')$$), '^42501 permission denied', 'tables: trace_candidate cannot write audit_log');
reset role;
reset request.jwt.claims;

-- DC-1 and the EXECUTE grants: policies call private helpers without USAGE on private.
select is(has_schema_privilege('authenticated', 'private', 'USAGE'), false, 'DC-1: authenticated has no USAGE on schema private');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 1, 'DC-1: even so, the policy filters work for authenticated (org A visible)');
reset role;
reset request.jwt.claims;
select is((select array_agg(p.proname::text order by p.proname) from pg_catalog.pg_proc as p where p.pronamespace = 'private'::regnamespace and has_function_privilege('authenticated', p.oid, 'EXECUTE')), array['blueprint_valid', 'mcq_options_valid', 'media_refs_valid', 'my_assigned_test_ids', 'my_org_ids', 'my_workspace_ids', 'param_spec_valid', 'reminder_offsets_valid', 'rubric_criteria_valid', 'signal_settings_valid', 'valid_roles'], 'EXECUTE: authenticated can execute exactly the M0b helpers plus the D1 helpers and the D1, M1 and M2 CHECK helpers in private [D7, spec §3.4, M1 R5-32, M2 R3-11]');
select is((select array_agg(r.rolname || '.' || p.proname::text order by r.rolname || '.' || p.proname::text) from pg_catalog.pg_proc as p cross join unnest(array['anon', 'service_role', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_authoring_worker', 'trace_admin_worker', 'trace_messaging_worker']) as r(rolname) where p.pronamespace = 'private'::regnamespace and has_function_privilege(r.rolname, p.oid, 'EXECUTE')), array['trace_admin_worker.auth_user_id_for_invite', 'trace_admin_worker.job_org_id', 'trace_admin_worker.provision_invited_member', 'trace_admin_worker.valid_roles', 'trace_api.api_org_id', 'trace_api.api_test_title', 'trace_api.drive_invitations', 'trace_api.invitation_recipient_ct', 'trace_api.invitation_window', 'trace_api.library_browse', 'trace_api.library_exposure', 'trace_api.library_reference', 'trace_api.media_link_grant', 'trace_api.media_view_grant', 'trace_api.message_template', 'trace_api.portal_slots', 'trace_api.record_message_event', 'trace_api.resolve_invitation_by_hash', 'trace_api.self_reschedule', 'trace_authoring_worker.fail_stranded_ai_draft_jobs', 'trace_authoring_worker.job_org_id', 'trace_authoring_worker.mcq_options_valid', 'trace_authoring_worker.media_refs_valid', 'trace_authoring_worker.param_spec_valid', 'trace_integrity_worker.job_org_id', 'trace_messaging_worker.claim_due_messages', 'trace_messaging_worker.close_due_drives', 'trace_messaging_worker.job_org_id', 'trace_messaging_worker.message_send_context', 'trace_messaging_worker.message_template', 'trace_messaging_worker.purge_unmatched_events', 'trace_messaging_worker.record_message_event', 'trace_messaging_worker.record_send', 'trace_messaging_worker.record_send_failure', 'trace_messaging_worker.rotate_link_for_send', 'trace_quality_worker.job_org_id', 'trace_worker.job_org_id', 'trace_worker.mirror_session', 'trace_worker.sweep_pending'], 'EXECUTE: other roles execute only their own org-context helper in private, plus the api token lookup, the two media grants (L-2), the mirror (spec §3.4), the api library reads the authoring worker''s CHECK helpers (M1 R2-6, R5-32) and its stranded-job sweep (R5-64 m), the M2 api reads, self-reschedule, drive list, templates and provider events, and the messaging worker''s claim, close, purge, send context, rotation, send and event functions (M2 R3-11, R5-8, R5-45, R5-47, R5-66 d; lead decision (a) of M2-c)');
select is((select count(*)::int from pg_catalog.pg_proc as p cross join unnest(array['anon', 'authenticated', 'service_role', 'trace_worker', 'trace_candidate', 'trace_candidate_gateway', 'trace_authoring_worker', 'trace_admin_worker', 'trace_messaging_worker']) as r(rolname) where p.pronamespace = 'private'::regnamespace and p.proname = 'audit' and has_function_privilege(r.rolname, p.oid, 'EXECUTE')), 0, 'EXECUTE: nobody but the owner can execute private.audit (the only writer of audit rows)');

-- Authorisation reads tables, never claims (ADR-029).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000011", "aal": "aal2", "amr": [{"method": "totp", "timestamp": 1760000000}], "role": "authenticated", "app_metadata": {"org_id": "a1000000-0000-4000-8000-000000000001", "roles": ["org_owner", "admin"]}, "org_roles": ["org_owner"], "user_role": "org_owner"}';
select is((select count(*)::int from public.orgs) + (select count(*)::int from public.memberships) + (select count(*)::int from public.audit_log), 0, 'ADR-029: claims that name an org and roles grant nothing to a user without a membership');
reset role;
reset request.jwt.claims;

-- AAL rules read from the claims (§2.2), same persona, different claim shapes.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "magiclink", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 1, 'aal: a recruiter at aal1 whose first factor was a magic link counts');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "password", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'aal: a recruiter at aal1 who also used a password does not count');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'aal: a recruiter at aal1 with no amr claim does not count');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'aal: a recruiter whose claims have no aal does not count');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 1, 'aal: a password recruiter at aal2 counts');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal1", "amr": [{"method": "magiclink", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'aal: an admin never counts at aal1, even after a magic link');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 1, 'aal: an admin counts at aal2 after email OTP and TOTP');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'aal: a reviewer never counts at aal1');
reset role;
reset request.jwt.claims;

-- Suspended org (§2.2, N6): everything hidden except the member's own membership rows.
insert into public.teams (org_id, name) values ('a1000000-0000-4000-8000-000000000002', 'Team S');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000d", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs) || '/' || (select count(*)::int from public.workspaces) || '/' || (select count(*)::int from public.teams) || '/' || (select count(*)::int from public.memberships), '1/1/1/2', 'N6: before the suspension org S admin sees the org, workspace, team and both members');
select is((select count(*) > 0 from public.audit_log), true, 'N6: before the suspension org S admin reads its audit rows');
reset role;
reset request.jwt.claims;
update public.orgs set status = 'suspended' where id = 'a1000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000d", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.orgs), 0, 'N6: a suspended org hides the org row');
select is((select count(*)::int from public.workspaces), 0, 'N6: a suspended org hides its workspaces');
select is((select count(*)::int from public.teams), 0, 'N6: a suspended org hides its teams');
select is((select count(*)::int from public.audit_log), 0, 'N6: a suspended org hides its audit rows');
select is((select count(*)::int from public.staff_access_grants), 0, 'N6: a suspended org hides its staff grants');
select is((select array_agg(user_id) from public.memberships), array['00000000-0000-4000-8000-00000000000d']::uuid[], 'N6: the member still sees their own membership row, and no other member');
select is(pg_temp.try($$update public.orgs set name = 'Suspended Edit' where id = 'a1000000-0000-4000-8000-000000000002'$$), 'OK 0', 'N6: a suspended org cannot be edited by its admin');
reset role;
reset request.jwt.claims;

select * from finish();
rollback;
