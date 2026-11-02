-- rls_d1_candidate_denied (spec specs/d1-demo-slice.md 3.6 row "rls_d1_candidate_denied"; 3.2 intro and 3.3 last column
-- "anon/cand"; invariant I-12; decision D1-3 "the candidate never reaches Postgres in D1"; rule 5; AT-D11 first clause).
-- trace_candidate, trace_candidate_gateway and anon hold no privilege of any kind on any object in public, quality,
-- integrity and private: no table or view privilege, no column privilege, no sequence privilege, no EXECUTE on any
-- function, no USAGE/CREATE on quality, integrity or private, and nothing granted to PUBLIC that they could inherit.
-- The scans enumerate the catalogue (every relation and every function in the four schemas), so a table, view or
-- function added later (migration 4 adds private.media_viewer_check, media_link_grant and media_view_grant, EXECUTE to
-- trace_api only) is covered without editing this file. Direct calls prove the denials end to end.
-- Personas: none needed (the subjects are roles). Everything is rolled back.
begin;
-- Helpers live in pg_temp (rolled back with the transaction). try() runs one statement as the current
-- role and returns 'OK <rows>' or '<sqlstate> <message>', so a denial is an assertion, not an abort.
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'OK ' || n;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end
$f$;
grant execute on function pg_temp.try(text) to public;
-- leaks(role, kind) lists, sorted, every privilege the role holds of the given kind on any object in the four D1
-- schemas (empty array = holds nothing). Inheritance is included: has_*_privilege follows role membership and PUBLIC.
--   table    SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on any table, partitioned table, view,
--            materialised view or foreign table
--   column   SELECT/INSERT/UPDATE/REFERENCES on any single column of those
--   sequence USAGE/SELECT/UPDATE on any sequence
--   function EXECUTE on any function, procedure, aggregate or window function (every pg_proc row)
--   schema   USAGE/CREATE on quality, integrity, private, and CREATE on public (USAGE on public is the Postgres
--            default for PUBLIC and is not a data privilege)
create function pg_temp.leaks(p_role text, p_kind text) returns text[] language sql as $f$
  select coalesce(array_agg(q.x order by q.x), '{}'::text[]) from (
    select n.nspname || '.' || c.relname || ':' || p.priv as x
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p(priv)
     where p_kind = 'table' and n.nspname in ('public', 'quality', 'integrity', 'private')
       and c.relkind in ('r', 'p', 'v', 'm', 'f') and has_table_privilege(p_role, c.oid, p.priv)
    union all
    select n.nspname || '.' || c.relname || '.' || a.attname || ':' || p.priv
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute as a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as p(priv)
     where p_kind = 'column' and n.nspname in ('public', 'quality', 'integrity', 'private')
       and c.relkind in ('r', 'p', 'v', 'm', 'f') and has_column_privilege(p_role, c.oid, a.attnum, p.priv)
    union all
    select n.nspname || '.' || c.relname || ':' || p.priv
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) as p(priv)
     where p_kind = 'sequence' and n.nspname in ('public', 'quality', 'integrity', 'private')
       and c.relkind = 'S' and has_sequence_privilege(p_role, c.oid, p.priv)
    union all
    select n.nspname || '.' || pr.proname || '(' || pg_get_function_identity_arguments(pr.oid) || ')'
      from pg_catalog.pg_proc as pr
      join pg_catalog.pg_namespace as n on n.oid = pr.pronamespace
     where p_kind = 'function' and n.nspname in ('public', 'quality', 'integrity', 'private')
       and has_function_privilege(p_role, pr.oid, 'EXECUTE')
    union all
    select n.nspname || ':' || p.priv
      from pg_catalog.pg_namespace as n
      cross join unnest(array['USAGE', 'CREATE']) as p(priv)
     where p_kind = 'schema'
       and ((n.nspname in ('quality', 'integrity', 'private')) or (n.nspname = 'public' and p.priv = 'CREATE'))
       and has_schema_privilege(p_role, n.oid, p.priv)
  ) as q
$f$;
-- public_grants(kind) lists every ACL entry in the four schemas whose grantee is PUBLIC (grantee 0), so a PUBLIC
-- grant that all three roles would inherit is caught even if has_*_privilege were ever bypassed.
create function pg_temp.public_grants(p_kind text) returns text[] language sql as $f$
  select coalesce(array_agg(q.x order by q.x), '{}'::text[]) from (
    select n.nspname || '.' || c.relname || ':' || a.privilege_type as x
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault((case c.relkind when 'S' then 's' else 'r' end)::"char", c.relowner))) as a
     where p_kind = 'relation' and n.nspname in ('public', 'quality', 'integrity', 'private')
       and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and a.grantee = 0
    union all
    select n.nspname || '.' || pr.proname || '(' || pg_get_function_identity_arguments(pr.oid) || ')' || ':' || a.privilege_type
      from pg_catalog.pg_proc as pr
      join pg_catalog.pg_namespace as n on n.oid = pr.pronamespace
      cross join lateral aclexplode(coalesce(pr.proacl, acldefault('f'::"char", pr.proowner))) as a
     where p_kind = 'function' and n.nspname in ('public', 'quality', 'integrity', 'private') and a.grantee = 0
    union all
    select n.nspname || ':' || a.privilege_type
      from pg_catalog.pg_namespace as n
      cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner))) as a
     where p_kind = 'schema' and n.nspname in ('quality', 'integrity', 'private') and a.grantee = 0
  ) as q
$f$;
grant usage on schema extensions to authenticated, anon, service_role;
select plan(36);
grant trace_candidate to postgres with inherit false, set true;
grant usage on schema extensions to trace_candidate;
grant trace_candidate_gateway to postgres with inherit false, set true;
grant usage on schema extensions to trace_candidate_gateway;

-- 1. The subject objects exist (the scans below are not vacuous): the 25 D1 tables of spec 3.2 (19 public, 2 quality, 4 integrity).
select is((select count(*)::int from pg_catalog.pg_class as c join pg_catalog.pg_namespace as n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and (n.nspname, c.relname) in (
  ('public', 'tests'), ('public', 'test_versions'), ('public', 'sections'), ('public', 'item_versions'), ('public', 'item_answer_keys'), ('public', 'rubric_versions'), ('public', 'ruleset_versions'),
  ('public', 'notice_versions'), ('public', 'assignments'), ('public', 'invitations'), ('public', 'consents'), ('public', 'sessions'), ('public', 'session_items'), ('public', 'responses'),
  ('public', 'media_objects'), ('public', 'quality_cards'), ('public', 'integrity_cards'), ('public', 'integrity_timeline_entries'), ('public', 'reports'),
  ('quality', 'scores'), ('quality', 'grader_runs'),
  ('integrity', 'band_rule_versions'), ('integrity', 'signals'), ('integrity', 'flags'), ('integrity', 'results'))), 25, 'subjects: all 25 D1 tables exist, so the scans below are not vacuous');

-- 2. trace_candidate: nothing in any of the four schemas.
select is(pg_temp.leaks('trace_candidate', 'table'), '{}'::text[], 'trace_candidate holds no table or view privilege (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) in public, quality, integrity or private');
select is(pg_temp.leaks('trace_candidate', 'column'), '{}'::text[], 'trace_candidate holds no column privilege in public, quality, integrity or private');
select is(pg_temp.leaks('trace_candidate', 'sequence'), '{}'::text[], 'trace_candidate holds no sequence privilege in the four schemas');
select is(pg_temp.leaks('trace_candidate', 'function'), '{}'::text[], 'trace_candidate holds EXECUTE on no function in the four schemas (every function in private, current and future, included)');
select is(pg_temp.leaks('trace_candidate', 'schema'), '{}'::text[], 'trace_candidate holds no USAGE or CREATE on quality, integrity or private and no CREATE on public');

-- 3. trace_candidate_gateway (NOINHERIT; its only edge is SET into trace_candidate): nothing, directly or through that edge.
select is(pg_temp.leaks('trace_candidate_gateway', 'table'), '{}'::text[], 'gateway holds no table or view privilege in public, quality, integrity or private');
select is(pg_temp.leaks('trace_candidate_gateway', 'column'), '{}'::text[], 'gateway holds no column privilege in public, quality, integrity or private');
select is(pg_temp.leaks('trace_candidate_gateway', 'sequence'), '{}'::text[], 'gateway holds no sequence privilege in the four schemas');
select is(pg_temp.leaks('trace_candidate_gateway', 'function'), '{}'::text[], 'gateway holds EXECUTE on no function in the four schemas');
select is(pg_temp.leaks('trace_candidate_gateway', 'schema'), '{}'::text[], 'gateway holds no USAGE or CREATE on quality, integrity or private and no CREATE on public');

-- 4. anon (PostgREST without a token; D1 has no anonymous access).
select is(pg_temp.leaks('anon', 'table'), '{}'::text[], 'anon holds no table or view privilege in public, quality, integrity or private');
select is(pg_temp.leaks('anon', 'column'), '{}'::text[], 'anon holds no column privilege in public, quality, integrity or private');
select is(pg_temp.leaks('anon', 'sequence'), '{}'::text[], 'anon holds no sequence privilege in the four schemas');
select is(pg_temp.leaks('anon', 'function'), '{}'::text[], 'anon holds EXECUTE on no function in the four schemas');
select is(pg_temp.leaks('anon', 'schema'), '{}'::text[], 'anon holds no USAGE or CREATE on quality, integrity or private and no CREATE on public');

-- 5. Nothing is granted to PUBLIC (which all three roles inherit) on any relation, function or internal schema, and no
-- default privilege of the migration owner would grant anything to PUBLIC, anon or the candidate roles on future objects.
select is(pg_temp.public_grants('relation'), '{}'::text[], 'PUBLIC holds no privilege on any table, view or sequence in the four schemas');
select is(pg_temp.public_grants('function'), '{}'::text[], 'PUBLIC holds no EXECUTE on any function in the four schemas (the default PUBLIC EXECUTE was revoked on every one)');
select is(pg_temp.public_grants('schema'), '{}'::text[], 'PUBLIC holds no privilege on schemas quality, integrity and private');
select is((select coalesce(array_agg(d.defaclnamespace::regnamespace::text || ':' || d.defaclobjtype::text || ':' || a.grantee::regrole::text order by d.defaclnamespace::regnamespace::text), '{}'::text[])
  from pg_catalog.pg_default_acl as d
  cross join lateral aclexplode(d.defaclacl) as a
  where d.defaclrole = 'postgres'::regrole
    and d.defaclnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace, 'private'::regnamespace)
    and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'trace_candidate'::regrole, 'trace_candidate_gateway'::regrole))), '{}'::text[],
  'default ACLs of the owner (postgres) in the four schemas grant nothing to PUBLIC, anon or the candidate roles');

-- 6. Direct calls (rule 5): the denial is a permission error, not an empty result.
set local role trace_candidate;
select matches(pg_temp.try('select * from public.sessions'), '^42501 permission denied', 'trace_candidate cannot read sessions');
select matches(pg_temp.try('select * from public.quality_cards'), '^42501 permission denied', 'trace_candidate cannot read quality_cards (no score of its own or anyone else''s)');
select matches(pg_temp.try('select * from public.integrity_cards'), '^42501 permission denied', 'trace_candidate cannot read integrity_cards (no band, no flag)');
select matches(pg_temp.try('insert into public.consents default values'), '^42501 permission denied', 'trace_candidate cannot write consents (the api writes it as trace_api)');
select matches(pg_temp.try('select * from quality.scores'), '^42501 permission denied for schema quality', 'trace_candidate cannot reach schema quality');
select matches(pg_temp.try($$select private.resolve_invitation_by_hash(repeat('a', 64))$$), '^42501 permission denied for schema private', 'trace_candidate cannot call the token-hash lookup (only trace_api can)');
reset role;
set local role trace_candidate_gateway;
select matches(pg_temp.try('select * from public.invitations'), '^42501 permission denied', 'gateway cannot read invitations');
select matches(pg_temp.try('select * from integrity.results'), '^42501 permission denied for schema integrity', 'gateway cannot reach schema integrity');
select matches(pg_temp.try($$select private.mirror_session(gen_random_uuid(), '{}'::jsonb)$$), '^42501 permission denied for schema private', 'gateway cannot call the session mirror (trace_worker only)');
reset role;
set local role anon;
select matches(pg_temp.try('select * from public.media_objects'), '^42501 permission denied', 'anon cannot read media_objects (no media metadata, no keys)');
select matches(pg_temp.try('truncate public.reports'), '^42501 permission denied', 'anon cannot truncate reports');
select matches(pg_temp.try('select * from integrity.flags'), '^42501 permission denied for schema integrity', 'anon cannot reach schema integrity');
select matches(pg_temp.try('select private.api_org_id()'), '^42501 permission denied for schema private', 'anon cannot call private.api_org_id');
reset role;

-- 7. Controls: the scans catch a leak, and the gateway does not inherit it (grants are rolled back with the transaction).
grant select on public.sessions to trace_candidate;
grant execute on function private.sweep_pending(integer) to trace_candidate;
select is(pg_temp.leaks('trace_candidate', 'table'), array['public.sessions:SELECT'], 'control: a SELECT granted to trace_candidate shows up in the table scan');
select is(pg_temp.leaks('trace_candidate', 'function'), array['private.sweep_pending(p_limit integer)'], 'control: an EXECUTE granted to trace_candidate shows up in the function scan');
select is(pg_temp.leaks('trace_candidate_gateway', 'table') || pg_temp.leaks('trace_candidate_gateway', 'function'), '{}'::text[], 'control: the gateway still holds nothing (its edge to trace_candidate is SET only, no inherit)');

select * from finish();
rollback;
