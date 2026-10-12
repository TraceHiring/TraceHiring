-- MT-5d.column_domain: a quality column typed by a public domain whose CHECK calls a plpgsql function that reads an
-- integrity table, so every write to the column reads integrity.
create table integrity.mt_5d_signal (session_id uuid, band text);
create function public.mt_5d_points_ok(p_points int) returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  return p_points >= (select count(*) from integrity.mt_5d_signal);
end
$$;
create domain public.mt_5d_points as int check (public.mt_5d_points_ok(value));
create table quality.mt_5d_score (session_id uuid, points public.mt_5d_points);
