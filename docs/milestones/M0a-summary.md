# M0a summary: toolchain, pipeline and skeleton

Written 2026-10-22 at the M0a CLOSE (draft by a Sonnet writer, checked and completed by the lead). Sections follow `docs/AUTOPILOT.md` §2 CLOSE (on `trace/d1/integration`): built, deferred and why, Deferred gates table, autopilot decisions, how to demo. Then Linear and the close record.
Evidence rule: every claim cites a path, a commit SHA or a CI run id. All data is synthetic.

| Field | Value |
| --- | --- |
| Milestone branch | `milestone/m0a`: reviewed tip `7dc8c0d` = tag `cp/m0a-06`, then the CLOSE commits (`02368f2` osv ignore; this summary and the review addendum); `main` was `fe77a87` |
| Spec | `specs/m0-foundations.md` revision 17 (commit `7dc8c0d`) |
| Review at tip | `docs/reviews/M0a.md` @ `7dc8c0d`: **BLOCK, founder-gated, no code defect**. SEC-1 (High) and SEC-2 (Medium) were GitHub-plan limits; SEC-3 (High) was missing staging secrets |
| Linux CI on the tip | Run 38199665080 on `7dc8c0d` (push, `milestone/m0a`): static, rls, security, migrations success; deploy-staging skipped by design |
| Windows clean clone (AT-1b) | Passed on `8a5706e` (`docs/progress/M0a-summary-draft.md` §4.1). Commits after `41f0bff` are docs by their subjects (`5b7ff1f`, `7dc8c0d`); not diffed |

## 1. What was built
Built to the build-order M0a list (`docs/build-order.md`, "M0a"); the review found no code defect. Per-step SHAs are in `docs/progress/M0a-summary-draft.md` §2 on `milestone/m0a`.
| Area | What exists | Evidence |
| --- | --- | --- |
| Workspace | pnpm workspaces: `apps/{candidate,recruiter}`, `packages/{config,db-types,shared,ui,vendors}`, `workers/{edge,jobs}`, `services/api`; ESLint boundary rules | draft §2.1 (`7a7854e`, `7714277`, `93b1f6f`); ADR-028 |
| Pipeline | `.github/workflows/ci.yml` jobs static, rls, security, migrations, deploy-staging; `pnpm verify` and `verify:fast`; `check-workflows`, `check-migrations`, `check-boundaries`, `check-headers`, `scan-dist`, bundle budget 150 KB gzip | CI run 38199665080; review gates G1-G9 |
| Commit path | Lefthook pre-commit and pre-push gitleaks, commitlint, Q56 deny rules for local deploys | `bdeb679`, `7bbcabd`, `b9b870f` |
| Database | baseline migration `20261011015904_m0a_baseline.sql` (no tables), pgTAP harness, 16 catalog checks with 85 branch fixtures, floors catalog 112 / rls 0 | review G5: 112/112 on CI |
| Shared code | PII-redacting logger and redactor, `serializeError`, `ErrorReporter` + no-op reporter, health and version contracts | `d434510`; AT-8, AT-9 |
| Apps and Workers | candidate (72.4 kB gzip, budget 150) and recruiter shells with `_headers`; edge, jobs, api Workers with `/health` carrying the deployed version | review G6; AT-10, AT-21, AT-22 |
| Deploy job | `deploy-staging` (migrations, catalog checks, scanned bundle uploaded with `--no-bundle`, Worker secret allow-list, Pages, smoke) | `f165fe0`; `docs/reviews/M0a-S3b-deploy-security-review.md` |

Exit gate (build-order M0a), status at CLOSE:
| Item | Evidence | Status |
| --- | --- | --- |
| Clean clone, `pnpm i && pnpm verify` green on Linux CI and on the founder's Windows machine | CI run 38199665080 on `7dc8c0d`; AT-1b on `8a5706e`; AT-1a-local on `dbb20c7` (0 skipped) | Met |
| `db reset` from zero; pgTAP and catalog meta-tests; `test:rls` fails without Docker | `docs/reviews/M0a.md` G5, AT-3 | Met |
| Staging deploys from CI only; health endpoints report the deployed commit | `deploy-staging` job success in runs 39566827826 and 39762460219 (steps "Deploy the api/jobs/edge Worker", "Deploy Pages", "Smoke test") | Met, with the caveat in §3 |
| No secret in history; pre-commit blocks a staged secret | gitleaks in `pnpm lint` and CI `security`; AT-5, AT-6 | Met. Secret scanning and push protection are also on (see below) |
| PII-redaction tests pass; no PII in logs | AT-8, AT-9; review ABH-80 scan: 0 hits in local verify and CI logs | Met |
| CI blocks merge on red | Ruleset 25633431 read back (below); red-PR probe TraceHiring/TraceHiring#5, run 39771691911, `mergeStateStatus` BLOCKED, closed unmerged | **Met** |

Close evidence read on 2026-10-22 with `gh api` (read-only):
- Repo `TraceHiring/TraceHiring` is **PUBLIC** (`visibility` PUBLIC). Founder, 2026-10-22, to lift a GitHub Actions billing block (`docs/progress/HANDOFF.md` on `d1/integration`). **This reverses FOUNDER-QUEUE line 29** (2026-10-15 answer "(c) stay on Free, the repo is never made public").
- Ruleset 25633431 "trace rule": enforcement active; target `~DEFAULT_BRANCH`; pull request required (0 approvals, merge method `merge` only); deletion and `non_fast_forward` blocked; required checks static, rls, security, migrations; `bypass_actors` empty; `current_user_can_bypass` never. This closes SEC-1. `e2e-local` is added after D1 merges (it exists only in the D1 `ci.yml`).
- `secret_scanning` enabled, `secret_scanning_push_protection` enabled; 0 open alerts; 16 alerts closed as `false_positive` (the `gcp-api-key` allowlist in `config/gitleaks-8.30.1/gitleaks.toml`, identical to upstream v8.30.1 per HANDOFF). This closes SEC-2. `dependabot_security_updates` is disabled (optional, founder).
- SEC-3 closed: staging secrets were set under the right names (FOUNDER-QUEUE "Resolved", rows 2026-10-11, done 2026-10-14).

## 2. What was deferred, and why
| Item | Why | Owner |
| --- | --- | --- |
| Sentry (AT-9-sentry, H6) | Founder deferred it until before D1; M0a ships a no-op `ErrorReporter` (`docs/build-order.md`, M0a) | D1. H6 projects exist (FOUNDER-QUEUE Resolved, 2026-10-14). Wiring is not checked by this draft |
| Catalog gaps D6 (trigger side effects) and D8 (cascading FK chain) | No tables existed to test against | M6 (`reports` junction); database-reviewer hand check in M4 and M5 |
| D7 and E1 shapes 3-5 (dynamic SQL, crafted literals) | Statically undecidable; outside the backstop scope (`docs/build-notes.md` §0, 2026-10-11 18:55) | Reviewer checklist, M4 and M5 |
| E3 (policies on system relations) | None exist on day one | Built on `d1/integration` as MT-11 `system_list_policy` (`supabase/catalog-checks/MT-11.sql`); confirmed at the D1 CLOSE |
| `scan-dist` residuals N11 and N13 (deliberate packing; keys over 8,192 bytes) | Accepted by the re-review | Accepted limits; reviewer checklist at every review, re-checked at M8 |
| ABH-80 restore drill and on-call alert | Needs production-like infrastructure | M8 |
| S3B-5 unordered staging deploys | GitHub concurrency does not order runs; staging only | M8, before any production deploy job |
| Redactor and `serializeError` reviewer-checklist items | Out of tool scope by the backstop decision | Next review of each area (draft §4.4) |
| `braces` advisory ignore | No fixed release; lint-time only | `osv-scanner.toml` stops ignoring on 2027-01-11; review before then and before M8 |
| M0a findings DB-1 (Medium) and DB-2 | MT-11 `no_caller_reference` and MT-2 `org_id_not_indexed` | Built in M0b; see `docs/milestones/M0b-summary.md` for the later bypass fix |

The staging evidence has a caveat. Runs 39566827826 (head `5306928`) and 39762460219 (head `df85dd4`) were `workflow_dispatch` runs on `d1/integration`. Milestone branches have no dispatch (HANDOFF, "CLOSE pre-flight"). So they prove the M0a deploy job and its code paths as carried into D1, not the `7dc8c0d` tree itself. The overall run conclusion is `failure` only because `e2e-staging` (a D1 test, AT-D1) failed; `deploy-staging` succeeded in both. A merge push to `main` would run `deploy-staging` with milestone code against the D1 staging and go red (HANDOFF, "Blocker B"). **Founder decision 2026-10-22: `[skip ci]` in the CLOSE merge commits.** The PR heads still pass the four required checks before the merge. Staging is re-proven from `main` at the D1 CLOSE merge.

Also at CLOSE: the required `security` check went red on the milestone tips from two new medium advisories in `@vitest/mocker` 4.1.11 (GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp; dev and test tooling only). With the founder's approval, `02368f2` cherry-picks the time-boxed ignore from `8c3c725` (expires 2026-11-05). Owner of the real fix: the vitest 4.1.12 bump on d1, on or after 2026-10-29.

## 3. Deferred gates (build-order rule 6)
| # | Check | Proxy test used | Owner milestone |
| --- | --- | --- | --- |
| 1 | AT-13: CI blocks a merge on red, shown by one deliberately red PR | Done at CLOSE: TraceHiring/TraceHiring#5, run 39771691911, BLOCKED, closed unmerged | Closed |
| 2 | AT-11, AT-18, AT-22-staging, AT-12/15/16 deferred parts on a run of the M0a tree | Run 39762460219 (deploy-staging all 16 steps success; step-to-AT map in `docs/reviews/M0a.md` "CLOSE re-review addendum"), on d1 code | D1 CLOSE: the first `deploy-staging` from `main` (the M0a/M0b merges use `[skip ci]`) |
| 3 | SPEC-F3: candidate `connect-src` lacks the staging edge origin | Resolved on `d1/integration` only (H4 answered: `abhayraj.workers.dev`, FOUNDER-QUEUE Resolved). `apps/candidate/public/_headers` on `milestone/m0a` is unchanged | D1 merge |
| 4 | L12: `check-workflows` run-text rule is a deny rule, not a sandbox | Reviewer rule: `.github/` changes reach `main` only through a PR with the four required checks (ruleset) | Standing reviewer item |
| 5 | AT-9-sentry, H6 | `noopErrorReporter` tests | D1 |
| 6 | ABH-80 drill and alert | PII log scan (0 hits) | M8 |
| 7 | D6, D8, D7, E3, N11, N13, S3B-5 | Catalog and scan tests as built | Owners in §2 |
| 8 | Staging secrets reachable by a dispatch from `d1/**` or `milestone/**` (FOUNDER-QUEUE:10, Medium, known gap) | Deployment-branch policy; the ruleset covers `main` only | Founder (optional: required reviewer on the `staging` environment); re-check at M8 |

Every row must pass by the M8 gate at the latest (`docs/build-order.md`, rule 6).

## 4. Autopilot decisions
- Founder answers that shaped M0a: `docs/build-notes.md` §0 (2026-10-11): Q54 no auto-push; H1 toolchain; CI option (b); Q55, Q56, Q57, D3 (150 KB budget); parallelism 3 writers, max 4; rule 1 catalog scope; backstop scope; `main` protection option (a); Bedrock option (a); D1 right after `m0b-reviewed`.
- Founder answers since the review: 2026-10-15 stay on GitHub Free (**superseded by the public repo on 2026-10-22**); 2026-10-15 deploy before merge by manual `workflow_dispatch` from `milestone/**` and `d1/**` (FOUNDER-QUEUE Resolved). The dispatch exists in the D1 `ci.yml` only.
- HOW-level changes are rows in `docs/build-notes.md` "Autopilot changes" (draft §7.2): local `--no-ff` stream merges, S1.7 lead step, Sentry deferral, dependency overrides, Windows skip exception K4, `check-workflows` run-text rule (`0179e2a`, `dbb20c7`, `41f0bff`).
- ADRs: ADR-028 is founder-approved. The draft found no ADR marked "Accepted (autopilot)" in M0a (checked 2026-10-12). Not re-checked here.
- Spec revision 17 records the Free-plan compensating controls (gitleaks pre-commit, `pnpm lint`, CI `security`). With the ruleset and push protection on, those become defence in depth.

## 5. How to demo
Run in a clone with Docker up. None of these was run while writing this draft.
| Show | Command | Source |
| --- | --- | --- |
| Fast checks | `pnpm verify:fast` | AT-4 |
| DB from zero, 112 catalog assertions | `pnpm test:rls` | `scripts/test-rls.mjs`; review G5 |
| `test:rls` fails with Docker down | stop Docker, run it | AT-3 |
| Staged secret blocked | scripts suite AT-6 / AT-6c | `scripts/test/hooks.test.mjs` |
| Redactor | `pnpm --filter @trace/shared test` | AT-8 |
| Build checks | `pnpm build` (bundle budget, headers, `scan-dist`) | AT-21, AT-22 |
| Workflow lint | `node scripts/check-workflows.mjs` | AT-12 |
| Clean clone | `node scripts/verify-clean-clone.mjs` (`--linux`) | AT-1a, AT-1b |
| Merge protection | Open the ruleset: https://github.com/TraceHiring/TraceHiring/rules/25633431 | read back above |
| Staging | `https://trace-<worker>-staging.abhayraj.workers.dev/health` for edge, jobs, api (shows the deployed SHA); Pages `trace-candidate-staging.pages.dev`, `trace-recruiter-staging.pages.dev` | FOUNDER-QUEUE Resolved (H4); `docs/infra/environments.md` |

Staging serves `d1/integration` code (last deploy in HANDOFF: `df85dd4`, tag `staging-applied-39762460219`), so `/health` shows that SHA, not `7dc8c0d`.

## 6. Linear
Linear is not connected (`specs/m0-foundations.md:922` per the draft; line not re-checked). Changes to list at CLOSE: ABH-80 (the observability scan part only). Lead to confirm.

## 7. Close record
- Tag `m0a-reviewed` only after a PASS or PASS WITH CONDITIONS where every Medium has an owner (`docs/AUTOPILOT.md` §2). Mediums: DB-1 (owner M0b, built), SEC-2 (closed).
- Merge `milestone/m0a` into `main` by PR, "Create a merge commit", `[skip ci]` in the merge commit; founder go-ahead in chat 2026-10-22 ("yes, if all green").
- After the merge, update `docs/AUTOPILOT.md` §6 (`main` no longer takes direct pushes).
- Optional founder items: fork-PR approval for outside contributors, Dependabot alerts, strict status checks on the ruleset (HANDOFF).
- **CLOSE addendum verdict: PASS** (fresh Opus reviewer plus the lead's red-PR probe; `docs/reviews/M0a.md` "CLOSE re-review addendum").
- **Full `pnpm verify` at CLOSE on `02368f2`** (lead, no agent running; tests with `pnpm -r --workspace-concurrency=1`): typecheck, lint, package tests, scripts 1299 passed + 1 skipped (K4), `test:rls` catalog 112 (floor 112) / rls 0, build all exit 0. An earlier run with three agents active failed 6 ReDoS timing tests in `packages/shared/src/log/redact.test.ts` (61 ms vs a 50 ms budget); the suite passed 570/570 alone and in this run. Load-sensitive, not a regression.
- Merge commit and tag `m0a-reviewed`: recorded in `docs/progress/LOG.md` on `d1/integration` (this file is committed before the merge).
