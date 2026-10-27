-- rls_m2_drives (spec specs/m2-scheduling-invites.md revision 5 §10 row rls_m2_drives; §3.2 drives; §3.4 row drives; §4 Drive; M2-8, M2-17, M2-18, R2-13, R5-4, R5-10, R5-46, R5-51; AT-M2-06, AT-M2-14, AT-M2-17). RED first: written from the spec before migration M2-b. Synthetic data.
-- Fixtures: ta = a published 10x pool version (workspace A1); t9 = 9x; tin = a D1-style inline version; tdr = a draft;
-- ta2 = a newer published version of ta's test; tb = org B; tw = a 10x version in workspace A2.
select pg_temp.pooltv('ta', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.pooltv('t9', pg_temp.id('A'), pg_temp.id('A1'), 9);
select pg_temp.pooltv('tw', pg_temp.id('A'), pg_temp.id('A2'));
select pg_temp.pooltv('tb', pg_temp.id('B'), pg_temp.id('BW'));
select pg_temp.tv('tin', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('tin_s', 'tin', 1, 'mcq', null, null, 100);
select pg_temp.inline('tin_i', 'tin_s');
select pg_temp.preset('tin', 'standard');
select pg_temp.publish('tin');
select pg_temp.tv('tdr', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.test_versions (org_id, test_id, total_time_seconds, quality_cutoff)
  values (pg_temp.id('A'), pg_temp.id('ta_test'), 1800, 40);
insert into pg_temp.ids select 'ta2', id from public.test_versions where test_id = pg_temp.id('ta_test') and version_no = 2;
select pg_temp.sec('ta2_s', 'ta2', 1, 'mcq', pg_temp.id('ta_pool'), 1, 100);
select pg_temp.preset('ta2', 'standard');
select pg_temp.publish('ta2');
-- The reviewer persona is assigned to ta's test.
insert into public.assignments (org_id, membership_id, scope, test_id, as_role)
  select m.org_id, m.id, 'test', pg_temp.id('ta_test'), 'reviewer'
  from public.memberships as m where m.org_id = pg_temp.id('A') and m.user_id = pg_temp.id('reviewer');
-- ins(version key, mode, status): the INSERT a recruiter sends into org A (no workspace: the guard copies it from the
-- test). Values, not a SELECT, so a caller who cannot read the version still reaches the guard.
create function pg_temp.ins(p_tv text, p_mode text, p_status text) returns text language sql as $f$
  select pg_temp.try(format($s$insert into public.drives (org_id, test_id, default_test_version_id, name, mode, status, opens_at, deadline_at) values (%L, %L, %L, 'Drive', %L, %L, now(), now() + interval '10 days')$s$,
    pg_temp.id('A'), pg_temp.id(p_tv || '_test'), pg_temp.id(p_tv), p_mode, p_status))
$f$;
grant execute on function pg_temp.ins(text, text, text) to public;

-- ===== Shape (M2-8, AT-M2-06) =====
select pg_temp.u('recruiter');
select is(pg_temp.ins('ta', 'scheduled', 'draft'), 'OK 1', 'I recruiter: a draft scheduled-mode drive on a 10x version');
select is((select workspace_id from public.drives where default_test_version_id = pg_temp.id('ta')), pg_temp.id('A1'), 'I: the guard copies the workspace from the test');
select is((select created_by from public.drives where default_test_version_id = pg_temp.id('ta')), pg_temp.id('recruiter'), 'I: created_by is the caller');
select is((select array_to_string(reminder_offsets, ',') || '|' || timezone || '|' || self_reschedule_allowed::text || '|' || lab_mode::text from public.drives where default_test_version_id = pg_temp.id('ta')), '24:00:00,01:00:00|Asia/Kolkata|true|false', 'defaults: reminders 24 h and 1 h, IST, self-reschedule on, lab mode off');
select matches(pg_temp.try(format($$insert into public.drives (org_id, test_id, default_test_version_id, name, mode, opens_at, deadline_at) values (%L, %L, %L, 'D', 'open_window', now(), now() - interval '1 hour')$$, pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'))), '^23514', 'shape: the deadline is after the opening');
select matches(pg_temp.try(format($$insert into public.drives (org_id, test_id, default_test_version_id, name, mode, opens_at, deadline_at, timezone) values (%L, %L, %L, 'D', 'open_window', now(), now() + interval '1 day', 'UTC')$$, pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'))), '^23514', 'shape: the display time zone is IST only');
select matches(pg_temp.try(format($$insert into public.drives (org_id, test_id, default_test_version_id, name, mode, opens_at, deadline_at, reminder_offsets) values (%L, %L, %L, 'D', 'open_window', now(), now() + interval '1 day', '{1 hour,2 hours,3 hours,4 hours,5 hours}')$$, pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'))), '^23514', 'AT-M2-06: at most 4 reminder offsets');
select matches(pg_temp.try(format($$insert into public.drives (org_id, test_id, default_test_version_id, name, mode, opens_at, deadline_at, reminder_offsets) values (%L, %L, %L, 'D', 'open_window', now(), now() + interval '1 day', '{10 minutes}')$$, pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'))), '^23514', 'AT-M2-06: an offset under 15 minutes is refused');
select matches(pg_temp.try(format($$insert into public.drives (org_id, test_id, default_test_version_id, name, mode, opens_at, deadline_at, reminder_offsets) values (%L, %L, %L, 'D', 'open_window', now(), now() + interval '1 day', '{8 days}')$$, pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'))), '^23514', 'AT-M2-06: an offset over 7 days is refused');
select matches(pg_temp.try(format($$insert into public.drives (org_id, test_id, default_test_version_id, name, mode, opens_at, deadline_at, reminder_offsets) values (%L, %L, %L, 'D', 'open_window', now(), now() + interval '1 day', '{1 day,24 hours}')$$, pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'))), '^23514', 'AT-M2-06: offsets are distinct');
select is(pg_temp.try(format($$insert into public.drives (org_id, test_id, default_test_version_id, name, mode, opens_at, deadline_at, reminder_offsets) values (%L, %L, %L, 'D0', 'open_window', now(), now() + interval '1 day', '{}')$$, pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'))), 'OK 1', 'AT-M2-06: zero reminders is allowed');
select matches(pg_temp.try(format($$insert into public.drives (org_id, test_id, default_test_version_id, name, mode, opens_at, deadline_at, expected_candidates) values (%L, %L, %L, 'D', 'open_window', now(), now() + interval '1 day', 100001)$$, pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'))), '^23514', 'shape: expected candidates at most 100,000');

-- ===== Version rules (M2-17, M2-18, R5-10, AT-M2-14, AT-M2-17) =====
select matches(pg_temp.ins('t9', 'scheduled', 'draft'), '^42501 TRACE_GUARD: pool must be at least 10x the draw for drives', 'AT-M2-14: a scheduled-mode drive on a 9x version is refused');
select matches(pg_temp.ins('tin', 'scheduled', 'draft'), '^42501 TRACE_GUARD: pool must be at least 10x the draw for drives', 'AT-M2-14: an inline-only (D1-style) version is refused for a scheduled-mode drive');
select matches(pg_temp.ins('tdr', 'scheduled', 'draft'), '^23503 TRACE_GUARD: published test version not found', 'AT-M2-14: a draft default version is refused');
select matches(pg_temp.ins('tdr', 'open_window', 'draft'), '^23503 TRACE_GUARD: published test version not found', 'AT-M2-17: an open-window drive needs a published version too');
select is(pg_temp.ins('t9', 'open_window', 'draft'), 'OK 1', 'AT-M2-14: an open-window drive on a 9x version is allowed (warning only)');
select is((select min_pool_ratio::text from public.test_versions where id = pg_temp.id('t9')), '9.00', 'AT-M2-14: the warning reads min_pool_ratio, which staff can select');
select matches(pg_temp.try(format($$insert into public.drives (org_id, test_id, default_test_version_id, name, mode, opens_at, deadline_at) values (%L, %L, %L, 'D', 'open_window', now(), now() + interval '1 day')$$, pg_temp.id('A'), pg_temp.id('tin_test'), pg_temp.id('ta'))), '^42501 TRACE_GUARD: drive not found', 'R5-46: a version of another test is refused with the one not-found error');
select pg_temp.op();
select is((select prosecdef::text || '|' || (select rolname from pg_catalog.pg_roles where oid = proowner) from pg_catalog.pg_proc where oid = 'private.drives_guard()'::regprocedure), 'true|postgres', 'R5-10: the drives guard is SECURITY DEFINER owned by postgres');
select is((select count(*)::int from unnest(array['authenticated', 'trace_api', 'trace_messaging_worker', 'trace_worker']) as r where has_function_privilege(r, 'private.assert_drive_pool_ratio(uuid, uuid)', 'EXECUTE')), 0, 'R5-10: no grant on assert_drive_pool_ratio is added');

-- ===== Fence and oracle (R5-46) =====
select pg_temp.u('ws_recruiter');
select matches(pg_temp.ins('ta', 'open_window', 'draft'), '^42501 TRACE_GUARD: drive not found', 'I ws_recruiter: a test outside its workspace is not found');
select is(pg_temp.ins('tw', 'open_window', 'draft'), 'OK 1', 'I ws_recruiter: a drive in its own workspace');
select pg_temp.u('b_admin');
select matches(pg_temp.ins('ta', 'scheduled', 'draft'), '^42501 TRACE_GUARD: drive not found', 'R5-46: org B gets the same not-found error for org A''s 10x version');
select matches(pg_temp.ins('t9', 'scheduled', 'draft'), '^42501 TRACE_GUARD: drive not found', 'R5-46: org B learns nothing about org A''s pool ratio (no 42501 pool oracle)');
select matches(pg_temp.ins('tdr', 'scheduled', 'draft'), '^42501 TRACE_GUARD: drive not found', 'R5-46: org B learns nothing about a draft version (no 23503 oracle)');
select pg_temp.u('reviewer');
select matches(pg_temp.ins('ta', 'open_window', 'draft'), '^42501', 'I reviewer: refused');
select pg_temp.u('hm');
select matches(pg_temp.ins('ta', 'open_window', 'draft'), '^42501', 'I hiring manager: refused');

-- ===== S =====
select pg_temp.u('owner');
select is((select count(*)::int from public.drives), 4, 'S owner: all four org A drives');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.drives), 1, 'S ws_recruiter: only the A2 drive');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.drives), 2, 'S reviewer: the drives of its assigned test only');
select pg_temp.u('hm');
select is((select count(*)::int from public.drives), 0, 'S hiring manager: nothing');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.drives), 0, 'S org B admin: nothing of org A');

-- ===== Status machine (§4) =====
select pg_temp.op();
insert into pg_temp.ids select 'dsch', id from public.drives where default_test_version_id = pg_temp.id('ta') and name = 'Drive';
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$update public.drives set status = 'scheduled' where id = %L$$, pg_temp.id('dsch'))), '^42501 TRACE_GUARD: a scheduled drive needs a slot', '§4: a scheduled-mode drive cannot be scheduled without a slot');
select matches(pg_temp.ins('ta', 'scheduled', 'scheduled'), '^42501 TRACE_GUARD: a scheduled drive needs a slot', '§4: nor inserted as scheduled');
select pg_temp.slot('s1', 'dsch', 48, 10);
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.drives set status = 'scheduled' where id = %L$$, pg_temp.id('dsch'))), 'OK 1', '§4: draft -> scheduled with a slot and a 10x version');
select matches(pg_temp.try(format($$update public.drives set status = 'draft' where id = %L$$, pg_temp.id('dsch'))), '^42501 TRACE_GUARD: drive status moves forward only', '§4: scheduled -> draft is refused');
select matches(pg_temp.try(format($$update public.drives set mode = 'open_window' where id = %L$$, pg_temp.id('dsch'))), '^42501 permission denied', 'U: mode is outside the update grant');
select pg_temp.op();
select matches(pg_temp.try(format($$update public.drives set mode = 'open_window' where id = %L$$, pg_temp.id('dsch'))), '^42501 TRACE_GUARD: drive test, workspace and mode are immutable', 'U: the guard keeps the mode immutable even for the owner');
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$update public.drives set deadline_at = deadline_at - interval '1 day' where id = %L$$, pg_temp.id('dsch'))), '^42501 TRACE_GUARD: a drive deadline can only be extended', 'R3-10: a scheduled drive''s deadline is never shortened');
select is(pg_temp.try(format($$update public.drives set deadline_at = deadline_at + interval '1 day' where id = %L$$, pg_temp.id('dsch'))), 'OK 1', 'R3-10: the deadline may be extended');
select is(pg_temp.try(format($$update public.drives set reminder_offsets = '{2 hours}' where id = %L$$, pg_temp.id('dsch'))), 'OK 1', 'AT-M2-06: the reminder offsets are configurable per drive');
-- Default version (M2-18, AT-M2-17): forward only, to a published version of the same test.
select is(pg_temp.try(format($$update public.drives set default_test_version_id = %L where id = %L$$, pg_temp.id('ta2'), pg_temp.id('dsch'))), 'OK 1', 'AT-M2-17: the default version moves forward to a newer published version');
select matches(pg_temp.try(format($$update public.drives set default_test_version_id = %L where id = %L$$, pg_temp.id('ta'), pg_temp.id('dsch'))), '^42501 TRACE_GUARD: the default version moves forward only', 'AT-M2-17: never backwards');
select matches(pg_temp.try(format($$update public.drives set default_test_version_id = %L where id = %L$$, pg_temp.id('tw'), pg_temp.id('dsch'))), '^42501 TRACE_GUARD: drive not found', 'AT-M2-17: never to another test''s version');
-- Terminal states.
select is(pg_temp.try(format($$update public.drives set status = 'cancelled' where id = %L$$, pg_temp.id('dsch'))), 'OK 1', '§4: scheduled -> cancelled');
select matches(pg_temp.try(format($$update public.drives set name = 'Renamed' where id = %L$$, pg_temp.id('dsch'))), '^42501 TRACE_GUARD: a closed or cancelled drive cannot change', '§4: a cancelled drive is terminal');
select pg_temp.u('ws_recruiter');
select is(pg_temp.try(format($$update public.drives set name = 'Mine' where workspace_id = %L$$, pg_temp.id('A2'))), 'OK 1', 'U ws_recruiter: its own drive');
select is(pg_temp.try(format($$update public.drives set name = 'Theirs' where workspace_id = %L$$, pg_temp.id('A1'))), 'OK 0', 'U ws_recruiter: another workspace''s drive is invisible to the update');
select pg_temp.u('reviewer');
select is(pg_temp.try('update public.drives set name = ''Reviewer'''), 'OK 0', 'U reviewer: no staff arm, nothing updated');

-- ===== D: draft drives only =====
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$delete from public.drives where id = %L$$, pg_temp.id('dsch'))), 'OK 0', 'D recruiter: a cancelled (non-draft) drive is not deleted');
select is(pg_temp.try($$delete from public.drives where name = 'D0'$$), 'OK 1', 'D recruiter: a draft drive is deleted');
select pg_temp.u('reviewer');
select is(pg_temp.try('delete from public.drives'), 'OK 0', 'D reviewer: nothing');

-- ===== Audit and other roles =====
select pg_temp.op();
select is((select string_agg(action, ',' order by action) from public.audit_log where object_table = 'drives' and object_id = pg_temp.id('dsch')), 'drive.cancel,drive.create,drive.schedule,drive.update,drive.update,drive.update', 'audit: create, schedule, three updates and cancel, each with the drive id only');
select is((select count(*)::int from public.audit_log where object_table = 'drives' and details ? 'name'), 0, 'audit: details never carry free text');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.drives'), '^42501 permission denied', 'S api: trace_api reads drives only through private functions');
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.drives'), '^42501 permission denied', 'S messaging worker: no grant (close_due_drives is DEFINER, R5-6)');
select pg_temp.op();
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.drives'::regclass), true, 'RLS: enabled on drives');
