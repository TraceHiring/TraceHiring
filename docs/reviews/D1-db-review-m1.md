# D1 migration 1 — database review (Opus database-reviewer, 2026-10-14)

Scope: `supabase/migrations/20261014065417_d1_authoring.sql` (commit `45206c8`), its tests `supabase/tests/rls_d1_{tests,assignments,scoping,rulesets,helpers}.test.sql` (`512021f`), the amended `rls_roles` and `catalog_probe`. Probes ran rolled back on the local Postgres 17.11.

**Verdict: CHANGES REQUIRED** (2026-10-14 update: M-1, m-1 fixed and m-3 covered in `4a2211c`; m-2, m-4, m-5 open) — 0 Blocking, 1 Major, 5 Minor, 4 Notes. No rule 1/2/3/5/6 break, no cross-org leak, no hole in the freeze/publish state machine.

## Findings and lead dispositions

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| M-1 | **Major** | Assignments ignore the workspace fence (M0b D16b): `assignments_guard` (≈ lines 998–1004), `my_assigned_test_ids` (≈ 429–446) and the publish auto-assignment (≈ 730–739) never compare `memberships.workspace_id` with the test's workspace. A workspace-A2 reviewer can be assigned to an A1 test and then reads its items and **answer keys**; a workspace-scoped recruiter would later reach A1 evidence via migration 4. Spec-level hole (§3.3/§3.4 as written). | **FIXED 2026-10-14** in `4a2211c` (`20261014093232_d1_authoring_fixes.sql`): guard (every caller, operator too), helper and auto-assignment filters as proposed; tests `rls_d1_workspace_fence` seen red first (10 failing), then 23/23; spec revision 4a §3.4. |

| m-1 | Minor | `created_by := coalesce(auth.uid(), new.created_by)` trusts "no JWT" rather than "operator"; no exploitable path today, but a future definer/`trace_api`/`service_role` insert could name any creator and get auto-assigned (R-15). | **FIXED** in `4a2211c` (tests_guard and test_versions_guard): the guard functions run on temp tables as `trace_worker` with no JWT get a null creator; `authenticated` naming one gets `42501`. |

| m-2 | Minor | Auto-assignment re-adds a creator an owner deliberately unassigned, on every later publish. | **FIXED (2026-10-16, lead):** auto-assign only on the test's first publish (no other version has `published_at`); fixed in place in `20261014093232_d1_authoring_fixes.sql` (never applied to a shared DB); tests in `rls_d1_assignments` (unassign, publish version 2, no re-add, one `assignment.create`); spec §3.2 `test_versions`. |
| m-3 | Minor | The "publish needs a band rule" branch is never exercised (the shim always sets one). | **COVERED** in `4a2211c` (`rls_d1_workspace_fence` m-3 case; passes, so no defect). |

| m-4 | Minor | The two `trace_api` policies and its column-limited `test_versions` SELECT have no RLS tests. | **FIXED (2026-10-16, lead):** `rls_roles` pins the exact `trace_api` allow-list with the operations per table (`consents` S I, `invitations` S(c) U(c), `notice_versions` S, `test_versions` S(c); `public`, `quality`, `integrity` and `private`), mutation-checked with an extra column grant; the column limits and policies stay in `rls_d1_api`. |
| m-5 | Minor | Retire is not audited. | **FIXED (2026-10-16, lead):** `test.retire` (`{version_no}`) written by `private.test_versions_audit()` on published → retired (in place in `20261014065417_d1_authoring.sql`); `AUDIT_ACTIONS` 24 → 25 and `AuditDetails` with the contract test; `rls_d1_tests` asserts one row per successful retire with the retiring user as actor and none for refusals; spec §3.2 and §3.4. |
| n-1 | Note | Policy predicates filter `workspace_id`/`test_id` without `org_id`; every index leads with `org_id` (no skip scan in PG17). Fine at D1 volume. | Before M3: add `(workspace_id)` / `(test_id)` indexes or always filter by `org_id`. |
| n-2 | Note | Audit triggers are origin-only (not in replica mode), as in M0b. | Accepted (replica mode is superuser-only). |
| n-3 | Note | `origin` in the `item_versions` INSERT grant is harmless only while the CHECK pins `'human'`. | M1: drop it from the grant when the CHECK widens. |
| n-4 | Note | Org-level rubrics are readable/editable across workspaces until referenced. | Per spec (rubrics are org-level); revisit for multi-client orgs. |

## Lead changes the reviewer checked
(a) widened INSERT grants — clean; (b) creator fallback — see m-1; (c) published versions refuse any update — correct (an api bulk update without a status filter will now error, by design); (d) `D1-M1-SHIM` — hides no defect; it masks only coverage (m-3 and migration 1's fail-closed publish on its own), and it self-disables once `integrity.band_rule_versions` exists.

## Checked and clean
RLS on all 9 tables, one policy per operation, no `FOR ALL`/`PUBLIC`, no grants to `anon`/`service_role`; helpers via `(select …)`; worker/`trace_api` policies return nothing when the org GUC is unset; all DEFINER functions in `private` with `search_path = ''`, no dynamic SQL, EXECUTE lists match §3.4; `membership_counts` truth table unchanged; guards/freezes `ENABLE ALWAYS`; draft → published → retired, retired terminal; pins and cutoff immutable after publish; composite FKs block cross-org parents; rules 1 and 2 hold.

Not checked: real concurrency, the real L-8 trigger (migration 3), `media_viewer_check` (migration 4).
