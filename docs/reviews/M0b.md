# Milestone M0b review — Tenancy, roles, audit and org auth
2026-10-13 · Lead: Opus 5.5 session that did not write the M0b code; judgment reviews by three fresh-context Opus subagents (`spec-reviewer`, `security-reviewer`, `database-reviewer`, all read-only; DB probes only in rolled-back transactions) · Commit range `7dc8c0d..4cb6775` (`milestone/m0a` → `milestone/m0b` = `cp/m0b-02`), 93 commits · Files changed: 139 · Spec `specs/m0b-tenancy.md` revision 7

## Verdict: PASS WITH CONDITIONS (code) — the milestone stays INCOMPLETE on two founder-gated staging items until CLOSE
No reviewer found a Critical or High issue, and no product rule is broken. Every mandatory gate passed locally (full `pnpm verify`, exit 0) and on Linux CI (two green runs on `4cb6775`). Every local exit-gate item and every acceptance test AT-B1…AT-B14 has a real automated test.

There is one Medium, M0B-DB-2: the catalog check MT-11 misses a policy shaped `column test OR auth.uid() is not null`. No current table is affected; it is a gap in the safety checks. It must be fixed in M0b FIX, before any later milestone adds tables. There are 5 new Lows and 15 carried Lows, each with an owner milestone below.

Two exit-gate items cannot be proven from this machine yet. "An org user can sign in on staging" (AT-B9) and the staging run of "migrations reach staging from CI only" (AT-B10) both need founder rows H3–H5 and H8–H11 (`docs/progress/FOUNDER-QUEUE.md:20-21`). Their local parts are tested. Under skill §6 the milestone is therefore **INCOMPLETE until the staging run passes at CLOSE**. M0b also closes only after `m0a-reviewed` (founder gate). `m0b-reviewed` may be tagged once M0B-DB-2 is fixed and re-reviewed, the staging run passes, and every remaining Medium has an owner.

## Gates
Run by the lead on 2026-10-13 on `ad8d7db` (code identical to `4cb6775`; later commits are `docs/progress` only), with two read-only reviewers active.
| Gate | Command | Result | Notes |
| --- | --- | --- | --- |
| G1 Clean install | CI `pnpm install --frozen-lockfile` (runs 38385517985, 38400510847) | pass | AT-1a/1b clean-clone runs are M0a's; re-run at CLOSE |
| G2 Typecheck | full `pnpm verify` | pass | |
| G3 Lint | same: eslint, prettier, check-boundaries OK, check-workflows OK, `gen-catalog-tests --check` OK (121), check-migrations OK, gitleaks | pass | |
| G4 Tests | same | pass | config 364, db-types 3, shared 681, vendors 1, workers-http 43, ui 67, candidate 80, recruiter 204, api 27, jobs 27, edge 32; scripts 1552 + 1 skipped (K4, Windows symlink) |
| G5 DB from zero + pgTAP | `pnpm test:rls` inside verify; CI `rls` | pass | "10 test files; catalog_* 133 assertions (floor 133), rls_* 686 assertions (floor 686); db-types current"; AT-B8 ran (local and CI log) |
| G6 Build | inside verify | pass | candidate 72.4 kB gzip (budget 150), recruiter 184.0 kB (info), check-headers OK, scan-dist clean in 5 `dist/` |
| G7 E2E | — | not required (from M3) | |
| G8 Audit | `pnpm audit --prod --audit-level=high` | pass (exit 0) | "1 ignored: 1 high", the documented `braces` ignore (as in M0a) |
| G9 Secrets | `gitleaks git` in `pnpm lint`; CI `security` | pass | "364 commits scanned … no leaks found" |
| G10 Skipped/focused | grep over apps, packages, workers, services, scripts, supabase, docs/spikes | 1 real skip | K4 `scripts/test/scan-dist.test.mjs:710` (Windows EPERM, predates M0b); the rest are the TAP parser treating `# SKIP` as failure |
| G11 Escape hatches | `: any\|as any\|@ts-ignore\|@ts-expect-error\|eslint-disable` in non-test `src` | 0 | 4 grep hits, all inside comments |
| G12–G14 | — | not required for M0b | |
| CI (Linux) | runs 38385517985 (PR #3) and 38400510847 (push `milestone/m0b`) on `4cb6775` | static ✓, rls ✓, security ✓, migrations ✓; deploy-staging skipped (not `main`, by design) | |
| PII log scan (P1) | email / Indian mobile / Aadhaar / PAN / JWT / IPv4 regex over the full verify output and the CI `rls` log | 0 hits | |

## Exit gate (build-order M0b, `docs/build-order.md:34`)
| Item | Evidence | Status |
| --- | --- | --- |
| `supabase db reset` rebuilds from zero | `pnpm test:rls` (`scripts/test-rls.mjs`) locally and in CI `rls`; DC-3 reset ×6 record (spec §9) | Met |
| ≥ 50 RLS tests (allowed + denied per role, incl. cross-org), counted separately from catalog | 8 `rls_*` files = 193+37+143+65+64+84+45+55 = 686 = `rls-min-count`; catalog 121+12 = 133 = `catalog-min-count`; cross-org denial for every op an org role can perform (database reviewer's matrix) | Met |
| Audit log rejects UPDATE/DELETE/TRUNCATE for every role | `rls_audit_log` (9 roles incl. `postgres` × parent / month / DEFAULT → `42501`; re-grant + ALWAYS triggers → `P0001` in normal and replica mode); MT-13 with 7 fixtures; live: owner ACL `arxtm` and `tgenabled='A'` on all 17 relations | Met |
| An org user can sign in on staging | AT-B9 `scripts/smoke-staging-auth.mjs` + `scripts/test/smoke-staging-auth.test.mjs`, wired in `ci.yml` deploy-staging; local equivalent AT-B8 green | **Deferred to CLOSE** (founder H3–H5, H8–H10) |
| Migrations reach staging from CI only | AT-B10 `check-workflows` tests (`scripts/test/check-workflows.test.mjs`), M0a spec rev 18 | Local Met; **staging run deferred to CLOSE** (H3–H5, H11) |

Also founder-gated: DC-4 (hosted `auth.sessions` trigger) and DC-9 (hosted operator predicate) on H11.

## Findings
New in this review (the full reviewer evidence is summarised; probes ran in rolled-back transactions on PG 17.11).
| # | Severity | Check ID | file:line | Problem | Proof | Fix | Must fix by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M0B-DB-2 (supersedes B0-DB5) | **Medium** | S1 / MT-11 | `supabase/catalog-checks/MT-11.sql:283, 308-321` | `no_caller_reference` accepts any call into `auth.*`/`private.*` as "references the caller". A permissive policy `using (deleted_at is null or (select auth.uid()) is not null)` opens every org's rows to any signed-in user and passes **every** catalog check | **Re-run by the lead**: in a rolled-back transaction, a table with that SELECT policy plus a control policy; running all 18 `MT-*.sql` reported only the control (`no_caller_reference … zz_control`); the open policy got 0 rows from every check | Allow-list caller-dependent helpers by name (`private.my_org_ids`, `private.my_workspace_ids`, `private.valid_roles`, `auth.uid`, `auth.jwt`), and flag a top-level `OR` with an arm that has no caller-dependent call; add both shapes as fixtures; floor up | **M0b FIX** (before CLOSE; certainly before D1/M1 add tables) |
| M0B-DB-1 | Low | S12 / spec §3.5 | `supabase/migrations/20261012075545_m0b_tenancy.sql:870-876, 950-953` | The operator (table owner `postgres`) can DELETE/TRUNCATE `memberships` (and `workspaces`, `staff_access_grants`), dropping the last owner without the deferred check or an audit row; §3.5 says rules 3–4 "always apply" on the operator path | Reviewer: rolled-back `delete from public.memberships where id=<smoke-local owner>` → 1 row; `set constraints … immediate` → OK; owners left 0; audit rows 0 | Revoke DELETE/TRUNCATE from `postgres` on those tables (as for `audit_log`) or add BEFORE DELETE/TRUNCATE guards; rls cases | M0b FIX or M7 (DR runbook) |
| M0B-DB-3 | Low | S12 / MT-13 | `supabase/catalog-checks/MT-13.sql:20-24, 55-62` | MT-13 (and MT-4, MT-14 `login_dml`) read only `relacl`, not column ACLs; a column-level INSERT/UPDATE grant on an audit partition passes. RLS (no write policy) and the ALWAYS triggers still block the write | Reviewer: rolled-back `grant update (details) … on audit_log_2026_11 to trace_worker` → `has_column_privilege` t; MT-13/MT-4 0 rows | Add `pg_attribute.attacl` to the `acl` branch + fixture | M1 |
| M0B-DB-4 / M0B-SEC-2 | Low | S12 / S13 | `20261012075545_m0b_tenancy.sql:881-897` | `platform_staff` inserts/updates (new staff, `active`, `capabilities`) write no audit row; no `staff.*` event in §2.4 | Both reviewers: only `platform_staff_guard` exists on the table | `staff.create`/`staff.update` events into the `trace_internal` org log + spec §2.4 row | M6 (before the staff read path) |
| M0B-DB-5 | Low (unproven) | C1 / spec §10 | `20261012075545_m0b_tenancy.sql:720-807` (lock-first guard) | The write-skew lock serialises concurrent owner demotions under READ COMMITTED (partly shown live: a second session's suspend waits on the `orgs` row lock → `55P03`). Under REPEATABLE READ the post-lock re-read uses the old snapshot, so two owners demoting each other might both pass. No M0b path uses RR (PostgREST is READ COMMITTED) | Reviewer: two psql sessions (lock wait shown); the RR case is reasoned, not run | Two-connection test in `test:rls` (RC must refuse the second demotion; RR must refuse too, or the guard raises unless `transaction_isolation = 'read committed'`) | M0b FIX (test) |
| M0B-SEC-1 | Low | S5 | `apps/recruiter/src/auth/flow.ts:332, 355-373` | Matches spec §4.2, but a privileged user who has never enrolled TOTP can be enrolled from a password-only aal1 session, so a leaked password before the first sign-in yields aal2 for the attacker | Code path: `resolve()` → `totp()` → `mfa.enroll` with no check on how the session started; `scripts/ops/enrol-smoke-user.mjs:158-199` does the same by design | Allow a first enrolment only from an email-proven session (`amr` has `otp`/`magiclink`); bind it in M1's invite acceptance | M1 |
| M0B-SP-1 | Low | H4 / H1 | `docs/adr/ADR-030-candidate-token.md:71-73`; `docs/spikes/m0b-candidate-token/spike.mjs:552`; README `:64-74` | ADR-030 "Still to do in M0b" (re-run the spike after B0; tighten `rows=0` so it cannot pass alone) was neither done nor moved; README still shows 8 SKIPPED. The property itself is proven by `rls_roles` (`42501` on all 7 tables + audit write; `has_table_privilege` 0) | `git log 7dc8c0d..4cb6775 -- docs/spikes` = only the 3 B3 commits | Tighten `:552`, re-run, update README + ADR Evidence; or move both bullets to "Open for M3a" pointing at `rls_roles` | M0b FIX |

Carried Lows, re-checked in this review (owners are proposals; none blocks).
| ID | Status now | Owner |
| --- | --- | --- |
| B0-DB3 | Open (archive+rename audits create+archive only; remove+role change audits only the remove) | M1 (admin UI) |
| B0-DB7 | Open (live: an inactive staff member with no capabilities got a grant approved by another inactive one) | M0b FIX or M6 |
| B0-SEC4 | Logout **fixed** (`smoke-staging-auth.mjs:264-291`); session timebox/inactivity still commented out (`config.toml:287,289`), and the "H8 note" the B0 record cites does not exist | FOUNDER-QUEUE FYI now; settings M1 |
| B0-SEC5 | Open (`max_frequency = "1s"`, redirect URLs, `sms.enable_signup` not pinned by check-boundaries) | M1 |
| B0-SEC6 | Rule 3 effectively mitigated (the Vite plugin refuses non-`sb_publishable_` values, probed); rule 10 still direct-path only | M3a |
| B0-SEC7 | Open; every current `details` value is an id, enum, column name, `aal`, month or count | When the first free-value writer lands (M1) |
| B0-SEC8 | Open (staging ref not pinned in `enrol-smoke-user`/`smoke-staging-auth`) | M1 ops hardening |
| B0-SP3 | Open (sign-in triggers skip suspended orgs, `…547_m0b_auth_audit.sql:18,43`; untested either way) | M0b FIX (spec §2.5 sentence + pgTAP case) |
| B0-SP4, B0-SP5, B0-SP6 | **Fixed** (spec rev 6; `flow.ts:18-21` + `flow.test.ts:418`; floors recorded) | — |
| B0-SP7 | Partly open: gateway `SET ROLE` not executed; no pure-owner grant revoke; admin slug/kind; plus matrix gaps (reviewer UPDATE on orgs/workspaces, hiring_manager INSERT on workspaces, pure owner on teams, invited own `display_name`). The EXECUTE case is mitigated by `has_function_privilege` | M0b FIX (cheap cases) or M1 |
| B4-SEC-4 | Open, re-proved: parent `PGHOSTADDR`/`PGSSLMODE=disable` reach the psql child with a `127.0.0.1` URL | M1 ops hardening (allow-list) |
| B4-SEC-5 | Raw-URL part **fixed** (`lib.mjs:130-160`, probed); `require` still does not verify the CA | M1 |
| B4-SEC-6 | Open (smoke reads the Pages alias) | M1, optional |
| B2-SEC-1 | Open in code, unreachable (the plugin refuses `http://127.0.0.1:54321`, probed) | M1 |
| B2-SEC-4 | Open (no `onAuthStateChange`) | M1 |
| B2-SEC-5 | Open as specified (§4.6); founder FYI `FOUNDER-QUEUE.md:22` | Founder |

## Product rules R1–R15
- R1: `quality`/`integrity` hold no relations or functions; only `trace_quality_worker` has USAGE on `quality` and only `trace_integrity_worker` on `integrity`; neither is a member of the other; `rls_roles` + MT-14 `both_schemas` + MT-5c; no blended score field anywhere (grep). Clean.
- R2, R4, R6, R15: no candidate, decision or flag table; `db-types` pins exactly the 8 M0b tables; `audit_log.candidate_id` always null. Not applicable yet; nothing contradicts them.
- R5, R10: candidates never read M0b tables (`rls_roles`: `trace_candidate` → `42501` everywhere); candidate CSP never names `supabase.co`. Clean.
- R3, R7, R8, R9, R11–R14: no band engine, media, candidate, keystroke or voice code in the range. Not applicable.
- Rule 4 groundwork: `staff_access_grants` CHECKs (≤ 4 h, approver ≠ grantee), every grant/revoke audited into the tenant log, zero staff reads of tenant rows in M0b.

## Security and privacy summary (clean checks)
RLS on all 8 tables, the audit parent, 15 months and DEFAULT; one policy per operation, every UPDATE with USING + WITH CHECK; `true` only on `idempotency_keys` for `trace_worker` (ADR-029). All 27 `private` functions `security definer`, `search_path = ''`, owned by `postgres`, EXECUTE revoked except `my_org_ids`/`my_workspace_ids`/`valid_roles` for `authenticated`; `private` not exposed (`[api] schemas` = public, graphql_public). Operator detection fails closed for `supabase_admin` (probed). AAL rules enforced in the database (`membership_counts` fails closed on a missing or odd `aal`/`amr`). No service or secret key in `apps/*`; publishable key shape-checked at build. Strict recruiter CSP; zod on every contract; constant error bodies from `@trace/workers-http`. Staging secrets only on `deploy-staging` steps, smoke secrets only on the smoke step; `contents: read`. One new runtime dependency, `@supabase/supabase-js` 2.117.2 (ADR-028), pinned. Every email in the diff is `@example.test` or `@example.com`. Workers Logs: invocation logs off, query strings redacted, traces off. ADR-030 spike: non-extractable key, no token printed.

## Regressions and changes since the last review
- M0a findings owned by M0b: DB-1 (MT-11 `no_caller_reference`) built, but this review shows it is bypassable (M0B-DB-2); DB-2 (MT-2 `org_id_not_indexed`) built and tightened (B0-DB6); SPEC-F2 decided: Workers Logs on with invocation logs off. SPEC-F3 stays with M0a CLOSE.
- Every stream-review fix re-checked and holding: B5-SEC1, B0-DB1/DB2 (lock first; concurrency test still missing → M0B-DB-5), B0-DB4/DB6, B0-SEC1–3, B4-SEC-1/2/3, B2-SP1–3, B2-SEC-2/3.
- H2: no assertion deleted or weakened in the range; moved Worker error tests are stronger in `packages/workers-http` (36 cases) plus a wiring test per Worker; floors only went up (rls 0 → 686, catalog 112 → 133). H3: no TODO/FIXME/HACK in auth, RLS, audit or ops paths. H5: no new framework, DB or vendor.

## Not verified (and why)
- The staging items (AT-B9, AT-B10 staging run, DC-4 and DC-9 hosted): need founder rows H3–H5, H8–H11.
- Concurrency under REPEATABLE READ (M0B-DB-5): `dblink` is not installed and the review stays read-only; reasoned, not run.
- Hosted Supabase Auth settings (rate limits, session timebox, phone provider): not visible from the repo.
- `docs/milestones/M0b-summary.md` does not exist yet (a CLOSE deliverable; spec §1.2/§2.4 send four deferrals to it: T&S read path M6, partition-horizon job before 2027-09, replica-mode DR runbook M7, the H11 output).

## For the founder (plain language)
M0b is in good shape. Three independent reviewers found nothing serious, every test passes locally and on Linux CI, the audit log cannot be edited by anyone, and no personal data appears in any log. One safety check that watches for badly written access rules has a blind spot. It is not a hole today, but it must be closed in the next session (FIX), before new tables arrive. The remaining items are small and each has a milestone that owns it. Two checks need you: an org user signing in on staging, and migrations reaching staging only from CI. Both wait for the staging settings and secrets in the founder queue (rows 20–21). M0b also closes only after M0a does.
