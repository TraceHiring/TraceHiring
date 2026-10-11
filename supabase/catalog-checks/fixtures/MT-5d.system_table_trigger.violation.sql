-- MT-5d.system_table_trigger: a trigger on auth.users, a Supabase table outside the catalog-check scope (postgres
-- holds TRIGGER on it), whose WHEN clause reads an integrity table and whose function zeroes a quality score: an
-- integrity condition edits a quality score. Neither function reaches both schemas on its own.
create table quality.mt_5d_score (org_id uuid not null, user_id uuid, points int);
create table integrity.mt_5d_signal (org_id uuid not null, user_id uuid, confirmed boolean);
alter table quality.mt_5d_score enable row level security;
alter table integrity.mt_5d_signal enable row level security;
create function private.mt_5d_is_flagged(p_user uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from integrity.mt_5d_signal as g where g.user_id = p_user and g.confirmed)
$$;
create function private.mt_5d_zero() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update quality.mt_5d_score set points = 0 where user_id = new.id;
  return new;
end
$$;
create trigger mt_5d_user_flagged
after update on auth.users
for each row
when (private.mt_5d_is_flagged(new.id))
execute function private.mt_5d_zero();
