-- MT-5a.via_domain: a view over quality that casts to a public domain whose CHECK calls a plpgsql function that
-- reads an integrity table. pg_depend records the domain, not its constraint's function.
create table quality.mt_5a_score (session_id uuid, points int);
create table integrity.mt_5a_signal (session_id uuid, band text);
create function public.mt_5a_points_ok(p_points int) returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  return p_points >= (select count(*) from integrity.mt_5a_signal);
end
$$;
create domain public.mt_5a_points as int check (public.mt_5a_points_ok(value));
create view public.mt_5a_checked_scores with (security_invoker = true) as
select s.session_id, s.points::public.mt_5a_points as points
from quality.mt_5a_score as s;
