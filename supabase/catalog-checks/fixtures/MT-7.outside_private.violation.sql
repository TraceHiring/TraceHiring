-- MT-7.outside_private: a SECURITY DEFINER function with a correct empty search_path, but in public instead of private.
create function public.mt_7_rpc() returns integer language sql security definer set search_path = '' as 'select 1';
