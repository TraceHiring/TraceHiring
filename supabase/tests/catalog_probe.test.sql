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
-- FR-1 review of fb58605: a sub-select is tied to the policy's table only through a comparison at its own level
-- that reads both (MT11-1), a scalar or ARRAY sub-select is tied by the comparison around it (MT11-2), and a
-- caller call with the compared column itself as a fallback (COALESCE, GREATEST) is not bound (MT11-3).
alter table public.mt_11_note add column membership_id uuid;
create policy mt_11_note_exists_outer_filter on public.mt_11_note
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships as m
    where m.user_id = (select auth.uid())
      and mt_11_note.deleted_at is null
  )
);
create policy mt_11_note_in_outer_filter on public.mt_11_note
for select
to authenticated
using ((select auth.uid()) in (select m.user_id from public.memberships as m where mt_11_note.deleted_at is null));
create policy mt_11_note_job_fallback on public.mt_11_note
for select
to trace_worker
using (org_id = coalesce((select private.job_org_id()), org_id));
create policy mt_11_note_job_greatest on public.mt_11_note
for select
to trace_worker
using (org_id::text = greatest((select private.job_org_id())::text, org_id::text));
create policy mt_11_note_scalar_member on public.mt_11_note
for select
to authenticated
using (membership_id = (select m.id from public.memberships as m where m.user_id = (select auth.uid())));
create policy mt_11_note_array_member on public.mt_11_note
for select
to authenticated
using (membership_id = any(array(select m.id from public.memberships as m where m.user_id = (select auth.uid()))));
create policy mt_11_note_job_const_fallback on public.mt_11_note
for select
to trace_worker
using (org_id = coalesce((select private.job_org_id()), '00000000-0000-0000-0000-000000000000'::uuid));
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
--     private.caller_roles, private.is_operator and D1's private.job_org_id, private.api_org_id and
--     private.my_assigned_test_ids), on a table that is not on the reference list, such as the
--     soft-delete clause using (deleted_at is null) or deleted_at is null or (select private.valid_roles(...)). It
--     never depends on who is asking, so it ORs open every org's rows. The same clause in a RESTRICTIVE policy only
--     narrows and passes.
--   The next seven branches (M0b review M0B-DB-2, M0b FR-1 closed in M1 Wave 0) look at a clause of a PERMISSIVE
--   policy that calls a caller-dependent helper, and report it when it is open: some way for it to be true passes no
--   bound caller call (tree_call.bound: the call is compared to a column of the policy's table) outside an
--   IS [NOT] NULL test. Openness is followed through AND, OR, NOT, a boolean CASE and a boolean COALESCE
--   (guard_round), so that path alone lets every signed-in user of every org through. First match wins:
--   or_arm_without_caller: the root is an OR, such as deleted_at is null or (select auth.uid()) is not null.
--   caller_only_null_tested: every caller-dependent call sits inside an IS [NOT] NULL test, such as
--     deleted_at is null and (select auth.uid()) is not null, which only asks whether someone is signed in.
--   caller_bound_elsewhere: no caller call is bound, but one is compared to a column of another table only, such as
--     deleted_at is null and exists (select 1 from memberships as m where m.user_id = (select auth.uid())), where
--     the EXISTS is not correlated to the policy's table (a filter such as and t.deleted_at is null inside it is no
--     correlation): any member of any org passes. Also org_id = coalesce((select private.job_org_id()), org_id),
--     where the compared column is the call's own fallback.
--   caller_unbound (M0b FIX re-review FR-1): no caller call is bound or compared to any column:
--     deleted_at is null and (select auth.jwt() ->> 'role') = 'authenticated', (select auth.uid()) =
--     (select auth.uid()), or org_id in (select m.org_id from memberships as m where (select auth.jwt() ->> 'role')
--     = 'authenticated').
--   case_branch_without_caller: a caller call is bound, but a CASE has a branch (its ELSE included) that is true
--     without one, such as case when owner_id = (select auth.uid()) then true else deleted_at is null end.
--   coalesce_arg_without_caller: the same through a COALESCE argument, such as
--     coalesce(org_id = (select private.job_org_id()), true), true whenever no job org is set.
--   nested_or_arm_without_caller: the same through an OR below the root, or an AND below an odd number of NOTs,
--     such as status = 'draft' and (owner_id = (select auth.uid()) or deleted_at is null), or
--     not (deleted_at is not null and owner_id = (select auth.uid())).
--   Still not followed (the check is a net, and each table's rls_* tests, allowed and denied cases per role, remain
--   the proof), each with the form to write instead:
--   - the boolean structure inside a sub-select, such as an OR in an EXISTS's WHERE: keep each OR arm's caller check
--     in that arm, or split the policy.
--   - what the comparison is: owner_id <> (select auth.uid()), or not (owner_id = (select auth.uid())), counts as
--     bound although it lets in every row but the caller's own: compare with = (or = any, in, exists).
--   - (owner_id = (select auth.uid())) is not false (or is not true below a NOT, any BOOLEANTEST) counts as guarded
--     although it is true when owner_id is null: write owner_id = (select auth.uid()), or
--     coalesce(owner_id = (select auth.uid()), false).
--   - a simple CASE (case x when ...): its WHEN compares the operand, not a column, so a caller call there is not
--     bound and the check may report a compliant clause: write case when x = ... then ... end.
--   - a boolean function that takes a caller call and a column is no comparison, so not bound (reported): compare the
--     column to the caller call directly.
--   - (select m.id from memberships as m where m.user_id = (select auth.uid()) and m.org_id = t.org_id) is not null
--     is reported as caller_only_null_tested, since the call sits inside a NULLTEST (fails closed): write
--     exists (select 1 from memberships as m where m.user_id = (select auth.uid()) and m.org_id = t.org_id).
--   Cost (FR-1 review MT11-5): the node-tree CTEs pair nodes within a clause, so time grows with the square of a
--   clause's size and linearly with the number of clauses. 209 clauses (the local stack with M1-a, 2026-10-23) take
--   0.38 to 0.44 s. Revisit near 600 policies.
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
-- immutable private.valid_roles, is not a caller check. A new caller-dependent helper must be added here. M1's
-- private.library_org_id is deliberately not on the list: it returns the same org for every caller.
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
-- query_node: each sub-select (QUERY node) with qlevel, the number of QUERY nodes around it, itself included. A
-- scalar sub-select such as (select auth.uid()) is one too.
query_node (oid, clause, ord, end_ord, qlevel) as (
  select
    q.oid,
    q.clause,
    q.ord,
    q.end_ord,
    (
      select count(*)
      from tree_node as o
      where o.oid = q.oid
        and o.clause = q.clause
        and o.piece like '{QUERY %'
        and o.ord <= q.ord
        and q.ord < o.end_ord
    )
  from tree_node as q
  where q.piece like '{QUERY %'
),
-- var_ref: each column reference (VAR) with ref_level, the query level whose table it reads: the number of QUERY
-- nodes around it less its varlevelsup. 0 is the policy's table. For n > 0, ref_query is the QUERY node at level n
-- around it and ref_sublink the innermost SUBLINK node around that QUERY.
var_ref (oid, clause, ord, ref_level, ref_query, ref_sublink) as (
  select v.oid, v.clause, v.ord, x.ref_level, q.ord, s.ord
  from tree_node as v
  cross join lateral (
    select
      (
        select count(*)
        from query_node as q
        where q.oid = v.oid
          and q.clause = v.clause
          and q.ord < v.ord
          and v.ord < q.end_ord
      ) - substring(v.piece from ':varlevelsup ([0-9]+)')::int as ref_level
  ) as x
  left join query_node as q on q.oid = v.oid
    and q.clause = v.clause
    and q.qlevel = x.ref_level
    and q.ord < v.ord
    and v.ord < q.end_ord
  left join lateral (
    select max(t.ord) as ord
    from tree_node as t
    where t.oid = v.oid
      and t.clause = v.clause
      and t.piece like '{SUBLINK %'
      and t.ord < q.ord
      and q.ord < t.end_ord
  ) as s on true
  where v.piece like '{VAR %'
),
-- pred_node: the comparisons a caller call can be bound by: a boolean operator (OPEXPR with opresulttype 16),
-- SCALARARRAYOPEXPR, DISTINCTEXPR, NULLIFEXPR, ROWCOMPAREEXPR, an EXISTS, ALL, ANY/IN or row-compare sub-select
-- (subLinkType 0 to 3, is_sublink), and NULLTEST, which binds nothing. The test expression of an ALL, ANY/IN or
-- row-compare sub-select (any node in it with no QUERY node between it and that SUBLINK) is left out: it compares
-- with the sub-select's output, so the SUBLINK node stands for it.
pred_node (oid, clause, ord, end_ord, null_test, is_sublink) as (
  select p.oid, p.clause, p.ord, p.end_ord, p.piece like '{NULLTEST %', p.piece like '{SUBLINK %'
  from tree_node as p
  where (
      (p.piece like '{OPEXPR %' and p.piece like '% :opresulttype 16 %')
      or p.piece like '{SCALARARRAYOPEXPR %'
      or p.piece like '{DISTINCTEXPR %'
      or p.piece like '{NULLIFEXPR %'
      or p.piece like '{ROWCOMPAREEXPR %'
      or p.piece like '{NULLTEST %'
      or p.piece ~ '^\{SUBLINK :subLinkType [0-3] '
    )
    and not exists (
      select 1
      from tree_node as s
      where s.oid = p.oid
        and s.clause = p.clause
        and s.piece ~ '^\{SUBLINK :subLinkType [1-3] '
        and s.ord < p.ord
        and p.ord < s.end_ord
        and not exists (
          select 1
          from query_node as q
          where q.oid = p.oid
            and q.clause = p.clause
            and s.ord < q.ord
            and q.ord < p.ord
            and p.ord < q.end_ord
        )
    )
),
-- sublink_query: each SUBLINK node with its subLinkType and its own sub-select (the QUERY node right below it).
sublink_query (oid, clause, ord, end_ord, sublink_type, query_ord) as (
  select s.oid, s.clause, s.ord, s.end_ord, substring(s.piece from '^\{SUBLINK :subLinkType ([0-9]+) ')::int, q.ord
  from tree_node as s
  join tree_node as q on q.oid = s.oid
    and q.clause = s.clause
    and q.piece like '{QUERY %'
    and q.depth = s.depth + 1
    and s.ord < q.ord
    and q.ord < s.end_ord
  where s.piece like '{SUBLINK %'
),
-- tie_candidate (FR-1 review MT11-1, MT11-2): the column references (var_ord) that tie a sub-select to the query
-- around it when that column is itself tied (anchored_sublink): a column in the test expression of an ALL, ANY/IN or
-- row-compare sub-select, such as org_id in (select ...), a column in a comparison at the sub-select's own level
-- that also reads a column of the sub-select's own tables (a real correlation, such as m.org_id = t.org_id, not a
-- filter such as t.deleted_at is null), or, for a scalar or ARRAY sub-select, a column outside it in the innermost
-- comparison around it, such as membership_id = (select m.id from memberships as m where ...).
tie_candidate (oid, clause, sublink_ord, var_ord) as (
  select s.oid, s.clause, s.ord, v.ord
  from sublink_query as s
  join var_ref as v on v.oid = s.oid and v.clause = s.clause and s.ord < v.ord and v.ord < s.query_ord
  where s.sublink_type between 1 and 3
  union all
  select s.oid, s.clause, s.ord, v.ord
  from sublink_query as s
  join pred_node as p on p.oid = s.oid
    and p.clause = s.clause
    and s.query_ord < p.ord
    and p.ord < s.end_ord
    and not p.null_test
    and not p.is_sublink
  join var_ref as v on v.oid = p.oid and v.clause = p.clause and p.ord < v.ord and v.ord < p.end_ord
  where not exists (
      select 1
      from query_node as q
      where q.oid = p.oid
        and q.clause = p.clause
        and s.query_ord < q.ord
        and q.ord < p.ord
        and p.ord < q.end_ord
    )
    and exists (
      select 1
      from var_ref as w
      where w.oid = p.oid
        and w.clause = p.clause
        and p.ord < w.ord
        and w.ord < p.end_ord
        and w.ref_query = s.query_ord
    )
  union all
  select s.oid, s.clause, s.ord, v.ord
  from sublink_query as s
  cross join lateral (
    select p.ord, p.end_ord, p.null_test
    from pred_node as p
    where p.oid = s.oid
      and p.clause = s.clause
      and p.ord < s.ord
      and s.end_ord < p.end_ord
    order by p.ord desc
    limit 1
  ) as p
  join var_ref as v on v.oid = s.oid
    and v.clause = s.clause
    and p.ord < v.ord
    and v.ord < p.end_ord
    and (v.ord < s.ord or s.end_ord < v.ord)
  where s.sublink_type in (4, 6)
    and not p.null_test
),
-- anchored_sublink: a SUBLINK node tied to the policy's table: a tie_candidate column reads the policy's table, or
-- reads, from inside the sub-select of an anchored SUBLINK, that sub-select's tables, such as the inner sub-select of
-- test_id in (select t.id from tests as t where t.workspace_id in (...)).
anchored_sublink (oid, clause, ord) as (
  select t.oid, t.clause, t.sublink_ord
  from tie_candidate as t
  join var_ref as v on v.oid = t.oid and v.clause = t.clause and v.ord = t.var_ord
  where v.ref_level = 0
  union
  select t.oid, t.clause, t.sublink_ord
  from anchored_sublink as a
  join var_ref as v on v.oid = a.oid and v.clause = a.clause and v.ref_sublink = a.ord
  join tie_candidate as t on t.oid = v.oid
    and t.clause = v.clause
    and t.var_ord = v.ord
    and v.ref_query < t.sublink_ord
),
-- anchored_var: a VAR that reads the policy's table, or a table of the sub-select of an anchored SUBLINK.
anchored_var (oid, clause, ord) as (
  select v.oid, v.clause, v.ord
  from var_ref as v
  where v.ref_level = 0
    or exists (
      select 1
      from anchored_sublink as a
      where a.oid = v.oid
        and a.clause = v.clause
        and a.ord = v.ref_sublink
    )
),
-- tree_call: each function a clause calls (a function, an operator's function, an aggregate or a window function)
-- that is in private or auth, with its schema, its node, whether it depends on the caller and whether it sits
-- inside an IS [NOT] NULL test (a NULLTEST node), which only asks whether there is a caller. bound (M0b FR-1): the
-- helper returns boolean itself (a predicate on the caller, such as private.is_operator), or the innermost
-- comparison around the call (pred_node) is an anchored sub-select (anchored_sublink), or is not a NULLTEST and
-- reads an anchored column (anchored_var), such as org_id = any((select private.my_org_ids(...))),
-- org_id in (select unnest((select private.my_org_ids(...)))) or membership_id in (select m.id from memberships as m
-- where m.user_id = (select auth.uid())), unless a COALESCE, CASE, GREATEST or LEAST between that comparison and
-- the call also reads an anchored column (FR-1 review MT11-3): org_id = coalesce((select private.job_org_id()),
-- org_id) is true for every row when no job org is set. A call compared only to a constant, such as
-- (select auth.jwt() ->> 'role') = 'authenticated', to itself, or to a column of a sub-select not tied to the
-- policy's table, is not bound: it does not pick rows. bound_elsewhere: that comparison reads some column.
tree_call (oid, clause, nspname, ord, caller, null_tested, bound, bound_elsewhere) as (
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
    hf.returns_bool or coalesce(ip.anchored, false),
    coalesce(ip.reads_column, false)
  from tree_node as fn
  join helper_function as hf on hf.oid = coalesce(
      substring(fn.piece from '^\{FUNCEXPR :funcid ([0-9]+) '),
      substring(fn.piece from '^\{[A-Z]+ :opno [0-9]+ :opfuncid ([0-9]+) '),
      substring(fn.piece from '^\{AGGREF :aggfnoid ([0-9]+) '),
      substring(fn.piece from '^\{WINDOWFUNC :winfnoid ([0-9]+) ')
    )::oid
  left join lateral (
    select
      case
        when p.is_sublink then exists (
          select 1
          from anchored_sublink as a
          where a.oid = p.oid
            and a.clause = p.clause
            and a.ord = p.ord
        )
        else not p.null_test
        and exists (
          select 1
          from anchored_var as v
          where v.oid = p.oid
            and v.clause = p.clause
            and p.ord < v.ord
            and v.ord < p.end_ord
        )
        and not exists (
          select 1
          from tree_node as x
          join anchored_var as v on v.oid = x.oid and v.clause = x.clause and x.ord < v.ord and v.ord < x.end_ord
          where x.oid = p.oid
            and x.clause = p.clause
            and (x.piece like '{COALESCEEXPR %' or x.piece like '{CASEEXPR %' or x.piece like '{MINMAXEXPR %')
            and p.ord < x.ord
            and x.ord < fn.ord
            and fn.ord < x.end_ord
        )
      end as anchored,
      not p.null_test
      and exists (
        select 1
        from tree_node as v
        where v.oid = p.oid
          and v.clause = p.clause
          and v.piece like '{VAR %'
          and p.ord < v.ord
          and v.ord < p.end_ord
      ) as reads_column
    from pred_node as p
    where p.oid = fn.oid
      and p.clause = fn.clause
      and p.ord < fn.ord
      and fn.ord < p.end_ord
    order by p.ord desc
    limit 1
  ) as ip on true
),
-- tree_kind: each node's role in the boolean skeleton of its clause: and, or, not, case (a CASE of type boolean),
-- when (its CASEWHEN arms), coalesce (a COALESCE of type boolean), else leaf.
tree_kind (oid, clause, ord, end_ord, depth, piece, kind) as (
  select
    t.oid,
    t.clause,
    t.ord,
    t.end_ord,
    t.depth,
    t.piece,
    case
      when t.piece like '{BOOLEXPR :boolop and %' then 'and'
      when t.piece like '{BOOLEXPR :boolop or %' then 'or'
      when t.piece like '{BOOLEXPR :boolop not %' then 'not'
      when t.piece like '{CASEEXPR :casetype 16 %' then 'case'
      when t.piece like '{CASEWHEN %' then 'when'
      when t.piece like '{COALESCEEXPR :coalescetype 16 %' then 'coalesce'
      else 'leaf'
    end::text
  from tree_node as t
),
-- skel: the boolean skeleton, walked from the root (depth 1) down to its leaves: the arms of AND and OR, the operand
-- of NOT, the WHEN arms and the ELSE of a CASE (not its operand, which comes before the first WHEN), the condition
-- and the result of a WHEN, and the arguments of COALESCE. pol is true below an odd number of NOTs, and a WHEN's
-- condition starts again at false.
skel (oid, clause, ord, end_ord, depth, parent, kind, pol) as (
  select r.oid, r.clause, r.ord, r.end_ord, r.depth, null::bigint, r.kind, false
  from tree_kind as r
  where r.depth = 1
  union all
  select
    ch.oid,
    ch.clause,
    ch.ord,
    ch.end_ord,
    ch.depth,
    s.ord,
    ch.kind,
    case
      when s.kind = 'when'
        and ch.ord = (
          select min(f.ord)
          from tree_node as f
          where f.oid = s.oid
            and f.clause = s.clause
            and f.depth = s.depth + 1
            and s.ord < f.ord
            and f.ord < s.end_ord
        ) then false
      when s.kind = 'not' then not s.pol
      else s.pol
    end
  from skel as s
  join tree_kind as ch on ch.oid = s.oid
    and ch.clause = s.clause
    and ch.depth = s.depth + 1
    and s.ord < ch.ord
    and ch.ord < s.end_ord
  where s.kind <> 'leaf'
    and (
      s.kind <> 'case'
      or ch.kind = 'when'
      or ch.ord > (
        select max(w.ord)
        from tree_node as w
        where w.oid = s.oid
          and w.clause = s.clause
          and w.depth = s.depth + 1
          and w.piece like '{CASEWHEN %'
          and s.ord < w.ord
          and w.ord < s.end_ord
      )
    )
),
-- skel_node: mode says when a skeleton node is guarded (it can be true only through a bound caller call): leaf by
-- itself, any when one child is (AND, NOT, a WHEN, and OR below an odd number of NOTs), all when every child is (OR,
-- CASE, COALESCE, and AND below an odd number of NOTs).
skel_node (oid, clause, ord, end_ord, depth, parent, kind, pol, mode) as (
  select
    s.oid,
    s.clause,
    s.ord,
    s.end_ord,
    s.depth,
    s.parent,
    s.kind,
    s.pol,
    case
      when s.kind = 'leaf' then 'leaf'
      when s.kind in ('case', 'coalesce') then 'all'
      when s.kind in ('when', 'not') then 'any'
      when (s.kind = 'or') <> s.pol then 'all'
      else 'any'
    end::text
  from skel as s
),
-- leaf_guard: a guarded leaf: it holds a bound caller call outside a NULLTEST, or it is the boolean constant null,
-- false (not below a NOT) or true (below an odd number of NOTs), which is never true there.
leaf_guard (oid, clause, ord) as (
  select s.oid, s.clause, s.ord
  from skel_node as s
  join tree_node as t on t.oid = s.oid and t.clause = s.clause and t.ord = s.ord
  where s.mode = 'leaf'
    and (
      exists (
        select 1
        from tree_call as c
        where c.oid = s.oid
          and c.clause = s.clause
          and c.caller
          and not c.null_tested
          and c.bound
          and s.ord <= c.ord
          and c.ord < s.end_ord
      )
      or (
        t.piece like '{CONST :consttype 16 %'
        and (t.piece like '% :constisnull true %' or (t.piece like '% :constvalue 1 [ 0 %') <> s.pol)
      )
    )
),
-- guard_round: the guarded skeleton nodes of each clause, from the guarded leaves up, one level per round, until no
-- node is added.
guard_round (oid, clause, guarded) as (
  select pt.oid, pt.clause, array(select g.ord from leaf_guard as g where g.oid = pt.oid and g.clause = pt.clause)
  from policy_tree as pt
  union all
  select r.oid, r.clause, x.guarded
  from guard_round as r
  cross join lateral (
    select array(
        select s.ord
        from skel_node as s
        where s.oid = r.oid
          and s.clause = r.clause
          and (
            s.ord = any(r.guarded)
            or (
              s.mode = 'any'
              and exists (
                select 1
                from skel_node as ch
                where ch.oid = s.oid
                  and ch.clause = s.clause
                  and ch.parent = s.ord
                  and ch.ord = any(r.guarded)
              )
            )
            or (
              s.mode = 'all'
              and not exists (
                select 1
                from skel_node as ch
                where ch.oid = s.oid
                  and ch.clause = s.clause
                  and ch.parent = s.ord
                  and not ch.ord = any(r.guarded)
              )
            )
          )
      ) as guarded
  ) as x
  where cardinality(x.guarded) > cardinality(r.guarded)
),
clause_guard (oid, clause, guarded) as (
  select distinct on (r.oid, r.clause) r.oid, r.clause, r.guarded
  from guard_round as r
  order by r.oid, r.clause, cardinality(r.guarded) desc
),
-- clause_fact: per USING or WITH CHECK of a scope policy, whether it refers to a column of its table (a VAR whose
-- varlevelsup equals the number of QUERY nodes around it), whether it calls a function in private or in auth,
-- whether it calls a caller-dependent helper, whether some caller-dependent call sits outside a NULLTEST
-- (calls_unnulled), whether one of those is bound (has_bound) or reads another column (has_bound_elsewhere), whether
-- its root is an OR, whether it is open (its root is not guarded), and open_kind: for the shallowest unguarded
-- skeleton node of mode all with no guarded node above it, case, coalesce or else or.
clause_fact (
  oid,
  clause,
  has_column,
  calls_private,
  calls_auth,
  calls_caller,
  calls_unnulled,
  has_bound,
  has_bound_elsewhere,
  root_is_or,
  open,
  open_kind
) as (
  select
    pt.oid,
    pt.clause,
    exists (
      select 1
      from var_ref as v
      where v.oid = pt.oid
        and v.clause = pt.clause
        and v.ref_level = 0
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
      from tree_call as c
      where c.oid = pt.oid
        and c.clause = pt.clause
        and c.caller
        and not c.null_tested
        and c.bound
    ),
    exists (
      select 1
      from tree_call as c
      where c.oid = pt.oid
        and c.clause = pt.clause
        and c.caller
        and not c.null_tested
        and c.bound_elsewhere
    ),
    exists (
      select 1
      from tree_node as r
      where r.oid = pt.oid
        and r.clause = pt.clause
        and r.depth = 1
        and r.piece like '{BOOLEXPR :boolop or %'
    ),
    not exists (
      select 1
      from skel_node as s
      join clause_guard as g on g.oid = s.oid and g.clause = s.clause
      where s.oid = pt.oid
        and s.clause = pt.clause
        and s.depth = 1
        and s.ord = any(g.guarded)
    ),
    (
      select case when s.kind in ('case', 'coalesce') then s.kind else 'or' end
      from skel_node as s
      join clause_guard as g on g.oid = s.oid and g.clause = s.clause
      where s.oid = pt.oid
        and s.clause = pt.clause
        and s.mode = 'all'
        and not s.ord = any(g.guarded)
        and not exists (
          select 1
          from skel_node as a
          where a.oid = s.oid
            and a.clause = s.clause
            and a.ord < s.ord
            and s.ord < a.end_ord
            and a.ord = any(g.guarded)
        )
      order by s.depth, s.ord
      limit 1
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
      when not cf.has_bound and cf.has_bound_elsewhere then 'caller_bound_elsewhere'
      when not cf.has_bound then 'caller_unbound'
      when cf.open_kind = 'case' then 'case_branch_without_caller'
      when cf.open_kind = 'coalesce' then 'coalesce_arg_without_caller'
      when cf.open_kind = 'or' then 'nested_or_arm_without_caller'
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
        '%s has an OR arm with no bound caller call outside IS NULL, so that arm ignores the caller',
        cf.clause
      )
      when not cf.calls_unnulled then format(
        '%s only tests that a caller exists (IS NULL), so it ignores who the caller is',
        cf.clause
      )
      when not cf.has_bound and cf.has_bound_elsewhere then format(
        '%s compares the caller to no column of its table (only other columns, or the column as a fallback)',
        cf.clause
      )
      when not cf.has_bound then format(
        '%s compares the caller only to constants, never to a column, so it picks no rows',
        cf.clause
      )
      when cf.open_kind = 'case' then format(
        '%s has a CASE branch (or ELSE) that is true without a bound caller call, so it ignores the caller',
        cf.clause
      )
      when cf.open_kind = 'coalesce' then format(
        '%s has a COALESCE argument that is true without a bound caller call, so it ignores the caller',
        cf.clause
      )
      when cf.open_kind = 'or' then format(
        '%s has a nested OR (or a negated AND) with an arm that has no bound caller call, so it ignores the caller',
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
      ('mt_11_note_nested_or_uid on public.mt_11_note', 'nested_or_arm_without_caller'),
      ('mt_11_note_exists_outer_filter on public.mt_11_note', 'caller_bound_elsewhere'),
      ('mt_11_note_in_outer_filter on public.mt_11_note', 'caller_bound_elsewhere'),
      ('mt_11_note_job_fallback on public.mt_11_note', 'caller_bound_elsewhere'),
      ('mt_11_note_job_greatest on public.mt_11_note', 'caller_bound_elsewhere')
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
      'mt_11_note_job_coalesce_false on public.mt_11_note',
      'mt_11_note_scalar_member on public.mt_11_note',
      'mt_11_note_array_member on public.mt_11_note',
      'mt_11_note_job_const_fallback on public.mt_11_note'
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
