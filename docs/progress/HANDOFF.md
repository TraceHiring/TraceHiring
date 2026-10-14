# HANDOFF — 2026-10-14 07:10 IST
Reason for stopping: usage. 5-hour window about 68% (resets about 08:20 IST); **weekly about 79%** (resets about 15:30 IST). The next step is two Opus reviews (about 15% each), which would not have finished inside this window.
The next session may be a new Claude Code on another account. Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt).

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M8 = closed beta → M9 … M13)
- Milestones closed: **0 of 17** (no `m*-reviewed` tag).
- **M0a:** REVIEW and FIX are done; it stopped before CLOSE (founder gate: the GitHub plan). `milestone/m0a` @ `7dc8c0d` = `cp/m0a-06`.
- **M0b:** BUILD, REVIEW and FIX are done; **no open Medium**. CLOSE waits for `m0a-reviewed` and the staging run. `milestone/m0b` @ `56c2641` = **`cp/m0b-05`**.
- **D1 (Demo slice): SPEC in progress** (founder, 2026-10-14: start D1 SPEC before `m0b-reviewed`, multi-agent). `specs/d1-demo-slice.md` **revision 1 draft, not yet reviewed**.

## Where we are
- **`d1/integration`** (worktree `.claude/worktrees/d1-integration`; enter it with `EnterWorktree` path) is cut from `milestone/m0b` @ `cp/m0b-05`. Its tip is this handoff, on top of `f660af1` (the merged spec draft).
- `m0b/integration` @ `56c2641` (worktree `.claude/worktrees/m0b-integration`) is finished; leave it. `milestone/m0b` = `56c2641`.
- Draft PR **TraceHiring/TraceHiring#3** (`m0b/integration` → `main`) is for CI only. D1 has **no draft PR yet**: open one (`d1/integration` → `main`, draft, "CI only, do not merge") when BUILD starts.
- Tags: `cp/m0b-04` = `01b177c` and `cp/m0b-05` = `56c2641` (both pushed). The stray local tag `cp/m0b-03` (= `4cb6775`) is unpushed and kept; the founder may delete it.
- Unchanged: `milestone/m0a` @ `7dc8c0d`, `m0a/integration` @ `c619525`, `main` @ `fe77a87`.

## Done since the last handoff (verified)
- **MT-11 FR-1 follow-up** (on `m0b/integration`): `4fd9c8f`. A caller call counts only when bound to a column; new branch `caller_unbound`; the fixture was seen failing first. A Sonnet re-review returned PASS WITH FINDINGS (no regression; 3 false positives). `56c2641` fixes them (DISTINCTEXPR, NULLIFEXPR, row compare, correlated EXISTS) with negative controls. `test:rls` green (catalog **140**, rls **697**); Linux CI green (38418119525, 38492229906). Remaining Low (owner M1): an IN sub-select over another table that compares the caller only to a constant.
- **Founder answers (in chat, 2026-10-14; build-notes §0):**
  - Start D1 SPEC now, multi-agent.
  - Only deterministic browser facts (paste/drop, untrusted input) may raise the band.
  - Oval face guide for the start-photo blur.
  - A `workflow_dispatch` staging deploy for `d1/**` and `milestone/**` (the founder widens the env policy).
  - Band precedence: **evidence wins**.
- **D1 SPEC, multi-agent:**
  - Four read-only Sonnet research briefs (recruiter/reviewer, candidate runtime, results, code and infra inventory).
  - The lead wrote §0–§1 (decisions D1-1…D1-18; `7c9185d`).
  - Three Sonnet writers drafted §3–§11 in parallel: data model and RLS (22 tables); candidate runtime (edge `SessionDO`, `InviteOtpDO`, tokens, photo, signals); results, UI, CI/E2E, AT-D1…AT-D22, streams.
  - The lead merged them and resolved every OPEN item in **§1.5 R-1…R-19** (`f660af1`).

## Next step (in order) — D1 SPEC continues
1. **Review revision 1 in parallel** (AUTOPILOT §2 SPEC; Opus per the model policy, because it touches rules 1–9): `spec-reviewer` and `database-reviewer`, both fresh. Brief them that §1.2 decisions and §1.5 resolutions are binding unless they break a rule. Check especially:
   - R-1: per-worker public read cards versus MT-5/MT-14.
   - R-2: score-first triage inside the integrity job.
   - The RLS matrix in §3.3, D1-1's synthetic-only CHECK, and token and secret placement (R-9, D1-3).
   - That every §9 AT has a real test file.
   Optionally add a Sonnet `security-reviewer` on §4 if usage allows.
2. Apply every finding as revision 2; run a Sonnet confirming re-review; record "Spec approved by autopilot reviewers" in the spec.
3. Add new FOUNDER-QUEUE rows for D1 (spec §1.4):
   - enable R2;
   - Queues and Workers Paid if DC-D checks need them;
   - the staging env branch policy for `d1/**`;
   - a staging reviewer smoke user with TOTP;
   - H6 Sentry before BUILD.
   Existing rows cover the Cloudflare token and the Supabase staging vars.
4. Then D1 BUILD (fresh session): day-one checks DC-D1…DC-D9 first; ADR-031 (Postgres driver for Workers); lead-only migrations; streams per §11 (max 3 writers).

## Decisions made this session (HOW-level, AUTOPILOT §4)
- D1 decisions D1-1…D1-18 and resolutions R-1…R-19 in the spec, notably:
  - Synthetic-only contacts by DB CHECK (`@example.test`).
  - The candidate never reaches Postgres in D1.
  - `InviteOtpDO` and `SessionDO` in the secret-free edge Worker.
  - Per-worker `public` read cards (rule 1).
  - Photo viewing needs an assignment.
  - Three DB login roles for jobs.
- The milestone review skill covers M0–M13; D1 will be reviewed with it and tagged `d1-reviewed` (noted in spec §11).

## Open questions for the founder (`docs/progress/FOUNDER-QUEUE.md`)
- Unchanged: the GitHub plan (blocks M0a CLOSE); H3–H5 and H8–H11 staging; the URGENT Cloudflare token roll and `CLOUDFLARE_API_TOKEN`; `SUPABASE_STAGING_DB_URL`; **H6 Sentry (before D1 BUILD)**; H4 workers.dev subdomain.
- To add with spec revision 2: R2 enable, Queues and Workers Paid (if needed), the staging branch policy for `d1/**`, and a reviewer smoke user with TOTP.

## Gotchas / do not touch
- Only the lead runs `supabase start/stop`, `db reset`, `test db`, `gen types`, `pnpm verify` and `pnpm test:rls`. Run the full verify with no agent running. The redactor 50 ms timing test can fail at about 50.2 ms under load; re-run it first.
- Running one pgTAP file by hand: insert `create extension if not exists pgtap with schema extensions;` after its `begin;`.
- Node `String.replace` with a string replacement expands `$$`, `` $` `` and `$'`: use index slicing or a function replacer (this broke one merge this session).
- Worktree guard: no `git -C`, no `$(…)`, no heredocs with backticks plus git in one command, no pipes around git, and no bare `gitleaks git` (the `pre-push` hook runs the full-history scan). commitlint body lines must be at most 100 characters.
- Agents are expensive: four Sonnet research briefs cost about 30% of a Pro window, and three Sonnet writers about 20%. Check usage after each result.
- Push and fetch: `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push trace <refs>`.

## Verify first
- `git fetch trace` (with the `-c` pair) · `git log --oneline -3 d1/integration` · `git status` · `docker ps` · `pnpm -s verify:fast`
