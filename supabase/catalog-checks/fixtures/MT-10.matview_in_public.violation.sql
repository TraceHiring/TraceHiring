-- MT-10.matview_in_public: a materialized view in public, with no privilege for anon or authenticated.
create table public.mt_10_item (item_id uuid, title text);
create materialized view public.mt_10_item_count as
select count(*) as items from public.mt_10_item;
