-- MT-4.anon_table: anon is granted SELECT on an in-scope table.
create table public.mt_4_tbl (org_id uuid not null);
grant select on public.mt_4_tbl to anon;
