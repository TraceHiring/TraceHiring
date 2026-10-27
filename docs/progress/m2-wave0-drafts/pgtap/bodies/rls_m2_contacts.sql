-- rls_m2_contacts (spec specs/m2-scheduling-invites.md revision 5 §10 row rls_m2_contacts; §3.2 candidate_contacts; §3.4 row candidate_contacts; M2-3, R5-4, R5-52 c). RED first: written from the spec before migration M2-a. Ciphertexts, blind indexes and hints are synthetic.
-- Fixtures: candidates c1 (A1, with a phone), c2 (A2, no phone) and cb (org B).
select pg_temp.cand('c1', pg_temp.id('A'), pg_temp.id('A1'), 'p1');
select pg_temp.cand('c2', pg_temp.id('A'), pg_temp.id('A2'));
select pg_temp.cand('cb', pg_temp.id('B'), pg_temp.id('BW'));
insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint)
  values (pg_temp.id('A'), pg_temp.id('A1'), pg_temp.ct('n-c3'), 1, pg_temp.h('e-c3'));
insert into pg_temp.ids select 'c3', id from public.candidates where contact_fingerprint = pg_temp.h('e-c3');

-- ===== Columns and shapes (I-M2-1) =====
select is((select array_agg(a.attname::text order by a.attnum) from pg_catalog.pg_attribute as a where a.attrelid = 'public.candidate_contacts'::regclass and a.attnum > 0 and not a.attisdropped), array['org_id', 'candidate_id', 'workspace_id', 'email_ct', 'phone_ct', 'email_bidx', 'phone_bidx', 'email_hint', 'phone_hint', 'key_version', 'created_at'], 'columns: contacts are ciphertext, blind indexes and display hints only');
select matches(pg_temp.try(format($$insert into public.candidate_contacts (org_id, candidate_id, workspace_id, email_ct, email_bidx, email_hint, key_version) values (%L, %L, %L, 'c3@example.test', %L, 'c•••@example.test', 1)$$, pg_temp.id('A'), pg_temp.id('c3'), pg_temp.id('A1'), pg_temp.h('e-c3'))), '^23514', 'shape: a plaintext email is refused');
select matches(pg_temp.try(format($$insert into public.candidate_contacts (org_id, candidate_id, workspace_id, email_ct, email_bidx, email_hint, key_version) values (%L, %L, %L, %L, 'abc', 'c•••@example.test', 1)$$, pg_temp.id('A'), pg_temp.id('c3'), pg_temp.id('A1'), pg_temp.ct('e-c3'))), '^23514', 'shape: the email blind index is 64 hex characters');
select matches(pg_temp.try(format($$insert into public.candidate_contacts (org_id, candidate_id, workspace_id, email_ct, email_bidx, email_hint, key_version) values (%L, %L, %L, %L, %L, 'c3@example.test', 1)$$, pg_temp.id('A'), pg_temp.id('c3'), pg_temp.id('A1'), pg_temp.ct('e-c3'), pg_temp.h('e-c3'))), '^23514', 'shape: an email hint that is the address itself is refused');
select matches(pg_temp.try(format($$insert into public.candidate_contacts (org_id, candidate_id, workspace_id, email_ct, phone_ct, email_bidx, phone_bidx, email_hint, phone_hint, key_version) values (%L, %L, %L, %L, %L, %L, %L, 'c•••@example.test', '9876543210', 1)$$, pg_temp.id('A'), pg_temp.id('c3'), pg_temp.id('A1'), pg_temp.ct('e-c3'), pg_temp.ct('p-c3'), pg_temp.h('e-c3'), pg_temp.h('p-c3'))), '^23514', 'shape: a phone hint that is the number itself is refused');
select matches(pg_temp.try(format($$insert into public.candidate_contacts (org_id, candidate_id, workspace_id, email_ct, phone_ct, email_bidx, email_hint, key_version) values (%L, %L, %L, %L, %L, %L, 'c•••@example.test', 1)$$, pg_temp.id('A'), pg_temp.id('c3'), pg_temp.id('A1'), pg_temp.ct('e-c3'), pg_temp.ct('p-c3'), pg_temp.h('e-c3'))), '^23514', 'shape: a phone ciphertext needs its blind index and hint');
select matches(pg_temp.try(format($$insert into public.candidate_contacts (org_id, candidate_id, workspace_id, email_ct, email_bidx, email_hint, key_version) values (%L, %L, %L, %L, %L, 'c•••@example.test', 1)$$, pg_temp.id('A'), pg_temp.id('c3'), pg_temp.id('A2'), pg_temp.ct('e-c3'), pg_temp.h('e-c3'))), '^23503', 'R5-4: the contact''s workspace must be its candidate''s (fence key)');
select matches(pg_temp.try(format($$insert into public.candidate_contacts (org_id, candidate_id, workspace_id, email_ct, email_bidx, email_hint, key_version) values (%L, %L, %L, %L, %L, 'c•••@example.test', 1)$$, pg_temp.id('A'), pg_temp.id('cb'), pg_temp.id('A1'), pg_temp.ct('e-cb'), pg_temp.h('e-cb'))), '^23503', 'R5-4: another org''s candidate is refused');

-- ===== S: staff of the workspace =====
select pg_temp.u('owner');
select is((select count(*)::int from public.candidate_contacts), 2, 'S owner: both org A contacts');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.candidate_contacts), 1, 'S ws_recruiter: only workspace A2''s contact (fence)');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.candidate_contacts), 0, 'S reviewer: nothing (R2-11)');
select pg_temp.u('hm');
select is((select count(*)::int from public.candidate_contacts), 0, 'S hiring manager: nothing');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.candidate_contacts), 1, 'S org B admin: only org B''s contact');

-- ===== I: staff of the workspace, insert-once (R5-52 c) =====
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try(format($$insert into public.candidate_contacts (org_id, candidate_id, workspace_id, email_ct, email_bidx, email_hint, key_version) values (%L, %L, %L, %L, %L, 'c•••@example.test', 1)$$, pg_temp.id('A'), pg_temp.id('c3'), pg_temp.id('A1'), pg_temp.ct('e-c3'), pg_temp.h('e-c3'))), '^42501', 'I ws_recruiter: refused outside its workspace');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$insert into public.candidate_contacts (org_id, candidate_id, workspace_id, email_ct, email_bidx, email_hint, key_version) values (%L, %L, %L, %L, %L, 'c•••@example.test', 1)$$, pg_temp.id('A'), pg_temp.id('c3'), pg_temp.id('A1'), pg_temp.ct('e-c3'), pg_temp.h('e-c3'))), 'OK 1', 'I recruiter: may add the contact of a candidate in its workspace');
select is(pg_temp.try(format($$insert into public.candidate_contacts (org_id, candidate_id, workspace_id, email_ct, email_bidx, email_hint, key_version) values (%L, %L, %L, %L, %L, 'c•••@example.test', 1) on conflict (org_id, candidate_id) do nothing$$, pg_temp.id('A'), pg_temp.id('c3'), pg_temp.id('A1'), pg_temp.ct('e-c3-new'), pg_temp.h('e-c3'))), 'OK 0', 'I recruiter (R5-52 c): a later upload keeps the stored contact');
select matches(pg_temp.try('update public.candidate_contacts set key_version = 2'), '^42501', 'U recruiter: no UPDATE grant');
select matches(pg_temp.try('delete from public.candidate_contacts'), '^42501', 'D recruiter: no DELETE grant');
select pg_temp.op();
select matches(pg_temp.try('update public.candidate_contacts set key_version = 2'), '^42501 TRACE_GUARD: candidate contacts are insert-once', 'U operator: the insert-once trigger refuses even the owner');

-- ===== Other roles =====
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.candidate_contacts'), '^42501 permission denied', 'S api: trace_api holds no grant (R5-47: the recipient comes through private.invitation_recipient_ct)');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.candidate_contacts'), '^42501 permission denied', 'S trace_worker: denied');
select pg_temp.op();
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.candidate_contacts'::regclass), true, 'RLS: enabled on candidate_contacts');
