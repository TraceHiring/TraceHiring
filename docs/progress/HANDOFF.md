# HANDOFF — 2026-10-11 00:35 IST
Reason for stopping: blocked. H1 (toolchain) is still not fixed, and every BUILD step needs pnpm (AUTOPILOT §3).

## Where we are
- Milestone: **M0a**: toolchain, pipeline and skeleton. **Next phase: BUILD** (not started).
- Branch: `milestone/m0a`, HEAD `5507717` ("chore: merge main (handoff) into milestone/m0a") before this handoff. After this handoff, `main` is merged into it again.
- Checkpoints: `cp/autopilot-installed` (main `b4c56a4`) and `cp/m0a-00` (`ebfb1c4`, spec approved).
- `pnpm verify:fast` doesn't exist yet: there is no `package.json` until S1.0.
- Issues in this milestone: ABH-80 (observability part). Its "Done when" line isn't in the repo yet; it's in the founder queue.

## Done this session (verified)
- Repo state checked against the previous handoff: it matched. Branches and tags were as stated, and the main checkout and the m0a worktree were both clean.
- H1 re-checked at 00:33 IST. Nothing has changed since the founder-queue row was written:
  - `node -v` → v20.20.0. Node 22 isn't installed (nvm list: 25.3.0, 24.11.0, 20.20.0, 18.20.8).
  - `pnpm -v` → MODULE_NOT_FOUND for `...\corepack\v1\pnpm\12.8.1\bin\pnpm.cjs`.
  - `gitleaks version` → command not found.
  - `docker info` → can't connect to `dockerDesktopLinuxEngine` (the engine isn't running).
- No code changes. The only edits were to the progress docs.

## In progress (exact)
- Nothing. The working trees are clean.

## Next step (one precise action)
1. Check H1 again: `node -v` (v22.x), `pnpm -v`, `gitleaks version`, `docker info`.
2. If all four pass, start BUILD with **S1.0** (spec §14): root `package.json` (minimal), `lefthook.yml` and `.gitleaks.toml`.
   - S1.0 is green when AT-6 (run by hand, output recorded) and a full-history gitleaks scan both pass (§5).
   - Then commit and tag `cp/m0a-01`.
3. If any of the four still fails, stop at once and print the founder queue. Don't start any other work.

## Decisions made this session
- None.

## Open questions for the founder (all in docs/progress/FOUNDER-QUEUE.md)
- **H1 toolchain.** Blocking: yes, for all of BUILD. This is the only thing standing between M0a and BUILD.
- **Local-only vs CI exit gates.** Blocks M0a CLOSE. Default if no answer: none; CLOSE waits.
- **Q57, the review-skill rows.** Blocks M0a REVIEW.
- **Q56 / H7, Q55, D3, ABH-80.** Non-blocking.

## Gotchas / do not touch
- Never re-enable or delete `.git/hooks/post-commit.disabled`. Never push.
- `milestone/m0a` is checked out in the worktree `.claude/worktrees/milestone-m0-spec-e4db77`, and `main` in the main checkout. Fast-forward `main` with `git -C <main checkout> merge --ff-only`.
- Never move or delete `cp/*` tags.
- The remote `trace` (GitHub) still exists but isn't used. `trace/main` is stale at `b7af663`.
- `where node` resolves to `C:\nvm4w\node18\nodejs\node.exe` (that's the nvm4w symlink path), but it reports v20.20.0. After `nvm use 22.x`, re-check `node -v`.

## Verify first (the next session runs these before any change)
git log --oneline -5 milestone/m0a · git status · git tag · node -v · pnpm -v · gitleaks version · docker info
