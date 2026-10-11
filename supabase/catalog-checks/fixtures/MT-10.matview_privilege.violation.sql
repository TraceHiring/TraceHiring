-- MT-10.matview_privilege: a materialized view outside public that authenticated can read.
create table private.mt_10_item (item_id uuid, title text);
create materialized view private.mt_10_item_count as
select count(*) as items from private.mt_10_item;
grant select on private.mt_10_item_count to authenticated;
