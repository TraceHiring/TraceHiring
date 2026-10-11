-- MT-5a.system_schema_view: a view in _realtime, a system-list schema where postgres can create objects, that joins
-- a quality table and an integrity table. The view is owned by a role that postgres created, so postgres holds
-- ADMIN OPTION on it without INHERIT or SET (PostgreSQL 16+): postgres is a MEMBER of the owner, not able to SET
-- ROLE to it. postgres grants itself SET only long enough to create the view, then revokes that grant.
create table quality.mt_5a_score (session_id uuid, points int);
create table integrity.mt_5a_signal (session_id uuid, band text);
create role mt_5a_owner nologin;
grant mt_5a_owner to postgres with inherit false, set true;
grant create on schema _realtime to mt_5a_owner;
grant usage on schema quality, integrity to mt_5a_owner;
set role mt_5a_owner;
create view _realtime.mt_5a_blend with (security_invoker = true) as
select s.session_id, s.points, g.band
from quality.mt_5a_score as s
join integrity.mt_5a_signal as g on g.session_id = s.session_id;
reset role;
revoke mt_5a_owner from postgres;
