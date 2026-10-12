-- MT-5d.check_constraint: a CHECK constraint on a quality table that calls a plpgsql function reading an integrity
-- table.
create table integrity.mt_5d_signal (session_id uuid, band text);
create function public.mt_5d_unflagged(p_session uuid) returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  return not exists (select 1 from integrity.mt_5d_signal as g where g.session_id = p_session);
end
$$;
create table quality.mt_5d_score (
  session_id uuid,
  points int,
  constraint mt_5d_score_unflagged check (public.mt_5d_unflagged(session_id))
);
