-- rls_m2_reschedule (spec specs/m2-scheduling-invites.md revision 5 §10 row rls_m2_reschedule; §3.2 reschedule_events; §3.3 reschedule_invitation, self_reschedule; §4; §6.6; I-M2-4, I-M2-7; M2-11, R2-8, R2-15, R3-12, R4-2, R5-24; E9-E11, E25; AT-M2-07, AT-M2-21). RED first: written from the spec before migration M2-b. Synthetic data; times are relative to now() (R2-8).
-- Fixtures: ta = a 10x version; drive ds with slots s1 (+48 h), s2 (+72 h, capacity 2), s3 (+1 h), s4 (moved 2 h into the
-- past on the operator path, so its window was missed) and sx (full, capacity 1); drive do (self-reschedule off) with t1;
-- drive dz (another drive) with z1.
select pg_temp.pooltv('ta', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.drive('ds', 'ta', 'scheduled');
select pg_temp.slot('s1', 'ds', 48, 5);
select pg_temp.slot('s2', 'ds', 72, 2);
select pg_temp.slot('s3', 'ds', 1, 5);
select pg_temp.slot('s4', 'ds', 6, 5);
select pg_temp.slot('sx', 'ds', 96, 1);
update public.drives set status = 'scheduled' where id = pg_temp.id('ds');
select pg_temp.drive('do', 'ta', 'scheduled');
select pg_temp.slot('t1', 'do', 48, 5);
select pg_temp.slot('t2', 'do', 72, 5);
update public.drives set status = 'scheduled', self_reschedule_allowed = false where id = pg_temp.id('do');
select pg_temp.drive('dz', 'ta', 'scheduled');
select pg_temp.slot('z1', 'dz', 48, 5);
update public.drives set status = 'scheduled' where id = pg_temp.id('dz');
select pg_temp.cand('c' || n, pg_temp.id('A'), pg_temp.id('A1')) from generate_series(1, 9) as n;
select pg_temp.dinv('i1', 'ds', 's1', 'c1');
select pg_temp.dinv('i2', 'ds', 's3', 'c2');
select pg_temp.dinv('i3', 'ds', 's4', 'c3');
select pg_temp.dinv('i4', 'ds', 's1', 'c4');
select pg_temp.dinv('i5', 'do', 't1', 'c5');
select pg_temp.dinv('i6', 'ds', 's1', 'c6');
select pg_temp.dinv('i7', 'ds', 'sx', 'c7');
select pg_temp.dinv('i8', 'ds', 's1', 'c8');
select pg_temp.op();
update public.slots set starts_at = now() - interval '2 hours' where id = pg_temp.id('s4');
select pg_temp.consent('i3');
select pg_temp.consent('i8');
create function pg_temp.self(p_inv text, p_slot text, p_org text default 'A') returns text language sql as $f$
  select pg_temp.try(format($s$select private.self_reschedule(%L, %L, %L)$s$, pg_temp.id(p_org), pg_temp.id(p_inv), pg_temp.id(p_slot)))
$f$;
grant execute on function pg_temp.self(text, text, text) to public;

-- ===== Self-reschedule (trace_api; M2-11, AT-M2-07) =====
select pg_temp.api(pg_temp.id('A'));
select is(pg_temp.self('i1', 's2'), 'OK 1', 'AT-M2-07: a candidate moves once to a future slot of the same drive');
select pg_temp.op();
select is((select (slot_id = pg_temp.id('s2'))::text || '|' || self_reschedules_used || '|' || plan_no from public.invitations where id = pg_temp.id('i1')), 'true|1|1', 'AT-M2-07: slot moved, counter 1, plan_no +1 (R4-2)');
select is((select booked::text from public.slots where id = pg_temp.id('s1')) || '|' || (select booked from public.slots where id = pg_temp.id('s2')), '3|1', 'R2-15: the seat moved');
select is((select actor_kind || '|' || coalesce(actor_user_id::text, 'null') || '|' || reason_code || '|' || (from_slot_id = pg_temp.id('s1'))::text || '|' || (to_slot_id = pg_temp.id('s2'))::text from public.reschedule_events where invitation_id = pg_temp.id('i1')), 'candidate|null|candidate_self|true|true', 'R3-12: the trigger writes one event for the candidate');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.self('i1', 's1'), '^42501 TRACE_GUARD: reschedule_used', 'E10: a second self-reschedule is refused');
select matches(pg_temp.self('i2', 's1'), '^42501 TRACE_GUARD: too_late_to_reschedule', 'E11: within 2 h of the slot it is refused');
select is(pg_temp.self('i3', 's1'), 'OK 1', 'E12, AT-M2-07: after a missed window (otp_verified, never started) it is allowed');
select matches(pg_temp.self('i4', 'sx'), '^42501 TRACE_GUARD: slot full', 'AT-M2-07: a full target slot is refused');
select matches(pg_temp.self('i4', 'z1'), '^42501 TRACE_GUARD: slot not in drive', 'AT-M2-07: a slot of another drive is refused');
select matches(pg_temp.self('i4', 's4'), '^42501 TRACE_GUARD: slot not open', 'AT-M2-07: a slot in the past is refused');
select matches(pg_temp.self('i5', 't2'), '^42501 TRACE_GUARD: self-reschedule is off for this drive', 'M2-11: a drive may turn self-reschedule off');
select matches(pg_temp.self('i4', 's2', 'B'), '^42501 TRACE_GUARD: not the api org', 'R2-8: p_org must be the api org');
select pg_temp.api(pg_temp.id('B'));
select matches(pg_temp.self('i4', 's2', 'B'), '^42501 TRACE_GUARD: invitation not found', 'R2-8: another org''s invitation is not found');
select pg_temp.api(pg_temp.id('A'));
select pg_temp.op();
select is((select self_reschedules_used from public.invitations where id = pg_temp.id('i4')), 0::smallint, 'AT-M2-07: refused attempts leave the counter at 0');
select pg_temp.u('recruiter');
select matches(pg_temp.self('i4', 's2'), '^42501 permission denied', 'self_reschedule: no app role may call it');

-- ===== Portal slots (R5-24, E25, AT-M2-21) =====
select pg_temp.api(pg_temp.id('A'));
select is((select proargnames::text from pg_proc where oid = 'private.portal_slots(uuid, uuid)'::regprocedure), '{p_org,p_invitation,slot_id,starts_at,available}', 'E25: portal slots return availability booleans, never counts');
select is((select string_agg(available::text, ',' order by starts_at) from private.portal_slots(pg_temp.id('A'), pg_temp.id('i4'))), 'true,true,false', 'E25: the future open slots of the same drive other than the current one (s3, s2, sx full); s4 (past) is out');
select is((select count(*)::int from private.portal_slots(pg_temp.id('A'), pg_temp.id('d1-none'))), 0, 'AT-M2-21: an unknown invitation lists nothing');
select pg_temp.api(pg_temp.id('B'));
select is((select count(*)::int from private.portal_slots(pg_temp.id('A'), pg_temp.id('i4'))), 0, 'AT-M2-21: bound to the api org');

-- ===== Recruiter reschedule (unlimited, audited) =====
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$select public.reschedule_invitation(%L, %L)$$, pg_temp.id('i4'), pg_temp.id('s2'))), 'OK 1', '§6.6: the recruiter moves an invitation');
select is(pg_temp.try(format($$select public.reschedule_invitation(%L, %L)$$, pg_temp.id('i4'), pg_temp.id('s1'))), 'OK 1', '§6.6: again (unlimited for staff)');
select is((select string_agg(actor_kind || ':' || reason_code || ':' || (actor_user_id = pg_temp.id('recruiter'))::text, ',' order by occurred_at, to_slot_id = pg_temp.id('s1')) from public.reschedule_events where invitation_id = pg_temp.id('i4')), 'org_user:recruiter:true,org_user:recruiter:true', 'R3-12: two events naming the recruiter');
select pg_temp.op();
select is((select self_reschedules_used from public.invitations where id = pg_temp.id('i4')), 0::smallint, '§6.6: staff moves never use the candidate''s reschedule');
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$select public.reschedule_invitation(%L, %L)$$, pg_temp.id('i8'), pg_temp.id('s2'))), '^42501 TRACE_GUARD: invitation not found or not movable', '§4: an otp_verified invitation is not moved by staff');
select is((select prosecdef from pg_catalog.pg_proc where oid = 'public.reschedule_invitation(uuid, uuid)'::regprocedure), false, '§3.3: reschedule_invitation is INVOKER');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try(format($$select public.reschedule_invitation(%L, %L)$$, pg_temp.id('i6'), pg_temp.id('s2'))), '^42501 TRACE_GUARD: invitation not found or not movable', 'fence: another workspace''s invitation is not found');
select pg_temp.u('reviewer');
select matches(pg_temp.try(format($$select public.reschedule_invitation(%L, %L)$$, pg_temp.id('i6'), pg_temp.id('s2'))), '^42501', 'reviewer: refused');

-- ===== reschedule_events: append-only, trigger-written (I-M2-7) =====
select pg_temp.u('owner');
select is((select count(*)::int from public.reschedule_events), 4, 'S owner: every event of the org');
select matches(pg_temp.try(format($$insert into public.reschedule_events (org_id, invitation_id, actor_kind, from_slot_id, to_slot_id, reason_code) values (%L, %L, 'candidate', %L, %L, 'candidate_self')$$, pg_temp.id('A'), pg_temp.id('i6'), pg_temp.id('s1'), pg_temp.id('s2'))), '^42501 permission denied', 'I owner: events are written by the trigger only');
select matches(pg_temp.try('update public.reschedule_events set reason_code = ''recruiter'''), '^42501', 'U owner: refused');
select matches(pg_temp.try('delete from public.reschedule_events'), '^42501', 'D owner: refused');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.reschedule_events), 0, 'S ws_recruiter: none (fence)');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.reschedule_events), 0, 'S reviewer: none (R2-11)');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.reschedule_events'), '^42501 permission denied', 'S api: no grant');
select pg_temp.op();
select matches(pg_temp.try('update public.reschedule_events set reason_code = ''recruiter'''), '^(P0001 TRACE_APPEND_ONLY|42501)', 'U operator: append-only even for the owner');
select matches(pg_temp.try('truncate public.reschedule_events'), '^(P0001 TRACE_APPEND_ONLY|42501)', 'TRUNCATE operator: append-only');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.reschedule_events'::regclass), true, 'RLS: enabled on reschedule_events');
