# Environments

Every Trace dev and staging resource: its name, region, plan, environment, and the GitHub variable or secret that holds its config. **Names, refs and public values only. Never put a secret value here.**

- Written in the infra-setup session of 2026-10-11 (spec `specs/m0-foundations.md` revision 10).
- **Production does not exist yet.** It arrives at M8, in a **separate Supabase org and a separate Cloudflare account** (build-notes Q55, spec D5). Nothing below may ever be reused for prod.
- **No DNS changes on `tracehiring.tech`.** Staging uses `*.pages.dev` and `*.workers.dev` only.
- Free plans only. If anything would cost money, the autopilot stops and asks the founder.

Status key: **live**: exists and verified · **pending**: approved, not created yet · **CI**: CI creates it on the first staging deploy · **later**: belongs to a later milestone.

## Accounts

| Provider | Account | Plan | Notes |
| --- | --- | --- | --- |
| GitHub | repo **`TraceHiring/TraceHiring`** (private), `gh` logged in as `TraceHiring` | Personal account | Moved from `AbhayRajGit/Tracehiring` (founder, 2026-10-11). The local `trace` remote still points at the old URL until the founder repoints it (see "Open steps"). |
| Supabase | org **"rajabhay.work@gmail.com's Org"** (slug `vfrqfcytlcbylylqqtdl`) | Free | Free plan allows **2 active projects** across every org you own or administer; paused projects don't count. |
| Cloudflare | **"Rajabhay.work@gmail.com's Account"**, account ID `94fef930c2ecd2e37fbd5dc3151d99ba` | Workers Free | Account ID is not a secret (it appears in every `workers.dev`/API URL). R2 is **not enabled** on this account. The registered `*.workers.dev` subdomain is not yet confirmed (H4). |

## Resources

| Resource | Provider | Environment | Region | Plan / cost | Status | Created by |
| --- | --- | --- | --- | --- | --- | --- |
| `trace-dev` | Supabase project | dev | `ap-south-1` (Mumbai) | Free, $0 | pending | Founder, in the dashboard (the Supabase connector can't create projects; see below) |
| `trace-staging` | Supabase project | staging | `ap-south-1` (Mumbai) | Free, $0 | pending | Founder, in the dashboard |
| "rajabhay.work@gmail.com's Project" (ref `giuisatnjoagzlbcbktu`) | Supabase project | none | `ap-south-1` | Free | **to delete** (founder, 2026-10-11) | Supabase default project; empty `public` schema; uses one of the 2 free slots |
| `trace-candidate-staging` | Cloudflare Pages | staging | global | Free, $0 | CI | `wrangler pages deploy` in `deploy-staging` (spec §7.2 step 7). URL `https://trace-candidate-staging.pages.dev` |
| `trace-recruiter-staging` | Cloudflare Pages | staging | global | Free, $0 | CI | Same. URL `https://trace-recruiter-staging.pages.dev` |
| `trace-edge-staging` | Cloudflare Worker | staging | global | Workers Free, $0 | CI | `wrangler deploy --env staging` (spec §7.2 step 5). URL `https://trace-edge-staging.<workers.dev subdomain>.workers.dev` |
| `trace-jobs-staging` | Cloudflare Worker | staging | global | Workers Free, $0 | CI | Same |
| `trace-api-staging` | Cloudflare Worker | staging | global | Workers Free, $0 | CI | Same |
| Workers `dev` env, local Supabase | local machine | dev | — | — | local only | `wrangler dev` and `supabase start`; no Cloudflare dev resources exist |
| R2 buckets, Queues, Durable Object namespaces | Cloudflare | staging | — | — | later | Each arrives with the milestone that first needs it, after the free-plan check (spec §1 "Out of scope", build-notes risk 19). Names will use the `-staging` / `-dev` suffix. |

Why nothing was created in Cloudflare now: the M0a spec needs only Pages ×2 and Workers ×3 on staging, and CI creates both on the first deploy. The Cloudflare connector has no tool to create Pages projects, Queues or Durable Objects.

## GitHub environment `staging` (on `TraceHiring/TraceHiring`)

Deployment branches limited to `main` (H3). Each secret is scoped to the step that uses it (spec §7.2).

| Name | Kind | Holds | Used by | Status | Set by |
| --- | --- | --- | --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | variable | Cloudflare account ID (above) | `wrangler` steps 5–7 | pending | Founder or autopilot, with `gh variable set` |
| `SUPABASE_STAGING_PROJECT_REF` | variable | `trace-staging` project ref | M0b on | pending (needs the project) | Autopilot, after the project exists |
| `SUPABASE_STAGING_URL` | variable | `https://<ref>.supabase.co` | M0b on (recruiter app, CSP) | pending | Autopilot |
| `SUPABASE_STAGING_PUBLISHABLE_KEY` | variable | `trace-staging` publishable key (`sb_publishable_…`), a public client key | M0b on | pending | Autopilot |
| `CLOUDFLARE_API_TOKEN` | **secret** | API token limited to this account: Workers Scripts: Edit, Cloudflare Pages: Edit, Account Settings: Read (H4) | steps 5–7 only | pending | **Founder only** |
| `SUPABASE_STAGING_DB_URL` | **secret** | `trace-staging` session-pooler connection string, with password (H5) | steps 3–4 only | pending | **Founder only** |
| `SENTRY_DSN_RECRUITER`, `SENTRY_DSN_WORKERS` | variable | Sentry DSNs | Sentry adapter | **deferred until before D1** (H6, spec revision 10) | Founder |

The autopilot never sets or reads a secret value. `trace-dev` gets no GitHub variables: dev runs locally.

## Open steps (founder)

1. **Supabase:** delete "rajabhay.work@gmail.com's Project", then create `trace-dev` and `trace-staging` (Free plan, region **South Asia (Mumbai)**, org above). Save each database password in your password manager, not in the repo. In `trace-staging`'s API settings, keep exposed schemas = `public` only (H5).
2. **GitHub:** create the `staging` environment and set `CLOUDFLARE_ACCOUNT_ID` (commands in `docs/progress/FOUNDER-QUEUE.md`), or allow the autopilot to run them.
3. **Git remote:** `git remote set-url trace https://github.com/TraceHiring/TraceHiring.git`, or allow the autopilot to run it. The session-end push needs it.
4. **Cloudflare:** confirm the registered `*.workers.dev` subdomain, and create the API token (H4) as the `CLOUDFLARE_API_TOKEN` secret.
