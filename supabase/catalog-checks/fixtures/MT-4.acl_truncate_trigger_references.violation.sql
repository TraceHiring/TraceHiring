-- MT-4.acl_truncate_trigger_references: authenticated (not the owner, not anon) is granted TRUNCATE on an in-scope table.
create table public.mt_4_trunc (org_id uuid not null);
grant truncate on public.mt_4_trunc to authenticated;
