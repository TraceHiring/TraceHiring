-- MT-9.handmade_nonadmin_owner: postgres (an ADMIN member of service_role) lets service_role create a SECURITY
-- DEFINER function in extensions. It is owned by service_role, which bypasses RLS, and PUBLIC can execute it.
grant create on schema extensions to service_role;
set role service_role;
create function extensions.mt_9_bypass() returns bigint language sql security definer as 'select 1::bigint';
reset role;
revoke create on schema extensions from service_role;
