-- MT-2.org_id_not_indexed: a tenant table whose org_id leads no index (M0a review DB-2); a partial index on org_id
-- does not count, because it serves only the rows its predicate matches (B0-DB6).
create table public.mt_2_unindexed (org_id uuid not null, id bigint not null);
alter table public.mt_2_unindexed enable row level security;
create index mt_2_unindexed_partial on public.mt_2_unindexed (org_id) where id > 0;
