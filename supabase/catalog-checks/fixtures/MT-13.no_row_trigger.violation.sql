-- MT-13.no_row_trigger: the parent's row trigger (cloned to every partition) dropped and replaced by two that do not
-- guard every UPDATE or DELETE (B0-DB4): one with WHEN (false), one limited to UPDATE OF a column. Neither counts.
drop trigger audit_log_no_update_delete on public.audit_log;
create trigger mt_13_when_false before update or delete on public.audit_log
  for each row when (false) execute function private.audit_log_append_only();
create trigger mt_13_update_of before update of details or delete on public.audit_log
  for each row execute function private.audit_log_append_only();
