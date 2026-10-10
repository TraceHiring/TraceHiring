# Trace — Claude Code build kit (Phase 0 + Phase 1)

Copy everything in this folder into the root of an empty private GitHub repo and make it the first commit. Then follow the steps below. Nothing here is product code — it is the brief, the rules and the review gate Claude Code builds against.

## What's inside
| Path | What it is | Who reads it |
| --- | --- | --- |
| `CLAUDE.md` | Short, always-loaded rules: the 9 product rules + engineering rules | Claude Code, every session |
| `docs/plan.md` | The full Final Product Plan (exported 10 Oct 2026, rev 39) | Claude Code per module |
| `docs/build-order.md` | 14 milestones (M0–M13) with Linear issues and testable exit gates | You + Claude Code |
| `docs/adr/` | The 26 locked decisions as ADRs | Claude Code (don't reopen) |
| `docs/design/` | Figma link, screen PNGs, `tokens.json`, earlier HTML board | Claude Code for UI |
| `docs/research/competitive-teardown.md` | Background research — not needed for building | Optional |
| `docs/setup-checklist.md` | Accounts, keys, plugins, permissions to set up **before** M0 | You |
| `docs/kickoff-prompt.md` | The exact prompts to paste, in order | You |
| `.claude/settings.json` | Denies common ways of reading `.env*` and common prod-deploy commands; asks before push/deploy; Stop hook. A guard-rail, not a guarantee — keep prod credentials off the build machine | Claude Code |
| `.claude/agents/` | `security-reviewer`, `database-reviewer`, `spec-reviewer` | Claude Code subagents |
| `.claude/skills/trace-milestone-review/` | The milestone review + security gate skill | Claude Code (fresh session) and Claude on your main account |
| `.claude/claude-security-guidance.md` | Trace security rules restated (advisory; CLAUDE.md is binding) | Claude Code |
| `scripts/claude-stop-gate.sh` | Blocks "done" up to 3 times while `pnpm verify:fast` fails; skipped while `.claude/allow-red` exists; no-op until M0 adds the script | Stop hook |
| `env.example`, `.gitignore` | Env variable names only; real values never committed | Everyone |
| `docs/plan-conflicts.md` | Contradictions found inside the plan and the resolution to build | Claude Code before M1 |
| `docs/founder-steps.md` | Click-by-click steps for you: Student Pack, AWS credits, accounts, machine, first session | You — start here |
| `docs/progress/HANDOFF.md`, `LOG.md` | Where the build stopped and what's next; one log line per session | Claude Code (auto-loaded at session start) |
| `.claude/skills/trace-handoff/` | Saves verified state and prints the resume prompt before a limit or `/clear` | Claude Code |
| `scripts/claude-statusline.mjs` | Status line showing 5-hour and weekly usage; saves the numbers for the guard | Claude Code |
| `scripts/claude-usage-guard.mjs` | Warns Claude at 80% / 90% of the limit so it hands off before being cut off | PostToolUse hook |
| `scripts/claude-session-start.mjs` | Injects the handoff + git state into every new, resumed, cleared or compacted session | SessionStart hook |

## Steps
1. **Before anything:** follow `docs/founder-steps.md` Steps 0–5 (it covers `docs/setup-checklist.md` A–D).
2. **Session 1:** paste Prompt 1 from `docs/kickoff-prompt.md`. Answer its questions (Prompt 2). Approve `specs/m0-foundations.md`.
3. **Each milestone:** new session → Prompt 3 → approve the spec → let it build → new session → Prompt 4 (review) → fix → re-review until PASS (or PASS WITH CONDITIONS, except at M8/M13) → merge `milestone/m<N>` → `git tag m<N>-reviewed`.
4. **Second opinion:** after Claude Code's review passes, bring `docs/reviews/M<N>.md`, the CI run link and read-only repo access (or a zip) to your main Claude account and ask it to run `trace-milestone-review` for M<N> in second-opinion mode.
5. **Gates you cannot skip:** M8 (closed beta with real candidates) and M13 (paid pilots, needs the external VAPT).

## Known conflicts
The full list with resolutions is in `docs/plan-conflicts.md`. The ones that came from the screens (follow the plan):
- **Media retention.** Screens 03 and 04 (and the board HTML) say clips are kept 90 days. The plan says media is deleted **30 days after the decision**, and video is kept 90 days at most (§10.2).
- **Appeal decision SLA.** Screens 02 and 04 show a 2-business-day SLA. The plan says **5 business days** (§3.3, §12).
- **Section numbers after your edit.** You removed the Roadmap and Open-items sections, so the plan now ends at §14 Decision log. Linear issues that cite "§14 Roadmap / §15 / §16" refer to the old numbering. `docs/build-order.md` replaces the roadmap for this build.
- **Face-absent threshold.** The plan still says ≥20 s continuous. If you adopt the tiered rule (log ≥3 s, flag ≥20 s, ≥10 s + typing burst, or ≥60 s total per question), update §6 before M4 starts.
