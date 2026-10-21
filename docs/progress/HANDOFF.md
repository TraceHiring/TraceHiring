# HANDOFF — 2026-10-21 09:35 IST (end of Chat F, D1 REVIEW)
Reason for stopping: **phase done** (D1 REVIEW written and committed), with the 5-hour window at ~78-80% (plan Pro). Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`**. The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (`main` still `fe77a87`). M0a and M0b are built, reviewed and fixed, but **not CLOSED** (founder gates).
- **D1 ≈ 97%**: all code is merged, up to `cp/d1-09` + Chat E + Chat E2 part 1.
  - Left: the staging half (token R2 fix → deploy → part (b) → e2e-staging → DC-D8 → `cp/d1-10`), then D1 FIX (Chat G) and CLOSE.
- **Current phase: D1 REVIEW done → D1 FIX next (Chat G)**, with the staging half still blocked on the founder.

## Where we are (verified this chat)
- **`d1/integration`** = `b009da5` (review) + this handoff. The code is unchanged since `d84f4ca`; only docs were added (`docs/reviews/D1.md`, `docs/reviews/D1-probes/*.sql`, `docs/progress/*`).
- **Checks on `d84f4ca`:**
  - `verify:fast`: exit 0 at 08:35 (467 s; scripts 2555 + 1 skipped).
  - Full `pnpm verify` (08:35-08:52): typecheck, lint (gitleaks 783 commits, no leaks) and every package test passed. The `scripts` suite timed out one gitleaks/commitlint test under load (60 s limit; D1-LEAD-1).
  - Re-runs: `test:rls` **OK** (catalog 144, rls 2616, steps 5d/5e/AT-B8/M0B-DB-5/AT-D16); `build` **OK** (candidate 81.9 kB, headers, no-demo-outbox, scan-dist).
  - Two more `scripts` re-runs each timed out a different gitleaks test (87-222 s). These are not code failures: the same tests passed in verify:fast and in CI. The bounds were not loosened.
  - `pnpm audit --prod --audit-level=high`: exit 0 (the known `braces` ignore).
- **CI on PR #4, run 39535078887 on `d84f4ca`: all green** (static, rls, security, migrations, e2e-local 27 passed / 1 skipped = the Wave 0 smoke spec).
- **Staging:** unchanged since Chat E2 part 1. Dispatches 5-7 fail at R2 bucket create (Cloudflare code 10000). No newer dispatch. FOUNDER-QUEUE row "D1 staging" still shows the token as due.

## Done this chat
- `docs/reviews/D1.md` (`22c1432`, `b009da5`). It used three Opus read-only reviewers (spec, security, database). The lead re-proved the High, both Mediums and SEC-1.
- **Verdict: BLOCK (code) + INCOMPLETE (founder-gated staging half).**
  - **D1-SPEC-1 High:** AT-D21 `packages/config/test/never-build.test.ts` (rule 7 source and dependency scan) was never written. The source is clean today.
  - **D1-SPEC-2 Medium:** AT-D2 has no deliverable rule and no 270-330 s check. This settles SR-R5-3.
  - **D1-DB-1 Medium:** `integrity_flags_guard` does not check a flag against the session's rule table. Probe `docs/reviews/D1-probes/db-1-flags.sql` → a reviewer sees `strong_concern` built from an unvalidated rule given tier T1.
  - Lows, D1 FIX: D1-SEC-1 (rule-7 regex), D1-SEC-2 (`candidate-ui.spec.ts` host guard + token in URL), D1-SEC-3 (a, b: origin pin and config tests), D1-SPEC-3 (B's `streamId` → 400 in the E2E), D1-SPEC-4 (wrangler env key set), D1-SPEC-5 (`docs/demo/d1-script.md`), D1-DB-3 (`check-migrations` frozen-after-staging), and from the carried items README step 2 wording and the `D1_FLAG_FAMILIES` sync test (if cheap).
  - Lows with later owners: D1-DB-2 (M3a), D1-SEC-3 (c, d) (M1), D1-LEAD-1 (M1).
  - Carried N-1 → **M1**: fingerprint feasible, with md5 values recorded in the review. The other carried items are dispositioned in the review's "Carried items" table.
- Unchanged: `main` `fe77a87`, `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`; tags `cp/d1-01..09`.

## Next chats
1. **Chat G — D1 FIX** (fresh session; code findings only).
   - Every finding gets one commit and a regression test seen failing first, per `docs/reviews/D1.md` "Findings" (exact repro + fix in each row). Order: D1-SPEC-1, D1-DB-1, D1-SPEC-2, then the D1 FIX Lows.
   - D1-DB-1 needs a **forward migration** (the five D1 migrations are on staging; spec R-17) plus pgTAP red first in `rls_d1_cards`. The `X-SOFT-*` fixtures move to an operator-inserted test rule table.
   - D1-SPEC-2 needs a spec revision (4n, §7.3) and a `scripts/test` case for `recordedMs`.
   - Reviews: an Opus re-review (spec, plus database for DB-1), full `pnpm verify` with no agent running (D1-LEAD-1), and Linux CI.
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

## Decisions this chat
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
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` (tip = this handoff) · `git status` (clean) · `npm_config_workspace_concurrency=1 pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring` · `gh run list --repo TraceHiring/TraceHiring --workflow ci.yml --event workflow_dispatch --limit 3`
