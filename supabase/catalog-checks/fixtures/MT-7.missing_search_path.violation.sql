-- MT-7.missing_search_path: a SECURITY DEFINER function in private without set search_path = ''.
create function private.mt_7_no_path() returns integer language sql security definer as 'select 1';
