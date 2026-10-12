-- MT-5b.proconfig_search_path: a plpgsql function whose body names no schema but whose search_path lists both
-- quality and integrity, so unqualified names resolve into both.
create table quality.mt_5b_score (session_id uuid, points int);
create table integrity.mt_5b_signal (session_id uuid, band text);
create function public.mt_5b_blend(p_session uuid) returns text
language plpgsql
stable
set search_path = pg_catalog, quality, integrity
as $$
begin
  return (
    select s.points::text || g.band
    from mt_5b_score as s
    join mt_5b_signal as g on g.session_id = s.session_id
    where s.session_id = p_session
  );
end
$$;
