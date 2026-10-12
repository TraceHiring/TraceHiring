# Founder steps — from today to the first line of code

Do these in order. Every step says what to click or type. Things only you can do are marked **(you)**.

## Step 0 · Decisions already made
- **ECC (affaan-m/ECC): do not download, clone or install it.** Its useful ideas are already rewritten for Trace inside `.claude/agents/` and `.claude/skills/`. Installing it would add hooks that log tool output (including candidate data) to disk.
- **One Claude account builds Trace.** Recommended plan: **Max 5x** on that account. Pro will hit the 5-hour limit every couple of hours on a multi-agent build.
- **Do not switch to a second Claude account to keep going after a limit.** Anthropic's terms prohibit bypassing restrictions and using extra accounts to evade detection or bans. They don't name usage limits explicitly, but rotating accounts to get past the 5-hour limit reads as bypassing a restriction, and losing the build account mid-project is the worst outcome. When a limit hits, the handoff system stops cleanly, and you resume with Prompt R after the reset (or buy extra usage with `/usage-credits`).

## Step 1 · GitHub Student Developer Pack — claim these (you, ~45 min)
Go to https://education.github.com/pack (you must be verified already), then click **Get access** on each:

| Claim | What you get | Use it for |
| --- | --- | --- |
| GitHub Pro | Automatic while you're a student: 3,000 Actions minutes/month on private repos | CI, Playwright runs |
| Codespaces | 180 core-hours/month | Backup dev machine if your laptop struggles |
| Sentry (sentry.io/for/education) | Free education plan, 1 year, renewable | Error tracking for all apps |
| Doppler | Free Team plan while a student | Dev + CI secrets (keeps keys out of files and out of Claude's reach) |
| 1Password | Free 1 year | Store every account password and API key |
| Testmail | Free Essential plan | Receive OTP/invite emails in automated tests |
| LocalStack | Free license | Test SES/S3/ECS code locally without spending AWS credits |
| Name.com or .TECH | One free domain for 1 year | Staging domain only (e.g. tracehire.dev) |
| JetBrains (optional) | Free IDEs incl. DataGrip | Inspecting Postgres |
| Frontend Masters / Educative (optional) | 6 months free | Learn React/TS, system design |

Separately (not in the pack): **Figma Education** — apply at figma.com/education with your IIT Madras email. It gives a free Professional plan; the free Starter plan's AI/MCP limit is already used up for this month.
Skip: DigitalOcean (offer ended July 2026), Copilot (Claude Code does the coding), Heroku, MongoDB, Stripe.

**Buy the real product domain yourself** (`.com` or `.in`) at Cloudflare Registrar (sold at cost). Free pack domains are odd endings that renew at full price.

## Step 2 · AWS account — secure it and use the $100 well (you, ~40 min)
1. Sign in as root → **Security credentials → enable MFA** on root. Then create an IAM user `abhay-admin` with console access + MFA and stop using root.
2. **Billing → Budgets → Create budget**: monthly cost budget of **$5**, alerts at 50% and 100% to your email. Cost Anomaly Detection → set the alert threshold to **$5**.
3. **Stay on the Free plan for now.** It cannot charge you. It closes at 6 months (about April 2027) or when credits run out — upgrade to the paid plan before then (credits carry over and then last 12 months from account creation). Don't join AWS Organizations.
4. **Earn the extra $100**: in the console home "Explore AWS" widget, do the 5 activities (EC2 launch, Bedrock playground, create a Budget — already done in step 2, Lambda web app, RDS database). **Delete the EC2 instance and RDS database immediately after** each activity.
5. **Test whether the credits pay for Claude** (this decides a lot): in Bedrock (region Mumbai `ap-south-1`) open the playground, pick Claude Haiku, send one short message. Next day check **Billing → Credits**: if the few cents were taken from credits, Claude-on-Bedrock is covered. Tell Claude Code the result (it's ABH-87).
6. **What the $100 is for:** Bedrock grading experiments in M5 (Haiku/Sonnet through the India `in.` inference profile), SES email, later ECS Fargate. **Not** for running Claude Code — the subscription is cheaper for that. Only if your subscription is exhausted and credits do cover Claude, you may run Claude Code on Bedrock with a Sonnet model pinned (`CLAUDE_CODE_USE_BEDROCK=1`, `ANTHROPIC_MODEL=<in. Sonnet profile id>`), watching Billing daily.
7. **AWS Activate Founders** (up to $1,000+ in credits): apply once you have a working landing page on your domain and have upgraded to the paid plan (Activate requires it). Target: after M2.

## Step 3 · Other accounts (you, ~1 hour)
- **GitHub:** create a **private** repo named `trace` (no README). Settings → Branches → protect `main` (require PR + passing checks).
- **Cloudflare:** sign up, add your domain. Start on the free plan; upgrade to Workers Paid ($5/month) when Claude Code reports that a free-plan limit blocks Queues or Durable Objects (likely around M3).
- **Supabase:** free plan allows **2 projects** → create `trace-dev` and `trace-staging` in **Mumbai**. Create `trace-prod` (Pro, $25/month) only at M8 before real candidates.
- **Razorpay:** sign up, stay in **test mode**.
- Put every password and key into 1Password. Never paste a key into a Claude chat.

## Step 4 · Your computer (you, ~1 hour)
- **Windows:** install WSL2 + Ubuntu (`wsl --install` in an admin PowerShell, restart) and do everything below inside Ubuntu. Install Docker Desktop with the WSL2 backend.
- **Mac/Linux:** install Docker Desktop (or OrbStack on Mac).
- Inside your terminal:
  ```bash
  # Node 22 LTS via nvm
  # Download first, read it, then run it (never pipe a remote script straight into a shell; M0a REVIEW SEC-4)
  curl -fsSLo nvm-install.sh https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh
  less nvm-install.sh && bash nvm-install.sh   # then reopen the terminal
  nvm install 22 && corepack enable && corepack prepare pnpm@latest --activate
  sudo apt install -y git gh        # Mac: brew install git gh
  gh auth login                     # log in as AbhayRajGit
  npm install -g @anthropic-ai/claude-code   # or follow the current install page at code.claude.com
  claude                            # log in with the Claude account that will build Trace, then /exit
  ```

## Step 5 · Put the kit in the repo (you, 5 min)
```bash
mkdir trace && cd trace
unzip ~/Downloads/trace-build-kit.zip -d .
git init -b main
git add -A && git commit -m "chore: project brief, rules, build order and Claude Code kit"
git remote add origin https://github.com/AbhayRajGit/trace.git
git push -u origin main
```

## Step 6 · First Claude Code session (you + Claude, ~2 hours)
1. `cd trace && claude`
2. Trust the folder when asked. The status line at the bottom should show `5h …% · 7d …%` after the first reply.
3. Install the plugins listed in `docs/setup-checklist.md` section C (copy each command; check the name in `/plugin` → Discover first).
4. Paste **Prompt 1** from `docs/kickoff-prompt.md`. Answer its questions with **Prompt 2**. Read and approve `specs/m0-foundations.md`.

## Step 7 · The loop for every milestone (M0 → M13)
1. New session → **Prompt 3** (with the milestone number) → read and approve the specs.
2. Let it build. Don't interrupt unless it asks a question.
3. If the usage guard fires, Claude writes the handoff and prints **Prompt R**. After the reset: `claude` in the repo → paste Prompt R.
4. When it says the milestone is done: new session → **Prompt 4** (review). Fix → re-review until PASS.
5. Demo it yourself on staging (as recruiter, candidate and reviewer).
6. Bring the review report + read-only repo access to your main Claude account for the second-opinion review.
7. Merge `milestone/m<N>` → `git tag m<N>-reviewed && git push --tags`.

## Step 8 · In parallel, this month (you — not code)
- ABH-83: start DLT (SMS) + WhatsApp Business registration — takes weeks.
- ABH-89: book an Indian privacy lawyer for the notices, consent and appeal policy.
- ABH-84: start finding question writers/reviewers.
- ABH-91: get Awign + 2 design partners talking to you — the build means nothing without a first drive.
- ABH-85: fix the pitch deck claims.

## Daily habit
Each evening, read `docs/progress/LOG.md` (one entry per session) and post a 3-line update in your weekly chat: what got done, what's next, what's blocking.
