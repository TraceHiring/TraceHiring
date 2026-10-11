-- MT-10.system_schema_view: a view without security_invoker in _realtime, a system-list schema where postgres can
-- create objects.
create table public.mt_10_item (item_id uuid, title text);
create view _realtime.mt_10_item_list as
select i.item_id, i.title from public.mt_10_item as i;
