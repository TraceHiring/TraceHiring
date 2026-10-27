# ADR-034: `aws4fetch` for SigV4 requests to SES and KMS from Workers

- **Status:** Accepted (autopilot, 2026-10-27). Spec rows `specs/m2-scheduling-invites.md` M2-16, R5-2 (ADR-033 is `fflate`, M1 R5-2). A new runtime library needs an ADR (CLAUDE.md stack rule; AUTOPILOT §4).
- **Source:** M2 BUILD Wave 0 (spec §11.2). The dependency itself is added by stream B1 (`packages/vendors`), through the lead (root lockfile), not by this ADR.

## Context
M2 sends invite, reminder and OTP email through Amazon SES v2 (`SendEmail`) and wraps per-org data keys with AWS KMS (`GenerateDataKey`, `Decrypt`) for contact encryption (M2-3). ADR-027 keeps the api and jobs on Cloudflare Workers and allows AWS only for Bedrock, SES and KMS/Secrets Manager, called over HTTPS. Every such call needs AWS Signature Version 4. The AWS SDK for JavaScript v3 is large, pulls Node-oriented dependencies and is a poor fit for the Workers bundle and CPU budget; hand-writing SigV4 is possible with Web Crypto but is security-sensitive code with many edge cases (canonical query strings, header normalisation, session tokens).

## Decision
1. **`aws4fetch`** (MIT, no runtime dependencies, Web Crypto only) signs the SES v2 and KMS requests from `packages/vendors` (`SesEmailMessaging`, `AwsKmsKeyManager`). Latest published version on 2026-10-27: **1.0.20** (npm registry, published 2024-08-28). Stream B1 pins the exact version in the pnpm catalog; `pnpm audit` and osv-scanner cover it.
2. **Region pinned to `ap-south-1`** for both services; endpoints are fixed strings in code, never built from input (no SSRF surface).
3. **Credentials** come from Worker secrets set with `wrangler secret put` on the staging Workers (FOUNDER-QUEUE F-2, R5-27); GitHub and CI hold no AWS keys and CI never calls AWS (build-notes item 9). Production stays blocked until M8.
4. **Only these calls** go through it: SES v2 `SendEmail`, KMS `GenerateDataKey` and `Decrypt`. Any other AWS call needs its own review.
5. **Nothing secret or personal is logged:** request bodies (recipients, rendered messages, plaintext keys) are never logged or put in errors; failures carry codes only (AT-M2-19).

## Rejected alternatives, and why
- **AWS SDK v3 (`@aws-sdk/client-sesv2`, `client-kms`):** heavy bundle and dependency tree in a Worker, more CPU per call, more audit surface.
- **Hand-written SigV4 on Web Crypto:** no dependency, but more code to get exactly right and to keep right; `aws4fetch` is small enough to review.
- **SES SMTP interface:** Workers have no general SMTP client; still needs credentials; no KMS answer.

## Consequences
- One small dependency in `packages/vendors`; the boundaries rule keeps it there (apps never import it).
- Tests sign against fixtures with no network (AT-M2-11); the staging round trip is DC-M2-1 (STAGING, founder-gated).
