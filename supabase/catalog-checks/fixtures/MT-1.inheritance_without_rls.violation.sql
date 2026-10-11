-- MT-1.inheritance_without_rls: a compliant in-scope parent whose INHERITS child lives in a system-list schema
-- (supabase_migrations, which postgres owns) with row level security off. Children do not inherit relrowsecurity.
create table public.mt_1_parent (org_id uuid not null);
alter table public.mt_1_parent enable row level security;
create table supabase_migrations.mt_1_child () inherits (public.mt_1_parent);
