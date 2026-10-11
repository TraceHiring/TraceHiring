-- MT-4.anon_function: anon is granted EXECUTE on an in-scope function.
create function public.mt_4_fn() returns integer language sql as 'select 1';
grant execute on function public.mt_4_fn() to anon;
