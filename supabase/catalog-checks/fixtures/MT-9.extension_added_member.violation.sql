-- MT-9.extension_added_member: postgres owns lo (a trusted extension, see MT-9.extension_owner), so it can add a
-- function it made to lo. As an extension member the function would be skipped by the hand-made branches here and
-- by MT-7. lo's own members are owned by supabase_admin (the bootstrap superuser), so only the added one fires.
-- extension_owner fires too: no extension on the hosted allow-list is owned by postgres locally. Trace never
-- installs lo.
create extension lo with schema extensions;
create function extensions.mt_9_hidden() returns integer language sql as 'select 1';
alter extension lo add function extensions.mt_9_hidden();
