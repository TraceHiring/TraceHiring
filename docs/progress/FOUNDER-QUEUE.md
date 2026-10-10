# Founder queue
Items only the founder can do (AUTOPILOT.md §3). The autopilot adds rows; the founder marks them done. Never paste secret values here or in chat — put them in `.env.local` or Doppler.

| Date | Item | Why | Exact founder steps | Blocking which milestone |
| --- | --- | --- | --- | --- |
| 2026-10-11 | H3–H6: GitHub `staging` environment, Cloudflare token, Supabase staging DB URL, Sentry projects (spec §1 H3–H6) | Needed only to *run* CI and the staging deploy. The code and its unit tests go ahead without them. | You chose (b) on 2026-10-11, so these are now needed. CI's `static`, `rls`, `security` and `migrations` jobs run on the first push without them; only `deploy-staging` waits. GitHub repo `AbhayRajGit/Tracehiring` → Settings → Environments → `staging` (deployment branches: `main`); secrets `CLOUDFLARE_API_TOKEN` (Cloudflare → My Profile → API Tokens; scopes Workers Scripts: Edit, Cloudflare Pages: Edit, Account Settings: Read), `SUPABASE_STAGING_DB_URL` (Supabase `trace-staging` → Connect → Session pooler string); variables `CLOUDFLARE_ACCOUNT_ID`, `SENTRY_DSN_RECRUITER`, `SENTRY_DSN_WORKERS` (Sentry projects `trace-recruiter` and `trace-workers`, with IP storage off and data scrubbing on; tell the autopilot the data region). Never paste the values in chat. | M0a CLOSE (AT-11, AT-18, AT-22-staging) |
| 2026-10-11 | Branch protection and repo settings on `main` (spec §7.4) | Needs the check names, which exist only after the first CI run. | The autopilot gives you the exact `gh api` commands after the first push has run CI. | M0a CLOSE (AT-13) |

## Resolved
| Date asked | Item | Founder answer (2026-10-11) |
| --- | --- | --- |
| 2026-10-11 | H1: fix the dev machine toolchain (build-notes Q5) | "Toolchain ready." Verified by the autopilot: Node v22.23.3, pnpm 12.11.2, gitleaks 8.30.1, Docker server 29.5.2. The autopilot also pointed Corepack's global default at pnpm 12.11.2 (`corepack install --global pnpm@12.11.2`), because it still named the broken 12.8.1 entry. |
| 2026-10-11 | Local-only mode vs CI exit gates | **(b)**: push before M0a closes. The repo is private. Plain `git push` of `main`, the milestone branch and all tags to `trace` at the end of every session (AUTOPILOT §6); never force; the post-commit hook stays disabled. M0a's exit gate uses the real CI result. |
| 2026-10-11 | Q57: review-skill rows for M0a/M0b/M3a/M3b | Approved. |
| 2026-10-11 | H7 / Q56: deny rules for local staging deploys | Approved. Staging deploys only from CI. Lands in S1.0. |
| 2026-10-11 | Q55: separate prod accounts | Approved. Separate Cloudflare account and Supabase org/project for prod, created at M8, not now. |
| 2026-10-11 | D3: candidate-app JS budget | Approved: 150 KB gzipped initial load. |
| 2026-10-11 | ABH-80 "Done when" line | Pasted (build-notes §0). Conflicts with plan §12 resolved as plan-conflicts #16: RPO ≤ 2 min, RTO ≤ 2 h. |
