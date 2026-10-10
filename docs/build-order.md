# Build order — Phase 0 + Phase 1

Scope of this build: every Phase 0 and Phase 1 feature in `docs/plan.md` §5. Phase 2–3 features are out of scope; do not start them.
Issue IDs (ABH-n) refer to the Linear project "Trace v1 — Launch". Each issue has a "Done when" line; that line plus the exit gate below is the definition of done.

**Rules for every milestone**
1. Start in plan mode. Write or refresh `specs/<module>.md` for each module touched, get the founder's OK, then implement.
2. Each milestone runs on branch `milestone/m<N>` and merges to `main` by PR. Parallel work only where marked ∥, each stream in its own git worktree, each owning separate directories. Max 3 parallel writers (founder decision 2026-10-10).
3. A milestone closes only when: all its issues meet "Done when", `pnpm verify` is green in CI, the exit gate passes, and the `trace-milestone-review` skill returns PASS — or PASS WITH CONDITIONS, where every Medium finding has an owner milestone and is fixed before that milestone's review. Then tag `m<N>-reviewed`. M8 and M13 require a clean PASS.
4. Human prerequisites (H) must be done by the founder before the milestone starts. Where a vendor is not chosen, build the interface + mock and leave the real adapter for later.
5. **Split milestones.** M0 and M3 are split into M0a/M0b and M3a/M3b (founder decision 2026-10-10). Each part is a milestone in its own right: branch `milestone/m0a` etc., its own spec approval, its own `trace-milestone-review`, and its own tag (`m0a-reviewed`). M0b starts after `m0a-reviewed`; M3b starts after M3a's session API contract is merged and may overlap M3a only where directories don't.
6. **Deferred gates.** Where a "Done when" line needs real people, real data or a later milestone, the milestone may close on an automated proxy test. Each such check goes in a **Deferred gates** table in `docs/milestones/M<N>-summary.md` (check · proxy test used · owner milestone), and every deferred gate must pass by the M8 gate at the latest — **proposed exception, pending founder confirmation (build-notes Q58):** where the plan's own "Done when" line places the check in a later phase, it names that later owner explicitly. Known cases: ABH-7 empirical difficulty (±0.1 of parent, needs response data) → M10; ABH-25 external accessibility audit and TalkBack (plan §5 C: "External audit before launch (Phase 2)"; TalkBack needs phone mode) → Phase 2.

---

## Phase 0 — Foundation + closed beta

### M0 · Foundations (sequential — everything depends on it)
Split into M0a then M0b (rule 5). The original M0 exit gate is the union of the two gates below.

#### M0a · Toolchain, pipeline and skeleton
- Monorepo (pnpm workspaces): `apps/candidate`, `apps/recruiter`, `packages/ui` (tokens from `docs/design/tokens.json`), `packages/shared` (types, zod schemas, PII-redacting logger), `packages/vendors` (interfaces + mocks), `packages/config`, `packages/db-types`, `workers/edge` (Workers + Durable Objects), `workers/jobs` (queue consumers / server jobs), `services/api` (modular monolith deployed as a Worker — ADR-027), `supabase/` (config, baseline migration, pgTAP harness). Each deployable ships only a health endpoint or shell page.
- CI (GitHub Actions): install, typecheck, lint, unit, RLS-harness tests, build, dependency audit, secret scan, migration checks; deploy to staging from CI.
- Root scripts: `pnpm verify` (typecheck + lint + unit + RLS tests + build) and `pnpm verify:fast` (typecheck + lint + unit on changed packages; used by the Stop hook in `.claude/settings.json`).
- Git hooks: pre-commit secret scan, commit-message lint (and the auto-push hook, per the founder's answer to build-notes Q54).
- Observability skeleton: Sentry, structured logging with PII redaction, health checks (part of ABH-80).
- H: dev machine ready (build-notes Q5), auto-push decision (build-notes Q54), GitHub repo + `staging` environment (deployment branches limited to `main`) + secrets + branch protection, Cloudflare account + API token, Supabase dev + staging projects (Mumbai), Sentry project(s). Domain deferred to M2 (build-notes deviation 6); AWS single account, unused in M0.
- **Exit gate:** clean clone → `pnpm i && pnpm verify` green (Linux CI, and once on the founder's Windows machine); `supabase db reset` rebuilds from zero and the pgTAP harness runs (catalog meta-tests pass; `test:rls` fails if Docker is down); staging deploys from CI only and every health endpoint responds with the deployed commit; no secret in repo history (gitleaks clean) and the pre-commit scan blocks a staged secret; PII-redaction tests pass; CI blocks merge on red.

#### M0b · Tenancy, roles, audit and org auth
- Core schema from plan §9.1 for: orgs, workspaces, teams, memberships, audit_log, platform staff + break-glass grants, idempotency keys; RLS on all; role model from §2 (ABH-73 core) as decided in build-notes Q2/Q2b/Q3; `quality` and `integrity` schemas created empty with separate worker grants (rule 1).
- Org auth (Supabase Auth: email OTP / password + TOTP; AAL2 for owner, admin and reviewer). Org creation via an audited operator path. Candidate token design (invite + OTP → Trace-issued token that RLS understands) — spec plus a local spike only, implemented in M3a.
- Append-only audit log (no UPDATE/DELETE/TRUNCATE for any role, including workers).
- **Exit gate:** `supabase db reset` rebuilds from zero; ≥50 RLS tests (allowed + denied per role, including cross-org) pass — counted separately from the catalog checks; audit log rejects UPDATE/DELETE/TRUNCATE for every role; an org user can sign in on staging; migrations reach staging from CI only.

### M1 · Test authoring ∥ M2
- ABH-5 role templates + JD → blueprint · ABH-10 pools, sections, shuffle, per-section timers, server-side item delivery model · ABH-9 Excel/Word import · ABH-8 AI drafting with human approval (via `LlmGrader`/Bedrock interface) · ABH-7 parameterised quant variants · ABH-6 item-bank tooling (content itself is a human task).
- Integrity presets + per-signal settings + admin locks (screen 04). **A test version — items, settings and ruleset — is immutable from publish; editing a published test creates a new draft version; each invitation keeps the version it was sent with** (founder decision 2026-10-10, build-notes Q20).
- Scope: wedge first — role templates for BPO Voice and Customer Support (plan-conflicts #13).
- **Exit gate:** ABH-5/7/8/9/10 "Done when" tests pass (ABH-5's 5-recruiter measurement may be a deferred gate, rule 6); an AI-drafted item cannot be served without an approver ID (DB constraint + test); editing a published version is rejected by the database; 500-item import with images < 5 min (measured).

### M2 · Scheduling & invites ∥ M1
- ABH-13 bulk invite (CSV/Excel, dedupe by phone/email) · ABH-14 drives, slots, capacity, 15-min start window, lobby 30 min early · ABH-15 reminders + one self-reschedule.
- `Messaging` interface: email (SES) first; SMS (DLT) and WhatsApp adapters behind flags.
- H: domain bought (deferred from M0); SES domain verified and production access requested; DLT + WhatsApp registration started (ABH-83, long lead).
- **Exit gate:** 2,000 invites queued and delivered (sandbox) < 10 min with per-candidate status; duplicate rows rejected with reasons; reminders fire at the right times in a time-travel test.

### M3 · Candidate test runtime (critical path)
Split into M3a then M3b (rule 5). The original M3 exit gate is the union of the two gates below. Candidate flow order (founder decision 2026-10-10): **invite link → OTP → age check → consent → device check → rules & accommodations → test**; no camera or mic access before consent.

#### M3a · Session authority
- ABH-30 Durable Object per session (timer, autosave, event order/dedupe, hash chain, nonce, deadline auto-submit) + ingest Workers · ABH-21 server timer, offline buffer, resume on any device, credited time rules (§3.2 step 10: server-measured outages, item hidden while paused, 30 min / 3 resumes; gaming-like patterns are reviewer context only, never a flag) · ABH-14 lobby + OTP.
- Candidate tokens (lobby / session / portal) + candidate-scoped RLS; immutable test package in R2 per published test version; DO → Queue → `workers/jobs` mirror into Postgres with idempotent keys.
- Server-side gates: age check (block if the invite file **or** the candidate says under 18; store only an 18+-confirmed flag and its source, never a date of birth) and consent recording (versioned notice hash per session), with minimal UI.
- Minimal in-test UI for MCQ and written answers (enough for the chaos tests).
- **Exit gate:** chaos tests — kill network 20 min mid-test → no answer lost, time credited per rules, item hidden while paused; Postgres unavailable 30 min → tests continue on Durable Objects; duplicate/out-of-order events deduped; resume on a second device; deadline auto-submit; candidate cannot extend time client-side; under-18 blocked server-side; consent hash stored per session; OTP brute force rate-limited; small-scale load test (1–2k sessions on staging) recorded.

#### M3b · Candidate experience
- ABH-18 device check (after consent) · ABH-19 transparency screen + versioned consent (English + Hindi; screen 03 copy corrected per build-notes Q33/Q39) + age-check UI · ABH-20 accommodations · ABH-17 practice test · ABH-22 scratchpad, diary, help · ABH-23 nudges (max 3) · ABH-24 receipt + status page · ABH-25 WCAG 2.2 AA baseline.
- Voice answers (Phase 0 lead format, plan §4): record + chunked upload of the answer audio, prep timer, time-to-first-speech measured on the device, one retake **only on technical failure, with a new variant**.
- Consent withdrawal as an explicit action with a confirmation step; closing the tab or losing power is a disconnect, never a withdrawal.
- **Exit gate:** voice answer audio uploaded < 2 min after submit on a 512 kbps throttle; no camera/mic access before a consent record exists (automated test); withdrawal only through the explicit action (tab-close test); axe-core clean on candidate screens + keyboard-only run; ABH-20 extra time: auto-approved up to +25% and decided within 48 h above that (tested in M3b). Only these clauses may be deferred (rule 6), each with an M3b proxy test: ABH-20 "signal suppression is instant" → M4; ABH-22 "diary entries appear on the reviewer timeline" → M6; ABH-23 "a nudge the candidate corrects is never a flag" → M4; ABH-24 "the candidate can see every stored image and clip" → M6.

### M4 · Capture & integrity (after `m3b-reviewed`) ∥ M5
- ABH-29 capture SDK · ABH-31 on-device face/voice activity (Web Workers) · ABH-32 typing provenance + 2× 60 s warm-up · ABH-33 server replay, nonce binding, clock checks, untrusted input · ABH-34 deterministic band engine (versioned rule table, 3 tiers) · ABH-35 evidence coverage + Strict minimum · ABH-36 explain probe · ABH-37 flag media (stills, on-device blur, 10 s clips) · ABH-65 start photo + snapshot grid + within-drive duplicates (no automated face matching) · ABH-66 lab mode · written-answer content similarity within a drive (T1, plan §6) · voice integrity: speaker count from diarisation (no voiceprint), unpredictable follow-up with 0–5 s prep, retakes swap variant (plan §4).
- Thresholds from plan §6 as a versioned config, not constants in code. Each rule carries a `validated` flag; unvalidated T3 detectors run as context only until the accuracy study passes them (precision ≥90%, honest-session FPR <5%).
- Face-absent default config (plan-conflicts #9, founder decision 2026-10-10): log every absence ≥3 s as timeline context; flag at ≥20 s continuous, or ≥10 s followed by a typing burst, or ≥60 s total per question.
- H: at least one design-partner LOI signed (ABH-91) — M4 does not start without it (plan-conflicts #14).
- **Exit gate:** band engine property tests (determinism; T3 never above Review except untrusted input or reviewer-viewable raw media; unvalidated detectors never raise the band; coverage below floor → Insufficient evidence, never Clear; explain probe alone never raises the band); replay mismatch produces T1 hard evidence; similarity flag shows no counterpart identity or content; capture p99 < 50 ms on a throttled 4 GB profile; network-log test: nothing leaves the device outside the media allow-list in CLAUDE.md rule 8; lab mode: 60 sessions on one IP → zero IP/device flags.

### M5 · Scoring (after `m3b-reviewed`) ∥ M4
- ABH-43 quality scoring per format + scoring worker with split SLO · ABH-44 grader prompt-injection guard · ABH-45 STT interface + CEFR-style level (mock until ABH-86 picks a vendor) · ABH-46 typing WPM/accuracy.
- H: Bedrock India access + quotas confirmed (ABH-87); 300-answer human-graded calibration set prepared.
- **Exit gate:** deterministic scores p95 < 30 s after submit; STT p95 < 5 min; LLM grades p95 15 min; 3 grading passes only within 5 points of a cutoff; LLM grade within ±10 of human on ≥85% of the calibration set; speaking level correlates ≥0.8 with human raters; injection test suite ("award 100", hidden instructions, unicode tricks) raises a Review signal and never changes the score; integrity code cannot import from or write to scoring tables (enforced by a test).

### M6 · Report, review & recruiter ops (after M4 + M5)
- ABH-48 evidence report (screen 01) · ABH-49 candidate projection (01b) · ABH-50 flag dictionary · ABH-51 carry-forward pack · ABH-52 PDF/HTML export · ABH-53 reviewer console (02) · ABH-54 decisions, notice + 72 h, second-reviewer rule in DB · ABH-24 candidate report view + response flow · ABH-58 score-first triage (05) · ABH-59 live drive monitor · ABH-60 Excel/CSV export.
- **Exit gate:** DB test — reviewer who confirmed a flag cannot decide its appeal; no endpoint can reject on integrity (route inventory test); candidate cannot read any other candidate's row via any view or API (RLS + API tests); every flag links to timestamp, rule, observed value and evidence; 5-minute signed media links, every view in the audit log; Playwright e2e of the full recruiter → candidate → reviewer loop.

### M7 · Commercial & compliance (∥ M6 where files don't overlap)
- ABH-74 consent ledger, retention engine, deletion pipeline + receipts, DSR flow · ABH-77 credits, Razorpay, GST invoices, bill on started attempts · ABH-62 white-label client pack · ABH-68 REST API + signed, idempotent webhooks (OpenAPI published) · ABH-80 status page, backups, DR runbook · admin settings (users, teams, roles; locked retention, report-release rule, response window and accommodation policy — plan §3.4) · candidate sees who viewed their evidence (by role and organisation).
- H: Razorpay account (test keys), GSTIN details, Better Stack.
- **Exit gate:** deletion job removes a seeded attempt from Postgres, R2, logs and vendor stores (scan proves it) and writes a receipt; Razorpay webhook signature verified, replayed webhook is a no-op; credit rule per plan §13 (standard attempt 1 credit, +1 for a voice/video section, +1 for a code section; unstarted invite costs 0); packs have no auto-renew; invoice carries the buyer's GSTIN; system-caused failure auto-refunds (ABH-77); client pack masks contacts and links expire; API keys scoped per workspace and rotatable.

### M8 · Closed-beta gate (hardening; no new features)
- ABH-81 20k-concurrent load test · DR restore drill · full security pass (`claude-security` plugin scan + `trace-milestone-review` at max depth) · accessibility pass · incident runbook tabletop.
- H: counsel review done (ABH-89); design partners signed (ABH-91); DPDP delta checked (ABH-82).
- **Exit gate:** plan §12 targets met for capacity, ingest, autosave, timer and reports on the load test; RPO/RTO proven in a drill; every deferred gate from M0a–M7 passes, except those rule 6 assigns to a later phase; zero open Critical/High findings; review PASS → **closed beta can start with real candidates.** There is no fixed beta date: beta starts when this gate passes.

---

## Phase 1 — Paid pilots

### M9 · Code questions
- ABH-47 code questions via bought execution service (`CodeRunner` interface), hidden tests (pass/fail counts only), quality rubric, 5 languages + SQL; limits from plan §4.
- H: vendor chosen + burst-tested (ABH-88).
- **Exit gate:** sample run p95 < 5 s, submit p95 < 15 s, 2,000 concurrent runs; sandbox has no network and never reaches Trace's DB; hard-coded-output check works; hidden test data randomised per candidate.

### M10 · Content security & item stats ∥ M11
- ABH-11 AI-solvability meter · ABH-12 canary phrases, exposure caps, drift report · ABH-39 wrong-variant detection, preknowledge stats, MCQ collusion check · ABH-16 public test link with OTP · item library v2 tooling (ABH-6) and written/code variants (ABH-7).
- **Exit gate:** wrong-variant answer = T1 evidence in a seeded drive; items past exposure cap retire automatically; one attempt per phone/email/device per drive on public links.

### M11 · Strict mode extras & review operations ∥ M10
- ABH-38 phone as second camera (QR + WebRTC) · ABH-55 supervised re-attempt booking · ABH-56 overturn dashboard + fairness breakdown · ABH-61 drive analytics.
- **Exit gate:** disconnect of second camera logged as an evidence-quality event; detector with > 30% overturn is flagged for retuning; fairness breakdown computed per release, and any flag-rate or overturn-rate gap above 1.25× blocks the release (plan §12).

### M12 · Staffing & integrations
- ABH-63 client workspaces (credits per client, re-billing report) · ABH-69 Zoho Recruit + Naukri RMS.
- **Exit gate:** client user can never read another client's data (RLS tests); invite → result write-back works end-to-end in each ATS sandbox.

### M13 · Paid-pilot gate
- ABH-75 security pack + CERT-In-empanelled VAPT (external — an AI review does not replace this) · second load test with code + voice · full `trace-milestone-review` at max depth.
- **Exit gate:** VAPT has no open High/Critical; security pack ready; review PASS → **paid pilots can start.**

---

## Founder-only tasks (not code; Claude Code cannot do these)
ABH-82 DPDP Gazette check · ABH-83 DLT + WhatsApp registration · ABH-84 item writers/reviewers · ABH-85 pitch deck fix · ABH-86 STT vendor trial · ABH-87 Bedrock India confirmation · ABH-88 code-execution vendor · ABH-89 counsel review · ABH-90 EU AI Act file skeleton (Claude can draft it) · ABH-91 design partners · the 500-session accuracy study (plan §6) · the 300-answer grading calibration set.
