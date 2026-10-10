# Build notes — lead-engineer orientation (M0–M3)

Written 2026-10-10 against commit `3e344bf`, after reading CLAUDE.md, `docs/build-order.md`, `docs/plan.md` (rev 39, all), `docs/plan-conflicts.md`, `docs/adr/` (README + ADR-001…026), `docs/design/README.md`, `docs/design/tokens.json` and all 7 PNGs in `docs/design/screens/`. Supporting reads: `docs/founder-steps.md`, `docs/setup-checklist.md`, `docs/kickoff-prompt.md`, `.claude/settings.json`, `.claude/agents/*`, `.claude/skills/*`, `scripts/*`.

Precedence I apply: **CLAUDE.md rules 1–9 > plan-conflicts.md resolutions (its header: "Build the Resolution column") > plan.md > ADRs > design PNGs** (design README: "Behaviour always comes from `docs/plan.md`, not from the pictures"). Where this file proposes a default, it is a proposal until you confirm it; answers will be logged in §2 against each question number.

---

## 1. Product understanding (10 bullets)

1. **What Trace is.** An India-first online assessment platform for high-volume hiring (wedge: mid-size staffing firms hiring for BPO / customer support / freshers — ADR-003). Recruiters build tests (written, MCQ/aptitude, typing, voice now; code in Phase 1; video Phase 2), schedule drives of up to 20k concurrent candidates, and get two separate results per candidate, each backed by timestamped evidence. Lead formats are written + voice (ADR-002). One line: *hire the person who did the work*.
2. **Rule 1 — Two results, never blended.** Answer Quality is a 0–100 number; Integrity Signals is a band (Clear / Review / Strong concern / Insufficient evidence) plus evidence strength. They live in separate tables (I'll use separate Postgres schemas), are computed by separate code that cannot import or write the other, and are shown as two equal cards. A confirmed integrity outcome is a separate decision record; it never edits a score.
3. **Rule 2 — No automatic rejection, anywhere.** No API, job, webhook or bulk action can reject on integrity. Bulk reject takes a quality cutoff and nothing else. Machine-raised flags stay "pending review"; only human-confirmed flags appear on a decision screen.
4. **Rule 3 — Deterministic, versioned band engine.** Same inputs → same band, always. The ruleset freezes when the first real candidate starts; retuning ships as a new version. Client-reported (T3) signals can push a candidate to Review but no further — except untrusted-input events and raw media a reviewer can actually view. Detectors that haven't passed the accuracy study (precision ≥90%, honest-session FPR <5%) are context only and can never raise the band.
5. **Rule 4 — Notice, 72 hours, different reviewer.** Before any integrity-based rejection the candidate gets a notice with the confirmed flag and 72 h to respond; the final call is made by a reviewer other than the one who confirmed. This is enforced by database constraints, not just UI.
6. **Rule 5 — Same report on both sides.** The candidate reads the same report through a separate projection (`report_candidate_view`) that strips everyone else's data. A candidate never sees another candidate's answer, identity, device or IP — similarity flags say only "matched another submission in this drive".
7. **Rule 6 — Score-first triage.** Integrity is reviewed only for candidates shortlisted on quality. Flags on everyone below the cutoff are `not_used`, need no review and are not appealable. This is what makes a 2,000-candidate drive reviewable by one person.
8. **Rule 7 — Things we never build.** No emotion/stress/personality inference; no AI-likeness score shown to anyone; gaze is never a flag; no biometric templates or voiceprints (except inside the opt-in identity add-on, Phase 2); IP/ASN is never a flag in India.
9. **Rule 8 — Media leaves the device only on an allow-list.** Start photo, snapshot-grid stills, server-requested random stills, voice/video *answer* recordings, and stills/clips around a flag event. Camera frames and ambient audio never leave the device. Background is blurred on the device; viewers get 5-minute signed, watermarked links; every view is audited.
10. **Rule 9 — Under-18s are blocked at launch** (DPDP s.9; parental consent is Phase 2). Underneath all nine rules is the architecture: the server holds the truth (timer, served items, final answer rebuilt from edit events), a Cloudflare Durable Object per session keeps Postgres off the in-test hot path, results are exactly-once from at-least-once delivery, every table is tenant-scoped with RLS and evidence access is limited to assigned candidates, and everything (rulesets, rubrics, notices, items, models) is versioned and recorded on the report.

---

## 2. Questions for you (M0–M3)

**Blocking** = I will not start the affected milestone (or the affected part) without your answer, usually because it touches rules 1–9, tenancy, consent or an exit gate. **Can-default** = I will build the stated default and log it here; override any time before that milestone's spec is approved.

### Answer these first (all Blocking)
Q1 (compute), Q2 (roles/assignment), Q2b (Owner+Reviewer evidence), Q4 (accounts), Q5 (dev machine) block **M0**. Q20 (freeze scope) and Q21 (human-measured gates) block **M1**. Q36 (consent ordering), Q37 (age gate), Q38 (disconnect rules), Q39 (consent withdrawal) block **M3**.

### M0 · Foundations

**Q1. Where do API and workers run — ECS Fargate or Cloudflare Workers? — Blocking (M0)**
CLAUDE.md (Stack) and plan §8.1 say "Node TS modular monolith on ECS Fargate (Mumbai)". `plan-conflicts.md` #15 says Phase 0 runs API + workers on Workers + Queue consumers, AWS only for Bedrock/SES/KMS/Secrets Manager, "record that as a new ADR". `setup-checklist.md` says ECS "later in M5". M0 must deploy `services/api` to staging from CI, so the runtime, IaC and secret boundaries depend on this.
*Recommendation:* accept #15. I draft ADR-027 ("Phase 0 compute on Workers; move a job to ECS only when it breaks a Workers limit") and a one-line CLAUDE.md Stack edit for your approval. `services/api` stays runtime-agnostic TypeScript (no Node-only APIs) so moving to ECS later is a new entrypoint, not a rewrite. The service-role key lives only in a separate `workers/jobs` script, never in `workers/edge` (candidate-facing DOs). Caveat to accept: Workers compute is not Mumbai-pinned, so plan §8.2 rule 6 ("compute in Mumbai") must be restated honestly.

**Q2. Role model, "assigned", and the odd roles — Blocking (M0: the ≥50 RLS tests need a fixed matrix)**
Plan §2 defines 8 roles and says evidence is scoped to candidates a person is "assigned" to, but never defines assignment. Also open: can one person hold several roles (§2 implies yes: "can be the same person as Recruiter", "unless they also hold Reviewer")? Does Owner include Admin powers? Is Client Viewer a login or a link? Does Trace Trust & Safety access exist before Phase 2 (the T&S appeals desk is Phase 2; break-glass support is not phased)? Does a team grant access?
*Recommendation:*
- `memberships.roles` is an array from {org_owner, admin, recruiter, reviewer, hiring_manager}; optional `workspace_id` restriction.
- `assignments` at workspace / job / drive / candidate scope; a drive's creator is auto-assigned; every assignment change is audited.
- Owner and Admin are separate: the org creator gets both explicitly; Owner alone sees no evidence (matches §2).
- Admin sees evidence only through assignments like everyone else, but can create assignments.
- Client Viewer = expiring signed link (M7), not a membership.
- Trust & Safety: schema + break-glass grant table in M0 (ticket required, ≤4 h, visible to tenant); no staff UI until needed.
- Teams are organisational only (no access grant) in Phase 0.

**Q2b. Does Owner + Reviewer see unassigned evidence? — Blocking (M0 RLS matrix)**
Plan §2 (plan.md:65): Owner cannot read evidence for unassigned candidates "(unless they also hold Reviewer)" — which reads as Owner+Reviewer seeing *all* evidence. CLAUDE.md Tenancy: "Evidence access is scoped to assigned candidates", with no exception.
*Recommendation:* CLAUDE.md wins — holding Reviewer gives an Owner the same access as any Reviewer, i.e. **assigned candidates only**; an Owner who needs more assigns themselves (audited). If you agree, I'll add it to `docs/plan-conflicts.md` as #16 when you approve the M0 spec.

**Q3. Authorise org users from the `memberships` table, not JWT role claims — Can-default**
Plan §10.1 says "claims carry org, role and team". Trusting role claims means a removed recruiter keeps evidence access until the JWT expires (up to 1 h), and per-candidate assignments don't fit in a token.
*Default:* RLS resolves roles through `STABLE SECURITY DEFINER` helpers that read `memberships`/`assignments` (wrapped in `(select …)` so they evaluate once per statement). Claims carry only an `active_org_id` hint. Recorded as an ADR because it deviates from §10.1's wording.

**Q4. Accounts you need to create before M0, and three conflicting setup docs — Blocking (founder action)**
M0's exit gate needs "staging deploys from CI". Needed: GitHub repo with branch protection + `staging` environment secrets; Cloudflare account (Pages, Workers, Durable Objects, R2); Supabase `trace-dev` + `trace-staging` in Mumbai; a Sentry project (choose its data region at creation). Build-order M0 also lists "AWS dev account … domain" as prerequisites; if Q1 = Workers, nothing in M0 uses them, so I propose deferring both to M2 (SES) — deviation 6 in §3.
Conflicts to resolve: `setup-checklist.md` says **three** Supabase projects, `founder-steps.md` says the free plan allows **two** and prod comes at M8; checklist says **Workers Paid**, founder-steps says **start free**; checklist says a **separate AWS dev account (Organizations)**, founder-steps says **don't join Organizations**.
*Recommendation:* two Supabase projects now, prod at M8; Cloudflare free for M0, Workers Paid before M2 (Queues for invite fan-out; Durable Objects at scale); no AWS Organizations; staging on `*.pages.dev` / `*.workers.dev` until the domain exists. Free Supabase projects pause when idle — CI deploys keep staging awake.

**Q5. This dev machine can't run the M0 exit gate yet — Blocking (founder action, ~30 min)**
Checked in this session: Node **v20.20.0** (end of life since April 2026; docs ask for 22); `pnpm -v` **fails** (Corepack can't find its pnpm binary); Docker 29.5.2 is installed but was reported stopped; Supabase CLI 2.109.1 and gh 2.101.0 present; gitleaks not installed. `founder-steps.md` says to work in WSL2 Ubuntu, but the repo is on NTFS under a path with spaces. As soon as M0 adds `verify:fast`, the Stop hook will fail every turn until pnpm works.
*Recommendation:* install Node 24 LTS (22 enters end of life in April 2027, mid-build) and repair pnpm (`corepack enable` + `corepack install`, or a standalone install of the version we pin); start Docker Desktop; install gitleaks. Optional but better: clone into WSL2 ext4 at a path without spaces (faster pnpm/Docker, matches Linux CI). I'll make the repo work on native Windows either way (see §3).

**Q6. Candidate token: who signs it and how RLS "understands" it — Can-default (spec in M0, built in M3)**
Plan §8.1 / ADR-017: invite + OTP → Trace-issued token that RLS understands. If it's signed with the Supabase project JWT secret, that secret can also mint `service_role` tokens, so it can't sit in candidate-facing Workers (CLAUDE.md Tenancy).
*Default:* an asymmetric (ES256) token signed by a Trace key held only by a server worker; the edge verifies with the public key. Candidates never call PostgREST. Candidate reads/writes go through a dedicated server worker that connects as a **dedicated login role `trace_candidate_gateway`** (NOINHERIT, no BYPASSRLS, whose only membership is `trace_candidate`) — never the `postgres`/`service_role` connection — and runs each request in a transaction with `SET LOCAL ROLE trace_candidate` + `request.jwt.claims`, so candidate RLS policies are real and pgTAP-testable. That worker holds no other credentials. Before the M3 spec I verify against current Supabase docs whether asymmetric/third-party JWTs make direct RLS evaluation possible instead.

**Q7. Candidate token lifetime vs extra time, lobby and the after-test pages — Can-default**
§12: "candidate token = test duration + 1 h". A 60-min test with +25% extra time, a 30-min lobby and 30 credited outage minutes overruns that. The status page, report and 72-h response flow happen days later and have no token type.
*Default:* three tokens. **Lobby token** (OTP → lobby). **Session token**: expires at the current server deadline + 1 h and is re-issued by the DO whenever the deadline moves. **Portal token**: invite link + OTP, 30 min, read-own + respond only.

**Q8. 2FA for org users — Can-default**
"Email OTP or password + 2FA" (§2) leaves open whether evidence access needs a second factor.
*Default:* email-OTP sign-in counts as one factor; password sign-in requires TOTP. Admin/Owner/Reviewer must enrol TOTP. RLS requires `aal2` for any membership with admin, owner or reviewer roles. Stricter than the plan, easy to relax.

**Q9. How orgs are created — Can-default**
No signup flow is specified; Free plan needs "business email or GSTIN" (§13).
*Default:* invite-only in Phase 0. A server-side `create_org()` path (operator script, audited) creates the org, a default workspace, `org_policies` and the first Owner+Admin membership. Self-serve signup arrives with billing in M7.

**Q10. Workspaces before client workspaces exist (M12) — Can-default**
*Default:* every org gets one `default` workspace; all workspace-owned tables carry `org_id` + `workspace_id` from M1, so M12 needs no backfill.

**Q11. "Append-only" audit log vs 12-month retention; what gets logged — Can-default**
Build-order: no UPDATE/DELETE grant for any app role. Plan §10.2: audit kept 12 months.
*Default:* monthly partitions; retention drops whole partitions via a migration-owner role (built in M7) that no app role can call. Rows hold IDs and roles, never PII, so deletion requests don't touch them. Each row stores `actor_roles` and `org` at event time (the candidate sees viewers "by role and organisation"). Raising triggers back up the revoked grants on every partition. M0 events: sign-in, membership/role/assignment changes, settings changes, exports, break-glass grants. Hash-chaining audit rows: deferred unless you want it.

**Q12. Enforce rule 1 in the schema from day one — Can-default**
*Default:* M0 creates empty `quality` and `integrity` schemas, separate worker roles with non-overlapping grants, an ESLint boundary rule (`integrity/*` cannot import `quality/*` and vice versa), and a catalog test that fails if any view reads from both schemas. Retrofitting this in M5 would be much harder.

**Q13. Which libraries need an ADR ("no new framework without an ADR") — Can-default**
*Default:* dev/test tooling needs no ADR (Vitest, ESLint, Prettier, pgTAP, Playwright, axe-core, gitleaks, lefthook, commitlint). Runtime libraries get one combined ADR-028 for M0: zod (already implied by build-order), **Hono** (HTTP routing on Workers and Node), **React Router** (client routing). Later ADRs when each is needed: i18n library (M3), headless UI primitives such as React Aria (only if hand-rolled primitives fail accessibility), Excel/Word parsers (M1). No ORM: supabase-js + SQL.

**Q14. Where secrets live in dev and CI — Can-default**
`founder-steps.md` names Doppler; `setup-checklist.md` says GitHub environment secrets; CLAUDE.md says AWS Secrets Manager.
*Default:* GitHub Actions environment secrets for CI; git-ignored `.dev.vars` / `.env.local` locally (both added to `.gitignore` and the Claude deny list); Workers secrets for runtime; AWS Secrets Manager + KMS for envelope encryption once AWS is in use. Doppler stays optional and never becomes a code dependency.

**Q15. Secrets are pushed before CI can catch them — Can-default**
The `post-commit` hook pushes every commit to GitHub immediately, and pushed history may not be rewritten (CLAUDE.md). A CI-only gitleaks scan is too late.
*Default:* lefthook runs `gitleaks` on staged files at **pre-commit**; CI runs the full-history scan required by the exit gate. The auto-push moves from the untracked `.git/hooks/post-commit` into versioned `scripts/git-autopush.sh`, called from lefthook's `post-commit` (husky would set `core.hooksPath` and silently disable it). Note: hooks are shared by worktrees, so every agent branch is also pushed.

**Q16. Issue "Done when" lines live in Linear, which isn't connected — Can-default**
Build-order makes each ABH issue's "Done when" part of the definition of done, but ABH-73 / ABH-80 etc. have no text in the repo.
*Default:* plan §5 "Done when" + build-order exit gates are authoritative. Please either connect the Linear MCP or export ABH-5…30, 73, 80 into `docs/issues/`.

**Q17. Observability before Better Stack (M7) — Can-default**
*Default:* structured JSON logs (PII-redacting logger in `packages/shared`, with redaction tests) to Workers Logs/stdout; Sentry with `beforeSend` scrubbing, no session replay, no candidate identifiers, and no Sentry SDK on the candidate app until counsel is fine with error data leaving India (or use an India-free payload contract). PostHog only in the recruiter app, from M6.

### M1 · Test authoring

**Q18. Integrity presets are never fully specified — Can-default (confirm before M3, because the consent notice is generated from them)**
Plan §3.1 step 3 and screen 04 name Strict / Standard / Open-book, but per-signal values exist only for mic, second screen and minimum coverage.
*Default:* a versioned `integrity_presets` config. Strict = all §6 signals on at defaults, paste blocked on written answers, single screen, explain probe on Review. Standard = screen 04's values. Open-book = paste allowed with cite-source note, question copy off, focus signals off, typing provenance only (screen 04 text). Anything unspecified is off or context-only. Admin locks are per signal, at org level, enforced by trigger. Accommodations can never be switched off (screen 04 "On · locked").

**Q19. Wedge scope for beta (plan-conflicts #13) and design-partner gate (#14) — Can-default**
*Default:* as written there — BPO Voice and Customer Support templates first; written + MCQ + typing + voice; ~600 reviewed items for beta; M4 waits for one signed LOI while M1–M3 continue. Confirm or override.

**Q20. What exactly freezes at "first candidate start", and at what scope? — Blocking (rule 3)**
CLAUDE.md: "Rulesets freeze when the first candidate starts". Plan §5 D: "frozen per test". §9.1: "Settings lock when the first candidate starts". Screen 04: "later changes create a new version". Open: only the ruleset, or the whole test (items, pools, timers, notice, rubric)? Per test or per drive? Does a practice start count? Can an open-window drive switch versions mid-way (mixed cohort)? The Postgres mirror is asynchronous, so a recruiter edit can race the DO's first start.
*Recommendation:* freeze the **whole test version** (content, pool snapshot, timers, ruleset, notice template) at the first real (non-practice) start; any later edit clones a new test version; a drive pins one test version and never switches mid-drive; to avoid the race the drive's version pointer locks at the earliest of lobby open, `opens_at`, or first start; the DO records the freeze and the Postgres mirror applies it idempotently.

**Q21. "Done when" lines that only humans or real data can satisfy — Blocking (to close M1; affects M2/M3 gates)**
ABH-5: "5 recruiters each publish a test from a template in a median of ≤5 min". ABH-7: "difficulty within ±0.1 of the parent item" (no difficulty scale is defined, and empirical difficulty needs responses). M2 ABH-14: "20k candidates start within 60 s". M3 ABH-25: "External audit … (Phase 2)", TalkBack (phone mode is Phase 2).
*Recommendation:* ABH-5 — automated Playwright timed-publish proxy closes M1; you run the 5-recruiter measurement before M8 and it's recorded. ABH-7 — difficulty is an expert-tagged 0–1 value; M1 tests the generator constraint; empirical check after calibration (M10). ABH-14 — mechanism tested in M2/M3 at small scale; 20k measured in the M8 load test. ABH-25 — axe + keyboard-only automated in M3; NVDA as a recorded manual checklist; TalkBack and external audit deferred with phone mode.
M3 lines that depend on later milestones: ABH-24 "The candidate can see every stored image and clip" (images arrive in M4, the report view in M6); ABH-22 "Diary entries appear on the reviewer timeline" (console is M6); ABH-23 "A nudge the candidate corrects is never a flag" and ABH-20 "Signal suppression is instant" (signals/flags arrive in M4). For each: an M3 proxy test (the data is stored, scoped and exposed to the right API), and the final "Done when" test is owned by M4 or M6 and listed in that milestone's spec.
I need you to accept that M1 can close on the ABH-5 proxy and that M3 closes on these proxies.

**Q22. AI drafting needs Bedrock, which is a prerequisite only at M5 — Can-default**
Build-order routes ABH-8 "via `LlmGrader`/Bedrock interface", but drafting isn't grading, and Bedrock India access (ABH-87) is due at M5.
*Default:* a separate `LlmDrafter` interface (same Bedrock client underneath) with a mock in M1; real adapter once ABH-87 lands. M1 builds draft → duplicate/readability checks → human approval. The "second model solves it" step belongs with the AI-solvability meter (M10).

**Q23. Who may approve an AI-drafted item; edits after approval — Can-default**
*Default:* items are immutable `item_versions`; any content edit creates a new version with `approved_by = NULL`. Approver must be a human member with recruiter/admin/reviewer role. Self-approval of your own draft is allowed but logged (the Free plan has one seat). DB CHECK: an `ai_draft` version cannot be `approved`/`live` without `approved_by`; from M3 a trigger on served items also blocks serving one (the exit gate). Imported items are approved by the importer. Answer keys need a second person (`key_reviewed_by ≠ created_by`, §7.1) — **except** that also breaks one-seat orgs; default: required for Trace library items, optional (logged) for customer items.

**Q24. Pool rule and item-draw algorithm — Can-default**
§5 A: "Pool ≥10× the items each candidate draws for drives".
*Default:* hard block at drive scheduling, warning for open-window tests; computed per section; draws stratified by the blueprint's skill × difficulty, lowest-exposure first, with a PRNG seeded from `session_id + section` so a retried draw is identical; the draw is fixed at section start and held by the DO.

**Q25. Import format, item images, variant generator — Can-default**
*Default:* Trace-published `.xlsx` and `.docx` templates with fixed columns/styles; images embedded or in a zip; images stored in a private R2 prefix and delivered only when served. Parameterised variants use a small restricted expression language with a seeded RNG (no `eval`). Variants are pre-generated and stored so wrong-variant detection (M10) and voice retakes can reference a variant id.

**Q26. Section timers, overall timer, navigation — Can-default**
*Default:* overall deadline = sum of section limits (+ granted extra time); unused section time does not carry over; no return to a closed section; within a section MCQ allows back-navigation, written and voice are one-way. Section weights sum to 100.

**Q27. Library content and who can browse it — Can-default**
CLAUDE.md requires `org_id` on every table, but the library (~6,500 items, presets, notice templates, role templates) belongs to Trace; a Free-plan signup could harvest the bank if browsing is open (§11 #22).
*Default:* a reserved org with `kind = 'trace_library'`; customers see library items only as stems/metadata via an API with rate limits, never answer keys. Until you deliver the 50 sample items (`setup-checklist.md`), I write clearly labelled synthetic placeholders used only in tests and seeds.

### M2 · Scheduling & invites

**Q28. The "2,000 invites delivered (sandbox) <10 min" gate vs SES sandbox — Can-default + founder action**
SES sandbox accounts send only to verified recipients at a low rate (I'll confirm current limits at M2); no product domain is bought yet.
*Default:* "sandbox" = the `Messaging` mock adapter with realistic latency and failure injection for the 2,000 run, plus a real SES smoke test to the SES mailbox simulator. You buy the domain, verify it in SES (ap-south-1) and request production access during M1.

**Q29. Email is the only channel available for invites and OTP at first — Can-default**
DLT + WhatsApp registration (ABH-83) takes weeks; no WhatsApp provider is named (plan §8.1 "via a provider").
*Default:* email only for invites and OTP until ABH-83 completes; SMS/WhatsApp adapters exist as mocks behind flags. Choosing the WhatsApp provider gets its own ADR. Accept that early beta candidates without email access can't be invited.

**Q30. Duplicates, shared family phones, searching encrypted contacts — Can-default**
"Dedupe by phone/email" will reject the second sibling sharing a family phone — a fairness gap in exactly the India context §11 cares about. Contacts are encrypted (§9.1), so matching needs a blind index; KMS needs AWS.
*Default:* normalise phones to E.164 (+91 default) and lowercase emails; dedupe within one drive only; reject on email match or on phone+email match (unique index on email blind index); a phone-only match with a different email is held for recruiter confirmation with the reason (a trigger rejects it unless `phone_dup_confirmed_by` is set — no unique index on phone). Contacts use envelope encryption + an org-keyed HMAC blind index (per org, so no cross-tenant matching — ADR-025). Local KMS mock until the AWS dev account exists. Candidate names also encrypted.

**Q31. Drive / slot rules — Can-default**
*Default:* all times `timestamptz`, shown in IST; capacity counts booked invites; a late arrival (after the 15-min window) is blocked and offered the one self-reschedule; self-reschedule allowed up to 2 h before the slot to any future slot in the same drive with space; reminders that would fall in the past are skipped; open-window reminders anchor to the deadline.

**Q32. Invite link lifecycle — Can-default**
*Default:* random 256-bit token, only its hash stored; it never starts a session without an OTP; valid until drive end + 7 days (status page), then the portal token flow; rotated on reschedule; revocable by the recruiter.

### M3 · Candidate runtime

**Q33. Design vs plan conflicts on M3 screens (plan wins) — Can-default**
- **06b** offers "one re-record allowed" / "Re-record (1 left)" at the candidate's choice. Plan §7.1 and build-order M3: one retake **only on technical failure, with a new variant**. I build the plan; retake is offered only for server-detectable failures (missing/corrupt chunks, failed upload, mic failure at start), and the server picks the new variant.
- **03** copy: "how long you look away" reads as gaze tracking (rule 7, ADR-008) → "how long no face is visible". "Keep a face or voice template after the review window" implies templates are kept during it (rule 7) → "Create a face or voice template". "Clips are deleted after 90 days" → 30 days after the decision (plan-conflicts #7). Language chips for Tamil/Telugu/Kannada → hidden (Phase 2). Live preview should show the on-device blur, since that's what a reviewer would see.
- **03** bundles "18+ confirmed" into the consent checkbox; plan §3.2 step 4 makes the age check its own step. See Q37.
- **03** stepper order (Device check → What we record → …) puts camera/mic before consent. See Q36.
- Phone mode (06b) is Phase 2 (plan-conflicts #10); the laptop voice recorder borrows its layout.
- Screen 03 is the only designed M3 screen. The design README lists lobby/device check, warm-up, in-test laptop UI and receipt/status page as not designed; OTP entry, age gate and under-18 screen, timer warnings and offline/paused/suspended states are also undesigned and not listed there. I'll build them from the plan and existing components, mobile-first and responsive.

**Q34. M6 screens contradict rules 2, 4 and 5 — Can-default (recorded now so M6 specs don't inherit them)**
01b opens "Response window closes in 71 h 40 min" on a flag marked "Awaiting review" with "0 confirmed" (the window starts only after confirmation). 01 gives the recruiter "Confirm with rationale" (§2: recruiters can't confirm alone) and a "Record decision" button with 0 confirmed flags. 05 shows unconfirmed machine bands next to bulk actions, including faded bands on `not_used` rows. 02 shows "Confirmed by R. M. · you are the second reviewer" while signed in as RM. 01 shows "T2 content-bound · 1" with a Review band (§7.2: any T2 → Strong concern). 01b shows "Review suggested" where §7.2 says the candidate sees "A person will check this"; it names "Reviewer R. M." where §2 says role + organisation. 04's "Speech + delivery check" on a voice item may mean reading-pattern analysis, which ADR-011 cut. 04's lab-mode text implies IP can flag outside lab mode (rule 7).
*Default:* plan wins on all of these; actions come from server-computed capabilities; the decision screen lists confirmed flags only; triage hides bands below the cutoff and never shows a band next to a reject control; the voice-item control reads "prep timer, time to first speech, speaker count".

**Q35. Notice content, fiduciary details, and the hash — Can-default (counsel review before beta, ABH-89)**
Trace is the processor; the employer is the data fiduciary (§10.3). Screen 03 shows only a Trace grievance address.
*Default:* notice = immutable template version (EN/HI) + org fiduciary block (legal name, grievance contact — new org settings) + snapshot of the frozen test's integrity settings. The rendered canonical text is SHA-256-hashed and stored per session in `consents` (exit gate). Trace's processor contact appears as a secondary line.

**Q36. Device check runs before consent and before the age check — Blocking (DPDP, rule 9)**
Plan §3.2 order: lobby/OTP → **device check (camera, mic, CPU, input method)** → age check → transparency/consent. Screen 03's stepper agrees. That opens camera and mic and collects device data before consent, and before an under-18 is stopped.
*Recommendation:* reorder to OTP → age gate → transparency & consent → device check → rules & accommodations → test (start photo and warm-up slot in before the test in M4, where ABH-65/ABH-32 are built; M3 leaves placeholders). If you want the device check first (better UX, fewer drop-offs after consent), it must run purely on the device, send and store nothing, and its result is discarded unless consent follows. Your call (or counsel's).

**Q37. How the under-18 block works — Blocking (rule 9)**
§3.2 step 4: "Date of birth from the invite file or the candidate". Open: is self-declaration enough? What if the file and the candidate disagree? Age on which date, which time zone? What do we keep about a blocked person? Can they take the practice test? Also, §7.2 lists "age" as an Insufficient-evidence reason, which can't happen if under-18s never get a session.
*Recommendation:* age computed on the test date in IST; block if **either** source shows under 18; a conflict blocks the start and goes to the recruiter; no session, consent or media is created for a blocked person; store only `age_status` (adult / minor / unknown) + source + as-of date — never a DOB (a catalog test fails on any `%dob%`/`%birth%` column); neutral message; practice test stays open (it stores nothing server-side); "age" removed from Insufficient-evidence reasons until the Phase 2 parental-consent flow.

**Q38. Disconnect and pause rules can be gamed — Blocking (M3 chaos-test gate)**
§3.2 step 10: under 2 min the timer runs; over 2 min it pauses; up to 30 min and 3 resumes credited. Open: who decides when offline began (a client report is forgeable T3)? Is the first 2 min of a long outage credited? Does the question stay visible while paused — if so, pulling the cable buys 29 free thinking minutes? What happens at minute 31 or the 4th resume? What counts as an "unbroken sequence" for the deadline + 60 s grace (§12)?
*Recommendation:* the DO measures outage from the last acknowledged heartbeat (every 10 s) to reconnection, and client clocks are ignored. If an outage exceeds 2 min, the whole outage is credited, within totals of 30 min and 3 resumes. Once offline passes 2 min the client hides the item and locks input; edits stamped during the pause are refused and logged as connectivity context (never a flag). Past the limits the session becomes `suspended_awaiting_reschedule` (not auto-submitted, work kept). "Unbroken" = no gaps in sequence numbers up to the deadline. All of these become versioned config.

**Q39. "I can withdraw by closing the test; my data will then be deleted" (screen 03) — Blocking (consent / DPDP)**
Closing the tab is indistinguishable from a power cut, and the plan lets candidates resume from any device. Treating it as withdrawal would delete honest candidates' work.
*Recommendation:* withdrawal is an explicit action ("Withdraw and delete my data", confirmed twice), available during and after the test; closing the tab is a disconnect. Withdrawal during the test ends the session as `withdrawn`, with no score and no report, and queues deletion (pipeline built in M7; until then a recorded request). Withdrawal after submit becomes a deletion request. Copy on screen 03 changes accordingly.

**Q40. Offline buffer encrypted with an in-memory key vs no loss in a power cut — Can-default**
§10.1: buffer "encrypted with an in-memory session key; wiped on submit". After a power cut the key is gone, so the IndexedDB buffer can't be decrypted. plan-conflicts #5 says nothing buffered is lost.
*Default:* the browser generates the buffer key, keeps ciphertext in IndexedDB and sends the key to the DO once over TLS; on resume on the same device, after OTP, the DO returns it. "No answer lost" is defined as: nothing acknowledged is ever lost, and buffered edits are recovered on the same device. Edits on a dead device that never reached the server can't be recovered elsewhere (stated in the spec).

**Q41. Resume on another device: sequence numbers and two live devices — Can-default**
*Default:* dedupe key `(session_id, stream_id, seq)`; a new `stream_id` per device/resume; a fresh OTP login revokes the previous device's token (one active device); a device change counts as one of the credited resumes and is context only, never a flag.

**Q42. What the recruiter's reschedule after an over-limit outage creates — Can-default**
*Default:* a new session with `attempt_no + 1` linked to the previous one; answered sections stay as server facts, unanswered sections get a fresh draw; no extra credit charged (M7 billing honours this); the interrupted session is labelled "Connectivity".

**Q43. Durable Object ↔ Postgres during a 30-min DB outage — Can-default**
§8: Postgres is written at start, section change and submit; the exit gate needs tests to continue with Postgres down 30 min; DOs may not hold the service role.
*Default:* on publish/scheduling, an immutable **test package** (items, variants, timers, ruleset, notice) is written to R2 and cached at the edge, so the DO never needs Postgres mid-test. DO → Postgres mirroring goes through Cloudflare Queues with keys `session + job + ruleset`, consumed by `workers/jobs` (which holds the service role); consumers apply only forward `mirror_seq`. The DO is authoritative for live sessions; recruiter actions (extra time, force submit) are sent as commands to the DO via the API, never as direct Postgres edits. DO storage isn't India-pinned — I'll add that to the residency statement next to R2 (§8.2 rule 6).

**Q44. Voice answers: format, limits, time-to-first-speech, retention — Can-default**
On-device voice activity detection is M4, but M3 must measure time to first speech. §10.2 sets retention for media, event logs and decisions but not for voice answers or transcripts.
*Default:* Opus mono 24–32 kbps, uploaded in ~5 s resumable chunks while recording; prep and max length per item (defaults 30 s / 90 s, matching screen 06b); a simple energy-threshold speech-onset detector on the device for M3, stored as context and replaced by the M4 model; voice answer audio kept until decision + 30 days, 90 days max, extended while an appeal is open (mirrors the video rule).

**Q45. Extra time approval on test day — Can-default**
§5 C: "decided in 48 h, auto-approved up to +25%", but candidates request it minutes before a 15-min start window.
*Default:* up to +25% applies instantly; above 25% the candidate is offered a reschedule and the request goes to a Recruiter/Admin, who sees the percentage only — never the reason. Accommodation type is envelope-encrypted; recruiters see only "accommodation applied". Policy is config until the M7 admin settings.

**Q46. Device tiers and supported browsers — Can-default**
*Default:* three CPU tiers from a fixed on-device benchmark, thresholds in versioned config; the device check never blocks (Strict-mode pauses are M4 in-test behaviour); supported: latest 2 versions of Chrome, Edge, Firefox desktop; Safari best effort with a warning.

**Q47. OTP parameters behind shared college networks — Can-default**
*Default:* 6 digits, 10-min expiry, 5 attempts then 15-min lockout, resend after 30 s (§3.2), max 3 resends per 10 min; limits are per invite and per contact, never per IP, plus a global circuit breaker. OTP state lives in the DO/KV, never in Postgres.

**Q48. Hindi coverage and fonts — Can-default**
*Default:* every candidate-facing string in English and Hindi (recruiter app English only); add IBM Plex Sans Devanagari to tokens; Hindi strings marked "pending review" until you/counsel approve them, required before M8, not M3.

**Q49. Scratchpad, help button, nudges in M3 — Can-default**
Screen 02 shows a reviewer matching scratchpad text ("Draft found at 24:10 · 186 chars · matches 81%"), so scratchpad text must be stored — and disclosed on screen 03, which doesn't mention it.
*Default:* scratchpad text stored as events, visible in reviewer replay, never graded, disclosed in the notice. Help opens an in-app panel (FAQ + org-configured contact); focus loss while help is open is labelled "help" and excluded from signals. Max 3 nudges per session (DO-enforced); M3 ships the fullscreen-exit nudge only (other nudges need the M4 capture SDK).

**Q50. Hash chain, nonces, daily roots — Can-default**
*Default:* SHA-256 over canonical JSON of each acknowledged batch including the previous hash; a per-item nonce issued at serve time, required on every save; chain head mirrored to `sessions.chain_head`; a daily root over all chain heads written to a separate R2 bucket with a retention lock.

**Q51. Retention for data M3 starts creating — Can-default**
§10.2 doesn't cover answers, consent records, blocked-person records or practice data.
*Default:* answers, consents and sessions 12 months (like decisions); blocked-candidate records minimal, 30 days; practice data never stored server-side; every row and R2 object tagged with a `retention_class` now so the M7 engine needs no backfill.

**Q52. Practice test — Can-default**
*Default:* a separate public practice item set (never real items); the "what we record" preview runs on the device only and uploads nothing; no OTP, no consent record, no freeze.

**Q53. Small schema details — Can-default**
Receipt reference: the plan's example `TR-8F2K` collides at scale → ≥8 characters, unique per org. Consent IP (§9.1) is personal data and rule 7 bans IP flags → stored encrypted, never readable by integrity code. Naming: §9.1 `responses` = answers; the candidate's reply to a notice becomes `notice_replies` in M6 to avoid confusion.

---

## 3. Repository layout and toolchain for M0

### Layout
Matches `docs/build-order.md` M0 exactly; additions are marked **+** with the reason. (The `trace-milestone-review` skill greps `apps packages workers services`, so these top-level names stay.)

```
/
├─ apps/
│  ├─ candidate/          React+Vite on Pages — lobby/OTP, age gate, consent, device check, runtime, receipt/status, own report.
│  │                      Separate app: strict bundle budget (4 GB laptops, p95 <3 s on 4G), no PostHog, own CSP.
│  └─ recruiter/          React+Vite on Pages — recruiter, reviewer, admin, owner consoles (role-gated routes); Supabase Auth.
├─ packages/
│  ├─ ui/                 Design system: tokens.json → generated tokens.css + tokens.ts; accessible primitives;
│  │                      recruiter-only heavy components behind a separate entry so the candidate bundle never pulls them in.
│  ├─ shared/             Domain types, zod schemas (API, events, token claims), ID helpers, PII-redacting logger. Runtime-neutral.
│  ├─ vendors/        +   Interfaces + mocks only: SttProvider, CodeRunner, LlmGrader, LlmDrafter, Messaging, Payments.
│  │                      Importable from Workers and Node without pulling in adapters.
│  ├─ db-types/       +   Generated by `supabase gen types`; CI fails if stale.
│  └─ config/         +   Shared tsconfig base, ESLint flat config, Vitest presets.
│                         (packages/band-engine is created in M4, not now.)
├─ workers/
│  ├─ edge/               Candidate session API, ingest/upload Workers, SessionAuthority Durable Object (M3). M0: /health.
│  │                      Never bound to the service-role key.
│  └─ jobs/           +   Queue consumers + server-side jobs that hold the service role (only if Q1 = Workers).
├─ services/
│  └─ api/                Modular monolith: src/modules/<module>/. Runtime-agnostic TS; Workers entrypoint now, Node entrypoint if ECS later.
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/         Forward-only SQL; never edit a merged migration.
│  ├─ seed.sql            Synthetic data only.
│  └─ tests/              pgTAP: helpers (authenticate_as role/org/user|candidate), <table>.rls.test.sql, catalog meta-tests.
├─ e2e/                   Added in M3: Playwright + axe-core, throttled-network and chaos runs.
├─ infra/             +   OpenTofu (Terraform-compatible) for Cloudflare (R2, Queues, DNS), Supabase project settings, GitHub branch
│                         protection, and later AWS (KMS, Secrets Manager, SES, Bedrock IAM, GitHub OIDC). One tool for all three
│                         providers. Needs your OK (no ADR names an IaC tool); M0 can start with wrangler + dashboard if you prefer.
├─ scripts/               Existing Claude hooks + verify-fast.mjs, test-rls.mjs, check-migrations.mjs, git-autopush.sh (moved from .git/hooks).
├─ specs/                 Per-module specs (CLAUDE.md "How to work").
└─ .github/workflows/     ci.yml, deploy-staging.yml
```

Root files: `pnpm-workspace.yaml` (apps/*, packages/*, workers/*, services/* + a version `catalog:`), `tsconfig.json` (project references), `eslint.config.js`, `.prettierrc`, `.editorconfig`, **`.gitattributes`** (`* text=auto eol=lf`), `.npmrc` (`shell-emulator=true`), `.node-version`, `lefthook.yml`, `commitlint.config.js`, `.gitleaks.toml`.

### Scripts (CLAUDE.md "How to work")
| Script | What it runs |
| --- | --- |
| `pnpm verify` | `typecheck && lint && test && test:rls && build` — exactly the CLAUDE.md list |
| `pnpm verify:fast` | `scripts/verify-fast.mjs`: typecheck + lint + unit for packages changed since `merge-base HEAD main` (plus untracked files); any root config/lockfile change runs everything; no DB; target <2 min (Stop hook timeout is 600 s) |
| `pnpm test:rls` | `supabase start` (minimal services) → `db reset` → `supabase test db` → **fails if Docker is down (never skips)** and fails if the pgTAP test count is <50 |
| CI only | `pnpm audit --prod --audit-level=high`, osv-scanner, gitleaks full history, migration-name/order check, db-types drift, candidate bundle-size budget |

### Toolchain
Majors chosen below; **exact versions are pinned and re-verified against the registry on day one of M0** (the subagent's registry snapshot is not something I've verified myself).

| Tool | Choice | Why |
| --- | --- | --- |
| Node | 24 LTS (`.node-version`, `engines`) | 20 is end of life (installed here); 22 reaches end of life April 2027, mid-build. Deviation from docs' "22" — justified by support window |
| pnpm | exact `packageManager` pin; catalog for shared versions | workspace standard per build-order |
| TypeScript | strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; project refs | CLAUDE.md "strict". Major chosen to satisfy typescript-eslint's supported range |
| Frontend | React + Vite, CSS Modules on generated CSS variables (no CSS-in-JS runtime) | CLAUDE.md stack; light candidate bundle. Tailwind (mentioned in design README) only with an ADR |
| Routing/HTTP | React Router (client), Hono (server, Workers + Node) | ADR-028 per Q13 |
| Validation | zod | shared contracts |
| Unit tests | Vitest (one version via catalog) + `@cloudflare/vitest-pool-workers` for DO/alarm tests with fake time | M3 chaos/timer tests run in the Workers runtime |
| DB tests | pgTAP via `supabase test db`, own `authenticate_as()` helper | runs inside Postgres; sets `request.jwt.claims` to impersonate every role incl. the candidate token; each test rolls back; matches the review skill's G5 gate. A supabase-js layer with real JWTs is added in M3/M6 ("via any view or API") |
| E2E / a11y | Playwright + @axe-core/playwright, from M3 | M3 exit gate (axe clean, keyboard-only, 512 kbps throttle) |
| Lint/format | ESLint flat config (typescript-eslint strict-type-checked, jsx-a11y, react-hooks, boundaries) + Prettier | chosen over Biome: type-aware `no-floating-promises` (DO/queue correctness) and import-boundary rules for rule 1 and band-engine purity |
| Git hooks | **lefthook** (not husky) | husky sets `core.hooksPath`, which would silently disable the existing auto-push hook; lefthook keeps `.git/hooks` and lets the auto-push become a versioned script |
| Commits | commitlint conventional + `wip` type | the trace-handoff skill writes `wip(...)` commits |
| Secrets scan | gitleaks pre-commit (staged) + CI full history | auto-push means CI-only scanning is too late |
| Supabase CLI | pinned as a root devDependency | same version locally and in CI; needs Docker Desktop on Windows |
| Migrations | `YYYYMMDDHHMMSS_mNN_<concern>.sql` | CI rejects edited merged migrations and out-of-order timestamps (catches M1∥M2 collisions) |
| Observability | Sentry (React/Cloudflare SDKs) with scrubbing; own JSON logger | M0 skeleton; PII redaction unit-tested |
| CI | GitHub Actions, Linux runners, actions pinned by SHA; jobs: static, rls, security, migrations (all required) + deploy-staging on main | build-order M0; 3,000 free minutes/month means caching Docker images and Playwright browsers matters |

### Windows-specific fixes (this machine)
- `core.autocrlf=true` checks scripts out with CRLF, which would fail `prettier --check` locally but pass on Linux CI → `.gitattributes` with `eol=lf` and one renormalise commit.
- pnpm runs scripts through cmd.exe → `shell-emulator=true`; non-trivial logic in Node `.mjs`, as the existing hooks already are.
- `.claude/worktrees/` is ignored only via `.git/info/exclude`, which ESLint/Vitest/Prettier/gitleaks don't read → add it to `.gitignore` and every tool's ignore list.
- `.dev.vars` (wrangler local secrets) is in neither `.gitignore` nor the Claude deny list → add to both (needs your OK since `.claude/settings.json` is config).
- The path contains spaces; Supabase CLI Docker bind mounts with spaced Windows paths are unverified → tested on day one of M0 (WSL clone avoids it).

### Deviations from CLAUDE.md / build-order, summarised
1. Compute on Workers instead of ECS (only if you accept Q1; ADR-027 + CLAUDE.md edit).
2. Extra packages `vendors`, `db-types`, `config` and `workers/jobs` (reasons above; no new frameworks).
3. Node 24 instead of 22 (support window).
4. Auto-push hook moves into lefthook + a versioned script (same behaviour, no longer lost on fresh clones).
5. Org-user roles resolved from tables, not JWT claims (Q3; ADR).
6. AWS dev account and domain deferred from M0 prerequisites to M2 (only if Q1 = Workers; nothing in M0 would use them).

---

## 4. Data model for M0–M3

### Conventions (every table)
- `org_id uuid not null` + `unique (org_id, id)`; foreign keys to tenant tables are **composite** `(org_id, x_id)` so a row can never point into another org.
- RLS enabled on every table and partition, **separate policies per operation**, no `anon` access anywhere (default privileges revoked in M0, grants explicit).
- Postgres principals: `authenticated` (org users), `trace_candidate` (NOLOGIN role entered via `SET LOCAL ROLE` for candidate tokens, Q6), worker roles (`trace_worker`; later `trace_scoring_worker` / `trace_integrity_worker` with non-overlapping grants). Whether a migration can create custom BYPASSRLS roles on Supabase is verified on day one; fallback is `service_role` with every invariant in triggers/constraints.
- **Invariants live in triggers and CHECKs**, because workers bypass RLS but not triggers.
- No DELETE policies on candidate data — deletion is the M7 worker pipeline; status columns otherwise.
- Catalog meta-tests (pgTAP, from M0): RLS on everywhere; `org_id` everywhere; no column matching `%dob%`, `%birth%`, `%reject%`, `%honesty%`, `%trust_score%`; no view reading from both `quality` and `integrity`.
- Evidence reads (from M6) and staff reads go through audited API/RPC paths, because Postgres can't audit SELECTs.
- Candidates never see staff identities: any candidate-readable row that names a staff member (actor, decider, reviewer) is exposed only through a view or column grant that shows role and organisation (plan §2).

### Principals used in the RLS columns
OW Org Owner · AD Admin · RC Recruiter · RV Reviewer · HM Hiring Manager · CV Client Viewer · CA Candidate · TS Trace Trust & Safety (break-glass grant) · SW server worker. **asg** = row is within the user's assignments (workspace/job/drive/candidate, Q2). **own** (CA) = `candidate_id`/`invitation_id` match the token claims. ✗ = no policy (denied). Unlisted roles are ✗; CV is ✗ on every M0–M3 table; HM is ✗ unless listed. Every cell gets an allowed and a denied pgTAP case, plus a cross-org user.

### M0 — Foundations
| Table | Purpose | Key columns | RLS (S / I / U / D) |
| --- | --- | --- | --- |
| `orgs` | tenant root | id, org_id (= id, generated), kind (customer / trace_library / trace_internal), name, slug, data_residency (r2_apac / s3_mumbai), status | S: OW AD RC RV HM own org; TS with grant · I: ✗ (only `create_org()` RPC) · U: OW (name, residency), AD (name) via guard trigger · D: ✗ |
| `workspaces` | staffing firm's client workspaces; one `default` per org | id, org_id, name, kind (default/client), is_default, archived_at | S: members (org-wide or that workspace); TS · I/U: OW AD · D: ✗ (archive) |
| `teams` | organisational grouping only (Q2) | id, org_id, name | S: OW AD RC RV HM · I/U/D: AD (D only if empty) |
| `memberships` | user ↔ org with roles | id, org_id, user_id → auth.users, roles org_role[] (≥1), workspace_id null, team_id null, display_name, status (invited/active/suspended/removed), created_by, removed_at | S: own row; OW AD all; RC RV via `v_org_directory` (id, name, roles); TS · I/U: OW AD — only OW grants `org_owner`; nobody edits own roles; last owner can't be removed (triggers) · D: ✗ (ids never reused — rule 4 compares them) |
| `audit_log` | append-only record (monthly partitions) | id, occurred_at, org_id, actor_kind (org_user/candidate/staff/system), actor_user_id, actor_roles, action (`noun.verb`), object_table, object_id, candidate_id, workspace_id, request_id, staff_grant_id, details jsonb (<4 KB, IDs only) | S: OW AD own org (CA view of "who viewed" in M7) · I: ✗ for all app roles — only `private.audit()` / triggers / SW · U/D/TRUNCATE: revoked from **every** role incl. service/worker + raising triggers |
| `platform_staff` | Trace staff eligible for break-glass | user_id, org_id (= trace_internal), active, capabilities | S: TS own row · I/U/D: SW/migration only |
| `staff_access_grants` | ticketed break-glass | id, org_id (tenant), staff_user_id, ticket_ref not null, scope, granted_at, expires_at (CHECK ≤ granted_at + 4 h), revoked_at/by, approved_by | S: OW AD (tenant sees all grants), TS own · I: SW · U: OW AD may set only revoked_* (trigger) · D: ✗ |
| `idempotency_keys` | dedupe ledger for consumers/webhooks | org_id, scope, key, first_seen_at, result_ref, expires_at — pk (org_id, scope, key) | ✗ all app roles; SW only (denied-case tests still required) |

Also M0: enums, `private` schema helpers (`my_org_ids(roles)`, `my_scope_ids(kind, roles)`, `ts_org_ids()`, `cand_*()` claim readers — all `SECURITY DEFINER`, `search_path = ''`, execute revoked from public), roles `trace_candidate` / `trace_worker`, empty `quality` and `integrity` schemas, audit triggers on memberships and grants. RLS cases: 8 tables × ~9 principals × 4 operations ≫ 50.

### M1 — Test authoring
| Table | Purpose | Key columns | RLS |
| --- | --- | --- | --- |
| `signal_catalog` | integrity settings on screen 04 | org_id (= library org), signal_key, allowed_values, always_locked, phase | S: staff roles · I/U/D: migration only |
| `integrity_presets` | Strict / Standard / Open-book (Q18) | id, org_id (= library org), key, version, signal_defaults jsonb | S: OW AD RC RV · writes: migration only |
| `org_integrity_locks` | admin-locked defaults | id, org_id, signal_key, locked_value, locked_by/at; unique (org, signal) | S: OW AD RC RV · I/U/D: AD (audited) |
| `role_templates` | BPO Voice, Support, … (ABH-5) | id, org_id (own or library), key, version, name, blueprint jsonb, status | S: OW AD RC RV (own + library) · I/U: AD RC own org · D: ✗ |
| `jobs` | job from JD or template | id, org_id, workspace_id, title, jd_text (<50k), role_template_id/version, status, created_by | S: OW AD RC RV · I/U: AD RC · D: ✗ |
| `tests` | test identity | id, org_id, workspace_id, job_id, name, current_version_id, archived_at | as `jobs` |
| `test_versions` | immutable once published (Q20) | id, org_id, test_id, version_no, status (draft/published/retired), blueprint, total_time_seconds, allow_phone, ruleset_version_id, notice_template_version, content_sha256 (R2 package hash), published_at/by, locked_at | S: OW AD RC RV · I: AD RC · U: AD RC while draft; after publish immutable (trigger fires for SW too); `locked_at` set once · D: drafts only |
| `ruleset_versions` | frozen integrity settings | id, org_id, test_id, version_no, preset_key/version, signal_settings jsonb (validated vs catalog + locks by trigger), paste_rules jsonb, band_rule_table_version_id (FK added M4), published_at, locked_at | S: OW AD RC RV · I: AD RC · U: AD RC only while no **published** test version references it (trigger sets `published_at` at publish; immutable from then, since the R2 package already contains it — Q43); `locked_at` marks first start · D: ✗ once referenced |
| `sections` | sections, timers, draws (ABH-10) | id, org_id, test_version_id, position, name, format (written/mcq/typing/voice; code/video rejected by CHECK for now), time_limit_seconds, draw_count, pool_id, shuffle_items, shuffle_options, weight, prep_seconds | as parent test version (lock checked by trigger) |
| `section_pool_snapshot` | pool membership frozen at publish | org_id, test_version_id, section_id, item_version_id | S: OW AD RC RV · I: publish function · U/D: ✗ |
| `items` / `item_versions` | item identity / immutable versioned content | versions: id, org_id, item_id, version_no, status (draft/in_review/approved/live/rejected/retired), origin (human/import/ai_draft), stem jsonb (R2 image keys), options, language, read_aloud, is_parameterised, rubric_version_id, difficulty, discrimination/solvability/exposure_count (filled later), ai_draft_job_id, content_sha256, approved_by/at, created_by. **CHECK: ai_draft can't be approved/live without approved_by** | S: AD RC RV own org (library per Q27) · **no grant at all to `trace_candidate`** · I: AD RC · U: AD RC while draft/in_review; approval requires `approved_by = auth.uid()`; content immutable after · D: drafts |
| `item_variants` | pre-generated parameterised variants (ABH-7) | id, org_id, item_version_id, variant_no (0 = base), params, stem_overrides, difficulty (trigger: within ±0.1 of parent), status | as item_versions |
| `item_answer_keys` | keys separated from content | org_id, item_variant_id, key jsonb, created_by, key_reviewed_by (Q23) | S: AD RC RV own org only · I/U: AD RC while draft · CA HM CV TS ✗ |
| `pools` / `pool_items` | editable authoring pools | pools: id, org_id, workspace_id, name, format, skill · pool_items: org_id, pool_id, item_version_id | S/I/U/D: AD RC own org |
| `rubric_versions` | versioned rubrics (used in M5) | id, org_id, rubric_key, version_no, criteria, anchors, status | S: AD RC RV · I: AD RC · U: drafts only |
| `import_jobs` / `import_row_errors` | Excel/Word import (ABH-9) | jobs: id, org_id, source_kind, file_r2_key, status, totals, created_by, file_purged_at · errors: org_id, import_job_id, row_no, field, error_code, message | S: AD RC · I: AD RC (jobs), SW (errors) · U: SW status, RC cancel |
| `ai_draft_jobs` | AI drafting runs (ABH-8) | id, org_id, requested_by, slot_spec, provider, model_id, prompt_version, status | S/I: AD RC · U: SW |

Functions: `publish_test_version()` (hash + R2 package + pool snapshot), `private.lock_test_version()` (called on first start; directly by M1 tests).

### M2 — Scheduling & invites
| Table | Purpose | Key columns | RLS |
| --- | --- | --- | --- |
| `org_keys` | envelope-encryption key versions (KMS) and per-org blind-index key refs | org_id, purpose, key_version, kms_key_arn, wrapped_dek | ✗ all app roles; SW/API only |
| `candidates` | person record, org-level | id, org_id, full_name_ct (encrypted), key_version, contact_fingerprint (HMAC), age_status (adult/minor/unknown), age_status_source, age_status_as_of — **no DOB** | S: AD RC RV via asg invitations; OW only if assigned · CA own (column grant: id, age_status) · I: AD RC (API), SW (bulk) · U: AD RC asg · D: ✗ |
| `candidate_contacts` | contacts split out for masking | candidate_id, org_id, email_ct, phone_ct, email_bidx, phone_bidx, key_version, whatsapp_opt_in_at | S/U: AD RC asg · RV HM CV OW TS CA ✗ · I: SW / API |
| `drives` | open window or scheduled drive | id, org_id, workspace_id, job_id, test_id, test_version_id (pinned), mode, opens_at, deadline_at, timezone, lab_mode, bandwidth_budget_kbps, expected_candidates, reminder_offsets interval[], self_reschedule_allowed, status, version_frozen_at | S: OW AD RC RV; HM asg; TS · I: AD RC (creator auto-assigned) · U: AD RC asg; pinned version immutable after freeze · D: drafts |
| `slots` | capacity / windows | id, org_id, drive_id, starts_at, capacity, booked (CHECK 0 ≤ booked ≤ capacity), start_window_minutes (15), lobby_opens_minutes (30), status | as drives |
| `assignments` | defines "assigned" (Q2) | id, org_id, membership_id, scope (workspace/job/drive/candidate), one matching id column (CHECK), as_role, created_by | S: AD all, assignee own, RC within own scopes · I/D: AD; RC within own scopes (audited) · U: ✗ |
| `invite_uploads` / `invite_upload_errors` | bulk upload + per-row reason | uploads: id, org_id, drive_id, file_r2_key (short TTL), file_sha256, status, counts · errors: org_id, upload_id, row_no, reason enum (duplicate_*, already_invited, invalid_*, missing_name, minor, bad_dob) — **cell values never echoed** | S: AD RC asg · I: AD RC (upload), SW (errors) |
| `invitations` | candidate × drive | id, org_id, workspace_id, job_id, drive_id, slot_id, test_id, candidate_id, upload_id, dedupe_scope (= drive), phone_bidx, email_bidx, link_token_hash (unique), channels, language (en/hi), status (created…otp_verified/started/submitted/expired/revoked/blocked_age — **no rejected**), expires_at, self_reschedules_used (0–1) | S: AD RC RV asg; CA own via `v_candidate_portal` (no hash/bidx columns) · I: AD RC asg, SW · U: AD RC asg (revoke/reschedule), SW (status) · D: ✗ — partial unique on (dedupe_scope, email_bidx) where not revoked; phone duplicates via trigger requiring `phone_dup_confirmed_by` (Q30) |
| `message_templates` | versioned per purpose × channel × language (incl. DLT/WhatsApp ids) | id, org_id (library), purpose, channel, language, version, provider_template_ref, body_sha256 | S: AD RC · writes: SW/migration |
| `outbound_messages` | planned/sent message = delivery status | id, org_id, invitation_id, template_version_id, channel, purpose, idempotency_key (unique per org), scheduled_for, status, provider_message_id, attempts, last_error_code — **no body, recipient or OTP stored** | S: AD RC asg · I/U: SW |
| `message_events` | provider callbacks, append-only | id, org_id, outbound_message_id, provider, provider_event_id (unique), event, occurred_at | S: AD RC asg · I: SW · U/D: revoked |
| `reschedule_events` | reschedule history, append-only | id, org_id, invitation_id, actor, actor_user_id, from_slot_id, to_slot_id, reason_code | S: AD RC RV asg; CA own via view exposing actor kind only (no `actor_user_id`) · I: SW · U/D: revoked |

### M3 — Candidate runtime (DO is authoritative; Postgres receives copies via Queue → SW)
| Table | Purpose | Key columns | RLS |
| --- | --- | --- | --- |
| `org_policies` | locked org defaults (M3 uses accommodation + fiduciary fields) | org_id, extra_time_auto_approve_max_pct (≤25), fiduciary_legal_name, grievance_contact; reserved: response_window_hours (CHECK ≥72), report_release_days, retention | S: OW AD RC RV · U: AD (OW per Q2) · I: `create_org()` |
| `notice_versions` | immutable notice templates EN/HI | id, org_id (library), notice_key, version, language, body_template, template_sha256, published_at | S: staff roles + CA · writes: migration only |
| `consents` | append-only consent ledger | id, org_id, invitation_id, candidate_id, notice_version_id, ruleset_version_id, rendered_sha256 not null, language, event (granted/withdrawn), occurred_at, ip_ct (encrypted, Q53), source_seq | S: CA own; AD RC RV asg · I: SW · U/D: revoked |
| `accommodations` | self-declared, encrypted | id, org_id, invitation_id, candidate_id, payload_ct (type + suppressed signals + alternative control), key_version, declared_at | S: CA own · **every org role ✗** (they see `sessions.accommodation_applied` only) · I: SW |
| `extra_time_requests` | +% requests (Q45) | id, org_id, invitation_id, candidate_id, requested_pct, status (auto_approved/pending/approved/denied/expired), granted_pct, decision_due_at, decided_by/at — CHECK auto_approved ⇒ ≤25 | S: CA own via column grant excluding `decided_by` (role only); AD RC asg (no reason stored) · U: AD RC asg pending → decided, `decided_by = auth.uid()` · I: SW |
| `sessions` | mirror of the DO | id (minted by DO), org_id, workspace/job/drive/slot/invitation/candidate ids (denormalised for RLS), attempt_no, previous_session_id, test_version_id, ruleset_version_id, consent_id not null, state (in_progress/paused/suspended_awaiting_reschedule/submitted/auto_submitted/withdrawn — **no outcome state**), age_gate_result CHECK = 'adult', started_at, server_deadline_at, submitted_at, submit_kind, extra_time_seconds, credited_seconds, disconnect_seconds_total, resume_count, device_change_count, device_tier, input_method, monitoring_level, accommodation_applied, evidence_coverage (M4), chain_head, last_event_seq, mirror_seq, receipt_ref (≥8 chars, unique per org), report_release_due_at | S: AD RC RV asg; CA own via `v_candidate_status`; TS (status, via API) · I/U: SW only — forward-only `mirror_seq`, started_at/submitted_at set once · D: ✗ |
| `session_transitions` | state-change log | pk (session_id, seq), org_id, kind (start/section_enter/section_exit/pause/resume/device_change/submit/auto_submit/withdraw), section_id, occurred_at, payload | S: AD RC RV asg · I: SW · U/D: revoked |
| `session_items` | items actually served | id, org_id, session_id, section_id, position, item_version_id, item_variant_id, option_order, served_at, nonce_hash, retake_of (unique), retake_reason (technical_failure) | S: AD RC RV asg (metadata) · CA ✗ · I: SW — trigger blocks unapproved AI items and a retake on the same variant |
| `responses` | final answer rebuilt server-side | id, org_id, session_id, session_item_id (unique), answer_kind, final_text, final_choice, audio_media_id, answer_sha256, submitted_at, final_seq, event_log_r2_key, replay_status (pending; filled M4) — **no score columns** | **all app roles ✗ in M3** (audited RPC access in M6) · I/U: SW, forward-only |
| `media_objects` | uploads limited to allow-list | id, org_id, session_id, session_item_id, kind (CHECK: only `voice_answer_audio` in M3; M4 widens to start_photo, snapshot_still, server_still, flag_still, flag_clip), r2_key (deterministic, unique), sha256, bytes (capped), mime, blurred_on_device, upload_state, retention_until, legal_hold | org roles ✗ in M3 (M6: metadata to asg, bytes via 5-min signed audited links) · CV never · I/U: SW |
| `session_disconnects` | connectivity gaps | pk (session_id, seq), org_id, started_at, ended_at, paused, credited_seconds, label CHECK = 'connectivity' | S: AD RC RV asg · I: SW |
| `diary_entries` | one-tap diary | pk (session_id, seq), org_id, kind (someone_entered/power_or_network/stepped_away), occurred_at | S: CA own; AD RC RV asg · I: SW |
| `nudges` | max 3 per session | pk (session_id, nudge_no 1–3), org_id, signal_key, shown_at, corrected_at, reply_text | S: CA own; AD RC RV asg · I: SW · U: SW (corrected_at) |
| `scratchpad_snapshots` | stored scratchpad text (Q49) | pk (session_id, seq), org_id, text_ct, captured_at | S: CA own · org roles ✗ until M6 (audited replay) · I: SW |
| `evidence_chain_roots` | daily per-org root of chain heads | pk (org_id, day), root_sha256, object_lock_r2_key, session_count | S: AD · I: SW · U/D: revoked |
| `session_jobs` | idempotent job ledger | org_id, session_id, job_kind, ruleset_version_id, status, attempts; unique (session, job_kind, ruleset) | ✗ app roles; SW only |
| `withdrawal_requests` | explicit consent withdrawal (Q39), processed by M7 pipeline | id, org_id, invitation_id, candidate_id, session_id null, requested_at, status | S: CA own; AD asg · I: SW |

Not in Postgres by design: OTP challenges and rate limits (DO/KV with TTL; only `otp_verified_at` is mirrored); raw event streams (R2); practice sessions (not persisted).

Views in scope: `v_org_directory` (M0), `v_invitation_delivery` (M2), `v_candidate_portal` and `v_candidate_status` (M3). All `security_invoker`; candidate views are granted only to `trace_candidate`, with column grants on base tables so hidden columns can't be read directly.

### M0–M3 invariants enforced in the database
1. `audit_log` append-only for every role (revokes + triggers on all partitions).
2. No self-elevation; only owners grant `org_owner`; last owner can't be removed.
3. Break-glass: ticket required, ≤4 h, every staff read audited with `staff_grant_id`.
4. Published test versions, pool snapshots and rulesets referenced by a published version are immutable (triggers that also bind workers); admin locks validated on every write.
5. AI-drafted items can't be approved or served without an approver (CHECK + serving trigger) — M1 exit gate.
6. Dedupe per drive; self-reschedule ≤1; `booked ≤ capacity`; pool ≥10× draw at scheduling; message idempotency keys unique.
7. Under-18: `age_gate_result = 'adult'` CHECK + trigger refusing sessions for `minor` candidates; no DOB column anywhere (meta-test).
8. Session requires a granted consent with a stored hash for the same invitation and ruleset.
9. First session insert locks the test version and ruleset.
10. Forward-only mirroring (`mirror_seq`), exactly-once logs via `(session_id, seq)` keys, unique job keys `(session, job, ruleset)`.
11. Media `kind` allow-list CHECK (rule 8).
12. **Room left for M4–M6:** no score, band, outcome or "rejected" column/enum exists in M0–M3 (meta-test); `quality` vs `integrity` schemas already separated with non-overlapping worker grants (rule 1); membership/user ids never deleted or reused so M6 can enforce "decider ≠ confirmer" (rule 4); `org_policies.response_window_hours` CHECK ≥72 reserved (rule 4); flag state will include `not_used` and appeals on it will be refused (rule 6).

### Excluded on purpose (later milestones)
M4: band rule versions (with `validated` flag), signals, flags, integrity results, explanations, similarity matches · M5: scores, section scores, grader runs, transcripts, model versions, calibration runs (`quality` schema) · M6: reports, `report_candidate_view`, flag dictionary, decisions, notices, notice replies, appeals, outcomes, carry-forward packs · M7: retention, deletion receipts, DSRs, credits, invoices, payments, API keys, webhooks, client-pack links · M9+: code runs, item stats, second camera, re-attempt bookings, ATS connections.

---

## 5. Risks in the build order, ranked

| # | Risk | Likelihood / Impact | Mitigation | Hits |
| --- | --- | --- | --- | --- |
| 1 | **Compute topology undecided** (Q1). Changes `services/api` runtime, IaC, CI deploy, secret boundaries and the "compute in Mumbai" claim | High / High | Decide before the M0 spec; ADR-027; runtime-agnostic API modules | M0, M5, M7 |
| 2 | **Scope vs. one developer under usage limits vs. date.** Plan §10 says beta Nov 2026; today is 10 Oct 2026; 9 milestones precede beta, M0 and M3 are each large. Up to 4 parallel writers burns the 5-hour window fast | High / High | plan-conflicts #12 (beta only after M8) and #13 (wedge first). Cap at 2–3 parallel writers. Split M0 into M0a (toolchain, CI, hooks, gitleaks) and M0b (schema, RLS, auth, staging); split M3 into M3a (DO, timer, resume, ingest) and M3b (consent, age gate, voice, a11y) with separate reviews. Keep `verify:fast` <2 min | All |
| 3 | **M3 is the critical path and almost entirely undesigned.** Only screen 03 exists, and it conflicts with the plan in 5 places (Q33); four Blocking questions (Q36–Q39) sit there | High / High | Answer Q36–Q39 before M1/M2 finish; build M3 UI from plan + components; founder demos on staging | M3 |
| 4 | **Exit gates a mock or sandbox can't satisfy:** M2 "2,000 delivered" vs SES sandbox; M5 speaking-level ≥0.8 and LLM ±10 need real STT (ABH-86), Bedrock (ABH-87) and the 300-answer set; ABH-5 needs 5 real recruiters | High / High | Q21 + Q28 defaults; split M5 into code-complete and a calibration sub-gate due before M8; founder starts ABH-86/87, the calibration set and SES production access now | M1, M2, M5, M8 |
| 5 | **Candidate token ↔ RLS mechanism unproven** (Q6). If Supabase can't evaluate Trace-issued tokens the way assumed, candidate RLS and the DO → Postgres path are reworked in M3 | Medium / High | Fix claim shapes in `packages/shared` in M0; write candidate-role pgTAP tests in M0; spike token minting against the local stack in M0b | M0, M3 |
| 6 | **Durable Object design:** 20k starts in 60 s; alarm-driven deadlines; offline credit rules; dedupe across devices; DO storage not India-pinned | Medium / High | Short DO design ADR at the start of M3; per-session DO with sharded drive counters; a 1–2k-session load test on staging in M3 instead of waiting for M8; residency statement updated | M3, M8 |
| 7 | **Dev environment not ready** (verified: Node 20 EOL, pnpm broken; reported: Docker stopped, gitleaks missing; CRLF vs Prettier; spaced path; no WSL distro). The Stop hook will fail every turn once `verify:fast` exists | High / Medium | Q5 day-zero checklist before any M0 code; `test:rls` fails loudly when Docker is down; `.gitattributes` | M0 |
| 8 | **Secrets and hooks:** every commit is pushed instantly and history may not be rewritten; husky would silently disable the auto-push | Medium / High | lefthook + pre-commit gitleaks + versioned auto-push script (Q15) before the first code commit | M0 |
| 9 | **Consent/age ordering and DPDP readiness** (Q35–Q39): notice text, fiduciary block, Hindi copy and withdrawal semantics all need counsel (ABH-89) before real data; counsel is an M8 prerequisite but the build depends on the answers in M3 | Medium / High | Build to the recommended defaults, mark copy "pending counsel"; book counsel review during M3 rather than at M8 | M3, M8 |
| 10 | **Measurements that can't be produced early:** M1 500-item import timing, M3 512 kbps upload + chaos, M4 capture p99 on a real 4 GB laptop (CDP throttling ≠ real hardware), M8 20k load test (Cloudflare/Supabase/load-generator cost vs. small AWS budget) | High / Medium | Build each harness in the milestone that introduces the feature, record small-scale numbers; buy or borrow one real low-end laptop; budget and approve the M8 load-test spend before M7 | M1–M8 |
| 11 | **Band-engine validation data** (500-session study, founder-only): without it every T3 detector is context-only at beta, so the integrity output is thin | High / Medium | M4 gates on property tests (as build-order says); start consented study recordings during M4 under a study notice | M4, beta value |
| 12 | **PII leaving India via tooling** (Sentry, PostHog — no India region) and the M11 fairness breakdown needing sensitive attributes | Medium / High | Scrubbing + tests from M0; no candidate identifiers in telemetry; fairness-attribute consent spec before M11 | M0, M7, M11 |
| 13 | **Low-bandwidth India constraints:** p95 <3 s on 4G, 512 kbps uploads, candidate bundle creeping with every feature | Medium / Medium | Separate candidate app; CI bundle budget from M0; throttled Playwright runs from M3; resumable chunked uploads | M3, M4 |
| 14 | **Migration collisions in parallel milestones** (M1∥M2, M4∥M5) | Medium / Medium | One migration owner per stream; CI ordering check; rebase + regenerate timestamps | M1, M2, M4, M5 |
| 15 | **Version skew in "latest" tooling** (newest TypeScript/Vitest/ESLint majors break typescript-eslint, vitest-pool-workers, jsx-a11y respectively, per the toolchain review) | High if unpinned / Medium | Exact pins + catalog; grouped dependency-update PRs | M0+ |
| 16 | **Supabase free tier:** 2 projects, idle pause, no PITR (plan needs RPO ≤2 min) | Medium / Medium | CI deploys keep staging awake; Pro + PITR budgeted for M8 | M0, M8 |
| 17 | **Vendor lead times:** DLT/WhatsApp (weeks, M2 flags), code runner (ABH-88, M9), GSTIN for invoices (M7), design-partner LOI gating M4, external VAPT (M13) | Medium / Medium–High | Interfaces + mocks first (build-order rule 4); founder starts ABH-83/88/89/91 now | M2, M4, M7, M9, M13 |

---

*Status:* waiting for your answers. Nothing else in the repo has been changed.
