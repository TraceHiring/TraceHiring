# M0b summary: tenancy, roles, audit and org auth

Written 2026-10-22 at the M0b CLOSE (draft by a Sonnet writer, checked and completed by the lead). Sections follow `docs/AUTOPILOT.md` §2 CLOSE (on `trace/d1/integration`): built, deferred and why, Deferred gates table, autopilot decisions, how to demo. Then Linear and the close record.
Evidence rule: every claim cites a path, a commit SHA or a CI run id. All data is synthetic.

| Field | Value |
| --- | --- |
| Milestone branch | `milestone/m0b` @ `56c2641` = tag `cp/m0b-05`. It is `milestone/m0a` (`7dc8c0d`) plus 108 commits (HANDOFF "CLOSE pre-flight"). M0b merges after M0a (build-order rule 5) |
| Spec | `specs/m0b-tenancy.md` revision 8 (`0080700`) |
| Review | `docs/reviews/M0b.md` @ `56c2641`: **PASS WITH CONDITIONS**, no open Medium after FIX (section "Status after FIX"). Review range `7dc8c0d..4cb6775` (93 commits, 139 files) |
| Final CI | Run 38492229906 on `56c2641` (PR event, `m0b/integration`): static, rls, security, migrations success; deploy-staging skipped |
| Earlier CI | 38385517985 and 38400510847 on `4cb6775`; 38407442501 on `ccb584a`; 38415375246 on `01b177c`, all success |
| Floors at the tip | catalog 140, rls 697 (message of `56c2641`); the review began at catalog 133 and rls 686 |

## 1. What was built
| Area | What exists | Evidence |
| --- | --- | --- |
| Core schema | 8 tables: orgs, workspaces, teams, memberships, audit_log, platform_staff, staff_access_grants, idempotency_keys. RLS on all, one policy per operation | review "Security and privacy summary"; `supabase/migrations/20261012075545_m0b_tenancy.sql` |
| Audit log | Partitioned by month (15 fixed months to 2027-12 plus an empty DEFAULT). UPDATE, DELETE and TRUNCATE refused for every role, including the owner `postgres`; `ENABLE ALWAYS` triggers also hold in replica mode | review exit gate; MT-13; `rls_audit_log` |
| Sign-in audit | `auth.sign_in` and `auth.step_up` events from triggers on `auth.sessions`; `20261012...547_m0b_auth_audit.sql` | review; spec §2.5 |
| Roles | `trace_*` roles, `quality` and `integrity` schemas empty with separate worker grants (rule 1); candidate gateway role | MT-14; `rls_roles`; review "Product rules" R1 |
| Helpers | 27 `private` functions, all `security definer`, `search_path = ''`; operator path for org creation; `add_member`; staff grants (max 4 h, approver differs from grantee) | review summary; spec §2.8, §3.7 |
| Org auth | Recruiter app on Supabase Auth: password + TOTP, AAL2 enforced in the database; publishable key shape-checked at build; strict CSP | review "Security and privacy summary"; `apps/recruiter/src/auth/flow.ts` |
| Ops and smoke | `scripts/ops/enrol-smoke-user.mjs`, `scripts/smoke-staging-auth.mjs` (AT-B9), `scripts/test-concurrency-local.mjs` (two sessions, run by `test:rls`) | review; `ccb584a` |
| Shared | `@trace/workers-http` (constant error bodies; moved Worker error tests), ADR-029 idempotency keys, ADR-030 candidate token with a local spike | review "Regressions"; ADR-030 |
| Catalog checks | New MT-13, MT-14; MT-11 `no_caller_reference` and later `or_arm_without_caller`, `caller_only_null_tested`, `caller_unbound`; MT-2 `org_id_not_indexed` | `1cc45e0`, `4fd9c8f`, `56c2641` |

FIX and follow-up commits (one per finding, test first): M0B-DB-2 `1cc45e0` (Medium, MT-11 bypass); M0B-SP-1 `8c36e48`; B0-SP3 `66c8459`; B0-DB7 `c4db45c` (migration `20261013133323_m0b_staff_grant_checks.sql`); B0-SP7 cheap part `545e1c2`; M0B-DB-5 `ccb584a` (migration `20261013133832_m0b_owner_change_isolation.sql`; the two-session test showed both owner demotions committing under REPEATABLE READ before the fix); FR-2, FR-3 `45bb351`.

Exit gate (build-order M0b), status at CLOSE:
| Item | Evidence | Status |
| --- | --- | --- |
| `db reset` rebuilds from zero | `pnpm test:rls` locally and CI `rls` | Met |
| At least 50 RLS tests, allowed + denied, cross-org, counted apart from the catalog | rls floor 697 across `rls_*` files; catalog counted separately (140) | Met |
| Audit log rejects UPDATE/DELETE/TRUNCATE for every role | `rls_audit_log`, MT-13 with 7 fixtures | Met |
| An org user can sign in on staging (AT-B9) | Step "Smoke test, org sign-in" success in `deploy-staging` of runs 39566827826 and 39762460219 | **Met, with the d1 caveat below** |
| Migrations reach staging from CI only (AT-B10) | `check-workflows` tests (local); step "Apply migrations to staging" success in the same two runs | **Met, with the d1 caveat below** |

The M0b migrations first reached staging through CI in run 39376946373; a pre-M0b demo migration applied outside CI on 2026-10-11 was removed by hand by the founder (`docs/reviews/M0b.md` "CLOSE re-review addendum"). No M0b migration was applied outside CI.

d1 caveat. Both runs were `workflow_dispatch` runs on `d1/integration` (heads `5306928` and `df85dd4`), because milestone branches have no dispatch (HANDOFF "CLOSE pre-flight"). They exercise the M0b migrations and smoke as carried into D1, not the `56c2641` tree. The overall conclusion of each run is `failure` because `e2e-staging` (D1's AT-D1) failed; the `deploy-staging` job succeeded in both (`gh run view`, 2026-10-22). Tags `staging-applied-39566827826` and `staging-applied-39762460219` mark the applied migrations.

Repo close evidence, read with `gh api` on 2026-10-22: repo is PUBLIC (founder, 2026-10-22, to lift a GitHub Actions billing block; **reverses FOUNDER-QUEUE line 29**); ruleset 25633431 "trace rule" active on the default branch (PR required, merge method only, no bypass actors, deletion and non-fast-forward blocked, required checks static, rls, security, migrations); secret scanning and push protection enabled; 0 open alerts, 16 closed as false positive.

### FR-1 (see `docs/reviews/M0b.md` "CLOSE re-review addendum"; the FR-1 row above it predates these fixes)
- Review FIX re-review found FR-1 (Low, owner M1): a caller call compared only to constants counted as a caller check in MT-11.
- `4fd9c8f`: `tree_call.bound` counts a caller call only when it binds a column; new branch `caller_unbound`; catalog floor 138 to 140.
- Sonnet re-review of `4fd9c8f`: PASS WITH FINDINGS, no regression, 3 false positives (`docs/progress/LOG.md` row 2026-10-14 07:10 on `d1/integration`).
- `56c2641`: fixes the 3 false positives (IS NOT DISTINCT FROM, row compare, correlated EXISTS); negative controls 16/16; `test:rls` green (catalog 140, rls 697).
- CI run 38492229906 on `56c2641`: all four required jobs success.
- Still open, owner M1 (`MT-11.sql:41-44`, `:222`): a CASE or COALESCE whose call is bound in one branch only; an OR below an AND or a NOT; an IN sub-select over another table that compares the caller only to a constant. D1's three caller helpers widen this gap.

## 2. What was deferred, and why
| Item | Why | Owner |
| --- | --- | --- |
| Trust & Safety audited read path | Postgres cannot audit a SELECT; M0b ships no staff read of tenant data (`specs/m0b-tenancy.md` §1.2) | **M6** |
| Audit partition-horizon job | Partitions are fixed to 2027-12; rows after that land in DEFAULT and are moved by recovery (spec §2.4) | **M7**, must run **before 2027-09** |
| Replica-mode DR runbook | Owner in replica mode skips guards and FK checks (spec §2.4, E9) | **M7** (ABH-80) |
| M0B-DB-1 (Low): operator can DELETE/TRUNCATE `memberships`, `workspaces`, `staff_access_grants` | Review allowed M0b FIX or M7; chosen M7, next to the DR runbook | **M7** |
| FR-1 and B0-SP7 rest (gateway `SET ROLE`, pure-owner persona) | Low; only unusual constructs pass | **M1**, before M1 adds tables |
| H11 hosted checks DC-4, DC-9 | Done at CLOSE (founder, 2026-10-22); output in §3 | Closed |
| M0B-DB-3, M0B-SEC-1, B0-SEC4 session settings | Low | M1 |

Other open Lows from `docs/reviews/M0b.md` and their owners:
| Owner | Items |
| --- | --- |
| M1 | M0B-DB-3 (column ACLs in MT-13, MT-4, MT-14), M0B-SEC-1 (first TOTP enrolment from a password-only session), B0-DB3, B0-SEC5, B0-SEC7 (when the first free-value `details` writer lands), B0-SEC8, B4-SEC-4, B4-SEC-5, B4-SEC-6 (optional), B2-SEC-1, B2-SEC-4, B2-SEC-5 (founder answered "hide it", 2026-10-15) |
| M3a | B0-SEC6 (rule 10, direct path only) |
| M6 | M0B-DB-4 / M0B-SEC-2 (`platform_staff` writes write no audit row; add `staff.create`/`staff.update`) |
| Founder | Session time-box and inactivity timeout: left off, needs Supabase Pro (FOUNDER-QUEUE Resolved 2026-10-15); email-code template needs custom SMTP (H8 part 2) |
| Fixed | M0B-DB-2, M0B-SP-1, B0-SP3, B0-DB7, M0B-DB-5, FR-2, FR-3, B0-SP4/5/6 |

Medium findings: M0B-DB-2 is the only Medium; fixed in `1cc45e0`, closed by the re-review. No Medium remains open.

## 3. Deferred gates (build-order rule 6)
| # | Check | Proxy test used | Owner milestone |
| --- | --- | --- | --- |
| 1 | DC-4: trigger on hosted `auth.sessions` | H11 `supabase db push` on `trace-dev` applied `20261012075547_m0b_auth_audit.sql` without error (below); also applied on staging through CI | Closed at CLOSE |
| 2 | DC-9: hosted operator `session_user` is `postgres` and role `none` | H11 query on `trace-dev` returned `postgres\|none` (below) | Closed at CLOSE |
| 3 | AT-B9 and AT-B10 on the milestone tree | d1 runs above (M0b schema and smoke byte-identical) | D1 CLOSE: the first `deploy-staging` from `main` (the M0a/M0b merges use `[skip ci]`, founder 2026-10-22) |
| 4 | Concurrency under REPEATABLE READ | `scripts/test-concurrency-local.mjs`; guard refuses with `0A000` | Closed (`ccb584a`) |
| 5 | Partition horizon, T&S read path, DR runbook, M0B-DB-1 | pgTAP for the fixed range and DEFAULT recovery | M7, M6, M7, M7 |
| 6 | Session lifetime settings on hosted Auth | None | Revisit with a paid Supabase plan (founder) |

H11 output (founder, 2026-10-22, on `trace-dev` from `m0b/integration` @ `56c2641`, Supabase CLI 2.120.0; pasted in chat, connection string never shared):

```text
> pnpm exec supabase db push --db-url "$env:TRACE_DEV_DB_URL"
Connecting to remote database...
Do you want to push these migrations to the remote database?
  • 20261011015904_m0a_baseline.sql
  • 20261012075543_m0b_roles.sql
  • 20261012075545_m0b_tenancy.sql
  • 20261012075547_m0b_auth_audit.sql
  • 20261013133323_m0b_staff_grant_checks.sql
  • 20261013133832_m0b_owner_change_isolation.sql
Yes
Applying migration 20261011015904_m0a_baseline.sql...
Applying migration 20261012075543_m0b_roles.sql...
Applying migration 20261012075545_m0b_tenancy.sql...
Applying migration 20261012075547_m0b_auth_audit.sql...
Applying migration 20261013133323_m0b_staff_grant_checks.sql...
Applying migration 20261013133832_m0b_owner_change_isolation.sql...
Finished supabase db push.

> select session_user, current_setting('role');
postgres|none
```

## 4. Autopilot decisions
- Founder 2026-10-12 (overnight): M0b may start before `m0a-reviewed`; it closes only after (`specs/m0b-tenancy.md` rev 1).
- Founder 2026-10-14: D1 SPEC may start before `m0b-reviewed` (FOUNDER-QUEUE Resolved).
- Founder 2026-10-15: stay on GitHub Free (**superseded 2026-10-22 by the public repo**); deploy before merge by manual dispatch; hide account existence in the email-code form (B2-SEC-5).
- HOW-level, from HANDOFF at `5f80eb0` ("Decisions made this session"): `private.valid_roles` left off the MT-11 allow-list because it does not depend on the caller; `private.caller_roles` and `private.is_operator` added; M0B-DB-5 fixed by a separate trigger refusing owner or status changes outside READ COMMITTED; M0B-DB-1 goes to M7; fix-forward migrations instead of edits to reviewed ones.
- Spec decisions (rev 4-5): fixed partition range with the horizon owned by M7; operator predicate uses `session_user`, not `current_user`.
- Workers Logs: on, with invocation logs off, query strings redacted, traces off (review "Regressions": SPEC-F2 decided).
- ADRs: ADR-029 (idempotency keys) and ADR-030 (candidate token) are cited by the review. Whether either is marked "Accepted (autopilot)" was not verified.

## 5. How to demo
Run in a clone with Docker up; none was run while writing this draft.
| Show | Command | Source |
| --- | --- | --- |
| Tenancy tests, audit refusal, concurrency test | `pnpm test:rls` (prints catalog 140, rls 697) | `scripts/test-rls.mjs`; `56c2641` |
| Audit log cannot change | the `rls_audit_log` pgTAP file under `supabase/tests/` (path not re-checked); run `pnpm test:rls` | AT-B3 |
| Catalog check catches a bad policy | the MT-11 fixtures in `supabase/catalog-checks/fixtures/` | `1cc45e0`, `4fd9c8f` |
| Org sign-in with TOTP | `deploy-staging` step "Smoke test, org sign-in" in run 39762460219 | AT-B9 |
| Migrations from CI only | `node scripts/check-workflows.mjs`; step "Apply migrations to staging" | AT-B10 |
| Candidate token spike | `docs/spikes/m0b-candidate-token/spike.mjs` (27 passed, 0 failed, 0 skipped at `8c36e48`) | ADR-030 |
| Recruiter staging app | `https://trace-recruiter-staging.pages.dev` (serves d1 code) | `docs/infra/environments.md` |

## 6. Linear
Linear is not connected. Changes to list at CLOSE: none for M0b (ABH-80, the DR runbook part, stays open with owner M7).

## 7. Close record
- Merge `milestone/m0b` into `main` after `m0a-reviewed`, by PR, "Create a merge commit", `[skip ci]` in the merge commit (founder decision 2026-10-22, "Blocker B"); founder go-ahead in chat 2026-10-22 ("yes, if all green"). `main` (with the M0a merge and its `02368f2` osv ignore) is merged into `milestone/m0b` first.
- Tag `m0b-reviewed` after a PASS WITH CONDITIONS where every Medium has an owner (`docs/AUTOPILOT.md` §2).
- **CLOSE addendum verdict: PASS** (`docs/reviews/M0b.md` "CLOSE re-review addendum": fresh Opus reviewer PASS pending H11; H11 met, recorded by the lead).
- **Full `pnpm verify` at CLOSE on `0349b32`** (`56c2641` + the M0a CLOSE commits; lead, no agent running; tests with `pnpm -r --workspace-concurrency=1`): typecheck, lint, package tests, scripts 1559 passed + 1 skipped (K4), `test:rls` catalog 140 (floor 140) / rls 697 (floor 697), build all exit 0. `70c186e` (main merged in after the M0a CLOSE) has the same tree as `0349b32`.
- Merge commit and tag `m0b-reviewed`: recorded in `docs/progress/LOG.md` on `d1/integration` (this file is committed before the merge).
