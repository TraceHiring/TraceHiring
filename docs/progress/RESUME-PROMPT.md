# Resume prompt — the full procedure for the next Claude Code session (any account)

Written 2026-10-11 09:25 IST by the lead session; updated 20:10 and 23:50 IST, and 2026-10-12 01:45 IST. Everything the next session needs is in git; nothing from Updated 2026-10-12 09:25 IST: M0b on `d1/integration`.
earlier chats is available or needed. Updated 2026-10-12 12:35 IST: M0b spec approved, BUILD started. The short "paste prompt" the founder uses points here.

## 1. What Trace is and where the build stands
- Trace: an India-first online assessment platform; every integrity flag comes with evidence. CLAUDE.md holds
  the 9 non-negotiable product rules (a violation is a blocking bug) and the engineering rules.
- Build: milestones M0a → M13 in `docs/build-order.md`. Each milestone goes SPEC → BUILD → REVIEW → FIX → CLOSE
  (`docs/AUTOPILOT.md` §2, exactly ONE phase per session).
- **Update 2026-10-21 09:35 IST, Chat F (newest; wins over the lines below):** D1 REVIEW done: `docs/reviews/D1.md` **BLOCK** (D1-SPEC-1 High: AT-D21 never-build test missing; Mediums D1-SPEC-2 AT-D2 deliverable, D1-DB-1 flags vs rule table) + INCOMPLETE on the founder-gated staging half. Next: **Chat G (D1 FIX)**, code findings only; CLOSE needs the founder's go-ahead. Chat E2 part 2 still waits for the token fix.
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
`git show d1/integration:docs/progress/HANDOFF.md` and the review reports it names. Since `d9bf35a` the SessionStart
hook injects the handoff from the newest `*/integration` branch (older sessions injected a stale copy from `main`);
the branch still wins over anything injected.

STEP 2 — Get onto `d1/integration` without losing anyone's work
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
Resume the Trace autopilot from exactly where the last session stopped. You are probably a new Claude Code on a
different account connected to this folder: the git repo is the only source of truth, and no earlier chat is
needed or available. Do not trust your own memory; trust the repo.

First run (the plain fetch can hang on credentials; use this form):
  git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace
  git show d1/integration:docs/progress/RESUME-PROMPT.md
(on a fresh clone use trace/d1/integration) and follow that file exactly, step by step (sections 1-3), then read
CLAUDE.md, docs/AUTOPILOT.md, docs/progress/HANDOFF.md and the last 3 rows of docs/progress/LOG.md on d1/integration.
d1/integration is checked out in the worktree .claude/worktrees/d1-integration: enter it with the EnterWorktree tool
(path from `git worktree list`) as RESUME-PROMPT STEP 2 says; never `git switch` another worktree's branch.
Ignore any handoff text injected at session start wherever it disagrees with branch d1/integration.

Before changing anything, run HANDOFF "Verify first" and report in 5 lines whether the repo matches the handoff
(tip commit, clean tree, verify:fast, the stream branch tip, PR TraceHiring/TraceHiring#4 CI). If it does not match,
stop and tell me what differs.

We are on Claude Max: ONE CHAT = ONE BIG TASK (docs/progress/SESSION-PLAN.md, AUTOPILOT §6 first bullet). This chat's
task is the one HANDOFF names under "Next chat" (Chat E2: the staging half of Chat E; spec specs/d1-demo-slice.md §7,
revisions 4k-4l; scripts/ops/README.md "First staging deploy"). Founder gate part (a) is done and the 11 migrations are
on staging. Do HANDOFF "Next step" in order: the MT-9 hosted allow-list (tests first, Opus security + database review),
full verify, CI; re-dispatch from d1/integration with run_e2e=false, smoke; then ask me for part (b) (private key
secret, staging-worker-secrets.mjs, the two smoke users); dispatch with E2E; e2e-staging green; DC-D8; record
results; tag cp/d1-10. Do not ask me to delete anything else on staging. The task is done when cp/d1-10 is pushed;
then wrap up and print the prompt for the next chat in SESSION-PLAN.md. Every reviewer brief says: read other
revisions with git show / git diff only, never checkout. Founder gate part (a) is DONE (2026-10-20: Cloudflare token
widened with R2 + Queues; CANDIDATE_TOKEN_KID, CANDIDATE_TOKEN_PUBLIC_JWK, API_STAGING_ORIGIN set; check them by name
only), so staging dispatches from d1/integration are approved; ask me only for part (b), per HANDOFF and
scripts/ops/README.md. Production stays forbidden. M0a and M0b are built and reviewed but NOT closed; merging into
main needs my explicit go-ahead. This machine is short of RAM: run pnpm verify / verify:fast with
npm_config_workspace_concurrency=1.

Safety rules (never break these): never commit on or move main; never force-push; never delete or move branches,
tags (cp/*) or worktrees (.claude/worktrees/agent-* hold earlier work); never rewrite pushed history; never deploy
to production; never read .env* files or secret values (check GitHub secrets by name only); never re-enable
.git/hooks/post-commit.disabled. Only the lead runs supabase start/stop, db reset, test db, gen types, pnpm verify
and pnpm test:rls, and it warns running agents before a db reset. Stop to ask me only for the founder gates in
docs/AUTOPILOT.md §3. The founder-queue walkthrough is finished (2026-10-15); ask me about a remaining
FOUNDER-QUEUE item only when HANDOFF says it is due.

Stop when this chat's task is done, or context passes ~50%, or the 5-hour window passes 90% (no new agent after
80%); then the STEP 5 wrap-up (trace-handoff: handoff, log, backup, gitleaks via the pre-push hook, push) and print
the next chat's prompt. Work multi-agent: up to 3 writers and 3 read-only reviewers at once; each writer works in its
own worktree reset to an exact SHA with strict directories; lead-only files are reviewed, placed and verified by the
lead, and the lead re-runs verify:fast after every placement. Check usage after every agent result (log the weekly
figure), and keep every quality gate (tests first, Opus reviews, full pnpm verify, Linux CI) before any merge.
```
