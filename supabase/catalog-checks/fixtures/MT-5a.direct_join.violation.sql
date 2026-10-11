-- MT-5a.direct_join: a view that joins a quality table and an integrity table directly.
create table quality.mt_5a_score (session_id uuid, points int);
create table integrity.mt_5a_signal (session_id uuid, band text);
create view public.mt_5a_blend with (security_invoker = true) as
select s.session_id, s.points, g.band
from quality.mt_5a_score as s
join integrity.mt_5a_signal as g on g.session_id = s.session_id;
