# Milestone M0a review — Toolchain, pipeline and skeleton
2026-10-12 · Lead: Opus 5.5 session that did not write the M0a code (founder's overnight decision, `docs/build-notes.md` §0 "Overnight session" (2)); judgment reviews by three fresh-context Opus subagents (`security-reviewer`, `database-reviewer`, `spec-reviewer`) · Commit range `fe77a87..41f0bff` on `m0a/integration` · Files changed: 376

## Verdict: BLOCK (founder-gated; no code defect)
No reviewer found a Critical, High or Medium defect in the code, the migration, the catalog checks or the CI workflow; every earlier stream-review fix was re-checked and holds. The verdict is BLOCK because one exit-gate item cannot be met on the current GitHub plan (SEC-1 High: branch protection and rulesets are unavailable on a private repo of a Free personal account, so "CI blocks merge on red" cannot be enforced), and the staging gates still wait for founder secrets (SEC-3, tracked). Both need the founder (`docs/progress/FOUNDER-QUEUE.md`). Once SEC-1 is decided and the staging run passes, a re-review of the CLOSE tip can PASS WITH CONDITIONS (two Medium/Low items are owned by M0b).

## Gates
Run by the lead on 2026-10-12 unless marked. Raw logs were kept in the session scratchpad.
| Gate | Command | Result | Notes |
| --- | --- | --- | --- |
| G1 Clean install | AT-1b `node scripts/verify-clean-clone.mjs` (Windows, path with spaces, `8a5706e`); AT-1a-local `--linux` (`0179e2a`, re-run on `dbb20c7`) | pass | "Lockfile is up to date"; Linux re-run: scripts 1290 passed, 0 skipped |
| G2 Typecheck | full `pnpm verify` on `41f0bff` | pass | |
| G3 Lint | same (includes prettier, check-boundaries, check-workflows, gen-catalog-tests `--check`, check-migrations, gitleaks over full history) | pass | |
| G4 Tests | same | **all package suites pass** (config 324, db-types 2, shared 618, vendors 1, ui 67, candidate 80, recruiter 68, jobs 34, api 34, edge 29); scripts 1295 passed, 1 suite failed by timeout | `commitlint.test.mjs` `beforeAll` passed 60 s while three review agents loaded the machine (cold import; the known load flake, HANDOFF "Timing tests flake under load"). The same suite passed in AT-1a-local, AT-1b and CI run 38196819481. Re-run on an idle machine: see "Re-run" below |
| G5 DB from zero + pgTAP | `pnpm test:rls` inside verify; CI `rls` job | pass (CI run 38196819481 on `41f0bff`) | 112/112 catalog assertions (floor 112); `rls-min-count` 0 (M0a) |
| G6 Build | inside verify | pass | candidate 72.4 kB gzip (budget 150), headers OK, `scan-dist` clean |
| G7 E2E | — | not required (from M3) | |
| G8 Audit | `pnpm audit --prod --audit-level=high` on `41f0bff` | pass | "1 ignored: 1 high" = the documented `braces` ignore (path only through `@trace/config` dev tooling); CI osv-scanner "No issues found" |
| G9 Secrets | `gitleaks git` in `pnpm lint`; CI `security` run 38196819481 | pass | "272 commits scanned … no leaks found"; no `.gitleaksignore`, no `gitleaks:allow` |
| G10 Skipped/focused | `\.(skip\|only)\(\|\bxit\(\|\bxdescribe\(\|test\.todo\|\bSKIP\b` over apps, packages, workers, scripts, supabase | 7 hits, 1 real skip | 6 are the TAP parser and its tests treating `# SKIP` as failure; the real one is K4 (`scripts/test/scan-dist.test.mjs:689-693`, Windows EPERM symlink; runs on Linux CI) |
| G11 Escape hatches | `: any\b\|as any\|@ts-ignore\|@ts-expect-error\|eslint-disable` in non-test `src` of apps, packages, workers | 0 | Only generated `worker-configuration.d.ts` and test fixtures |
| G12–G14 | — | not required for M0a | |
| CI (Linux) | GitHub Actions run 38196819481 on `41f0bff` | static ✓, rls ✓ 2m35s, security ✓, migrations ✓; deploy-staging skipped (PR event, by design) | |

## Exit gate (build-order M0a)
| Item | Evidence | Status |
| --- | --- | --- |
| Clean clone → `pnpm i && pnpm verify` green on Linux CI | AT-1a-local (`dbb20c7`, 0 skipped); CI run 38196819481 on `41f0bff` | Met on the current tip's CI; AT-1a-CI is re-recorded on the CLOSE tip |
| …and once on the founder's Windows machine | AT-1b on `8a5706e` (scripts 1262 + 1 K4 skip, `test:rls` 112/112) | Met; re-run at the CLOSE tip if code changes |
| `supabase db reset` rebuilds from zero; pgTAP harness runs; catalog meta-tests pass | AT-2/AT-19/AT-23; database reviewer ran all 16 checks read-only on the live stack (0 rows each) and `gen-catalog-tests --check` ("OK (101 assertions)") | Met |
| `test:rls` fails if Docker is down | AT-3 `scripts/test/test-rls.test.mjs:126` and siblings | Met |
| Staging deploys from CI only; every health endpoint responds with the deployed commit | Local: AT-10, AT-12, AT-15, AT-16; staging branch policy read back `main` only | **Deferred to CLOSE** (AT-11, AT-18, AT-22-staging; needs SEC-3 secrets and H4) |
| No secret in history (gitleaks clean); pre-commit blocks a staged secret | AT-5, AT-6, AT-6c; CI `security` | Met |
| PII-redaction tests pass | AT-8, AT-9; ABH-80 log scan (below) | Met |
| CI blocks merge on red | AT-12 local part | **Not met — SEC-1** (protection unavailable on the plan) |

**ABH-80 "no candidate PII is found in logs (scan)".** Scanned the full `pnpm verify` output on `41f0bff` (lead) and the CI logs of run 38196819481 (security reviewer: static 826 lines, rls 334, security 403) for email, Indian mobile, Aadhaar, PAN, IPv4 and JWT shapes: **0 hits** in each.

## Findings
| # | Severity | Check ID | file:line | Problem | Proof | Fix | Must fix by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-1 | High | S9 / AT-13 | `specs/m0-foundations.md:479-484` | Branch protection and rulesets are unavailable: private repo of the personal account `TraceHiring` on GitHub Free. "CI blocks merge on red" cannot be enforced; the L12 residual's control ("`.github/` changes reach `main` only through a reviewed PR") cannot exist; a direct push to `main` would run `deploy-staging` | `gh api repos/TraceHiring/TraceHiring/branches/main/protection` → 403 "Upgrade to GitHub Pro or make this repository public" (re-run by the lead); `/rulesets` → 403; `.owner.type` = `User`, private | Founder: plan upgrade or move to a paid organisation, then apply §7.4 and read back; or accept AT-13 as not met (FOUNDER-QUEUE row `:15`) | M0a CLOSE (founder) |
| SEC-2 | Medium | S9 | `specs/m0-foundations.md:479` | Secret scanning and push protection are off and unavailable on this plan | `security_and_analysis` = null; default workflow token is read-only (read back) | With SEC-1; recorded in spec revision 17 with compensating controls (gitleaks pre-commit, `pnpm lint`, CI `security`) | M0a CLOSE |
| SEC-3 | High (tracked) | S9 | `docs/progress/FOUNDER-QUEUE.md:6-7` | The `staging` environment still holds a secret whose *name* is a Cloudflare token value; `CLOUDFLARE_API_TOKEN` and `SUPABASE_STAGING_DB_URL` are missing | `gh api …/environments/staging/secrets` (names only) | Founder rolls the token and sets the correctly named secrets (queue rows 6–7) | Before the first `deploy-staging` run |
| SEC-4 | Low | S10 | `docs/founder-steps.md:53` | `curl … install.sh \| bash` in a human setup doc | grep | **Fixed in this FIX pass:** download, read, then run | — |
| DB-1 | Medium | S1 | `supabase/catalog-checks/MT-11.sql:252-270` | A permissive policy that uses a column but never references the caller (soft-delete `using (deleted_at is null)`) ORs open every org's rows, and no check fires | Rolled-back repro on the local stack: MT-1/2/11 return 0 rows while `authenticated` with org A claims reads the org B row | New MT-11 branch `no_caller_reference` + fixture + restrictive negative control; floor up | **M0b** (before the first tenant table; in the M0b spec §5) |
| DB-2 | Low | S1 | `supabase/catalog-checks/MT-2.sql:61-117` | No check that `org_id` leads an index on in-scope tables | Same rolled-back table, no index, all checks clean | MT-2 branch `org_id_not_indexed` | **M0b** (M0b spec §5) |
| SPEC-F1 | Low | H6 | `docs/progress/M0a-summary-draft.md` | Stale summary: an open `TODO` verdict row, shifted line cites into the spec and the founder queue | reviewer cite checks | **Fixed in this FIX pass:** verdict row recorded; spec cites remapped mechanically from revision 15 to the current file; queue cites corrected | — |
| SPEC-F2 | Low | H4 | `workers/*/wrangler.jsonc` `observability: { enabled: false }` vs `specs/m0-foundations.md:752` | Spec said edge logs go to Workers Logs; they are off, so staging keeps no Worker logs; the recorded reason ("until ADR-027 records it") was wrong (ADR-027 lists Workers Logs) | read | Spec revision 17 records the current state; **M0b decides** on or off | M0b |
| SPEC-F3 | Low | H4 | `apps/candidate/public/_headers:3`; `specs/m0-foundations.md:830` | Candidate `connect-src` lacks the staging edge origin and `check-headers` accepts that | `checkCsp` returns no violation | Spec revision 17 records it as deferred with owner M0a CLOSE (needs H4) | M0a CLOSE (with H4) |
| SPEC-F4 | Low | H6 | `docs/build-order.md:38`; `README.md:27` | D1 placement shown as open (answered (a)); README usage-guard thresholds 80/90 (now 90/95) | read | **Fixed in this FIX pass** | — |

Not raised as a finding: the database reviewer could not test (permission denied, correctly not worked around) whether supautils lets `postgres` grant `service_role` to `authenticated` or set `bypassrls` on Supabase roles. No check covers it today; the M0b spec adds MT-14 branches and a day-one check (DC-6).

## Product rules R1–R15
- R1: no blended score field anywhere; `quality`/`integrity` schemas separate with privileges revoked; MT-5a–5d and the ESLint rule-1 boundary in place. Clean.
- R2: no status-changing code; MT-3 and MT-6 guard reject columns/enums in `integrity`. Clean.
- R3–R6, R9–R15: no code in M0a; nothing contradicts them (MT-3 bans dob/birth columns for R9; MT-10 requires `security_invoker=true` views for R5). Clean.
- R7: MT-3 bans emotion/voiceprint/face_template/gaze_flag/honesty/trust_score/cheat columns; no inference, IP or ASN flag code. Clean.
- R8: no media capture code (`getUserMedia`/`MediaRecorder`/`getDisplayMedia` absent); candidate Permissions-Policy per spec §10.3. Clean.
- PII in fixtures: only `*.example.invalid` / `*.example` addresses; values built at run time. Clean.

## Regressions and changes since the stream reviews
Every stream-review fix was re-checked and holds: S3A-1 non-Error middleware in all three Workers; S3B-1/S3B-6 (scanned bundle uploaded with `--no-bundle`, `sslmode` check, URL redaction); the run-text rules of `0179e2a`/`dbb20c7`/`41f0bff` (probed with backslash-newline, brace, `$''`, `GITHUB_PATH`, `defaults: {Run|Shell}` splits); the w1-w2 and S1.7 gate spec findings (#1–#6, K1–K5). No test lost an assertion in the range; no floor went down.

## Re-run
Full `pnpm verify` on the FIX tip with no agent running: see `docs/progress/LOG.md` (row of 2026-10-12, this session).

## Not verified (and why)
- The staging gates (AT-11, AT-18, AT-22-staging, deferred parts of AT-12/15/16): need the founder's secrets and the CLOSE push to `main`.
- GitHub repository settings beyond the read-only token: unavailable on the plan (SEC-1/2).
- Whether the Actions SHAs match their `# vX.Y.Z` tags upstream (offline check only).
- Cloudflare token scopes and the AWS IAM policy (not visible from the machine).
- The Supabase role-membership question above (DC-6 in M0b).

## For the founder (plain language)
The M0a code is in good shape: three independent reviewers found nothing wrong with it, every test and check passes on Linux CI, and no personal data shows up in any log. Two things only you can fix stop it from closing. First, GitHub's free plan for a private personal repo does not let us lock the `main` branch so that failing checks block a merge. Upgrade the plan, move the repo to a paid organisation, or tell us to accept the gap for now (FOUNDER-QUEUE, first rows). Second, the staging secrets still need to be rolled and renamed, so the first staging deploy can run. Two small database-check improvements are scheduled into M0b, which is being specced now.
