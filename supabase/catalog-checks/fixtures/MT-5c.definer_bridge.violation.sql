-- MT-5c.definer_bridge: a role that may read a quality table and may execute an MT-7-compliant SECURITY DEFINER
-- function in private that reads an integrity table, so it reads both schemas.
create role mt_5c_bridge nologin;
create table quality.mt_5c_score (session_id uuid, points int);
create table integrity.mt_5c_signal (session_id uuid, band text);
grant select on quality.mt_5c_score to mt_5c_bridge;
create function private.mt_5c_band(p_session uuid) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (select g.band from integrity.mt_5c_signal as g where g.session_id = p_session);
end
$$;
revoke execute on function private.mt_5c_band(uuid) from public;
grant execute on function private.mt_5c_band(uuid) to mt_5c_bridge;
