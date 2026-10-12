-- MT-4.anon_column: anon is granted SELECT on one column of an in-scope table, with no table-level grant.
create table public.mt_4_col (org_id uuid not null, label text);
grant select (label) on public.mt_4_col to anon;
