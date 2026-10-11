-- MT-9.extension_in_scope: an extension installed in schema private. seg (floating-point intervals) is one Trace will
-- never install, so this cannot fail with "already exists". supautils lets postgres create it.
create extension seg with schema private;
