-- MT-10.view_without_security_invoker: a view created without security_invoker, so it runs with its owner's
-- rights and bypasses RLS.
create table public.mt_10_item (item_id uuid, title text);
create view public.mt_10_item_list as
select i.item_id, i.title from public.mt_10_item as i;
