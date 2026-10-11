-- MT-5a.nested_view: a view over two views that each read only one of quality and integrity.
create table quality.mt_5a_score (session_id uuid, points int);
create table integrity.mt_5a_signal (session_id uuid, band text);
create view public.mt_5a_scores with (security_invoker = true) as
select s.session_id, s.points from quality.mt_5a_score as s;
create view public.mt_5a_signals with (security_invoker = true) as
select g.session_id, g.band from integrity.mt_5a_signal as g;
create view public.mt_5a_blend with (security_invoker = true) as
select s.session_id, s.points, g.band
from public.mt_5a_scores as s
join public.mt_5a_signals as g on g.session_id = s.session_id;
