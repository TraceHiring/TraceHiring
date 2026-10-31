# Resume prompt — the full procedure for the next Claude Code session (any account)

Written 2026-10-11 09:25 IST by the lead session; updated 20:10 and 23:50 IST, and 2026-10-12 01:45 IST. Everything the next session needs is in git; nothing from Updated 2026-10-12 09:25 IST: M0b on `d1/integration`.
earlier chats is available or needed. Updated 2026-10-12 12:35 IST: M0b spec approved, BUILD started. The short "paste prompt" the founder uses points here.

## 1. What Trace is and where the build stands
- Trace: an India-first online assessment platform; every integrity flag comes with evidence. CLAUDE.md holds
  the 9 non-negotiable product rules (a violation is a blocking bug) and the engineering rules.
- Build: milestones M0a → M13 in `docs/build-order.md`. Each milestone goes SPEC → BUILD → REVIEW → FIX → CLOSE
  (`docs/AUTOPILOT.md` §2, exactly ONE phase per session).
- **Update 2026-10-31 07:55 IST (newest):** candidate contract changes `937da1b` (R5-23) on `m2/integration` (tip
  `937da1b`); the winnat restart did not free 54282-54381 (see HANDOFF). **Update 2026-10-31 00:35 IST, Wave 0b
  part 1:** on `m2/integration` (tip `e9df567`): red pgTAP
  `0387440`, migration M2-c `83185ff` (wip: pgTAP green via docker exec; `db-types` not regenerated, `.claude/allow-red`),
  AT-M2-08 race `494ab5a`, `contracts-m2.ts` `c3c00e2`, build-notes `e9df567`. Local blocker: Windows reserved TCP
  54282-54381 (the stack's host ports); founder frees it with `net stop winnat` / `net start winnat` (admin). Next chat:
  HANDOFF "Next step" 1 (db-types, test:rls) then the Wave 0b remainder.
- **Update 2026-10-27 12:55 IST, M2 BUILD 1 Wave 0a done:** on `m2/integration` (tip `2d5d98a`): red pgTAP
  first, migrations M2-a (`20261027040000_m2_contacts.sql`) and M2-b (`20261027050000_m2_drives.sql`), MT-15, floors
  catalog 153 / rls 4249, ADR-034 (`aws4fetch`), ADR-030 amendment 1; local serial gate green; draft CI PR
  TraceHiring/TraceHiring#16 (`m2/integration` → `main`, never merge) opened, CI pending at handoff. Next chat:
  **Wave 0b** (M2-c messaging, contracts, wiring, CI job, day-one checks), HANDOFF "Next step".
- **Update 2026-10-27 11:30 IST, M2 SPEC refresh done:** `specs/m2-scheduling-invites.md` revision 5 is
  **approved by autopilot reviewers** (binding rows R5-1…R5-66; three Opus audits + three Opus review rounds) on the new
  branch **`m2/integration`** (cut from `m1/integration` @ `7c33f48`, tip `7b73de0`). Key choices: D1's start path
  kept plus a start-window check (R5-63); CSV-only invites until founder Q-M2-4; `aws4fetch` = ADR-034; M2
  migrations provisional. M1 CLOSE still waits for the D1 CLOSE + go-ahead. Next chat: **M2 BUILD 1 = Wave 0** on
  `m2/integration` (M2 spec §11.2). HANDOFF "Next step".
- **Update 2026-10-27 09:05 IST, M1 FIX done:** M1-REV-1, -2, -6, -7, -8 fixed one commit each, red first
  (migrations M1-t, M1-u, M1-v; spec R5-72); M1-REV-3 → M10, M1-REV-4/-5 and two re-review Lows → M5; Opus database +
  security re-reviews all CONFIRMED; serial gate green on `3cfbea8` (rls 3919 = floor); CI 40443964937 green. **M1
  CLOSE waits for the D1 CLOSE and the founder's go-ahead.** Next unblocked chat: **M2 SPEC refresh** (R5-1) on a new
  `m2/integration` cut from `m1/integration`. HANDOFF "Next step".
- **Update 2026-10-27 08:20 IST, M1 REVIEW done = PASS WITH CONDITIONS:** `docs/reviews/M1.md` (`e25b12f`):
  all gates green (verify:fast, test:rls rls 3893, build, audit, gitleaks; CI 40436871364 + 40436931164 on `acceb02`,
  AT-M1-10 11,700 ms); no Critical/High, no rule 1-9 breach. Mediums M1-REV-1 (authoring worker reads variant keys)
  and M1-REV-2 (retired library copy blocks from-template) are M1 FIX; M1-REV-3 (option ids) is M10; five Lows.
  Next: **M1 FIX in a fresh session**, then CLOSE after the D1 CLOSE + founder go-ahead. HANDOFF "Next step".
- **Update 2026-10-27 07:45 IST, M1 BUILD 5 done = BUILD complete:** the lead's owed items merged and
  reviewed: migrations M1-p (D1 shape under the row lock, derived paste rule, no client job ids), M1-q (atomic
  `create_test_from_template`, `save_bank_draft`), M1-r (one lock order), M1-s (review fixes); api streams a8
  (from-template one RPC, template paging) and a9 (bank RPC); spec R5-71 a-i; full serial gate green on `5d6f37b`
  (rls 3893 = floor). `docs/milestones/M1-summary.md` drafted. Next: read CI on `acceb02` + dispatch 40436931164 (`static` on `5d6f37b` failed, fixed `acceb02`),
  then **M1 REVIEW in a fresh session** (`trace-milestone-review`). HANDOFF "Next step".
- **Update 2026-10-26 23:45 IST, M1 BUILD 4 = Wave 3 merged:** A7 candidate app v2 merged (two fix rounds,
  re-reviews CONFIRMED); new stream A5d (R5-69/R5-70) wired the recruiter wizard steps 2-4 and v2 save/publish, merged;
  E2E specs merged; AT-M1-01 170.9 s, AT-M1-30 133.4 s, AT-M1-10 10.0 s green on Linux CI (spec §8); two api bugs the
  E2E found fixed (`062e0b8` jsonb `amr`, `0a7199f` REST name check). Next: the lead's owed items before the M1 exit,
  then the M1 REVIEW in a fresh session. HANDOFF "Next step"; RAM gotcha: run the gate serially.
- **Update 2026-10-24 10:00 IST, M1 BUILD 4 = Wave 3 started:** CI security green again (zod 4.6.6, dated dev-tooling osv ignores); A2a merged `ae19cbf` + mounts `d973099`; M1-o `publish_source_v2` + one-call package source (R5-65); full serial verify + CI green on `d973099` (rls 3784); R5-66 A7 decisions; A7 built on `m1/a7-candidate` @ `b89e2ea`, **Opus first reviews owed first**. HANDOFF "In flight" and "Next step".
- **Update 2026-10-24 01:00 IST, M1 BUILD 3 = Wave 2 part 6:** A2a spec review PASS WITH FIXES (R5-64); lead migrations M1-m (`09bb62b`: D1, D2 view, D4, D6, D7) and M1-n (`d510bd6`: stranded drafting-job sweep) + jobs cron sweep (`134ca37`); A2a fix round 1 on `m1/a2a-fix-1` @ `c8c4f60` (8 of 9 items; the library key-review route is left); then one confirming re-review, merge with mounts, full verify, CI. HANDOFF "In flight" and "Next step".
- **Update 2026-10-23 21:50 IST, M1 BUILD 3 = Wave 2 part 5 (newest):** A2b merged `f9a6ad4` with mounts + `LIBRARY_LIMITER` (`fca81ee`); M1-k → M1-l (`4fca331`, D1 pin kept); full serial verify + CI green on `4fca331`; A2a built (`m1/a2a-api-bank` `08b27ce`, pushed), security + database first reviews WITH FIXES, spec review owed. HANDOFF "Next step".
- **Update 2026-10-23 20:20 IST, M1 BUILD 3 = Wave 2 part 4:** A3a fix-2 merged `aefbdc6`; A2b reviewed (R5-63) and its fix round on `m1/a2b-fix-1` (in flight at stop); M1-j migration; any-account §4 prompt. HANDOFF "In flight".
- **Update 2026-10-23 18:45 IST, M1 BUILD 3 = Wave 2 part 3:** A4 `a246771`, A3a `29a063c`, A3b `b6cc5d1` merged after Opus first reviews, fix rounds and confirming re-reviews; lead migrations M1-f…M1-i (spec R5-58…R5-62); full serial verify green on `b2c7e15`, rls 3706 on `dd59212`. A2b built, unreviewed (`m1/a2b-api-tests` `8f7b52c`); A2a not started. HANDOFF "Next step".
- **Update 2026-10-23 16:20 IST, M1 BUILD 3 = Wave 2 part 2:** lead migration M1-e merged `8050482` (spec R5-57; CI green; Opus DB review owed). A4 built on `m1/a4-edge-delivery` `7f2fb9c` (unreviewed); zip reader fix rounds 2-4 all NOT CONFIRMED → FOUNDER-QUEUE (none merged). Writers A3a, A3b, A2b, A2a not started (reset to `a3e9123`). HANDOFF "In flight" and "Next step".
- **Update 2026-10-23 15:35 IST, M1 BUILD 3 = Wave 2 started:** Wave 2 pre-flight done, lead scaffolding `03693fb` (spec R5-56). Writers A4, A3a, A3b, A2b, then A2a not started; lead migration M1-e (snapshot_digest, library cursor) not started. **Two Claude Code accounts now alternate** (founder, 2026-10-23): each session works to 95% of its 5-hour window, wraps up and prints §4 for the other account. HANDOFF "Next step".
- **Update 2026-10-23 14:40 IST, M1 BUILD 2 = Wave 1 done:** A1 (+ jobs signalSettings patch, R5-52 f amended) `74b6b2c`, A5a `4364a33`, A5b `8e2a75b`, A5c `03a56c8` merged after Opus first reviews, fixes test first and confirming re-reviews; full serial verify green on `4364a33`; test:rls rls 3638 / catalog 150. Next chat: HANDOFF "Next step" (CI on PR #14, then **BUILD 3 = Wave 2**: A2, A3, A4).
- **Update 2026-10-23 13:20 IST, M1 BUILD 2 = Wave 1 part 1:** Wave 0 tail done (`60fa656`, `0fd37fe`; DC-M1-1 local PASS). Wave 1: lead scaffolding `240f102` (R5-52); merged A6 `6819874`, contracts `7edae27`, A5-0 `72ca88e` (spec R5-53…R5-55); code tip `f860a6c`, verify:fast green. Open stream branches: `m1/a1-packages` (fix round 2 for the CPU-DoS meter), `m1/a5a-import` (no reviews yet), `m1/a5b-bank-library` (fix round pending), `m1/a5c-fix-1` (Opus fix round). Next chat: HANDOFF "Next step" 1-5 (finish and merge A1 with the jobs signalSettings patch, then A5a/A5b/A5c), then BUILD 3 = Wave 2.
- **Update 2026-10-23 10:25 IST, M1 BUILD 1 part 3:** M1-c and M1-d placed (`2250ccc`), the carried M1-a/M1-b notes fixed (R5-49), `renderCandidateSummary` merged (`66555a1`); Opus first reviews fixed test first (R5-50, R5-51), Sonnet confirming re-review CONFIRMED WITH NOTES; rls 3632 / catalog 150, full verify green on `45a19cc`. Next chat: the **Wave 0 tail** (HANDOFF "Next step" 1: CI on the head, an owner-accept case, a two-connection test for DB H1/M1, DC-M1-1), then **BUILD 2 = Wave 1** (A1, A6, A5).
- **Update 2026-10-23 07:45 IST, M1 BUILD 1 part 2:** M1-b placed; the four Wave 0 writer branches (contracts, infra, ADR-033/vendors/carried, MT-11 FR-1) and the M1-a/M1-b review fixes are merged on `m1/integration` (code tip `018d856`; rls 3262, catalog 150). Parallel writers on disjoint files are allowed (founder, chat 2026-10-23); the lead still owns migrations, `supabase test db`, db reset and verify. Next chat: **M1 BUILD 1 part 3** (HANDOFF "Next step": carried review notes, then M1-c/M1-d from `docs/progress/m1-wave0-drafts/m1cd/`). Then CHAT 3 = BUILD 2 = Wave 1.
- **Update 2026-10-23 01:50 IST, M1 BUILD 1 part 1:** Wave 0 split at the migration boundary: migration M1-a and `rls_m1_bank/keys/variants/pools` are placed and green on `m1/integration`; the M1-b draft and the pgTAP generator are in `docs/progress/m1-wave0-drafts/`. Next chat: **M1 BUILD 1 part 2** (HANDOFF "Next step": M1-b…d with their pgTAP red first, contracts and the rest of §11.2, Opus reviews, full verify, draft PR for CI). Then CHAT 3 = BUILD 2 = Wave 1.
- **Update 2026-10-22 night, M1 SPEC (wins over every line below it):** the live branch is now **`m1/integration`** (worktree `.claude/worktrees/m1-integration`, cut from `d1/integration` @ `1547fd0`). Wherever this file names `d1/integration` as the working branch, read `m1/integration`. **D1 is PAUSED, not closed (founder, 2026-10-22):** its remaining steps (staging re-run on the final tip, AT-D2 capture, D1 summary, CLOSE PR) stay on `d1/integration` and are copied into HANDOFF "Paused: D1"; nothing is committed to `d1/integration` or `main` meanwhile, and M1 merges to `main` only after the D1 CLOSE with the founder's go-ahead. M1 spec `specs/m1-test-authoring.md` revision 5; next: M1 BUILD in the order of its §11.4.
- **Update 2026-10-22 21:10 IST, D1 REVIEW of the remainder:** `ceb0837..f226950` reviewed (Opus spec PASS WITH FIXES, Opus database/security APPROVE WITH FIXES); D1R-DB-1 (Medium, 3 integrity stages at once vs 128 MB) fixed test first in `1d36151` + `7c7ef4c` (Sonnet re-review CONFIRMED WITH NOTES); spec **revision 4p** (`d658b83`); `docs/reviews/D1.md` "Review of the remainder" (`a395c24`): AT-D1 PASS on `f226950`, AT-D17 within gate (30 s target → M5), DC-D8 FAIL vs Free, OPEN-8a founder gate. Next: the founder's AT-D2 capture and Workers Paid answer, a staging re-run on the final tip, then D1 CLOSE by PR with the founder's go-ahead. HANDOFF "Next step".
- **Update 2026-10-22 20:45 IST, Chat E3 part 3:** e2e-staging (AT-D1) **green** on staging (dispatch 39797279887 on `f226950`, AT-D17 max 57.5 s) after three fixes (staging expect timeout, parallel e2e cleanup, jobs consumer runs 3 sessions side by side; Sonnet database review fixed). DC-D8 recorded: exceeds Workers Free (founder: "decide later"). **`cp/d1-10` = `f226950`**. Next chat: **D1 REVIEW of the remainder** (`ceb0837..f226950`, `docs/reviews/D1.md` staging half, full verify), then AT-D2 capture and D1 CLOSE by PR with the founder's go-ahead. HANDOFF "Next step".
- **Update 2026-10-22 18:40 IST, M0a/M0b CLOSE:** **M0a and M0b are closed**: PR #6 → `main` `3667678` = `m0a-reviewed`, PR #13 → `main` `da5380d` = `m0b-reviewed` (Opus re-reviews PASS, H11 met, full verify green). `main` is protected by ruleset 25633431: **never push or commit to `main`**; it moves only by a CLOSE PR (AUTOPILOT §2, §6). `d1/integration` = `74ddc51` + handoff. Next chat: **E3 part 3** (e2e-staging expect timeout, re-dispatch, DC-D8, AT-D2, `cp/d1-10`), then D1 CLOSE by PR. HANDOFF "Next step"; founder items there (Dependabot PRs #7-#12, `e2e-local` back on the ruleset after D1).
- **Update 2026-10-22 16:35 IST, Chat E3 part 2:** Hyperdrive live on staging: writer branch merged, ADR-031 amendment 1 + spec 4o, Opus security/database reviews fixed, full verify green, founder ops run done, ids committed; dispatch 39762460219 deploy-staging green, **e2e-staging red at steps 5-6** (candidate invite/OTP path); `staging-applied-39762460219` = `df85dd4`. **Repo is PUBLIC** (Actions billing). Next chats: E3 part 3 (fix e2e-staging, DC-D8, AT-D2, `cp/d1-10`) and, with the founder's go-ahead, M0a/M0b CLOSE. HANDOFF "Next step" and "M0a/M0b CLOSE".
- **Update 2026-10-21 15:40 IST, Chat G part 2:** **D1 FIX done**: every code finding fixed (D1-SPEC-3 a confirmed false positive), Opus database + spec re-reviews CONFIRMED WITH NOTES, notes applied (`docs/reviews/D1.md` "FIX", "Re-review of the FIX"); spec revision 4n; full verify green on `fd9b31c`. `cp/d1-11` = `fd9b31c` (CI green). Next: **Chat E3** (Hyperdrive, then e2e-staging and `cp/d1-10`). Run tests with `--workspace-concurrency=1` (pnpm 12 ignores `npm_config_workspace_concurrency`). HANDOFF "Next step".
- **Update 2026-10-21 14:45 IST, staging half:** founder gates done (token, part (b), both smoke users). deploy-staging fully green (run 39566827826, org sign-in included); e2e-staging blocked at step 4: Workers cannot open TLS to Supabase Postgres (private Supabase Root 2021 CA). Next chats: **Chat G part 2** (D1 FIX, no staging dispatch), then **Chat E3** (Hyperdrive with the CA, then e2e-staging and `cp/d1-10`). HANDOFF "Staging finding" and "Next chats".
- **Update 2026-10-21 09:55 IST, Chat G part 1:** D1 FIX started: **D1-SPEC-1 fixed** (`c8a4911`, AT-D21 `packages/config/test/never-build.test.ts`, seen failing first); stopped at the usage guard (Pro window ~87%). Next: **Chat G part 2**: D1-DB-1, D1-SPEC-2, the D1 FIX Lows, then the Opus re-review (incl. `c8a4911`), full verify, CI, `cp/d1-11` (HANDOFF "Next chats" 1).
- **Update 2026-10-21 09:35 IST, Chat F:** D1 REVIEW done: `docs/reviews/D1.md` **BLOCK** (D1-SPEC-1 High: AT-D21 never-build test missing; Mediums D1-SPEC-2 AT-D2 deliverable, D1-DB-1 flags vs rule table) + INCOMPLETE on the founder-gated staging half. Next: **Chat G (D1 FIX)**, code findings only; CLOSE needs the founder's go-ahead. Chat E2 part 2 still waits for the token fix.
- **Update 2026-10-21 08:35 IST, Chat E2 part 1:** MT-9 hosted allow-list merged and reviewed (spec 4m, `test:rls` step 5e); on staging the migrations and catalog checks pass and the queues exist; **R2 bucket create fails with Cloudflare code 10000 (CI token lacks R2 permission): founder gate**, then part (b). **Chat F (D1 REVIEW) was started by the lead** (founder allowed); Chat E2 part 2 resumes after the founder fixes the token (HANDOFF "Next chats").
- **Update 2026-10-19 15:45 IST, Chat E part 1:** Chat E's lead work and R5 are **merged** into `d1/integration` (`1887400`): OPEN-13 edge limit (ADR-032), R4 note 1, local recruiter headers, org CORS (N1), `staging-worker-secrets.mjs`, the D1 slice E2E (`e2e/tests/d1-slice.spec.ts`, 27 passed on e2e-local) and the `e2e-staging` job; spec revisions 4k, 4l; review record `docs/reviews/D1-review-chat-e.md`. Full `pnpm verify` green. **Blocked on the founder staging gates**; no `cp/d1-10` yet. Next: **Chat E2** (HANDOFF "Next chat": the staging half).
- **Update 2026-10-19 13:25 IST, Chat D:** **C2 candidate app and the `e2e-local` real flow are merged** into `d1/integration` (`986540f` = **`cp/d1-09`**): C2 `ffe134f` (spec PASS WITH FIXES, security PASS WITH NOTES, all fix-now findings fixed test first, re-review CONFIRMED WITH NOTES; `docs/reviews/D1-review-c2.md`), e2e-local real flow `c8b1f62` + `04d9e87` (closes r3a #1), candidate UI spec in real Chromium; spec revisions 4i, 4j. Full `pnpm verify` and CI on PR #4 (e2e-local 17 passed on Linux) green. Next: **Chat E** (HANDOFF "Next chat": staging readiness).
- **Update 2026-10-19 11:30 IST, Chat C:** **R2 jobs and R4 recruiter app are merged** into `d1/integration` (`ab62681` = **`cp/d1-08`**): R4 `9cebeb3`, R2 `3c51438`, lead wiring `6d504da` (stages per env, sweep, db-tests in `test:rls`); five Opus reviews and two Sonnet re-reviews, every fix-now finding fixed test first; spec revisions 4f-4h. Full `pnpm verify` and CI on PR #4 green. Next: **Chat D** (HANDOFF "Next chat": C2 candidate app + `e2e-local` real flow).
- **Update 2026-10-19 00:30 IST, Chat B:** **C1b is merged** into `d1/integration` (`8a4873a` = **`cp/d1-07`**): SessionDO + session routes, AT-D7, D11 edge, D24-D27 edge, D29 maxChars, D35 edge, D37; spec review PASS WITH FIXES, security review PASS WITH NOTES (3 Medium fixed), Sonnet re-review CONFIRMED WITH NOTES; spec revision 4e; real-DO test pools for edge and api. Full `pnpm verify` green. Next: **Chat C** (HANDOFF "Next chat": R2 jobs ∥ R4 recruiter app).
- **Update 2026-10-18 23:30 IST, Chat A:** founder moved to **Claude Max**: one chat = one big task (`docs/progress/SESSION-PLAN.md`). **C1a is merged** into `d1/integration` (AT-D23, D28, D29 photo half, D31/D32 edge; spec review PASS WITH FIXES, security review PASS WITH NOTES, all "fix now" findings fixed and re-review CONFIRMED; spec revision 4d; tag **`cp/d1-06`**). **C1b** is written on `d1/c1b-session` @ `ea59b0a` (not reviewed, built on pre-fix C1a). Next: **Chat B** (HANDOFF "Next chat").
- **Update 2026-10-18 20:55 IST:** **R3 is merged** into `d1/integration` (`76f3d69` = **`cp/d1-05`**; every review finding due before the merge fixed tests first; spec revision 4c; full `pnpm verify` and CI on PR #4 green). **C1a** (edge lobby half) is written on `d1/c1a-edge-lobby` @ `d17b6aa` (worktree `.claude/worktrees/agent-aca1caeb85b274390`): AT-D23, D28, D29 photo half; **not reviewed, not merged**; `no-secrets.test.ts` and `log-hygiene.test.ts` (AT-D31/D32 edge) still to write. Next: HANDOFF "Next step" 2a-2d (finish C1a, verify:fast, spec + security review, merge, `cp/d1-06`), then C1b (SessionDO).
- **Update 2026-10-18 03:00 IST:** **R3 is complete and assembled on `d1/r3-merge` (`cbfe5ac`, worktree `.claude/worktrees/agent-af098bea644b1ab65`)**: R3b reports + R3a2 (tests, assignments, invitations, outbox, media) + the lead's mount, route inventory (AT-D13) and log hygiene (AT-D32); verify:fast green; spec review of the reports half PASS WITH FIXES (fixed); security review PASS WITH NOTES (M1 db TLS fixed in 05dec63, L2 publish order due). **Not merged into `d1/integration`** (`6ffe4e1`). Next: HANDOFF "Next step" 2a-2f (security fixes, open spec items, spec review of the R3a half, database review, merge `--no-ff` with the `ec83f46` note, full verify, CI, `cp/d1-05`), then C1.
- **Update 2026-10-17 08:45 IST:** **Wave 0 is complete**: S2, S6 and the tail review's L1/L2/I1 fixed, `e2e-local` CI job + `scripts/e2e-local.mjs` (DC-D9 PASS, DC-D6 Linux PASS), full `pnpm verify` and CI green on `1dff4d6` = **`cp/d1-03`**; postgres 3.4.9 added (`c514c7a`). **Wave 1:** R1 **merged** (`df865ca` = **`cp/d1-04`**, full verify + CI green) and R3 (`d1/r3-api`: partial, not reviewed) from `c514c7a`; both pushed, neither merged. Next: HANDOFF "Next step" 2b-2c (finish and review R3, merge, cp/d1-05, then C1). On the Pro plan run at most 2 agents at once; on this machine run verify with `npm_config_workspace_concurrency=1`.
- **Update 2026-10-16 17:30 IST:** all four writer branches are placed and reviewed (key script, recruiter CSP + strictPort, DC-D5/D6 spikes, staging-deploy rework); full `pnpm verify` green on `6640b42`; Opus security review PASS WITH NOTES with S3/S7/S8 fixed, S4 in the runbook, S1 a founder gate. Next: HANDOFF "Next step" 2a (S2, S6; S5 is done), 2b (DC-D9 + DC-D6 Linux `e2e-local` job), 2c (full verify, CI, tag `cp/d1-03`), then Wave 1. On the Pro plan run at most 2 agents at once.
- **Update 2026-10-16 08:15 IST:** carried DB items fixed (`cfd3a67`, rls 2616, CI green); ES256 key ops script placed (`9429559`, `19152dc`) and its public value made a JSON array (`e0121f3`, verify:fast green). Three writer branches stopped at the usage limit, **not reviewed or placed**: ci.yml rework `worktree-agent-a5a448b74d436d19a` (`a48545b`), recruiter CSP + strictPort `worktree-agent-a59431baa68efcdfb` (`958e1e4`), DC-D5/D6 spikes `worktree-agent-a9c30de5fc651e33c` (`d9d96a6`); each worktree may hold uncommitted work. Next: HANDOFF "Next step" 2a–2e, then tag `cp/d1-03`. On the Pro plan run at most 2 agents at once.
- **Update 2026-10-15 17:45 IST:** jobs queue/sweep wiring placed (`289cea1`); the ci.yml staging-deploy draft was reverted (`2e679fc`, broke S3B-1) and must be reworked from `b0d2c8c`. Next: verify:fast + full verify + CI on `2e679fc`, the ci.yml rework, then the ES256 key ops script, recruiter CSP, DC-D5/D6/D8/D9, tag `cp/d1-03` (HANDOFF "Next step").
- **Update 2026-10-15 15:30 IST:** Wave 0 code tip `97f82dd` = `cp/d1-02`, full verify and CI green. Founder-queue walkthrough done (answers in build-notes §0). Next: Wave 0 remainder — ci.yml §7.1 + §7.2(b) `workflow_dispatch` staging deploy, jobs handlers, CSP, DC-D5/D6/D8/D9 (HANDOFF "Next step" 2); then the staging evidence that lets M0a and M0b CLOSE (HANDOFF "Path to close").
- **Update 2026-10-15 14:05 IST:** band-engine and e2e skeletons, boundaries, wrangler bindings and the staging-secrets allow-list are placed and security-reviewed (code tip `97f82dd`; CI green on `742bf54`). Full verify green at `eaa8155`, `cp/d1-02` tagged. Next: ci.yml §7.1, jobs handlers, CSP, DC-D5/D6/D8/D9 (HANDOFF "Next step").
- **Update 2026-10-15 00:45 IST:** Wave 0: **migrations 1-4 and every §3.6 pgTAP file are placed, reviewed and fixed; contracts `@trace/shared/contracts/{candidate,d1}` and `canonical-json` placed and reviewed**; full verify green at `bbae037` (rls 2610). `cp/d1-01` = `bbae037`; `SIGNAL_CATALOG` and `canonicalNoticeText` added (`b625788`). Next: full verify + CI on the tip, then DC-D5/D6/D8/D9, skeletons, wrangler/CSP/ci (HANDOFF "Next step").
- **Update 2026-10-14 23:00 IST:** **migration 3 is placed, reviewed (Opus, APPROVE WITH MINOR FIXES) and fixed** (`e253624`, rls 2428; `docs/reviews/D1-db-review-m3.md`). H4 done (`abhayraj.workers.dev`). Next: full verify + PR #4 CI, the small open review items, then **migration 4** (HANDOFF "Next step"); founder walkthrough continues at step 6 (R2).
- **Update 2026-10-14 21:45 IST:** migration 3 placed and green (`7e9e3fc`), not yet reviewed (superseded by the line above).
- **Update 2026-10-14 19:35 IST:** AT-D22 Sentry is **green and reviewed** (D1-18 gate met); DB review m1 M-1/m-1 fixed; **migration 2 placed, reviewed and fixed** (rls 1840); migration-3 tests drafted. Next: full verify + PR #4 CI, then **migration 3** (HANDOFF "Next step" 2).
- **Update 2026-10-14 14:45 IST:** **H6 Sentry is DONE** (EU region; founder walkthrough steps 1–4 done and verified; step 5, the H4 subdomain, is the founder's next item). D1 Wave 0: migration 1 green; next is AT-D22 (Sentry scrubber + wiring tests, now unblocked), then DB review M-1/m-1, then migration 2 (HANDOFF "Next step"). The founder now works from another Claude Code account.
- **Update 2026-10-14 13:10 IST:** D1 Wave 0: **migration 1 is placed and green** (`45206c8`, rls 1182). Next: fix the DB review Major M-1 (workspace fence on assignments), then place migration 2 from `docs/progress/d1-wave0-drafts/m2/` (HANDOFF "Next step" 1–3). H6 Sentry still open.
- **Update 2026-10-14 10:50 IST:** **D1 BUILD Wave 0 has started** (lead-only; H6 Sentry not done): day-one checks DC-D2/D3/D4/D7 pass locally, ADR-031 accepted, draft PR TraceHiring/TraceHiring#4. Next: the migrations and `rls_d1_*` pgTAP red first (HANDOFF "Next step" 2).
- **Update 2026-10-14 09:05 IST :** **D1 SPEC is approved** (`specs/d1-demo-slice.md` revision 4, `a44c1f6`). The next phase is **D1 BUILD** in a fresh session. It is gated on the founder's H6 Sentry; spec §11 Wave 0 is lead-only. Branch `d1/integration` (worktree `.claude/worktrees/d1-integration`).
- **Update 2026-10-14 07:05 IST :** the live integration branch is now **`d1/integration`** (worktree `.claude/worktrees/d1-integration`), cut from `milestone/m0b` = `cp/m0b-05` (`56c2641`). M0b FIX and the MT-11 FR-1 follow-up are done and reviewed. **D1 is in SPEC** (founder, 2026-10-14): `specs/d1-demo-slice.md` is at **revision 2** (the Opus spec review of revision 1 is applied). Next: align the small leftovers, then the Opus database-reviewer and a confirming spec re-review, then approval (HANDOFF "Next step"). `m0b/integration` (worktree `.claude/worktrees/m0b-integration`) is finished; do not commit there.
- **Update 2026-10-13 20:25 IST:** **M0b FIX is done.** There is no open Medium, full verify and Linux CI are green, and `milestone/m0b` = `cp/m0b-04` (`docs/reviews/M0b.md` "FIX" and "Re-review of the FIX"). M0b CLOSE waits for founder gates. The next phase needs the founder's answer to the new FOUNDER-QUEUE row (D1 SPEC before `m0b-reviewed`?); see HANDOFF "Next step".
- **Update 2026-10-13 18:55 IST:** **M0b REVIEW is done** — `docs/reviews/M0b.md`:
  PASS WITH CONDITIONS (code), INCOMPLETE on the founder-gated staging items until CLOSE. The next phase is **M0b FIX**
  (fresh session): HANDOFF "Next step" 1–3, first the Medium M0B-DB-2 (MT-11). Then re-review, full verify, CI, `cp/m0b-04`.
- **Update 2026-10-13 16:10 IST:** **M0b BUILD is complete** — B0–B5 all merged into
  `d1/integration`. First confirm Linux CI `rls` is green on PR #3 after the `3e5ffbe` push (HANDOFF "Next step" 1–2),
  then the next phase is **M0b REVIEW** (`trace-milestone-review`, fresh session). Draft PR for M0b CI: TraceHiring/TraceHiring#3.
- **Update 2026-10-12 14:40 IST:** M0b BUILD continues. B5 is merged; B0 + B1 + most of B4 sit reviewed and
  fully verified on stream branch `m0b/b0-db` (`f727d0a`), **not merged yet** — HANDOFF "Next step" 1–3 merges it.
- **Now (2026-10-12 09:25 IST): M0a REVIEW and FIX are done; M0a stops before CLOSE (founder). M0b is in SPEC.**
  M0a verdict: BLOCK, founder-gated, no code defect (`docs/reviews/M0a.md`): the GitHub plan blocks branch protection
  (SEC-1) and the staging secrets are open; CLOSE (merge to `main`, tag `m0a-reviewed`) is the founder's.
  `milestone/m0a` @ `7dc8c0d` = `cp/m0a-06` (full verify + Linux CI green). M0b started before `m0a-reviewed` by the
  founder's overnight decision (build-notes §0); it closes only after `m0a-reviewed`. `specs/m0b-tenancy.md` is **approved at
  revision 5** (12:35 IST); **M0b is in BUILD**: B3 merged, B4 partly done, B5 on `m0b/b5-workers-http` awaiting review.
  No milestone is closed yet. Model policy, CI via draft PRs, and the SessionStart hook reading the newest
  `*/integration` handoff still apply.
- **Integration branch: `d1/integration`** (M0b work + this file), cut from `milestone/m0a` @ `7dc8c0d`.
  `m0a/integration` @ `c619525` holds the M0a history and review records (its HANDOFF is stale). Older names
  (`claude/trace-autopilot-production-87e5e2`, `claude/trace-autopilot-resume-2dac7c`) are retired ancestors.

## 2. Where everything is written (read in this order)
| File | What it is for |
| --- | --- |
| `CLAUDE.md` | Product rules 1–9, engineering rules, session protocol (usage guard, commits, push at end) |
| `docs/AUTOPILOT.md` | How sessions run: phases, parallelism policy (§2), founder gates (§3), deciding alone (§4), checkpoints/backups (§5), session protocol (§6) |
| `docs/progress/HANDOFF.md` (on `d1/integration`) | **Live state**: stream branches + tips, review verdicts, the ordered "Next step" list |
| `docs/progress/LOG.md` | One row per session (append yours at the end) |
| `docs/progress/FOUNDER-QUEUE.md` | Questions only the founder can answer (AUTOPILOT §3); add new ones here |
| `docs/progress/RESTORE.md` | Restoring from a bundle, rolling back to a `cp/*` checkpoint |
| `docs/reviews/*.md` | Review reports with exact repros and fix plans (S1.4 re-review, S1.7 database x2, redactor) |
| `specs/m0-foundations.md` (rev 16) | The M0a spec: §5 root scripts, §8 Supabase + catalog checks, §9.1 logger/redactor, §13 acceptance tests, §14 streams |
| `docs/plan.md`, `docs/build-order.md`, `docs/plan-conflicts.md`, `docs/build-notes.md`, `docs/adr/` | Product spec, milestone order and exit gates, resolved contradictions, founder answers, settled decisions (precedence: AUTOPILOT §1) |
| `.claude/skills/trace-handoff`, `.claude/skills/trace-milestone-review` | End-of-session handoff; milestone REVIEW gate |
| `.claude/agents/{spec,security,database}-reviewer.md` | Read-only reviewer agents used before any merge |
| `scripts/backup.sh`, `docs/progress/tools/catalog-run.mjs`, `docs/progress/tools/root-scripts.test.mjs.pending` | Local git bundles; catalog-check dev runner; the root-scripts test to wire at integration |

How progress is recorded: commit often (conventional commits, lowercase subject); after every green sub-step
tag `cp/m0a-<NN>` on `milestone/m0a`; at session end overwrite HANDOFF.md, append LOG.md, back up, push. A
milestone is complete only after REVIEW PASS: then `docs/milestones/M<X>-summary.md`, merge into `main`
with `--no-ff`, tag `m<X>-reviewed`.

## 3. Steps
STEP 1 — Read CLAUDE.md and docs/AUTOPILOT.md in full. Then `git fetch trace` (if it hangs on credentials, as on
2026-10-12: `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace`) and read
`git show m1/integration:docs/progress/HANDOFF.md` (since 2026-10-22 night; `d1/integration` only for a D1 chat) and the review reports it names. Since `d9bf35a` the SessionStart
hook injects the handoff from the newest `*/integration` branch (older sessions injected a stale copy from `main`);
the branch still wins over anything injected.

STEP 2 — Get onto `m1/integration` (worktree `.claude/worktrees/m1-integration`; a D1 chat uses `d1/integration`) without losing anyone's work
- `git worktree list ; git branch --show-current ; git status --porcelain`
- If the tree is dirty: do not discard anything. Create `rescue/<YYYYMMDD-HHMM>` from HEAD, commit as wip
  there, and tell the founder (AUTOPILOT §6).
- **Session opened in the root folder on `main`:** never commit on `main`. Run
  `git worktree add .claude/worktrees/m0a-integration d1/integration` and do all work inside that folder
  (absolute paths; `cd` into it for every shell command).
- **Session in a worktree the app created (branch `claude/...`):** if the tree is clean and every commit in
  `git log --oneline d1/integration..HEAD` is also on `main` (`git branch --contains <sha>`), run
  `git switch d1/integration`. If git says the branch is checked out in another worktree (as of 2026-10-11 it is
  `.claude/worktrees/d1-integration`), call the `EnterWorktree` tool with `path` = that worktree's
  absolute path (`git worktree list` shows it; this worked on 2026-10-11). Then keep git commands plain (no `$(…)`,
  loops, `export GIT_*` or chained `git` calls in one command) or the worktree guard refuses them. If that is
  impossible, stop and tell the founder.
- `pnpm install --frozen-lockfile` in your checkout before the first commit (git hooks need node_modules).
- Never: force-push, delete branches or remote refs, move/delete `cp/*` tags, rewrite pushed history, re-enable
  `.git/hooks/post-commit.disabled`, remove other worktrees (`.claude/worktrees/agent-*` hold the streams),
  deploy to production, read `.env*` files with real values.

STEP 3 — Verify, then report in 5 lines whether the repo matches the handoff (stop if it does not)
- `git log --oneline -5` (tip = the newest `chore(progress)` handoff commit) ; `git status`
- `pnpm -s verify:fast` must exit 0
- `docker ps`: container `supabase_db_trace` is the shared local stack. If it is down:
  `pnpm exec supabase start -x realtime,storage-api,imgproxy,mailpit,studio,edge-runtime,logflare,vector,supavisor,postgres-meta`
  (write the output to a file; never pipe docker/supabase output into `head` on Windows)
- Branch tips: `d1/integration` (newest `chore(progress)` commit), `milestone/m0a` @ `7dc8c0d` (tag `cp/m0a-06`),
  `m0a/integration` @ `c619525`, `main` @ `fe77a87`. All are on the `trace` remote after the wrap-up push.
  Draft PR 1 (`m0a/integration` → `main`) shows M0a CI; M0b has no PR yet (open a draft one for CI).

STEP 4 — Do the HANDOFF "Next step" list in order. Summary (HANDOFF and the review reports have the details):
1. (Done 2026-10-12: spec revision 5 approved.) Review and merge B5 (`m0b/b5-workers-http`), then a full `pnpm verify`.
2. M0b BUILD per `specs/m0b-tenancy.md` §11 (B0 tests first, then the three migrations; B1; rest of B4; writer B2).
3. Do not merge into `main`, tag `m0*-reviewed`, or CLOSE M0a: those wait for the founder (FOUNDER-QUEUE).
Rules learned the hard way:
- Usage: check it often. **Work until 95% of the 5-hour window, then start STEP 5 (founder, 2026-10-12; was 90%)**,
  even if agents are still running; record any agent result that arrives later before stopping. STEP 5 costs ~3–5%,
  so commit at every green step and keep only docs for the wrap-up. Parallel agents burn fast (5 agents used ~30% of a
  Pro window in 10 minutes; one Opus review ≈ 15–17%, a Sonnet writer ≈ 5–8%), so check `get_usage` after every agent
  result, run max 2–3 agents at once, and start no new agent after ~80% (one review can take 5–17%) — use the time
  between 80% and 95% for lead work.
- Writer agents with isolation "worktree" start at `main`: every writer prompt must say "confirm your branch has
  no commits of its own, then `git reset --hard <exact SHA>`", own a strict set of directories, never touch
  root package.json / lockfile / migrations, and commit at each green step.
- Only the lead runs `supabase start`, `db reset`, `test db`, `gen types`; agents use rolled-back psql only:
  `docker exec -i supabase_db_trace psql -U postgres -X -q -At -v ON_ERROR_STOP=1`.
- pgTAP counters are rolled back by `rollback to savepoint`; count TAP lines only.
- commitlint rejects a capitalised subject; pre-commit gitleaks rejects secret-shaped literals (build test
  keys at run time); no PII anywhere (synthetic data only).
- If the spec is ambiguous on anything touching rules 1–9: stop and ask (FOUNDER-QUEUE), never guess.

STEP 5 — Wrap-up, always (AUTOPILOT §6; the trace-handoff skill)
- Commit everything. Overwrite `docs/progress/HANDOFF.md` on `d1/integration` (<150 lines, exact SHAs, every
  stream branch and state, the exact next action); append a row to `docs/progress/LOG.md`; update this file if a
  branch, SHA or step changed.
- **No handoff mirror on `main`** (since 2026-10-11): the hook reads the integration branch, and a mirror commit makes
  draft PR 1 (`d1/integration` → `main`) conflict, which stops its CI. Never commit on or move `main`.
- `sh scripts/backup.sh` ; `gitleaks git --redact --no-banner` (must pass) ;
  `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push trace main milestone/m0a d1/integration <every branch with new commits>` (founder: borrow the gh login per push) ; `git push trace --tags`
  (plain push; if rejected or it asks for credentials, stop and add it to FOUNDER-QUEUE.md).
- Print the paste prompt below as the NEXT PROMPT, plus any new FOUNDER-QUEUE items.

## 4. Paste prompt (the founder pastes this into a new session, a new Claude Code install or a new account)
```
Resume the Trace autopilot on M1. The git repo is the only source of truth; trust it over memory, over any
injected handoff text and over this prompt. This prompt works on any Claude Code account (Pro or Max) and any
machine that has the repo.

First run (the plain fetch can hang on credentials; use this form):
  git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace
  git show trace/m1/integration:docs/progress/RESUME-PROMPT.md
and follow its §3 STEP 1-3: read CLAUDE.md and docs/AUTOPILOT.md in full, then docs/progress/HANDOFF.md and the last
3 rows of docs/progress/LOG.md on trace/m1/integration. Get onto m1/integration without losing anyone's work:
- If `git worktree list` shows .claude/worktrees/m1-integration, enter it with the EnterWorktree tool (path from
  that list); never `git switch` a branch checked out in another worktree.
- If it does not exist (new machine): `git worktree add .claude/worktrees/m1-integration m1/integration` (or, with
  no local branch, `git worktree add -b m1/integration .claude/worktrees/m1-integration trace/m1/integration`),
  enter it, then `pnpm install --frozen-lockfile`.
- If the local branch is behind trace/m1/integration, fast-forward with `git merge --ff-only trace/m1/integration`
  (never reset, never force). If the tree is dirty, do not discard anything: follow RESUME-PROMPT §3 STEP 2.
- If docker's supabase_db_trace is down: `pnpm exec supabase start -x realtime,storage-api,imgproxy,mailpit,studio,
  edge-runtime,logflare,vector,supavisor,postgres-meta` (write output to a file), then
  `pnpm exec supabase migration up --local`.
Report in 5 lines whether the repo matches HANDOFF "Verify first" (m1/integration tip = trace's, d1/integration and
main tips unchanged, clean tree, pnpm -s verify:fast green, docker up). Stop if it does not match.

USAGE (founder, 2026-10-23 18:30 IST): work until the 5-hour window reaches 95% or this chat's work is done,
whichever comes first; do not stop for the weekly limit or for context percentage (wrap up before an auto-compaction
would lose state). Check get_usage at the start, after every agent result and before starting any agent. Pro: at
most 2 agents at once, one Opus agent at a time, no new agent after 85% of the 5-hour window. Max: up to 4 writers
and 6 read-only reviewers, no new agent after 90%. From 90% (Pro: 85%) do only lead work that ends in a commit; at
95% stop and wrap up. Never leave a writer running at wrap-up without recording its branch and state in HANDOFF
"In flight". Accounts may alternate: every session leaves trace resumable.

D1 is PAUSED, not closed (founder, 2026-10-22): its remaining steps are in HANDOFF "Paused: D1" and belong to a D1
chat, not this one. Never commit to d1/integration or main. M1 merges to main only after the D1 CLOSE and with the
founder's go-ahead.

THIS CHAT = HANDOFF "In flight" first, then HANDOFF "Next step" in order (as of 2026-10-31 07:55 IST: M1 CLOSE
waits for the D1 CLOSE and the founder's go-ahead; M2 BUILD 1 Wave 0a and Wave 0b part 1 are done on m2/integration
(tip 937da1b; draft CI PR TraceHiring/TraceHiring#16, its rls job is red on db-types until HANDOFF Next step 1); if
`docker port supabase_db_trace` shows no 54322, Windows still reserves the stack's ports (HANDOFF "LOCAL BLOCKER"); the
next step is HANDOFF Next step 1 (db-types, test:rls), then the Wave 0b remainder on m2/integration
(worktree .claude/worktrees/m2-integration, enter it with EnterWorktree; on a new machine `git worktree add -b
m2/integration .claude/worktrees/m2-integration trace/m2/integration`), lead only, per specs/m2-scheduling-invites.md
§11.2 and binding rows §1.8 R5-1…R5-66).
M2 writers (later waves) use the common brief docs/progress/m1-writer-brief-common.md adapted to m2 (branches
m2/<stream>) plus a self-contained stream brief, their own worktree (Agent isolation "worktree") and
`git reset --hard <exact SHA>`; each stream gets Opus first reviews (spec, security, database), fixes test first, a
confirming re-review, a merge with the lead mounts, test:rls, a full verify and Linux CI on a draft PR
m2/integration → main (TraceHiring/TraceHiring#16, opened in Wave 0, never merged). M1 CI stays on PR #14 (TraceHiring/TraceHiring#14, draft).

RULES (never break): CLAUDE.md rules 1-9; tests first; Opus first reviews, fixes test first, a confirming
re-review, full pnpm verify (pnpm -r --workspace-concurrency=1 test plus vitest run --root scripts; this machine may
be short of RAM; never run workspace tests while writers run) and Linux CI before any merge into m1/integration or
m2/integration. If
something touching rules 1-9 is ambiguous, do not guess: add a FOUNDER-QUEUE row, leave that part out, keep working
on the rest. Founder gates (AUTOPILOT §3) go to FOUNDER-QUEUE; do not wait. No staging dispatch unless HANDOFF says
the founder approved it. Never force-push; never move or delete branches, tags (cp/*, m*-reviewed,
staging-applied-*) or worktrees; never rewrite pushed history; never deploy to production; never read .env* or
secret values; never merge Dependabot PRs #7-#12; never re-enable .git/hooks/post-commit.disabled. Only the lead runs
supabase start/stop, db reset, test:rls, gen types (scripts/db-types.mjs and test:rls RESET the local database:
never while a writer runs db-tests) and pnpm verify. Commit at every green step (conventional commits, lowercase
subject, body lines <= 100 chars, messages via git commit -F <uniquely named scratchpad file>, merges
`chore: merge …`; one plain git command per shell call, the worktree guard refuses compound ones). Push
m1/integration, m2/integration and every stream branch after each merge or green lead step, so any account can
resume from trace.

Wrap-up (trace-handoff skill, on m1/integration): commit everything (a partial step as `wip(...)` with
.claude/allow-red and a note); overwrite HANDOFF.md (< 150 lines, keep its "Paused: D1" section, exact SHAs, every
stream branch and its state, an "In flight" list, the exact next action); append a LOG row; update RESUME-PROMPT §1
with a dated line; scripts/backup.sh; plain push of m1/integration, m2/integration, every stream branch with new
commits, and tags
(the pre-push hook runs the full-history gitleaks scan; it must pass). Do not start another session or a scheduled
task. Last, print this §4 prompt exactly as it stands in docs/progress/RESUME-PROMPT.md on trace/m1/integration, for
the founder to paste into any account.
```
