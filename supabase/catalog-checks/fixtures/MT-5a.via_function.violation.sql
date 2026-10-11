-- MT-5a.via_function: a view over quality that calls a plpgsql function naming integrity only in its body.
create table quality.mt_5a_score (session_id uuid, points int);
create table integrity.mt_5a_signal (session_id uuid, band text);
create function public.mt_5a_band(p_session uuid) returns text
language plpgsql
stable
as $$
begin
  return (select g.band from integrity.mt_5a_signal as g where g.session_id = p_session);
end
$$;
create view public.mt_5a_blend with (security_invoker = true) as
select s.session_id, s.points, public.mt_5a_band(s.session_id) as band
from quality.mt_5a_score as s;
