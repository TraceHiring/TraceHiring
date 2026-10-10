# HANDOFF — 2026-10-11 00:30 IST
Reason for stopping: phase done (M0a SPEC complete; AUTOPILOT §2 allows one phase per session)

## Where we are
- Milestone: **M0a**: toolchain, pipeline and skeleton. **Next phase: BUILD.**
- Branch: `milestone/m0a`. Its HEAD before this handoff was `d873d76` ("docs(specs): fix spacing in M0a spec status line"). After this handoff, `main` is merged into it.
- Checkpoints: `cp/autopilot-installed` (main `b4c56a4`) and `cp/m0a-00` (`ebfb1c4`, spec approved).
- `pnpm verify:fast` doesn't exist yet: there is no `package.json` until S1.0.
- Issues in this milestone: ABH-80 (observability part). Its "Done when" line isn't in the repo yet; it's in the founder queue.

## Done this session (verified)
- **Autopilot installed:**
  - `docs/AUTOPILOT.md`, `docs/progress/FOUNDER-QUEUE.md` and `RESTORE.md`, `scripts/backup.sh` and `.gitattributes`, all in `b4c56a4`;
  - the parallelism policy in `4863db2`.
- **Q54 = drop** (founder, 2026-10-11):
  - `.git/hooks/post-commit` was renamed to `post-commit.disabled`; it is untracked;
  - CLAUDE.md line 41 was replaced, and build-notes §0 records the answer.
- **Branches deleted:** the empty `claude/milestone-m0-spec-a99f57` and `-e4db77` (both were at `3e344bf`).
- **M0a spec, revisions 4–8** (`specs/m0-foundations.md`), five review rounds:
  - `spec-reviewer` and `database-reviewer` both returned APPROVE on revision 7, and revision 8 applies their last Low notes;
  - "Spec approved by autopilot reviewers" is recorded at the end of the spec;
  - the scope and exit gate are unchanged from the founder-approved revision 3.

## In progress (exact)
- Nothing. The working trees are clean.

## Next step (one precise action)
1. Check H1 (the toolchain): `node -v` should show v22.23.3, then `pnpm -v`, `gitleaks version` and `docker info`.
2. If all four pass, start BUILD with **S1.0** (spec §14): root `package.json` (minimal), `lefthook.yml` and `.gitleaks.toml`.
   - S1.0 is green when AT-6 (run by hand, output recorded) and a full-history gitleaks scan both pass (§5).
   - Then commit and tag `cp/m0a-01`.
3. If any of the four fails, there is no unblocked BUILD work. Stop and print the founder queue (AUTOPILOT §3).

## Decisions made this session
- Q54 = drop auto-push and work locally only. Recorded in build-notes §0.
- Parallelism: writers default 3, max 4; read-only helpers up to 6; shared files are lead-only. Recorded in AUTOPILOT §2, build-notes §0 and build-order rule 2.
- Local `--no-ff` merges instead of PRs; CI and staging exit-gate items are deferred with local proxies, pending the founder's answer; the new lead step S1.7 owns `supabase/`, `packages/shared` and `packages/db-types`. Recorded in the build-notes "Autopilot changes" table.
- `docs/progress/*` is also updated on `main`, so a fresh worktree sees the current handoff. Recorded in "Autopilot changes".

## Open questions for the founder (all in docs/progress/FOUNDER-QUEUE.md)
- **H1 toolchain.** Blocking: yes, for all of BUILD.
- **Local-only vs CI exit gates.** Blocks M0a CLOSE. Default if no answer: none; CLOSE waits.
- **Q57, the review-skill rows.** Blocks M0a REVIEW.
- **Q56 / H7, Q55, D3, ABH-80.** Non-blocking.

## Gotchas / do not touch
- Never re-enable or delete `.git/hooks/post-commit.disabled`. Never push.
- `milestone/m0a` is checked out in the worktree `.claude/worktrees/milestone-m0-spec-e4db77`, and `main` in the main checkout. Fast-forward `main` with `git -C <main checkout> merge --ff-only`.
- Never move or delete `cp/*` tags.
- The remote `trace` (GitHub) still exists but isn't used. `trace/main` is stale at `b7af663`.

## Verify first (the next session runs these before any change)
git log --oneline -5 milestone/m0a · git status · git tag · node -v · pnpm -v · gitleaks version · docker info
