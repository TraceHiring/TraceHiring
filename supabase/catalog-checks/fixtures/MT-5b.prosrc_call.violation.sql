-- MT-5b.prosrc_call: a plpgsql function that reads a quality table and calls, by its qualified name, another
-- plpgsql function that reads an integrity table. Neither body names both schemas, and plpgsql calls are not in
-- pg_depend, so only the call named in the body links them.
create table quality.mt_5b_score (session_id uuid, points int);
create table integrity.mt_5b_signal (session_id uuid, band text);
create function public.mt_5b_band(p_session uuid) returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  return (select g.band from integrity.mt_5b_signal as g where g.session_id = p_session);
end
$$;
create function public.mt_5b_blend(p_session uuid) returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  return (
    select s.points::text || public.mt_5b_band(s.session_id)
    from quality.mt_5b_score as s
    where s.session_id = p_session
  );
end
$$;
