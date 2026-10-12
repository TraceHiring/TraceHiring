-- MT-5d.trigger_function: a trigger on a quality table whose plpgsql function writes to an integrity table.
create table quality.mt_5d_score (session_id uuid, points int);
create table integrity.mt_5d_signal (session_id uuid, band text);
create function public.mt_5d_copy_band() returns trigger
language plpgsql
as $$
begin
  insert into integrity.mt_5d_signal (session_id, band) values (new.session_id, 'none');
  return new;
end
$$;
create trigger mt_5d_after_score
after insert on quality.mt_5d_score
for each row execute function public.mt_5d_copy_band();
