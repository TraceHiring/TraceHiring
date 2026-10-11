-- MT-12.global_entry_grant: a global function row that grants EXECUTE to PUBLIC. Revoking the owner's own
-- EXECUTE keeps the row different from the built-in default, so PostgreSQL keeps it as {=X/postgres}.
alter default privileges for role postgres grant execute on functions to public;
alter default privileges for role postgres revoke execute on functions from postgres;
