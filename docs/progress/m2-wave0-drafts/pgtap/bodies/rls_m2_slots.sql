-- rls_m2_slots (spec specs/m2-scheduling-invites.md revision 5 §10 row rls_m2_slots; §3.2 slots; §3.4 row slots; §4 Slot; I-M2-3; R2-15, R2-16, R5-4, R5-43, R5-51; AT-M2-08). RED first: written from the spec before migration M2-b. Synthetic data. The two-connection race on the last seat runs in scripts/test-concurrency-local.mjs.
-- Fixtures: ta = a 10x version (A1); ds = a scheduled-mode drive; dw = an open-window drive; dz = a drive of org B.
select pg_temp.pooltv('ta', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.pooltv('tb', pg_temp.id('B'), pg_temp.id('BW'));
select pg_temp.drive('ds', 'ta', 'scheduled');
select pg_temp.drive('dw', 'ta', 'open_window', 'scheduled');
select pg_temp.drive('dz', 'tb', 'scheduled');
insert into public.assignments (org_id, membership_id, scope, test_id, as_role)
  select m.org_id, m.id, 'test', pg_temp.id('ta_test'), 'reviewer'
  from public.memberships as m where m.org_id = pg_temp.id('A') and m.user_id = pg_temp.id('reviewer');
select pg_temp.cand('c' || n, pg_temp.id('A'), pg_temp.id('A1')) from generate_series(1, 4) as n;
create function pg_temp.ins(p_drive text, p_hours int, p_capacity int) returns text language sql as $f$
  select pg_temp.try(format($s$insert into public.slots (org_id, drive_id, starts_at, capacity) values (%L, %L, now() + make_interval(hours => %s), %s)$s$,
    (select org_id from public.drives where id = pg_temp.id(p_drive)), pg_temp.id(p_drive), p_hours, p_capacity))
$f$;
grant execute on function pg_temp.ins(text, int, int) to public;

-- ===== I and shape =====
select pg_temp.u('recruiter');
select is(pg_temp.ins('ds', 24, 2), 'OK 1', 'I recruiter: a slot of a scheduled-mode drive');
select is((select workspace_id::text || '|' || test_id::text || '|' || booked || '|' || start_window_minutes || '|' || lobby_opens_minutes || '|' || status from public.slots where drive_id = pg_temp.id('ds')), pg_temp.id('A1')::text || '|' || pg_temp.id('ta_test')::text || '|0|15|30|open', 'I: workspace and test copied from the drive; booked 0; window 15 min; lobby 30 min; open');
select matches(pg_temp.try(format($$insert into public.slots (org_id, drive_id, starts_at, capacity, booked) values (%L, %L, now() + interval '2 days', 5, 3)$$, pg_temp.id('A'), pg_temp.id('ds'))), '^42501 permission denied', 'I: booked is outside every grant');
select matches(pg_temp.ins('ds', 24, 3), '^23505', 'I: one slot per drive and start time');
select matches(pg_temp.ins('ds', 24 * 40, 3), '^42501 TRACE_GUARD: a slot starts inside the drive window', 'I: a slot after the drive deadline is refused');
select matches(pg_temp.ins('dw', 30, 3), '^42501 TRACE_GUARD: slots belong to scheduled-mode drives', 'I: an open-window drive has no slots');
select matches(pg_temp.ins('ds', 25, 0), '^23514', 'shape: capacity at least 1');
select matches(pg_temp.ins('ds', 25, 20001), '^23514', 'shape: capacity at most 20,000');
select matches(pg_temp.try(format($$insert into public.slots (org_id, drive_id, starts_at, capacity, start_window_minutes) values (%L, %L, now() + interval '26 hours', 5, 4)$$, pg_temp.id('A'), pg_temp.id('ds'))), '^23514', 'shape: start window 5..30 minutes');
select matches(pg_temp.try(format($$insert into public.slots (org_id, drive_id, starts_at, capacity, lobby_opens_minutes) values (%L, %L, now() + interval '26 hours', 5, 61)$$, pg_temp.id('A'), pg_temp.id('ds'))), '^23514', 'shape: lobby 15..60 minutes early');
select is(pg_temp.ins('ds', 48, 5), 'OK 1', 'I recruiter: a second slot');
select pg_temp.op();
insert into pg_temp.ids select 's1', id from public.slots where drive_id = pg_temp.id('ds') and capacity = 2;
insert into pg_temp.ids select 's2', id from public.slots where drive_id = pg_temp.id('ds') and capacity = 5;
select pg_temp.u('ws_recruiter');
select matches(pg_temp.ins('ds', 72, 5), '^42501 TRACE_GUARD: drive not found', 'I ws_recruiter: a drive outside its workspace is not found');
select pg_temp.u('b_admin');
select matches(pg_temp.try(format($$insert into public.slots (org_id, drive_id, starts_at, capacity) values (%L, %L, now() + interval '3 days', 5)$$, pg_temp.id('B'), pg_temp.id('ds'))), '^(42501|23503)', 'I org B: another org''s drive is refused');
select pg_temp.u('reviewer');
select matches(pg_temp.ins('ds', 72, 5), '^42501', 'I reviewer: refused');

-- ===== S =====
select pg_temp.u('owner');
select is((select count(*)::int from public.slots), 2, 'S owner: both slots');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.slots), 2, 'S reviewer: the slots of its assigned test');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.slots), 0, 'S ws_recruiter: none (fence)');
select pg_temp.u('hm');
select is((select count(*)::int from public.slots), 0, 'S hiring manager: none');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.slots), 0, 'S org B: none of org A');

-- ===== Booking (I-M2-3, AT-M2-08, R2-15, R2-16) =====
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.drives set status = 'scheduled' where id = %L$$, pg_temp.id('ds'))), 'OK 1', 'fixture: the drive is scheduled');
select pg_temp.dinv('i1', 'ds', 's1', 'c1');
select pg_temp.dinv('i2', 'ds', 's1', 'c2');
select is((select booked from public.slots where id = pg_temp.id('s1')), 2, 'booking: two invitations book two seats');
select matches(pg_temp.try($$select pg_temp.dinv('i3', 'ds', 's1', 'c3')$$), '^42501 TRACE_GUARD: slot full', 'booking: the last seat is taken, a third invitation is refused (no overbooking)');
select is((select booked from public.slots where id = pg_temp.id('s1')), 2, 'booking: a refused invitation books nothing');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.invitations set status = 'revoked' where id = %L$$, pg_temp.id('i2'))), 'OK 1', 'booking: a revoke');
select is((select booked from public.slots where id = pg_temp.id('s1')), 1, 'booking (R2-16): a revoke returns the seat');
select is(pg_temp.try($$select pg_temp.dinv('i3', 'ds', 's1', 'c3')$$), 'OK 1', 'booking: the returned seat can be booked');
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$update public.slots set booked = 0 where id = %L$$, pg_temp.id('s1'))), '^42501 permission denied', 'U: booked is moved only by the booking trigger');
select matches(pg_temp.try(format($$update public.slots set capacity = 1 where id = %L$$, pg_temp.id('s1'))), '^23514', 'U: capacity cannot drop below booked');
select is(pg_temp.try(format($$update public.slots set capacity = 3 where id = %L$$, pg_temp.id('s1'))), 'OK 1', 'U: capacity may grow');
-- R5-43: no booking outside the drive.
select pg_temp.op();
select matches(pg_temp.try(format($$insert into public.invitations (org_id, test_id, test_version_id, slot_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values (%L, %L, %L, %L, 'm2-d1@example.test', %L, true, now() + interval '1 day')$$, pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'), pg_temp.id('s2'), pg_temp.h('l-d1'))), '^23514', 'R5-43: a D1-shaped row (no drive) cannot name a slot');
select is((select booked from public.slots where id = pg_temp.id('s2')), 0, 'R5-43: and books nothing');

-- ===== Cancel and delete (§4 Slot) =====
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$update public.slots set status = 'cancelled' where id = %L$$, pg_temp.id('s1'))), '^42501 TRACE_GUARD: move the slot''s invitations first', '§4: a booked slot cannot be cancelled');
select matches(pg_temp.try(format($$delete from public.slots where id = %L$$, pg_temp.id('s1'))), '^42501 TRACE_GUARD: move the slot''s invitations first', '§4: nor deleted');
select is(pg_temp.try(format($$update public.slots set status = 'closed' where id = %L$$, pg_temp.id('s1'))), 'OK 1', '§4: open -> closed');
select matches(pg_temp.try($$select pg_temp.dinv('i4', 'ds', 's1', 'c4')$$), '^42501 TRACE_GUARD: slot not open', 'booking: a closed slot takes no new invitation');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.slots set status = 'cancelled' where id = %L$$, pg_temp.id('s2'))), 'OK 1', '§4: an unbooked slot is cancelled');
select matches(pg_temp.try(format($$update public.slots set status = 'open' where id = %L$$, pg_temp.id('s2'))), '^42501 TRACE_GUARD: a cancelled slot cannot change', '§4: cancelled is terminal');
select is(pg_temp.try(format($$delete from public.slots where id = %L$$, pg_temp.id('s2'))), 'OK 1', 'D recruiter: an unbooked slot is deleted');
select pg_temp.u('reviewer');
select is(pg_temp.try('delete from public.slots'), 'OK 0', 'D reviewer: nothing');
select is(pg_temp.try('update public.slots set capacity = 9'), 'OK 0', 'U reviewer: nothing');

-- ===== Other roles =====
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.slots'), '^42501 permission denied', 'S api: no grant (portal slots come through private.portal_slots)');
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.slots'), '^42501 permission denied', 'S messaging worker: no grant');
select pg_temp.op();
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.slots'::regclass), true, 'RLS: enabled on slots');
