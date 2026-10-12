# M0b SPEC review — `specs/m0b-tenancy.md`

Lead: Opus 5.5 session, 2026-10-12. Reviewers: fresh-context Opus subagents (AUTOPILOT §2 SPEC self-approval).

## Day-one checks run by the lead (local stack, rolled-back transactions, 2026-10-12)
- **DC-1 PASS.** `authenticated` with **no** USAGE on `private` (`has_schema_privilege` = false) is filtered correctly by a SELECT policy that calls a `private` SECURITY DEFINER helper it has EXECUTE on: it saw only its org's row. The policy form must be `org_id = any ((select private.fn())::uuid[])`; `org_id = any ((select private.fn()))` fails with `operator does not exist: uuid = uuid[]`.
- **DC-5.** BEFORE TRUNCATE statement triggers are **not** inherited: truncating a partition directly (including the DEFAULT partition) bypasses the parent's trigger; with its own trigger the partition is blocked, and truncating the parent fires the parent's trigger. BEFORE UPDATE OR DELETE **row** triggers on the parent are cloned to every partition (3 `pg_trigger` rows for parent + 2 partitions) and fire for the owner `postgres`. So every partition, the DEFAULT one included, needs its own TRUNCATE trigger (as revision 1 §2.4 says) and MT-13 must check each.

## spec-reviewer (revision 1): CHANGES REQUIRED — 1 Blocking, 15 Medium, 9 Low
No rule 1–9 violation; build-notes §4 invariant 12 room-left items kept; every exit-gate clause maps to an AT.

| # | Sev | § | Problem | Fix to apply in revision 2 |
| --- | --- | --- | --- | --- |
| S1 | Blocking | 2.7, 4.2, 1.3 | Build-time Supabase vars unworkable: a production build without them "fails" but CI `static`/`pnpm verify` build without staging vars; `VITE_SUPABASE_PUBLISHABLE_KEY` contains `KEY` (forbidden by `scripts/check-boundaries.mjs:50-51`); deploy-step env mapping unspecified; CSP origin in a static `_headers` undefined (`apps/recruiter/src/security-hygiene.test.ts:70-71` pins `'self'`); no H row for staging URL/key | Define verify/CI default; exact `ALLOWED_VITE_NAMES` entry + test; deploy env mapping; how `_headers` gets the origin; H row for `SUPABASE_STAGING_{URL,PUBLISHABLE_KEY}` |
| S2 | Medium | 4.1, 4.2, AT-B8, 10 | Email-OTP can ship broken: default magic-link template has no `{{ .Token }}`; OTP only tested with a fake client; §10 claim "RLS amr cases fail loudly" is false (synthetic claims) | `[auth.email.template.magic_link]` with `{{ .Token }}` (+H8); enable mailpit for AT-B8 and run OTP end to end asserting real `amr`; fix §10 |
| S3 | Medium | AT-B8, 11 | AT-B8 needs PostgREST + Kong but the harness excludes them (`scripts/test-rls.mjs:52-80`) | Specify the new `-x` list; AT-B8 runs in `test:rls` locally and in CI |
| S4 | Medium | 2.3, 2.5, 9 | Hosted-only failures (role creation, `auth.sessions` trigger) surface after the migration is frozen; a failing file can't be fixed forward | Separate migration files for hosted-sensitive statements, or prove on `trace-dev` via a founder step before CLOSE; idempotent role creation; "db reset twice" in DC-3 |
| S5 | Medium | 5 MT-14, 6, 8 | PG16+: non-superuser `postgres` with CREATEROLE becomes an ADMIN member (INHERIT/SET false) of roles it creates → MT-14 `candidate_member` flags `postgres`; `set local role trace_worker` as `postgres` fails without SET | DC-3; MT-14 counts only memberships with inherit or set; tests grant SET to `postgres` inside their transaction |
| S6 | Medium | 2.4, MT-13, AT-B3 | Owner-blocking rests on ordinary triggers; `session_replication_role = replica` disables them (if supautils allows it); `anon` missing from the role list | Triggers `ENABLE ALWAYS`; MT-13 checks `tgenabled = 'A'`; revoke UPDATE/DELETE/TRUNCATE from the owner too; DC + pgTAP under replica mode; add `anon` |
| S7 | Medium | 2.4, 6, 10 | Audit events incomplete/untested: no `org.update` (Q11 "settings changes"); `details` keys per event undefined; only the membership event tested; `auth.sign_in` untested | Add `org.update`; per-event `details` contract table; one pgTAP case per event incl. sign-in |
| S8 | Medium | 3.1, 3.5, 2.6 | No membership state machine: `create_org` leaves the owner `invited` (no access, last-owner rule fails); who moves invited→active undefined; invited access undefined; removed + `unique (org_id, user_id)` blocks rejoin; `org_status = suspended` undefined | Transition table (who, transition, audit event); `create_org` inserts `active`; partial unique `where status <> 'removed'` or state rejoin out of scope; suspended-org behaviour in helpers |
| S9 | Medium | 3.5, 3.9 | Admins can suspend/remove an owner, strip an owner's admin role, or workspace-restrict an owner | Any UPDATE of a row holding `org_owner` is owner-only; say whether `workspace_id` limits admin powers; tests |
| S10 | Medium | 2.3, MT-14, rls_roles | Rule-1 role check covers only the two worker roles; a role granted both worker roles passes | MT-14 branch + pgTAP: no non-owner role holds USAGE on both schemas through any membership chain; no role is a member of both worker roles |
| S11 | Medium | 1.3 H9, 4.4 | `create-smoke-user` uses the service-role key outside a server worker (CLAUDE.md Tenancy) | Founder creates the user in the dashboard; script signs in with password, enrols TOTP, calls `create_org` over `TRACE_OPERATOR_DB_URL`; both in H9 |
| S12 | Medium | 3.9 | Directory policy exposes `status`, `removed_at`, `created_by`, `user_id` of removed/suspended colleagues | RC/RV directory rows limited to `status in ('invited','active')`; log under build-notes "Autopilot changes" |
| S13 | Medium | 1.2, 3.7 | T&S read path has no owner milestone | Name the owner; Deferred table, Autopilot-changes row, FOUNDER-QUEUE FYI |
| S14 | Medium | 8 | Spike doesn't show RLS "understands" the token (zero rows only from missing grants) | Throwaway table + policy keyed on a candidate claim, one allowed + one denied row; zod claim shape in ADR-030 |
| S15 | Medium | whole | No zod contracts (create-org args, auth form inputs, shell rows, audit `details`); no recruiter auth UI state machine | Contracts section + state diagram |
| S16 | Medium | 11 | Stream reviews don't follow AUTOPILOT §2 (no spec-reviewer on B0/B1/B4, none on B5) | spec-reviewer on every stream |
| S17 | Low | 2.4 | Trigger functions must be SECURITY DEFINER in `private` | State it |
| S18 | Low | 2.2 vs 3.9 | Own-row membership SELECT not AAL-gated | Decide, state, test |
| S19 | Low | 2.5 | `details.aal` always `aal1` (step-up updates the session) | Record `amr` methods or also trigger on `UPDATE OF aal` |
| S20 | Low | 2.4 | A month whose rows landed in DEFAULT can never get its partition | Edge-case row + `create_audit_partition` behaviour |
| S21 | Low | 2.1 | Q3's `active_org_id` hint dropped; multi-org shell undefined | Note the deviation; define multi-org shell |
| S22 | Low | 1.2 | `org_policies` is listed under M3 (`docs/build-notes.md:549`), not M1/M2 | Fix cite and owner (M3a) |
| S23 | Low | 11 vs 9 | B0 lists DC-1..5 but DC-6/7 exist; no stream owns the ESLint boundary for `@trace/workers-http` | Assign both |
| S24 | Low | AT-B9 | Staging gate proven via REST API, not the deployed app | State the proxy is accepted, or add a headless browser step |
| S25 | Low | 6 | Missing personas: second owner, invited member, workspace-scoped admin | Add them |

HOW-vs-WHAT (reviewer): every scope call in revision 1 is HOW (no T&S read policy — needs an owner and logging; directory widening — log and narrow; `auth.sign_in` trigger; AAL rules; sessionStorage; Workers Logs on with `invocation_logs: false`; dropping `active_org_id` — document). None needs the founder.

## database-reviewer (revision 1)
**CHANGES REQUIRED — 2 Blocking, 7 Medium, 7 Low.** All probes ran on the local stack (PG 17.11) inside `begin; … rollback;`.

| # | Sev | § | Problem | Proof | Fix to apply in revision 2 |
| --- | --- | --- | --- | --- | --- |
| D1 | Blocking | 3.5, 2.4, 3.3, 3.7 | Guard/audit trigger security mode unspecified and both readings break: invoker → `permission denied for schema private` when the body calls `private.audit()`; definer → `current_user` and `session_user` are always `postgres`, so a "caller is postgres → skip rules 1–2" test would skip protection for every caller | p9/p10: `current_setting('role')` is `none` for the operator and `authenticated` under `set local role` | Every guard/audit trigger function SECURITY DEFINER, `search_path=''`; operator path = `current_setting('role') in ('none','postgres')` and `auth.uid() is null`; pgTAP: `postgres` with `set local role authenticated` is not the operator |
| D2 | Blocking | 3.5, 3.9 | Admin can suspend/remove an owner, change an owner's `workspace_id`, drop `admin` from an owner (privilege inversion) | column grant + rules as written | Rule 1′: any INSERT/UPDATE where `org_owner` is in OLD.roles or NEW.roles needs a caller holding `org_owner` at aal2; rls cases |
| D3 | Medium | 2.4, MT-13 | `set session_replication_role = replica` lets `postgres` delete/truncate the audit log | p5: rows left 0; after `ENABLE ALWAYS TRIGGER` → `TRACE_APPEND_ONLY`, `tgenabled='A'` propagated | `ENABLE ALWAYS` every append-only trigger (also in `create_audit_partition`); MT-13 requires `tgenabled='A'`; rls case in replica mode; owner claim = DML only (DDL caught by MT-13 + review) |
| D4 | Medium | 2.3, 6, 8 | `postgres`' automatic ADMIN-only membership in created roles has no SET → `set local role trace_*` fails; trace_* roles lack USAGE on `extensions` (pgTAP); the ADMIN row trips MT-14 `candidate_member` | p1, p8 | rls files grant `postgres` SET (inherit false) and `extensions` USAGE inside their transaction (or the migration does; say which); MT-14 ignores ADMIN-only rows |
| D5 | Medium | MT-14 | `postgres` is non-superuser BYPASSRLS → `rolbypassrls` branch fires on a clean stack | non-superuser BYPASSRLS roles: `postgres`, `service_role`, `supabase_etl_admin`, `supabase_read_only_user` | Allow-list `postgres` (migration owner) with evidence |
| D6 | Medium | 3.8 | MT-11 exempts a table only when the reason matches `^ADR-[0-9]+` (`MT-11.sql:249`, `:295`) | read | Cite ADR-029 in the reference-list entry and record the worker-only-table rule there |
| D7 | Medium | 3.5, 3.9 | A CHECK calling a `private` function needs EXECUTE for the writing role → 42501 on membership writes | p3 | Grant EXECUTE on the CHECK functions to `authenticated`; rls insert case |
| D8 | Medium | 2.4 | Rows in DEFAULT for month M block creating M's partition; can't move them (append-only) | p5: `updated partition constraint for default partition … would be violated` | `create_audit_partition` recovery path (detach default → create month → copy → drop old default → recreate with all rules); check that DEFAULT is empty and a partition exists for now()+3 months |
| D9 | Medium | 3.5 rule 3 | Write-skew: two owners demote each other concurrently under READ COMMITTED → zero owners | MVCC reasoning | Lock `orgs` row `for update` (or `pg_advisory_xact_lock`) before any change touching `org_owner`/`status` |
| D10 | Low | 6, 10 | Deferred constraint fires only at COMMIT; tests end in rollback | PG semantics | `set constraints … immediate` inside `throws_ok` |
| D11 | Low | 2.1, 3.9 | `= any((select f()))` fails | p3 (and lead DC-1) | Pin `= any((select …)::uuid[])` |
| D12 | Low | 2.5 | Step-up updates `auth.sessions.aal`; `details.aal` always aal1 | `\d auth.sessions` | Also `AFTER UPDATE OF aal` → `auth.step_up`; pin in AT-B8 |
| D13 | Low | 3.5, 10 | GoTrue FKs to `auth.users` cascade; hard delete of a member fails 23503 | `pg_constraint` | Document soft delete for erasure; AT that hard delete is refused |
| D14 | Low | MT-14 | Inheritance is per-grant in PG16+; `rolinherit=false` doesn't stop `grant … with inherit true` | p1/p2 | Check `inherit_option=false and set_option=true` on the gateway edge |
| D15 | Low | 3.5, 3.7 | No index leading with `user_id` / `staff_user_id` for helper/policy predicates | reasoning | `memberships (user_id) include (org_id, roles, status, workspace_id)`; `staff_access_grants (staff_user_id)` |
| D16 | Low | 3.5, 3.9 | (a) invitee can't move `invited → active` (self-edit banned); (b) workspace-restricted members still get org-wide `orgs`/directory/`audit_log` | spec text | (a) name the M1 acceptance path (definer RPC); (b) CHECK `workspace_id is null` for owner/admin, or state the scope |

Checked clean: DC-1 (policies and CHECKs stored by OID → EXECUTE enough; **not** true for plpgsql/SQL function bodies, see D1); trigger functions need no EXECUTE for the firing role; DC-5 on `audit_log` (row triggers cloned via `tgparentid`; TRUNCATE not cloned; with per-partition triggers direct truncate, delete and cross-partition update all raise P0001); PK incl. `occurred_at` valid; DC-3/DC-4 locally (`create role … nologin`, trigger on `auth.sessions`, FK to `auth.users`); MT-11 compatibility of own-row and helper policies (incl. the proposed `no_caller_reference`); MT-2 `org_id_not_indexed` satisfied by every planned table; `auth.uid()`/`auth.jwt()` read `request.jwt.claims`; multi-statement `throws_ok` works; ≥50 (target ≥120) realistic.

Not checked: hosted staging (DC-3/4/6), GoTrue `amr` values and session update on MFA verify, whether `db reset` keeps cluster-global roles (use `if not exists`), §4 Auth config and app flows.

## Re-review of revision 2 (Sonnet spec-reviewer, 2026-10-12): CHANGES REQUIRED
All 41 findings (S1–S25, D1–D16) **RESOLVED**. Revision 2 introduced 4 Medium and 4 Low problems, to fix in revision 3 (next session, lead):

| # | Sev | § | Problem | Fix |
| --- | --- | --- | --- | --- |
| N1 | Medium | 2.4 vs 3.6 | `audit.repartition` has no org, but `audit_log.org_id` is NOT NULL, in the PK and an FK | Write it to the `trace_internal` org (state it), or drop the event and record repartitions in the M7 job log |
| N2 | Medium | 3.5 rule 5, 6, 10 | The `invited` persona can't exist (rule 5 forces `active` on insert, also on the operator path) | Test-only path: the operator path may insert `invited` (rule 5 applies to app callers only), or drop the persona until M1 |
| N3 | Medium | 6, 2.4, AT-B3 | Owner/replica-mode cases fail on the revoked privilege before any trigger fires, so they prove the revoke, not the ALWAYS trigger | Inside the test transaction re-grant the privilege to `postgres`, then assert `P0001` (trigger) in normal and replica mode; keep a separate case for the revoke |
| N4 | Medium | 2.6 vs 4.4, AT-B8 | `create_org` always makes `{org_owner, admin}`; nothing creates the recruiter-only smoke/OTP user | Add `scripts/ops/add-member.mjs` (operator path, zod args, roles) or a roles argument on `create_org`; use it in AT-B8 and H9 |
| N5 | Low | 4.4 | Heading says "no service-role key anywhere" but local mode reads the local demo key | Reword: no **staging/production** service-role key; local demo key only, refused for non-127.0.0.1 |
| N6 | Low | 2.2 vs rls_roles | Own-row exception unstated for a suspended org | State: own rows stay visible, nothing else |
| N7 | Low | 3.2, 3.9 | No `orgs` guard/audit trigger defined for the column rules and `org.update` | Add `private.orgs_guard()` + audit trigger in §2.8/§3.2 |
| N8 | Low | 1.3 vs AT-B9 | First staging smoke runs before H9 can create the smoke org | State the order: first run fails at the smoke step, then H9, then re-run |
