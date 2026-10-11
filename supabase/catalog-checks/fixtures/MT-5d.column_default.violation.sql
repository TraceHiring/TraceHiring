-- MT-5d.column_default: a quality column whose default calls a plpgsql function that reads an integrity table.
create table integrity.mt_5d_signal (session_id uuid, band text);
create function public.mt_5d_flag_count() returns int
language plpgsql
stable
set search_path = ''
as $$
begin
  return (select count(*) from integrity.mt_5d_signal);
end
$$;
create table quality.mt_5d_score (session_id uuid, penalty int default public.mt_5d_flag_count());
