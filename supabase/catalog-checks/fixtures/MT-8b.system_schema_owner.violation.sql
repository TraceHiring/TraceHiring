-- MT-8b.system_schema_owner: cron is on the system list but absent on the local stack, so a migration can create it,
-- owned by postgres instead of supabase_admin. The name cannot carry the mt_8b_ prefix: the branch is about a
-- system-list name. Trace does not install pg_cron, so the schema does not exist before this runs.
create schema cron;
