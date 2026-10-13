-- MT-11.no_caller_reference: a soft-delete clause that names a column but never the caller (M0a review DB-1).
create table public.mt_11_soft (org_id uuid not null, deleted_at timestamptz);
alter table public.mt_11_soft enable row level security;
create policy mt_11_soft_select on public.mt_11_soft
for select
to authenticated
using (deleted_at is null);
