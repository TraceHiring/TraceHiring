-- MT-12.global_function_entry_missing: granting EXECUTE on functions back to PUBLIC makes the global row equal
-- the built-in default, so PostgreSQL deletes it.
alter default privileges for role postgres grant execute on functions to public;
