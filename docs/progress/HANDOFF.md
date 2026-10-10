# HANDOFF — 2026-10-11 01:05 IST
Reason for stopping: context. S1.0 is done. The next step (S1.1–S1.3, one checkpoint) is the largest lead step in M0a, so it should start in a fresh session.

## Where we are
- Milestone: **M0a**: toolchain, pipeline and skeleton. **Phase: BUILD.** S1.0 is done; next is **S1.1–S1.3**.
- Branch: `milestone/m0a`. HEAD before this handoff: `49fe131` ("docs(skills): add M0a/M0b/M3a/M3b rows to milestone review (Q57)"). After this handoff, `main` is merged into it.
- Checkpoints: `cp/m0a-01` → `bdeb679` (S1.0 green). Earlier tags: `cp/m0a-00` and `cp/autopilot-installed`.
- `pnpm verify:fast` doesn't exist yet. The root `package.json` has only `prepare`; `verify` arrives in S1.1–S1.3.
- Spec: `specs/m0-foundations.md` **revision 9**, which applies the founder answers and the day-one results.
- Issues in this milestone: ABH-80 (observability part: "no candidate PII is found in logs (scan)").

## Done this session (verified)
- **Founder answers recorded** (`8b7974e` on `main`):
  - build-notes §0: H1, CI option (b), Q55/Q56/Q57/D3 approved, ABH-80's "Done when" line;
  - plan-conflicts #16 (RPO ≤ 2 min, RTO ≤ 2 h);
  - FOUNDER-QUEUE "Resolved" section;
  - AUTOPILOT §6 and CLAUDE.md: plain `git push` at session end.
- **Toolchain verified** (01:00 IST): Node v22.23.3, pnpm 12.11.2, gitleaks 8.30.1, Docker server 29.5.2.
  - Fix: Corepack's global `lastKnownGood` still named the broken pnpm 12.8.1, so I ran `corepack install --global pnpm@12.11.2`.
- **S1.0 committed** (`bdeb679`, tag `cp/m0a-01`). Files:
  - root `package.json` and `pnpm-workspace.yaml` (`allowBuilds: lefthook: true`);
  - `pnpm-lock.yaml`;
  - `lefthook.yml`: **pre-commit** runs a staged gitleaks scan, and **pre-push** runs a full-history gitleaks scan. Both fail if gitleaks is missing;
  - `.gitleaks.toml`;
  - Q56 deny rules in `.claude/settings.json`;
  - spec revision 9.
- **S1.0 checks:**
  - AT-6, run by hand in a temp repo:
    - clean commit: exit 0;
    - a staged `ghp_` token generated at runtime: exit 1, and no commit was made;
    - gitleaks removed from PATH: exit 1, with the install hint.
  - Pre-push: a leak committed with `--no-verify` makes the push exit 1, and the remote stays unchanged.
  - Full-history `gitleaks git` scan: no leaks.
- **Reviews:**
  - spec-reviewer: APPROVE after fixes.
  - security-reviewer: 1 High (no scan on the new push path), fixed with the pre-push hook and the AUTOPILOT §6 scan step. Its 2 Medium findings went to the founder queue (wider deny rules, remote protection). Its 1 Low (allowlist edits in `.gitleaks.toml`) is a to-do for S1.5 CI.
- **Q57 done** (`49fe131`): the review skill now has M0a, M0b, M3a and M3b rows.
- `pnpm install --frozen-lockfile` was run in the m0a worktree, so the hooks find lefthook there.

## In progress (exact)
- Nothing. All trees are clean after this commit.

## Next step (one precise action)
Start **S1.1–S1.3** (spec §14 row S1, §2 layout, §4 pins, §5 table row "S1.1–S1.3"), on `milestone/m0a`, as one checkpoint:
- ADR-028;
- the workspace globs and catalog in `pnpm-workspace.yaml`, `.npmrc`, `.node-version`;
- `.gitattributes` plus a renormalise commit;
- `@trace/config` with its rule fixture tests;
- every workspace's `package.json`, `tsconfig.json` and Vitest config, with a placeholder and one smoke test each;
- root scripts `typecheck`, `lint`, `test`, `build` and `verify`;
- add Prettier to lefthook pre-commit.

Watch out for:
- `prettier --check .` will flag the existing `docs/**` Markdown. Decide on purpose whether to format it or put it in `.prettierignore`, and record the choice.

When `pnpm verify` is green, run spec-reviewer and security-reviewer, commit, and tag `cp/m0a-02`.

## Decisions made this session
- CI also triggers on push to `milestone/**` (spec revision 9, build-notes "Autopilot changes").
- The pre-commit hook has gitleaks only until S1.1 (Prettier) and S1.6 (commitlint).
- Extra deny rules: `git push --force-with-lease`, `--delete` and `-d`.
- A pre-push full-history scan, plus an explicit scan before the session-end push (AUTOPILOT §6).

## Open questions for the founder (all in docs/progress/FOUNDER-QUEUE.md)
- **`gh auth login`.** Blocking: M0a CLOSE, which needs `gh` to read CI results on the private repo.
- **Branch protection vs the session-end push of `main`.** Options (a) and (b). Blocks the AT-13 design at S1.5 and CLOSE. No default; the autopilot waits for an answer.
- **H3–H6** (staging environment, tokens, Sentry). Blocking: M0a CLOSE (AT-11, AT-18, AT-22-staging).
- **Wider deny rules and remote protection.** Hardening; blocks nothing.

## Gotchas / do not touch
- Git hooks are shared by every worktree (`.git/hooks`). A checkout with no `node_modules` or no `lefthook.yml` (for example the `main` checkout) runs **no** pre-commit scan. Run `pnpm install` before committing in a worktree, and run `gitleaks git --redact --no-banner` by hand before any push.
- Never re-enable `.git/hooks/post-commit.disabled`. Never force-push. Never move or delete `cp/*` tags.
- On Windows, lefthook runs each command as `sh -c "<cmd>"`, so there must be **no double quotes** inside a lefthook `run:`.
- `milestone/m0a` is checked out in `.claude/worktrees/milestone-m0-spec-e4db77`. This session worked on `lead/m0a-s1` in its own worktree and fast-forwarded `milestone/m0a` with `git -C <m0a worktree> merge --ff-only`.
- `refs/agents/*` checkpoint refs from the desktop app exist. gitleaks scans them too, and they are clean.

## Verify first (the next session runs these before any change)
git log --oneline -5 milestone/m0a · git status · git tag · node -v · pnpm -v · gitleaks version · docker info · gitleaks git --redact --no-banner
