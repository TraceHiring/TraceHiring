-- MT-5a.via_operator: a view over quality that filters with an operator whose function reads an integrity table.
-- pg_depend records the operator, not its function. Operator names cannot carry the mt_5a_ prefix, so the
-- operator lives in its own mt_5a_ops schema.
create table quality.mt_5a_score (session_id uuid, points int);
create table integrity.mt_5a_signal (session_id uuid, band text);
create function public.mt_5a_flagged(p_points int, p_floor int) returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  return p_points >= p_floor and exists (select 1 from integrity.mt_5a_signal);
end
$$;
create schema mt_5a_ops;
create operator mt_5a_ops.#~# (leftarg = int, rightarg = int, function = public.mt_5a_flagged);
create view public.mt_5a_flagged_scores with (security_invoker = true) as
select s.session_id, s.points
from quality.mt_5a_score as s
where s.points operator(mt_5a_ops.#~#) 0;
