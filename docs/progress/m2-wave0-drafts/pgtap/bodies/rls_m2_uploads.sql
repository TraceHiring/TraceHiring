-- rls_m2_uploads (spec specs/m2-scheduling-invites.md revision 5 §10 row rls_m2_uploads; §3.2 invite_uploads, invite_upload_errors; §3.3 ingest_invite_batch; §6.2; E1-E7, E20; M2-5, M2-6, R2-5, R2-12, R3-4, R5-15, R5-20, R5-49, R5-52 d; AT-M2-03, AT-M2-04, AT-M2-16). RED first: written from the spec before migration M2-b. Rows are synthetic and pre-encrypted (the api's job); no cell value is ever stored.
-- Fixtures: ta = a 10x version (A1); drive ds (scheduled mode) with s1 (+48 h, capacity 2) and s2 (+72 h, capacity 5);
-- drive dd (draft); drive dw (open window, workspace A2 test).
select pg_temp.pooltv('ta', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.drive('ds', 'ta', 'scheduled');
select pg_temp.slot('s1', 'ds', 48, 2);
select pg_temp.slot('s2', 'ds', 72, 5);
update public.drives set status = 'scheduled' where id = pg_temp.id('ds');
select pg_temp.drive('dd', 'ta', 'open_window');
-- r(rowNo, person key, phone key, slot key, api reason, confirm): one pre-encrypted row as the api sends it.
create function pg_temp.r(p_no int, p_key text, p_phone text default null, p_slot text default null, p_reason text default null,
  p_confirm boolean default false) returns jsonb language sql stable as $f$
  select case when p_reason is not null then jsonb_build_object('rowNo', p_no, 'reason', p_reason)
  else jsonb_build_object('rowNo', p_no, 'fullNameCt', pg_temp.ct('n-' || p_key), 'fingerprint', pg_temp.h('e-' || p_key),
    'keyVersion', 1, 'emailCt', pg_temp.ct('e-' || p_key), 'emailBidx', pg_temp.h('e-' || p_key),
    'emailHint', 'c•••@example.test',
    'phoneCt', case when p_phone is not null then pg_temp.ct('p-' || p_phone) end,
    'phoneBidx', case when p_phone is not null then pg_temp.h('p-' || p_phone) end,
    'phoneHint', case when p_phone is not null then '••••1234' end,
    'adult', true, 'slotStartsAt', (select to_jsonb(s.starts_at) from public.slots as s where s.id = pg_temp.id(p_slot)),
    'language', 'en', 'linkTokenHash', pg_temp.h('l-' || p_key || '-' || p_no), 'confirmPhoneDuplicate', p_confirm) end
$f$;
grant execute on function pg_temp.r(int, text, text, text, text, boolean) to public;
create function pg_temp.ingest(p_upload text, p_rows jsonb) returns text language plpgsql as $f$
declare v jsonb;
begin
  v := public.ingest_invite_batch(pg_temp.id(p_upload), p_rows);
  return (select string_agg(e ->> 'rowNo' || ':' || coalesce(case when e ? 'invitationId' then 'invited' end, e ->> 'reason')
    || case when (e ->> 'held')::boolean then '(held)' else '' end, ',' order by (e ->> 'rowNo')::int)
    from jsonb_array_elements(v) as e);
exception when others then
  return sqlstate || ' ' || sqlerrm;
end
$f$;
grant execute on function pg_temp.ingest(text, jsonb) to public;

-- ===== Uploads =====
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$insert into public.invite_uploads (org_id, drive_id, file_sha256, rows_total) values (%L, %L, %L, 9)$$, pg_temp.id('A'), pg_temp.id('ds'), repeat('a', 64))), 'OK 1', 'I recruiter: an upload for a scheduled drive');
select pg_temp.op();
insert into pg_temp.ids select 'u1', id from public.invite_uploads where drive_id = pg_temp.id('ds');
select is((select workspace_id::text || '|' || source_kind || '|' || status || '|' || rows_invited || rows_refused || rows_held || '|' || created_by from public.invite_uploads where id = pg_temp.id('u1')), pg_temp.id('A1')::text || '|csv|open|000|' || pg_temp.id('recruiter'), 'I: workspace copied, CSV only (R5-20), open, counters 0, created_by the caller');
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$insert into public.invite_uploads (org_id, drive_id, source_kind, file_sha256, rows_total) values (%L, %L, 'xlsx', %L, 9)$$, pg_temp.id('A'), pg_temp.id('ds'), repeat('a', 64))), '^23514', 'R5-20: an xlsx upload is refused');
select matches(pg_temp.try(format($$insert into public.invite_uploads (org_id, drive_id, file_sha256, rows_total) values (%L, %L, %L, 5001)$$, pg_temp.id('A'), pg_temp.id('ds'), repeat('a', 64))), '^23514', '§6.2: at most 5,000 rows per file');
select matches(pg_temp.try(format($$insert into public.invite_uploads (org_id, drive_id, file_sha256, rows_total) values (%L, %L, %L, 9)$$, pg_temp.id('A'), pg_temp.id('dd'), repeat('a', 64))), '^42501 TRACE_GUARD: invitations need a scheduled drive', 'I: a draft drive takes no upload');
select matches(pg_temp.try(format($$update public.invite_uploads set rows_invited = 99 where id = %L$$, pg_temp.id('u1'))), '^42501 permission denied', 'U: the counters are outside every grant');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try(format($$insert into public.invite_uploads (org_id, drive_id, file_sha256, rows_total) values (%L, %L, %L, 9)$$, pg_temp.id('A'), pg_temp.id('ds'), repeat('a', 64))), '^42501 TRACE_GUARD: drive not found', 'I ws_recruiter: a drive outside its workspace is not found');
select is((select count(*)::int from public.invite_uploads), 0, 'S ws_recruiter: the A1 upload is invisible');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.invite_uploads), 0, 'S reviewer: nothing (R2-11)');

-- ===== ingest_invite_batch (INVOKER; E1-E7, E20; AT-M2-03, AT-M2-04, AT-M2-16) =====
select is((select prosecdef::text || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || '|' || has_function_privilege('anon', p.oid, 'EXECUTE')::text from pg_catalog.pg_proc as p where p.oid = 'public.ingest_invite_batch(uuid, jsonb)'::regprocedure), 'false|true|false', '§9: ingest_invite_batch is INVOKER, EXECUTE authenticated only');
select pg_temp.u('recruiter');
select is(pg_temp.ingest('u1', jsonb_build_array(pg_temp.r(1, 'p1', 'ph1'), pg_temp.r(2, 'x', null, null, 'invalid_email'), pg_temp.r(3, 'p1', null, 's2'), pg_temp.r(4, 'p4', 'ph1'), pg_temp.r(5, 'p5', null, 's1'), pg_temp.r(6, 'p6', null, 's1'), pg_temp.r(7, 'x', null, null, 'minor'))), '1:invited,2:invalid_email,3:already_invited,4:phone_shared(held),5:invited,6:slot_full,7:minor', 'AT-M2-03/04/16: per-row outcomes: invited, api reasons recorded, email duplicate, held phone, named slot full, minor');
select is(pg_temp.ingest('u1', jsonb_build_array(pg_temp.r(1, 'p1', 'ph1'), pg_temp.r(2, 'x', null, null, 'invalid_email'), pg_temp.r(5, 'p5', null, 's1'))), '1:invited,2:invalid_email,5:invited', 'R3-4: replaying final rows returns the stored outcome, nothing twice');
select is((select count(*)::int from public.invitations where drive_id = pg_temp.id('ds')), 2, 'R3-4: still two invitations');
select is(pg_temp.ingest('u1', jsonb_build_array(pg_temp.r(4, 'p4', 'ph1', null, null, true))), '4:invited', 'R2-12, R3-4: the held row re-sent with confirmPhoneDuplicate is invited and replaces the held row');
select is(pg_temp.ingest('u1', jsonb_build_array(pg_temp.r(8, 'p8'))), '8:invited', 'R5-52 d: a row without a slot is auto-assigned');
select pg_temp.op();
select is((select (select s.starts_at from public.slots as s where s.id = i.slot_id) = (select s2.starts_at from public.slots as s2 where s2.id = pg_temp.id('s2')) from public.invitations as i where i.link_token_hash = pg_temp.h('l-p8-8')), true, 'R5-52 d: auto-assign took the earliest slot with space (s1 is full)');
select is((select string_agg(row_no || ':' || reason || ':' || held::text, ',' order by row_no) from public.invite_upload_errors where upload_id = pg_temp.id('u1')), '2:invalid_email:false,3:already_invited:false,6:slot_full:false,7:minor:false', 'errors: one row per refused line, the held row is gone');
select is((select rows_invited || '|' || rows_refused || '|' || rows_held from public.invite_uploads where id = pg_temp.id('u1')), '4|4|0', 'counters: invited, rejected, held follow the rows');
select is((select array_agg(a.attname::text order by a.attnum) from pg_catalog.pg_attribute as a where a.attrelid = 'public.invite_upload_errors'::regclass and a.attnum > 0 and not a.attisdropped), array['org_id', 'workspace_id', 'upload_id', 'row_no', 'reason', 'held', 'created_at'], 'Q30: no cell value column on the error rows');
select is((select count(*)::int from public.candidates where contact_fingerprint = pg_temp.h('e-x')), 0, 'AT-M2-16, E20: nothing about a minor or an invalid row is stored');
select is((select count(*)::int from public.candidates where org_id = pg_temp.id('A')), 4, 'R5-15: one candidate per person; the duplicate email reused it');
select is((select bool_and(shared_contact_confirmed_by is not distinct from case when link_token_hash = pg_temp.h('l-p4-4') then pg_temp.id('recruiter') end) from public.invitations where drive_id = pg_temp.id('ds')), true, 'R2-12: only the confirmed row names the confirming recruiter');
select pg_temp.u('recruiter');
select matches(pg_temp.ingest('u1', (select jsonb_agg(pg_temp.r(n, 'bulk' || n)) from generate_series(10, 210) as n)), '^22023 TRACE_GUARD: at most 200 rows per batch', '§6.2: batches of at most 200 rows');
select matches(pg_temp.ingest('u1', jsonb_build_array(jsonb_build_object('rowNo', 9, 'reason', 'not_a_reason'))), '^(22023|23514)', 'errors: an unknown reason is refused');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.ingest('u1', jsonb_build_array(pg_temp.r(9, 'p9'))), '^42501 TRACE_GUARD: upload not found', 'ingest ws_recruiter: another workspace''s upload is not found');
select pg_temp.u('reviewer');
select matches(pg_temp.ingest('u1', jsonb_build_array(pg_temp.r(9, 'p9'))), '^42501', 'ingest reviewer: refused');
select pg_temp.u('b_admin');
select matches(pg_temp.ingest('u1', jsonb_build_array(pg_temp.r(9, 'p9'))), '^42501', 'ingest org B: refused');

-- ===== Close an upload =====
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.invite_uploads set status = 'completed' where id = %L$$, pg_temp.id('u1'))), 'OK 1', 'U recruiter: open -> completed');
select is((select completed_at is not null from public.invite_uploads where id = pg_temp.id('u1')), true, 'U: completed_at is set');
select matches(pg_temp.ingest('u1', jsonb_build_array(pg_temp.r(9, 'p9'))), '^42501 TRACE_GUARD: the upload is not open', 'ingest: a completed upload takes no rows');
select matches(pg_temp.try(format($$update public.invite_uploads set status = 'open' where id = %L$$, pg_temp.id('u1'))), '^42501 TRACE_GUARD: an upload moves from open only', 'U: completed is terminal');
select is((select count(*)::int from public.invitations where drive_id = pg_temp.id('ds')), 4, '§6.2: closing an upload keeps what was invited');
select matches(pg_temp.try(format($$delete from public.invite_uploads where id = %L$$, pg_temp.id('u1'))), '^42501', 'D: uploads are never deleted');

-- ===== Other roles =====
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.invite_uploads'), '^42501 permission denied', 'S api: no grant');
select matches(pg_temp.try('select * from public.invite_upload_errors'), '^42501 permission denied', 'S api: no grant on errors');
select pg_temp.op();
select is((select bool_and(relrowsecurity) from pg_catalog.pg_class where oid in ('public.invite_uploads'::regclass, 'public.invite_upload_errors'::regclass)), true, 'RLS: enabled on both upload tables');
