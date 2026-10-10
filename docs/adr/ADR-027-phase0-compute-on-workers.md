# ADR-027: Phase 0 compute on Cloudflare Workers

- **Status:** Accepted (2026-10-10)
- **Source:** founder decision 2026-10-10 (`docs/build-notes.md` §0 and Q1); `docs/plan-conflicts.md` #15
- **Supersedes, for Phase 0:**
  - the "API and workers" row of `docs/plan.md` §8.1 (Node.js modular monolith on AWS ECS Fargate, Mumbai);
  - the §8 intro's "queued workers in Mumbai" and "Queued jobs carry the submitted session to Mumbai";
  - §8.2 rule 6's "compute [is] in Mumbai";
  - the matching phrase in the CLAUDE.md Stack line.

## Context
Plan §8.1 runs the API, scoring, grading orchestration, notifications and billing as a Node.js monolith on ECS Fargate in Mumbai. For a solo founder, that means operating three clouds (Cloudflare, Supabase, AWS) from day one: container images, a VPC, IAM, deploy pipelines and on-call for the cluster.

plan-conflicts #15 proposed running Phase 0 on Workers instead. The edge tier is already Cloudflare in plan §8.1: Pages, Workers ingest, R2 and Queues, plus the per-session Durable Object chosen in ADR-016. The Queues that feed post-submit jobs also start at the session objects.

## Decision
In Phase 0, the API (`services/api`) and background jobs (`workers/jobs`) run as TypeScript on **Cloudflare Workers**, with **Cloudflare Queues** consumers for asynchronous work.

AWS is used only for:
- **Bedrock** (Claude, India inference)
- **SES** (email)
- **KMS / Secrets Manager** (envelope encryption of sensitive fields)

Workers call these over HTTPS with SigV4-signed requests. There is one AWS account, without Organizations, on the Free plan until usage requires otherwise.

A job moves to ECS Fargate only when it hits a Workers limit, such as CPU time, memory, duration or subrequests. That move needs a new ADR naming the job and the limit it hit.

Cloudflare stays on the **Workers free plan** until a free-plan limit blocks the build. The plan limits are checked at the start of M2 and M3a.

## Rejected alternatives, and why
- **ECS Fargate from day one (plan §8.1):** three clouds to operate before there is a single customer. Container, VPC and IAM work does not move any exit gate.
- **Supabase Edge Functions for the API:** a second serverless runtime next to Workers, with its own limits, and it would put server code next to the database role boundary that CLAUDE.md keeps separate.

## Consequences for the code
- `services/api` is a modular monolith (`src/modules/<module>/`) written as **runtime-agnostic TypeScript**: no Node-only APIs in module code. The Workers entrypoint is a thin adapter. A Node entrypoint for ECS later is a new file, not a rewrite.
- **Service-role boundary (CLAUDE.md Tenancy):**
  - The Supabase service-role key is bound only to the `services/api` and `workers/jobs` Worker scripts. The same goes for any other database credential: the JWT secret, secret keys and connection strings.
  - `workers/edge` serves candidates and hosts the session Durable Objects. It is a separate script and never receives any of them.
  - Two checks enforce this:
    - a CI check fails if those credential names appear in candidate-facing code or config;
    - a deploy-time check fails unless `workers/edge` has no Worker secrets bound at all.
- **Exactly-once:** queue consumers are idempotent, keyed by session + job + ruleset (plan §8.1 Queues, CLAUDE.md).
- **The residency statement (plan §8.2 rule 6) must be restated.**
  - **Stays in India:** the system of record (Supabase Mumbai) and AI inference (Bedrock India).
  - **Not pinned to Mumbai:** the Cloudflare tier — Workers compute, Durable Object storage, Queue messages and R2. That covers in-test answers held in session objects and post-submit job payloads.
  - **Enterprise strict-residency SKU:** plan §8.2 puts its storage on S3 Mumbai. That **no longer gives full India residency**, because Durable Object and Queue data stay on Cloudflare. A customer who needs it is a reason to reopen this ADR.
- **Processors outside India, recorded here and in the sub-processor list:**
  - Cloudflare (Workers, Durable Objects, Queues, R2, Workers Logs)
  - Sentry: recruiter app and server Workers only, scrubbed; the region is chosen by the founder and recorded here when the project is created
  - Neither Sentry nor any other error tool runs on the candidate app or `workers/edge` until counsel approves (build-notes Q17).
- **Deploys:** every deploy runs from GitHub Actions to staging with `wrangler`, and only on a push to `main` (`specs/m0-foundations.md` §7). There are no container images in Phase 0.
- **Prod isolation (proposed, build-notes Q55):** at M8, prod gets a separate Supabase organisation and a separate Cloudflare account. A staging credential then cannot reach prod.

## Reopen only if
- A job breaks a Workers limit that can't reasonably be designed around (write a new ADR for that job only).
- A customer contract needs compute pinned to India.
- Workers pricing for drive-scale load (M8 load test) is worse than the ECS alternative by more than 30%.
