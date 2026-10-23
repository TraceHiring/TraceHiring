-- MT-4b (spec specs/m0-foundations.md §8.5): proves the baseline default ACLs now, not only when the first
-- table appears. Inside this rolled-back transaction a throwaway table, sequence and function is created as
-- postgres in each of the four in-scope schemas. Each assertion also reports any probe object that is missing,
-- so it can never pass vacuously. Hand-written; not generated.
-- Assertions 5 to 16 are MT-11 controls (W3b database review finding 7, catalog pass C review E2, M0b review
-- M0B-DB-2 and its re-review, D1 helpers, M0b FR-1 in M1), 17 to 19 prove, one dynamic-SQL shape at a time, what
-- MT-5b counts as naming a schema, and 20 proves what MT-7 counts as changing the search path (catalog pass C
-- review E1). See below.
begin;
select plan(20);

create table public.mt_4b_t (id int);
create table private.mt_4b_t (id int);
create table quality.mt_4b_t (id int);
create table integrity.mt_4b_t (id int);
create sequence public.mt_4b_s;
create sequence private.mt_4b_s;
create sequence quality.mt_4b_s;
create sequence integrity.mt_4b_s;
create function public.mt_4b_f() returns int language sql as 'select 1';
create function private.mt_4b_f() returns int language sql as 'select 1';
create function quality.mt_4b_f() returns int language sql as 'select 1';
create function integrity.mt_4b_f() returns int language sql as 'select 1';

select is_empty(
  $q$
  select 'missing table' as problem, s.nspname as object
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  where to_regclass(format('%I.mt_4b_t', s.nspname)) is null
  union all
  select r.rolname || ' has a table privilege', format('%I.mt_4b_t', s.nspname)
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  cross join unnest(array['anon', 'authenticated', 'service_role']) as r(rolname)
  where to_regclass(format('%I.mt_4b_t', s.nspname)) is not null
    and (
      has_table_privilege(r.rolname, to_regclass(format('%I.mt_4b_t', s.nspname)),
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
      or has_any_column_privilege(r.rolname, to_regclass(format('%I.mt_4b_t', s.nspname)),
        'SELECT, INSERT, UPDATE, REFERENCES')
    )
  $q$,
  'MT-4b: anon, authenticated and service_role get no privilege on a new table in any in-scope schema'
);

select is_empty(
  $q$
  select 'missing sequence' as problem, s.nspname as object
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  where to_regclass(format('%I.mt_4b_s', s.nspname)) is null
  union all
  select r.rolname || ' has a sequence privilege', format('%I.mt_4b_s', s.nspname)
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  cross join unnest(array['anon', 'authenticated', 'service_role']) as r(rolname)
  where to_regclass(format('%I.mt_4b_s', s.nspname)) is not null
    and has_sequence_privilege(r.rolname, to_regclass(format('%I.mt_4b_s', s.nspname)), 'USAGE, SELECT, UPDATE')
  $q$,
  'MT-4b: anon, authenticated and service_role get no privilege on a new sequence in any in-scope schema'
);

select is_empty(
  $q$
  select 'missing function' as problem, s.nspname as object
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  where to_regprocedure(format('%I.mt_4b_f()', s.nspname)) is null
  union all
  select r.rolname || ' can execute', format('%I.mt_4b_f()', s.nspname)
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  cross join unnest(array['anon', 'authenticated', 'service_role']) as r(rolname)
  where to_regprocedure(format('%I.mt_4b_f()', s.nspname)) is not null
    and has_function_privilege(r.rolname, to_regprocedure(format('%I.mt_4b_f()', s.nspname)), 'EXECUTE')
  $q$,
  'MT-4b: anon, authenticated and service_role cannot execute a new function in any in-scope schema'
);

select is_empty(
  $q$
  select 'missing function' as problem, s.nspname as object
  from unnest(array['public', 'private', 'quality', 'integrity']) as s(nspname)
  where to_regprocedure(format('%I.mt_4b_f()', s.nspname)) is null
  union all
  select 'PUBLIC can execute', p.oid::regprocedure::text
  from pg_proc as p
  where p.proname = 'mt_4b_f'
    and p.pronamespace::regnamespace::text in ('public', 'private', 'quality', 'integrity')
    and exists (
      select 1
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    )
  $q$,
  'MT-4b: PUBLIC has no EXECUTE on a new function in any in-scope schema'
);

-- MT-11 negative controls. The generator has no negative-control mechanism, so the query between the "MT-11 copy"
-- lines is a verbatim copy of supabase/catalog-checks/MT-11.sql: keep the two identical. It is created once, as a
-- temporary view, and the three assertions below read it. The savepoint is rolled back right after them.
-- W3b database review finding 7: auth.jwt() wrapped in a scalar sub-select together with a cast,
-- (select (auth.jwt() ->> 'org_id')::uuid), is the compliant form, so MT-11 must return no row for
-- mt_11_note_select. That policy is per-operation, names a role and compares a column of its table, so only the
-- auth.jwt() form is under test. auth.jwt() exists on the local stack and on hosted Supabase.
-- Catalog pass C review E2: a RESTRICTIVE policy only narrows what the permissive policies allow, so a clause that
-- only checks the caller's session, here Supabase's MFA pattern (select auth.jwt() ->> 'aal') = 'aal2', gives no row
-- for mt_11_note_aal2. The same clause in a PERMISSIVE policy (mt_11_note_aal2_open) lets every logged-in user of
-- every org in, so it still hits auth_only_clause.
savepoint mt_11_negative;
create table public.mt_11_note (org_id uuid not null, owner_id uuid, body text);
alter table public.mt_11_note enable row level security;
create policy mt_11_note_select on public.mt_11_note
for select
to authenticated
using (org_id = (select (auth.jwt() ->> 'org_id')::uuid));
create policy mt_11_note_aal2 on public.mt_11_note
as restrictive
for select
to authenticated
using ((select auth.jwt() ->> 'aal') = 'aal2');
create policy mt_11_note_aal2_open on public.mt_11_note
as permissive
for select
to authenticated
using ((select auth.jwt() ->> 'aal') = 'aal2');
-- M0a review DB-1 (M0b): a soft-delete clause names a column but never the caller. As a RESTRICTIVE policy it only
-- narrows, so mt_11_note_live gives no row; MT-11.no_caller_reference's fixture is the same clause as permissive.
alter table public.mt_11_note add column deleted_at timestamptz;
create policy mt_11_note_live on public.mt_11_note
as restrictive
for select
to authenticated
using (deleted_at is null);
-- M0b review M0B-DB-2: an OR whose arms both depend on the caller, and a soft-delete clause ANDed with an org
-- check, are compliant; neither may hit or_arm_without_caller, caller_only_null_tested or no_caller_reference.
create policy mt_11_note_mine_or_admin on public.mt_11_note
for update
to authenticated
using (
  owner_id = (select auth.uid())
  or org_id = any((select private.my_org_ids('{admin}'::public.org_role[]))::uuid[])
)
with check (
  owner_id = (select auth.uid())
  or org_id = any((select private.my_org_ids('{admin}'::public.org_role[]))::uuid[])
);
-- FIX re-review: private.is_operator depends on the caller too, so an OR arm that calls it is compliant.
create policy mt_11_note_org_or_operator on public.mt_11_note
for insert
to authenticated
with check (
  org_id = any((select private.my_org_ids('{admin}'::public.org_role[]))::uuid[])
  or (select private.is_operator())
);
-- FR-1 (FIX re-review): a caller call bound to a column through a correlated EXISTS or an IN sub-select is
-- compliant; only a call compared to constants is not.
create policy mt_11_note_member_exists on public.mt_11_note
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships as m
    where m.org_id = mt_11_note.org_id
      and m.user_id = (select auth.uid())
  )
);
create policy mt_11_note_org_in on public.mt_11_note
for select
to authenticated
using (org_id in (select unnest((select private.my_org_ids('{admin}'::public.org_role[])))));
-- FR-1 re-review: IS NOT DISTINCT FROM, a row compare and an EXISTS over the caller's org list are bound too.
create policy mt_11_note_not_distinct on public.mt_11_note
for update
to authenticated
using (owner_id is not distinct from (select auth.uid()))
with check (owner_id is not distinct from (select auth.uid()));
create policy mt_11_note_row_compare on public.mt_11_note
for delete
to authenticated
using ((org_id, owner_id) = ((select (auth.jwt() ->> 'org_id')::uuid), (select auth.uid())));
create policy mt_11_note_exists_unnest on public.mt_11_note
for insert
to authenticated
with check (
  exists (
    select 1
    from unnest((select private.my_org_ids('{admin}'::public.org_role[]))) as o (id)
    where o.id = mt_11_note.org_id
  )
);
create policy mt_11_note_scoped_live on public.mt_11_note
for delete
to authenticated
using (deleted_at is null and org_id = any((select private.my_org_ids('{admin}'::public.org_role[]))::uuid[]));
-- D1 (spec specs/d1-demo-slice.md §3.5): job_org_id, api_org_id and my_assigned_test_ids are caller helpers, so a
-- policy that binds one of them to a column is compliant; one that only tests a helper for null is not.
create policy mt_11_note_job_org on public.mt_11_note
for select
to trace_worker
using (org_id = (select private.job_org_id()));
create policy mt_11_note_api_org on public.mt_11_note
for select
to trace_api
using (org_id = (select private.api_org_id()));
create policy mt_11_note_assigned on public.mt_11_note
for select
to authenticated
using (owner_id = any((select private.my_assigned_test_ids('{reviewer}'::public.org_role[]))::uuid[]));
create policy mt_11_note_job_org_open on public.mt_11_note
for update
to trace_worker
using ((select private.job_org_id()) is not null)
with check ((select private.job_org_id()) is not null);
-- M0b FR-1 (M1 Wave 0): a caller call counts only when the innermost comparison around it (or the sub-select it
-- feeds) also reads a column of the policy's table, and the clause is followed through AND, OR, NOT, CASE and
-- COALESCE. The shapes below must each hit the named branch; the fixtures cover one shape per new branch.
alter table public.mt_11_note add column status text;
alter table public.mt_11_note add column test_id uuid;
alter table public.mt_11_note add column user_id uuid;
alter table public.mt_11_note add column workspace_id uuid;
create policy mt_11_note_uid_self on public.mt_11_note
for select
to authenticated
using (deleted_at is null and (select auth.uid()) = (select auth.uid()));
create policy mt_11_note_not_and on public.mt_11_note
for select
to authenticated
using (not (deleted_at is not null and owner_id = (select auth.uid())));
create policy mt_11_note_in_const on public.mt_11_note
for select
to authenticated
using (
  org_id in (select m.org_id from public.memberships as m where (select auth.jwt() ->> 'role') = 'authenticated')
);
create policy mt_11_note_in_other on public.mt_11_note
for select
to authenticated
using (deleted_at is null and (select auth.uid()) in (select m.user_id from public.memberships as m));
create policy mt_11_note_case_uid on public.mt_11_note
for select
to authenticated
using (case when owner_id = (select auth.uid()) then true else deleted_at is null end);
create policy mt_11_note_coalesce_uid on public.mt_11_note
for select
to authenticated
using (coalesce(owner_id = (select auth.uid()), true));
create policy mt_11_note_nested_or_uid on public.mt_11_note
for select
to authenticated
using (status = 'draft' and (owner_id = (select auth.uid()) or deleted_at is null));
-- ... and these compliant shapes must give no row.
create policy mt_11_note_org_admin on public.mt_11_note
for select
to authenticated
using (org_id = any((select private.my_org_ids('{admin}'::public.org_role[]))::uuid[]));
create policy mt_11_note_user on public.mt_11_note
for select
to authenticated
using (user_id = (select auth.uid()));
create policy mt_11_note_ws_draft on public.mt_11_note
for select
to authenticated
using (
  workspace_id = any((select private.my_workspace_ids('{org_owner,admin,recruiter}'::public.org_role[]))::uuid[])
  and status = 'draft'
);
create policy mt_11_note_case_closed on public.mt_11_note
for select
to authenticated
using (case when owner_id = (select auth.uid()) then deleted_at is null else false end);
create policy mt_11_note_case_no_else on public.mt_11_note
for select
to authenticated
using (case when owner_id = (select auth.uid()) then true end);
create policy mt_11_note_coalesce_false on public.mt_11_note
for select
to authenticated
using (coalesce(owner_id = (select auth.uid()), false));
create policy mt_11_note_nested_or_bound on public.mt_11_note
for select
to authenticated
using (
  deleted_at is null
  and (owner_id = (select auth.uid()) or org_id = any((select private.my_org_ids('{admin}'::public.org_role[]))::uuid[]))
);
create policy mt_11_note_not_or on public.mt_11_note
for select
to authenticated
using (not (deleted_at is not null or owner_id is distinct from (select auth.uid())));
create policy mt_11_note_uid_in_correlated on public.mt_11_note
for select
to authenticated
using ((select auth.uid()) in (select m.user_id from public.memberships as m where m.org_id = mt_11_note.org_id));
create policy mt_11_note_in_nested on public.mt_11_note
for select
to authenticated
using (
  test_id in (
    select t.id
    from public.tests as t
    where t.workspace_id in (select m.workspace_id from public.memberships as m where m.user_id = (select auth.uid()))
  )
);
create policy mt_11_note_caller_roles on public.mt_11_note
for select
to authenticated
using ('admin'::public.org_role = any((select private.caller_roles(org_id))::public.org_role[]));
create policy mt_11_note_job_coalesce_false on public.mt_11_note
for select
to trace_worker
using (coalesce(org_id = (select private.job_org_id()), false) and deleted_at is null);
create temp view mt_11_run as
-- MT-11 copy begin
-- MT-11 (spec specs/m0-foundations.md §8.5, separate per-operation policies, CLAUDE.md): a policy on an in-scope
-- table that is:
--   for_all: FOR ALL (polcmd *).
--   insert_without_check: an INSERT policy without WITH CHECK.
--   update_missing_clause: an UPDATE policy without USING or without WITH CHECK.
--   select_delete_without_using: a SELECT or DELETE policy without USING.
--   public_role: applied to PUBLIC (0 in polroles, which is what a policy with no TO clause gets).
--   literal_true: USING or WITH CHECK is literally true, on a table that is not on the reference list below.
--   auth_call_unwrapped: USING or WITH CHECK calls auth.uid() or auth.jwt() (a FUNCEXPR node in the stored node
--     tree, polqual or polwithcheck) that does not sit inside a scalar sub-select (an EXPR_SUBLINK node,
--     subLinkType 4), so the call runs per row. (select (auth.jwt() ->> 'org_id')::uuid) is compliant.
--   qual_without_column: a USING or WITH CHECK that is not literally true (that is literal_true) and, in its node
--     tree, refers to no column of the policy's table (a VAR whose varlevelsup equals the number of QUERY nodes
--     around it), calls no function in schema private and none in schema auth (a function, operator function,
--     aggregate or window function), such as 1 = 1, not false or now() < '2030-01-01', on a table that is not on
--     the reference list below.
--   auth_only_clause: the same, except that the clause calls a function in schema auth, such as
--     (select auth.uid()) is not null or auth.role() = 'authenticated'. It only checks that the caller is logged
--     in, so every logged-in user of every org passes. A clause without a column that calls a function in private
--     (matched by schema name) is not reported by these two branches. It still has to call a caller-dependent
--     helper (the allow-list below), or no_caller_reference reports it.
--     Neither qual_without_column nor auth_only_clause looks at a RESTRICTIVE policy (as restrictive), which only
--     narrows what the permissive policies allow: Supabase's MFA pattern, as restrictive for select to
--     authenticated using ((select auth.jwt() ->> 'aal') = 'aal2'), is compliant.
--   no_caller_reference (M0b, M0a review DB-1, M0b review M0B-DB-2): a USING or WITH CHECK of a PERMISSIVE policy
--     that refers to a column of its table or calls a function in private, but calls none of the caller-dependent
--     helpers (the allow-list in helper_function: auth.uid, auth.jwt, private.my_org_ids, private.my_workspace_ids,
--     private.caller_roles, private.is_operator), on a table that is not on the reference list, such as the
--     soft-delete clause using (deleted_at is null) or deleted_at is null or (select private.valid_roles(...)). It
--     never depends on who is asking, so it ORs open every org's rows. The same clause in a RESTRICTIVE policy only
--     narrows and passes.
--   or_arm_without_caller (M0b review M0B-DB-2): the same kind of clause calls a caller-dependent helper, but its
--     root is an OR with an arm (followed through nested ORs) that has no bound caller-dependent call (see
--     tree_call.bound) outside an IS [NOT] NULL test, such as deleted_at is null or (select auth.uid()) is not
--     null: that arm alone lets every signed-in user of every org through.
--   caller_only_null_tested (M0b review M0B-DB-2): the same, with no OR at the root: every caller-dependent call
--     sits inside an IS [NOT] NULL test, such as deleted_at is null and (select auth.uid()) is not null, which only
--     asks whether someone is signed in.
--   caller_unbound (M0b FIX re-review FR-1): the same, with no OR at the root, but some caller call is outside a
--     null test and none is bound to a column: deleted_at is null and (select auth.jwt() ->> 'role') =
--     'authenticated', or (select auth.uid()) = (select auth.uid()). Still not followed (the check is a net, and
--     each table's rls_* tests, allowed and denied cases per role, remain the proof): an OR below an AND, a NOT, a
--     CASE or a COALESCE whose caller call is bound in one branch only, such as
--     coalesce(owner_id = (select auth.uid()), true).
--   system_list_policy (M0b, M0a catalog pass C review E3): any policy on any relation in a system-list schema,
--     whoever owns the relation (supautils lets postgres create policies on auth, storage and realtime tables).
--     Trace uses R2 and Durable Objects, not Supabase Storage or Realtime, and adds no policy there.
-- In-scope tables: every relation in public, private, quality and integrity, every relation whose owner postgres
-- is a member of in a system-list schema where a migration can still create objects (escape_schema below),
-- and every pg_inherits descendant of those (INHERITS children and partitions, recursively, wherever they live).
-- Extension members are skipped by the README rule. A policy that breaks a rule above on a table outside the four
-- schemas is reported under one branch for where the table lives, with the rule in the detail:
--   system_schema_policy: the table is in a system-list schema.
--   inherited_table_policy: the table is a descendant in any other schema.
with recursive
reference_table (schema_name, table_name, adr) as (
  values
    -- One row per reference table whose policies may be literally true, each citing its ADR, e.g.
    -- ('public', 'countries', 'ADR-0NN reference data'),
    -- The null row below only types the columns and is ignored.
    (null::name, null::name, null::text),
    -- M0b (spec specs/m0b-tenancy.md §3.8, D6): worker-only table, policies for trace_worker only.
    ('public', 'idempotency_keys', 'ADR-029 worker-only ledger, no app role has a grant')
),
scope_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in ('public', 'private', 'quality', 'integrity')
),
-- shared:escape begin (the same text in MT-5a, MT-5b, MT-5d, MT-10 and MT-11)
-- escape_schema: system-list schemas where a migration can still create objects (spec §8.5 revision 12): postgres
-- is a member (INHERIT, SET or ADMIN) of the schema owner or of a role with CREATE on it. An ADMIN-only member can
-- grant itself SET. Locally: extensions, _realtime, supabase_functions and supabase_migrations, plus any listed
-- schema that a migration creates (cron, net and so on).
escape_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in (
      'auth', 'storage', 'extensions', 'realtime', '_realtime', 'graphql', 'graphql_public', 'supabase_functions',
      'supabase_migrations', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics'
    )
    and (
      pg_has_role('postgres', n.nspowner, 'MEMBER')
      or exists (
        select 1
        from pg_roles as r
        where pg_has_role('postgres', r.oid, 'MEMBER')
          and has_schema_privilege(r.oid, n.oid, 'CREATE')
      )
    )
),
-- shared:escape end
scope_rel (oid) as (
  select c.oid
  from pg_class as c
  where c.relnamespace in (select s.oid from scope_schema as s)
  union
  select c.oid
  from pg_class as c
  where c.relnamespace in (select es.oid from escape_schema as es)
    and pg_has_role('postgres', c.relowner, 'MEMBER')
  union
  select i.inhrelid
  from scope_rel as s
  join pg_inherits as i on i.inhparent = s.oid
),
auth_function as (
  select p.oid
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'auth'
    and p.proname in ('uid', 'jwt')
),
-- helper_function: the functions in schemas private and auth, joined by schema name ('private'::regnamespace
-- would raise an error if the schema were missing). caller marks the allow-list of helpers whose result depends
-- on who is asking (M0b review M0B-DB-2): auth.uid, auth.jwt, private.my_org_ids, private.my_workspace_ids,
-- private.caller_roles, private.is_operator (FIX re-review) and, from D1, private.job_org_id, private.api_org_id
-- (per-transaction job/api org context) and private.my_assigned_test_ids. Any other function there, such as auth.role or the
-- immutable private.valid_roles, is not a caller check. A new caller-dependent helper must be added here.
helper_function (oid, nspname, caller, returns_bool) as (
  select
    p.oid,
    n.nspname::text,
    (n.nspname = 'auth' and p.proname in ('uid', 'jwt'))
    or (
      n.nspname = 'private'
      and p.proname in (
        'my_org_ids', 'my_workspace_ids', 'caller_roles', 'is_operator', 'job_org_id', 'api_org_id', 'my_assigned_test_ids'
      )
    ),
    p.prorettype = 'bool'::regtype
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname in ('private', 'auth')
),
scope_policy as (
  select
    pol.oid,
    pol.polcmd,
    pol.polroles,
    pol.polpermissive,
    pol.polqual is not null as has_using,
    pol.polwithcheck is not null as has_check,
    coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') as using_text,
    coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') as check_text,
    n.nspname,
    c.relname,
    format('%I on %I.%I', pol.polname, n.nspname, c.relname)::text as qualified_name,
    case
      when c.relnamespace in (select s.oid from scope_schema as s) then 'scope'
      when c.relnamespace in (select es.oid from escape_schema as es) then 'system'
      else 'inherited'
    end as location
  from pg_policy as pol
  join pg_class as c on c.oid = pol.polrelid
  join scope_rel as s on s.oid = c.oid
  join pg_namespace as n on n.oid = c.relnamespace
  where not exists (
    select 1
    from pg_depend as d
    join pg_extension as x on x.oid = d.refobjid
    where d.classid = 'pg_class'::regclass
      and d.objid = c.oid
      and d.refclassid = 'pg_extension'::regclass
      and d.deptype = 'e'
      and x.extnamespace = c.relnamespace
  )
),
-- policy_tree: each USING and WITH CHECK of a scope policy as its stored node tree, with every backslash-escaped
-- character removed, so every brace left opens or closes a node.
policy_tree (oid, clause, tree) as (
  select pol.oid, 'USING'::text, regexp_replace(pol.polqual::text, '\\.', '', 'g')
  from pg_policy as pol
  where pol.polqual is not null
    and pol.oid in (select sp.oid from scope_policy as sp)
  union all
  select pol.oid, 'WITH CHECK'::text, regexp_replace(pol.polwithcheck::text, '\\.', '', 'g')
  from pg_policy as pol
  where pol.polwithcheck is not null
    and pol.oid in (select sp.oid from scope_policy as sp)
),
-- tree_piece: the tree split before every brace, in order. depth is the nesting level after the piece's brace.
tree_piece (oid, clause, ord, piece, depth) as (
  select
    pt.oid,
    pt.clause,
    x.ord,
    x.piece,
    sum(case left(x.piece, 1) when '{' then 1 when '}' then -1 else 0 end)
      over (partition by pt.oid, pt.clause order by x.ord)
  from policy_tree as pt
  cross join lateral regexp_split_to_table(pt.tree, '(?=[{}])') with ordinality as x(piece, ord)
),
-- tree_node: one row per node ({NODE ...), with end_ord, the piece that closes it. Opens at one level and the closes
-- back from that level alternate, so the n-th of each pair up.
tree_node (oid, clause, ord, piece, end_ord, depth) as (
  select o.oid, o.clause, o.ord, o.piece, c.ord, o.depth
  from (
    select
      p.oid,
      p.clause,
      p.ord,
      p.piece,
      p.depth,
      row_number() over (partition by p.oid, p.clause, p.depth order by p.ord) as rn
    from tree_piece as p
    where left(p.piece, 1) = '{'
  ) as o
  join (
    select
      p.oid,
      p.clause,
      p.ord,
      p.depth + 1 as lvl,
      row_number() over (partition by p.oid, p.clause, p.depth order by p.ord) as rn
    from tree_piece as p
    where left(p.piece, 1) = '}'
  ) as c on c.oid = o.oid and c.clause = o.clause and c.lvl = o.depth and c.rn = o.rn
),
-- tree_call: each function a clause calls (a function, an operator's function, an aggregate or a window function)
-- that is in private or auth, with its schema, its node, whether it depends on the caller and whether it sits
-- inside an IS [NOT] NULL test (a NULLTEST node), which only asks whether there is a caller. bound (FIX re-review
-- FR-1): the helper returns boolean itself (a predicate on the caller, such as private.is_operator), or the call
-- sits inside an operator (OPEXPR, SCALARARRAYOPEXPR, DISTINCTEXPR, NULLIFEXPR, ROWCOMPAREEXPR) or an ANY/IN or
-- row-compare sub-select that also reads a column (any VAR), such as org_id = any((select private.my_org_ids(...))),
-- or inside an EXISTS sub-select correlated to the policy's table (a VAR with varlevelsup > 0). A call compared only
-- to a constant, such as (select auth.jwt() ->> 'role') = 'authenticated', or to itself, is not bound: it does not
-- pick rows. Still missed (owner M1): an IN sub-select that reads a column of another table but compares the caller
-- only to a constant.
tree_call (oid, clause, nspname, ord, caller, null_tested, bound) as (
  select
    fn.oid,
    fn.clause,
    hf.nspname,
    fn.ord,
    hf.caller,
    exists (
      select 1
      from tree_node as t
      where t.oid = fn.oid
        and t.clause = fn.clause
        and t.piece like '{NULLTEST %'
        and t.ord < fn.ord
        and fn.ord < t.end_ord
    ),
    hf.returns_bool
    or exists (
      select 1
      from tree_node as op
      join tree_node as v on v.oid = op.oid
        and v.clause = op.clause
        and v.piece like '{VAR %'
        and op.ord < v.ord
        and v.ord < op.end_ord
      where op.oid = fn.oid
        and op.clause = fn.clause
        and (
          op.piece like '{OPEXPR %'
          or op.piece like '{SCALARARRAYOPEXPR %'
          or op.piece like '{DISTINCTEXPR %'
          or op.piece like '{NULLIFEXPR %'
          or op.piece like '{ROWCOMPAREEXPR %'
          or op.piece like '{SUBLINK :subLinkType 2 %'
          or op.piece like '{SUBLINK :subLinkType 3 %'
          or op.piece like '{SUBLINK :subLinkType 5 %'
          or (
            op.piece like '{SUBLINK :subLinkType 0 %'
            and substring(v.piece from ':varlevelsup ([0-9]+)')::int > 0
          )
        )
        and op.ord < fn.ord
        and fn.ord < op.end_ord
    )
  from tree_node as fn
  join helper_function as hf on hf.oid = coalesce(
      substring(fn.piece from '^\{FUNCEXPR :funcid ([0-9]+) '),
      substring(fn.piece from '^\{[A-Z]+ :opno [0-9]+ :opfuncid ([0-9]+) '),
      substring(fn.piece from '^\{AGGREF :aggfnoid ([0-9]+) '),
      substring(fn.piece from '^\{WINDOWFUNC :winfnoid ([0-9]+) ')
    )::oid
),
-- clause_fact: per USING or WITH CHECK of a scope policy, whether it refers to a column of its table (a VAR whose
-- varlevelsup equals the number of QUERY nodes around it), whether it calls a function in private or in auth,
-- whether it calls a caller-dependent helper, whether its root is an OR, and whether it is open: some arm reached
-- from the root through OR nodes only (the root itself when it is not an OR) has no bound caller-dependent call
-- outside a NULLTEST (tree_call.bound), so that arm alone lets any signed-in user of any org through. An OR below
-- an AND or a NOT is not followed (the catalog checks are a net, and every table's rls_* tests are the proof).
-- calls_unnulled: some caller-dependent call sits outside a NULLTEST.
clause_fact (oid, clause, has_column, calls_private, calls_auth, calls_caller, calls_unnulled, root_is_or, open) as (
  select
    pt.oid,
    pt.clause,
    exists (
      select 1
      from tree_node as v
      where v.oid = pt.oid
        and v.clause = pt.clause
        and v.piece like '{VAR %'
        and substring(v.piece from ':varlevelsup ([0-9]+)')::int = (
          select count(*)
          from tree_node as q
          where q.oid = v.oid
            and q.clause = v.clause
            and q.piece like '{QUERY %'
            and q.ord < v.ord
            and v.ord < q.end_ord
        )
    ),
    exists (select 1 from tree_call as c where c.oid = pt.oid and c.clause = pt.clause and c.nspname = 'private'),
    exists (select 1 from tree_call as c where c.oid = pt.oid and c.clause = pt.clause and c.nspname = 'auth'),
    exists (select 1 from tree_call as c where c.oid = pt.oid and c.clause = pt.clause and c.caller),
    exists (
      select 1
      from tree_call as c
      where c.oid = pt.oid
        and c.clause = pt.clause
        and c.caller
        and not c.null_tested
    ),
    exists (
      select 1
      from tree_node as r
      where r.oid = pt.oid
        and r.clause = pt.clause
        and r.depth = 1
        and r.piece like '{BOOLEXPR :boolop or %'
    ),
    exists (
      select 1
      from tree_node as a
      where a.oid = pt.oid
        and a.clause = pt.clause
        and a.piece not like '{BOOLEXPR :boolop or %'
        and not exists (
          select 1
          from tree_node as up
          where up.oid = a.oid
            and up.clause = a.clause
            and up.ord < a.ord
            and a.ord < up.end_ord
            and up.piece not like '{BOOLEXPR :boolop or %'
        )
        and not exists (
          select 1
          from tree_call as c
          where c.oid = a.oid
            and c.clause = a.clause
            and c.caller
            and not c.null_tested
            and c.bound
            and a.ord <= c.ord
            and c.ord < a.end_ord
        )
    )
  from policy_tree as pt
),
finding (oid, branch, detail) as (
  select
    sp.oid,
    'for_all'::text,
    'policy is FOR ALL, not one policy per operation'::text
  from scope_policy as sp
  where sp.polcmd = '*'
  union all
  select
    sp.oid,
    'insert_without_check'::text,
    'INSERT policy has no WITH CHECK'::text
  from scope_policy as sp
  where sp.polcmd = 'a'
    and not sp.has_check
  union all
  select
    sp.oid,
    'update_missing_clause'::text,
    format(
      'UPDATE policy has no %s',
      case
        when not sp.has_using and not sp.has_check then 'USING and no WITH CHECK'
        when not sp.has_using then 'USING'
        else 'WITH CHECK'
      end
    )::text
  from scope_policy as sp
  where sp.polcmd = 'w'
    and (not sp.has_using or not sp.has_check)
  union all
  select
    sp.oid,
    'select_delete_without_using'::text,
    format('%s policy has no USING', case when sp.polcmd = 'r' then 'SELECT' else 'DELETE' end)::text
  from scope_policy as sp
  where sp.polcmd in ('r', 'd')
    and not sp.has_using
  union all
  select
    sp.oid,
    'public_role'::text,
    'policy applies to PUBLIC'::text
  from scope_policy as sp
  where 0::oid = any(sp.polroles)
  union all
  select
    sp.oid,
    'literal_true'::text,
    'USING or WITH CHECK is literally true'::text
  from scope_policy as sp
  where (sp.using_text = 'true' or sp.check_text = 'true')
    and not exists (
      select 1
      from reference_table as rt
      where rt.schema_name = sp.nspname
        and rt.table_name = sp.relname
        and rt.adr ~ '^ADR-[0-9]+'
    )
  union all
  select
    cf.oid,
    case
      when not cf.has_column and not cf.calls_private and cf.calls_auth then 'auth_only_clause'
      when not cf.has_column and not cf.calls_private then 'qual_without_column'
      when not cf.calls_caller then 'no_caller_reference'
      when cf.root_is_or then 'or_arm_without_caller'
      when not cf.calls_unnulled then 'caller_only_null_tested'
      else 'caller_unbound'
    end::text,
    case
      when not cf.has_column and not cf.calls_private and cf.calls_auth then format(
        '%s refers to no column of its table and calls no function in private, only auth functions',
        cf.clause
      )
      when not cf.has_column and not cf.calls_private then format(
        '%s refers to no column of its table and calls no function in private or auth',
        cf.clause
      )
      when not cf.calls_caller then format(
        '%s calls no caller-dependent helper such as auth.uid or private.my_org_ids, so it ignores the caller',
        cf.clause
      )
      when cf.root_is_or then format(
        '%s has an OR arm with no caller-dependent call outside IS NULL, so that arm ignores the caller',
        cf.clause
      )
      when not cf.calls_unnulled then format(
        '%s only tests that a caller exists (IS NULL), so it ignores who the caller is',
        cf.clause
      )
      else format('%s compares the caller only to constants, never to a column, so it picks no rows', cf.clause)
    end::text
  from clause_fact as cf
  join scope_policy as sp on sp.oid = cf.oid
  where case cf.clause when 'USING' then sp.using_text else sp.check_text end <> 'true'
    and sp.polpermissive
    and (
      (not cf.has_column and not cf.calls_private)
      or not cf.calls_caller
      or cf.open
    )
    and not exists (
      select 1
      from reference_table as rt
      where rt.schema_name = sp.nspname
        and rt.table_name = sp.relname
        and rt.adr ~ '^ADR-[0-9]+'
    )
  union all
  select distinct
    f.oid,
    'auth_call_unwrapped'::text,
    format('auth.uid() or auth.jwt() is called outside a scalar sub-select in %s', f.clause)::text
  from tree_node as f
  where substring(f.piece from '^\{FUNCEXPR :funcid ([0-9]+) ')::oid in (select af.oid from auth_function as af)
    and not exists (
      select 1
      from tree_node as s
      where s.oid = f.oid
        and s.clause = f.clause
        and s.piece like '{SUBLINK :subLinkType 4 %'
        and s.ord < f.ord
        and f.ord < s.end_ord
    )
)
select
  case sp.location
    when 'system' then 'system_schema_policy'
    when 'inherited' then 'inherited_table_policy'
    else f.branch
  end::text as branch,
  sp.qualified_name as object,
  case sp.location
    when 'system' then format('on a table in a system schema: %s (%s)', f.detail, f.branch)
    when 'inherited' then format('on an inherited table outside the four schemas: %s (%s)', f.detail, f.branch)
    else f.detail
  end::text as detail
from finding as f
join scope_policy as sp on sp.oid = f.oid
union all
select
  'system_list_policy'::text,
  format('%I on %I.%I', pol.polname, n.nspname, c.relname)::text,
  'a policy on a relation in a system-list schema'::text
from pg_policy as pol
join pg_class as c on c.oid = pol.polrelid
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname in (
    'auth', 'storage', 'extensions', 'realtime', '_realtime', 'graphql', 'graphql_public', 'supabase_functions',
    'supabase_migrations', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics'
  )
  and not exists (
    select 1
    from pg_depend as d
    join pg_extension as x on x.oid = d.refobjid
    where d.classid = 'pg_class'::regclass
      and d.objid = c.oid
      and d.refclassid = 'pg_extension'::regclass
      and d.deptype = 'e'
      and x.extnamespace = c.relnamespace
  )
-- MT-11 copy end
;
select is_empty(
  $q$
  select v.branch, v.object, v.detail
  from mt_11_run as v
  where v.object = 'mt_11_note_select on public.mt_11_note'
  $q$,
  'MT-11: no row for a policy that wraps auth.jwt() and a cast in a scalar sub-select'
);
select is_empty(
  $q$
  select v.branch, v.object, v.detail
  from mt_11_run as v
  where v.object = 'mt_11_note_aal2 on public.mt_11_note'
  $q$,
  'MT-11: no row for a RESTRICTIVE policy that requires aal2'
);
select isnt_empty(
  $q$
  select 1
  from mt_11_run as v
  where v.object = 'mt_11_note_aal2_open on public.mt_11_note'
    and v.branch = 'auth_only_clause'
  $q$,
  'MT-11: the same aal2 clause in a PERMISSIVE policy still hits auth_only_clause'
);
select is_empty(
  $q$
  select v.branch, v.object, v.detail
  from mt_11_run as v
  where v.object = 'mt_11_note_live on public.mt_11_note'
  $q$,
  'MT-11: no row for a RESTRICTIVE soft-delete policy (DB-1 negative control)'
);
select is_empty(
  $q$
  select v.branch, v.object, v.detail
  from mt_11_run as v
  where v.object = 'mt_11_note_mine_or_admin on public.mt_11_note'
  $q$,
  'MT-11: no row for an OR whose arms both depend on the caller (M0B-DB-2 negative control)'
);
select is_empty(
  $q$
  select v.branch, v.object, v.detail
  from mt_11_run as v
  where v.object = 'mt_11_note_scoped_live on public.mt_11_note'
  $q$,
  'MT-11: no row for a soft-delete clause ANDed with an org check (M0B-DB-2 negative control)'
);
select is_empty(
  $q$
  select v.branch, v.object, v.detail
  from mt_11_run as v
  where v.object = 'mt_11_note_org_or_operator on public.mt_11_note'
  $q$,
  'MT-11: no row for an OR arm that calls private.is_operator (FIX re-review negative control)'
);
select is_empty(
  $q$
  select v.branch, v.object, v.detail
  from mt_11_run as v
  where v.object in (
      'mt_11_note_member_exists on public.mt_11_note',
      'mt_11_note_org_in on public.mt_11_note',
      'mt_11_note_not_distinct on public.mt_11_note',
      'mt_11_note_row_compare on public.mt_11_note',
      'mt_11_note_exists_unnest on public.mt_11_note'
    )
  $q$,
  'MT-11: no row for a caller call bound through EXISTS, IN, IS NOT DISTINCT FROM or a row compare (FR-1 controls)'
);
select is_empty(
  $q$
  select v.branch, v.object, v.detail
  from mt_11_run as v
  where v.object in (
      'mt_11_note_job_org on public.mt_11_note',
      'mt_11_note_api_org on public.mt_11_note',
      'mt_11_note_assigned on public.mt_11_note'
    )
  $q$,
  'MT-11: no row for a policy binding job_org_id, api_org_id or my_assigned_test_ids to a column (D1 controls)'
);
select isnt_empty(
  $q$
  select 1
  from mt_11_run as v
  where v.object = 'mt_11_note_job_org_open on public.mt_11_note'
  $q$,
  'MT-11: a worker policy that only checks job_org_id() for null still hits (D1 positive control)'
);
select is_empty(
  $q$
  select e.object, e.branch
  from (
    values
      ('mt_11_note_uid_self on public.mt_11_note', 'caller_unbound'),
      ('mt_11_note_not_and on public.mt_11_note', 'nested_or_arm_without_caller'),
      ('mt_11_note_in_const on public.mt_11_note', 'caller_unbound'),
      ('mt_11_note_in_other on public.mt_11_note', 'caller_bound_elsewhere'),
      ('mt_11_note_case_uid on public.mt_11_note', 'case_branch_without_caller'),
      ('mt_11_note_coalesce_uid on public.mt_11_note', 'coalesce_arg_without_caller'),
      ('mt_11_note_nested_or_uid on public.mt_11_note', 'nested_or_arm_without_caller')
  ) as e (object, branch)
  except
  select v.object, v.branch
  from mt_11_run as v
  $q$,
  'MT-11: each FR-1 shape hits its branch (unbound, bound elsewhere, NOT, IN, CASE, COALESCE, nested OR)'
);
select is_empty(
  $q$
  select v.branch, v.object, v.detail
  from mt_11_run as v
  where v.object in (
      'mt_11_note_org_admin on public.mt_11_note',
      'mt_11_note_user on public.mt_11_note',
      'mt_11_note_ws_draft on public.mt_11_note',
      'mt_11_note_case_closed on public.mt_11_note',
      'mt_11_note_case_no_else on public.mt_11_note',
      'mt_11_note_coalesce_false on public.mt_11_note',
      'mt_11_note_nested_or_bound on public.mt_11_note',
      'mt_11_note_not_or on public.mt_11_note',
      'mt_11_note_uid_in_correlated on public.mt_11_note',
      'mt_11_note_in_nested on public.mt_11_note',
      'mt_11_note_caller_roles on public.mt_11_note',
      'mt_11_note_job_coalesce_false on public.mt_11_note'
    )
  $q$,
  'MT-11: no row for a caller call bound to a column on every path through AND, OR, NOT, CASE, COALESCE (FR-1)'
);
rollback to savepoint mt_11_negative;

-- MT-5b per-shape proofs (catalog pass C database review E1). MT-5b counts a 'quality' or 'integrity' literal as
-- naming the schema when it is an argument of format(), quote_ident() or set_config() in a function body, because
-- dynamic SQL can reach a schema without ever writing "quality." in the text. The generator has one fixture per
-- branch, so each shape is proven here instead, as a function in private that zeroes a quality table only when an
-- integrity table says so. The first two must hit prosrc_reference; the control uses the same three functions
-- with schema literals that are neither quality nor integrity and reaches integrity only, so it must stay clean.
-- The query between the "MT-5b copy" lines is a verbatim copy of supabase/catalog-checks/MT-5b.sql (keep the two
-- identical), created as a temporary view so that the three assertions read one copy. The savepoint is rolled
-- back right after them.
savepoint mt_5b_shapes;
create table quality.mt_5b_score (session_id uuid, points int);
create table integrity.mt_5b_signal (session_id uuid, band text);
create function private.mt_5b_set_config() returns void
language plpgsql
as $$
begin
  if exists (select 1 from integrity.mt_5b_signal) then
    perform pg_catalog.set_config('search_path', 'quality', true);
    update mt_5b_score set points = 0;
  end if;
end
$$;
create function private.mt_5b_quote_ident() returns void
language plpgsql
as $$
begin
  if exists (select 1 from integrity.mt_5b_signal) then
    execute 'update ' || quote_ident('quality') || '.mt_5b_score set points = 0';
  end if;
end
$$;
create function private.mt_5b_control() returns void
language plpgsql
as $$
begin
  if exists (select 1 from integrity.mt_5b_signal) then
    perform pg_catalog.set_config('search_path', 'public', true);
    execute format('select count(*) from %I.%I', 'public', 'mt_5b_note');
    execute 'select ' || quote_ident('mt_5b_note') || ' from ' || quote_ident('public') || '.mt_5b_note';
  end if;
end
$$;
create temp view mt_5b_run as
-- MT-5b copy begin
-- MT-5b (spec specs/m0-foundations.md §8.5, rule 1): a function (any prokind), not an extension member, in any
-- non-system schema or in a system-list schema where a migration can still create objects (escape_schema below,
-- when postgres is a member of its owner), that reaches both quality and integrity by the MT-5a rule. plpgsql
-- bodies are not in pg_depend, so prosrc and proconfig are read as well. The closure (shared:graph and
-- shared:closure below, the same text in MT-5a, 5b, 5c and 5d) starts at the function and follows its pg_depend
-- rows, every call its body names (schema.name(, or an unqualified name( resolved through its search_path
-- setting), the rules of views (pg_rewrite, skipping a rule's reference to its own relation) and other functions,
-- recursively. A node reaches a schema when it lives there (a relation also reaches the schema of every member of
-- every inheritance tree it belongs to: INHERITS children and partitions alike, wherever they live), when it is a
-- type or schema ref there, or, for a function, when its prosrc outside SQL comments names it (quality. or
-- "quality"., or 'quality' as an argument of format(), quote_ident() or set_config(), case-insensitive) or its
-- proconfig search_path lists it.
-- Branches, first match wins: system_schema_function (the function lives in a system-list schema),
-- begin_atomic_depend (pg_depend alone reaches both, as for a BEGIN ATOMIC body), prosrc_reference (a prosrc match
-- is needed, no proconfig, no call), proconfig_search_path (a proconfig match is needed, no call), prosrc_call (a
-- call named in a function body is needed).
with recursive
-- shared:graph begin (the same text in MT-5a, MT-5b, MT-5c and MT-5d)
target as (
  select n.oid, n.nspname::text as nspname
  from pg_namespace as n
  where n.nspname in ('quality', 'integrity')
),
-- family: every inheritance tree (INHERITS children and partitions are both pg_inherits rows) as (root, member)
-- pairs, the root included. A relation under several parents is a member of each parent's tree.
family (root_oid, member_oid) as (
  select i.inhparent, i.inhparent
  from pg_inherits as i
  where not exists (select 1 from pg_inherits as up where up.inhrelid = i.inhparent)
  union
  select f.root_oid, i.inhrelid
  from family as f
  join pg_inherits as i on i.inhparent = f.member_oid
),
-- rel_reach: a relation reaches a target schema when it lives there, or when a member of an inheritance tree it
-- belongs to lives there, whatever schema the relation itself is in.
rel_reach as (
  select c.oid, t.nspname
  from pg_class as c
  join target as t on t.oid = c.relnamespace
  union
  select f.member_oid, t.nspname
  from family as f
  join family as g on g.root_oid = f.root_oid
  join pg_class as gc on gc.oid = g.member_oid
  join target as t on t.oid = gc.relnamespace
),
-- caller: a function in any language but c and internal, with its body without SQL comments (src, and lsrc
-- lowercased) and the schemas its search_path setting lists (public and extensions, the database default, when it
-- has none). A single pass reads the body left to right: a string literal ('...', '' inside) or a quoted identifier
-- ("...", "" inside) is kept, so a -- or /* inside one is not a comment, and each -- comment (to the end of its
-- line) or /* */ comment becomes a space. Each kept literal or identifier gets a space after it, which no pattern
-- below depends on.
caller as materialized (
  select b.oid, b.src, lower(b.src) as lsrc, b.path
  from (
    select
      f.oid,
      regexp_replace(
        f.prosrc,
        '(''(?:[^'']|'''')*''|"(?:[^"]|"")*")|--[^\n]*|/\*(?:[^*]|\*+[^*/])*\*+/',
        '\1 ',
        'g'
      ) as src,
      sp.path
    from pg_proc as f
    join pg_language as l on l.oid = f.prolang
    cross join lateral (
      select coalesce(array_agg(btrim(s.part, ' "')), array['public', 'extensions']) as path
      from unnest(f.proconfig) as cfg(setting)
      cross join lateral regexp_split_to_table(substr(cfg.setting, 13), ',') as s(part)
      where left(cfg.setting, 12) = 'search_path='
    ) as sp
    where l.lanname not in ('c', 'internal')
  ) as b
),
-- callee: a function outside pg_catalog and information_schema, its schema and name escaped for a regex.
callee as materialized (
  select
    g.oid,
    lower(g.proname) as lname,
    n.nspname::text as nspname,
    regexp_replace(n.nspname, '([^[:alnum:]_])', '\\\1', 'g') as nsp,
    regexp_replace(g.proname, '([^[:alnum:]_])', '\\\1', 'g') as fn
  from pg_proc as g
  join pg_namespace as n on n.oid = g.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
),
-- code_edge: one step of the walk, from (classid, objid) to (refclassid, refobjid). bit tags the kind of step:
-- 1 into an operator (node_edge), 4 out of a domain or array type, 8 a call named in a function body, 0 any other.
-- A cast in an expression is recorded in pg_depend as its cast function, so casts need no step of their own.
code_edge (classid, objid, refclassid, refobjid, bit) as (
  -- the rules of a relation (a view body or a table rule), skipping a rule's reference to its own relation
  select 'pg_class'::regclass::oid, r.ev_class, d.refclassid, d.refobjid, 0
  from pg_rewrite as r
  join pg_depend as d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid
  where not (d.refclassid = 'pg_class'::regclass and d.refobjid = r.ev_class)
  union
  -- the pg_depend rows of a function (all of a BEGIN ATOMIC body, only the signature of any other) and of an
  -- operator (its oprcode)
  select d.classid, d.objid, d.refclassid, d.refobjid, 0
  from pg_depend as d
  where d.classid in ('pg_proc'::regclass, 'pg_operator'::regclass)
  union
  -- a CHECK constraint of a table or a domain, skipping its reference to its own table
  select 'pg_constraint'::regclass::oid, con.oid, d.refclassid, d.refobjid, 0
  from pg_constraint as con
  join pg_depend as d on d.classid = 'pg_constraint'::regclass and d.objid = con.oid
  where con.contype = 'c'
    and not (d.refclassid = 'pg_class'::regclass and d.refobjid = con.conrelid)
  union
  -- a column default or generated column, skipping its reference to its own table
  select 'pg_attrdef'::regclass::oid, ad.oid, d.refclassid, d.refobjid, 0
  from pg_attrdef as ad
  join pg_depend as d on d.classid = 'pg_attrdef'::regclass and d.objid = ad.oid
  where not (d.refclassid = 'pg_class'::regclass and d.refobjid = ad.adrelid)
  union
  -- an index with expressions or a predicate, skipping its reference to its own table
  select 'pg_class'::regclass::oid, ix.indexrelid, d.refclassid, d.refobjid, 0
  from pg_index as ix
  join pg_depend as d on d.classid = 'pg_class'::regclass and d.objid = ix.indexrelid
  where (ix.indexprs is not null or ix.indpred is not null)
    and not (d.refclassid = 'pg_class'::regclass and d.refobjid = ix.indrelid)
  union
  -- a domain: its pg_depend rows (such as a default expression) and its CHECK constraints
  select 'pg_type'::regclass::oid, ty.oid, d.refclassid, d.refobjid, 4
  from pg_type as ty
  join pg_depend as d on d.classid = 'pg_type'::regclass and d.objid = ty.oid
  where ty.typtype = 'd'
  union
  select 'pg_type'::regclass::oid, con.contypid, 'pg_constraint'::regclass::oid, con.oid, 4
  from pg_constraint as con
  where con.contypid <> 0
    and con.contype = 'c'
  union
  -- an array type: its element type, so an array of a domain reaches the domain
  select 'pg_type'::regclass::oid, ty.oid, 'pg_type'::regclass::oid, ty.typelem, 4
  from pg_type as ty
  where ty.typelem <> 0
    and ty.typsubscript = 'array_subscript_handler'::regproc
  union
  -- a trigger, skipping its reference to its own table
  select 'pg_trigger'::regclass::oid, tg.oid, d.refclassid, d.refobjid, 0
  from pg_trigger as tg
  join pg_depend as d on d.classid = 'pg_trigger'::regclass and d.objid = tg.oid
  where not (d.refclassid = 'pg_class'::regclass and d.refobjid = tg.tgrelid)
  union
  -- a policy, skipping its reference to its own table
  select 'pg_policy'::regclass::oid, pol.oid, d.refclassid, d.refobjid, 0
  from pg_policy as pol
  join pg_depend as d on d.classid = 'pg_policy'::regclass and d.objid = pol.oid
  where not (d.refclassid = 'pg_class'::regclass and d.refobjid = pol.polrelid)
  union
  -- a call named in a caller's body: schema.name( for any schema, or an unqualified name( when the callee's schema
  -- is on the caller's search_path. Every overload of the name counts.
  select 'pg_proc'::regclass::oid, f.oid, 'pg_proc'::regclass::oid, g.oid, 8
  from caller as f
  join callee as g on position(g.lname in f.lsrc) > 0
  where f.src ~* (
      '(^|[^[:alnum:]_$."])"?' || g.nsp || '"?[[:space:]]*\.[[:space:]]*"?' || g.fn || '"?[[:space:]]*\('
    )
    or (
      g.nspname = any(f.path)
      and f.src ~* ('(^|[^[:alnum:]_$."])"?' || g.fn || '"?[[:space:]]*\(')
    )
),
-- materialized: computed once, not once per step of the recursive walk
node_edge as materialized (
  select
    e.classid,
    e.objid,
    e.refclassid,
    e.refobjid,
    e.bit | case when e.refclassid = 'pg_operator'::regclass then 1 else 0 end as bit
  from code_edge as e
  where e.refclassid in (
    'pg_class'::regclass, 'pg_proc'::regclass, 'pg_type'::regclass, 'pg_namespace'::regclass,
    'pg_operator'::regclass, 'pg_constraint'::regclass
  )
),
-- shared:graph end
-- shared:escape begin (the same text in MT-5a, MT-5b, MT-5d, MT-10 and MT-11)
-- escape_schema: system-list schemas where a migration can still create objects (spec §8.5 revision 12): postgres
-- is a member (INHERIT, SET or ADMIN) of the schema owner or of a role with CREATE on it. An ADMIN-only member can
-- grant itself SET. Locally: extensions, _realtime, supabase_functions and supabase_migrations, plus any listed
-- schema that a migration creates (cron, net and so on).
escape_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in (
      'auth', 'storage', 'extensions', 'realtime', '_realtime', 'graphql', 'graphql_public', 'supabase_functions',
      'supabase_migrations', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics'
    )
    and (
      pg_has_role('postgres', n.nspowner, 'MEMBER')
      or exists (
        select 1
        from pg_roles as r
        where pg_has_role('postgres', r.oid, 'MEMBER')
          and has_schema_privilege(r.oid, n.oid, 'CREATE')
      )
    )
),
-- shared:escape end
root as (
  select
    p.oid,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))::text as qualified_name,
    n.oid in (select es.oid from escape_schema as es) as in_system_schema
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where (
      (
        n.nspname not in (
          'pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'realtime', '_realtime',
          'graphql', 'graphql_public', 'supabase_functions', 'supabase_migrations', 'vault', 'pgsodium',
          'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics'
        )
        and n.nspname !~ '^pg_toast(_temp_[0-9]+)?$'
        and n.nspname !~ '^pg_temp_[0-9]+$'
      )
      or (
        n.oid in (select es.oid from escape_schema as es)
        and pg_has_role('postgres', p.proowner, 'MEMBER')
      )
    )
    and not exists (
      select 1
      from pg_depend as d
      join pg_extension as x on x.oid = d.refobjid
      where d.classid = 'pg_proc'::regclass
        and d.objid = p.oid
        and d.refclassid = 'pg_extension'::regclass
        and d.deptype = 'e'
        and x.extnamespace = p.pronamespace
    )
),
seed (classid, oid) as (
  select 'pg_proc'::regclass::oid, r.oid
  from root as r
),
-- shared:closure begin (the same text in MT-5a, MT-5b, MT-5c and MT-5d)
-- closure: the walk from each seed (defined by the check). lvl: 0 the seed, 1 a direct reference of the seed, 2
-- reached through other relations or types only, 3 reached through a function. mask ORs the bits of the steps
-- taken. UNION keeps the walk finite on cycles.
closure (seed_classid, seed_oid, classid, objid, lvl, mask) as (
  select s.classid, s.oid, s.classid, s.oid, 0, 0
  from seed as s
  union
  select
    cl.seed_classid,
    cl.seed_oid,
    e.refclassid,
    e.refobjid,
    case
      when cl.lvl = 3 or e.refclassid = 'pg_proc'::regclass then 3
      when cl.lvl = 0 then 1
      else 2
    end,
    cl.mask | e.bit
  from closure as cl
  join node_edge as e on e.classid = cl.classid and e.objid = cl.objid
),
-- reach: a node of the walk reaches a target schema. how: dep when the node lives there (a relation through its
-- inheritance trees too) or is a type, schema or function there, src when a function body without comments
-- (caller.src) names the schema (quality. or "quality"., or 'quality' as an argument of format(), quote_ident() or
-- set_config(): after the call's open parenthesis in the same statement, case-insensitive), cfg when a function's
-- search_path setting lists it.
reach (seed_classid, seed_oid, nspname, lvl, mask, how) as (
  select cl.seed_classid, cl.seed_oid, rr.nspname, cl.lvl, cl.mask, 'dep'::text
  from closure as cl
  join rel_reach as rr on rr.oid = cl.objid
  where cl.classid = 'pg_class'::regclass
  union all
  select cl.seed_classid, cl.seed_oid, t.nspname, cl.lvl, cl.mask, 'dep'::text
  from closure as cl
  join pg_type as ty on ty.oid = cl.objid
  join target as t on t.oid = ty.typnamespace
  where cl.classid = 'pg_type'::regclass
  union all
  select cl.seed_classid, cl.seed_oid, t.nspname, cl.lvl, cl.mask, 'dep'::text
  from closure as cl
  join target as t on t.oid = cl.objid
  where cl.classid = 'pg_namespace'::regclass
  union all
  select cl.seed_classid, cl.seed_oid, t.nspname, cl.lvl, cl.mask, 'dep'::text
  from closure as cl
  join pg_proc as p on p.oid = cl.objid
  join target as t on t.oid = p.pronamespace
  where cl.classid = 'pg_proc'::regclass
  union all
  select cl.seed_classid, cl.seed_oid, t.nspname, cl.lvl, cl.mask, 'src'::text
  from closure as cl
  join caller as f on f.oid = cl.objid
  cross join target as t
  where cl.classid = 'pg_proc'::regclass
    and position(t.nspname in f.lsrc) > 0
    and (
      f.src ~* ('(^|[^[:alnum:]_$])("' || t.nspname || '"|' || t.nspname || ')[[:space:]]*\.')
      -- format(, quote_ident( or set_config( then string literals or anything but a quote or a semicolon (\x3b, the
      -- end of the statement), then the schema as a literal
      or f.src ~* (
        '(^|[^[:alnum:]_$])(?:format|quote_ident|set_config)[[:space:]]*\('
        || '(?:[^''\x3b]|''(?:[^'']|'''')*'')*''' || t.nspname || ''''
      )
    )
  union all
  select cl.seed_classid, cl.seed_oid, t.nspname, cl.lvl, cl.mask, 'cfg'::text
  from closure as cl
  join pg_proc as p on p.oid = cl.objid
  cross join target as t
  where cl.classid = 'pg_proc'::regclass
    and exists (
      select 1
      from unnest(p.proconfig) as cfg(setting)
      where cfg.setting ~* ('^search_path=(.*,)?[[:space:]]*"?' || t.nspname || '"?[[:space:]]*(,|$)')
    )
),
-- shared:closure end
violation as (
  select
    rc.seed_oid,
    count(distinct rc.nspname) filter (where rc.how = 'dep' and rc.mask & 8 = 0) = 2 as by_depend,
    count(distinct rc.nspname) filter (where rc.how in ('dep', 'src') and rc.mask & 8 = 0) = 2 as by_prosrc,
    count(distinct rc.nspname) filter (where rc.mask & 8 = 0) = 2 as by_config
  from reach as rc
  group by rc.seed_oid
  having count(distinct rc.nspname) = 2
)
select
  case
    when r.in_system_schema then 'system_schema_function'
    when v.by_depend then 'begin_atomic_depend'
    when v.by_prosrc then 'prosrc_reference'
    when v.by_config then 'proconfig_search_path'
    else 'prosrc_call'
  end::text as branch,
  r.qualified_name as object,
  (
    'function '
    || case when r.in_system_schema then 'in a system schema ' else '' end
    || 'reaches quality and integrity '
    || case
      when v.by_depend then 'through pg_depend'
      when v.by_prosrc then 'through a schema named in a function body'
      when v.by_config then 'through a function search_path'
      else 'through a call named in a function body'
    end
  )::text as detail
from violation as v
join root as r on r.oid = v.seed_oid
-- MT-5b copy end
;
select isnt_empty(
  $q$
  select 1
  from mt_5b_run as v
  where v.object = 'private.mt_5b_set_config()'
    and v.branch = 'prosrc_reference'
  $q$,
  'MT-5b: a quality literal that is the argument of set_config() counts as naming the schema'
);
select isnt_empty(
  $q$
  select 1
  from mt_5b_run as v
  where v.object = 'private.mt_5b_quote_ident()'
    and v.branch = 'prosrc_reference'
  $q$,
  'MT-5b: a quality literal that is the argument of quote_ident() counts as naming the schema'
);
select is_empty(
  $q$
  select 1
  from mt_5b_run as v
  where v.object = 'private.mt_5b_control()'
  $q$,
  'MT-5b: format(), quote_ident() and set_config() with other schema literals do not count'
);
rollback to savepoint mt_5b_shapes;

-- MT-7 body_search_path shapes (catalog pass C database review E1). The fixture proves SET LOCAL search_path; this
-- proves the other ways a body changes the search path, and what it must not flag. Flagged: SET SESSION ... TO with
-- a list, a quoted "search_path", set_config() in mixed case, dynamic SQL that runs SET LOCAL, and a SQL-language
-- function that calls set_config(). Not flagged: a function whose only mention of the search path is in an SQL
-- comment (-- or /* */), a set_config() for another setting, a column called search_path_hint, and the function
-- setting set search_path = '' (that one is in proconfig, not in the body). The query between the "MT-7 copy"
-- lines is a verbatim copy of supabase/catalog-checks/MT-7.sql (keep the two identical), created as a temporary
-- view. The savepoint is rolled back right after the assertion.
savepoint mt_7_shapes;
create function private.mt_7_session() returns void
language plpgsql
set search_path = ''
as $$
begin
  set session search_path to quality, public;
end
$$;
create function private.mt_7_quoted() returns void
language plpgsql
set search_path = ''
as $$
begin
  set local "search_path" = quality;
end
$$;
create function private.mt_7_config() returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('SEARCH_PATH', 'quality', true);
end
$$;
create function private.mt_7_dynamic() returns void
language plpgsql
set search_path = ''
as $$
begin
  execute 'set local search_path = quality';
end
$$;
create function private.mt_7_sql() returns text
language sql
set search_path = ''
as $$ select pg_catalog.set_config('search_path', 'quality', true) $$;
create function private.mt_7_control() returns void
language plpgsql
set search_path = ''
as $$
begin
  -- set search_path = quality would be wrong here: the function setting does it
  /* perform set_config('search_path', 'quality', true); */
  perform pg_catalog.set_config('app.mt_7_mode', 'x', true);
  update public.mt_7_note set search_path_hint = 1;
end
$$;
create temp view mt_7_run as
-- MT-7 copy begin
-- MT-7 (spec specs/m0-foundations.md §8.5, database-reviewer standard): missing_search_path is a SECURITY DEFINER
-- function in scope whose proconfig does not contain exactly search_path="" (what set search_path = '' stores).
-- outside_private is a SECURITY DEFINER function in public, quality or integrity, because SECURITY DEFINER helpers
-- live only in private (functions in public are callable as PostgREST RPCs). Scope for both: functions in the four
-- schemas, every prokind, skipping extension members in their extension's own namespace. definer_in_system_schema
-- is a SECURITY DEFINER function in any other schema that is not a member of any extension, is not owned by one of
-- the Supabase service roles below and is not on the list of Supabase's own objects below (the same lists as MT-9).
-- body_search_path is a function in scope (same scope as the first two, SECURITY DEFINER or not) whose body changes
-- the search path: SET [LOCAL|SESSION] search_path, or a call of set_config('search_path', ...), case-insensitive.
-- After it an unqualified table name can mean a quality table without any schema name in the text, which no MT-5
-- reach rule can see (rule 1). The body is read without SQL comments, by the same single pass as caller in MT-5a to
-- 5d: a quoted literal is kept, so execute 'set local search_path = ...' counts and so does a message that spells
-- it out, but a comment that mentions it does not. c and internal functions have a symbol in prosrc, not a body, and
-- are skipped. An UPDATE that sets a column called search_path matches too: rename the column.
with scope_function as (
  select
    p.oid,
    p.prosecdef,
    p.proconfig,
    n.nspname,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as qualified_name,
    case
      when l.lanname in ('c', 'internal') then ''
      else regexp_replace(
        p.prosrc,
        '(''(?:[^'']|'''')*''|"(?:[^"]|"")*")|--[^\n]*|/\*(?:[^*]|\*+[^*/])*\*+/',
        '\1 ',
        'g'
      )
    end as src
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  join pg_language as l on l.oid = p.prolang
  where n.nspname in ('public', 'private', 'quality', 'integrity')
    and not exists (
      select 1
      from pg_depend as d
      join pg_extension as e on e.oid = d.refobjid
      where d.classid = 'pg_proc'::regclass
        and d.objid = p.oid
        and d.refclassid = 'pg_extension'::regclass
        and d.deptype = 'e'
        and e.extnamespace = p.pronamespace
    )
),
supabase_owner as (
  -- Supabase service roles that own Supabase's own objects. postgres is not a member of any of them and cannot be
  -- granted one (supautils.reserved_memberships), so no migration can create an object they own. A listed role that
  -- postgres is a member of is not trusted, and a role that does not exist is ignored.
  select r.oid
  from pg_roles as r
  where r.rolname in (
    'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin', 'supabase_realtime_admin',
    'supabase_replication_admin', 'supabase_etl_admin', 'supabase_read_only_user', 'dashboard_user', 'pgbouncer'
  )
    and not pg_has_role('postgres', r.oid, 'MEMBER')
),
supabase_object (kind, schema_name, object_name, relkind, owner_name) as (
  -- Supabase's own non-member objects whose owner postgres is or can become (postgres itself, and
  -- supabase_functions_admin, of which postgres is a member), from the day-one check on the local stack
  -- (2026-10-11), plus the Supabase CLI's idempotency index seen on hosted Supabase (staging, 2026-10-20). A relation
  -- by relname and relkind (indexes and sequences too, so a table cannot take an index name), a function by name and
  -- identity arguments (relkind '').
  values
    ('relation'::text, 'supabase_migrations'::name, 'schema_migrations'::text, 'r'::text, 'postgres'::name),
    ('relation', 'supabase_migrations', 'schema_migrations_pkey', 'i', 'postgres'),
    ('relation', 'supabase_migrations', 'schema_migrations_idempotency_key_key', 'i', 'postgres'),
    ('relation', 'supabase_migrations', 'seed_files', 'r', 'postgres'),
    ('relation', 'supabase_migrations', 'seed_files_pkey', 'i', 'postgres'),
    ('relation', 'supabase_functions', 'hooks', 'r', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'hooks_pkey', 'i', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'hooks_id_seq', 'S', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'supabase_functions_hooks_h_table_id_h_name_idx', 'i', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'supabase_functions_hooks_request_id_idx', 'i', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'migrations', 'r', 'supabase_functions_admin'),
    ('relation', 'supabase_functions', 'migrations_pkey', 'i', 'supabase_functions_admin'),
    ('function', 'supabase_functions', 'http_request()', '', 'supabase_functions_admin')
),
outside_definer as (
  select
    n.nspname,
    format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) as object_name,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as qualified_name,
    p.proowner
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname not in ('public', 'private', 'quality', 'integrity')
    and not exists (
      select 1
      from pg_depend as d
      where d.classid = 'pg_proc'::regclass
        and d.objid = p.oid
        and d.refclassid = 'pg_extension'::regclass
        and d.deptype = 'e'
    )
)
select
  'missing_search_path'::text as branch,
  sf.qualified_name::text as object,
  format('SECURITY DEFINER without search_path="" (proconfig %s)', coalesce(sf.proconfig::text, 'null'))::text
    as detail
from scope_function as sf
where sf.prosecdef
  and not ('search_path=""' = any(coalesce(sf.proconfig, '{}'::text[])))
union all
select
  'outside_private'::text,
  sf.qualified_name::text,
  format('SECURITY DEFINER function in schema %I, not private', sf.nspname)::text
from scope_function as sf
where sf.prosecdef
  and sf.nspname <> 'private'
union all
select
  'definer_in_system_schema'::text,
  od.qualified_name::text,
  format('SECURITY DEFINER function in schema %I owned by %s', od.nspname, pg_get_userbyid(od.proowner))::text
from outside_definer as od
where od.proowner not in (select sr.oid from supabase_owner as sr)
  and not exists (
    select 1
    from supabase_object as o
    where o.kind = 'function'
      and o.schema_name = od.nspname
      and o.object_name = od.object_name
      and o.owner_name = pg_get_userbyid(od.proowner)
  )
union all
select
  'body_search_path'::text,
  sf.qualified_name::text,
  'function body changes the search path (SET search_path or set_config)'::text
from scope_function as sf
where sf.src ~* '(^|[^[:alnum:]_$])set[[:space:]]+((local|session)[[:space:]]+)?"?search_path"?([^[:alnum:]_$"]|$)'
  or sf.src ~* '(^|[^[:alnum:]_$])set_config[[:space:]]*\([[:space:]]*''search_path'''
-- MT-7 copy end
;
select results_eq(
  $q$
  select v.object::text collate "C"
  from mt_7_run as v
  where v.branch = 'body_search_path'
    and v.object like 'private.mt_7_%'
  order by 1
  $q$,
  $q$
  values
    ('private.mt_7_config()'::text collate "C"),
    ('private.mt_7_dynamic()'),
    ('private.mt_7_quoted()'),
    ('private.mt_7_session()'),
    ('private.mt_7_sql()')
  $q$,
  'MT-7: body_search_path flags exactly the five functions that change the search path, not the control'
);
rollback to savepoint mt_7_shapes;

select * from finish();
rollback;
