-- MT-5b.system_schema_function: a plpgsql function in _realtime, a system-list schema where postgres can create
-- objects, that reads a quality table and an integrity table.
create table quality.mt_5b_score (session_id uuid, points int);
create table integrity.mt_5b_signal (session_id uuid, band text);
create function _realtime.mt_5b_blend(p_session uuid) returns text
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
