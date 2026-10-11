-- MT-10.system_schema_view: a view without security_invoker in _realtime, a system-list schema where postgres can
-- create objects. The view is owned by a role that postgres created, so postgres holds ADMIN OPTION on it without
-- INHERIT or SET (PostgreSQL 16+): postgres is a MEMBER of the owner, not able to SET ROLE to it. postgres grants
-- itself SET only long enough to create the view, then revokes that grant.
create table public.mt_10_item (item_id uuid, title text);
create role mt_10_owner nologin;
grant mt_10_owner to postgres with inherit false, set true;
grant create on schema _realtime to mt_10_owner;
grant usage on schema public to mt_10_owner;
set role mt_10_owner;
create view _realtime.mt_10_item_list as
select i.item_id, i.title from public.mt_10_item as i;
reset role;
revoke mt_10_owner from postgres;
