-- MT-1.partition_without_rls: a compliant partitioned parent in public whose partition, in a non-scope schema, has RLS off.
create table public.mt_1_events (org_id uuid not null, kind text not null) partition by list (kind);
alter table public.mt_1_events enable row level security;
create schema mt_1_archive;
create table mt_1_archive.mt_1_events_default partition of public.mt_1_events default;
