---
name: trace-milestone-review
description: Use after each Trace build milestone (M0–M13) to run the gated quality, product-rule, security and DPDP privacy review of the Trace repo and write a PASS / BLOCK report with evidence.
---

# Trace milestone review

An independent, evidence-based gate run after every milestone in `docs/build-order.md`. It decides whether the milestone may be tagged `m<N>-reviewed`. It is read-only: it finds and proves problems; it does not fix them.

Run it in a session that did **not** write the code under review.

## 0. Ground rules
- **Read-only.** Do not edit source, push, merge, deploy or change settings. The only file you write is the report.
- **Never touch production.** Use local, dev or staging only. Never read real `.env` values or ask for secrets. Use synthetic data.
- **Evidence or it didn't happen.** Every finding needs `file:line` and either a command output, a failing test you wrote in a scratch location, or a concrete input → wrong output scenario. Every "clean" claim needs the command or file you checked.
- **Never claim a check you did not run.** If a gate cannot run (missing script, no Docker, no network), record it as **NOT RUN** with the reason. A milestone with a mandatory gate NOT RUN cannot PASS.
- **An AI review is not a penetration test.** At M8 and M13 always state that the external CERT-In-empanelled VAPT (ABH-75) is still required before paid pilots.

### Two modes
- **Primary mode** (Claude Code on the build machine, fresh session): run every gate in section 2 yourself.
- **Second-opinion mode** (Cowork / claude.ai, or any environment without Docker, browsers or load tools): re-run every gate you can (install, typecheck, lint, unit tests, secret scan, audit, greps). For gates you cannot run (G5 DB, G7 e2e, G13 a11y, G14 load), use evidence from the CI run (`gh run view <id> --log`, downloaded artifacts) or from the primary review's report, and label each one **EVIDENCE: CI run <id>** or **EVIDENCE: primary review** in the gates table. Re-check every code-level item (sections 3–4) yourself; never copy a finding or a "clean" from the primary review without re-verifying it. A gate with neither a local run nor CI/primary evidence is NOT RUN.

## 1. Inputs and setup
1. Identify milestone `N` (ask if not given) and read its section in `docs/build-order.md` (scope, issues, exit gate).
2. Get the repo:
   - In Claude Code: the current working directory.
   - In Cowork / claude.ai: use the connected folder, a zip the founder attached (unzip into a fresh empty directory), or a read-only clone (`gh repo clone <owner>/trace` with the founder's read-only access). If none is available, stop and ask for one — do not review from memory or screenshots.
3. Read `CLAUDE.md`, `docs/plan-conflicts.md`, `docs/adr/README.md`, the plan sections referenced by milestone `N`, and every `specs/*.md` touched in the diff.
4. Scope the diff:
   Each milestone lives on branch `milestone/m<N>`. Use the merge-base with `main`, so parallel siblings (M1∥M2, M4∥M5, M10∥M11) don't pollute or hide each other's work. Accept an explicit BASE if the founder gives one.
   ```bash
   HEAD_REF=milestone/m<N>            # or HEAD if already merged; then use the PR list for M<N>
   BASE=$(git merge-base main "$HEAD_REF" 2>/dev/null || git rev-list --max-parents=0 HEAD)
   git log --oneline "$BASE".."$HEAD_REF" | wc -l
   git diff --stat "$BASE".."$HEAD_REF"
   git diff --name-only "$BASE".."$HEAD_REF" > /tmp/trace-review-files.txt
   ```
   Review the diff in depth **and** re-run the universal checks (section 3) on the whole repo — earlier milestones can regress.

## 2. Mechanical gates (run every one; record command, exit code, key output)
| # | Gate | Command (adapt names to the repo's scripts) | Mandatory |
| --- | --- | --- | --- |
| G1 | Clean install | `pnpm install --frozen-lockfile` | Yes |
| G2 | Typecheck (strict) | `pnpm -r typecheck` (or `tsc --noEmit -p .`) | Yes |
| G3 | Lint | `pnpm -r lint` | Yes |
| G4 | Unit + integration tests | `pnpm -r test` | Yes |
| G5 | DB from zero + RLS tests | `supabase start && supabase db reset && supabase test db` (or the repo's pgTAP runner) | Yes from M0 |
| G6 | Build all apps/workers | `pnpm -r build` | Yes |
| G7 | E2E (Playwright) | `pnpm e2e` against local/staging | Yes from M3 |
| G8 | Dependency audit | `pnpm audit --prod --audit-level=high` (and `osv-scanner -r .` if available) | Yes |
| G9 | Secret scan (full history) | `gitleaks detect --source . --redact` (or `trufflehog git file://.`) | Yes |
| G10 | Skipped / focused tests | see commands below | Yes (any hit in scope = finding) |
| G11 | Type escape hatches | see commands below (compare count with last review) | Trend |
| G12 | Coverage on critical modules | coverage report for band engine, timers/session DO, scoring, billing, RLS — target ≥ 90% lines on those modules | From M3 |
| G13 | Accessibility | `axe` / Playwright-axe on candidate screens; keyboard-only run | From M3 |
| G14 | Load / performance evidence | the milestone's measured numbers vs plan §12 (k6/Artillery report, Playwright traces) | M3, M4, M5, M8, M9, M13 |

```bash
# G10 — skipped or focused tests (TS/JS and SQL/pgTAP)
grep -rnE '\.(skip|only)\(|\bxit\(|\bxdescribe\(|test\.todo|\bSKIP\b' \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.sql' . | grep -v node_modules
# G11 — type escape hatches
grep -rnE ': any\b|as any|@ts-ignore|@ts-expect-error|eslint-disable' apps packages workers services | wc -l
```

Any mandatory gate failing → **BLOCK**. Any mandatory gate NOT RUN → verdict cannot be PASS (use **INCOMPLETE**).

## 3. Universal checks (every milestone, whole repo)

### A. Product rules (CLAUDE.md 1–9 and plan details) — any violation is Critical
| ID | Rule | How to verify |
| --- | --- | --- |
| R1 | Quality and integrity never blended | grep for any expression that combines the quality score with the band or integrity data; confirm no single "overall/honesty/trust score" field in schema, API types or UI; integrity tables have no write path to `scores` (FKs, triggers, services); a test asserts this |
| R2 | No automatic rejection | inventory every route, job, webhook, bulk action and DB function that changes candidate status; none sets a reject/fail outcome from integrity data; bulk reject accepts only an Answer Quality cutoff; only `confirmed` flags reach decision screens |
| R3 | Deterministic, versioned band engine | band function is pure (no clock, random, network); ruleset version stored on every report; ruleset immutable after `locked_at`; property tests: same input → same band; T3 never exceeds Review except untrusted input or reviewer-viewable raw media; rules with `validated = false` never raise the band; explain probe alone never raises the band; coverage below floor → Insufficient evidence, never Clear, and the reason shown never names a condition |
| R4 | Notice + 72 h + second reviewer | DB constraint/trigger prevents the confirming reviewer deciding the appeal; decision cannot finalise before response or 72 h; test exists for both |
| R5 | Same report, safe projection | candidate reads only `report_candidate_view` (or equivalent) with `security_invoker`; similarity flags never expose the other candidate's content/identity/device/IP; API tests with a second candidate's token return nothing |
| R6 | Score-first triage | flags on non-shortlisted candidates become `not_used` and are not appealable; review queue contains only shortlisted Review/Strong concern |
| R7 | Never-build list | no emotion/stress/personality inference, no AI-likeness shown, gaze never a flag, no face/voice templates outside the identity add-on, IP/ASN never a flag in India; lab mode suppresses IP/device flags |
| R8 | Media leaves the device only on the allow-list | network-log test: only start photo, snapshot-grid stills, server-requested stills, voice/video answer recordings and flag-event stills/clips are uploaded — no continuous frames or ambient audio; on-device blur applied before upload; signed URLs ≤ 5 min with viewer watermark; every media view audited; Client Viewer has no media access |
| R9 | Under-18 blocked | enforced server-side at session start, not only in the UI |
| R10 | Candidate never sees rank, percentile, exact thresholds or a counterpart's answer | candidate API/view responses contain none of these fields; exact thresholds only to recruiters, appellants and instructions for use (ADR-026) |
| R11 | Percentiles | recruiter-only; exclude extra-time/accommodation candidates; shown only for cohorts ≥ 20 |
| R12 | Keystroke data | used only to judge how an answer was produced; no cross-session typist identification; no cross-tenant matching (ADR-025) |
| R13 | Voice and audio rules | no lip-sync, gaze-while-speaking or reading-aloud flags (ADR-011); mic off outside voice questions in Standard, context only in Strict (ADR-009); speaker count is diarisation only, no voiceprint |
| R14 | Nudges | a nudge the candidate corrects never becomes a flag; max 3 per test |
| R15 | Recruiter override | rejecting on non-integrity grounds while a response window is open requires a logged reason |

### B. Security
| ID | Check |
| --- | --- |
| S1 | RLS enabled on every table (query `pg_tables` / `pg_class.relrowsecurity`); per-operation policies with `WITH CHECK`; no `USING (true)` on tenant data; RLS predicate columns indexed |
| S2 | RLS test matrix: for each table × each of the 8 roles (plan §2) at least one allowed and one denied case; cross-org and cross-candidate denial proven |
| S3 | Service-role key never in `apps/*`, browser bundles (`grep` built JS for the key name and JWT `service_role`), or candidate-facing Workers/DOs |
| S4 | Candidate token: short-lived (test duration + 1 h), bound to session and nonce, verified on every edge request; no IDOR — ids from URL/body re-checked against token claims |
| S5 | Org auth: 2FA available, OTP rate limits, session expiry; role checks enforced server-side, not only hidden in UI |
| S6 | Edge/Workers/DO: zod (or equivalent) validation on every input; upload size/type limits; per-IP/per-token rate limits on OTP and start; strict CORS; CSP + security headers on Pages |
| S7 | Webhooks/payments: Razorpay HMAC verified with constant-time compare **before** parsing; idempotency by event id; prices/credits computed server-side; outbound webhooks signed with timestamp |
| S8 | LLM: candidate text delimited as data; output schema-validated; injection detector present and tested; no identity or other candidates in prompts; prompts not logged with PII |
| S9 | Secrets: none in repo or history (G9); least-privilege tokens; no prod credentials reachable from dev tooling or CI PR jobs |
| S10 | Supply chain: lockfile committed; no curl-pipe-to-shell installs; new dependencies justified; no unexpected `postinstall` |
| S11 | Error handling: no stack traces or internal ids leaked to clients; generic errors to candidates |
| S12 | Audit log append-only (no UPDATE/DELETE grants to any app role); every evidence view and decision written; candidates can see who viewed their evidence (role + org) |
| S13 | Trust & Safety / staff access is break-glass only: ticket required, ≤ 4 h, visible to the tenant, audited |
| S14 | Local answer buffer encrypted with an in-memory session key and wiped on submit (shared lab machines) |
| S15 | Event hash chain per session in the DO; daily root hashes written to a locked (object-lock) bucket; tamper test exists |
| S16 | Client Viewer / Hiring Manager: contacts masked, links expire, no media, no other candidates |

### C. Privacy and DPDP
| ID | Check |
| --- | --- |
| P1 | No PII in logs, Sentry events/breadcrumbs, PostHog, queue payloads beyond ids, error messages, seeds or fixtures (grep logs/fixtures for phone/email/name patterns; confirm Sentry `beforeSend` scrubbing) |
| P2 | Consent: notice version hash, language, timestamp stored per session; withdrawal path deletes data; English + Hindi copy present |
| P3 | Retention: media 30 days after decision, event logs 12 months, decisions/audit 12 months; legal hold while an appeal is open; jobs exist and are tested |
| P4 | Deletion reaches Postgres, R2, logs, queues and vendor stores; deletion receipt written; ≤ 30 days including backups documented |
| P5 | Sensitive fields (contact, accommodations, identity results) encrypted; recruiter sees "accommodation applied" only, never the reason |
| P6 | Candidate can see every stored image/clip of themselves and download their data |
| P7 | Data residency stated honestly (DB/compute Mumbai; R2 is APAC, not India-only); LLM calls go to the India inference region configured |
| P8 | No training on customer data; PostHog only in recruiter app |

### D. Reliability and correctness
| ID | Check |
| --- | --- |
| C1 | Server holds the truth: timer, served items, final answer rebuilt from edit events, code runs |
| C2 | Exactly-once results: sequence numbers + high-water mark in the session DO; deterministic storage keys; jobs keyed by session + job + ruleset; retry tests prove no double counting/billing |
| C3 | Database outage: tests keep running on DOs for 30+ min (chaos test exists for M3+) |
| C4 | Disconnects: < 2 min timer runs + local buffer; > 2 min pause; 30 min / 3 resumes credited; gaps labelled "Connectivity" |
| C5 | Versioning: rulesets, rubrics, notices, items, models recorded on each report |
| C6 | Timeouts, retries with backoff and dead-letter queues on every external call (Bedrock, STT, code runner, messaging, Razorpay) |
| C7 | Vendors behind interfaces with mocks; real adapters isolated |
| C8 | Migrations reproducible from zero; rollback/forward-fix plan for each destructive migration |
| C9 | Report released after review or after 7 days, whichever first |
| C10 | Late evidence creates a new report version with a notice, never silently edits a released report |
| C11 | Answers accepted until deadline + 60 s when the event sequence is unbroken; offline buffer ≥ 10 min |
| C12 | LLM grading: one pass by default, 3 passes only within 5 points of a cutoff; grader never sees name or other candidates |

### E. Code and test health
| ID | Check |
| --- | --- |
| H1 | Every "Done when" line and exit-gate item for milestone N has a real automated test or a recorded measurement — list them one by one with the test name |
| H2 | Tests assert behaviour (not just that mocks were called); no tests weakened, deleted or skipped in the diff (`git diff $BASE..HEAD -- '*test*'` reviewed) |
| H3 | No TODO/FIXME/HACK in auth, RLS, billing, scoring, band engine, deletion paths |
| H4 | Code matches `specs/*.md`; deviations are documented in the spec or an ADR |
| H5 | ADRs respected (`docs/adr/`); no new framework/DB/vendor without a new ADR |
| H6 | Docs updated: `docs/milestones/M<N>-summary.md` exists with deferred items and known limits |

## 4. Milestone-specific checkpoints
Verify the exit gate in `docs/build-order.md` for milestone N **plus** these attack tests:

- **M0 Foundations:** clean clone builds; `supabase db reset` from zero; ≥ 50 RLS tests incl. cross-org denial; audit log append-only; CI blocks merge on red; branch protection on; no secrets in history; staging deploy from CI only.
- **M1 Authoring:** AI-drafted item cannot be served without `approved_by` (DB-level); import rejects malformed rows with per-row errors and survives a 500-item file; ruleset/preset locks at first candidate start and admin locks cannot be bypassed via API; items never shipped to the client before they are served (server-side delivery).
- **M2 Invites:** dedupe by phone/email; invite tokens unguessable and single-purpose; messaging adapters rate-limited and retried; no PII in message logs; reminders correct across time zones (IST).
- **M3 Runtime:** the chaos tests (20-min network loss, 30-min DB outage, duplicate/out-of-order events, deadline auto-submit, resume on second device); voice answer audio uploaded < 2 min after submit on 512 kbps; candidate cannot extend time client-side; consent hash per session; under-18 blocked server-side; OTP brute force rate-limited; axe clean + keyboard-only pass.
- **M4 Integrity:** band engine property tests; T3 cap with its two exceptions; `validated` flag per rule with unvalidated detectors context-only; written-answer similarity within a drive (T1) shows no counterpart data; voice integrity (diarisation speaker count, unpredictable follow-ups, retakes swap variant); Insufficient evidence on low coverage; replay mismatch → T1; untrusted input → hard evidence; accommodations suppress the right signals and swap in an alternative control; thresholds come from versioned config; nothing outside the media allow-list leaves the device; lab mode zero IP flags; no automated face matching.
- **M5 Scoring:** calibration result (±10 on ≥ 85% of 300 answers) recorded with model + rubric versions; speaking level ≥ 0.8 correlation with human raters; STT p95 < 5 min and LLM p95 15 min measured; injection suite (direct instructions, role-play, unicode/zero-width, markdown/JSON breaking, "ignore previous") raises Review and never moves the score; integrity cannot write to scores; split SLO measured; Bedrock region is India.
- **M6 Report & review:** route inventory proves no integrity auto-reject; second-reviewer DB rule; candidate projection leak tests with two candidates in one drive (similarity flag shows no counterpart data); signed media ≤ 5 min + audited; PDF export matches online report; full e2e loop recruiter → candidate → reviewer.
- **M7 Commercial & compliance:** deletion scan across all stores + receipt; client pack (ABH-62) masks contacts, links expire, access logged, Client Viewer gets no media; admin locked defaults cannot be overridden by lower roles; Razorpay signature + replay no-op; credits charged only on started attempts (+1 voice/video, +1 code), auto-refund on system failure; no auto-renew; invoice carries buyer GSTIN; webhook signing + idempotency; API keys scoped per workspace and rotatable; DR runbook exists.
- **M8 Beta gate:** plan §12 targets met on the 20k load test (report attached); restore drill RPO/RTO proven; `claude-security` scan run and triaged; zero open Critical/High; incident runbook rehearsed; counsel review (ABH-89) done — if any is missing, verdict cannot be PASS.
- **M9 Code:** sandbox has no network and no route to Trace's DB; resource caps enforced; hidden tests never sent to the client; hard-coded-output detection; p95 targets measured.
- **M10 Content security:** wrong-variant → T1; exposure caps retire items; public links enforce one attempt per phone/email/device; canary phrases detected.
- **M11 Strict & review ops:** second-camera pairing token single-use and session-bound; disconnect logged as evidence-quality event; overturn and fairness dashboards compute correctly on seeded data; any fairness gap above 1.25× is a release blocker (BLOCK); supervised re-attempt respects 5-day window.
- **M12 Staffing & ATS:** client workspace isolation (RLS tests per client); ATS credentials stored encrypted; write-back idempotent.
- **M13 Pilot gate:** external VAPT report with no open High/Critical (required — an AI review cannot substitute); fairness gaps ≤ 1.25× on the latest study data; security pack complete; load test with code + voice; full max-depth review PASS.

## 5. Method
1. **Run section 2 gates first.** Save outputs under `/tmp/trace-review/` and quote the key lines in the report.
2. **Fan out reviewers in parallel** (subagents), each with the file list and its checklist, each told to report only proven issues with `file:line`:
   - Security & privacy (S1–S16, P1–P8, R8) — use `.claude/agents/security-reviewer.md` if present.
   - Database & RLS (S1, S2, S12, R4, C8) — use `.claude/agents/database-reviewer.md` if present.
   - Product rules & spec (R1–R15, H1, H4, H5) — use `.claude/agents/spec-reviewer.md` if present.
   - Reliability (C1–C12) and milestone-specific checkpoints (section 4).
3. **Prove the risky ones.** For each Critical/High candidate finding, write a minimal failing test or reproduction in a scratch location (not committed) and run it. If it cannot be reproduced, downgrade or drop it.
4. **Adversarial verification pass.** A separate subagent tries to refute each remaining finding against the code. Keep only findings that survive.
5. **Compare with the last review** (`docs/reviews/M<N-1>.md`): previously reported issues fixed? regressions?

## 6. Severity and verdict
- **Critical:** breaks a product rule R1–R15, cross-tenant or cross-candidate data exposure, auth bypass, secret leak, PII exposure, data loss.
- **High:** exploitable with effort, missing RLS test coverage on a sensitive table, mandatory gate failing, exit-gate item missing.
- **Medium:** defence-in-depth gap, missing retry/timeout, weak test on a critical path, measurable NFR miss under 25%.
- **Low:** hygiene with no direct risk.

Verdict:
- **BLOCK** — any Critical or High, or any mandatory gate failing.
- **INCOMPLETE** — a mandatory gate or exit-gate item could not be run or verified.
- **PASS WITH CONDITIONS** — only Medium/Low; each Medium gets an owner milestone (must close before the next milestone's review).
- **PASS** — all gates green, exit gate fully evidenced, no open Medium or above.

Tagging: `m<N>-reviewed` may be applied on PASS, or on PASS WITH CONDITIONS when every Medium has an owner milestone. M8 and M13 require a clean PASS.

## 7. Report
Write `docs/reviews/M<N>.md` (in Cowork, also deliver it as a file):

```markdown
# Milestone M<N> review — <name>
Date · Reviewer (model/session) · Commit range <BASE>..<HEAD> · Files changed: n

## Verdict: PASS | PASS WITH CONDITIONS | INCOMPLETE | BLOCK
One-paragraph reason.

## Gates
| Gate | Command | Result | Notes |

## Exit gate (from build-order.md)
| Item | Evidence (test name / measurement / file) | Status |

## Findings
| # | Severity | Check ID | file:line | Problem | Proof (command/test/scenario) | Fix | Must fix by |

## Product rules R1–R15
One line each: verified how, result.

## Regressions and changes since last review

## Not verified (and why)

## For the founder (plain language)
3–5 sentences: is it safe to continue, what to fix first, what needs a human (counsel, VAPT, vendor, data).
```

Keep the "For the founder" section free of jargon. Never round a BLOCK up to a PASS because the remaining work looks small.
