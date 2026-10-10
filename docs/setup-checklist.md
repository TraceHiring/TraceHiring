# Setup checklist — do this before the first Claude Code session

Tick everything in A–D before M0. E–F can run in parallel with M0–M2. The click-by-click version, including GitHub Student Pack and AWS credit steps, is `docs/founder-steps.md`.

## A. Accounts (founder only; Claude Code must not create accounts or handle passwords)
- [ ] GitHub: private repo `trace`, branch protection on `main` (PR required, CI must pass, no force-push).
- [ ] Cloudflare: account, Workers Paid plan (Durable Objects, Queues), R2 bucket per environment.
- [ ] Supabase: **three projects** in Mumbai — `trace-dev`, `trace-staging`, `trace-prod`. Claude Code only ever gets dev (and staging via CI). Turn on PITR for prod later.
- [ ] AWS: separate dev account (Organizations); Bedrock model access requested in an India region; ECS/ECR set up later in M5.
- [ ] Sentry (one project per app), Better Stack, PostHog (recruiter app only).
- [ ] Razorpay: test-mode keys only for now.
- [ ] Amazon SES (Mumbai) with the sending domain verified. DLT + WhatsApp BSP registration started (ABH-83).
- [ ] Domain + DNS on Cloudflare.

## B. Secrets and permissions
- [ ] Put every key in a password manager / secrets manager. **Never paste a key into the chat** with Claude.
- [ ] Locally: a `.env.local` that is git-ignored, with **dev-only** values (template: `env.example`). `.claude/settings.json` denies the common ways of reading `.env*` and the common prod-deploy commands, but permission rules can be worked around — the real protection is that the machine never holds prod credentials. Turn on Claude Code's sandbox (`/sandbox`) for extra containment.
- [ ] CI: GitHub Actions secrets per environment; prod deploys require manual approval.
- [ ] Scoped tokens: Cloudflare token limited to the dev account; Supabase MCP connected to `trace-dev` in **read-only** mode; AWS dev IAM role with least privilege.

## C. Claude Code on the build account
- [ ] Plan: Max 5x on the one build account (multi-agent runs burn a lot of tokens; Pro hits the 5-hour limit within hours). Don't rotate accounts to get past limits — see `docs/founder-steps.md` Step 0.
- [ ] Latest Claude Code installed; Node 22 LTS, pnpm, Docker (for `supabase start`), `gh` CLI logged in.
- [ ] Copy this kit into the empty repo root and commit it as the first commit.
- [ ] Install plugins. Check exact names in `/plugin` → Discover first. From the terminal, `claude plugin install <name> --scope project` records them in the repo; the in-session `/plugin install` form is shown below:

| Install | Command (verify name first) | Why |
| --- | --- | --- |
| Security guidance (Anthropic) | `/plugin install security-guidance@claude-plugins-official` | Flags risky patterns on every edit and commit. `.claude/claude-security-guidance.md` in this kit restates the Trace rules; treat it as advisory (the binding rules are in CLAUDE.md) |
| Claude Security (Anthropic) | `/plugin install claude-security@claude-plugins-official` | Multi-agent threat model + vuln scan; run at M8 and M13 |
| PR review toolkit + code review (Anthropic) | `/plugin install pr-review-toolkit@claude-plugins-official` | Specialised review agents for every PR |
| TypeScript LSP (Anthropic) | `/plugin install typescript-lsp@claude-plugins-official` (+ `npm i -g typescript-language-server typescript`) | Precise types and errors after each edit |
| Superpowers (obra) | `/plugin install superpowers@claude-plugins-official` | TDD, writing plans, subagent-driven development, worktrees, debugging. Set `SUPERPOWERS_DISABLE_TELEMETRY=1`. Use it as the only workflow plugin |
| Supabase skills | `claude plugin marketplace add supabase/agent-skills` → `claude plugin install supabase@supabase-agent-skills` and `postgres-best-practices@supabase-agent-skills` | RLS and Postgres best practice |
| Supabase MCP (dev only, read-only) | `claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp?project_ref=<DEV_REF>&read_only=true"` | Schema/logs/advisors. Never point at prod |
| Cloudflare skills | `/plugin marketplace add cloudflare/skills` → `/plugin install cloudflare@cloudflare` | Workers, Durable Objects, R2, Queues best practice |
| Context7 | `/plugin install context7@claude-plugins-official` | Current library docs |
| Playwright | `npm i -D @playwright/test` in repo; MCP optional: `claude mcp add playwright npx @playwright/mcp@latest` | e2e tests and UI debugging |
| Linear MCP | Connect in Claude settings / `claude mcp add` per Linear docs | Read issues ABH-5…91 and update status |

**Do not install:** ECC (`affaan-m/ECC`) as a plugin or via `npx ecc-universal` — its default hooks log tool inputs/outputs to disk without PII redaction, and its `multi-*` commands send code to other vendors. Its useful ideas are already folded into `.claude/agents/` in this kit. Also skip bulk agent packs (wshobson/agents, VoltAgent) and spec-kit/BMAD (they duplicate Superpowers).

## D. Hand-over files (already in this kit)
- `CLAUDE.md` · `docs/plan.md` · `docs/build-order.md` · `docs/adr/` · `docs/design/` (tokens, PNGs, Figma link) · `docs/research/competitive-teardown.md` (background only)
- `.claude/settings.json`, `.claude/agents/*`, `.claude/skills/trace-milestone-review/`, `.claude/claude-security-guidance.md`
- `docs/kickoff-prompt.md` — paste this into the first session.

## E. Inputs only the founder can provide (needed by the milestone shown)
- [ ] 50 sample items across formats for seed data (M1) — synthetic, no copyrighted questions.
- [ ] Final candidate-facing copy reviewed in English + Hindi (M3; counsel review ABH-89 before beta).
- [ ] 300-answer human-graded calibration set (M5).
- [ ] Vendor decisions: STT (ABH-86, before M5 real adapter), code execution (ABH-88, before M9).
- [ ] Bedrock India model availability + quotas (ABH-87, before M5).
- [ ] Recorded honest + cheating practice sessions from friends for detector tuning (M4 onward; the 500-session study before pilots end).

## F. Review loop
- After each milestone: the build account runs `trace-milestone-review` **in a fresh session** (not the one that wrote the code) and saves `docs/reviews/M<N>.md`. This run executes every gate (Docker, Playwright, load tools available locally).
- Then bring the report, the CI run link and repo access (read-only GitHub access or a zip of the repo) to your main Claude account for an independent second review with the same skill. That review runs in **second-opinion mode**: it re-runs what it can, reuses CI/first-review gate evidence for the rest, and re-checks all code-level findings itself.
- External CERT-In VAPT before paid pilots (M13). An AI review is a strong filter, not a certificate.
