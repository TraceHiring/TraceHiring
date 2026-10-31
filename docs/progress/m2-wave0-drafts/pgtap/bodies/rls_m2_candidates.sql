-- rls_m2_candidates (spec specs/m2-scheduling-invites.md revision 5 §10 row rls_m2_candidates; §3.2 candidates; §3.4 row candidates; §3.5 I-M2-1; M2-3, R2-2, R3-8, R5-4, R5-15, R5-49). RED first: written from the spec before migration M2-a. Ciphertexts and fingerprints are synthetic.
-- Fixtures: candidate c1 in workspace A1, c2 in A2 (org A), cb in org B.
select pg_temp.cand('c1', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.cand('c2', pg_temp.id('A'), pg_temp.id('A2'));
select pg_temp.cand('cb', pg_temp.id('B'), pg_temp.id('BW'));

-- ===== Columns: ciphertext only (I-M2-1, MT-15) =====
select is((select array_agg(a.attname::text order by a.attnum) from pg_catalog.pg_attribute as a where a.attrelid = 'public.candidates'::regclass and a.attnum > 0 and not a.attisdropped), array['id', 'org_id', 'workspace_id', 'full_name_ct', 'key_version', 'contact_fingerprint', 'created_by', 'created_at'], 'columns: candidates holds the name as ciphertext and a fingerprint only (no DOB, age, adult flag, gender, college or free text)');
select matches(pg_temp.try(format($$insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint) values (%L, %L, 'Asha Rao', 1, %L)$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.h('x1'))), '^23514', 'shape: a plaintext name is refused by the ciphertext CHECK');
select matches(pg_temp.try(format($$insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint) values (%L, %L, %L, 1, %L)$$, pg_temp.id('A'), pg_temp.id('A1'), 'v1.1.' || repeat('A', 2100), pg_temp.h('x2'))), '^23514', 'shape: a ciphertext over 2 KB is refused');
select matches(pg_temp.try(format($$insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint) values (%L, %L, %L, 1, 'not-a-hash')$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.ct('n-x3'))), '^23514', 'shape: the fingerprint is 64 hex characters');
select matches(pg_temp.try(format($$insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint) values (%L, %L, %L, 1, %L)$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.ct('n-again'), pg_temp.h('e-c1'))), '^23505', 'R2-2: one candidate per (org, workspace, fingerprint)');
select is(pg_temp.try(format($$insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint) values (%L, %L, %L, 1, %L)$$, pg_temp.id('A'), pg_temp.id('A2'), pg_temp.ct('n-c1-a2'), pg_temp.h('e-c1'))), 'OK 1', 'R2-2: the same person in another workspace of the org is another row');
select matches(pg_temp.try(format($$insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint) values (%L, %L, %L, 1, %L)$$, pg_temp.id('A'), pg_temp.id('BW'), pg_temp.ct('n-x4'), pg_temp.h('x4'))), '^23503', 'R5-49: a workspace of another org is refused by the (org, workspace) key');

-- ===== S: staff of the workspace (OW AD RC), fenced =====
select pg_temp.u('owner');
select is((select count(*)::int from public.candidates), 3, 'S owner: every candidate of org A, both workspaces');
select pg_temp.u('recruiter');
select is((select count(*)::int from public.candidates), 3, 'S recruiter (org-wide): org A''s candidates');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.candidates), 2, 'S ws_recruiter: only workspace A2''s candidates (fence)');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.candidates), 0, 'S reviewer: nothing (R2-11)');
select pg_temp.u('hm');
select is((select count(*)::int from public.candidates), 0, 'S hiring manager: nothing');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.candidates), 1, 'S org B admin: only org B''s candidate');
select pg_temp.u('outsider');
select is((select count(*)::int from public.candidates), 0, 'S outsider: nothing');

-- ===== I: staff of the workspace only (through ingest_invite_batch in practice; R5-15) =====
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint) values (%L, %L, %L, 1, %L)$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.ct('n-r1'), pg_temp.h('e-r1'))), 'OK 1', 'I recruiter: may insert a candidate in its workspace');
select is((select created_by from public.candidates where contact_fingerprint = pg_temp.h('e-r1')), pg_temp.id('recruiter'), 'I recruiter: created_by is the caller');
select is(pg_temp.try(format($$insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint) values (%L, %L, %L, 1, %L) on conflict (org_id, workspace_id, contact_fingerprint) do nothing$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.ct('n-r1b'), pg_temp.h('e-r1'))), 'OK 0', 'I recruiter (R5-15): a known fingerprint does nothing on conflict');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try(format($$insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint) values (%L, %L, %L, 1, %L)$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.ct('n-w1'), pg_temp.h('e-w1'))), '^42501', 'I ws_recruiter: refused outside its workspace (fence)');
select pg_temp.u('reviewer');
select matches(pg_temp.try(format($$insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint) values (%L, %L, %L, 1, %L)$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.ct('n-v1'), pg_temp.h('e-v1'))), '^42501', 'I reviewer: refused');
select pg_temp.u('b_admin');
select matches(pg_temp.try(format($$insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint) values (%L, %L, %L, 1, %L)$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.ct('n-b1'), pg_temp.h('e-b1'))), '^42501', 'I org B admin: refused in org A');

-- ===== U and D: nobody (insert-once, R5-52 c) =====
select pg_temp.u('owner');
select matches(pg_temp.try('update public.candidates set key_version = 2'), '^42501', 'U owner: no UPDATE grant');
select matches(pg_temp.try('delete from public.candidates'), '^42501', 'D owner: no DELETE grant');
select pg_temp.op();
select matches(pg_temp.try('update public.candidates set key_version = 2'), '^42501 TRACE_GUARD: candidates are insert-once', 'U operator: the insert-once trigger refuses even the owner');

-- ===== Other roles =====
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.candidates'), '^42501 permission denied', 'S api: trace_api holds no grant (names reach the api through private functions only)');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.candidates'), '^42501 permission denied', 'S trace_worker: denied');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.candidates'), '^42501 permission denied', 'S quality worker: denied');
select pg_temp.op();
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.candidates'::regclass), true, 'RLS: enabled on candidates');
