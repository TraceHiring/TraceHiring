-- MT-5d.system_relation_policy: a policy on storage.objects, a Supabase table outside the catalog-check scope (supautils
-- lets postgres create policies there, M0a catalog pass C review E3), whose clause calls one function that reads a
-- quality table and one that reads an integrity table. Neither function reaches both schemas on its own.
create table quality.mt_5d_score (org_id uuid not null, user_id uuid, points int);
create table integrity.mt_5d_signal (org_id uuid not null, user_id uuid, confirmed boolean);
alter table quality.mt_5d_score enable row level security;
alter table integrity.mt_5d_signal enable row level security;
create function private.mt_5d_has_score(p_user uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from quality.mt_5d_score as s where s.user_id = p_user and s.points > 0)
$$;
create function private.mt_5d_is_flagged(p_user uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from integrity.mt_5d_signal as g where g.user_id = p_user and g.confirmed)
$$;
create policy mt_5d_objects_select on storage.objects
for select
to authenticated
using (private.mt_5d_has_score(owner) and not private.mt_5d_is_flagged(owner));
