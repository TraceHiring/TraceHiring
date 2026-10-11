-- MT-1.foreign_table_in_scope: a foreign table attached as a partition of a compliant in-scope parent, living outside
-- the four schemas. Foreign tables cannot have row level security, so any foreign table in scope is a violation.
-- postgres_fdw is created only if it is missing (supautils runs it as supabase_admin and grants postgres USAGE).
create extension if not exists postgres_fdw with schema extensions;
create server mt_1_server foreign data wrapper postgres_fdw;
create table public.mt_1_ledger (org_id uuid not null, kind text not null) partition by list (kind);
alter table public.mt_1_ledger enable row level security;
create schema mt_1_remote;
create foreign table mt_1_remote.mt_1_ledger_remote partition of public.mt_1_ledger for values in ('remote')
  server mt_1_server;
