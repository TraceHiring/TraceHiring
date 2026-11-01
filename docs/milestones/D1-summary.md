# D1 summary: demo slice

Written 2026-11-01 at the D1 CLOSE by the lead (Opus 5.5, D1 close chat). Sections follow `docs/AUTOPILOT.md` §2 CLOSE: built, deferred and why, Deferred gates table, autopilot decisions, how to demo. Then the AT-D2 record, Linear and the close record.
Evidence rule: every claim cites a path, a commit SHA or a CI run id. All data is synthetic (`@example.test` contacts, synthetic staging users in the `smoke-staging` org).

| Field | Value |
| --- | --- |
| Branch | `d1/integration` (worktree `.claude/worktrees/d1-integration`); draft PR TraceHiring/TraceHiring#4 into `main` |
| Range | `trace/main` = `da5380d` (`m0b-reviewed`) to the CLOSE tip: 474 commits before this file, 615 files, +115 794 / −945 lines |
| Spec | `specs/d1-demo-slice.md` revision 4p (`d658b83`) |
| Review | `docs/reviews/D1.md`: first review BLOCK (D1-SPEC-1 High) → FIX → re-review CONFIRMED; "Review of the remainder" (`ceb0837..f226950`): PASS WITH FIXES (spec), APPROVE WITH FIXES (database/security), D1R-DB-1 fixed `1d36151`. **No open High or Medium** |
| Staging on the reviewed code | Dispatch 39820502191 on `1547fd0`: all 7 jobs success (static, rls, security, migrations, e2e-local, deploy-staging, e2e-staging) |
| Dependency port at CLOSE | `4ea2739`, `791f3b1`, `ca64856` (from `m1/integration` `b397a29`, `2d91744`, `208e5ae`): zod 4.6.6, vitest 4.1.12, undici 7.30.1, happy-dom 20.14.6, dated osv ignores. No source change |
| Floors | rls 2633, catalog 144 (`test:rls` on `a395c24`, `docs/progress/HANDOFF.md`) |

## 1. What was built
Exit gate (`docs/build-order.md:37`), status at CLOSE:
| Item | Evidence | Status |
| --- | --- | --- |
| Recruiter creates a test (written + MCQ) and invites by link | `services/api/src/modules/tests/publish.test.ts`, `invitations/invitation.test.ts`; `apps/recruiter/src/d1-guards.test.tsx`; e2e slice steps 1-4 | Met |
| Candidate takes it in the browser: server-held timer, start photo, autosave | `workers/edge/src/session-do.timer.test.ts`, `session-do.autosave.test.ts`, `photo.test.ts`; `apps/candidate/src/photo/blur.test.ts`; e2e steps 5-6, 10 | Met |
| Answer Quality (0-100, mock grader) and Integrity band with evidence timeline as two separate results | AT-D3 (three strict DTOs, `ReportPage.test.tsx`, `packages/config/test/rule1-separation.test.ts`, `rls_d1_cards`, `rls_d1_reports`); AT-D4-D6 band property tests; AT-D19 `FlagCard.test.tsx`; e2e steps 7-8 | Met |
| A reviewer opens the report | AT-D10 media-link tests, `rls_d1_assignments`, `rls_d1_media_view`; e2e steps 8-9 | Met |
| Deployed on `*.workers.dev` / Pages | `deploy-staging` green in dispatches 39797279887 (`f226950`) and 39820502191 (`1547fd0`) | Met |
| Full flow passes an automated E2E test on staging (AT-D1) | `e2e-staging` in 39820502191: spec `d1-slice`, 55/55 steps ok, `durationMs` 304 726 | Met (on `1547fd0`; see §3 row 1) |
| A 5-minute screen recording (AT-D2) | Rule and duration gate in place (D1-SPEC-2, `2f0e249`; spec §7.3); the capture is the founder's (§6) | See §6 |

What exists, by area:
| Area | What | Evidence |
| --- | --- | --- |
| Database | Five D1 migrations plus the forward fix `20261021091905_d1_flags_rule_table.sql` (flags must match the session's pinned rule table, D1-DB-1); RLS on every table, separate policies per operation; 32 pgTAP files | `supabase/migrations/2026101*_d1_*.sql`; D1.md "Database summary" |
| Band engine | `packages/band-engine`: pure, versioned rule table `d1-v1.json`, T3 cap, unvalidated rules context-only, low coverage → `insufficient_evidence` | property tests P1-P10; D1.md R3 |
| Candidate runtime | `workers/edge` (`SessionDO`, `InviteOtpDO`, ES256 token, photo upload, link rate limit) and `apps/candidate` (link, OTP, age, consent, camera with on-device blur, test, receipt) | AT-D23-D37 (spec §4.8) |
| Results | `workers/jobs`: mirror, quality, integrity stages from one Queue, idempotent per `${sessionId}:${job}:${rulesetVersionId}`; consumer runs up to 3 sessions, one integrity stage at a time per batch | AT-D16; `f226950`, `1d36151` |
| Recruiter and reviewer | `apps/recruiter` test editor, invitations, results list, report with two separately loaded cards, 5-minute single-use watermarked photo link; `services/api` org and candidate RPC routes | AT-D3, AT-D10, AT-D13, AT-D14 |
| Guards | AT-D21 never-build scan (`packages/config/test/never-build.test.ts`), route inventory without any reject path, no-demo-outbox build check, Sentry scrubber | D1.md FIX table |
| CI and staging | `workflow_dispatch` staging deploy from `d1/**`, `e2e-local` and `e2e-staging` jobs, Hyperdrive with the Supabase CA (ADR-031 amendment 1) | `.github/workflows/ci.yml`; `scripts/ops/README.md` |

## 2. What was deferred, and why
| Item | Why | Owner |
| --- | --- | --- |
| D1R-DB-2: `max_concurrency` on the mirror consumer vs Hyperdrive `origin_connection_limit` 5 | Low; failure mode is a stage timeout and a retry, the stage keys prevent double writes; the fix needs a staging AT-D17 check | **M3a** |
| D1R-SEC-1: socket-counting test for the consumer | Low; the comment is fixed (`1d36151`), the test is not written | **M3a** |
| D1R-SPEC-7: 3 of 5 `messagingSend` invocations end `canceled` on staging | Note; cause unknown, AT-D18 unaffected | **M3a** (with OPEN-8a) |
| D1-DB-2: media-link jti checks look back only 330 s | Low; not exploitable today (`MediaLinkDO` burns each jti, `randomUUID` ids) | **M3a** |
| D1-SEC-3 (c, d): pin of the Playwright internal; fixture spec for leaked secrets | Low; (a, b) fixed in `cd2cffe` | **M1** |
| D1-LEAD-1: gitleaks-driven tests slow under load on Windows | Tooling; green on Linux CI | **M1** |
| N-1: MT-9 `hosted_member` fingerprint | Low; needs hosted extension versions | **M1** |
| Peak memory of the consumer's worst case | Estimated (32-54 MB per integrity stage), not measured | **M3a** |
| `scripts/test/gitleaks-config.test.mjs` random-input flake | Make the random `body()` draw deterministic or entropy-checked; never loosen the assertion | **M1** (tooling) |
| Other carried items (DB-6, DB-7, DB-12, SEC-W1-1, C2 SEC-3/5/6, FR-1, M0B-DB-1, token lifetime) | Owners in D1.md "Carried items" | M1 / M3a / M3b / M4 / M5 / M7 |

## 3. Deferred gates (build-order rule 6)
| # | Gate | Proxy used now | Owner |
| --- | --- | --- | --- |
| 1 | AT-D1 and AT-D17 on the CLOSE tip | Dispatch 39820502191 on `1547fd0`. The CLOSE tip adds only the dependency port (lockfile, workspace config, osv file, build-notes; no source file) and docs; CI on PR #4 covers it locally (`e2e-local`). A new dispatch on the CLOSE tip needs the founder's approval in chat | Founder (dispatch) |
| 2 | **AT-D17 ≤ 30 s p95 target** | Gate (fails above 90 s) passes: 39820502191 `time_to_ready_ms` A 46 307, B 30 833, C 69 999, D 19 441 (max 70.0 s, n = 4). The 30 s target is a recorded deviation (spec 4p §5.1, D1R-SPEC-1) | **M5** ("deterministic scores p95 < 30 s after submit") |
| 3 | **OPEN-8a Workers Paid** | DC-D8 FAIL against Free 10 ms (jobs consumer 50-99 ms, sweep ≤ 42 ms, api RPCs 12-30 ms; every invocation `ok` except D1R-SPEC-7); founder 2026-10-22: **"not yet"**, D1 closes without it | Founder; decide **before any load test (M3a)** |
| 4 | DC-D7 staging half | Passes through Hyperdrive (AT-D1 green through the four configs) | Closed |
| 5 | First `deploy-staging` from `main` | Depends on the CLOSE merge commit (with or without the skip-ci marker, founder's call); the M0b summary §3 row 3 points here | Founder at the merge |
| 6 | `e2e-local` back on ruleset 25633431's required checks | Taken off for the M0a/M0b CLOSE PRs | Founder after the D1 merge |

## 4. Autopilot decisions (and founder answers)
- ADR-030 (candidate token, ES256; Accepted in part), ADR-031 (`postgres` 3.4.9 driver; amendment 1: Hyperdrive with the Supabase CA on staging), ADR-032 (coarse edge link rate limit): all "Accepted (autopilot)".
- Lead, 2026-10-22: the jobs consumer runs sessions side by side (cap 3, founder chose concurrency over a slower AT-D17) with one integrity stage per batch (D1R-DB-1), not a lower cap.
- Lead, 2026-10-22: AT-D17's 30 s target is a deviation owned by M5; the 90 s gate is unchanged (spec 4p).
- Founder, 2026-10-22: Workers Paid "not yet"; D1 paused (not closed) while M1 builds on `m1/integration` (cut from `1547fd0`).
- Lead, 2026-11-01 (this chat): `pnpm audit --prod --audit-level=high` failed on zod GHSA-mrhx-c7xc-m3w5, so the three dependency commits already on `m1/integration` were cherry-picked as lead commits; the lockfile conflict was resolved by regenerating it (equal to m1's minus M1-only packages).
- Lead, 2026-11-01: `staging-applied-*` tags added for dispatches 39787385654 (`f9ba70d`), 39791480658 (`3d1d196`), 39797279887 (`f226950`) and 39820502191 (`1547fd0`), per `scripts/ops/README.md` ("after every dispatch whose Apply migrations step passed"). Their frozen migration set is the same as `staging-applied-39762460219` (`git diff f9ba70d HEAD -- supabase/migrations` is empty).

## 5. How to demo
| Show | Command or place | Source |
| --- | --- | --- |
| The whole flow, local | `node scripts/e2e-local.mjs` (Docker up): Supabase, three Workers, both apps, then Playwright `d1-slice` project `local` | spec §7.2; CI `e2e-local` |
| The whole flow, staging, recorded | `pnpm e2e:record` (headed, captions, 1280x720) with the steps in §6 | spec §7.3 |
| Two separate results | report B on the recruiter app: two cards from `…/quality` and `…/integrity`, band Review with the paste flag and timestamp | e2e step 8 |
| Below cutoff is not reviewed | report D: "Not reviewed (below cutoff)", no band or timeline in the response | e2e step 8; AT-D14 |
| Tenancy and DB rules | `pnpm test:rls` | `scripts/test-rls.mjs` |
| Staging apps | `https://trace-recruiter-staging.pages.dev`, `https://trace-candidate-staging.pages.dev` | `scripts/e2e-staging-preflight.mjs` `STAGING_ORIGINS` |

## 6. AT-D2 recording (founder capture)
The deliverable is one OS-level screen capture of the headed `pnpm e2e:record` run against staging (spec §7.3, D1-SPEC-2). `e2e:record` exits 0 only when the manifest's `recordedMs` is within 270 000-330 000 ms. The file is not committed; it is attached to the dispatch run as an artifact.

| Field | Value |
| --- | --- |
| File name | pending (founder) |
| SHA-256 | pending |
| `recordedMs` | pending |
| Dispatch run id (staging serving the recorded SHA) | pending |

## 7. Linear
Linear is not connected. Nothing to change for D1.

## 8. Close record
- **Full serial `pnpm verify` green on `ca64856`** (2026-11-01, lead, no agent running; the later commits are docs only): `pnpm -r --workspace-concurrency=1 typecheck` 0; `pnpm lint` 0 (eslint, prettier, boundaries, workflows, catalog tests, migrations); `pnpm -r --workspace-concurrency=1 test` 0 (12 packages, 3 784 tests); `pnpm exec vitest run --root scripts --maxWorkers=1` 54 files, 2 715 passed + 1 skipped (K4); `pnpm test:rls` OK (32 test files, catalog 144 / floor 144, rls 2633 / floor 2633, db-types current); `pnpm -r --workspace-concurrency=1 build` 0, then `check-bundle-size` (candidate 81.9 kB gzip, photo chunk 3.5 kB, recruiter 351.5 kB information only), `check-headers`, `check-no-demo-outbox`, `scan-dist` all OK. `pnpm audit --prod --audit-level=high`: no high (1 moderate, minimatch GHSA-g3hv-75wg-m249, dated osv ignore).
- CI on PR #4 for the CLOSE tip: pending.
- Checkpoint tag: pending.
- CLOSE PR merge ("Create a merge commit"; required checks static, rls, security, migrations green on the PR head): only after the founder's go-ahead in chat.
