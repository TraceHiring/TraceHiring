-- MT-13.not_always: an append-only trigger set back to ordinary mode, which replica mode would skip.
alter table public.audit_log_2027_01 enable trigger audit_log_no_truncate;
