-- rls_d1_rulesets_m3 (migration-3 half of spec specs/d1-demo-slice.md 3.6 row "rls_d1_rulesets"; 3.2 integrity.band_rule_versions and
-- ruleset_versions; 3.4 seed_org_defaults and the L-8 trigger; decisions L-8, L-33, L-34; 5.2 Rule shape and rule table v1).
-- RED first: targets migration <ts3>_d1_results.sql (on top of <ts1>_d1_authoring.sql). The real seed trigger and the real L-8
-- trigger are exercised (no shim). Covers: seed trigger and backfill, band_rule_versions immutability and Rule-shape CHECK, a
-- referenced rule version cannot be updated or deleted, the L-8 trigger, L-33 composite FK and grant, and the publish pin/freeze of
-- the ruleset (the publish-dependent ruleset cases moved out of rls_d1_rulesets). Personas are synthetic.
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
select plan(103);
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
-- Personas (spec D1 3.6): synthetic users, fixed ids, created on the operator path (postgres, no claims).
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p-owner-admin@example.test'),
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'p-admin@example.test'),
  ('00000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'p-admin-aal1@example.test'),
  ('00000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'p-recruiter-otp@example.test'),
  ('00000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'p-reviewer-asg@example.test'),
  ('00000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'p-hm@example.test'),
  ('00000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'p-ws-recruiter@example.test'),
  ('00000000-0000-4000-8000-00000000000e', 'authenticated', 'authenticated', 'p-b-admin@example.test');
-- Orgs A and B (customers). The org-seed trigger of migration 3 gives each a notice, band rules v1 and a rubric.
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
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', '{admin}', null, 'Persona Admin Aal1', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', '{recruiter}', null, 'Persona Recruiter Otp', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', '{reviewer}', null, 'Persona Reviewer Assigned', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000008', '{hiring_manager}', null, 'Persona Hiring Manager', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000009', '{recruiter}', 'b1000000-0000-4000-8000-000000000002', 'Persona Ws Recruiter', 'active'),
  ('a1000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000e', '{org_owner,admin}', null, 'Persona B Admin', 'active');
-- Authoring fixtures on the operator path: T1 (ws A1), T2 (ws A2), TB (org B), each with version 1, one mcq section,
-- one item and its key. The L-8 trigger (migration 3) creates each draft ruleset row and pins the notice; the
-- versions are then published on the operator path (published_by/creator assignment stay null/skipped there).
insert into public.tests (id, org_id, workspace_id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test One'),
  ('e1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'Test Two'),
  ('e1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 'Test B');
insert into public.test_versions (id, org_id, test_id, version_no, total_time_seconds, quality_cutoff) values
  ('f1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 1, 1800, 40),
  ('f1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 1, 1800, 40),
  ('f1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 1, 1800, 40);
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 1, 'Choices', 'mcq', 1),
  ('51000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 1, 'Choices', 'mcq', 1),
  ('51000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', 1, 'Choices', 'mcq', 1);
insert into public.item_versions (id, org_id, test_version_id, section_id, format, position, stem, options, rubric_version_id, origin, content_sha256) values
  ('61000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64)),
  ('61000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000002', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64)),
  ('61000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', '51000000-0000-4000-8000-00000000000b', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64));
insert into public.item_answer_keys (org_id, item_version_id, format, key) values
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'mcq', '{"option_id": "o1"}'),
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000002', 'mcq', '{"option_id": "o1"}'),
  ('a1000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-00000000000b', 'mcq', '{"option_id": "o1"}');
update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id in ('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-00000000000b');
-- The assigned reviewer persona is assigned to T1 on the operator path (so the S* arm has something to see).
insert into public.assignments (org_id, membership_id, scope, test_id, as_role)
  select m.org_id, m.id, 'test', 'e1000000-0000-4000-8000-000000000001', 'reviewer'
  from public.memberships m where m.org_id = 'a1000000-0000-4000-8000-000000000001' and m.user_id = '00000000-0000-4000-8000-000000000007';
-- ===== private.seed_org_defaults(): the org seed (R-5) =====
select is((select count(*)::int from public.notice_versions where org_id = 'a1000000-0000-4000-8000-000000000001'), 1, 'seed: org A has exactly one seeded notice');
select is((select version::text || '|' || language from public.notice_versions where org_id = 'a1000000-0000-4000-8000-000000000001'), '1|en', 'seed: the seeded notice is version 1, language en');
select is((select count(*)::int from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001'), 1, 'seed: org A has exactly one seeded band rule version');
select is((select version_no::text || '|' || coverage_floor_permille::text || '|' || coverage_photo_missing_factor_permille::text from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001'), '1|700|750', 'seed: band rules v1 carry floor 700 and photo-missing factor 750 permille (R-11)');
select is((select array_agg(f order by f) from integrity.band_rule_versions b, unnest(b.families) as f where b.org_id = 'a1000000-0000-4000-8000-000000000001'), array['focus', 'input_origin', 'paste'], 'seed: the D1 families are paste, input_origin and focus');
select is((select array_agg(r ->> 'id' order by r ->> 'id') from integrity.band_rule_versions b, jsonb_array_elements(b.rules) as r where b.org_id = 'a1000000-0000-4000-8000-000000000001'), array['D1-FULLSCREEN-EXIT', 'D1-PASTE', 'D1-TAB-HIDDEN', 'D1-UNTRUSTED-INPUT'], 'seed: the v1 rule table holds exactly the four D1 rules (5.2)');
select is((select array_agg(r ->> 'id' order by r ->> 'id') from integrity.band_rule_versions b, jsonb_array_elements(b.rules) as r where b.org_id = 'a1000000-0000-4000-8000-000000000001' and (r ->> 'validated')::boolean), array['D1-PASTE', 'D1-UNTRUSTED-INPUT'], 'seed: only the paste and untrusted-input rules are validated; tab_hidden and fullscreen_exit are context only (D1-6, rule 3)');
select is((select r ->> 'tier' || '|' || (r ->> 'severity') || '|' || (r ->> 'untrusted') from integrity.band_rule_versions b, jsonb_array_elements(b.rules) as r where b.org_id = 'a1000000-0000-4000-8000-000000000001' and r ->> 'id' = 'D1-UNTRUSTED-INPUT'), 'T3|hard|true', 'seed: D1-UNTRUSTED-INPUT is T3, hard, untrusted (the only way a T3 reaches Strong concern, rule 3)');
select is((select (r ->> 'tier') || '|' || (r ->> 'severity') from integrity.band_rule_versions b, jsonb_array_elements(b.rules) as r where b.org_id = 'a1000000-0000-4000-8000-000000000001' and r ->> 'id' = 'D1-PASTE'), 'T3|medium', 'seed: D1-PASTE is T3 medium (caps at Review, rule 3)');
select ok((select content_sha256 ~ '^[0-9a-f]{64}$' from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001'), 'seed: the rule table carries a 64-hex content_sha256');
select is((select count(*)::int from public.rubric_versions where org_id = 'a1000000-0000-4000-8000-000000000001'), 1, 'seed: org A has exactly one seeded default rubric');
select is((select count(*)::int from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000003'), 1, 'seed: org B has its own band rule version (cross-org)');
select is(((select id from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 1)) <> ((select id from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000003' and version_no = 1)), true, 'seed: the two orgs hold different rule table rows (no shared row)');
select is((select count(*)::int from public.orgs o where not exists (select 1 from public.notice_versions n where n.org_id = o.id) or not exists (select 1 from integrity.band_rule_versions b where b.org_id = o.id) or not exists (select 1 from public.rubric_versions r where r.org_id = o.id)), 0, 'backfill: no org is left without a notice, a band rule version or a rubric (seed trigger plus the migration backfill)');
select is((select prosecdef from pg_proc where oid = 'private.seed_org_defaults()'::regprocedure), true, 'seed: private.seed_org_defaults is SECURITY DEFINER');
select is((select coalesce(proconfig, '{}') @> array['search_path=""'] from pg_proc where oid = 'private.seed_org_defaults()'::regprocedure), true, 'seed: private.seed_org_defaults pins search_path = ''''');
select is((select count(*)::int from unnest(array['anon','authenticated','service_role','trace_worker','trace_quality_worker','trace_integrity_worker','trace_api','trace_candidate']) as r where has_function_privilege(r, 'private.seed_org_defaults()', 'execute')), 0, 'seed: EXECUTE on private.seed_org_defaults is granted to nobody (trigger only)');
select ok(exists (select 1 from pg_trigger t where t.tgrelid = 'public.orgs'::regclass and t.tgfoid = 'private.seed_org_defaults()'::regprocedure and (t.tgtype & 1) = 1 and (t.tgtype & 4) = 4 and (t.tgtype & 2) = 0 and not t.tgisinternal), 'seed: the trigger is a row-level AFTER INSERT trigger on public.orgs');
-- ===== L-8: the BEFORE INSERT trigger on test_versions (migration 3, L-34) =====
select ok(exists (select 1 from pg_trigger t where t.tgrelid = 'public.test_versions'::regclass and t.tgfoid = 'private.test_versions_ruleset_seed()'::regprocedure and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and not t.tgisinternal), 'L-8: private.test_versions_ruleset_seed is a row-level BEFORE INSERT trigger on test_versions');
select ok((select bool_and(t.tgname collate "C" > 'test_versions_guard') from pg_trigger t where t.tgrelid = 'public.test_versions'::regclass and t.tgfoid = 'private.test_versions_ruleset_seed()'::regprocedure), 'L-8: the trigger name sorts after test_versions_guard (the guard assigns version_no and the workspace first)');
select is((select prosecdef from pg_proc where oid = 'private.test_versions_ruleset_seed()'::regprocedure), true, 'L-8: the trigger function is SECURITY DEFINER');
select is((select coalesce(proconfig, '{}') @> array['search_path=""'] from pg_proc where oid = 'private.test_versions_ruleset_seed()'::regprocedure), true, 'L-8: the trigger function pins search_path = ''''');
select is((select count(*)::int from unnest(array['anon','authenticated','service_role','trace_worker','trace_quality_worker','trace_integrity_worker','trace_api','trace_candidate']) as r where has_function_privilege(r, 'private.test_versions_ruleset_seed()', 'execute')), 0, 'L-8: EXECUTE on the trigger function is granted to nobody');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.tests (org_id, workspace_id, name) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test Nine')$$), 'OK 1', 'L-8 fixture: a recruiter creates a test');
select is(pg_temp.try($$insert into public.test_versions (org_id, test_id, version_no, total_time_seconds, quality_cutoff) select 'a1000000-0000-4000-8000-000000000001', id, 1, 1800, 40 from public.tests where name = 'Test Nine'$$), 'OK 1', 'L-8: a recruiter drafts a version; the definer trigger runs although the role reads nothing in integrity');
select matches(pg_temp.try($$select * from integrity.band_rule_versions$$), '^42501 permission denied', 'L-8: the drafting recruiter cannot read integrity.* (it is the trigger that reads the rule table)');
select is(pg_temp.try($$insert into public.test_versions (org_id, test_id, version_no, total_time_seconds, quality_cutoff) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 2, 1800, 50)$$), 'OK 1', 'L-8: a second draft on a published test also gets its own ruleset');
reset role;
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select * from integrity.band_rule_versions$$), '^42501 permission denied', 'L-8: an org owner cannot read integrity.* either (the rule table is internal)');
reset role;
reset request.jwt.claims;
select is((select count(*)::int from public.ruleset_versions where test_id = (select id from public.tests where name = 'Test Nine')), 1, 'L-8: the draft insert created exactly one ruleset_versions row for the test');
select is((select v.ruleset_version_id = r.id from public.test_versions v join public.ruleset_versions r on r.org_id = v.org_id and r.test_id = v.test_id and r.version_no = v.version_no where v.id = (select id from public.test_versions where test_id = (select id from public.tests where name = 'Test Nine') and version_no = 1)), true, 'L-8: the version points at its own ruleset (same org, test and version_no)');
select is((select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.test_versions where id = (select id from public.test_versions where test_id = (select id from public.tests where name = 'Test Nine') and version_no = 1))), (select id from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 1), 'L-8: the ruleset carries the org''s seeded latest band rule version');
select is((select v.notice_version_id from public.test_versions v where v.id = (select id from public.test_versions where test_id = (select id from public.tests where name = 'Test Nine') and version_no = 1)), (select id from public.notice_versions where org_id = 'a1000000-0000-4000-8000-000000000001' order by version desc limit 1), 'L-8: the version pins the org''s current seeded notice');
select is((select (select count(*) from jsonb_object_keys(r.signal_settings))::text || '|' || (select count(*) from jsonb_each(r.signal_settings) e where e.value = '{"enabled": true}')::text from public.ruleset_versions r where r.id = (select ruleset_version_id from public.test_versions where id = (select id from public.test_versions where test_id = (select id from public.tests where name = 'Test Nine') and version_no = 1))), '5|5', 'L-8: the five D1 signal_settings keys are present and enabled');
select is((select r.workspace_id::text || '|' || (r.published_at is null)::text from public.ruleset_versions r where r.id = (select ruleset_version_id from public.test_versions where id = (select id from public.test_versions where test_id = (select id from public.tests where name = 'Test Nine') and version_no = 1))), 'b1000000-0000-4000-8000-000000000001|true', 'L-8: the ruleset copies the test''s workspace and is unpublished while the version is a draft');
select is((select r.version_no from public.ruleset_versions r where r.id = (select ruleset_version_id from public.test_versions where id = (select id from public.test_versions where test_id = 'e1000000-0000-4000-8000-000000000001' and version_no = 2))), 2, 'L-8: the ruleset''s version_no is the version''s (assigned) version_no');
select is((select count(distinct ruleset_version_id)::int = count(*)::int from public.test_versions), true, 'L-8: every version has its own ruleset row (no two versions share one)');
-- A client-supplied ruleset or notice id is overwritten: the operator supplies org B ids and the composite FKs still hold.
select is(pg_temp.try($$insert into public.test_versions (org_id, test_id, version_no, total_time_seconds, quality_cutoff, ruleset_version_id, notice_version_id) select 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 2, 1800, 40, (select ruleset_version_id from public.test_versions where id = 'f1000000-0000-4000-8000-00000000000b'), (select notice_version_id from public.test_versions where id = 'f1000000-0000-4000-8000-00000000000b')$$), 'OK 1', 'L-8: a draft insert that names org B''s ruleset and notice succeeds because the trigger overwrites both');
select is((select v.ruleset_version_id <> b.ruleset_version_id and v.notice_version_id <> b.notice_version_id from public.test_versions v, public.test_versions b where v.test_id = 'e1000000-0000-4000-8000-000000000002' and v.version_no = 2 and b.id = 'f1000000-0000-4000-8000-00000000000b'), true, 'L-8: the stored ids are org A''s own, not the supplied org B ids');
-- Fail closed: an org with no seeded defaults cannot start a draft. The seed trigger is switched off to create org C.
do $$ declare t text; begin select tgname into t from pg_trigger where tgrelid = 'public.orgs'::regclass and tgfoid = 'private.seed_org_defaults()'::regprocedure; execute format('alter table public.orgs disable trigger %I', t); end $$;
insert into public.orgs (id, kind, name, slug) values ('a1000000-0000-4000-8000-000000000005', 'customer', 'Org C', 'org-c-test');
insert into public.workspaces (id, org_id, name, kind, is_default) values ('b1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000005', 'Default', 'default', true);
insert into public.tests (id, org_id, workspace_id, name) values ('e1000000-0000-4000-8000-00000000000c', 'a1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000005', 'Test C');
do $$ declare t text; begin select tgname into t from pg_trigger where tgrelid = 'public.orgs'::regclass and tgfoid = 'private.seed_org_defaults()'::regprocedure; execute format('alter table public.orgs enable trigger %I', t); end $$;
select doesnt_match(pg_temp.try($$insert into public.test_versions (org_id, test_id, version_no, total_time_seconds, quality_cutoff) values ('a1000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-00000000000c', 1, 1800, 40)$$), '^OK', 'L-8: a draft for an org with no seeded band rule version or notice fails closed');
select is((select count(*)::int from public.ruleset_versions where org_id = 'a1000000-0000-4000-8000-000000000005'), 0, 'L-8: the failed draft left no ruleset row behind');
-- ===== integrity.band_rule_versions: immutability and the Rule-shape CHECK (3.2, 5.2, rule 3) =====
select is(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 2, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]', repeat('a', 64))$$), 'OK 1', 'Rule shape: a minimal valid rule table is accepted');
select is(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 3, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true, "where": {"origin": "paste"}, "minDurationMs": 3000}]', repeat('a', 64))$$), 'OK 1', 'Rule shape: the optional where and minDurationMs keys are accepted');
select is(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 4, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-UNTRUSTED", "kinds": ["untrusted_input"], "family": "input_origin", "tier": "T3", "severity": "hard", "validated": true, "untrusted": true}]', repeat('a', 64))$$), 'OK 1', 'Rule shape: untrusted on a T3 rule is accepted');
select is(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 5, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-RAW", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "hard", "validated": true, "rawMedia": true}]', repeat('a', 64))$$), 'OK 1', 'Rule shape: rawMedia on a T3 rule is accepted');
select is(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 6, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-T1", "kinds": ["paste", "drop"], "family": "paste", "tier": "T1", "severity": "medium", "validated": true}]', repeat('a', 64))$$), 'OK 1', 'Rule shape: a T1 rule without the T3-only keys is accepted');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true}, {"id": "X-PASTE", "kinds": ["tab_hidden"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]', repeat('a', 64))$$), '^23514', 'Rule shape: two rules with the same id are refused (unique ids)');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true, "foo": 1}]', repeat('a', 64))$$), '^23514', 'Rule shape: an unknown key is refused (known keys only)');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T4", "severity": "medium", "validated": true}]', repeat('a', 64))$$), '^23514', 'Rule shape: tier outside T1, T2, T3 is refused');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "extreme", "validated": true}]', repeat('a', 64))$$), '^23514', 'Rule shape: severity outside soft, medium, hard is refused');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "geo", "tier": "T3", "severity": "medium", "validated": true}]', repeat('a', 64))$$), '^23514', 'Rule shape: a family that is not in the table''s families is refused');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T2", "severity": "medium", "validated": true, "untrusted": true}]', repeat('a', 64))$$), '^23514', 'Rule shape: untrusted on a non-T3 rule is refused (rule 3)');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T1", "severity": "medium", "validated": true, "rawMedia": true}]', repeat('a', 64))$$), '^23514', 'Rule shape: rawMedia on a non-T3 rule is refused (rule 3)');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium"}]', repeat('a', 64))$$), '^23514', 'Rule shape: a rule without validated is refused');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]', repeat('a', 64))$$), '^23514', 'Rule shape: a rule without kinds is refused');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": "paste", "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]', repeat('a', 64))$$), '^23514', 'Rule shape: kinds must be an array');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '[{"id": "", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]', repeat('a', 64))$$), '^23514', 'Rule shape: an empty rule id is refused');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": "yes"}]', repeat('a', 64))$$), '^23514', 'Rule shape: validated must be a boolean');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '{"rules": [{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]}', repeat('a', 64))$$), '^23514', 'Rule shape: rules must be an array, not an object');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 1001, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]', repeat('a', 64))$$), '^23514', 'coverage_floor_permille 1001 violates the 0..1000 CHECK');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', -1, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]', repeat('a', 64))$$), '^23514', 'coverage_floor_permille -1 violates the 0..1000 CHECK');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 1001, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]', repeat('a', 64))$$), '^23514', 'coverage_photo_missing_factor_permille 1001 violates the 0..1000 CHECK');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, -1, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]', repeat('a', 64))$$), '^23514', 'coverage_photo_missing_factor_permille -1 violates the 0..1000 CHECK');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]', repeat('a', 64))$$), '^23514', 'families must hold at least one entry');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 7, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]', 'xyz')$$), '^23514', 'content_sha256 must be 64 hex');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 1, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]', repeat('a', 64))$$), '^23505', 'a second row for the same (org, version_no) is refused (version numbers are unique per org)');
-- Immutable always (F): the seeded v1 is referenced by rulesets, v2 is not; neither can change, for any role, in any mode.
select is((select count(*)::int from public.ruleset_versions where band_rule_version_id = (select id from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 1)) > 0, true, 'immutable: the seeded v1 is referenced by the draft and published rulesets of org A');
select matches(pg_temp.try($$update integrity.band_rule_versions set coverage_floor_permille = 1 where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 1$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'immutable: a referenced rule version cannot be updated (even by the operator)');
select matches(pg_temp.try($$delete from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 1$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'immutable: a referenced rule version cannot be deleted');
select matches(pg_temp.try($$update integrity.band_rule_versions set rules = '[]' where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 2$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'immutable: an unreferenced rule version cannot be updated either (immutable always)');
select matches(pg_temp.try($$delete from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 2$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'immutable: an unreferenced rule version cannot be deleted either');
set local session_replication_role = replica;
select matches(pg_temp.try($$update integrity.band_rule_versions set coverage_floor_permille = 1 where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 1$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'immutable: replica mode (ENABLE ALWAYS) still refuses the update');
select matches(pg_temp.try($$delete from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 2$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'immutable: replica mode still refuses the delete');
set local session_replication_role = origin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 8, '{paste,input_origin,focus}', 700, 750, '[{"id": "X-PASTE", "kinds": ["paste", "drop"], "family": "paste", "tier": "T3", "severity": "medium", "validated": true}]', repeat('a', 64))$$), '^42501 permission denied', 'band_rule_versions I: an org owner cannot insert (the seed function is the only writer)');
reset role;
reset request.jwt.claims;
set local role trace_api;
select matches(pg_temp.try($$select * from integrity.band_rule_versions$$), '^42501 permission denied', 'band_rule_versions S: trace_api holds nothing in integrity');
reset role;
reset trace.api_org_id;
-- ===== L-33: composite FK and grant on ruleset_versions.band_rule_version_id =====
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.ruleset_versions'::regclass and c.contype = 'f' and c.confrelid = 'integrity.band_rule_versions'::regclass and pg_get_constraintdef(c.oid) ~ 'FOREIGN KEY \(org_id, band_rule_version_id\) REFERENCES integrity\.band_rule_versions\(org_id, id\)'), 'L-33: ruleset_versions has the composite FK (org_id, band_rule_version_id) to integrity.band_rule_versions (org_id, id)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'ruleset_versions' and indexdef ~ '\(org_id, band_rule_version_id\)'), 'L-33: an index leads with (org_id, band_rule_version_id)');
select matches(pg_temp.try($$update public.ruleset_versions set band_rule_version_id = (select id from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000003' and version_no = 1) where test_id = (select id from public.tests where name = 'Test Nine')$$), '^23503', 'L-33: the composite FK refuses another org''s rule version');
select is(pg_temp.try($$update public.ruleset_versions set band_rule_version_id = (select id from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 2) where test_id = (select id from public.tests where name = 'Test Nine')$$), 'OK 1', 'L-33: the FK accepts the org''s own other rule version on a draft ruleset (operator path)');
select is(pg_temp.try($$update public.ruleset_versions set band_rule_version_id = (select id from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 1) where test_id = (select id from public.tests where name = 'Test Nine')$$), 'OK 1', 'L-33: and back to the seeded v1');
select is(has_column_privilege('authenticated', 'public.ruleset_versions', 'band_rule_version_id', 'INSERT'), false, 'L-33: band_rule_version_id is outside the authenticated INSERT grant');
select is(has_column_privilege('authenticated', 'public.ruleset_versions', 'band_rule_version_id', 'UPDATE'), false, 'L-33: band_rule_version_id is outside the authenticated UPDATE grant');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.ruleset_versions set band_rule_version_id = (select id from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 1) where test_id = (select id from public.tests where name = 'Test Nine')$$), '^42501 permission denied', 'L-33: an admin cannot set band_rule_version_id (permission denied)');
reset role;
reset request.jwt.claims;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.ruleset_versions), 5, 'L-33: the integrity worker (job org A) reads the org A rulesets that name the rule version (S)');
select matches(pg_temp.try($$update public.ruleset_versions set band_rule_version_id = null$$), '^42501 permission denied', 'L-33: the integrity worker cannot change a ruleset (S only)');
reset role;
reset trace.job_org_id;
-- ===== a test version pins its ruleset at publish (Q20); the ruleset freezes with it =====
-- Test Nine: add one mcq section, item and key on the operator path, then the owner publishes it.
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) select '51000000-0000-4000-8000-000000000009', org_id, id, 1, 'Nine Choices', 'mcq', 1 from public.test_versions where id = (select id from public.test_versions where test_id = (select id from public.tests where name = 'Test Nine') and version_no = 1);
insert into public.item_versions (id, org_id, test_version_id, section_id, format, position, stem, options, rubric_version_id, origin, content_sha256) values ('61000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', (select id from public.test_versions where test_id = (select id from public.tests where name = 'Test Nine') and version_no = 1), '51000000-0000-4000-8000-000000000009', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64));
insert into public.item_answer_keys (org_id, item_version_id, format, key) values ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000009', 'mcq', '{"option_id": "o1"}');
select is((select (published_at is null)::text from public.ruleset_versions where test_id = (select id from public.tests where name = 'Test Nine')), 'true', 'freeze: a draft''s ruleset has no published_at');
select is(pg_temp.try($$update public.ruleset_versions set content_sha256 = repeat('f', 64) where test_id = (select id from public.tests where name = 'Test Nine')$$), 'OK 1', 'freeze: the operator can still update a draft''s ruleset');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id = (select id from public.test_versions where test_id = (select id from public.tests where name = 'Test Nine') and version_no = 1)$$), 'OK 1', 'freeze: owner publishes the version (the pinned ruleset becomes frozen with it)');
reset role;
reset request.jwt.claims;
select matches(pg_temp.try($$update public.ruleset_versions set content_sha256 = repeat('f', 64) where test_id = (select id from public.tests where name = 'Test Nine')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'freeze: after publish the ruleset of the version is frozen for the operator');
select matches(pg_temp.try($$update public.ruleset_versions set band_rule_version_id = (select id from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 2) where test_id = (select id from public.tests where name = 'Test Nine')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'freeze: after publish the ruleset cannot be re-pointed at another rule table');
select is((select r.published_at = v.published_at from public.ruleset_versions r join public.test_versions v on v.org_id = r.org_id and v.ruleset_version_id = r.id where v.id = (select id from public.test_versions where test_id = (select id from public.tests where name = 'Test Nine') and version_no = 1)), true, 'freeze: publishing stamped the ruleset''s published_at with the version''s');
select matches(pg_temp.try($$update public.ruleset_versions set content_sha256 = repeat('f', 64) where test_id = 'e1000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'freeze: a ruleset referenced by a published version cannot be updated (even by the operator)');
select matches(pg_temp.try($$delete from public.ruleset_versions where test_id = 'e1000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'freeze: a ruleset referenced by a published version cannot be deleted');
select is((select (published_at is not null)::text from public.ruleset_versions where test_id = 'e1000000-0000-4000-8000-000000000001' and version_no = 1), 'true', 'freeze: the publish trigger stamped published_at on the ruleset of the published version');
select is((select count(*)::int from public.test_versions v where v.status <> 'draft' and not exists (select 1 from public.ruleset_versions r where r.org_id = v.org_id and r.id = v.ruleset_version_id and r.test_id = v.test_id and r.version_no = v.version_no and r.published_at is not null and r.band_rule_version_id is not null)), 0, 'pin: every published version points at its own published ruleset, and that ruleset names a band rule version');
set local session_replication_role = replica;
select matches(pg_temp.try($$update public.ruleset_versions set content_sha256 = repeat('f', 64) where test_id = 'e1000000-0000-4000-8000-000000000001' and version_no = 1$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'freeze: replica mode (ENABLE ALWAYS) still refuses a frozen ruleset update');
select matches(pg_temp.try($$delete from public.ruleset_versions where test_id = 'e1000000-0000-4000-8000-000000000001' and version_no = 1$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'freeze: replica mode still refuses a frozen ruleset delete');
set local session_replication_role = origin;
-- Publish needs a ruleset with a band rule version: Test Ten starts complete, then its ruleset loses the rule table.
insert into public.tests (id, org_id, workspace_id, name) values ('e1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test Ten');
insert into public.test_versions (id, org_id, test_id, version_no, total_time_seconds, quality_cutoff) values ('f1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-00000000000a', 1, 1800, 40);
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values ('51000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-00000000000a', 1, 'Ten Choices', 'mcq', 1);
insert into public.item_versions (id, org_id, test_version_id, section_id, format, position, stem, options, rubric_version_id, origin, content_sha256) values ('61000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-00000000000a', '51000000-0000-4000-8000-00000000000a', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64));
insert into public.item_answer_keys (org_id, item_version_id, format, key) values ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-00000000000a', 'mcq', '{"option_id": "o1"}');
update public.ruleset_versions set band_rule_version_id = null where test_id = 'e1000000-0000-4000-8000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id = 'f1000000-0000-4000-8000-00000000000a'$$), '^42501 TRACE_GUARD', 'pin: publish is refused when the pinned ruleset has no band rule version');
reset role;
reset request.jwt.claims;
update public.ruleset_versions set band_rule_version_id = (select id from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 1) where test_id = 'e1000000-0000-4000-8000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id = 'f1000000-0000-4000-8000-00000000000a'$$), 'OK 1', 'pin: with the rule table restored the same version publishes');
reset role;
reset request.jwt.claims;
select is((select count(*)::int from public.test_versions where test_id = 'e1000000-0000-4000-8000-00000000000a' and status = 'published'), 1, 'pin: exactly one published version results');
-- A newer rule table does not move a published ruleset.
select is((select r.band_rule_version_id from public.ruleset_versions r where r.test_id = 'e1000000-0000-4000-8000-000000000001' and r.version_no = 1), (select id from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 1), 'pin: the published ruleset of V1 still names the seeded v1 although v2..v6 now exist');
select is((select count(*)::int from public.test_versions where ruleset_version_id is null or notice_version_id is null), 0, 'L-8: no version row lacks a ruleset or notice id');
select is((select count(*)::int from pg_attribute a where a.attrelid = 'public.test_versions'::regclass and a.attname in ('ruleset_version_id', 'notice_version_id') and (has_column_privilege('authenticated', a.attrelid, a.attname, 'INSERT') or has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE'))), 0, 'L-8: ruleset_version_id and notice_version_id are outside the authenticated INSERT and UPDATE grants (trigger-only columns)');

select is((select content_sha256 from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and version_no = 1), 'c862bf653c6284fbb4d2319c923cd1c8aa28bcc40a2a61ccbc10d6e6af96ca0e', 'seed: content_sha256 is the SHA-256 of the canonical JSON of rule table d1-v1 (pinned until band-rules-sync.test.mjs lands; DB review m3 n-3)');

select * from finish();
rollback;
