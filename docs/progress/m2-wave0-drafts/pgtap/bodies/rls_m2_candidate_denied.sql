-- rls_m2_candidate_denied (spec specs/m2-scheduling-invites.md revision 5 §10 row rls_m2_candidate_denied; §3.4 last line; rule 5; AT-M2-21). RED first: written from the spec before migrations M2-a and M2-b (Wave 0a), extended before M2-c (Wave 0b).
-- m2_tables(): every table M2 adds (M2-a, M2-b, M2-c).
create function pg_temp.m2_tables() returns text[] language sql as $f$
  select array['org_keys', 'candidates', 'candidate_contacts', 'drives', 'slots', 'invite_uploads', 'invite_upload_errors',
    'reschedule_events', 'message_templates', 'outbound_messages', 'message_events', 'message_events_unmatched']
$f$;
grant execute on function pg_temp.m2_tables() to public;
-- m2_functions(): every function M2 adds in private or public (M2-a, M2-b, M2-c).
create function pg_temp.m2_functions() returns text[] language sql as $f$
  select array['reminder_offsets_valid', 'm2_insert_once', 'drives_guard', 'drives_audit', 'drives_follow_end',
    'slots_guard', 'slots_follow_end', 'drive_end', 'invite_uploads_guard', 'invite_upload_errors_guard',
    'invite_uploads_count', 'invitations_book', 'invitations_reschedule_event', 'reschedule_events_append_only',
    'backfill_session_grant_exp', 'ingest_invite_batch', 'reschedule_invitation', 'self_reschedule', 'invitation_window',
    'invitation_recipient_ct', 'portal_slots', 'message_template', 'message_status_rank', 'outbound_messages_guard',
    'outbound_messages_audit', 'message_events_label', 'message_events_append_only', 'plan_reminders', 'plan_one',
    'plan_messages', 'drives_cancel_messages', 'claim_due_messages', 'close_due_drives', 'purge_unmatched_events',
    'messaging_worker_check', 'message_send_context', 'rotate_link_for_send', 'apply_message_event', 'record_send',
    'record_send_failure', 'record_message_event', 'drive_invitations']
$f$;
grant execute on function pg_temp.m2_functions() to public;

select is((select count(*)::int from unnest(pg_temp.m2_tables()) as t where to_regclass('public.' || t) is null), 0, 'catalog: every M2 table exists');
select is((select count(*)::int from unnest(pg_temp.m2_functions()) as f where not exists (select 1 from pg_catalog.pg_proc as p where p.proname = f and p.pronamespace in ('private'::regnamespace, 'public'::regnamespace))), 0, 'catalog: every M2 function exists');
select is((select count(*)::int from unnest(pg_temp.m2_tables()) as t cross join unnest(array['trace_candidate', 'trace_candidate_gateway', 'anon', 'service_role']) as r where has_table_privilege(r, 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege(r, 'public.' || t, 'SELECT, INSERT, UPDATE, REFERENCES')), 0, '§3.4: the candidate roles, anon and service_role hold nothing on any M2 table');
select is((select count(*)::int from pg_catalog.pg_proc as p cross join unnest(array['trace_candidate', 'trace_candidate_gateway', 'anon', 'service_role']) as r where p.proname = any (pg_temp.m2_functions()) and p.pronamespace in ('private'::regnamespace, 'public'::regnamespace) and has_function_privilege(r, p.oid, 'EXECUTE')), 0, '§3.4: none of them may execute an M2 function');
select is((select count(*)::int from unnest(pg_temp.m2_tables()) as t cross join unnest(array['trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_authoring_worker', 'trace_admin_worker']) as r where has_table_privilege(r, 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege(r, 'public.' || t, 'SELECT, INSERT, UPDATE, REFERENCES')), 0, 'R2-22: the D1 and M1 worker roles hold nothing on any M2 table');
select is((select count(*)::int from pg_catalog.pg_proc as p cross join unnest(array['trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_authoring_worker', 'trace_admin_worker']) as r where p.proname = any (pg_temp.m2_functions()) and p.pronamespace in ('private'::regnamespace, 'public'::regnamespace) and has_function_privilege(r, p.oid, 'EXECUTE')), 0, 'R2-22: nor execute an M2 function');
select is((select count(*)::int from unnest(pg_temp.m2_tables()) as t where (select not relrowsecurity from pg_catalog.pg_class where oid = ('public.' || t)::regclass)), 0, 'RLS: enabled on every M2 table');
select is((select count(*)::int from pg_catalog.pg_proc as p where p.proname = any (pg_temp.m2_functions()) and p.pronamespace in ('private'::regnamespace, 'public'::regnamespace) and p.prosecdef and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)), 0, 'MT-7: every M2 DEFINER function pins search_path');
set local role trace_candidate;
select matches(pg_temp.try('select * from public.candidates'), '^42501 permission denied', 'rule 5: trace_candidate cannot read candidates');
select matches(pg_temp.try('select * from public.slots'), '^42501 permission denied', 'rule 5: trace_candidate cannot read slots (availability comes as booleans through the api)');
select matches(pg_temp.try('select * from public.reschedule_events'), '^42501 permission denied', 'rule 5: trace_candidate cannot read reschedule events');
select matches(pg_temp.try('select * from public.outbound_messages'), '^42501 permission denied', 'rule 5: trace_candidate cannot read messages');
select matches(pg_temp.try('select * from public.message_events'), '^42501 permission denied', 'rule 5: trace_candidate cannot read delivery events');
reset role;
