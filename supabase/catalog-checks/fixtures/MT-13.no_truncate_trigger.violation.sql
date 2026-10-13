-- MT-13.no_truncate_trigger: one partition's TRUNCATE trigger dropped (TRUNCATE triggers are not inherited).
drop trigger audit_log_no_truncate on public.audit_log_2026_12;
