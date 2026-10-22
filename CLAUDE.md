Autopilot: follow docs/AUTOPILOT.md for how sessions run.

# Trace — instructions for Claude Code

Trace is an India-first online assessment platform for high-volume hiring where every integrity flag comes with evidence. Product spec: `docs/plan.md`. Build order and exit gates: `docs/build-order.md`. Settled decisions: `docs/adr/`. Design: `docs/design/`.

## Non-negotiable product rules (a violation is a blocking bug)
1. **Two results, never blended.** Answer Quality (0–100) and Integrity Signals (band) are stored, computed and displayed separately. No code path may combine them, and an integrity decision never edits a quality score.
2. **No automatic rejection anywhere.** No API, job, bulk action or webhook can reject a candidate on integrity. Bulk reject works only on Answer Quality cutoffs. Only human-confirmed flags appear on decision screens.
3. **Band engine is deterministic and versioned.** Same inputs → same band. Rulesets freeze when the first candidate starts. T3 (client-reported) signals cap at Review **unless** the signal is untrusted input or comes with raw media a reviewer can view (plan §6, §7.2). Detectors not yet validated (precision ≥90%, honest-session FPR <5%) run as context only.
4. **Notice + 72 h response before any integrity-based rejection; a different reviewer makes the final call.** Enforced in the database, not only the UI.
5. **Same report on both sides.** The candidate reads a separate projection (`report_candidate_view`) that strips other people's data. Never show a candidate another candidate's content, identity, device or IP.
6. **Score-first triage.** Integrity is reviewed only for shortlisted candidates; flags on others are `not_used` and not appealable.
7. **Never build:** emotion/stress/personality inference, AI-likeness scores shown to anyone, gaze as a flag, biometric templates or voiceprints (outside the opt-in identity add-on), IP/ASN as a flag in India.
8. **Media leaves the device only on an allow-list:** start photo, snapshot-grid stills, server-requested random stills, voice/video *answer* recordings, and stills/clips around a flag event. Everything else (camera frames, ambient audio) stays on the device. Background blurred on device, 5-minute signed links with viewer watermark, every view audited.
9. **Under-18 candidates are blocked** at launch.

## Engineering rules
- **Tenancy:** every table has `org_id` and RLS enabled with separate policies per operation. Evidence access is scoped to assigned candidates. Every new table or policy ships with RLS tests (allowed + denied cases per role). Service-role keys exist only in server workers, never in the browser or Durable Objects that serve candidates.
- **The server holds the truth:** timer, served items, final answer (rebuilt from edit events), code runs. Postgres stays off the in-test hot path (Durable Object per session).
- **Exactly-once results from at-least-once delivery:** sequence numbers, deterministic keys, idempotent jobs keyed by session + job + ruleset.
- **No PII in logs, errors, analytics, prompts or test fixtures.** Use synthetic data only. LLM prompts are pseudonymised and the answer is passed as delimited data.
- **Vendors behind interfaces** (`SttProvider`, `CodeRunner`, `LlmGrader`, `Messaging`, `Payments`) with a mock implementation. Sarvam is the planned first STT adapter but stays behind ABH-86; the code-execution vendor is not chosen (ABH-88).
- **Everything is versioned:** rulesets, rubrics, notices, items, models. Reports record the versions used.
- **Secrets:** never commit them; read from environment / secrets manager. Never read `.env*` files with real values. Never connect to production; use dev/staging projects only.
- **Stack:** TypeScript everywhere (strict). React + Vite on Cloudflare Pages; Workers + Durable Objects + R2 + Queues; Supabase Postgres (Mumbai) with SQL migrations in `supabase/migrations`; API and background jobs as a TS modular monolith on Workers + Queues (ADR-027; a job moves to ECS Fargate only via a new ADR when it hits a Workers limit; AWS only for Bedrock, SES, KMS/Secrets Manager); Claude via Bedrock India; AWS Secrets Manager + KMS envelope encryption for sensitive fields; Razorpay. Do not add a framework, database or vendor without a new ADR.

## How to work
- Before coding a module: read its plan section, write/refresh `specs/<module>.md` (scope, data, API, states, edge cases, acceptance tests), then implement in a fresh session.
- Test first for logic (band engine, timers, scoring, RLS, billing). A feature is done only when its "Done when" line in plan §5 has a passing automated test or a recorded measurement.
- Run before declaring any task done: `pnpm verify` (typecheck, lint, unit, RLS tests, build). Never mark work done with failing or skipped checks; never weaken a test to make it pass.
- A Stop hook runs `pnpm verify:fast` when you finish a turn. If you are deliberately stopping with red tests (writing failing tests first, or stopping to ask me a question), create an empty `.claude/allow-red` file and say so; delete it when the tests go green.
- Small PRs, one concern each, conventional commits. Each milestone ends with the `trace-milestone-review` skill and a git tag `m<N>-reviewed` only after a PASS.
- Known contradictions inside the plan and their resolutions are in `docs/plan-conflicts.md` — read it before M1.
- If the spec is ambiguous or two rules conflict, stop and ask — do not guess on anything touching rules 1–9.

## Session protocol (usage limits, context, no hallucination)
- **Start of every session:** the SessionStart hook injects `docs/progress/HANDOFF.md` and git state. Verify it (git log, `pnpm verify:fast`) before changing anything; the repo wins over the handoff and over your memory.
- **Usage guard:** work until 95% of the 5-hour or weekly limit (founder, 2026-10-12). A hook warns at 90% (start no new agent, task or stream; keep working on the current one, committing at each green step) and at 95%. At 95%: stop new work and start the wrap-up: commit, run the `trace-handoff` skill, `scripts/backup.sh`, the gitleaks scan and the push, then print the next prompt and stop. Never start "just one more" task past 95%. Commit often so the wrap-up only has docs left (it costs about 3–5% of the window).
- **Context:** one milestone stream per session. Use subagents for broad reading/search so file dumps stay out of this context. When context passes ~60%, run the `trace-handoff` skill, then `/clear` and resume from the handoff — prefer this over long auto-compacted sessions.
- **No guessing:** never claim a test passes, a file exists or an API behaves a certain way without checking in this session (run it, read it, or check the installed package types / Context7 docs). If something isn't in the repo, the spec or the plan, ask — don't invent it. Cite file paths for every claim in summaries.
- **Commit often** on the milestone branch (at least every passing sub-step). Never leave work uncommitted at the end of a session.
- **No auto-push; push explicitly at session end.** The `post-commit` auto-push hook is disabled (founder answer to build-notes Q54, 2026-10-11; renamed to `.git/hooks/post-commit.disabled`). Do not re-enable it. At the end of every session, after `scripts/backup.sh` (local git bundles, docs/AUTOPILOT.md §5), push `main`, the current milestone branch and all tags to the `trace` remote with plain `git push`, never force (founder, 2026-10-11; docs/AUTOPILOT.md §6). Production deploys stay blocked. Never rewrite history that was already pushed.

## Compact instructions
When compacting, keep: current milestone and branch, the exact task in progress, failing tests and why, decisions made this session, open questions, and the next step. Drop file contents and command output; they can be re-read.
