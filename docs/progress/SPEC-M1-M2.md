# SPEC chat for M1 and M2 — status and questions for the founder

Parallel docs-only chat, 2026-10-19, branch `spec/m1-m2` (cut from `trace/d1/integration` @ `06a24c9`). It writes only `specs/m1-test-authoring.md`, `specs/m2-scheduling-invites.md` and this file. It ran no `pnpm verify`, `supabase`, `psql` or `docker`, and touched no code, migration, test or handoff file.

## 1. Status
| Item | State |
| --- | --- |
| `specs/m1-test-authoring.md` | revision 1 drafted; review in progress (§3) |
| `specs/m2-scheduling-invites.md` | revision 1 drafted; review in progress (§3) |
| Reviewers | spec-reviewer (Opus) and database-reviewer (Opus), read-only, on both specs |

## 2. Questions for the founder (rules 1–9 or a founder answer). Each has the safe default the specs build until you answer.
| # | Question | Why it is yours | Default built until you answer |
| --- | --- | --- | --- |
| Q-M1-1 | **Paste "allowed, logged" (Standard and Open-book presets): may a logged paste ever raise the Integrity band?** Screen 04 says Standard is "Paste allowed and logged, warning before any flag". | Rule 3 (what raises the band); it also overlaps FOUNDER-QUEUE "Review rec. 5" (validated signals beyond D1). | When paste is **allowed**, paste and drop are recorded as timeline context only and **never raise the band**. When paste is **blocked** (Strict), D1's behaviour stays: a paste attempt is a T3 signal capped at Review. A "warn first, then flag" rule waits for M4 (nudges) and your answer. |
| Q-M1-2 | **Consent notice between M1 and M3b.** Presets can switch signals off (Open-book has no focus signals). Until M3b renders the notice from each test's settings, candidates see D1's fixed notice, which lists everything D1 can record. | Notice content (DPDP itemised notice; rule 8 adjacent). | Keep the D1 notice until M3b. M1 can only switch signals **off** compared with D1 and the client captures only enabled signals, so the notice may over-state, never under-state. No real candidates before M8. |
| Q-M1-3 | **build-notes Q58 (still open): may the ABH-7 empirical difficulty check (needs response data) be owned by M10 instead of M8?** | Your Q21 answer says every deferred gate passes by M8. | M1 closes on the expert-tagged ±0.1 constraint (DB + generator test) and lists the empirical check with owner **M10 if you confirm Q58, else M8**. |
| Q-M2-1 | **Date of birth in the bulk-invite file.** Plan §3.2 step 4 says the age can come from "the invite file"; your Q37 answer says store only an 18+ flag and its source, never a date of birth. | Rule 9 and Q37. | The template has an **"18 or older" yes/no column**; `no` rejects the row (`minor`) and stores nothing about the person. **A file with a date-of-birth column is refused** with "use the 18-or-older column". Alternative if you prefer: accept a DOB column, compute 18+ on the drive date in memory and discard the date (never stored or logged). |
| Q-CUT | **Where the Answer Quality cutoff lives** (already in FOUNDER-QUEUE "Review rec. 2", rule 6). | Rule 6. | M1 and M2 do not change it: D1's mandatory cutoff pinned at publish stays. |

## 3. Founder gates the specs depend on (AUTOPILOT §3.1/§3.2; BUILD proceeds on mocks until they are done)
| # | Gate | Needed for | Exact steps (no values in chat; put them in GitHub `staging` secrets / Worker secrets) |
| --- | --- | --- | --- |
| F-1 | **Supabase secret key for `workers/jobs`** (member invitations, M1-20) | M1 AT-M1-26 on staging (local uses the local stack key) | In `trace-staging` → Project settings → API keys, create a **secret** key named `trace-jobs-member-provisioning`; add it as GitHub `staging` secret `SUPABASE_STAGING_SECRET_KEY_JOBS`. Never put it in the api or edge Workers. |
| F-2 | **AWS credentials for the Workers** (SES send, KMS data keys) | M2 real SES smoke (AT-M2-12), real KMS | Reuse IAM user `trace-staging-app` or create `trace-staging-workers`; store its keys as GitHub `staging` secrets `AWS_WORKERS_ACCESS_KEY_ID` / `AWS_WORKERS_SECRET_ACCESS_KEY` (the CI deploy passes them as Worker secrets to `services/api` and `workers/jobs` only). |
| F-3 | **IAM policy scope** for F-2 | same | The policy allows only `ses:SendEmail` on identity `tracehiring.tech` and `kms:GenerateDataKey`, `kms:Decrypt` on key `931c62c9-…` (ap-south-1). |
| F-4 | **SNS topic for SES events** | per-candidate delivery status from real SES | In SES (ap-south-1) → Configuration sets → create `trace-staging-events` with an SNS destination (topic `trace-staging-ses-events`, events: send, delivery, bounce, complaint, reject, delivery delay); the autopilot adds the HTTPS subscription to the staging api URL and confirms it in code. |
| F-5 | **SES production access** (build-order M2 H) | real recipients (M8) — **not** needed to close M2 | SES console → Account dashboard → Request production access (transactional, `tracehiring.tech`). |
| F-6 | **FYI, no action:** M1 and M2 build on one integration branch `m12/integration` (their migrations interleave); each still has its own review, summary and tag. The lead logs it under build-notes "Autopilot changes" at BUILD start. | — | — |
| F-7 | **Workers CPU on the Free plan** (D1 OPEN-8a) may also limit import and invite batches | M1 DC-M1-4, M2 DC-M2-3/5 | Only if the day-one checks fail: Workers Paid (USD 5/month). |
| F-8 | **Worker secrets the lead generates** (no account needed, but they must be set on staging): `LINK_TOKEN_KEY` (M2-12) | M2 staging | The operator runbook script prints the command; you run it (as for `CANDIDATE_TOKEN_PRIVATE_JWK`). |

## 4. Log
- 2026-10-19: branch cut; sources read (CLAUDE.md, AUTOPILOT §2, SESSION-PLAN, build-order M1/M2, plan §1–§5, §8–§10, §12, plan-conflicts, build-notes §0/§2 M1–M2/§4, ADR-017/029/030, D1 spec §1/§3/§6/§9/§11, D1 migrations via a read-only summary); both specs drafted (revision 1).
