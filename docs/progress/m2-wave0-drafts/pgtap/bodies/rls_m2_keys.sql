-- rls_m2_keys (spec specs/m2-scheduling-invites.md revision 5 §10 row rls_m2_keys; §3.2 org_keys; §3.4 row org_keys; M2-3, M2-20, R2-15, R5-9). RED first: written from the spec before migration M2-a. Key material is synthetic.
-- Fixtures: a version-1 contacts key for org A on the operator path.
insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek)
  values (pg_temp.id('A'), 'contacts', 1, 'dev:1', 'AAAAAAAAAAAAAAAAAAAAAA==');

-- ===== Role trace_messaging_worker (M2-20, R5-9) =====
select is((select rolcanlogin::text || '|' || rolbypassrls::text || '|' || rolsuper::text from pg_catalog.pg_roles where rolname = 'trace_messaging_worker'), 'false|false|false', 'role: trace_messaging_worker exists, NOLOGIN, no bypass, no superuser');
select is(has_schema_privilege('trace_messaging_worker', 'private', 'USAGE'), true, 'role: the messaging worker has USAGE on private (it calls its functions by name)');
select is(has_function_privilege('trace_messaging_worker', 'private.job_org_id()', 'EXECUTE'), true, 'role: the messaging worker may call private.job_org_id()');
select is(has_schema_privilege('trace_messaging_worker', 'quality', 'USAGE') or has_schema_privilege('trace_messaging_worker', 'integrity', 'USAGE'), false, 'role (rule 1): the messaging worker has no USAGE on quality or integrity');

-- ===== Shape (M2-3) =====
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'names', 1, 'dev:1', 'AAAAAAAAAAAAAAAAAAAAAA==')$$), '^23514', 'shape: purpose is contacts or bidx');
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'bidx', 0, 'dev:1', 'AAAAAAAAAAAAAAAAAAAAAA==')$$), '^23514', 'shape: key_version starts at 1');
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'bidx', 1, 'plain key', 'AAAAAAAAAAAAAAAAAAAAAA==')$$), '^23514', 'shape: kms_key_ref is an ARN or dev:<n>');
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'bidx', 1, 'dev:1', repeat('A', 1028))$$), '^23514', 'shape: a wrapped key over 1 KB is refused');
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'bidx', 1, 'dev:1', 'not base64!')$$), '^23514', 'shape: the wrapped key is base64');
select is(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'bidx', 1, 'arn:aws:kms:ap-south-1:123456789012:key/mrk-0000', 'AAAAAAAAAAAAAAAAAAAAAA==')$$), 'OK 1', 'shape: an ap-south-1 KMS ARN is accepted');

-- ===== trace_api (S, I through the api org; R2-15 first-use race) =====
select pg_temp.api(pg_temp.id('A'));
select is((select count(*)::int from public.org_keys), 2, 'S api: trace_api reads its api org''s keys');
select is(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'contacts', 1, 'dev:1', 'BBBBBBBBBBBBBBBBBBBBBB==') on conflict do nothing$$), 'OK 0', 'I api (R2-15): a racing first use does nothing on conflict; the caller re-selects the stored key');
select is((select wrapped_dek from public.org_keys where purpose = 'contacts' and key_version = 1), 'AAAAAAAAAAAAAAAAAAAAAA==', 'I api (R2-15): the stored key is the first one');
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000003', 'contacts', 1, 'dev:1', 'AAAAAAAAAAAAAAAAAAAAAA==')$$), '^42501', 'I api: trace_api cannot write another org''s key');
select matches(pg_temp.try($$update public.org_keys set retired_at = now()$$), '^42501', 'U api: no UPDATE grant');
select matches(pg_temp.try($$delete from public.org_keys$$), '^42501', 'D api: no DELETE grant');
select pg_temp.api(pg_temp.id('B'));
select is((select count(*)::int from public.org_keys), 0, 'S api: with org B as the api org, org A''s keys are invisible');
select pg_temp.api(null);
select is((select count(*)::int from public.org_keys), 0, 'S api: with no api org, nothing is visible');

-- ===== trace_messaging_worker (S through the job org) =====
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select is((select count(*)::int from public.org_keys), 2, 'S worker: the messaging worker reads its job org''s keys');
select matches(pg_temp.try($$insert into public.org_keys (org_id, purpose, key_version, kms_key_ref, wrapped_dek) values ('a1000000-0000-4000-8000-000000000001', 'contacts', 2, 'dev:1', 'AAAAAAAAAAAAAAAAAAAAAA==')$$), '^42501', 'I worker: the messaging worker cannot write keys');
select pg_temp.w('trace_messaging_worker', pg_temp.id('B'));
select is((select count(*)::int from public.org_keys), 0, 'S worker: another job org sees nothing');

-- ===== Every app role is denied =====
select pg_temp.u('owner');
select matches(pg_temp.try('select * from public.org_keys'), '^42501 permission denied', 'S owner: no app-role grant (M2-3)');
select pg_temp.u('recruiter');
select matches(pg_temp.try('select * from public.org_keys'), '^42501 permission denied', 'S recruiter: denied');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.org_keys'), '^42501 permission denied', 'S trace_worker: denied');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.org_keys'), '^42501 permission denied', 'S authoring worker: denied');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try('select * from public.org_keys'), '^42501 permission denied', 'S candidate: denied');
reset role;
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.org_keys'::regclass), true, 'RLS: enabled on org_keys');
