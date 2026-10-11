# Resume prompt (paste into a NEW Claude Code session opened on the TraceHiring folder)

Written 2026-10-11 09:10 IST by the lead session. Works from any account: everything it needs is in git.

```
You are resuming the Trace autopilot (production build, milestone M0a, phase BUILD) in a NEW Claude Code
session. Nothing from earlier chats is available: the git repo is the only source of truth, and the repo
wins over any document. Work carefully; do not redo finished work and do not start the next milestone.

STEP 1 — Read, before touching anything
- Read CLAUDE.md and docs/AUTOPILOT.md in full and follow them (rules 1–9 are absolute).
- The SessionStart hook injects docs/progress/HANDOFF.md from whatever branch you are on; it can be stale.
  The LIVE state is on branch claude/trace-autopilot-resume-2dac7c. Read it with:
    git fetch trace
    git show claude/trace-autopilot-resume-2dac7c:docs/progress/HANDOFF.md
  then the three review reports it names under docs/reviews/ (M0a-S1.7-database-review.md,
  M0a-S1.7-redactor-security-review.md, M0a-S1.4-security-rereview.md) and specs/m0-foundations.md §5,
  §8, §9.1, §13, §14 (read them from that branch).

STEP 2 — Get onto the integration branch without losing anyone's work
- Run: git worktree list ; git branch --show-current ; git status --porcelain
- NEVER reset, rebase or commit on `main` (only the handoff mirror in STEP 5 goes there). Never force-push,
  never move or delete cp/* tags, never delete branches, never re-enable .git/hooks/post-commit.disabled.
- A hook blocks writing into another session's worktree, so work in YOUR session's own worktree:
  if the tree is clean and every commit in `git log --oneline claude/trace-autopilot-resume-2dac7c..HEAD`
  is also on `main` (check with `git branch --contains <sha>`), run
  `git reset --hard claude/trace-autopilot-resume-2dac7c` on YOUR session branch; that branch is then the
  new integration branch (say so in the handoff). If your tools are not pinned to a worktree, use
  .claude/worktrees/trace-autopilot-resume-2dac7c instead (or `git worktree add` it if missing).
- In the checkout you use, run `pnpm install --frozen-lockfile` before the first commit (git hooks need it).

STEP 3 — Verify first, and report in 5 lines whether the repo matches the handoff
- git log --oneline -8 (tip should be the newest "chore(progress)" handoff commit, after d7169b0) ; git status
- pnpm -s verify:fast   (must exit 0)
- docker ps   (container supabase_db_trace = the shared local stack; if it is down, start it yourself with
  pnpm exec supabase start -x realtime,storage-api,imgproxy,mailpit,studio,edge-runtime,logflare,vector,supavisor,postgres-meta)
- The stream branches exist locally or on `trace` (git branch -a) at the tips in the HANDOFF table:
  worktree-agent-ae15fb7cd05478040 @ bcb6d54 (W1 redactor), worktree-agent-a66ca65381173c087 @ 37adfd9 (W3a),
  worktree-agent-a5a761e3d78529f6f @ 0f62de8 (W3b), worktree-agent-a9809baf595fe8b13 @ aabef91 (W2 harness).
If anything differs, stop and tell me what differs.

STEP 4 — Continue with the HANDOFF "Next step" list, in order (W1 fixes, catalog fix pass + spec rev 12,
W3b/W2 review, integration, gate)
Operating rules learned the hard way:
- Usage: check it often (get_usage). The founder allows work to ~90%, then STEP 5. Run at most 2–3 agents at
  once: 5 agents used ~50% of a Pro window in 15 minutes, and one review agent costs ~7–9%. Start STEP 5 by
  ~80–85% if agents are still running.
- Writer agents created with isolation "worktree" start at `main`, NOT at the integration branch. Every writer
  prompt must say: "first confirm your branch has no commits of its own, then `git reset --hard <exact SHA>`"
  (to continue a stream, use that stream branch's tip SHA; for new work, the integration branch tip).
- Only the lead runs `supabase start`, `db reset`, `test db`, `gen types`. Writers touch the database only in
  rolled-back transactions: docker exec -i supabase_db_trace psql -U postgres -X -q -At -v ON_ERROR_STOP=1
- Catalog-check dev runner: node docs/progress/tools/catalog-run.mjs <checkout root> MT-1 MT-5b …
  The pending root-scripts test is docs/progress/tools/root-scripts.test.mjs.pending (wire it at integration).
- Reviews before anything merges into milestone/m0a (AUTOPILOT §2). Fix every Blocking/High/Medium
  test-first, one commit per finding. Merge streams with `git merge --no-ff`, then a full `pnpm verify`.
- Windows: never pipe supabase/docker output into `head` (it hangs) — write to a file. commitlint rejects a
  subject that starts with a capital letter. Build secret-shaped test strings at runtime (pre-commit gitleaks).
- Ask me (the founder) only for the AUTOPILOT §3 gates; put them in docs/progress/FOUNDER-QUEUE.md.

STEP 5 — Wrap-up, always (AUTOPILOT §6)
- Run the trace-handoff skill: overwrite docs/progress/HANDOFF.md on the integration branch (<150 lines, exact
  SHAs, the integration branch name, every stream branch and its state) and append to docs/progress/LOG.md.
- Update docs/progress/RESUME-PROMPT.md if any branch name, SHA or step above changed.
- Mirror HANDOFF.md and RESUME-PROMPT.md onto `main` with one docs-only commit
  (`chore(progress): handoff mirror on main`), so the next session's hook shows the live state. If `main` is
  checked out in a worktree the guard stops you writing to (the root folder), skip the mirror and say so in
  the handoff; do not move `main` with plumbing, which would leave that checkout looking dirty.
- sh scripts/backup.sh ; gitleaks git --redact --no-banner (must pass) ;
  git push trace main milestone/m0a <integration branch> <every stream branch with new commits> ; git push trace --tags
  (plain push only; if a push is rejected or waits for credentials, stop and add it to FOUNDER-QUEUE.md).
- Print the contents of docs/progress/RESUME-PROMPT.md's code block as the NEXT PROMPT, plus any new founder items.
```
