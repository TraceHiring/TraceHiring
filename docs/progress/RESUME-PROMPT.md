# Resume prompt — the full procedure for the next Claude Code session (any account)

Written 2026-10-11 09:25 IST by the lead session; updated 20:10 and 23:50 IST, and 2026-10-12 01:45 IST. Everything the next session needs is in git; nothing from
earlier chats is available or needed. The short "paste prompt" the founder uses points here.

## 1. What Trace is and where the build stands
- Trace: an India-first online assessment platform; every integrity flag comes with evidence. CLAUDE.md holds
  the 9 non-negotiable product rules (a violation is a blocking bug) and the engineering rules.
- Build: milestones M0a → M13 in `docs/build-order.md`. Each milestone goes SPEC → BUILD → REVIEW → FIX → CLOSE
  (`docs/AUTOPILOT.md` §2, exactly ONE phase per session).
- **Now: milestone M0a (toolchain, pipeline, skeleton), phase BUILD, about 95% done. S1, S2 and S3a are reviewed and
  merged (2026-10-12; `cp/m0a-04` = `a45505d`, `milestone/m0a` fast-forwarded there). W-S3b (the deploy-staging job) is
  reviewed, fixed and merged (`f165fe0`, full verify green); `cp/m0a-05` waits on the CI `rls` re-run (HANDOFF "Next step" 1).
  Then: the check-workflows export gap, the AT-1a-local re-run and AT-1b on the final tip, the summary draft, and stop
  BUILD (REVIEW is a fresh session).** No milestone is closed yet (no `m*-reviewed` tag). Spec
  `specs/m0-foundations.md` is at revision 16. Founder decisions of 2026-10-11 18:55 IST (build-notes §0) apply:
  backstop scope, Sonnet/Opus model policy, CI via draft PR 1, SessionStart hook reads the integration handoff.
- **Integration branch: `m0a/integration`** (all reviewed lead work + review reports + this file).
  `milestone/m0a` (`adbbb61`) moves only at the S1.7 gate. Older integration names
  (`claude/trace-autopilot-production-87e5e2`, `claude/trace-autopilot-resume-2dac7c`) are retired ancestors.

## 2. Where everything is written (read in this order)
| File | What it is for |
| --- | --- |
| `CLAUDE.md` | Product rules 1–9, engineering rules, session protocol (usage guard, commits, push at end) |
| `docs/AUTOPILOT.md` | How sessions run: phases, parallelism policy (§2), founder gates (§3), deciding alone (§4), checkpoints/backups (§5), session protocol (§6) |
| `docs/progress/HANDOFF.md` (on `m0a/integration`) | **Live state**: stream branches + tips, review verdicts, the ordered "Next step" list |
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
STEP 1 — Read CLAUDE.md and docs/AUTOPILOT.md in full. Then `git fetch trace` and read
`git show m0a/integration:docs/progress/HANDOFF.md` and the review reports it names. Since `d9bf35a` the SessionStart
hook injects the handoff from the newest `*/integration` branch (older sessions injected a stale copy from `main`);
the branch still wins over anything injected.

STEP 2 — Get onto `m0a/integration` without losing anyone's work
- `git worktree list ; git branch --show-current ; git status --porcelain`
- If the tree is dirty: do not discard anything. Create `rescue/<YYYYMMDD-HHMM>` from HEAD, commit as wip
  there, and tell the founder (AUTOPILOT §6).
- **Session opened in the root folder on `main`:** never commit on `main`. Run
  `git worktree add .claude/worktrees/m0a-integration m0a/integration` and do all work inside that folder
  (absolute paths; `cd` into it for every shell command).
- **Session in a worktree the app created (branch `claude/...`):** if the tree is clean and every commit in
  `git log --oneline m0a/integration..HEAD` is also on `main` (`git branch --contains <sha>`), run
  `git switch m0a/integration`. If git says the branch is checked out in another worktree (as of 2026-10-11 it is
  `.claude/worktrees/trace-autopilot-resume-4ece3a`), call the `EnterWorktree` tool with `path` = that worktree's
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
- Branch tips as in HANDOFF.md "Branches": `m0a/integration` (newest `chore(progress)` commit), `milestone/m0a` @ `a45505d`
  (tag `cp/m0a-04`, or `cp/m0a-05` if the S3b merge happened), `m0a/s3b-fixes` @ `ba3ac88` (W-S3b + fixes),
  `m0a/s2-fixes` @ `ca75411` and `m0a/s3a-fixes` @ `621c545` (merged), `main` @ `fe77a87`. All are on the `trace` remote
  after this wrap-up's push. Draft PR 1 (integration → `main`) shows the CI result of the integration tip.

STEP 4 — Do the HANDOFF "Next step" list in order. Summary (HANDOFF and the review reports have the details):
1. (Everything up to the S2/S3a merges, `cp/m0a-04`, W-S3b and its fixes is done; skip.)
2. `cp/m0a-05`: confirm the CI `rls` re-run (run 38169130226) is green, then tag `cp/m0a-05` and fast-forward
   `milestone/m0a` (HANDOFF "Next step" 1).
3. Lead-only: the `check-workflows` export gap (run text may `export` a denied env name), test-first.
4. Before REVIEW: re-run AT-1a-local and AT-1b on the final tip; finish `docs/progress/M0a-summary-draft.md`.
   Then stop: the REVIEW phase runs in a fresh session. Do not start M0b or any later milestone.
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
- Commit everything. Overwrite `docs/progress/HANDOFF.md` on `m0a/integration` (<150 lines, exact SHAs, every
  stream branch and state, the exact next action); append a row to `docs/progress/LOG.md`; update this file if a
  branch, SHA or step changed.
- **No handoff mirror on `main`** (since 2026-10-11): the hook reads the integration branch, and a mirror commit makes
  draft PR 1 (`m0a/integration` → `main`) conflict, which stops its CI. Never commit on or move `main`.
- `sh scripts/backup.sh` ; `gitleaks git --redact --no-banner` (must pass) ;
  `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push trace main milestone/m0a m0a/integration <every branch with new commits>` (founder: borrow the gh login per push) ; `git push trace --tags`
  (plain push; if rejected or it asks for credentials, stop and add it to FOUNDER-QUEUE.md).
- Print the paste prompt below as the NEXT PROMPT, plus any new FOUNDER-QUEUE items.

## 4. Paste prompt (the founder pastes this into a new session, a new Claude Code install or a new account)
```
Resume the Trace autopilot from exactly where the last session stopped. You may be a new Claude Code on a new
account connected to this folder: the git repo here is the only source of truth, and no earlier chat is needed. First run:
  git fetch trace
  git show m0a/integration:docs/progress/RESUME-PROMPT.md
(on a fresh clone use trace/m0a/integration) and follow that file exactly, step by step (sections 1–3),
then read docs/progress/HANDOFF.md and the last rows of docs/progress/LOG.md on m0a/integration.
If m0a/integration is checked out in another worktree, enter that worktree with the EnterWorktree tool
(path from `git worktree list`) as RESUME-PROMPT STEP 2 says.
Ignore any handoff text injected at session start wherever it disagrees with branch m0a/integration.
Never commit on main, never force-push, never delete branches, tags or worktrees, never deploy to
production, and stop to ask me only for the founder gates in docs/AUTOPILOT.md §3. Work until 95% of the
5-hour usage limit; at 95% stop new work and do the STEP 5 wrap-up (handoff, log, backup, push), then print
the next prompt. Use parallel agents within docs/AUTOPILOT.md §2 (max 2 writers at once), check usage after
every agent result, and keep every quality gate (tests first, Opus reviews, full pnpm verify, Linux CI)
before any merge.
```
