-- MT-4.column_references: authenticated (not the owner, not anon) is granted REFERENCES on one column of an in-scope
-- table. Column grants live in pg_attribute.attacl, not in relacl.
create table public.mt_4_colref (org_id uuid not null);
grant references (org_id) on public.mt_4_colref to authenticated;
