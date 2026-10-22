-- MT-5d.trigger_call_chain: a trigger on an integrity table whose function calls, by an unqualified name resolved
-- through its search_path, a function that writes a quality table. The trigger function's body names neither
-- schema.
create table quality.mt_5d_score (session_id uuid, points int);
create table integrity.mt_5d_signal (session_id uuid, confirmed boolean);
create function public.mt_5d_zero(p_session uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  update quality.mt_5d_score set points = 0 where session_id = p_session;
end
$$;
create function public.mt_5d_on_signal() returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform mt_5d_zero(new.session_id);
  return new;
end
$$;
create trigger mt_5d_after_signal
after update on integrity.mt_5d_signal
for each row execute function public.mt_5d_on_signal();
