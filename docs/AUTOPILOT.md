# Trace Autopilot — operating manual
Goal: build Trace exactly as planned, milestone by milestone, without the founder approving each step. The founder is often away; every session must leave the repo safe and resumable on any machine.

## 1. Sources of truth (higher wins)
CLAUDE.md rules 1–9 > docs/build-notes.md founder answers > docs/plan-conflicts.md resolutions > docs/adr/ > docs/plan.md > docs/design/. Never reopen a settled decision. The build order is docs/build-order.md, including splits such as M0a/M0b and M3a/M3b.

## 2. The loop — exactly ONE phase per session
Each milestone moves through these phases:
SPEC → BUILD (may take several sessions) → REVIEW → FIX (repeat REVIEW and FIX until PASS) → CLOSE → next milestone.
- SPEC: write or refresh specs/<module>.md (scope, data, zod contracts, state machines, §11 edge cases, one automated acceptance test per "Done when" line and exit-gate item, parallel streams with owned directories). Self-approve: run the spec-reviewer agent, plus database-reviewer for any schema or RLS. Fix every finding, then record "Spec approved by autopilot reviewers" in the spec.
- BUILD: test-driven, using the parallelism policy below. After each stream: spec-reviewer on the diff, plus security-reviewer and database-reviewer for anything touching auth, RLS, media, payments, webhooks, LLM prompts or deletion. Merge streams into milestone/m<X> locally with `git merge --no-ff` only after the reviewers pass and `pnpm verify` is green.
- Parallelism policy (founder, 2026-10-11):
  - Writers (agents that change code): default 3 at once, max 4, each in its own git worktree with a strictly separate set of directories. Shared files (root package.json, lockfile, migrations, packages/shared types) are changed only by the lead session, before or after the parallel streams, never inside them.
  - Read-only helpers (research, plan/spec reading, test-case drafting, spec-reviewer, security-reviewer, database-reviewer): up to 6 at once.
  - If two streams hit a merge conflict, or the usage guard reports 95%+, drop to 2 writers for the rest of the session.
  - Prefer finishing and merging 3 streams cleanly over starting 6 that half-finish.
  - Models (founder, 2026-10-11): **Sonnet** for Low/mechanical writers and small re-reviews; **Opus** for the lead, specs, and first reviews of code that touches rules 1–9.
  - Efficiency rules (founder, 2026-10-19; they add steps or information and remove no gate: every stream still gets tests first, its full set of Opus first reviews, fixes test first, a confirming re-review, full `pnpm verify` and Linux CI):
    - **Pre-flight before writers start.** A read-only Sonnet agent lists every lead-owned file, dependency, contract, check script and binding the stream's acceptance tests and spec text need, and flags what is missing; the lead adds those first (tests first), so writers do not hit them as review findings.
    - **Reviewer focus without gaps.** Each first reviewer keeps its full scope and is also told what the other reviewers on the same diff cover in depth, so it spends its depth on its own area and still reports anything it finds elsewhere.
    - **Fix writers by risk.** A fix round whose findings touch code under rules 1–9 (results, bands, cutoff, rejection paths, candidate data, media) uses an Opus fix writer; a round of only mechanical or test-gap findings may use Sonnet. When unsure, Opus.
    - **One confirming re-review for streams that finish together.** The re-review may cover two fix rounds in one agent, with a separate verdict and finding list per stream.
    - **Self-contained writer briefs.** The lead's prompt gives the exact interfaces, file paths, lead decisions and spec section numbers the writer needs; the writer still reads those spec sections in full.
- REVIEW: always a fresh session that did not write the code. Run the trace-milestone-review skill and write docs/reviews/M<X>.md.
- FIX: fix every Blocking finding, one commit per finding, each with a regression test.
- CLOSE: requires PASS, or PASS WITH CONDITIONS with an owner milestone for each Medium (M8 and M13 need a clean PASS). Write docs/milestones/M<X>-summary.md (built, deferred and why, Deferred gates table, autopilot decisions, how to demo). Merge milestone/m<X> into main through a PR ("Create a merge commit", the ruleset's required checks green on the PR head, founder go-ahead in chat; since the M0a CLOSE, 2026-10-22), tag m<X>-reviewed on the merge commit and push the tag, update Linear if connected (otherwise list the changes in the summary).

## 3. Founder gates — the ONLY reasons to stop and ask
1. A credential, account, domain, payment method or paid plan is needed. Give the exact variable name, where to get it and which account type. Never ask for a value in chat; the founder puts it in .env.local or Doppler.
2. An action outside the repo that costs money, can't be undone, or touches real people or production: prod deploys, DNS changes, enabling paid plans, deleting cloud resources, real SMS/WhatsApp/email to real people, a live Razorpay mode.
3. Anything that would break CLAUDE.md rules 1–9 or a founder answer.
4. The milestone gates: M4 does not start until a design-partner LOI is confirmed (plan-conflicts #14); M8 and M13 need explicit founder sign-off; no real candidate data before M8.
5. The same problem has failed after 3 different attempts.
When blocked on a gate: add it to docs/progress/FOUNDER-QUEUE.md (what, why, exact steps for the founder), keep working on everything not blocked (use mocks or adapters), and stop only when nothing unblocked is left.

## 4. Deciding on your own
- Anything covered by the sources in §1: decide and proceed.
- A new technical choice the sources don't cover: pick the option most consistent with the plan's principles (security first, simplest, no new vendor), write an ADR marked "Accepted (autopilot)", and list it in the milestone summary.
- You MAY change HOW we build (order inside a milestone, splitting a milestone, parallelism, tooling) with a note under "Autopilot changes" in docs/build-notes.md. You may NOT change WHAT we build (rules, features, scope, phases) — propose that in FOUNDER-QUEUE.md instead.
- Never guess facts: run it, read it, or check the docs (Context7). If a rule and the code disagree, the rule wins.

## 5. Safety: checkpoints, rollback, backups (local bundles + push at session end)
- main contains only reviewed milestones. Work happens on milestone/m<X> and stream branches.
- After every green sub-step: commit and tag cp/m<X>-<NN>. Never delete tags or rewrite main.
- Rollback: first `git branch rescue/<YYYYMMDD-HHMM> HEAD`, then `git reset --hard cp/<tag>` on the milestone branch. Log both in docs/progress/LOG.md.
- At the end of every session, run scripts/backup.sh. It writes `git bundle create ../trace-backups/trace-<date>-<shortsha>.bundle --all` and keeps the last 10.
- docs/progress/RESTORE.md explains how to restore from a bundle and how to roll back to any checkpoint.
- Secrets never go in git. .env.local stays git-ignored.

## 6. Session protocol
- **Max plan (founder, 2026-10-18; wins over the usage lines below):** one chat = one big task, from the roadmap in `docs/progress/SESSION-PLAN.md`. A chat stops when its task is done (merged, verified, tagged), or context passes ~50%, or the 5-hour window passes 90% (no new agent after 80%); then the wrap-up and the next chat's prompt. Up to 3 writers and 3 read-only reviewers at once inside a chat.
- Start: read CLAUDE.md, this file and docs/progress/HANDOFF.md. Verify git state (branch, clean tree, last cp tag) and toolchain (node 22, pnpm, docker, gitleaks), then run `pnpm verify:fast` if it exists. The repo wins over the handoff. If the tree is dirty from a crashed session, make a rescue branch, then either commit as wip or roll back to the last checkpoint. Never silently discard work.
- If the toolchain is missing on a new machine, list the install commands and add them to FOUNDER-QUEUE.md.
- During: use subagents for broad reading. Stop when context reaches ~60%, the usage guard reports 95% or more (work until 95%, then start the wrap-up; founder, 2026-10-12; at 90% start no new agent, task or stream), or the phase is done.
- End, always: run the trace-handoff skill. HANDOFF.md must state the milestone, the phase and the exact next action. Then run scripts/backup.sh, append to LOG.md, run `gitleaks git --redact --no-banner` (full history, every ref; it must pass and must not be skipped, because lefthook's `pre-push` hook can't run in a checkout without `node_modules`), and push the current milestone and integration branches and all tags to the `trace` remote with plain `git push` (`git push trace milestone/m<X> d1/integration` and `git push trace --tags`). **Never push `main` directly** (founder, 2026-10-22): ruleset 25633431 requires a PR with the checks static, rls, security and migrations (`e2e-local` is added back after D1 merges), so `main` moves only by a CLOSE PR merge (§2), and a mirror commit on `main` is no longer possible. Never put the literal skip-ci marker in a commit on a PR head (GitHub then skips the required checks); it belongs only in the CLOSE merge commit when the founder asks for it. Never force-push, never delete a remote ref, and never re-enable the post-commit hook. If a push is rejected, stop and add it to FOUNDER-QUEUE.md; don't work around it. Pushing git is allowed; production deploys are not (§3). CI (GitHub Actions) runs on push, and exit-gate items that need CI use the real CI result (founder, 2026-10-11). A draft PR from the integration branch into `main` (never merged; `main` moves only at CLOSE) makes CI run on every push: push the integration branch during the session whenever CI should run, and fix Linux CI failures before other work (founder, 2026-10-11). Finally print the NEXT PROMPT below plus any new FOUNDER-QUEUE items.

## 7. NEXT PROMPT (always this exact text)
Continue the Trace autopilot. Read CLAUDE.md, docs/AUTOPILOT.md and docs/progress/HANDOFF.md, verify the repo state, then do the next phase. Follow AUTOPILOT.md exactly.
