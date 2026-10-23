-- rls_m1_members (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_members; §3.2 member_invites; §3.3 memberships guard v2; §3.4 provision_invited_member; §3.5; §4.5; M1-20; AT-M1-26 (DB half), AT-M1-25; R2-6, R2-14, R2-15, R2-23, R3-8, R5-26, R5-30, R5-35; E26, E27). RED first: written from the spec before migration M1-d. Personas are synthetic; no e-mail address is stored by M1 (the HMACs below are fixed hex strings).
-- Extra personas: pure_owner (…030, org A owner only), invitee (…031), invitee two (…032) and three (…033).
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000030', 'authenticated', 'authenticated', 'p-pure-owner@example.test'),
  ('00000000-0000-4000-8000-000000000031', 'authenticated', 'authenticated', 'p-invitee@example.test'),
  ('00000000-0000-4000-8000-000000000032', 'authenticated', 'authenticated', 'p-invitee-two@example.test'),
  ('00000000-0000-4000-8000-000000000033', 'authenticated', 'authenticated', 'p-invitee-three@example.test');
insert into public.memberships (org_id, user_id, roles, display_name, status) values
  (pg_temp.id('A'), '00000000-0000-4000-8000-000000000030', '{org_owner}', 'Persona Pure Owner', 'active');
insert into pg_temp.ids values ('invitee', '00000000-0000-4000-8000-000000000031'), ('invitee2', '00000000-0000-4000-8000-000000000032'),
  ('invitee3', '00000000-0000-4000-8000-000000000033'), ('outsider', '00000000-0000-4000-8000-000000000011');
-- as_sub(user, aal2): an authenticated session of a user that has no named persona (OTP at aal1, or OTP + TOTP at aal2).
create function pg_temp.as_sub(p_sub uuid, p_aal2 boolean) returns void language plpgsql as $f$
begin
  perform pg_temp.op();
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', case when p_aal2
    then '{"sub": "' || p_sub || '", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}'
    else '{"sub": "' || p_sub || '", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}' end, true);
end
$f$;
grant execute on function pg_temp.as_sub(uuid, boolean) to public;
create table pg_temp.res (k text primary key, v uuid);
grant select, insert on pg_temp.res to public;

-- ===== member_invites: I (AD aal2; an owner invite only by an owner, R2-14) =====
select pg_temp.u('admin');
select is(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('1', 64), '{recruiter}')$$), 'OK 1', 'member_invites I: admin invites a recruiter');
select is(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles, workspace_id) values ('a1000000-0000-4000-8000-000000000001', repeat('3', 64), '{recruiter}', 'b1000000-0000-4000-8000-000000000002')$$), 'OK 1', 'member_invites I: admin invites a recruiter scoped to workspace A2');
select is(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('4', 64), '{reviewer}'), ('a1000000-0000-4000-8000-000000000001', repeat('5', 64), '{hiring_manager}'), ('a1000000-0000-4000-8000-000000000001', repeat('6', 64), '{recruiter}'), ('a1000000-0000-4000-8000-000000000001', repeat('7', 64), '{reviewer}')$$), 'OK 4', 'member_invites I: admin invites a reviewer, a hiring manager and two more');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('8', 64), '{org_owner}')$$), '^42501 TRACE_GUARD: only an owner invites an owner', 'R2-14: an admin who is not an owner cannot invite an owner');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles, workspace_id) values ('a1000000-0000-4000-8000-000000000001', repeat('8', 64), '{admin}', 'b1000000-0000-4000-8000-000000000002')$$), '^23514', 'member_invites I: an admin invite is org-wide (D16b)');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', 'p-someone@example.test', '{recruiter}')$$), '^23514', 'member_invites I: only a 64-hex HMAC fits, never an address (R2-14)');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('1', 64), '{reviewer}')$$), '^23505', 'member_invites I: one pending invite per address per org');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles, status) values ('a1000000-0000-4000-8000-000000000001', repeat('9', 64), '{recruiter}', 'provisioned')$$), '^42501 permission denied', 'member_invites I: status is outside the insert grant (an invite starts pending)');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles, invited_by) values ('a1000000-0000-4000-8000-000000000001', repeat('9', 64), '{recruiter}', '00000000-0000-4000-8000-000000000001')$$), '^42501 permission denied', 'member_invites I: invited_by is outside the insert grant (the guard sets the caller)');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('9', 64), '{recruiter,recruiter}')$$), '^23514', 'member_invites I: roles follow valid_roles');
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('2', 64), '{org_owner}')$$), 'OK 1', 'R2-14: an owner (with admin) invites an owner');
select pg_temp.u('pure_owner');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501', 'member_invites I: an owner without the admin role cannot invite (matrix I: AD)');
select pg_temp.u('admin_aal1');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501', 'member_invites I: an admin at aal1 cannot invite (aal2)');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501', 'member_invites I: recruiter cannot invite');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles, workspace_id) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}', 'b1000000-0000-4000-8000-000000000002')$$), '^42501', 'member_invites I: workspace recruiter cannot invite, even into their workspace');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501', 'member_invites I: reviewer cannot invite');
select pg_temp.u('hm');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501', 'member_invites I: hiring manager cannot invite');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501', 'member_invites I: org B admin cannot invite into org A');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select matches(pg_temp.try($$insert into public.member_invites (org_id, email_hmac, roles) values ('a1000000-0000-4000-8000-000000000001', repeat('a', 64), '{recruiter}')$$), '^42501 permission denied', 'member_invites I: the admin worker never creates an invite');
select pg_temp.op();
insert into pg_temp.ids select 'i' || substr(email_hmac, 1, 1), id from public.member_invites where org_id = pg_temp.id('A');
select is((select string_agg(substr(email_hmac, 1, 1) || ':' || status || ':' || (invited_by = case when roles = '{org_owner}' then pg_temp.id('owner') else pg_temp.id('admin') end)::text, ',' order by email_hmac) from public.member_invites), '1:pending:true,2:pending:true,3:pending:true,4:pending:true,5:pending:true,6:pending:true,7:pending:true', 'member_invites I: invites start pending, invited by the caller');
select is((select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'member_invites'), 'id,org_id,email_hmac,roles,workspace_id,status,membership_id,invited_by,created_at', 'member_invites: no address, name or other personal column (R2-14)');
select is((select pg_temp.keys(details) || '|' || (details -> 'roles')::text || '|' || (actor_user_id = pg_temp.id('admin'))::text from public.audit_log where action = 'member_invite.create' and object_id = pg_temp.id('i1')), 'member_invite_id,roles|["recruiter"]|true', 'AT-M1-25: member_invite.create carries the invite id and roles, by the admin');

-- ===== member_invites: S (OW AD) =====
select pg_temp.u('owner');
select is((select count(*)::int from public.member_invites), 7, 'member_invites S: owner sees the org A invites');
select pg_temp.u('admin');
select is((select count(*)::int from public.member_invites), 7, 'member_invites S: admin sees the org A invites');
select pg_temp.u('pure_owner');
select is((select count(*)::int from public.member_invites), 7, 'member_invites S: an owner without admin sees them (matrix S: OW AD)');
select pg_temp.u('admin_aal1');
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: an admin at aal1 sees none');
select pg_temp.u('recruiter');
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: recruiter sees none');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: workspace recruiter sees none, not even the A2 invite');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: reviewer sees none');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: org B admin sees no org A invite');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select is((select count(*)::int from public.member_invites), 7, 'member_invites S: the admin worker sees its job org''s invites');
select pg_temp.w('trace_admin_worker', pg_temp.id('B'));
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: an admin worker bound to org B sees no org A invite (R5-35)');
select pg_temp.w('trace_admin_worker', null);
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: an unbound admin worker sees nothing');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.member_invites'), '^42501 permission denied', 'member_invites S: the authoring worker has no grant (R2-23)');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.member_invites'), '^42501 permission denied', 'member_invites S: trace_api has no grant (provisioning runs in workers/jobs, M1-20)');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try('select * from public.member_invites'), '^42501 permission denied', 'member_invites S: trace_candidate has no privilege');
select pg_temp.op();
set local role service_role;
select matches(pg_temp.try('select * from public.member_invites'), '^42501 permission denied', 'member_invites S: service_role has no privilege');
select pg_temp.op();

-- ===== member_invites: U (admin cancels; the admin worker marks failed) =====
select pg_temp.u('admin_aal1');
select is(pg_temp.try(format($$update public.member_invites set status = 'cancelled' where id = %L$$, pg_temp.id('i4'))), 'OK 0', 'member_invites U (DB review M2): an admin at aal1 cannot cancel (aal2 role)');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.member_invites set status = 'cancelled' where id = %L$$, pg_temp.id('i4'))), 'OK 0', 'member_invites U: recruiter cannot cancel');
select pg_temp.u('pure_owner');
select is(pg_temp.try(format($$update public.member_invites set status = 'cancelled' where id = %L$$, pg_temp.id('i4'))), 'OK 0', 'member_invites U: an owner without admin cannot cancel (matrix U: AD)');
select pg_temp.u('b_admin');
select is(pg_temp.try(format($$update public.member_invites set status = 'cancelled' where id = %L$$, pg_temp.id('i4'))), 'OK 0', 'member_invites U: org B admin cannot cancel an org A invite');
select pg_temp.u('admin');
select matches(pg_temp.try(format($$update public.member_invites set status = 'failed' where id = %L$$, pg_temp.id('i4'))), '^42501', 'member_invites U: an admin only cancels');
select matches(pg_temp.try(format($$update public.member_invites set roles = '{admin}' where id = %L$$, pg_temp.id('i4'))), '^42501 permission denied', 'member_invites U: roles are outside the update grant');
select is(pg_temp.try(format($$update public.member_invites set status = 'cancelled' where id = %L$$, pg_temp.id('i4'))), 'OK 1', 'member_invites U: admin cancels a pending invite');
select is(pg_temp.try(format($$update public.member_invites set status = 'pending' where id = %L$$, pg_temp.id('i4'))), 'OK 0', 'member_invites U: a cancelled invite is final');
select pg_temp.op();
select matches(pg_temp.try(format($$update public.member_invites set status = 'pending' where id = %L$$, pg_temp.id('i4'))), '^42501 TRACE_GUARD: a settled invite is final', 'member_invites U: a cancelled invite is final, even on the operator path');
select matches(pg_temp.try(format($$delete from public.member_invites where id = %L$$, pg_temp.id('i4'))), '^42501 TRACE_GUARD: invites are kept', 'member_invites D: kept, even on the operator path');
select is((select pg_temp.keys(details) || '|' || (actor_user_id = pg_temp.id('admin'))::text from public.audit_log where action = 'member_invite.cancel' and object_id = pg_temp.id('i4')), 'member_invite_id|true', 'AT-M1-25: member_invite.cancel carries the invite id only');
select pg_temp.w('trace_admin_worker', pg_temp.id('B'));
select is(pg_temp.try(format($$update public.member_invites set status = 'failed' where id = %L$$, pg_temp.id('i5'))), 'OK 0', 'member_invites U: an admin worker bound to org B cannot touch an org A invite (R5-35)');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$update public.member_invites set status = 'cancelled' where id = %L$$, pg_temp.id('i5'))), '^42501 TRACE_GUARD: an org admin cancels an invite', 'member_invites U: the admin worker does not cancel');
select matches(pg_temp.try(format($$update public.member_invites set status = 'provisioned' where id = %L$$, pg_temp.id('i5'))), '^42501 TRACE_GUARD: a provisioned invite names its invited membership', 'member_invites U: the admin worker cannot mark an invite provisioned by hand');
select matches(pg_temp.try(format($$update public.member_invites set membership_id = gen_random_uuid() where id = %L$$, pg_temp.id('i5'))), '^42501 permission denied', 'member_invites U: membership_id is outside every grant');
select is(pg_temp.try(format($$update public.member_invites set status = 'failed' where id = %L$$, pg_temp.id('i5'))), 'OK 1', 'member_invites U: the admin worker marks an invite failed');
select pg_temp.op();
select is((select pg_temp.keys(details) || '|' || actor_kind::text from public.audit_log where action = 'member_invite.failed' and object_id = pg_temp.id('i5')), 'member_invite_id|system', 'AT-M1-25: member_invite.failed carries the invite id, written as system');

-- ===== provision_invited_member: who may call it (M1-20, R5-35) =====
select pg_temp.u('admin');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), '^42501 permission denied', 'provision: an org admin cannot call it');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), '^42501 permission denied', 'provision: trace_api cannot call it (service keys stay in workers/jobs)');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), '^42501 permission denied', 'provision: the authoring worker cannot call it');
select pg_temp.w('trace_admin_worker', pg_temp.id('B'));
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), '^42501 TRACE_GUARD: member invite not found in the job org', 'R5-35: an admin worker bound to org B cannot provision an org A invite');
select pg_temp.w('trace_admin_worker', null);
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), '^42501 TRACE_GUARD: member invite not found in the job org', 'R5-35: an unbound admin worker provisions nothing');
select pg_temp.op();
select is((select string_agg(r, ',' order by r) from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_authoring_worker', 'trace_admin_worker', 'trace_candidate']) as r where has_function_privilege(r, 'private.provision_invited_member(uuid, uuid, text)', 'EXECUTE')), 'trace_admin_worker', 'provision: EXECUTE is granted to trace_admin_worker only');

-- ===== provision_invited_member: the invited membership (roles only from the invite, R2-14) =====
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select is(pg_temp.try(format($$insert into pg_temp.res select 'm1', private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), 'OK 1', 'AT-M1-26: the admin worker provisions the recruiter invite');
select is(pg_temp.try(format($$insert into pg_temp.res select 'm2', private.provision_invited_member(%L, %L, 'Persona Invitee Two')$$, pg_temp.id('i2'), pg_temp.id('invitee2'))), 'OK 1', 'AT-M1-26: the admin worker provisions the owner invite (an owner invited it)');
select is(pg_temp.try(format($$insert into pg_temp.res select 'm3', private.provision_invited_member(%L, %L, 'Persona Invitee Three')$$, pg_temp.id('i3'), pg_temp.id('invitee3'))), 'OK 1', 'AT-M1-26: the admin worker provisions the workspace A2 invite');
select is(pg_temp.try(format($$insert into pg_temp.res select 'm1b', private.provision_invited_member(%L, %L, 'Persona Invitee')$$, pg_temp.id('i1'), pg_temp.id('invitee'))), 'OK 1', 'provision: a re-delivered job for the same user succeeds');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Someone Else')$$, pg_temp.id('i1'), pg_temp.id('outsider'))), '^42501 TRACE_GUARD: the invite is not pending', 'provision: a provisioned invite serves no other user');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Outsider')$$, pg_temp.id('i4'), pg_temp.id('outsider'))), '^42501 TRACE_GUARD: the invite is not pending', 'provision: a cancelled invite is not provisioned');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Outsider')$$, pg_temp.id('i5'), pg_temp.id('outsider'))), '^42501 TRACE_GUARD: the invite is not pending', 'provision: a failed invite is not provisioned');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, 'Persona Recruiter Again')$$, pg_temp.id('i6'), pg_temp.id('recruiter'))), '^23505 TRACE_GUARD: the user already has a membership in this org', 'E26: an existing Auth user who is already a member gets no second membership');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, gen_random_uuid(), 'Persona Nobody')$$, pg_temp.id('i6'))), '^23503', 'provision: the user must exist in Auth');
select matches(pg_temp.try(format($$select private.provision_invited_member(%L, %L, repeat('n', 121))$$, pg_temp.id('i6'), pg_temp.id('outsider'))), '^22023 TRACE_BAD_INPUT: display name', 'provision (security review L-1): a display name outside 1-120 characters is refused before the insert, so the name never reaches an error detail');
select matches(pg_temp.try(format($$insert into public.memberships (org_id, user_id, roles, display_name, status) values (%L, %L, '{recruiter}', 'Direct', 'invited')$$, pg_temp.id('A'), pg_temp.id('outsider'))), '^42501 permission denied', 'provision: the admin worker cannot insert a membership directly');
select set_config('trace.provision_invite', pg_temp.id('i6')::text, true);
select matches(pg_temp.try(format($$insert into public.memberships (org_id, user_id, roles, display_name, status) values (%L, %L, '{recruiter}', 'Direct', 'invited')$$, pg_temp.id('A'), pg_temp.id('outsider'))), '^42501 permission denied', 'provision: setting the marker by hand does not open a direct insert');
select set_config('trace.provision_invite', '', true);
select pg_temp.op();
select is((select (select v from pg_temp.res where k = 'm1b') = (select v from pg_temp.res where k = 'm1')), true, 'provision: the re-delivered job returns the same membership (exactly once)');
select is((select string_agg(m.status::text || ':' || array_to_string(m.roles, '+') || ':' || coalesce(w.name, 'org-wide') || ':' || (m.created_by = i.invited_by)::text || ':' || m.display_name || ':' || (i.status = 'provisioned' and i.membership_id = m.id)::text, ',' order by m.display_name) from public.memberships as m join public.member_invites as i on i.membership_id = m.id left join public.workspaces as w on w.id = m.workspace_id where m.user_id in (pg_temp.id('invitee'), pg_temp.id('invitee2'), pg_temp.id('invitee3'))),
  'invited:recruiter:org-wide:true:Persona Invitee:true,invited:recruiter:Client A2:true:Persona Invitee Three:true,invited:org_owner:org-wide:true:Persona Invitee Two:true',
  'AT-M1-26: each membership is invited, with the invite''s roles and workspace, created by the inviter, and its invite is provisioned');
select is((select count(*)::int from public.memberships where user_id = pg_temp.id('invitee')), 1, 'provision: one membership for the invitee');
select is((select status from public.member_invites where id = pg_temp.id('i6')), 'pending', 'E26: the refused invite stays pending for the worker to mark failed');
select is((select pg_temp.keys(a.details) || '|' || (a.details ->> 'status') || '|' || (a.details -> 'roles')::text || '|' || a.actor_kind::text from public.audit_log as a where a.action = 'membership.create' and a.object_id = (select v from pg_temp.res where k = 'm1')), 'roles,status,team_id,workspace_id|invited|["recruiter"]|system', 'R5-14: provisioning writes membership.create in the M0b shape with status invited, as system');
select is((select pg_temp.keys(details) || '|' || actor_kind::text from public.audit_log where action = 'member_invite.provisioned' and object_id = pg_temp.id('i1')), 'member_invite_id|system', 'AT-M1-25: member_invite.provisioned carries the invite id only');

-- ===== E27: an invited member has no access until they accept =====
select pg_temp.u('invitee');
select is((select string_agg(status::text, ',') from public.memberships), 'invited', 'E27: the invitee sees their own invited row');
select is((select count(*)::int from public.orgs), 0, 'E27: an invited member sees no org');
select is((select count(*)::int from public.tests), 0, 'E27: an invited member sees no test');
select is((select count(*)::int from public.member_invites), 0, 'member_invites S: the invitee never reads invites');

-- ===== R2-15: the invitee moves their own row invited → active, nothing else =====
select is(pg_temp.try($$update public.memberships set display_name = 'Invited Self' where user_id = '00000000-0000-4000-8000-000000000031'$$), '42501 TRACE_GUARD: an invited member can only accept', 'R2-15: an invited member cannot change their display name before accepting');
select is(pg_temp.try($$update public.memberships set roles = '{admin}' where user_id = '00000000-0000-4000-8000-000000000031'$$), '42501 TRACE_GUARD: an invited member can only accept', 'R2-15: an invited member cannot change their roles');
select is(pg_temp.try($$update public.memberships set status = 'active', display_name = 'Renamed' where user_id = '00000000-0000-4000-8000-000000000031'$$), '42501 TRACE_GUARD: accepting an invitation changes the status only', 'R2-15: accepting changes the status only');
select matches(pg_temp.try($$update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-000000000031'$$), '^42501', 'R2-15: the invitee can only move to active');
select pg_temp.u('admin');
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000031'$$), '42501 TRACE_GUARD: only the invitee accepts an invitation', 'R2-15: an admin cannot accept for the invitee');
select pg_temp.op();
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000031'$$), '42501 TRACE_GUARD: only the invitee accepts an invitation', 'R2-15: nor can the operator');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select matches(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000031'$$), '^42501 permission denied', 'R2-15: nor can the admin worker');
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000031'$$), 'OK 0', 'R2-15: another member cannot reach the invited row');
select pg_temp.u('b_admin');
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000031'$$), 'OK 0', 'R2-15: org B admin cannot reach the invited row');
select pg_temp.u('invitee');
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000031'$$), 'OK 1', 'R2-15: the invitee accepts at aal1 (any aal)');
select is((select count(*)::int from public.orgs), 1, 'R2-15: once active, the recruiter membership counts (org A visible)');
select matches(pg_temp.try($$update public.memberships set status = 'invited' where user_id = '00000000-0000-4000-8000-000000000031'$$), '^42501', 'R2-15: an accepted membership never goes back to invited');
select pg_temp.op();
select is((select (a.details -> 'changed')::text || '|' || (a.details ->> 'old_status') || '>' || (a.details ->> 'new_status') || '|' || a.actor_kind::text || '|' || (a.actor_user_id = pg_temp.id('invitee'))::text from public.audit_log as a where a.action = 'membership.update' and a.object_id = (select v from pg_temp.res where k = 'm1')), '["status"]|invited>active|org_user|true', 'R2-15: the acceptance is audited as the invitee''s own status change');
select pg_temp.as_sub(pg_temp.id('invitee2'), false);
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000032'$$), 'OK 1', 'R2-15: an invited owner accepts at aal1');
select is((select count(*)::int from public.orgs), 0, 'ADR-029: the accepted owner membership counts only at aal2');
select pg_temp.as_sub(pg_temp.id('invitee2'), true);
select is((select count(*)::int from public.orgs), 1, 'ADR-029: at aal2 the owner sees org A');

-- ===== E27 / §4.5: an owner or admin removes an unaccepted invitation =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.memberships set status = 'removed' where user_id = '00000000-0000-4000-8000-000000000033'$$), 'OK 0', 'E27: a recruiter cannot remove an invited member');
select pg_temp.u('ws_recruiter');
select is(pg_temp.try($$update public.memberships set status = 'removed' where user_id = '00000000-0000-4000-8000-000000000033'$$), 'OK 0', 'E27: a workspace recruiter cannot remove an invited member of their workspace');
select pg_temp.u('admin');
select is(pg_temp.try($$update public.memberships set status = 'removed' where user_id = '00000000-0000-4000-8000-000000000033'$$), 'OK 1', 'E27: an admin removes an invited member');
select pg_temp.op();
select is((select status::text || '|' || (removed_at is not null)::text from public.memberships where user_id = pg_temp.id('invitee3')), 'removed|true', 'E27: the invited row is removed');
select is((select pg_temp.keys(details) || '|' || (details ->> 'old_status') from public.audit_log where action = 'membership.remove' and object_id = (select v from pg_temp.res where k = 'm3')), 'old_status|invited', 'E27: membership.remove records the invited status');

-- ===== M0b paths kept (memberships guard v2, R5-30) =====
select is(pg_temp.try(format($$insert into public.memberships (org_id, user_id, roles, display_name, status) values (%L, %L, '{reviewer}', 'Operator Invited', 'invited')$$, pg_temp.id('B'), pg_temp.id('invitee3'))), 'OK 1', 'M0b: the operator may still insert an invited membership (fixtures)');
select pg_temp.u('admin');
select is(pg_temp.try(format($$insert into public.memberships (org_id, user_id, roles, display_name, status) values (%L, %L, '{recruiter}', 'App Invited', 'invited')$$, pg_temp.id('A'), pg_temp.id('outsider'))), '42501 TRACE_GUARD: an invited membership is created by the invite worker only', 'M1-20: an app caller cannot insert an invited membership');
select is(pg_temp.try(format($$insert into public.memberships (org_id, user_id, roles, display_name) values (%L, %L, '{recruiter}', 'App Active')$$, pg_temp.id('A'), pg_temp.id('outsider'))), 'OK 1', 'M0b: an admin still adds an active member');
select is(pg_temp.try($$update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-000000000011' and org_id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 1', 'M0b: an admin still suspends a member');
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.memberships set display_name = 'Recruiter Renamed' where user_id = '00000000-0000-4000-8000-000000000005'$$), 'OK 1', 'M0b: an active member still renames themselves');
select matches(pg_temp.try($$update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-000000000005'$$), '^42501 TRACE_GUARD: nobody changes their own roles, status or scope', 'M0b: nobody changes their own status');

-- ===== R2-14: the inviter is re-checked at provisioning and again at acceptance (security review M-1) =====
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select is(pg_temp.try(format($$insert into pg_temp.res select 'm7', private.provision_invited_member(%L, %L, 'Persona Invitee Three')$$, pg_temp.id('i7'), pg_temp.id('invitee3'))), 'OK 1', 'R2-14: an invite of an active admin is provisioned');
select pg_temp.op();
insert into public.member_invites (id, org_id, email_hmac, roles, invited_by) values ('a9000000-0000-4000-8000-000000000008', pg_temp.id('A'), repeat('b', 64), '{recruiter}', pg_temp.id('admin'));
update public.memberships set status = 'suspended' where org_id = pg_temp.id('A') and user_id = pg_temp.id('admin');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$select private.provision_invited_member('a9000000-0000-4000-8000-000000000008', %L, 'Persona Invitee Three')$$, pg_temp.id('invitee3'))), '^42501 TRACE_GUARD: the inviter is no longer an active admin or owner', 'R2-14: an invite from an admin who was suspended is not provisioned');
select pg_temp.as_sub(pg_temp.id('invitee3'), false);
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000033' and org_id = 'a1000000-0000-4000-8000-000000000001'$$), '42501 TRACE_GUARD: the inviter is no longer an active admin or owner', 'R2-14 (security review M-1): an invitation cannot be accepted after its inviter was suspended');
select pg_temp.op();
update public.memberships set status = 'removed' where org_id = pg_temp.id('A') and user_id = pg_temp.id('admin');
select pg_temp.as_sub(pg_temp.id('invitee3'), false);
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000033' and org_id = 'a1000000-0000-4000-8000-000000000001'$$), '42501 TRACE_GUARD: the inviter is no longer an active admin or owner', 'R2-14 (security review M-1): nor after the inviter was removed');
select pg_temp.op();
select is((select status::text from public.memberships where org_id = pg_temp.id('A') and user_id = pg_temp.id('invitee3') and status <> 'removed'), 'invited', 'R2-14: the invitation stays unaccepted (an admin may remove it, E27)');

-- ===== R2-6, R2-23: the admin worker holds nothing else =====
select is((select array_agg(c.relname::text || case when has_any_column_privilege('trace_admin_worker', c.oid, 'INSERT, UPDATE') then ':write' else '' end order by c.relname) from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace, 'private'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('trace_admin_worker', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('trace_admin_worker', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))), array['member_invites:write'], 'R2-23: the admin worker holds exactly member_invites (select, update status)');
select is(has_function_privilege('trace_admin_worker', 'private.valid_roles(public.org_role[])', 'EXECUTE') and has_function_privilege('trace_admin_worker', 'private.job_org_id()', 'EXECUTE'), true, 'R2-6: the admin worker executes the roles CHECK helper and its org helper');
select is(has_schema_privilege('trace_admin_worker', 'quality', 'USAGE') or has_schema_privilege('trace_admin_worker', 'integrity', 'USAGE'), false, 'R2-23: the admin worker holds nothing in quality or integrity');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.memberships'), '^42501 permission denied', 'R2-23: the admin worker cannot read memberships');
select matches(pg_temp.try('select * from public.items'), '^42501 permission denied', 'R2-23: the admin worker cannot read items');
select matches(pg_temp.try('select * from public.sessions'), '^42501 permission denied', 'R2-23: the admin worker cannot read sessions');
select matches(pg_temp.try('select * from public.audit_log'), '^42501 permission denied', 'R2-23: the admin worker cannot read the audit log');
select pg_temp.op();

-- ===== AT-M1-25: invite audit details are ids and role enums only =====
select is((select count(*)::int from public.audit_log where action like 'member_invite.%' and not (pg_temp.keys(details) in ('member_invite_id', 'member_invite_id,roles') and (details ->> 'member_invite_id') ~ '^[0-9a-f-]{36}$' and (not (details ? 'roles') or (jsonb_typeof(details -> 'roles') = 'array' and not exists (select 1 from jsonb_array_elements(details -> 'roles') as r where jsonb_typeof(r) <> 'string' or (r #>> '{}') not in ('org_owner', 'admin', 'recruiter', 'reviewer', 'hiring_manager')))))), 0, 'AT-M1-25: every member_invite.* row carries the invite id and, on create, role enums only');
select is((select count(*)::int from public.audit_log where action like 'member_invite.%'), 14, 'AT-M1-25: eight creates (one on the operator path), one cancel, one failure and four provisionings; the re-delivered job writes no second row');

-- ===== R2-14 for an owner invitation (R5-51 a; Wave 0c confirming re-review Low): its inviter must still be an active owner at acceptance =====
-- Last in the file, so the audit count above is unchanged. Invites on the operator path, from the owner persona.
select pg_temp.op();
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000034', 'authenticated', 'authenticated', 'p-invitee-four@example.test'),
  ('00000000-0000-4000-8000-000000000035', 'authenticated', 'authenticated', 'p-invitee-five@example.test');
insert into pg_temp.ids values ('invitee4', '00000000-0000-4000-8000-000000000034'), ('invitee5', '00000000-0000-4000-8000-000000000035');
insert into public.member_invites (id, org_id, email_hmac, roles, invited_by) values
  ('a9000000-0000-4000-8000-00000000000a', pg_temp.id('A'), repeat('c', 64), '{org_owner}', pg_temp.id('owner')),
  ('a9000000-0000-4000-8000-00000000000b', pg_temp.id('A'), repeat('d', 64), '{org_owner}', pg_temp.id('owner'));
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select is(pg_temp.try(format($$insert into pg_temp.res select 'm10', private.provision_invited_member('a9000000-0000-4000-8000-00000000000a', %L, 'Persona Invitee Four')$$, pg_temp.id('invitee4'))), 'OK 1', 'R2-14: an owner invite from an active owner is provisioned');
select is(pg_temp.try(format($$insert into pg_temp.res select 'm11', private.provision_invited_member('a9000000-0000-4000-8000-00000000000b', %L, 'Persona Invitee Five')$$, pg_temp.id('invitee5'))), 'OK 1', 'R2-14: a second owner invite from the same owner is provisioned');
select pg_temp.as_sub(pg_temp.id('invitee5'), false);
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000035' and org_id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 1', 'R2-14: an owner invitation is accepted while its inviter is an active owner');
select pg_temp.op();
update public.memberships set roles = '{admin}' where org_id = pg_temp.id('A') and user_id = pg_temp.id('owner');
select pg_temp.as_sub(pg_temp.id('invitee4'), false);
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000034' and org_id = 'a1000000-0000-4000-8000-000000000001'$$), '42501 TRACE_GUARD: the inviter is no longer an active admin or owner', 'R2-14 (confirming re-review): an owner invitation cannot be accepted after its inviter lost the owner role, though still an active admin');
select pg_temp.op();
update public.memberships set status = 'removed' where org_id = pg_temp.id('A') and user_id = pg_temp.id('owner');
select pg_temp.as_sub(pg_temp.id('invitee4'), false);
select is(pg_temp.try($$update public.memberships set status = 'active' where user_id = '00000000-0000-4000-8000-000000000034' and org_id = 'a1000000-0000-4000-8000-000000000001'$$), '42501 TRACE_GUARD: the inviter is no longer an active admin or owner', 'R2-14 (confirming re-review): nor after its owner inviter was removed');
select pg_temp.op();
select is((select status::text from public.memberships where org_id = pg_temp.id('A') and user_id = pg_temp.id('invitee4')), 'invited', 'R2-14: the owner invitation stays unaccepted');
