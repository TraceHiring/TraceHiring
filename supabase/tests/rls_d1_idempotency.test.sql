-- rls_d1_idempotency (spec specs/d1-demo-slice.md §3.6 row "rls_d1_idempotency"; L-6, L-20; §3.3 note 7; I-11). RED first: written from the spec, targets migration <ts2>_d1_invites_sessions.sql (migration 2) on top of
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
select plan(78);
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

-- Two customer orgs; no other fixture is needed (the ledger rows are keyed by text).
insert into public.orgs (id, kind, name, slug) values
  ('a1000000-0000-4000-8000-000000000001', 'customer', 'Org A', 'org-a-test'),
  ('a1000000-0000-4000-8000-000000000003', 'customer', 'Org B', 'org-b-test');
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p-owner-admin@example.test');

-- ===== trace_worker: scope session_mirror, org = job_org_id() only (L-20) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000001:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), 'OK 1', 'I: trace_worker inserts its own scope for the job org');
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000001:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00') on conflict do nothing$$), 'OK 0', 'I: a replayed key is on conflict do nothing: 0 rows, no error');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000001:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^23505', 'I: a plain duplicate (org, scope, key) is a unique violation (the exactly-once guarantee)');
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000002:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), 'OK 1', 'I: the key shape session:job:ruleset with another session is a different key');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'quality_score', '43000000-0000-4000-8000-000000000001:quality_score:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_worker cannot insert scope quality_score (not its job)');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'integrity_band', '43000000-0000-4000-8000-000000000001:integrity_band:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_worker cannot insert scope integrity_band (not its job)');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000003', 'session_mirror', '43000000-0000-4000-8000-000000000001:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_worker with job org A cannot insert for org B (cross-org)');
select is((select count(*)::int from public.idempotency_keys), 2, 'S: trace_worker sees its two own-scope rows for the job org');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000003:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_worker with job org B cannot insert for org A');
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000003', 'session_mirror', '43000000-0000-4000-8000-000000000001:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), 'OK 1', 'I: trace_worker with job org B inserts its own scope for org B');
select is((select count(*)::int from public.idempotency_keys), 1, 'S: trace_worker with job org B sees only org B (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000004:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_worker without a job org cannot insert');
select is((select count(*)::int from public.idempotency_keys), 0, 'S: trace_worker without a job org sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.idempotency_keys set result_ref = 'x'$$), '^42501 permission denied', 'U: trace_worker cannot update the ledger (UPDATE revoked or never granted)');
select matches(pg_temp.try($$delete from public.idempotency_keys$$), '^42501 permission denied', 'D: trace_worker cannot delete from the ledger');
select matches(pg_temp.try($$truncate public.idempotency_keys$$), '^42501 permission denied', 'D: trace_worker cannot truncate the ledger');
-- ===== trace_quality_worker: scope quality_score, org = job_org_id() only (L-20) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'quality_score', '43000000-0000-4000-8000-000000000001:quality_score:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), 'OK 1', 'I: trace_quality_worker inserts its own scope for the job org');
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'quality_score', '43000000-0000-4000-8000-000000000001:quality_score:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00') on conflict do nothing$$), 'OK 0', 'I: a replayed key is on conflict do nothing: 0 rows, no error');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'quality_score', '43000000-0000-4000-8000-000000000001:quality_score:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^23505', 'I: a plain duplicate (org, scope, key) is a unique violation (the exactly-once guarantee)');
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'quality_score', '43000000-0000-4000-8000-000000000002:quality_score:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), 'OK 1', 'I: the key shape session:job:ruleset with another session is a different key');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000001:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_quality_worker cannot insert scope session_mirror (not its job)');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'integrity_band', '43000000-0000-4000-8000-000000000001:integrity_band:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_quality_worker cannot insert scope integrity_band (not its job)');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000003', 'quality_score', '43000000-0000-4000-8000-000000000001:quality_score:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_quality_worker with job org A cannot insert for org B (cross-org)');
select is((select count(*)::int from public.idempotency_keys), 2, 'S: trace_quality_worker sees its two own-scope rows for the job org');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'quality_score', '43000000-0000-4000-8000-000000000003:quality_score:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_quality_worker with job org B cannot insert for org A');
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000003', 'quality_score', '43000000-0000-4000-8000-000000000001:quality_score:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), 'OK 1', 'I: trace_quality_worker with job org B inserts its own scope for org B');
select is((select count(*)::int from public.idempotency_keys), 1, 'S: trace_quality_worker with job org B sees only org B (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'quality_score', '43000000-0000-4000-8000-000000000004:quality_score:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_quality_worker without a job org cannot insert');
select is((select count(*)::int from public.idempotency_keys), 0, 'S: trace_quality_worker without a job org sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.idempotency_keys set result_ref = 'x'$$), '^42501 permission denied', 'U: trace_quality_worker cannot update the ledger (UPDATE revoked or never granted)');
select matches(pg_temp.try($$delete from public.idempotency_keys$$), '^42501 permission denied', 'D: trace_quality_worker cannot delete from the ledger');
select matches(pg_temp.try($$truncate public.idempotency_keys$$), '^42501 permission denied', 'D: trace_quality_worker cannot truncate the ledger');
-- ===== trace_integrity_worker: scope integrity_band, org = job_org_id() only (L-20) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'integrity_band', '43000000-0000-4000-8000-000000000001:integrity_band:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), 'OK 1', 'I: trace_integrity_worker inserts its own scope for the job org');
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'integrity_band', '43000000-0000-4000-8000-000000000001:integrity_band:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00') on conflict do nothing$$), 'OK 0', 'I: a replayed key is on conflict do nothing: 0 rows, no error');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'integrity_band', '43000000-0000-4000-8000-000000000001:integrity_band:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^23505', 'I: a plain duplicate (org, scope, key) is a unique violation (the exactly-once guarantee)');
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'integrity_band', '43000000-0000-4000-8000-000000000002:integrity_band:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), 'OK 1', 'I: the key shape session:job:ruleset with another session is a different key');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000001:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_integrity_worker cannot insert scope session_mirror (not its job)');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'quality_score', '43000000-0000-4000-8000-000000000001:quality_score:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_integrity_worker cannot insert scope quality_score (not its job)');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000003', 'integrity_band', '43000000-0000-4000-8000-000000000001:integrity_band:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_integrity_worker with job org A cannot insert for org B (cross-org)');
select is((select count(*)::int from public.idempotency_keys), 2, 'S: trace_integrity_worker sees its two own-scope rows for the job org');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'integrity_band', '43000000-0000-4000-8000-000000000003:integrity_band:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_integrity_worker with job org B cannot insert for org A');
select is(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000003', 'integrity_band', '43000000-0000-4000-8000-000000000001:integrity_band:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), 'OK 1', 'I: trace_integrity_worker with job org B inserts its own scope for org B');
select is((select count(*)::int from public.idempotency_keys), 1, 'S: trace_integrity_worker with job org B sees only org B (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'integrity_band', '43000000-0000-4000-8000-000000000004:integrity_band:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 new row violates row-level security', 'I: trace_integrity_worker without a job org cannot insert');
select is((select count(*)::int from public.idempotency_keys), 0, 'S: trace_integrity_worker without a job org sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.idempotency_keys set result_ref = 'x'$$), '^42501 permission denied', 'U: trace_integrity_worker cannot update the ledger (UPDATE revoked or never granted)');
select matches(pg_temp.try($$delete from public.idempotency_keys$$), '^42501 permission denied', 'D: trace_integrity_worker cannot delete from the ledger');
select matches(pg_temp.try($$truncate public.idempotency_keys$$), '^42501 permission denied', 'D: trace_integrity_worker cannot truncate the ledger');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.idempotency_keys where org_id = 'a1000000-0000-4000-8000-000000000001'), 6, 'ledger: six org A rows exist (two per scope), none written in a foreign scope');
select is((select count(*)::int from public.idempotency_keys where (scope = 'session_mirror') <> (key like '%:session_mirror:%')), 0, 'ledger: a session_mirror scope only ever holds session_mirror keys');
-- ===== every scope is isolated from the other workers =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(distinct scope)::int from public.idempotency_keys), 1, 'S: trace_quality_worker sees one scope only (its own), never session_mirror or integrity_band');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(distinct scope)::int from public.idempotency_keys), 1, 'S: trace_integrity_worker sees one scope only (its own)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(distinct scope)::int from public.idempotency_keys), 1, 'S: trace_worker sees one scope only (its own)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select scope from public.idempotency_keys limit 1), 'quality_score', 'S: the quality worker row is scope quality_score');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select scope from public.idempotency_keys limit 1), 'integrity_band', 'S: the integrity worker row is scope integrity_band');
-- ===== M0b policies are gone; UPDATE and DELETE are revoked from trace_worker =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is(((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'idempotency_keys' and policyname in ('idempotency_keys_select_worker', 'idempotency_keys_insert_worker', 'idempotency_keys_update_worker', 'idempotency_keys_delete_worker'))), 0, 'L-20: the four M0b idempotency_keys_*_worker policies are dropped');
select is(((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'idempotency_keys' and cmd in ('UPDATE', 'DELETE', 'ALL'))), 0, 'L-20: no UPDATE, DELETE or ALL policy exists on the ledger');
select is(((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'idempotency_keys' and (qual = 'true' or with_check = 'true'))), 0, 'L-20: no literal-true policy remains (MT-11)');
select is(((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'idempotency_keys' and cmd in ('SELECT', 'INSERT'))), 6, 'L-20: one SELECT and one INSERT policy per worker role (six policies)');
select is(((select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = 'idempotency_keys' and coalesce(p.qual, p.with_check) not like '%job_org_id%')), 0, 'L-20: every remaining policy binds org_id to job_org_id()');
select is((has_table_privilege('trace_worker', 'public.idempotency_keys', 'SELECT') and has_table_privilege('trace_worker', 'public.idempotency_keys', 'INSERT')), true, 'grants: trace_worker holds SELECT and INSERT on the ledger');
select is((has_table_privilege('trace_worker', 'public.idempotency_keys', 'UPDATE') or has_table_privilege('trace_worker', 'public.idempotency_keys', 'DELETE')), false, 'grants: trace_worker holds neither UPDATE nor DELETE on the ledger');
select is((has_table_privilege('trace_quality_worker', 'public.idempotency_keys', 'SELECT') and has_table_privilege('trace_quality_worker', 'public.idempotency_keys', 'INSERT')), true, 'grants: trace_quality_worker holds SELECT and INSERT on the ledger');
select is((has_table_privilege('trace_quality_worker', 'public.idempotency_keys', 'UPDATE') or has_table_privilege('trace_quality_worker', 'public.idempotency_keys', 'DELETE')), false, 'grants: trace_quality_worker holds neither UPDATE nor DELETE on the ledger');
select is((has_table_privilege('trace_integrity_worker', 'public.idempotency_keys', 'SELECT') and has_table_privilege('trace_integrity_worker', 'public.idempotency_keys', 'INSERT')), true, 'grants: trace_integrity_worker holds SELECT and INSERT on the ledger');
select is((has_table_privilege('trace_integrity_worker', 'public.idempotency_keys', 'UPDATE') or has_table_privilege('trace_integrity_worker', 'public.idempotency_keys', 'DELETE')), false, 'grants: trace_integrity_worker holds neither UPDATE nor DELETE on the ledger');
-- ===== every other role is denied =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select 1 from public.idempotency_keys$$), '^42501 permission denied', 'S: authenticated cannot read the ledger');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000009:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 permission denied', 'I: authenticated cannot insert into the ledger');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$select 1 from public.idempotency_keys$$), '^42501 permission denied', 'S: anon cannot read the ledger');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000009:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 permission denied', 'I: anon cannot insert into the ledger');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate;
select matches(pg_temp.try($$select 1 from public.idempotency_keys$$), '^42501 permission denied', 'S: trace_candidate cannot read the ledger');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000009:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 permission denied', 'I: trace_candidate cannot insert into the ledger');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate_gateway;
select matches(pg_temp.try($$select 1 from public.idempotency_keys$$), '^42501 permission denied', 'S: trace_candidate_gateway cannot read the ledger');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000009:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 permission denied', 'I: trace_candidate_gateway cannot insert into the ledger');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role service_role;
select matches(pg_temp.try($$select 1 from public.idempotency_keys$$), '^42501 permission denied', 'S: service_role cannot read the ledger');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000009:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 permission denied', 'I: service_role cannot insert into the ledger');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select 1 from public.idempotency_keys$$), '^42501 permission denied', 'S: trace_api cannot read the ledger');
select matches(pg_temp.try($$insert into public.idempotency_keys (org_id, scope, key, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'session_mirror', '43000000-0000-4000-8000-000000000009:session_mirror:f1000000-0000-4000-8000-000000000001', '2026-12-31 00:00:00+00')$$), '^42501 permission denied', 'I: trace_api cannot insert into the ledger');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;

select * from finish();
rollback;
