-- MT-5d.index_expression: an expression index on a quality table over a function (marked immutable, which
-- PostgreSQL does not verify) that reads an integrity table.
create table integrity.mt_5d_signal (session_id uuid, band text);
create function public.mt_5d_band_of(p_session uuid) returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  return (select g.band from integrity.mt_5d_signal as g where g.session_id = p_session);
end
$$;
create table quality.mt_5d_score (session_id uuid, points int);
create index mt_5d_score_band on quality.mt_5d_score (public.mt_5d_band_of(session_id));
