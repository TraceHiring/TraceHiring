-- M0a baseline (spec specs/m0-foundations.md §8.2). Schema and privilege lockdown only: no tables.
-- Every later migration follows the §8.2 rules; database-reviewer enforces them and the catalog
-- checks in supabase/catalog-checks/ cover them where a query can.

-- Reserved schemas, so boundaries and catalog checks exist before any table does (build-notes Q12).
create schema if not exists private;   -- SECURITY DEFINER helpers (M0b); never exposed through PostgREST
create schema if not exists quality;   -- Answer Quality (M5)
create schema if not exists integrity; -- Integrity Signals (M4)
revoke all on schema private, quality, integrity from public, anon, authenticated, service_role;
revoke create on schema public from public, anon, authenticated, service_role;

-- Functions: remove the built-in global EXECUTE-to-PUBLIC default.
-- A per-schema revoke cannot do this (PostgreSQL ALTER DEFAULT PRIVILEGES semantics).
alter default privileges for role postgres revoke execute on functions from public;

-- Remove Supabase's per-schema defaults: from M0b on, every grant is explicit, including to service_role.
alter default privileges for role postgres in schema public, private, quality, integrity
  revoke all on tables    from anon, authenticated, service_role;
alter default privileges for role postgres in schema public, private, quality, integrity
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public, private, quality, integrity
  revoke execute on functions from anon, authenticated, service_role;
