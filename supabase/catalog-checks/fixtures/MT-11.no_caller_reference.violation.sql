-- MT-11.no_caller_reference: a soft-delete clause that names a column but never the caller (M0a review DB-1),
-- here ORed with a private helper that does not depend on the caller either (M0b review M0B-DB-2): calling a
-- function in private is not enough, only the caller-dependent helpers on MT-11's allow-list count. The plain
-- using (deleted_at is null) is the simpler case of the same predicate (no allow-listed call at all).
create table public.mt_11_soft (org_id uuid not null, deleted_at timestamptz);
alter table public.mt_11_soft enable row level security;
create policy mt_11_soft_select on public.mt_11_soft
for select
to authenticated
using (deleted_at is null or (select private.valid_roles('{admin}'::public.org_role[])));
