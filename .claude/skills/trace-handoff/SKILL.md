---
name: trace-handoff
description: Use when the usage guard warns (90%/95% of the 5-hour or weekly limit), when context is getting full, before /clear, or at the end of any work session on Trace — saves verified state to docs/progress/HANDOFF.md so the next session resumes with no loss of quality.
---

# Trace session handoff

Goal: the next session (after a limit reset, a /clear, a compaction, or on a different machine) can continue **exactly** where this one stopped, using only the repo — never memory.

## Steps (do them in order, quickly — you may be close to a limit)
1. **Stop starting new work.** Finish or cleanly pause the current smallest step. Do not begin a new task, stream or subagent.
2. **Get the facts from the repo, not from memory:**
   ```bash
   git branch --show-current
   git status --porcelain
   git log --oneline -10
   pnpm -s verify:fast; echo "verify:fast exit=$?"     # skip only if it doesn't exist yet
   ```
3. **Commit everything** on the milestone branch (never on main):
   - Green: `git commit -am "feat(<module>): <what>"` (add new files first).
   - Red or partial: `git add -A && git commit -m "wip(<module>): <what> — NOT DONE, see HANDOFF.md"`. Never leave uncommitted changes. Never push to main.
   - If tests are deliberately red, create `.claude/allow-red` and record why in the handoff.
4. **Overwrite `docs/progress/HANDOFF.md`** using the template below. Every claim must be checkable: commit SHAs, file paths, test names, command exit codes from step 2. Write "unknown" rather than guess.
5. **Append one entry to `docs/progress/LOG.md`** (date, session summary in 3–5 lines, commits).
6. Commit: `git add docs/progress && git commit -m "chore(progress): handoff"`.
7. **Print the resume prompt** (section below) to the founder as the last message, then stop.

## HANDOFF.md template
```markdown
# HANDOFF — <YYYY-MM-DD HH:MM IST>
Reason for stopping: <usage guard 90% | usage guard 95% | context full | end of day | blocked>

## Where we are
- Milestone: M<N> — <name> · Branch: milestone/m<N> · HEAD: <sha> <subject>
- Last fully green commit: <sha> (verify:fast exit 0 at <time>)
- Issues in this milestone: done <ABH-..>, in progress <ABH-..>, not started <ABH-..>

## Done this session (verified)
- <what> — commit <sha> — tests: <test file/name>

## In progress (exact)
- File(s): <path:line-range> · What exists: <...> · What is missing: <...>
- Failing tests and why: <test name> — <reason> (expected / unexpected)

## Next step (one precise action)
<e.g. "Implement `creditRemaining()` in services/api/src/billing/credits.ts so tests/billing/credits.test.ts › 'unstarted invite costs 0' passes.">

## Decisions made this session
- <decision> — recorded in <specs/x.md | docs/build-notes.md | ADR-0xx>

## Open questions for the founder
- <question> (blocking? yes/no; default if no answer: <...>)

## Gotchas / do not touch
- <e.g. "migration 0007 is applied in dev; don't edit it — add 0008">

## Verify first (next session runs these before any change)
git log --oneline -5 · git status · pnpm -s verify:fast · <specific test>
```

## Resume prompt (print this for the founder)
```
Resume the Trace build. Read CLAUDE.md, then docs/progress/HANDOFF.md, then only the spec and plan sections it names. First run the "Verify first" commands and tell me in 5 lines whether the repo matches the handoff. If it does, continue with the "Next step" and follow docs/kickoff-prompt.md Prompt 3 rules for the rest of milestone M<N>. If it does not, stop and tell me what differs. Do not redo finished work and do not start the next milestone.
```

## Rules
- Repo over memory: if git or tests contradict what you remember, the repo wins.
- No new code after the 95% warning except what is needed to commit cleanly.
- Keep HANDOFF.md under 150 lines — the SessionStart hook injects the first 150.
