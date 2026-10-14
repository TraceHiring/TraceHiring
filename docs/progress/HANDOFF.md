# HANDOFF — 2026-10-14 09:05 IST
Reason for stopping: **phase done — D1 SPEC is approved** (AUTOPILOT §2: one phase per session). Usage at stop: 5-hour 46% (resets about 13:20 IST), weekly **88%** (resets about 15:30 IST); chat context 65%.
The next session may be a new Claude Code on another account. Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt).

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M8 = closed beta → M9 … M13)
- Milestones closed: **0 of 17** (no `m*-reviewed` tag).
- **M0a:** REVIEW and FIX are done; it stopped before CLOSE (founder gate: the GitHub plan). `milestone/m0a` @ `7dc8c0d` = `cp/m0a-06`.
- **M0b:** BUILD, REVIEW and FIX are done; **no open Medium**. CLOSE waits for `m0a-reviewed` and the staging run. `milestone/m0b` @ `56c2641` = **`cp/m0b-05`**.
- **D1 (Demo slice): SPEC DONE: `specs/d1-demo-slice.md` revision 4, "Spec approved by autopilot reviewers"** (`a44c1f6`). Reviews (`docs/reviews/D1-spec-review.md`): Opus spec review of rev 1; Opus spec and Opus database reviews of rev 2b; Sonnet confirming spec and database reviews of rev 3 (both APPROVE WITH MINOR FIXES, all applied). **Next phase: D1 BUILD**, gated on the founder's H6 Sentry.

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

## Next step (in order) — D1 BUILD (fresh session)
1. **Founder gate first:** H6 Sentry (FOUNDER-QUEUE). No BUILD writer starts before H6 is done and AT-9-sentry (AT-D22, written by the lead) is green (spec D1-18, §11 Wave 0). Also useful before staging: enable R2, widen the `staging` env to `d1/**` and `milestone/**`, and the Cloudflare token roll (FOUNDER-QUEUE rows).
2. **Wave 0 (lead only, spec §11):**
   - day-one checks DC-D1…DC-D9 (Queues, DO, R2 on the plan; ES256 in workerd; service bindings; Postgres driver; Workers Free CPU; Playwright), recording each result in spec §8;
   - ADR-031 (Postgres driver for Workers);
   - ADR-030 acceptance text;
   - the migrations and `rls_d1_*` pgTAP, red first;
   - the MT-11 allow-list additions and MT-15;
   - `@trace/shared/contracts/d1`;
   - skeletons, boundaries, wrangler bindings, ci.yml;
   - AT-D22.
3. **Then the writer streams** R1/R3/C1 → R2/R4/C2 → R5 (≤ 3 at once, own worktrees, reviews per stream), with a full `pnpm verify` and Linux CI before each merge. Open a draft PR `d1/integration` → `main` (CI only) at BUILD start.
4. Founder queue walkthrough: the founder asked to go through FOUNDER-QUEUE one by one **later**. The ordered walkthrough (15 steps, starting with the Cloudflare token roll) was given in chat on 2026-10-14; redo it from the file when asked.

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
