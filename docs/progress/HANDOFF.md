# HANDOFF — 2026-10-19 ~11:30 IST (end of Chat C)
Reason for stopping: **Chat C's task is done** (R2 jobs and R4 recruiter app merged, verified, tagged `cp/d1-08`). Claude Max: one chat = one big task (`docs/progress/SESSION-PLAN.md`; AUTOPILOT §6 first bullet). Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt). The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (no `m*-reviewed` tag, `main` still `fe77a87`). M0a and M0b are built, reviewed and fixed but **not CLOSED** (founder gates, "Path to close" unchanged).
- **D1 ≈ 87%**: Wave 0 (`cp/d1-03`), R1 (`cp/d1-04`), R3 (`cp/d1-05`), C1a (`cp/d1-06`), C1b (`cp/d1-07`), **R2 + R4 (`cp/d1-08`)**. Left: C2 candidate app + `e2e-local` real flow (Chat D), staging (E), D1 REVIEW (F), FIX + CLOSE (G).
- **Current phase: D1 BUILD, Wave 2a done → Wave 2b (C2) next.**

## Where we are (verified this chat)
- **`d1/integration`** = `ab62681` + this handoff. **Full `pnpm verify` exit 0 on `ab62681`** (unit 2191 + 1 skipped; edge 387, api 383, jobs 240, recruiter 354; test:rls 32 files, rls 2616, catalog 142, **jobs real-DB tests 37 inside test:rls**; build incl. `check-no-demo-outbox` OK). **CI on PR #4 green on `ab62681`** (static, rls, security, migrations, e2e-local). **Tag `cp/d1-08` → `ab62681`**.
- R4: `d1/r4-recruiter` @ `c0b2dab` (writer) → `d1/r4-fixes` @ `e9497e5` (fixes) → merged `9cebeb3`. Reviews `docs/reviews/D1-review-r4.md`: spec PASS WITH FIXES, security BLOCK (SEC-1 Sentry `/media/` breadcrumb, fixed `b86829d`), Sonnet re-review CONFIRMED WITH NOTES.
- R2: `d1/r2-jobs` @ `2ad15be` (writer) → `d1/r2-fixes` @ `9817ce5` (11 fixes) → merged `3c51438`. Reviews `docs/reviews/D1-review-r2.md`: spec PASS WITH FIXES, security PASS WITH NOTES, database APPROVE WITH MINOR FIXES, Sonnet re-review CONFIRMED WITH NOTES (note 1 fixed `ab62681`).
- Lead commits: `42fd3e2` (`@trace/shared/jobs`: SqlTx, EvidenceReader, jobKey; jobs → band-engine), `d2c0424` (r3a #3 half-written draft), `e213b4c` (`queue/stage-db.ts`), `375932a` (stages per env), `eb60280` (`queue/evidence.ts`), `02595ec` (C1b note 4 measured), `a4a37b4` (recruiter → band-engine), `e8c62a7` (AT-D18 `scripts/check-no-demo-outbox.mjs`, `VITE_DEMO_OUTBOX: '1'` on the staging build only), `b86829d` (scrubber drops `/media/`), `e38bb55` (GET `/tests/:id` staff only), `a52f6e4` (`isStorableText` contract), `6d504da` (`queue/wiring.ts`, `index.ts`, tsconfig.node, `test:rls` jobs step), `ab62681` (AT-D25 code-point splices). Spec revisions **4f, 4g, 4h**.
- Writer worktrees (keep): `agent-a42ea4110a5cb968c` (r4), `agent-a0b8f27eea6af5604` (r4-fixes), `agent-a7bc07c4b7f7f55cd` (r2), `agent-a49640bf17f192b87` (r2-fixes).
- Unchanged: `main` `fe77a87`, `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`; tags `cp/d1-01..07`.

## Next chat: **Chat D — Wave 2b: C2 candidate app + `e2e-local` real flow**. Done when `cp/d1-09` is pushed.
## Next step (in order)
1. Verify (below). If anything differs from this file, stop and report.
2. Read spec `specs/d1-demo-slice.md` §4.5-§4.8 (candidate runtime, start photo + blur, client signals, `apps/candidate`), §7.1-§7.2 (e2e-local), §11 C2 row; revisions 4e-4h at the top (**4h is binding for C2: the `answer.text` splice is code-point aligned**).
3. Writer **C2** (Opus; `apps/candidate/src/**`, `apps/candidate/public/_headers`; S12 camera, blur on device, CSP; AT-D9 blur pixel test, D30, D36; tests first) in its own worktree from the `d1/integration` tip.
4. Lead, in parallel: `scripts/e2e-local.mjs` builds the recruiter with `VITE_DEMO_OUTBOX=1` (its `run()` needs an `env` option; test in `scripts/test/e2e-local.test.mjs`), then the real flow in `e2e/` against the local stack (closes r3a #1: the real trace_api SQL of the candidate store). Lead-only: `scripts/**`, `e2e/**` skeleton, root files.
5. Reviews: spec-reviewer + **security-reviewer** (camera, blur, CSP, S12) for C2; fixes test-first; `--no-ff`; full `pnpm verify`; CI incl. e2e-local; tag **`cp/d1-09`**; wrap-up; print Chat E's prompt.
6. Carried, due later: **Chat E (before the first staging dispatch):** OPEN-13 (edge volumetric limit); R4 re-review note 1 (`apps/recruiter/src/main.tsx` passes only the env fields it needs; `check-no-demo-outbox` then skips only when `VITE_TRACE_ENV !== 'production'`). **M3a:** revoke `private.mirror_session` from `trace_worker` + `mirror_seq` check (DB-6); gap-signal key space (DB-12); SessionDO `events.ndjson` single `Uint8Array` (C1b note 4, only if a cap is raised). **M4:** visible timeline cut (F3); SEC-5 deeper JPEG check. **M5:** grader outside the transaction (DB-7); real grader criteria already validated. **Fix-forward migration:** seeded default rubric shape (O2). Earlier carries unchanged: M7 SessionDO deletion + media prefix retention; security N1 org CORS (R5); N3 wrangler `redact_query_string`; db n-4 (M1); m2 n-1 (M3a); m3 n-7 (M4); `MIRROR_TRANSPORT='service'` only if DC-D2 picks it. Optional: consumer ack-and-alert for never-succeeding messages (R2 request 5).

## Decisions this chat (spec revisions 4f-4h; `docs/reviews/D1-review-r4.md`, `D1-review-r2.md`)
- Demo outbox: included only when `VITE_DEMO_OUTBOX === '1'` and `VITE_TRACE_ENV !== 'production'` (inline in `routes.tsx`; a helper defeated tree-shaking); `check-no-demo-outbox` in the root build; the flag only on the deploy-staging build step.
- GET `/tests/:testId` is owner/admin/recruiter only; `toDetail` drops a draft's incomplete items.
- Mirror writes its rows itself (not `private.mirror_session`), with every guard, the key check before any R2 read, and `media_objects` only when the canonical photo exists with the mirrored sha256 and size.
- Candidate text: no NUL, no lone surrogate (contract + edge rebuilt-text check); splices code-point aligned.
- Integrity: advisory xact lock on the job key; flip uses stored `photo_missing`, engine version and band; ≤ 50 000 event lines; timeline ≤ 1 000 entries. Mock grader refused when `TRACE_ENV = production`.
- Finalise memory at the cap: +47 to +60 MB of 128 MB (accepted).

## Founder items (`docs/progress/FOUNDER-QUEUE.md`)
- Unchanged: before the first staging dispatch, widen the Cloudflare token (R2 + Queues Edit); key script + `staging` variables (`CANDIDATE_TOKEN_KID`, `CANDIDATE_TOKEN_PUBLIC_JWK`, `API_STAGING_ORIGIN`) per `scripts/ops/README.md`; the three jobs login secrets `JOBS_{MIRROR,QUALITY,INTEGRITY}_DB_URL`. Rule 9 correction question (M3a). S1 residual risk. H9, H11, SES SMTP, Workers Paid only if DC-D2/D8 need it.

## Gotchas
- **commitlint:** body and footer lines ≤ 100 chars (a merge commit refused once for this); `merge:` type refused (use `chore: merge …`); lowercase subject.
- **gitleaks:** an identifier containing `KEY` next to a uuid literal trips `generic-api-key` (rename, e.g. `MCQ_UNFINISHED`).
- Worktree guard: no `$(…)`, heredocs, loops, chained `git` calls; write multi-line edits with the Edit tool or a script in the scratchpad (shell `\u` escapes get mangled).
- The machine sleeps: a sleeping laptop stalls agents (watchdog); resume them with SendMessage, nothing is lost.
- `test:rls` now runs the jobs db-tests (`pnpm --filter @trace/jobs exec vitest run -c vitest.db.config.ts`, ~12 s); they need the local stack and refuse non-local hosts.
- Short RAM: `npm_config_workspace_concurrency=1` for verify / verify:fast; never two chats running verify or db commands at once.
- Usage on Max (Chat C): 2 Opus writers + 2 Sonnet + 1 Opus fix writers, 5 Opus reviews, 2 Sonnet re-reviews, 1 Sonnet measurement, one full verify: ~3% → 43% of a fresh 5-hour window, 4% → 10% weekly, context ~45%.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` (tip = this handoff) · `git rev-parse --short "cp/d1-08^{commit}"` (`ab62681`) · `git status` (clean) · `docker ps` · `npm_config_workspace_concurrency=1 pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring`
