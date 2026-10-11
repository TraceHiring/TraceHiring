# Resume prompt (paste into a NEW Claude Code session opened on the TraceHiring folder)

Written 2026-10-11 08:40 IST by the lead session. Works from any account: everything it needs is in git.

```
You are resuming the Trace autopilot (production build, milestone M0a, phase BUILD) in a NEW Claude Code
session. Nothing from earlier chats is available: the git repo is the only source of truth, and the repo
wins over any document. Work carefully; do not redo finished work and do not start the next milestone.

STEP 1 — Read, before touching anything
- Read CLAUDE.md and docs/AUTOPILOT.md in full and follow them (rules 1–9 are absolute).
- The SessionStart hook injects docs/progress/HANDOFF.md from whatever branch you are on; it can be stale.
  The LIVE state is on branch claude/trace-autopilot-production-87e5e2. Read it with:
    git fetch trace
    git show claude/trace-autopilot-production-87e5e2:docs/progress/HANDOFF.md
    git show claude/trace-autopilot-production-87e5e2:docs/reviews/M0a-S1.4-security-rereview.md
  then the spec sections it names (specs/m0-foundations.md §5, §8, §13, §14; read them from that branch).

STEP 2 — Get onto the integration branch without losing anyone's work
- Run: git worktree list ; git branch --show-current ; git status --porcelain
- NEVER reset, rebase or commit on `main` (only the handoff mirror in STEP 5 goes there). Never force-push,
  never move or delete cp/* tags, never delete branches, never re-enable .git/hooks/post-commit.disabled.
- Preferred: work inside the existing worktree folder .claude/worktrees/trace-autopilot-production-87e5e2
  (branch claude/trace-autopilot-production-87e5e2). If that folder no longer exists, create it:
    git worktree add ".claude/worktrees/m0a-resume" claude/trace-autopilot-production-87e5e2
  If your tools are pinned to a fresh session worktree instead, and only if
  `git log --oneline claude/trace-autopilot-production-87e5e2..HEAD` prints nothing and the tree is clean,
  run `git reset --hard claude/trace-autopilot-production-87e5e2` on YOUR session branch; that branch is
  then the new integration branch (say so in the handoff).
- In the checkout you use, run `pnpm install --frozen-lockfile` before the first commit (git hooks need it).

STEP 3 — Verify first, and report in 5 lines whether the repo matches the handoff
- git log --oneline -8 (tip should be 6902078 or a later handoff commit) ; git status
- pnpm -s verify:fast   (must exit 0)
- docker ps   (container supabase_db_trace = the shared local stack; if it is down, start it yourself with
  pnpm exec supabase start -x realtime,storage-api,imgproxy,mailpit,studio,edge-runtime,logflare,vector,supavisor,postgres-meta)
- The four stream branches exist locally or on `trace` (git branch -a), at the tips in the HANDOFF table:
  worktree-agent-ae15fb7cd05478040 (redactor, done), worktree-agent-a66ca65381173c087 (catalog A, done),
  worktree-agent-a9e0bdcc6c2fbd966 (harness, partial), worktree-agent-a4f4047327f9e48e5 (catalog B, partial).
If anything differs, stop and tell me what differs.

STEP 4 — Continue with the HANDOFF "Next step" list, in order (S1.4 leftovers + S1.7 database half)
Operating rules learned the hard way:
- Usage: check the plan usage often. Run at most 2–3 writer agents at once; keep ≥15% of the 5-hour window
  for the wrap-up. At 80% finish only the current small step; at 90% stop and do STEP 5.
- Writer agents created with isolation "worktree" start at `main`, NOT at the integration branch. Every writer
  prompt must say: "first confirm your branch has no commits of its own, then `git reset --hard <exact SHA>`"
  (to continue a stream, use that stream branch's tip SHA; for new work, the integration branch tip).
- Only the lead runs `supabase start`, `db reset`, `test db`, `gen types`. Writers touch the database only in
  rolled-back transactions: docker exec -i supabase_db_trace psql -U postgres -X -q -At -v ON_ERROR_STOP=1
- Catalog-check dev runner: node docs/progress/tools/catalog-run.mjs <checkout root> MT-5b MT-5c …
  The pending root-scripts test is docs/progress/tools/root-scripts.test.mjs.pending (wire it at integration).
- Reviews before anything merges into milestone/m0a (AUTOPILOT §2): security-reviewer on the redactor stream
  (git diff da5c5ca..<redactor tip> -- packages/shared) and on the S1.4 fixes (git diff 6fadb17..271018d -- scripts);
  database-reviewer on all supabase/ work; spec-reviewer on the S1.7 diff. Fix every Blocking/High/Medium
  test-first, one commit per finding. Merge streams with `git merge --no-ff`, then a full `pnpm verify`.
- Windows: never pipe supabase/docker output into `head` (it hangs) — write to a file. commitlint rejects a
  subject that starts with a capital letter. Build secret-shaped test strings at runtime (pre-commit gitleaks).
- Ask me (the founder) only for the AUTOPILOT §3 gates; put them in docs/progress/FOUNDER-QUEUE.md.

STEP 5 — Wrap-up, always (AUTOPILOT §6)
- Run the trace-handoff skill: overwrite docs/progress/HANDOFF.md on the integration branch (<150 lines, exact
  SHAs, the integration branch name, every stream branch and its state) and append to docs/progress/LOG.md.
- Update docs/progress/RESUME-PROMPT.md if any branch name, SHA or step above changed.
- Mirror HANDOFF.md and RESUME-PROMPT.md onto `main` in the main checkout (one docs-only commit,
  `chore(progress): handoff mirror on main`), so the next session's hook shows the live state.
- sh scripts/backup.sh ; gitleaks git --redact --no-banner (must pass) ;
  git push trace main milestone/m0a <integration branch> <every stream branch with new commits> ; git push trace --tags
  (plain push only; if a push is rejected, stop and add it to FOUNDER-QUEUE.md).
- Print the contents of docs/progress/RESUME-PROMPT.md's code block as the NEXT PROMPT, plus any new founder items.
```
