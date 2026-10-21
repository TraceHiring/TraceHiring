# HANDOFF — 2026-10-21 09:55 IST (Chat G part 1, D1 FIX started)
Reason for stopping: **usage guard** (plan Pro: the 5-hour window was 83% at session start, ~87% at stop; resets ~12:50 IST). Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`**. The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (`main` still `fe77a87`). M0a and M0b are built, reviewed and fixed, but **not CLOSED** (founder gates).
- **D1 ≈ 97%**: all code merged up to `cp/d1-09` + Chat E + Chat E2 part 1. Left: D1 FIX (Chat G, started), the staging half (founder token → `cp/d1-10`), CLOSE.
- **Current phase: D1 FIX** (1 of 4 groups done, re-review pending).

## Where we are (verified this chat)
- **`d1/integration`** = `c8a4911` (D1-SPEC-1 fix) + this handoff. Before it: `a7b92fe` (Chat F handoff).
- Verify-first at start: tip `a7b92fe`, tree clean, CI on PR #4 run 39541735413 on `a7b92fe` all green (static, rls, security, migrations, e2e-local), `supabase_db_trace` up. The first verify:fast run failed only at prettier on the new, then-unformatted test file (written while it ran); Re-run on `c8a4911` (09:50-10:02, 730 s): typecheck and lint passed; jobs 240, api 403 passed; `scripts` 2554 passed / 1 skipped / **1 failed**: `scan-dist.test.mjs` "UTF-16LE at an odd offset" timed out (291 s vs the 60 s limit) = the known D1-LEAD-1 load class (real gitleaks on this laptop), not the new code; bound not loosened. `packages/config` never-build run directly: 29 passed. **Next chat: confirm Linux CI on PR #4 for the pushed tip and re-run verify:fast idle.**
- Staging: unchanged (dispatches 5-7 fail at R2 bucket create, Cloudflare code 10000).

## Done this chat
- **D1-SPEC-1 (High) fixed** — `c8a4911` `test(config): at-d21 never-build scan for rule 7`. `packages/config/test/never-build.test.ts` (29 cases): TypeScript-AST identifier scan of `apps|workers|services|packages/*/src` (non-test files; identifiers, private fields, JSX props and identifier-shaped strings; comments and prose excluded) for gaze, emotion(s/al), personality, voiceprint / voice print, face match(ing/er) / face recognition, AI likeness, ASN; dependency deny-list over every `package.json` and the `pnpm-lock.yaml` package keys; self-tests. Seen failing first with a planted `gazeDwellMs` in `packages/shared/src`. tsc and eslint clean on `packages/config`.
- `docs/reviews/D1.md` gained a "FIX (Chat G, in progress)" table.

## Next chats
1. **Chat G part 2 — D1 FIX continues** (fresh session; code findings only). D1-SPEC-1 is done (`c8a4911`); start at D1-DB-1.
   - Every finding gets one commit and a regression test seen failing first, per `docs/reviews/D1.md` "Findings" (exact repro + fix in each row). Order: ~~D1-SPEC-1~~ (done), D1-DB-1, D1-SPEC-2, then the D1 FIX Lows.
   - D1-DB-1 needs a **forward migration** (the five D1 migrations are on staging; spec R-17) plus pgTAP red first in `rls_d1_cards`. The `X-SOFT-*` fixtures move to an operator-inserted test rule table.
   - D1-SPEC-2 needs a spec revision (4n, §7.3) and a `scripts/test` case for `recordedMs`.
   - Reviews: an Opus re-review (spec, covering D1-SPEC-1 `c8a4911` too, plus database for DB-1), full `pnpm verify` with no agent running (D1-LEAD-1), and Linux CI.
   - Append "FIX" and "Re-review of the FIX" sections to `docs/reviews/D1.md` (as M0b.md did). Tag the next `cp/d1-NN` (`cp/d1-10` stays reserved for the staging run; use `cp/d1-11` for the FIX tip, or say so in the HANDOFF).
   - **CLOSE** (merge into `main`, `d1-reviewed`, M0a/M0b CLOSE) only with the founder's explicit go-ahead.
2. **Chat E2 part 2**: after the founder fixes the token and does part (b). Do not start before; check FOUNDER-QUEUE row "D1 staging".
   1. `gh workflow run ci.yml --repo TraceHiring/TraceHiring --ref d1/integration -f run_e2e=false`. Expect buckets created, Workers + Pages deployed, smoke green; the org sign-in smoke step stays red until H9. Still to prove: `ratelimits` on the plan (ADR-032).
   2. Founder part (b) (`scripts/ops/README.md` "First staging deploy" steps 3-5): private JWK `wrangler secret put`; `staging-worker-secrets.mjs --dry-run` then `--yes`; the H9 recruiter smoke user + `STAGING_SMOKE_*` (not set yet); the reviewer smoke user + `STAGING_REVIEWER_*`.
   3. Dispatch with E2E: deploy-staging green, `e2e-staging` green (AT-D1), DC-D8. Then the AT-D2 recording per the D1-SPEC-2 rule. Record the results, tag **`cp/d1-10`**, push.

## Carried (beyond D1 FIX; owners in `docs/reviews/D1.md`)
- **M1:** N-1, D1-SEC-3 (c, d), D1-LEAD-1, the concurrency group, `candidate-store` `newOtp`, FR-1 (+ new helpers).
- **M3a:** SEC-W1-1, D1-DB-2, DB-6, DB-12, C2 SEC-3, the token re-mint cap, `MIRROR_TRANSPORT`, earlier M3a carries.
- **M3b:** C2 SEC-6. **M4:** C2 SEC-5. **M5:** DB-7. **M7:** M0B-DB-1 (+ D1 tables), deletion.

## Decisions (Chat F, still valid)
- Staging exit-gate items are INCOMPLETE (founder-gated), as in M0b; not run, not worked around.
- AT-D2 rule proposed: one OS-level screen capture of the headed `pnpm e2e:record`, with `recordedMs` checked at 270-330 s (D1-SPEC-2). It becomes binding when Chat G writes spec revision 4n.
- Skill §5 step 4 (adversarial agent) was replaced by the lead re-proving every Medium and above (Pro usage budget); recorded in the review.

## Founder items (`docs/progress/FOUNDER-QUEUE.md`, row "D1 staging")
- **Due now:** (1) the CI token: add **Account · Workers R2 Storage · Edit** for the Trace account to the token stored as GitHub secret `CLOUDFLARE_API_TOKEN` (code 10000). (2) Part (b) after the next green dispatch. (3) The go-ahead for CLOSE after D1 FIX.

## Gotchas
- This account shows plan **Pro**. Chat F used 3 Opus reviews, 20% → ~80% of one 5-hour window, weekly 52% → ~60%.
- On this laptop the gitleaks-driven `scripts` tests and the redactor timing tests fail under load. Run full verify with no agent active, and never loosen a bound.
- Reviewers share the lead's worktree: "git show / git diff only; never checkout". Never run `test:rls` while a database reviewer probes.
- Short RAM: `npm_config_workspace_concurrency=1`; never two chats running verify or db commands at once.
- The D1 migrations are frozen (applied to staging): fix forward only (D1-DB-3 makes `check-migrations` enforce it).

## Verify first
- CI on PR #4 for this handoff commit (must be green; it is the first CI run of `c8a4911`) · `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` (tip = this handoff) · `git status` (clean) · `npm_config_workspace_concurrency=1 pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring` · `gh run list --repo TraceHiring/TraceHiring --workflow ci.yml --event workflow_dispatch --limit 3`
