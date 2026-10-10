# Build order — Phase 0 + Phase 1

Scope of this build: every Phase 0 and Phase 1 feature in `docs/plan.md` §5. Phase 2–3 features are out of scope; do not start them.
Issue IDs (ABH-n) refer to the Linear project "Trace v1 — Launch". Each issue has a "Done when" line; that line plus the exit gate below is the definition of done.

**Rules for every milestone**
1. Start in plan mode. Write or refresh `specs/<module>.md` for each module touched, get the founder's OK, then implement.
2. Each milestone runs on branch `milestone/m<N>` and merges to `main` by PR. Parallel work only where marked ∥, each stream in its own git worktree, each owning separate directories. Max 4 parallel writers.
3. A milestone closes only when: all its issues meet "Done when", `pnpm verify` is green in CI, the exit gate passes, and the `trace-milestone-review` skill returns PASS — or PASS WITH CONDITIONS, where every Medium finding has an owner milestone and is fixed before that milestone's review. Then tag `m<N>-reviewed`. M8 and M13 require a clean PASS.
4. Human prerequisites (H) must be done by the founder before the milestone starts. Where a vendor is not chosen, build the interface + mock and leave the real adapter for later.

---

## Phase 0 — Foundation + closed beta

### M0 · Foundations (sequential — everything depends on it)
- Monorepo (pnpm workspaces): `apps/candidate`, `apps/recruiter`, `packages/ui` (tokens from `docs/design/tokens.json`), `packages/shared` (types, zod schemas), `workers/edge` (Workers + Durable Objects), `services/api` (Node modular monolith), `supabase/` (migrations, seed, tests).
- CI (GitHub Actions): install, typecheck, lint, unit, RLS tests, build, dependency audit, secret scan; preview deploy to staging.
- Root scripts: `pnpm verify` (typecheck + lint + unit + RLS tests + build) and `pnpm verify:fast` (typecheck + lint + unit on changed packages; used by the Stop hook in `.claude/settings.json`).
- Core schema from plan §9.1 for: orgs, workspaces, memberships, audit_log; RLS on all; role model from §2 (ABH-73 core).
- Org auth (Supabase Auth: OTP / password + 2FA). Candidate token design (invite + OTP → Trace-issued JWT that RLS understands) — spec only, implemented in M3.
- Append-only audit log (no UPDATE/DELETE grant for any app role).
- Observability skeleton: Sentry, structured logging with PII redaction, health checks (part of ABH-80).
- H: GitHub repo, Cloudflare account, Supabase dev + staging projects (Mumbai), AWS dev account, Sentry project, domain.
- **Exit gate:** clean clone → `pnpm i && pnpm verify` green; `supabase db reset` rebuilds from zero; ≥50 RLS tests (allowed + denied per role) pass; staging deploys from CI; no secret in repo history (gitleaks clean).

### M1 · Test authoring ∥ M2
- ABH-5 role templates + JD → blueprint · ABH-10 pools, sections, shuffle, per-section timers, server-side item delivery model · ABH-9 Excel/Word import · ABH-8 AI drafting with human approval (via `LlmGrader`/Bedrock interface) · ABH-7 parameterised quant variants · ABH-6 item-bank tooling (content itself is a human task).
- Integrity presets + per-signal settings + admin locks + ruleset freeze at first start (screen 04).
- **Exit gate:** ABH-5/7/8/9/10 "Done when" tests pass; an AI-drafted item cannot be served without an approver ID (DB constraint + test); 500-item import with images < 5 min (measured).

### M2 · Scheduling & invites ∥ M1
- ABH-13 bulk invite (CSV/Excel, dedupe by phone/email) · ABH-14 drives, slots, capacity, 15-min start window, lobby 30 min early · ABH-15 reminders + one self-reschedule.
- `Messaging` interface: email (SES) first; SMS (DLT) and WhatsApp adapters behind flags.
- H: SES domain verified; DLT + WhatsApp registration started (ABH-83, long lead).
- **Exit gate:** 2,000 invites queued and delivered (sandbox) < 10 min with per-candidate status; duplicate rows rejected with reasons; reminders fire at the right times in a time-travel test.

### M3 · Candidate test runtime (critical path)
- ABH-30 Durable Object per session (timer, autosave, event order/dedupe, hash chain, nonce, deadline auto-submit) + ingest Workers · ABH-21 server timer, offline buffer, resume on any device, credited time rules (§3.2 step 10) · ABH-18 device check · ABH-19 transparency screen + versioned consent (English + Hindi) + age gate · ABH-20 accommodations · ABH-17 practice test · ABH-22 scratchpad, diary, help · ABH-23 nudges (max 3) · ABH-24 receipt + status page · ABH-25 WCAG 2.2 AA baseline · ABH-14 lobby + OTP.
- Voice answers (Phase 0 lead format, plan §4): record + chunked upload of the answer audio, prep timer, time-to-first-speech measured on the device, one retake on technical failure with a new variant.
- Candidate token + candidate-scoped RLS.
- **Exit gate:** voice answer audio uploaded < 2 min after submit on a 512 kbps throttle; chaos tests — kill network 20 min mid-test → no answer lost, time credited per rules; Postgres unavailable 30 min → tests continue on Durable Objects; duplicate/out-of-order events deduped; deadline auto-submit; under-18 blocked; consent hash stored per session; axe-core clean on candidate screens + keyboard-only run.

### M4 · Capture & integrity (after M3) ∥ M5
- ABH-29 capture SDK · ABH-31 on-device face/voice activity (Web Workers) · ABH-32 typing provenance + 2× 60 s warm-up · ABH-33 server replay, nonce binding, clock checks, untrusted input · ABH-34 deterministic band engine (versioned rule table, 3 tiers) · ABH-35 evidence coverage + Strict minimum · ABH-36 explain probe · ABH-37 flag media (stills, on-device blur, 10 s clips) · ABH-65 start photo + snapshot grid + within-drive duplicates (no automated face matching) · ABH-66 lab mode · written-answer content similarity within a drive (T1, plan §6) · voice integrity: speaker count from diarisation (no voiceprint), unpredictable follow-up with 0–5 s prep, retakes swap variant (plan §4).
- Thresholds from plan §6 as a versioned config, not constants in code. Each rule carries a `validated` flag; unvalidated T3 detectors run as context only until the accuracy study passes them (precision ≥90%, honest-session FPR <5%).
- **Exit gate:** band engine property tests (determinism; T3 never above Review except untrusted input or reviewer-viewable raw media; unvalidated detectors never raise the band; coverage below floor → Insufficient evidence, never Clear; explain probe alone never raises the band); replay mismatch produces T1 hard evidence; similarity flag shows no counterpart identity or content; capture p99 < 50 ms on a throttled 4 GB profile; network-log test: nothing leaves the device outside the media allow-list in CLAUDE.md rule 8; lab mode: 60 sessions on one IP → zero IP/device flags.

### M5 · Scoring (after M3) ∥ M4
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
- **Exit gate:** plan §12 targets met for capacity, ingest, autosave, timer and reports on the load test; RPO/RTO proven in a drill; zero open Critical/High findings; review PASS → **closed beta can start with real candidates.**

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
