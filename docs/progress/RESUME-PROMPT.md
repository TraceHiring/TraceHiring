# Resume prompt — the full procedure for the next Claude Code session (any account)

Written 2026-10-11 09:25 IST by the lead session; updated 20:10 IST. Everything the next session needs is in git; nothing from
earlier chats is available or needed. The short "paste prompt" the founder uses points here.

## 1. What Trace is and where the build stands
- Trace: an India-first online assessment platform; every integrity flag comes with evidence. CLAUDE.md holds
  the 9 non-negotiable product rules (a violation is a blocking bug) and the engineering rules.
- Build: milestones M0a → M13 in `docs/build-order.md`. Each milestone goes SPEC → BUILD → REVIEW → FIX → CLOSE
  (`docs/AUTOPILOT.md` §2, exactly ONE phase per session).
- **Now: milestone M0a (toolchain, pipeline, skeleton), phase BUILD; S1 (S1.0–S1.7) done and through the S1.7 gate
  (2026-10-11 20:10 IST); next: J1, K1, then S2 ∥ S3.** `milestone/m0a` was fast-forwarded to the gate
  tip; checkpoints `cp/m0a-02`, `cp/m0a-03`. No milestone is closed yet (no `m*-reviewed` tag). Spec
  `specs/m0-foundations.md` is at revision 14. Founder decisions of 2026-10-11 18:55 IST (build-notes §0) apply:
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
| `specs/m0-foundations.md` (rev 14) | The M0a spec: §5 root scripts, §8 Supabase + catalog checks, §9.1 logger/redactor, §13 acceptance tests, §14 streams |
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
- Branch tips as in HANDOFF.md "Branches": `m0a/integration` (newest `chore(progress)` commit), `milestone/m0a` @ `54bd44d`, the
  S1.7 gate tip (tag `cp/m0a-03`), `m0a/s2s3-prep` @ `1c7dc63` (P1–P4), `main` @ `fe77a87`. All are on the `trace`
  remote after this wrap-up's push. Draft PR 1 (integration → `main`) shows the CI result of the integration tip.

STEP 4 — Do the HANDOFF "Next step" list in order. Summary (HANDOFF and the review reports have the details):
1. J1 (lead, test-first): `Token` + 4–8 spaces + `=`/`:` leak (`docs/reviews/M0a-S1.7-redactor-h1-k2-security-rereview.md`).
2. K1 (lead, test-first): `scripts/check-staging-secrets.mjs` (spec §7.2 step 6, AT-15 local part).
3. Merge `m0a/s2s3-prep` (P1–P4), record P5 (no `scripts/` grant); S2 ∥ S3 per `docs/progress/S2-S3-PLAN.md`
   (max 2 writers; Sonnet for mechanical placeholders, Opus for the deploy job). Before CLOSE also: spec revision 15
   (gate K3), the gitleaks allowlist fix, the M0a summary's Deferred table (HANDOFF "Owed before M0a CLOSE").
   Do not start M0b or any later milestone.
Rules learned the hard way:
- Usage: check it often. The founder allows work to ~95% of each 5-hour window, with STEP 5 finished by 95–96%; parallel Opus agents can use 70% in 30 minutes, so check `get_usage` after every agent result. Max 2–3 agents at
  once (5 agents used ~50% of a Pro window in 15 minutes; one review agent ≈ 7–9%). Start STEP 5 by 80–85% if
  agents are still running; record any agent result that arrives later before stopping.
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

## 4. Paste prompt (the founder pastes this into a new session)
```
Resume the Trace autopilot from exactly where the last session stopped. You may be on a new account: the git
repo in this folder is the only source of truth. First run:
  git fetch trace
  git show m0a/integration:docs/progress/RESUME-PROMPT.md
(on a fresh clone use trace/m0a/integration) and follow that file exactly, step by step (sections 1–3),
then read docs/progress/HANDOFF.md and the last rows of docs/progress/LOG.md on m0a/integration.
If m0a/integration is checked out in another worktree, enter that worktree with the EnterWorktree tool
(path from `git worktree list`) as RESUME-PROMPT STEP 2 says.
Ignore any handoff text injected at session start wherever it disagrees with branch m0a/integration.
Never commit on main, never force-push, never delete branches, tags or worktrees, never deploy to
production, and stop to ask me only for the founder gates in docs/AUTOPILOT.md §3. Work until about 95% of the
5-hour usage limit, with the STEP 5 wrap-up (log, backup, push) finished by 95–96%, then print the next
prompt. Use parallel agents within docs/AUTOPILOT.md §2 (max 2 writers at once), and check usage after
every agent result.
```
