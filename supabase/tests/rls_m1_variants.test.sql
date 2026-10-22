-- rls_m1_variants (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_variants; §3.2 item_variants, §4.1, §6.3, I-M1-4; AT-M1-05; R2-22, R3-4). RED first: written from the spec before migration M1-a. Personas and items are synthetic.
begin;
-- Helpers live in pg_temp (rolled back with the transaction). try() runs one statement as the current role and returns
-- 'OK <rows>' or '<sqlstate> <message>', so a denial is an assertion, not an abort.
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
-- id(name): a fixture id recorded by the fixture helpers below (readable by every role in this transaction).
create table pg_temp.ids (k text primary key, v uuid not null);
grant select on pg_temp.ids to public;
create function pg_temp.id(p_k text) returns uuid language sql stable as $f$
  select v from pg_temp.ids where k = p_k
$f$;
grant execute on function pg_temp.id(text) to public;
-- Persona switching. u(name) = an org user (role authenticated plus JWT claims); w(role, org) = a worker role bound to a
-- job org; api(org) = trace_api bound to an api org; op() = the operator path (postgres, no role, no claims).
create function pg_temp.u(p_who text) returns void language plpgsql as $f$
declare v_sub text; v_amr text;
begin
  select x.sub, x.amr into v_sub, v_amr from (values
    ('owner', '00000000-0000-4000-8000-000000000001', 'aal2'),
    ('admin', '00000000-0000-4000-8000-000000000003', 'aal2'),
    ('admin_aal1', '00000000-0000-4000-8000-000000000004', 'otp'),
    ('recruiter', '00000000-0000-4000-8000-000000000005', 'otp'),
    ('recruiter_pw', '00000000-0000-4000-8000-000000000006', 'pw'),
    ('reviewer', '00000000-0000-4000-8000-000000000007', 'aal2'),
    ('reviewer_aal1', '00000000-0000-4000-8000-000000000007', 'otp'),
    ('hm', '00000000-0000-4000-8000-000000000008', 'otp'),
    ('ws_recruiter', '00000000-0000-4000-8000-000000000009', 'otp'),
    ('ws_reviewer', '00000000-0000-4000-8000-00000000000a', 'aal2'),
    ('b_admin', '00000000-0000-4000-8000-00000000000e', 'aal2'),
    ('outsider', '00000000-0000-4000-8000-000000000011', 'otp'),
    ('lib_author', '00000000-0000-4000-8000-000000000020', 'aal2'),
    ('lib_expert', '00000000-0000-4000-8000-000000000021', 'aal2')
  ) as x(who, sub, amr) where x.who = p_who;
  if v_sub is null then
    raise exception 'unknown persona %', p_who;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('trace.job_org_id', '', true);
  perform set_config('trace.api_org_id', '', true);
  perform set_config('request.jwt.claims', case v_amr
    when 'aal2' then '{"sub": "' || v_sub || '", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}'
    when 'pw' then '{"sub": "' || v_sub || '", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}'
    else '{"sub": "' || v_sub || '", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}'
  end, true);
end
$f$;
grant execute on function pg_temp.u(text) to public;
create function pg_temp.op() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('trace.job_org_id', '', true);
  perform set_config('trace.api_org_id', '', true);
end
$f$;
grant execute on function pg_temp.op() to public;
create function pg_temp.w(p_role text, p_org uuid) returns void language plpgsql as $f$
begin
  perform pg_temp.op();
  perform set_config('role', p_role, true);
  perform set_config('trace.job_org_id', coalesce(p_org::text, ''), true);
end
$f$;
grant execute on function pg_temp.w(text, uuid) to public;
create function pg_temp.api(p_org uuid) returns void language plpgsql as $f$
begin
  perform pg_temp.op();
  perform set_config('role', 'trace_api', true);
  perform set_config('trace.api_org_id', coalesce(p_org::text, ''), true);
end
$f$;
grant execute on function pg_temp.api(uuid) to public;
grant trace_worker to postgres with inherit false, set true;
grant trace_quality_worker to postgres with inherit false, set true;
grant trace_integrity_worker to postgres with inherit false, set true;
grant trace_api to postgres with inherit false, set true;
grant trace_candidate to postgres with inherit false, set true;
grant trace_authoring_worker to postgres with inherit false, set true;
grant trace_admin_worker to postgres with inherit false, set true;
grant usage on schema extensions to authenticated, anon, service_role, trace_worker, trace_quality_worker,
  trace_integrity_worker, trace_api, trace_candidate, trace_authoring_worker, trace_admin_worker;

-- Personas (synthetic, p-<persona>@example.test), orgs A and B (customers) and the library org of migration M1-a.
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p-owner-admin@example.test'),
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'p-admin@example.test'),
  ('00000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'p-admin-aal1@example.test'),
  ('00000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'p-recruiter-otp@example.test'),
  ('00000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'p-recruiter-pw@example.test'),
  ('00000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'p-reviewer@example.test'),
  ('00000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'p-hm@example.test'),
  ('00000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'p-ws-recruiter@example.test'),
  ('00000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'p-ws-reviewer@example.test'),
  ('00000000-0000-4000-8000-00000000000e', 'authenticated', 'authenticated', 'p-b-admin@example.test'),
  ('00000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'p-outsider@example.test'),
  ('00000000-0000-4000-8000-000000000020', 'authenticated', 'authenticated', 'p-lib-author@example.test'),
  ('00000000-0000-4000-8000-000000000021', 'authenticated', 'authenticated', 'p-lib-expert@example.test');
insert into public.orgs (id, kind, name, slug) values
  ('a1000000-0000-4000-8000-000000000001', 'customer', 'Org A', 'org-a-m1-test'),
  ('a1000000-0000-4000-8000-000000000003', 'customer', 'Org B', 'org-b-m1-test');
insert into public.workspaces (id, org_id, name, kind, is_default) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Default', 'default', true),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Client A2', 'client', false),
  ('b1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000003', 'Default', 'default', true);
insert into pg_temp.ids values
  ('A', 'a1000000-0000-4000-8000-000000000001'), ('B', 'a1000000-0000-4000-8000-000000000003'),
  ('A1', 'b1000000-0000-4000-8000-000000000001'), ('A2', 'b1000000-0000-4000-8000-000000000002'),
  ('BW', 'b1000000-0000-4000-8000-000000000004'),
  ('L', (select id from public.orgs where kind = 'trace_library')),
  ('LW', (select w.id from public.workspaces as w join public.orgs as o on o.id = w.org_id
          where o.kind = 'trace_library' and w.is_default)),
  ('owner', '00000000-0000-4000-8000-000000000001'), ('admin', '00000000-0000-4000-8000-000000000003'),
  ('recruiter', '00000000-0000-4000-8000-000000000005'), ('reviewer', '00000000-0000-4000-8000-000000000007'),
  ('ws_recruiter', '00000000-0000-4000-8000-000000000009'), ('b_admin', '00000000-0000-4000-8000-00000000000e'),
  ('lib_author', '00000000-0000-4000-8000-000000000020'), ('lib_expert', '00000000-0000-4000-8000-000000000021');
insert into public.memberships (org_id, user_id, roles, workspace_id, display_name, status) values
  (pg_temp.id('A'), pg_temp.id('owner'), '{org_owner,admin}', null, 'Persona Owner Admin', 'active'),
  (pg_temp.id('A'), pg_temp.id('admin'), '{admin}', null, 'Persona Admin', 'active'),
  (pg_temp.id('A'), '00000000-0000-4000-8000-000000000004', '{admin}', null, 'Persona Admin Aal1', 'active'),
  (pg_temp.id('A'), pg_temp.id('recruiter'), '{recruiter}', null, 'Persona Recruiter', 'active'),
  (pg_temp.id('A'), '00000000-0000-4000-8000-000000000006', '{recruiter}', null, 'Persona Recruiter Pw', 'active'),
  (pg_temp.id('A'), pg_temp.id('reviewer'), '{reviewer}', null, 'Persona Reviewer', 'active'),
  (pg_temp.id('A'), '00000000-0000-4000-8000-000000000008', '{hiring_manager}', null, 'Persona Hm', 'active'),
  (pg_temp.id('A'), pg_temp.id('ws_recruiter'), '{recruiter}', pg_temp.id('A2'), 'Persona Ws Recruiter', 'active'),
  (pg_temp.id('A'), '00000000-0000-4000-8000-00000000000a', '{reviewer}', pg_temp.id('A2'), 'Persona Ws Reviewer', 'active'),
  (pg_temp.id('B'), pg_temp.id('b_admin'), '{org_owner,admin}', null, 'Persona B Admin', 'active'),
  (pg_temp.id('L'), pg_temp.id('lib_author'), '{org_owner,admin,recruiter}', null, 'Persona Lib Author', 'active'),
  (pg_temp.id('L'), pg_temp.id('lib_expert'), '{reviewer}', null, 'Persona Lib Expert', 'active');

-- bank(key, org, workspace, format, skill, difficulty, status): a bank item and its version on the operator path, an
-- answer key for MCQ, then the transitions up to the asked status (approver = the org's owner, or the library expert).
-- Records ids <key> (version) and <key>_item.
create function pg_temp.bank(p_key text, p_org uuid, p_ws uuid, p_format text, p_skill text, p_diff numeric,
  p_status text) returns uuid language plpgsql as $f$
declare v_item uuid; v_ver uuid; v_lib boolean := p_org = pg_temp.id('L');
begin
  insert into public.items (org_id, workspace_id, format, skill_key, created_by)
    values (p_org, p_ws, p_format::public.section_format, p_skill,
      case when v_lib then pg_temp.id('lib_author') else pg_temp.id('owner') end)
    returning id into v_item;
  insert into public.item_versions (org_id, item_id, format, stem, options, rubric_version_id, skill_key, difficulty,
      content_sha256, created_by)
    values (p_org, v_item, p_format::public.section_format, '[synthetic] Bank item ' || p_key,
      case when p_format = 'mcq' then '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]'::jsonb end,
      case when p_format = 'written' then (select r.id from public.rubric_versions as r
                                           where r.org_id = p_org and r.rubric_key = 'default') end,
      p_skill, p_diff, repeat('c', 64),
      case when v_lib then pg_temp.id('lib_author') else pg_temp.id('owner') end)
    returning id into v_ver;
  if p_format = 'mcq' then
    insert into public.item_answer_keys (org_id, item_version_id, format, key) values (p_org, v_ver, 'mcq', '{"option_id": "o1"}');
  end if;
  if p_status in ('in_review', 'approved', 'retired', 'not_approved') then
    update public.item_versions set status = 'in_review' where id = v_ver;
  end if;
  if p_status = 'not_approved' then
    update public.item_versions set status = 'not_approved' where id = v_ver;
  end if;
  if p_status in ('approved', 'retired') then
    update public.item_versions set status = 'approved',
      approved_by = case when v_lib then pg_temp.id('lib_expert') when p_org = pg_temp.id('B') then pg_temp.id('b_admin')
                         else pg_temp.id('owner') end,
      reviewed_by = case when v_lib then pg_temp.id('lib_expert') end,
      key_reviewed_by = case when v_lib then pg_temp.id('lib_expert') end
    where id = v_ver;
  end if;
  if p_status = 'retired' then
    update public.item_versions set status = 'retired' where id = v_ver;
  end if;
  insert into pg_temp.ids values (p_key, v_ver), (p_key || '_item', v_item);
  return v_ver;
end
$f$;
select plan(34);
-- Fixtures: a parameterised MCQ draft P (difficulty 0.50) in workspace A1, one in A2, and a plain approved MCQ item.
select pg_temp.bank('qa1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant', 0.50, 'approved');
insert into public.items (id, org_id, workspace_id, format, skill_key) values
  ('c2000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant'),
  ('c2000000-0000-4000-8000-000000000002', pg_temp.id('A'), pg_temp.id('A2'), 'mcq', 'quant');
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256) values
  ('c2100000-0000-4000-8000-000000000001', pg_temp.id('A'), 'c2000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] P',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64)),
  ('c2100000-0000-4000-8000-000000000002', pg_temp.id('A'), 'c2000000-0000-4000-8000-000000000002', 'mcq', '[synthetic] P2',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64));

-- ===== param_spec shape (§5 ParamSpec) =====
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.item_versions set param_spec = '{"params": {}, "stem": "x", "options": [], "correctOptionId": "o1", "count": 5}' where id = 'c2100000-0000-4000-8000-000000000001'$$), '^23514', 'param_spec: a spec without parameters or options violates its CHECK');
select matches(pg_temp.try($$update public.item_versions set is_parameterised = true, param_spec = null where id = 'c2100000-0000-4000-8000-000000000001'$$), '^23514', 'param_spec: a parameterised item needs its spec');

-- ===== I: variants of a draft, ±0.10 (AT-M1-05) =====
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 1, '{"a": 3}', '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.60, repeat('c', 64))$$), 'OK 1', 'AT-M1-05: a variant 0.10 above its item is accepted');
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 2, '{"a": 4}', '[synthetic] What is 4 + 1?', '[{"id": "o1", "text": "5"}, {"id": "o2", "text": "4"}]', 0.40, repeat('c', 64))$$), 'OK 1', 'AT-M1-05: a variant 0.10 below its item is accepted');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 3, '{"a": 5}', '[synthetic] What is 5 + 1?', '[{"id": "o1", "text": "6"}, {"id": "o2", "text": "5"}]', 0.61, repeat('c', 64))$$), '^23514 TRACE_GUARD: a variant difficulty must be within 0.10 of its item', 'AT-M1-05: a variant 0.11 away is refused');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 3, '{"a": 5}', '[synthetic] What is 5 + 1?', '[{"id": "o1", "text": "6"}, {"id": "o2", "text": "5"}]', 0.39, repeat('c', 64))$$), '^23514 TRACE_GUARD: a variant difficulty must be within 0.10 of its item', 'AT-M1-05: a variant 0.11 below is refused');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 1, '{"a": 6}', '[synthetic] What is 6 + 1?', '[{"id": "o1", "text": "7"}, {"id": "o2", "text": "6"}]', 0.50, repeat('c', 64))$$), '^23505', 'variants I: variant numbers are unique per item version');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 4, '{"a": {"nested": 1}}', '[synthetic] x', '[{"id": "o1", "text": "7"}, {"id": "o2", "text": "6"}]', 0.50, repeat('c', 64))$$), '^23514', 'variants I: params are scalars only');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 4, '{"a": 7}', '[synthetic] x', '[{"id": "o1", "text": "7"}]', 0.50, repeat('c', 64))$$), '^23514', 'variants I: variant options are 2 to 6 MCQ options');
select matches(pg_temp.try(format($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', %L, 1, '{"a": 7}', '[synthetic] x', '[{"id": "o1", "text": "7"}, {"id": "o2", "text": "6"}]', 0.50, repeat('c', 64))$$, pg_temp.id('qa1'))), '^42501 TRACE_GUARD: variants change only while their parameterised item is a draft', 'variants I: an item that is not parameterised (and approved) takes no variant');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 5, '{"a": 8}', '[synthetic] x', '[{"id": "o1", "text": "9"}, {"id": "o2", "text": "8"}]', 0.50, repeat('c', 64))$$), '^42501', 'variants I: workspace recruiter cannot add a variant to a workspace A1 item');
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000002', 1, '{"a": 8}', '[synthetic] What is 8 + 1?', '[{"id": "o1", "text": "9"}, {"id": "o2", "text": "8"}]', 0.50, repeat('c', 64))$$), 'OK 1', 'variants I: workspace recruiter adds a variant to a workspace A2 item');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 6, '{"a": 2}', '[synthetic] x', '[{"id": "o1", "text": "3"}, {"id": "o2", "text": "2"}]', 0.50, repeat('c', 64))$$), '^42501', 'variants I: a reviewer cannot add a variant');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 6, '{"a": 2}', '[synthetic] x', '[{"id": "o1", "text": "3"}, {"id": "o2", "text": "2"}]', 0.50, repeat('c', 64))$$), '^42501', 'variants I: org B admin cannot add a variant in org A');
select pg_temp.op();
select is((select workspace_id from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000002'), pg_temp.id('A2'), 'variants I: the workspace comes from the item version');

-- ===== S =====
select pg_temp.u('reviewer');
select is((select count(*)::int from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001'), 2, 'variants S: the reviewer reads the variants of their workspace');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001'), 0, 'variants S: workspace recruiter reads no workspace A1 variant');
select pg_temp.u('hm');
select is((select count(*)::int from public.item_variants), 0, 'variants S: hiring manager reads nothing');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select is((select count(*)::int from public.item_variants), 3, 'variants S: the quality worker reads the variants of its job org');
select pg_temp.w('trace_quality_worker', pg_temp.id('B'));
select is((select count(*)::int from public.item_variants), 0, 'variants S: the quality worker bound to org B reads no org A variant');

-- ===== Readiness on leaving draft, immutability (I-M1-4, R2-22) =====
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: every variant needs its answer key', 'readiness: a parameterised item needs a key on every variant');
select is(pg_temp.try($$insert into public.item_variant_keys (org_id, item_variant_id, key) select org_id, id, '{"option_id": "o1"}' from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001'$$), 'OK 2', 'readiness: both variants are keyed');
select is(pg_temp.try($$update public.item_versions set difficulty = 0.70 where id = 'c2100000-0000-4000-8000-000000000001'$$), 'OK 1', 'readiness: the draft item difficulty moves to 0.70');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000001'$$), '^23514 TRACE_GUARD: a variant difficulty must be within 0.10 of its item', 'readiness: the 0.40 variant is now 0.30 away, so the item cannot be submitted');
select is(pg_temp.try($$delete from public.item_variant_keys where item_variant_id in (select id from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001' and variant_no = 2)$$), 'OK 1', 'regeneration: the key of the far variant is deleted while the item is a draft');
select is(pg_temp.try($$delete from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001' and variant_no = 2$$), 'OK 1', 'regeneration: the far variant itself is deleted (R2-22)');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000001'$$), 'OK 1', 'readiness: with one keyed variant within 0.10, the item is submitted');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 7, '{"a": 2}', '[synthetic] x', '[{"id": "o1", "text": "3"}, {"id": "o2", "text": "2"}]', 0.70, repeat('c', 64))$$), '^42501 TRACE_GUARD: variants change only while their parameterised item is a draft', 'immutability: no variant is added once the item leaves draft');
select matches(pg_temp.try($$delete from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: variants change only while their parameterised item is a draft', 'immutability: no variant is deleted once the item leaves draft');
select pg_temp.op();
select matches(pg_temp.try($$update public.item_variants set stem = 'changed' where item_version_id = 'c2100000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: variants are immutable', 'immutability: a variant is never updated, even on the operator path');
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.item_variants set stem = 'changed'$$), '^42501 permission denied', 'immutability: no update grant on variants');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000002'$$), '^42501 TRACE_GUARD: every variant needs its answer key', 'readiness: the A2 item without variant keys cannot be submitted');
select is(pg_temp.try($$delete from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000002'$$), 'OK 1', 'regeneration: the A2 variant is deleted');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000002'$$), '^42501 TRACE_GUARD: a parameterised item needs its variants', 'readiness: a parameterised item without variants cannot be submitted');
select * from finish();
rollback;
