-- MT-5b.begin_atomic_depend: a SQL function with a BEGIN ATOMIC body (two statements, so a ";" inside the body)
-- that reads a quality table and an integrity table. PostgreSQL records both in pg_depend and prosrc is empty.
create table quality.mt_5b_score (session_id uuid, points int);
create table integrity.mt_5b_signal (session_id uuid, band text);
create function public.mt_5b_blend(p_session uuid) returns int
language sql
stable
begin atomic
  select count(*) from integrity.mt_5b_signal as g where g.session_id = p_session;
  select sum(s.points)::int from quality.mt_5b_score as s where s.session_id = p_session;
end;
