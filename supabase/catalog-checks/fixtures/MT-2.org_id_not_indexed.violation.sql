-- MT-2.org_id_not_indexed: a tenant table whose org_id leads no index (M0a review DB-2).
create table public.mt_2_unindexed (org_id uuid not null, id bigint not null);
alter table public.mt_2_unindexed enable row level security;
