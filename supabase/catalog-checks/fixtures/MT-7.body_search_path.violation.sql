-- MT-7.body_search_path: a plpgsql function in private whose body runs SET LOCAL search_path = quality, so the
-- unqualified table name after it resolves to a quality table that no schema name in the text shows. The function
-- is not SECURITY DEFINER and keeps set search_path = '' as a function setting, so only body_search_path fires.
create table quality.mt_7_score (session_id uuid, points int);
create function private.mt_7_zero() returns void
language plpgsql
set search_path = ''
as $$
begin
  set local search_path = quality;
  update mt_7_score set points = 0;
end
$$;
