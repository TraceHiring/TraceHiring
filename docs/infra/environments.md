# Environments

Every Trace dev and staging resource: its name, region, plan, environment, and the GitHub variable or secret that holds its config. **Names, refs and public values only. Never put a secret value here.**

- Written in the infra-setup session of 2026-10-11 (spec `specs/m0-foundations.md` revision 10). Updated the same day with the founder's answers and a read-only check of GitHub (see "Verified 2026-10-11").
- **Production does not exist yet.** It arrives at M8, in a **separate Supabase org and a separate Cloudflare account** (build-notes Q55, spec D5). Nothing below may ever be reused for prod.
- **No DNS changes on `tracehiring.tech`.** Staging uses `*.pages.dev` and `*.workers.dev` only.
- Free plans only. If anything would cost money, the autopilot stops and asks the founder.

Status key: **live**: exists and verified · **pending**: approved, not created yet · **CI**: CI creates it on the first staging deploy · **later**: belongs to a later milestone.

## Accounts

| Provider | Account | Plan | Notes |
| --- | --- | --- | --- |
| GitHub | repo **`TraceHiring/TraceHiring`** (private), `gh` logged in as `TraceHiring` | Personal account | Moved from `AbhayRajGit/Tracehiring` (founder, 2026-10-11). The founder repointed the local `trace` remote to `https://github.com/TraceHiring/TraceHiring.git` and pushed `main`, `milestone/m0a` and the tags. Visibility `PRIVATE` (checked with `gh repo view`). |
| Supabase | org **"rajabhay.work@gmail.com's Org"** (slug `vfrqfcytlcbylylqqtdl`) | Free | Free plan allows **2 active projects** across every org you own or administer; paused projects don't count. |
| Cloudflare | **"Rajabhay.work@gmail.com's Account"**, account ID `94fef930c2ecd2e37fbd5dc3151d99ba` | Workers Free | Account ID is not a secret (it appears in every `workers.dev`/API URL). R2 is **not enabled** on this account. The registered `*.workers.dev` subdomain is **not yet known**: the founder's answer of 2026-10-11 contained the template placeholder `<your-subdomain>.workers.dev`, not a real name (H4, FOUNDER-QUEUE). |

## Resources

| Resource | Provider | Environment | Region | Plan / cost | Status | Created by |
| --- | --- | --- | --- | --- | --- | --- |
| `trace-dev` | Supabase project | dev | Mumbai (founder) | Free, $0 | **created** (founder, 2026-10-11); ref, region and URL not yet read | Founder, in the dashboard (the Supabase connector can't create projects) |
| `trace-staging` | Supabase project | staging | Mumbai (founder) | Free, $0 | **created** (founder, 2026-10-11); ref, region and URL not yet read | Founder, in the dashboard |
| "rajabhay.work@gmail.com's Project" (ref `giuisatnjoagzlbcbktu`) | Supabase project | none | `ap-south-1` | Free | **paused** (founder, 2026-10-11; paused projects don't use a free slot) | Supabase default project; empty `public` schema; uses one of the 2 free slots |
| `trace-candidate-staging` | Cloudflare Pages | staging | global | Free, $0 | CI | `wrangler pages deploy` in `deploy-staging` (spec §7.2 step 7). URL `https://trace-candidate-staging.pages.dev` |
| `trace-recruiter-staging` | Cloudflare Pages | staging | global | Free, $0 | CI | Same. URL `https://trace-recruiter-staging.pages.dev` |
| `trace-edge-staging` | Cloudflare Worker | staging | global | Workers Free, $0 | CI | `wrangler deploy --env staging` (spec §7.2 step 5). URL `https://trace-edge-staging.abhayraj.workers.dev` |
| `trace-jobs-staging` | Cloudflare Worker | staging | global | Workers Free, $0 | CI | Same |
| `trace-api-staging` | Cloudflare Worker | staging | global | Workers Free, $0 | CI | Same |
| Workers `dev` env, local Supabase | local machine | dev | — | — | local only | `wrangler dev` and `supabase start`; no Cloudflare dev resources exist |
| R2 buckets, Queues, Durable Object namespaces | Cloudflare | staging | — | — | later | Each arrives with the milestone that first needs it, after the free-plan check (spec §1 "Out of scope", build-notes risk 19). Names will use the `-staging` / `-dev` suffix. |

Why nothing was created in Cloudflare now: the M0a spec needs only Pages ×2 and Workers ×3 on staging, and CI creates both on the first deploy. The Cloudflare connector has no tool to create Pages projects, Queues or Durable Objects.

## GitHub environment `staging` (on `TraceHiring/TraceHiring`)

Planned: deployment branches limited to `main` (H3). **Checked 2026-10-11: the environment exists, but `deployment_branch_policy` is `null`, so any branch can deploy to it** (FOUNDER-QUEUE). Each secret is scoped to the step that uses it (spec §7.2).

| Name | Kind | Holds | Used by | Status | Set by |
| --- | --- | --- | --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | variable | Cloudflare account ID (above) | `wrangler` steps 5–7 | **live** (checked with `gh variable list`) | Founder |
| `SUPABASE_STAGING_PROJECT_REF` | variable | `vsugnnxeahjtgzmgmyfu` | M0b on | **live** (checked 2026-10-14 with `gh variable list`) | Autopilot (2026-10-14) |
| `SUPABASE_STAGING_URL` | variable | `https://vsugnnxeahjtgzmgmyfu.supabase.co` | M0b on (recruiter app, CSP) | **live**; Auth health 200 with the key | Autopilot (2026-10-14) |
| `SUPABASE_STAGING_PUBLISHABLE_KEY` | variable | `trace-staging` publishable key (`sb_publishable_…`), a public client key | M0b on | **live** (checked 2026-10-14 with `gh variable list`) | Autopilot (2026-10-14) |
| `CLOUDFLARE_API_TOKEN` | **secret** | API token limited to this account: Workers Scripts: Edit, Cloudflare Pages: Edit, Account Settings: Read; no IP filter, no TTL | steps 5–7 only | **live** (set 2026-10-14; old token rolled; misnamed secret deleted; checked by name) | **Founder only** |
| `SUPABASE_STAGING_DB_URL` | **secret** | `trace-staging` Session-pooler string (port 5432, `?sslmode=require`), with password | steps 3–4 only | **live** (set 2026-10-14; `SUPABASE_DB_URL` deleted; checked by name) | **Founder only** |
| `VITE_SENTRY_DSN` (recruiter build; the D1 spec name, L-24), `SENTRY_DSN_WORKERS` | variable | Sentry DSNs of `trace-recruiter` and `trace-workers` (EU region, `*.ingest.de.sentry.io`) | Sentry adapter (D1, AT-D22) | **live** (set 2026-10-14, H6) | Founder |

The autopilot never sets or reads a secret value. `trace-dev` gets no GitHub variables: dev runs locally.

## AWS (staging), set up by the founder 2026-10-11
Identifiers only; no keys are recorded here. Plan: AWS is used only for Bedrock, SES and KMS/Secrets Manager (CLAUDE.md, ADR-027).

| Item | Value |
| --- | --- |
| Account | `423741523885` |
| Region | `ap-south-1` (Mumbai) |
| Bedrock inference profile (as set) | `apac.anthropic.claude-3-haiku-20240307-v1:0`. **Cross-region:** it routes to ap-northeast-1, ap-northeast-2, ap-southeast-1, ap-southeast-2 and ap-south-1, so prompts can be processed outside India. This conflicts with "Claude via Bedrock India" and needs a founder decision (FOUNDER-QUEUE). Not used by any code yet. |
| KMS key | `arn:aws:kms:ap-south-1:423741523885:key/931c62c9-07c6-4aa3-85a8-67c5e2466e21` |
| IAM policy | `arn:aws:iam::423741523885:policy/trace-staging-app` |
| IAM user | `arn:aws:iam::423741523885:user/trace-staging-app` |
| SES identity | `tracehiring.tech`, with DKIM and MAIL FROM `mail.tracehiring.tech`. Sandbox mode. Verification status: **unknown**; the founder's note still had the `<SUCCESS/PENDING>` placeholder. One founder-owned test recipient is verified; its address is not recorded here (no PII in the repo). |

GitHub `staging` secrets (names only, per the founder): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. **No workflow reads any AWS secret yet** (.github/workflows/ci.yml has no deploy job; spec §7.3 lists no AWS names), so nothing mismatches today. These are the standard names `aws-actions/configure-aws-credentials` and the AWS SDK use; the deploy job (S3) must read exactly these, or the names get fixed then.

## Verified 2026-10-11 (read-only, names only)

- `git remote -v`: `trace` → `https://github.com/TraceHiring/TraceHiring.git` (fetch and push).
- `gh repo view TraceHiring/TraceHiring --json visibility`: `PRIVATE`.
- `gh api repos/TraceHiring/TraceHiring/environments`: one environment, `staging`; `protection_rules` empty; `deployment_branch_policy` `null`.
- `gh variable list --env staging`: `CLOUDFLARE_ACCOUNT_ID` only.
- `gh secret list --env staging` (names only): `SUPABASE_DB_URL`, and **one secret whose name begins `CFAT_` and looks like a Cloudflare API token value pasted into the name field**. Secret names are not encrypted and are shown to anyone who can list secrets, so that token must be treated as exposed: revoke it and set a new one under the right name (FOUNDER-QUEUE). The name is deliberately not copied here.
- No repo-level secrets.
- `.github/workflows/` does not exist yet; CI is written in S1.5. The names checked are those in spec §7.3, which S1.5 implements.
- The Supabase connector was **not attached** to this session (only Claude Docs, visualize and scheduled-tasks were), so the project refs, URLs and publishable keys could not be read and the three `SUPABASE_STAGING_*` variables are still unset.

## Verified 2026-10-14 (founder walkthrough steps 1–4; names only, never values)

- Supabase: `trace-staging` ref `vsugnnxeahjtgzmgmyfu` (Postgres **17.11**, H5), `trace-dev` ref `fjvaogxoxapenoqqykem`.
- Sentry (H6): org `tracehiring`, data region **EU (Germany)**; projects `trace-recruiter` (React) and `trace-workers` (Cloudflare (Node)); error monitoring only; org-level data scrubber, default scrubbers and "prevent storing IP addresses" on (founder-confirmed).
- `staging` secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CLOUDFLARE_API_TOKEN`, `SUPABASE_STAGING_DB_URL`. Variables: `CLOUDFLARE_ACCOUNT_ID`, `SENTRY_DSN_WORKERS`, `SUPABASE_STAGING_PROJECT_REF`, `SUPABASE_STAGING_PUBLISHABLE_KEY`, `SUPABASE_STAGING_URL`, `VITE_SENTRY_DSN`.
- Items 1, 2 and 4 of "Open steps" below are done. **H4 done 2026-10-14:** the account's `workers.dev` subdomain is `abhayraj` (already set; founder confirmed in chat, kept as is). Staging Worker URLs are `https://trace-<worker>-staging.abhayraj.workers.dev`. Production will use tracehiring.tech custom domains, never `workers.dev`.

## Open steps (founder)

Done by the founder on 2026-10-11: old project paused, `trace-staging` and `trace-dev` created, remote repointed and pushed, `staging` environment and `CLOUDFLARE_ACCOUNT_ID` created. Still open (exact commands in `docs/progress/FOUNDER-QUEUE.md`):

1. **Cloudflare token:** revoke the token whose value became a secret name, create a new one (H4 scopes) and set it as `CLOUDFLARE_API_TOKEN`; delete the misnamed secret.
2. **Supabase DB URL:** set `SUPABASE_STAGING_DB_URL` (the name CI reads) and delete `SUPABASE_DB_URL`.
3. **Deployment branches:** limit the `staging` environment to `main` (H3).
4. **Supabase connector:** attach it to the next autopilot session (or reply with the two project refs) so the autopilot can record refs, URLs and publishable keys and set the `SUPABASE_STAGING_*` variables. In `trace-staging`'s API settings, keep exposed schemas = `public` only (H5).
5. ~~**`*.workers.dev` subdomain (H4)**~~ done 2026-10-14: `abhayraj.workers.dev`.
