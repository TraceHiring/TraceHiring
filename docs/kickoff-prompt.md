# Prompts to paste into Claude Code

Use them in order. Each block is one message. Start every milestone in a **new session** so context stays clean.

**How sessions end and restart.** The status line shows `5h NN%` (5-hour window) and `7d NN%` (weekly). A hook warns Claude at 80% and 90%; Claude then runs the `trace-handoff` skill, commits, writes `docs/progress/HANDOFF.md` and prints **Prompt R**. When your limit resets, open a new session in the same repo (`claude`) and paste Prompt R. The SessionStart hook loads the handoff automatically. If the hook ever misses (the status line shows `–` for usage), type: `Run the trace-handoff skill now and stop.`

---

## Prompt 1 — Orientation (first session, normal mode — it needs to write one file)

```
You are the lead engineer for Trace. Read, in this order: CLAUDE.md, docs/build-order.md, docs/plan.md (all of it), docs/adr/README.md and docs/design/README.md. Look at the PNGs in docs/design/screens.

Do not write code yet. The only file you may create is docs/build-notes.md, containing:
1. Your understanding of the product in 10 bullets, including the 9 non-negotiable rules in your own words.
2. Every ambiguity, contradiction or missing detail you found in the plan that would block M0–M3, as numbered questions for me. Mark each one Blocking / Can-default, and for Can-default say the default you propose.
3. The repository layout and toolchain you will set up in M0 (match CLAUDE.md; justify any deviation).
4. The data model for M0–M3 as a table list with columns and RLS policy summary per role.
5. Risks you see in the build order, ranked.

Then stop and wait for my answers.
```

## Prompt 2 — Answer its questions
Answer each Blocking question in plain words. If you don't know, write "use your default and log it in docs/build-notes.md". Then:

```
Update docs/build-notes.md with my answers. Now write specs/m0-foundations.md: scope, file layout, schema + migrations, RLS policies with the allowed/denied test matrix per role, CI pipeline, the `pnpm verify` and `pnpm verify:fast` scripts, and the M0 exit-gate checklist from docs/build-order.md as acceptance tests. Stop for my approval.
```

## Prompt 3 — Build a milestone (reuse for every milestone)
Open a new session. Replace `<N>` and the module names.

```
We are building milestone M<N> from docs/build-order.md. Read CLAUDE.md, the M<N> section of docs/build-order.md, the plan sections it references, the Linear issues listed for M<N>, and any existing specs/*.md.

Step 1: create branch milestone/m<N>. Write or update specs/<module>.md for each module in M<N> (specs only — no code yet) — scope, data, API contracts (zod schemas), state machines, edge cases from plan §11, and one automated acceptance test per "Done when" line and per exit-gate item. List what can be built in parallel and the exact directories each stream owns. Stop for my approval.

Step 2 (after I approve): implement with test-driven development.
- Use subagents: one implementer per parallel stream, each in its own git worktree and owning only its directories (max 4 at once). Merge only through PRs.
- After each stream, run a fresh reviewer subagent on the diff against the spec. It reports only correctness bugs, spec gaps and violations of CLAUDE.md rules — not style.
- Run the security-reviewer and database-reviewer agents in .claude/agents on any change touching auth, RLS, media, payments, webhooks, LLM prompts or deletion.
- Run pnpm verify before saying anything is done. Never skip, weaken or delete a test to get green.

Step 3: when every acceptance test passes, update the Linear issues for M<N>, write docs/milestones/M<N>-summary.md (what was built, what was deferred and why, known limitations, how to demo it), and stop. Do not start the next milestone.
```

## Prompt 4 — Milestone review (new session, never the session that wrote the code)

```
Run the trace-milestone-review skill for milestone M<N>. Use BASE = the merge-base of branch milestone/m<N> with main (for M0, the first commit), and review BASE..milestone/m<N>. Write the report to docs/reviews/M<N>.md. Do not fix anything; report only.
```

Then fix: open another session — "Fix every Blocking finding in docs/reviews/M<N>.md, one PR per finding, with a regression test for each." Re-run Prompt 4 until the verdict is PASS, then tag `m<N>-reviewed`.

---

## Rules for you (the founder) during the build
- Read every spec before approving it. Specs are where wrong builds start; code review cannot rescue a wrong spec.
- Demo each milestone yourself on staging (click through it as a recruiter, a candidate and a reviewer) before tagging.
- If Claude proposes changing a rule in CLAUDE.md or an ADR, say no unless you would defend the change to a customer.
- Keep a running list of anything it defers — that list is your technical debt register.

---

## Prompt R — Resume after a limit reset, /clear or a new day
(Claude prints this itself at the end of every handoff; this is the same text.)

```
Resume the Trace build. Read CLAUDE.md, then docs/progress/HANDOFF.md, then only the spec and plan sections it names. First run the "Verify first" commands and tell me in 5 lines whether the repo matches the handoff. If it does, continue with the "Next step" and follow docs/kickoff-prompt.md Prompt 3 rules for the rest of the current milestone. If it does not, stop and tell me what differs. Do not redo finished work and do not start the next milestone.
```
