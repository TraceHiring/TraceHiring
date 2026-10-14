# HANDOFF — 2026-10-14 07:20 IST
Reason for stopping: usage guard, at 88% of the 5-hour window (resets about 08:20 IST); weekly is at 82% (resets about 15:30 IST).
The next session may be a new Claude Code on another account. Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt).

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M8 = closed beta → M9 … M13)
- Milestones closed: **0 of 17** (no `m*-reviewed` tag).
- **M0a:** REVIEW and FIX are done; it stopped before CLOSE (founder gate: the GitHub plan). `milestone/m0a` @ `7dc8c0d` = `cp/m0a-06`.
- **M0b:** BUILD, REVIEW and FIX are done; **no open Medium**. CLOSE waits for `m0a-reviewed` and the staging run. `milestone/m0b` @ `56c2641` = **`cp/m0b-05`**.
- **D1 (Demo slice): SPEC in progress** (founder, 2026-10-14: start D1 SPEC before `m0b-reviewed`, multi-agent). `specs/d1-demo-slice.md` is at **revision 2**. The Opus spec review of revision 1 was CHANGES REQUIRED (`docs/reviews/D1-spec-review.md`). Every finding S1–S12 is applied. The database review is still pending.

## Where we are
- **`d1/integration`** (worktree `.claude/worktrees/d1-integration`; enter it with `EnterWorktree` path) is cut from `milestone/m0b` @ `cp/m0b-05`. Its tip is this handoff, on top of `acd3f47` (spec revision 2, section 3).
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
- **D1 SPEC review and revision 2 (multi-agent):** an Opus spec-reviewer returned CHANGES REQUIRED (5 Blocking, 5 Major, 2 Minor), recorded with lead dispositions (`92847f9`). The lead fixed S1 (evidence-wins band order) and S2 (Sentry gates every writer) in `92847f9`, and S4/S12 in §6/§9/§11 (`7ece39f`). Two Sonnet writers rewrote §4–§5 (`8faa8f2`) and §3 (`acd3f47`); the lead accepted three writer additions (revision 2 note). D1 founder rows added (`8660d29`).
- **D1 SPEC, multi-agent:**
  - Four read-only Sonnet research briefs (recruiter/reviewer, candidate runtime, results, code and infra inventory).
  - The lead wrote §0–§1 (decisions D1-1…D1-18; `7c9185d`).
  - Three Sonnet writers drafted §3–§11 in parallel: data model and RLS (22 tables); candidate runtime (edge `SessionDO`, `InviteOtpDO`, tokens, photo, signals); results, UI, CI/E2E, AT-D1…AT-D22, streams.
  - The lead merged them and resolved every OPEN item in **§1.5 R-1…R-19** (`f660af1`).

## Next step (in order) — D1 SPEC continues (fresh window)
1. **Align the leftovers in revision 2** (lead, small edits). §5.1/§6.2 still say `quality_state`/`integrity_state`, `session_events`, `MEDIA_LINK_SECRET`, `shortlisted` and the old `rls_d1_reports` text. §7 must have one queue (`max_retries 5` + DLQ), buckets `trace-packages-<env>` and `trace-evidence-<env>`, and secrets `API_DB_URL`, `MEDIA_LINK_HMAC_KEY`, `CANDIDATE_TOKEN_PRIVATE_JWK`. Grep for each old name and make it agree with §3–§5 (revision 2 text wins).
2. **Opus `database-reviewer`** (fresh) on revision 2, plus an **Opus or Sonnet confirming `spec-reviewer`** that checks S1–S12 are resolved (`docs/reviews/D1-spec-review.md`). Run them in parallel. Apply the findings as revision 3, then record "Spec approved by autopilot reviewers".
3. Then D1 BUILD (fresh session). Wave 0 (lead): H6 Sentry must be done by the founder and AT-9-sentry written and green before any writer starts; DC-D checks; ADR-031; migrations and `rls_d1_*` red first. Founder rows for D1 are in FOUNDER-QUEUE (`8660d29`).

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
