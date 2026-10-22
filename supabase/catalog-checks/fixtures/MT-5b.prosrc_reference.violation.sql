-- MT-5b.prosrc_reference: a plpgsql function that reads a quality table and an integrity table in its body.
-- plpgsql bodies are not in pg_depend, so only prosrc shows it.
create table quality.mt_5b_score (session_id uuid, points int);
create table integrity.mt_5b_signal (session_id uuid, band text);
create function public.mt_5b_blend(p_session uuid) returns text
language plpgsql
stable
as $$
begin
  return (
    select s.points::text || g.band
    from quality.mt_5b_score as s
    join integrity.mt_5b_signal as g on g.session_id = s.session_id
    where s.session_id = p_session
  );
end
$$;
