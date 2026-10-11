# Resume prompt — the full procedure for the next Claude Code session (any account)

Written 2026-10-11 09:25 IST by the lead session. Everything the next session needs is in git; nothing from
earlier chats is available or needed. The short "paste prompt" the founder uses points here.

## 1. What Trace is and where the build stands
- Trace: an India-first online assessment platform; every integrity flag comes with evidence. CLAUDE.md holds
  the 9 non-negotiable product rules (a violation is a blocking bug) and the engineering rules.
- Build: milestones M0a → M13 in `docs/build-order.md`. Each milestone goes SPEC → BUILD → REVIEW → FIX → CLOSE
  (`docs/AUTOPILOT.md` §2, exactly ONE phase per session).
- **Now: milestone M0a (toolchain, pipeline, skeleton), phase BUILD, step S1.7 (shared code + database).**
  S1.0–S1.6 are built and reviewed. Every S1.7 stream is written; none is merged yet, because reviews found
  issues. No milestone is closed yet (`main` holds only docs; no `m*-reviewed` tag; last checkpoint `cp/m0a-01`).
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
| `specs/m0-foundations.md` (rev 11) | The M0a spec: §5 root scripts, §8 Supabase + catalog checks, §9.1 logger/redactor, §13 acceptance tests, §14 streams |
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
`git show m0a/integration:docs/progress/HANDOFF.md` and the review reports it names. The SessionStart hook may
inject an OLDER handoff from `main`: ignore it wherever it disagrees with `m0a/integration`.

STEP 2 — Get onto `m0a/integration` without losing anyone's work
- `git worktree list ; git branch --show-current ; git status --porcelain`
- If the tree is dirty: do not discard anything. Create `rescue/<YYYYMMDD-HHMM>` from HEAD, commit as wip
  there, and tell the founder (AUTOPILOT §6).
- **Session opened in the root folder on `main`:** never commit on `main`. Run
  `git worktree add .claude/worktrees/m0a-integration m0a/integration` and do all work inside that folder
  (absolute paths; `cd` into it for every shell command).
- **Session in a worktree the app created (branch `claude/...`):** if the tree is clean and every commit in
  `git log --oneline m0a/integration..HEAD` is also on `main` (`git branch --contains <sha>`), run
  `git switch m0a/integration`. If git says the branch is checked out in another worktree, work in that
  worktree if your tools allow it; otherwise stop and tell the founder.
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
- Stream branches at the HANDOFF tips: `worktree-agent-ae15fb7cd05478040` @ `bcb6d54` (W1 redactor),
  `worktree-agent-a66ca65381173c087` @ `37adfd9` (W3a), `worktree-agent-a5a761e3d78529f6f` @ `0f62de8` (W3b),
  `worktree-agent-a9809baf595fe8b13` @ `aabef91` (W2 harness), and `m0a/w1-fixes` @ `ee4a7f4` (W1 fixes; #2 done).
  All are on the `trace` remote except, until the founder pushes, `m0a/w1-fixes` and the newest `m0a/integration`.

STEP 4 — Do the HANDOFF "Next step" list in order. Summary (HANDOFF and the review reports have the details):
1. W1 redactor on `m0a/w1-fixes` (#2 is fixed in `ee4a7f4`): fix Medium #1 (+ #7 timing flake), test-first, one commit each.
2. Catalog-check fix pass on one branch (W3a `37adfd9` + W3b `0f62de8` merged): both database reviews'
   findings, test-first, a fixture per new branch; manifest + `supabase/tests/catalog-min-count`; spec §8.5
   revision 12. Finding #5 of the W3b review needs a spec decision first (check the plan's report data model;
   ask the founder via FOUNDER-QUEUE only if the plan does not settle it). Then fresh database-reviewer and
   spec-reviewer passes.
3. Integration on `m0a/integration` (`git merge --no-ff`): W1, catalog branch, W2 `aabef91`; generate
   `catalog_meta.test.sql`; wire root `package.json` (`test:rls`, `db:types`, `gen-catalog-tests --check`,
   `pnpm test:rls` in `verify`); add `scripts/test/root-scripts.test.mjs`; CI `rls` job uses `--stop`;
   `supabase stop` then a real `pnpm test:rls --stop` once (W2-2); full `pnpm verify`.
4. Gate: spec-reviewer on the S1.7 diff; fast-forward `milestone/m0a`; tags `cp/m0a-02`, `cp/m0a-03`.
5. S1.4 Lows N8/N9, then S2 ∥ S3 (spec §14). Do not start M0b or any later milestone.
Rules learned the hard way:
- Usage: check it often. The founder allows work to ~90% of the 5-hour window, then STEP 5. Max 2–3 agents at
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
- Mirror HANDOFF.md and RESUME-PROMPT.md onto `main` (one docs-only commit, `chore(progress): handoff mirror on
  main`) only from a checkout where `main` is checked out and you may write (the root folder); otherwise skip
  and say so. Never move `main` with plumbing.
- `sh scripts/backup.sh` ; `gitleaks git --redact --no-banner` (must pass) ;
  `git push trace main milestone/m0a m0a/integration <every branch with new commits>` ; `git push trace --tags`
  (plain push; if rejected or it asks for credentials, stop and add it to FOUNDER-QUEUE.md).
- Print the paste prompt below as the NEXT PROMPT, plus any new FOUNDER-QUEUE items.

## 4. Paste prompt (the founder pastes this into a new session)
```
Resume the Trace autopilot from exactly where the last session stopped. You may be on a new account: the git
repo in this folder is the only source of truth. First run:
  git fetch trace
  git show m0a/integration:docs/progress/RESUME-PROMPT.md
and follow that file exactly, step by step (sections 1–3). Ignore any handoff text injected at session start
wherever it disagrees with branch m0a/integration. Never commit on main, never force-push, never delete
branches, tags or worktrees, never deploy to production, and stop to ask me only for the founder gates in
docs/AUTOPILOT.md §3. Work until about 90% of the usage limit, then do the STEP 5 wrap-up and push.
```
