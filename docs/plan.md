# Trace — Final Product Plan

Oct 10, 2026 · @Abhay

## 1. Product definition

Trace is an online assessment platform for high-volume hiring, built India-first, where every integrity flag comes with proof. Recruiters build and send tests with four question types: written, multiple-choice and aptitude, code, and voice or video. Each candidate gets two separate results:

- **Answer Quality** — how good the answers are
- **Integrity Signals** — how the answers were produced

Each result is backed by timestamped evidence. Candidates see the same report and can appeal any flag, and a human makes every decision. This plan replaces the hackathon brief and is the build reference for launching the company. Section 16 lists the assumptions it rests on.

**One line:** Hire the person who did the work.

**Who it is for**

| Segment | Why they buy | First product they use |
| --- | --- | --- |
| Recruitment and staffing firms (primary) | They answer to clients for candidate quality; proxy and AI cheating hurts their reputation | Volume plan, shared reports sent to clients |
| High-volume employers: IT services, BPO, customer support, campus drives | Thousands of tests per drive; Infosys-style fraud pauses hiring | Drive mode, question pools, India identity add-on |
| Assessment and HR-tech platforms (later) | Want credible integrity without building it | Trace Integrity SDK (Phase 3) |
| Certification and exam bodies (later) | High stakes; need lockdown and audit trails | Secure Mode + Safe Exam Browser tier |

**Product principles** — every feature in this plan is checked against these seven rules.

1. **Evidence before verdict.** No flag exists without a timestamp, the observed value, the rule that fired and a replay or clip.
2. **Two scores, never blended.** A strong answer is never lowered because of integrity signals, and integrity is never hidden inside a quality score.
3. **The same report on both sides.** The candidate sees what the recruiter sees, enforced in the database, not only in the UI.
4. **A human decides.** The system cannot reject anyone. Every outcome against a candidate needs a named person and a written reason.
5. **Observe behaviour, never infer feelings or identity by default.** Trace records presence, timing and events. It never labels emotion or personality. Face and voice matching are opt-in only, with explicit consent.
6. **Browser-first, zero install by default.** A desktop helper and lockdown browser are optional tiers for high-stakes rounds.
7. **Honest about limits.** The product states what each signal can and cannot see, including that browser mode cannot see hidden overlay apps directly.

**What Trace is not**

- **Not a lockdown browser by default.** Lockdown is an optional tier.
- **Not a live human proctoring service.** Review is asynchronous; there are no live interruptions.
- **Not an emotion, personality or "cheating probability" AI.**
- **Not a background-verification company.** Identity checks come from licensed partners.
- **Not an ATS.** Trace pushes results into ATS and VMS tools; it does not replace them.

**Scope at launch:**

- the test platform with all four question types
- the integrity engine
- shared reports and appeals
- the reviewer console
- India identity verification (add-on)
- ATS export

**After launch:**

- the Integrity SDK for other platforms
- live-interview integrity
- the Secure Mode desktop helper
- EU readiness

## 2. Users, roles and permissions

Trace has eight roles. Every row in the database carries an `org_id`, and access to evidence is scoped to the candidates a person is **assigned** to, not to everyone in the org. This matters because a 500-seat staffing firm must not let every recruiter open every candidate's clips.

| Role | Who | Can do | Cannot do |
| --- | --- | --- | --- |
| Org Owner | Buyer, founder of the client firm | Billing, plans, data residency, DPA, delete org | Read evidence for candidates they are not assigned to (unless they also hold Reviewer) |
| Admin | Ops lead | Users, teams, locked defaults, retention, integrations, audit log | Change a frozen ruleset; delete audit records |
| Recruiter | Day-to-day user | Build tests, invite, schedule drives, monitor, shortlist on score, send client packs | Confirm an integrity flag on their own; reject on integrity without a Reviewer decision |
| Reviewer | Recruiter or senior (can be the same person as Recruiter in small firms) | Review flags, confirm or overturn, decide appeals, write rationales | Decide an appeal on a flag they confirmed themselves (blocked by the database) |
| Hiring Manager | Client-side or internal interviewer | Read reports and the interview carry-forward pack for assigned candidates | Edit results; see candidate contact details when masked |
| Client Viewer | A staffing firm's client | Open an expiring, white-labelled shortlist link: CV, both scores, one-line summary | See camera or audio media, contact details, or other candidates |
| Candidate | Test taker | Take tests, see their own report and stored media, explain, appeal, request data or deletion | See other candidates, rank, percentile, exact thresholds or a counterpart's answer in a similarity flag |
| Trace Trust & Safety | Trace staff (Enterprise add-on) | Act as second-level appeal reviewer when the client buys it; break-glass support access | Any access without a ticket; access longer than 4 hours; hidden access (every staff view is shown to the tenant) |

**Rules that apply to every role**

- Every view of a candidate's evidence is written to an append-only audit log, and the candidate can see who viewed it (by role and organisation).
- Recruiter and candidate read the same report data. The candidate copy is a separate projection that removes other people's data, so "same report" never leaks another candidate's answer, device or IP.
- Org users sign in with email OTP or password + 2FA, with SAML SSO on Enterprise. Candidates never create accounts: they use an invite token plus an OTP, and Trace issues them a short-lived session token.

## 3. End-to-end workflows

The workflows are built around one decision rule: **integrity is reviewed only for candidates who would otherwise advance**, and no candidate is rejected on integrity until they have been told why and had 72 hours to respond. Without this rule, a 2,000-candidate drive drowns reviewers in flags that never affected anyone's outcome, and appeals arrive after the decision.

&#91;embedded content: Decision flow from submit to outcome · 6 outcomes\]

Candidates below the score cutoff never enter integrity review, so their flags are marked "not used". Every integrity-based rejection passes through the notice step and a second reviewer.

### 3.1 Recruiter workflow

1. **Create a job.** Paste a job description or pick a role template (BPO Voice, BPO Non-voice, Fresher IT, Sales, Back office, Software Engineer). Trace proposes a test blueprint: sections, time and difficulty.
2. **Build the test.** Choose items from the library, generate variants, import a sheet of your own questions, or let Trace draft questions with AI for a human to approve. The AI-solvability meter shows how easily a frontier model answers each item.
3. **Choose an integrity preset.** Strict, Standard or Open-book, then adjust each signal. Admin-locked defaults cannot be changed, and the candidate-facing notice updates live.
4. **Schedule.** Either open-window (start any time before a deadline) or a drive with slots, capacity, a 15-minute start window and a lobby that opens 30 minutes early.
5. **Invite.** Upload a CSV or Excel file, which is checked for duplicates by phone and email, or invite from the ATS. Invites go by email, SMS and WhatsApp, with delivery status per candidate and reminders at T−24 h and T−1 h.
6. **Monitor the drive.** Live counts for not started, in lobby, in progress, stuck, submitted and evidence pending. A stuck candidate can be sent a resume link or given a reschedule.
7. **Triage on score.** Results are sorted by Answer Quality, so the recruiter sets a cutoff and bulk-shortlists or bulk-rejects on score. Integrity flags on candidates below the cutoff are marked "not used in decision" and need no review.
8. **Review integrity for the shortlist only.** Shortlisted candidates in Review or Strong concern go to the Reviewer queue. Candidates in Clear advance.
9. **Decide and share.** Send a client pack (white-labelled, contact details masked, link expires), push results to the ATS, and export to Excel. The interview carry-forward pack goes to the next-round interviewer.

### 3.2 Candidate workflow

1. **Invite.** The invite says the date, duration, device needed (laptop, or phone allowed), what is recorded, and a link to a practice test.
2. **Practice test (optional).** Mirrors the real test, shows a live view of exactly what is recorded, and counts nothing.
3. **Lobby.** The candidate enters the OTP (WhatsApp, SMS or email, resend after 30 s) before fullscreen starts, then runs the device check: camera, mic, browser, network and a CPU test that sets the monitoring level. The check also detects the keyboard and input method. Low light shows advice; it never blocks.
4. **Age check.** Date of birth from the invite file or the candidate. Under 18 cannot proceed at launch (a parental-consent flow arrives in Phase 2).
5. **Transparency and consent.** One plain screen: what is recorded, what is never recorded, who sees it, retention dates, rights, and "you will see the same report and can respond to anything it shows". The full notice is layered beneath. Consent is versioned and stored. English and Hindi at launch.
6. **Rules and accommodations.** The rules for this test (paste, notes, rough paper, phone). The candidate can self-declare assistive-input, screen-reader, no-camera or no-voice accommodations, which apply instantly. Extra time is requested here and approved by the org.
7. **Optional identity step.** Start photo always. DigiLocker or ID + selfie only if the org bought the add-on. A mismatch never blocks the start; a human resolves it.
8. **Calibration warm-up.** Two ungraded 60-second tasks in the input method the candidate will use: one free writing, one copy-typing.
9. **The test.**
   - Questions are served one at a time from the server, and the timer is held on the server.
   - Autosave runs continuously, and an in-app scratchpad is available.
   - A one-tap event diary lets the candidate note "Someone entered", "Power or network" or "Stepped away".
   - Fixable events show a gentle inline nudge first, at most 3 per test.
   - A help button opens WhatsApp or chat support.
10. **Disconnects.** Under 2 minutes, the timer keeps running and answers buffer locally. Over 2 minutes, the timer pauses. The candidate resumes on any device from the same link. Up to 30 minutes and 3 resumes are credited automatically; beyond that, the recruiter reschedules. Gaps are labelled "Connectivity", never focus loss.
11. **Submit.** A receipt in plain words ("Saved at 4:12 pm, reference TR-8F2K") and a status page showing report status and deadlines.
12. **Report and response.** The report is released after review, or after 7 days, whichever comes first. If a confirmed flag is being used in a decision, the candidate gets a notice and 72 hours to respond: free text, voice or Hindi accepted, plus an optional supervised re-attempt. Flags not used in any decision are shown as "not used" and need no response.

### 3.3 Reviewer and appeal workflow

1. **Action Items inbox.** Shortlisted candidates in Review or Strong concern, open responses with countdowns, and evidence still uploading. The count runs down to zero.
2. **Three-pane console.** Evidence (clip or stills, replay, values, the matched pattern from the flag dictionary) | the candidate's account (in-test diary, nudge replies, response text) | the decision panel.
3. **Per-flag outcome.** Confirm, Overturn, or Needs second reviewer. Confirming needs a written rationale, which the candidate sees.
4. **Notice before decision.** Confirming any flag used in a decision sends the candidate the notice and starts the 72-hour response window. The candidate's state shows "Integrity: awaiting response".
5. **Final call.** After a response, or after 72 hours with none, a different reviewer from the one who confirmed decides: uphold, partially uphold, overturn, or offer a supervised re-attempt. Response SLA: 5 business days.
6. **Close the loop.** The candidate is notified with the rationale. The overturn rate is updated for that signal and that reviewer. The recruiter's decision then unlocks.
7. **Recruiter override.** A recruiter who rejects a candidate on non-integrity grounds while a response is open must give that reason, and it is logged.

### 3.4 Admin workflow

1. Set up the org: users, teams, roles, SSO (Enterprise), and client workspaces for staffing firms.
2. Set locked defaults: presets, retention, report release rule, response window, accommodation policy and branding.
3. Run compliance tasks: download the DPA, the sub-processor list, the DPIA pack and the security pack; handle data-subject requests; read the audit log.
4. Billing: credits, GST invoices, top-ups and usage by client workspace.

## 4. Question types and integrity per type

Trace ships six item formats across the four question families. Each format has its own grading and its own integrity controls. The strongest controls are the ones the server observes or that depend on the candidate's own answer, because a modified browser can fake anything the client reports.

| Format | Grading | Main integrity controls | Device | Phase |
| --- | --- | --- | --- | --- |
| **Written answer** (support reply, essay, explanation) | LLM rubric; extra samples taken near band edges; human calibration set | Typing provenance vs own baseline; paste rules; burst after returning from another tab; question copy; editor state replayed on the server; similarity to other submissions in the drive; explain probe | Laptop (full signals) or phone (reduced signals) | 0 |
| **MCQ / aptitude** | Exact key; parameterised variants | Served one at a time from the server; pools of 10× the items each candidate needs; option shuffle; parameterised numbers; per-item timing vs difficulty; answer changes; wrong-variant answers; shared wrong answers + synchronised timing; preknowledge statistics | Laptop or phone | 0 |
| **Typing test** | WPM and accuracy | Synthetic-input checks; key-hold timing; trusted events | Laptop | 0 |
| **Spoken English / voice answer** (audio) | Speech-to-text transcript → LLM rubric; CEFR-style level A2–C1 with sub-scores | Prep timer; time from prompt to first speech, measured on the device; speaker count from diarisation, with no voiceprint kept; short unpredictable follow-up on what they just said; retakes swap to another variant | Laptop or phone | 0 |
| **Code with execution** | Hidden tests (pass/fail counts only) + LLM code-quality rubric | Code provenance; server-side run history; paste with diff; cohort similarity; hidden test data randomised per candidate; check for hard-coded expected outputs; timed change request after submit | Laptop only | 1 |
| **Video answer** (recruiter opt-in) | As voice + visual presence | As voice; spoken code word at the start; random liveness prompt | Laptop or phone | 2 |

**Decisions by format**

- **Written is the headline.** Every competitor that detects retyping does it on code only. Trace leads with written answers for BPO, support and campus roles.
- **MCQ is the most exposed format.** A phone camera pointed at the screen and a vision LLM beat unproctored MCQ. The defence is content-side: tight per-item time, parameterised variants, drive windows, wrong-variant detection and the phone-as-second-camera option in Strict. Recruiters are told plainly that unproctored MCQ is a screen, not a final decision.
- **Voice is audio-first.** Video carries biometric and bandwidth cost and adds little evidence, so it is opt-in and arrives in Phase 2. Lip-sync, gaze while speaking and "reading-aloud pattern" are cut as flags: they misfire on stammerers, rehearsed non-native speakers and monotone speakers, and drift towards emotion inference. Read-aloud items naturally switch off any reading-related rule.
- **Code launches with five languages:** Python, Java, C++, JavaScript/TypeScript and SQL. C# and Go come in Phase 2. Code runs on a bought execution service, never Trace's own sandbox. Each candidate gets one concurrent run, 10 s wall time, 256 MB, no network and 64 KB output. SQL runs in a throwaway database inside the sandbox.
- **AI-likeness of text is never shown,** not even as context. AI-text detectors misclassify non-native English writers disproportionately, and showing it anchors reviewers. It stays in internal research data only.
- **AI-allowed mode** (an AI assistant inside the test, with the transcript logged) comes in Phase 3, because some employers now test how well people use AI.
- **Content library at launch: about 6,500 reviewed items.**
  - 800 quant (at least 40% parameterised), 800 logical, 800 verbal
  - 60 reading passages, 80 data-interpretation sets
  - 200 written-communication prompts
  - 450 spoken-English items
  - 100 typing passages
  - 300 customer-service situational-judgement items
  - 300 computer basics / Excel, 800 CS fundamentals, 600 language MCQ
  - 150 coding + 50 SQL problems (Phase 1)
  - Pipeline: AI drafts three candidates per slot → a second model solves each → checks for duplicates, readability and bias → a paid expert accepts, edits or rejects every item → calibrate on the first 5,000 responses → retire items with poor discrimination or high exposure.
  - Never copied from public question sites or past papers.

## 5. Feature catalogue

Trace has 75 features across 14 modules.&#32;

Every feature has a test you can run to say it is done.

| Module | Feature | Phase | Done when |
| --- | --- | --- | --- |
| A. Tests & content | Role templates + job-description-to-blueprint | 0 | 5 recruiters each publish a test from a template in a median of ≤5 min |
| A | Item library v1 (about 3,000 items) → v2 (about 6,500) | 0 → 1 | Every item expert-reviewed, tagged by skill and difficulty, with exposure counter |
| A | Parameterised variants (quant, then written and code) | 0 → 1 | ≥40% of quant items vary per candidate; difficulty within ±0.1 of the parent item |
| A | AI question drafting with human approval | 0 | No AI item reaches a candidate without an approver logged |
| A | Import questions from Excel/Word | 0 | 500 items with images in <5 min; error shown for each bad row |
| A | Pools, sections, option shuffle, per-section timers | 0 | Pool ≥10× the items each candidate draws for drives |
| A | AI-solvability meter | 1 | Each item shows how often a frontier model solves it |
| A | Canary phrases, exposure caps, post-drive drift report | 1 | Items that leak are retired automatically past the cap |
| B. Scheduling & invites | Bulk invite (CSV/Excel) via email, SMS, WhatsApp | 0 | 2,000 invites in <10 min; delivery status per candidate; duplicates removed |
| B | Drive slots, capacity, 15-min start window, lobby 30 min early | 0 | 20k candidates start within 60 s with no OTP load in the start minute |
| B | Reminders (T−24 h, T−1 h), one self-reschedule | 0 | Configurable per drive |
| B | Public test link with OTP | 1 | One attempt per phone, email and device per drive |
| C. Candidate app | Practice test with live "what we record" view | 0 | Mirrors the real test; nothing counted |
| C | Device check with CPU tier and input-method detection | 0 | Never blocks; sets the monitoring level |
| C | Transparency screen, versioned consent, English + Hindi | 0 | Notice hash stored with each session |
| C | Self-declared accommodations (instant) + extra-time requests | 0 | Signal suppression is instant; extra time decided in 48 h, auto-approved up to +25% |
| C | Server-held timer, autosave, offline buffer, resume on any device | 0 | No answer lost in a 20-min power cut; time credited per the rules in 3.2 |
| C | Scratchpad, event diary, help button (WhatsApp/chat) | 0 | Diary entries appear on the reviewer timeline |
| C | Inline nudges before flags (max 3) | 0 | A nudge the candidate corrects is never a flag |
| C | Receipt + status page + report view + response flow | 0 | The candidate can see every stored image and clip |
| C | WCAG 2.2 AA; tested with NVDA, TalkBack and keyboard only | 0 | External audit before launch (Phase 2) |
| C | Phone mode for MCQ, written and voice | 2 | Android Chrome on a 2 GB phone; report labelled "phone, reduced signals" |
| C | Regional-language UI (Tamil, Telugu, Kannada, Bengali, Marathi) | 2 | Written natively, not machine-only |
| C | Low-data mode | 2 | Stills only, audio at 24 kbps |
| D. Capture & integrity | Capture SDK: keys (class only), input events, paste/drop, focus, fullscreen, edits | 0 | Capture latency p99 <50 ms; works with Indian input methods |
| D | On-device face presence/count and voice activity (no frames leave the device unless a flag fires) | 0 | Low-tier devices drop to 1 fps without blocking |
| D | Typing provenance features + calibration warm-up | 0 | Validated on the 500-session study (section 6) |
| D | Editor state replayed on the server; nonce binding; clock cross-checks | 0 | A mismatch between the submitted answer and its replayed events = hard evidence |
| D | Deterministic band engine with versioned rule table | 0 | The same inputs always give the same band; the ruleset is frozen per test |
| D | Evidence coverage meter + Strict minimum coverage | 0 | Low coverage never reads as Clear |
| D | Explain probe (60–90 s, typed or spoken, any language) | 0 | Can lower concern; never raises the band alone |
| D | Flag clips: on-device background blur, stills by default | 0 | Media leaves the device only around events |
| D | Phone as second camera (QR) for Strict | 1 | Disconnect logged as an evidence-quality event |
| D | Wrong-variant detection; preknowledge statistics | 1 | Runs server-side across a drive |
| D | Liveness prompts, spoken code word (video) | 2 | Random, no more than 2 per test |
| D | Secure Mode desktop helper (Win/macOS) | 3 | Only checks for cheating tools and windows hidden from screen capture; shows candidates the scan list |
| D | Safe Exam Browser tier with Config Key check | 3 | Verified on every request; recorded in the report |
| E. Scoring | Quality scoring per format (section 7) | 0 | LLM grade within ±10 of the human grade on ≥85% of a 300-answer calibration set |
| E | Grader prompt-injection guard | 0 | Instructions aimed at the grader are detected and raise a Review signal |
| E | Speech-to-text with Indian English + Hinglish; CEFR-style speaking level | 0 | Word error rate measured per accent in the study |
| E | Typing WPM/accuracy | 0 | — |
| E | Code judge + quality rubric | 1 | Sample run p95 <5 s; submit p95 <15 s |
| F. Report & evidence | Two equal cards: Answer Quality and Integrity Signals | 0 | Never one blended number |
| F | Signals table by family, writing curve, origin-tinted text, synced replay, flag cards, audit trail | 0 | Every flag links to timestamp, rule, observed value and replay/clip |
| F | Candidate projection (no third-party data) | 0 | Database tests prove a candidate can never read another candidate's data |
| F | Flag dictionary with a pattern gallery | 0 | 6–8 annotated example writing curves |
| F | Interview carry-forward pack | 0 | Start photo, 10 s clip and the candidate's own answers, plus "walk me through this" prompts for the next interviewer |
| F | PDF/HTML export from the same report data | 0 | Matches the online report |
| G. Review & appeals | Action Items inbox, 3-pane console, keyboard navigation | 0 | Reviewer clears 100 shortlisted candidates in ≤15 min of active review (median) |
| G | Confirm/Overturn with rationale; notice + 72 h response window; second-reviewer rule | 0 | The database blocks a reviewer from deciding their own confirmation |
| G | Supervised re-attempt booking | 1 | Offered within 5 days |
| G | Overturn dashboard per signal and per reviewer | 1 | Weekly; a detector with >30% overturn is sent for retuning |
| G | Trace Trust & Safety appeals desk | 2 | Enterprise add-on |
| H. Recruiter ops | Score-first triage view; bulk shortlist/reject by cutoff | 0 | A 2,000-candidate drive closes in ≤1 working day with one reviewer |
| H | Live drive monitor | 0 | Stuck candidates surfaced within 60 s |
| H | Excel/CSV export | 0 | One click; Unicode names correct |
| H | Drive analytics: funnel, college comparison, item stats | 1 | — |
| I. Staffing | White-labelled client pack with contact masking and expiring link | 0 | 50-candidate PDF zip in one click |
| I | Client workspaces, credits per client, re-billing report | 1 | — |
| I | Full white-label (sender domain, subdomain) | 2 | — |
| J. Identity | Start photo + snapshot grid for human comparison; duplicates within a drive | 0 | No automated face matching |
| J | DigiLocker / ID + selfie via partner (opt-in, explicit consent) | 2 | ID images never shown to recruiters; recruiter can re-trigger verification |
| J | Lab / shared-device drive mode | 0 | IP and device never flag on their own; IP/ASN never a flag in India |
| K. Integrations | Webhooks + REST API | 0 | Signed webhooks, idempotent |
| K | Zoho Recruit, Naukri RMS | 1 | Invite from the ATS; results write back |
| K | Darwinbox, Keka | 2 | — |
| K | Greenhouse, Lever | 3 | With the UK push |
| K | Trace Integrity SDK for other platforms | 3 | — |
| L. Admin & compliance | Roles, teams, locked defaults, audit log | 0 | — |
| L | Consent ledger, retention engine, deletion receipts, data-subject requests | 0 | Deletion ≤30 days including backups |
| L | Security pack: CERT-In-empanelled VAPT, DPA, sub-processors, questionnaire answers | 1 | Ready before the first paid pilot |
| L | SSO (SAML), data-residency SKU | 2 | — |
| M. Billing | Credits, Razorpay, GST invoices, no auto-renew | 0 | Invoice carries the buyer's GSTIN |
| M | Stripe for UK/EU | 3 | — |
| N. Trust | Public trust page: limits, per-detector precision, known evasions, ruleset changelog | 2 | Updated each ruleset version |

## 6. Detection system

Every signal is sorted into one of three trust tiers, because a determined cheater can forge anything the browser reports. Strong concern requires evidence the client cannot fake. Browser-reported behaviour alone can raise a candidate to Review, never higher.

**Trust tiers**

| Tier | What it is | Examples | Can it alone reach Strong concern? |
| --- | --- | --- | --- |
| T1 — Server-observed | Facts the server sees directly | Serve and submit times; code run history; replayed answer ≠ submitted answer; wrong-variant answer; duplicate event stream across sessions; content similarity within a drive | Yes |
| T2 — Tied to the candidate's own content | Checks that depend on the answer itself | Explain probe; follow-up answers; canary phrase appearing in an answer | Yes |
| T3 — Client-reported behaviour | Events and on-device ML outputs | Typing provenance; paste; tab blur; fullscreen; face count; speech; untrusted input events | Only with raw media a reviewer can see (a clip of a second person), or untrusted input events. Otherwise capped at Review |

**Final signal list**

| Signal | Role | Default threshold (calibrate on the study) | Protection for honest candidates |
| --- | --- | --- | --- |
| Paste / drop from outside the test | Flag | Any external paste where pasting is blocked; size and share where it is allowed | Pasting from within the test is ignored; "cite source" note on allowed pastes |
| Untrusted input (`isTrusted=false`, input with no keydown, uppercase with no Shift) | Hard evidence | Any | Accessibility tools are allow-listed through the accommodation profile |
| Retyping pattern (transcription vs composition) | Flag, capped at Review | Evidence floor of ≥300 keystrokes or ≥60 words. Needs 2+ features beyond the candidate's own baseline: where pauses fall, product/process ratio, deletion ratio, burst length, content alignment | Never alone. Writing a rough draft first is allowed by default and noted. Scratchpad drafting is inside Trace |
| Burst after returning from another tab | Flag | ≥40 characters within 20 s of return at ≥1.5× own median speed, no deletions | Absences under 3 s are ignored; OS dialogs are grouped |
| Question copy | Flag | Copying the prompt text | — |
| Tab blur / fullscreen exit | Context; repeated → flag | ≥3 exits after a nudge | A gap caused by connectivity is labelled as such; a phone call on a phone is a known event |
| Face absent | Flag | ≥20 s continuous | Calibrated per camera in the warm-up; low confidence → camera becomes context only |
| Second face | Flag | ≥10 s and close to the screen | Passers-by produce nothing; a private room is never required |
| Gaze off-screen | Context only | — | Never a flag: it misfires on people who look up to think, people who type looking down, and neurodivergent candidates |
| Speech during a written, MCQ or code test | Off in Standard; context in Strict | — | Home noise, prayer calls and TV are normal in Indian homes |
| Speaker count in voice answers | Context | More than one speaker for ≥10 s | Diarisation only; no voiceprint kept |
| Time to first input / first speech | Context | — | Network time excluded (measured on the device) |
| Second screen (`screen.isExtended`) | Nudge; Strict blocks on reconnect | — | Chromium only, stated |
| Virtual camera / VM / debugger markers | Low-weight context | — | Phone-as-webcam apps allowed |
| IP / device fingerprint | Context within a drive | Duplicate device + answer similarity | Never a flag on its own; never in lab mode; IP/ASN never a flag in India |
| Shared wrong answers + synchronised timing (MCQ) | Flag (T1) | Statistical threshold per drive | Correct answers converging is not evidence |
| Wrong-variant answer | Hard evidence (T1) | Any | — |
| Replay mismatch / nonce or clock tampering | Hard evidence (T1) | Any | — |
| AI-likeness of text | Not shown | — | Biased against non-native writers |
| Emotion, stress, personality, "nervousness" | Never built | — | Banned in the EU; indefensible everywhere |

**When evidence is missing.** Low light, a weak CPU, a camera or mic that is missing or declined, phone mode, an accommodation, or broken connectivity all lower **evidence coverage**.

- Below the floor, the band is **Insufficient evidence**: not assessed, never Clear and never a concern.
- In Strict, coverage below the minimum pauses the test until fixed, with a nudge. If the candidate still cannot fix it, the report shows **low coverage as its own finding**, so covering the camera is not a free pass.
- An accommodation never means "no control". It swaps in an alternative control: the explain probe or a supervised re-attempt.

**Calibration and validation**

1. **Per-candidate warm-up.** Two 60-second tasks (free writing, copy-typing) in the same language and input method the candidate will use. The baseline is checked against cohort norms, and a second baseline is taken from an unpredictable item during the test, so a candidate cannot plant a false baseline.
2. **Accuracy study.** 500 or more labelled sessions before pilots end. Seven conditions:
   - honest composition
   - verbatim retyping
   - paraphrasing while reading AI output
   - an attacker who paraphrases and adds typos with a humanised auto-typer
   - Indic input / Hinglish
   - phone typing
   - assistive input
3. **Bias breakdown in the study.** Results are reported by skin tone, lighting, head covering, glasses, device tier, gender and native language.
4. **Launch gates per detector:** precision ≥90% and false-positive rate on honest sessions <5%. A detector that misses either gate ships as context only.
5. **Retuning.** Every two weeks from overturn rates. Each change ships as a new ruleset version, published in the changelog.

**What Trace states publicly as limits**

- Browser mode cannot see invisible overlays, a second device, an earpiece or remote desktop directly. It sees their behavioural footprint, and only sometimes.
- Typing provenance reliably catches verbatim retyping, moderately catches paraphrasing, and can be beaten by hardware auto-typers and forged timing.
- A modified browser can fabricate events. Tamper checks prove that logs were not changed after they arrived, not that the client was honest.
- Without the identity add-on, Trace does not establish identity. An OTP proves only that the person holds the phone.
- "Insufficient evidence" means not assessed.

## 7. Scoring

Every candidate gets two results that never mix. **Answer Quality** is a 0–100 score. **Integrity Signals** is a band, not a number. The pitch deck's "Honesty 41" sample must change to a band: a numeric honesty score invites automatic cut-offs and reads as a verdict.

### 7.1 Answer Quality (0–100)

| Format | Method | Safeguards |
| --- | --- | --- |
| MCQ / aptitude | Exact key; section scores weighted by the blueprint | Key reviewed by a second expert; items with poor discrimination retired |
| Typing | WPM and accuracy mapped to a role benchmark | — |
| Written | LLM grades against a versioned rubric with criteria and anchor examples. One pass by default; 3 passes only when the score lands within 5 points of a cutoff | Answer sent as delimited data; structured output; prompt-injection detector; the grader never sees the candidate's name or other candidates; a 300-answer human calibration set re-run on every rubric or model change |
| Voice | Speech-to-text transcript → LLM rubric for content; CEFR-style speaking level (A2–C1) from fluency, pronunciation and grammar sub-scores | Accent fairness checked per region in the study; a technical failure gives one retake on a new variant |
| Code | Hidden tests (correctness) + LLM rubric (readability, structure, efficiency) | The candidate sees only pass/fail counts for hidden tests |

- **Never affected by integrity.** A confirmed integrity outcome is recorded as a separate decision. It never edits the quality score.
- **Percentiles** are shown to recruiters only. They exclude candidates who had extra time or an accommodation, and appear only for cohorts of 20 or more.
- **Speed targets.** MCQ, typing and test-case scores are ready in under 30 s at p95. LLM and speech grades are ready in 15 min at p95, or within 2 hours for drives of 5,000+ booked 48 hours ahead.

### 7.2 Integrity Signals band

| Band | Rule (deterministic, versioned, frozen per test) | What the recruiter is told to do | What the candidate is shown |
| --- | --- | --- | --- |
| Clear | No T1/T2 evidence and at most one T3 soft signal | Proceed | "Nothing needs explaining" |
| Review | Two or more T3 signals from different families, or one medium flag | A person checks before any integrity decision | "A person will check this" |
| Strong concern | Any T1 or T2 evidence, or T3 with viewable raw media, or untrusted input | Confirm or overturn each flag; notice + 72 h before any decision | "Needs explanation" |
| Insufficient evidence | Evidence coverage below the floor | Use another stage (interview, supervised re-test) to judge integrity | "Integrity not assessed" plus the reason (age, device, accommodation, connectivity), without naming any condition |

- **Evidence strength (0–1)** sits beside the band: the share of signal families with usable data.
- **Only human-confirmed flags count.** A machine-raised flag stays "pending review" until a reviewer acts. The recruiter's decision screen lists confirmed flags only.
- **The rule table is published inside the product** with each rule's family and severity. Exact numeric thresholds are shared with recruiters, with candidates on appeal, and in the instructions for use, but not on the public site, so they do not become an evasion guide.
- **No automatic rejection exists anywhere**, including bulk actions. Bulk reject works only on Answer Quality cutoffs.

## 8. Architecture and tech stack

Postgres is kept off the in-test path. A per-session object at the edge holds the timer, saves answers and orders events, so a test keeps running even if the main database is down for 30 minutes. Postgres is written only at start, at section changes and at submit. Everything heavy happens after submit, in queued workers in Mumbai.

&#91;embedded content: Trace production architecture · 3 zones, 12 components\]

During the test, the candidate's browser talks only to the edge. Queued jobs carry the submitted session to Mumbai, where scoring, grading and the report happen.

### 8.1 Components (one choice each, with a fallback)

| Layer | Choice | Why | Fallback |
| --- | --- | --- | --- |
| Candidate app + recruiter app | React + TypeScript, served from Cloudflare Pages; one shared design system | Same edge network as ingest; the candidate app stays light for 4 GB laptops | Vercel |
| In-test authority | Cloudflare Durable Object per session: timer, autosave, event order and dedupe, hash chain, nonce, deadline auto-submit | One writer per session; survives a database outage | Redis at the edge + Worker |
| Ingest and uploads | Cloudflare Workers: auth check, size and type limits, chunked uploads | Upload policy enforced; edge sites in India | — |
| Raw evidence | Cloudflare R2: event logs, stills, clips, audio, model files; daily root hashes in a locked bucket | No egress fees | AWS S3 Mumbai for the data-residency SKU |
| System of record | Supabase Postgres (Mumbai): orgs, tests, sessions, flags, scores, decisions, appeals, consent, audit. Point-in-time restore; compute upsized 48 h before booked drives | Row-level security, managed backups | Amazon RDS Postgres (Mumbai) |
| Auth | Supabase Auth for org users (OTP/password + 2FA; SAML later). Candidates get a Trace-issued session token (invite + OTP) that row-level security still understands | Avoids per-IP OTP limits behind college networks and per-user auth billing for candidates | — |
| API and workers | Node.js + TypeScript modular monolith on AWS ECS Fargate (Mumbai): API, scoring, grading orchestration, notifications, billing | Same region as the database and the AI models | Google Cloud Run (Mumbai) |
| Queues | Cloudflare Queues; every job keyed by session + job + ruleset so a retry never double-counts | Can be fed from the session objects directly | Amazon SQS (Mumbai) |
| Code execution | Bought code-execution service with hard quotas; burst-tested at 2,000 concurrent runs before contract | No sandbox security or operations for a small team | Cloudflare Sandboxes |
| LLM grading | Claude via AWS Bedrock India inference: Haiku first pass, Sonnet on escalation | Inference stays in India; prompts pseudonymised | An Indian-hosted LLM behind the same interface |
| Speech-to-text | Indian STT vendor with Hinglish and diarisation (Sarvam first), behind a vendor-neutral interface | Price (\~₹30–45 per audio hour) and accent fit | Second vendor chosen by measured Hinglish error rate |
| On-device ML | Face detector + landmarker and a voice-activity model in Web Workers | \~₹0 cost; no frames leave the device | — |
| Messaging | WhatsApp Business (auth + reminder templates via a provider), Amazon SES Mumbai for email, DLT-registered SMS as fallback | Delivery in India; start DLT and template registration now | Second WhatsApp provider |
| Secrets and sensitive fields | AWS Secrets Manager + KMS envelope encryption for accommodations and identity results | — | — |
| Observability | Sentry (errors), Better Stack (logs, uptime, public status page) | Small surface | Grafana Cloud |
| Product analytics | PostHog on the recruiter app only; no candidate personal data. No warehouse until 50k sessions a month (Parquet on R2 until then) | — | — |
| Billing | Razorpay (UPI, cards, net banking, GST invoices); Stripe for UK/EU | — | — |
| Compliance automation | Vanta or Sprinto | Security questionnaires in pilots | — |
| Optional tiers | Secure Mode desktop helper (Windows/macOS, signed); Safe Exam Browser configuration with server-side Config Key checks | High-stakes rounds only | — |

**Before signing a contract, confirm:**

- that Bedrock India inference supports the chosen models
- the STT vendor's hosting location
- the code-execution service's price and concurrency at 2,000 runs

### 8.2 Key architecture rules

1. **The server holds the truth.** The timer, the served items, the final answer and every code run are server facts. The final answer is rebuilt from its edit events on the server, and a mismatch with what was submitted is hard evidence.
2. **Exactly-once results from at-least-once delivery.** Events carry a sequence number and the session object keeps a high-water mark. Storage keys are deterministic and jobs are idempotent. Evidence that arrives late creates a new report version with a notice.
3. **Media stays on the device unless a flag fires.** Stills and clips are blurred on the device and uploaded through a Worker. Campus mode turns video off and sends audio at 24 kbps.
4. **Everything is versioned:** rulesets, rubrics, notices, items and models. Each report records the versions it used.
5. **Load planning.** Model files are preloaded during the device check days before a drive. Each site gets a bandwidth budget check, and drives over 5,000 candidates book capacity 48 hours ahead.
6. **Residency is stated honestly.** The database and compute are in Mumbai and AI runs in India. R2 is an Asia-Pacific location, not India-only. Enterprise customers who need strict India residency get S3 Mumbai storage.

### 8.3 Buy vs build

**Build (the moat):**

- capture SDK and provenance features
- band rule engine
- session authority
- evidence report, reviewer console and appeals
- consent ledger and notice versioning
- retention and deletion engine
- audit log
- grading orchestration and calibration
- test builder and item bank tooling
- drive operations
- row-level security policy suite with tests
- EU AI Act technical file, kept as a living document

**Buy:**

- database and auth
- edge, storage and queues
- code execution
- speech-to-text and LLM
- messaging
- identity verification
- observability and status page
- billing
- compliance automation
- annual penetration test
- counsel-drafted DPA and notices
- EU authorised representative

## 9. Data model, APIs and integrations

Raw events and media live in R2. Postgres holds everything a person decides on or audits, about 50 rows per session. Every table carries `org_id`. Candidate-facing data is served from separate views that remove other people's data.

### 9.1 Core entities

| Entity | Key fields | Notes |
| --- | --- | --- |
| `orgs`, `workspaces`, `memberships` | org, client workspace, user, role, team | Workspaces = a staffing firm's clients |
| `jobs`, `tests`, `sections` | blueprint, timers, preset, `ruleset_version`, `locked_at` | Settings lock when the first candidate starts |
| `items`, `item_variants`, `pools` | format, skill, difficulty, discrimination, exposure count, solvability, status | AI-drafted items carry the approver's ID |
| `drives`, `slots` | capacity, start window, lab mode, bandwidth budget | — |
| `candidates` | contact (encrypted), DOB or age flag, device tier | Contact masked in client views |
| `invitations` | channel, delivery status, reminders | — |
| `consents` | notice version hash, language, timestamp, IP, withdrawal | Consent ledger |
| `accommodations` | type (encrypted), approval, signals suppressed, alternative control | The recruiter sees "accommodation applied" only |
| `sessions` | state, server deadline, credited time, resumes, device changes, evidence coverage, chain head | Mirrors the session object at start, section change and submit |
| `responses` | item, variant, final answer, served/submitted time, replay check result | — |
| `code_runs` | language, server time, pass/fail counts | The run history is T1 evidence |
| `signals`, `flags` | family, tier, rule ID, severity, time window, observed value, media reference, state (pending → confirmed / overturned / not used) | Partitioned by month at scale |
| `scores` | quality total, section scores, rubric and model version, grader passes | — |
| `reports` + `report_candidate_view` | quality card, integrity card, band, evidence strength, version, release time | The candidate view strips third-party data |
| `diary_entries`, `nudges`, `explanations` | candidate text or voice, time | Shown on the reviewer timeline |
| `decisions`, `appeals` | flag, reviewer, rationale, notice time, response window, second reviewer, outcome | The database blocks a reviewer from judging their own confirmation |
| `audit_log` | actor, role, action, object, time | Append-only; candidates see who viewed their evidence |
| `retention_jobs`, `deletion_receipts`, `dsr_requests` | — | — |
| `billing_credits`, `invoices` | credits used per started attempt, GSTIN | — |

### 9.2 APIs

- **Public REST API** (org API keys, scoped per workspace): manage tests, invite candidates, read results and reports, read decisions. The OpenAPI spec is published.
- **Signed webhooks:** `invite.delivered`, `session.started`, `session.submitted`, `report.ready`, `integrity.review_needed`, `decision.recorded`, `appeal.opened`, `appeal.decided`. Each event is idempotent and retried with backoff.
- **Candidate session API** (edge only): start, fetch the next item, save, upload evidence, submit. Bound to the session token and per-question nonces.
- **Integrity SDK** (Phase 3): the same capture SDK plus a scoring API, for test platforms that want Trace inside their own product.

### 9.3 Integrations by phase

| Phase | Integrations |
| --- | --- |
| 0 | CSV/Excel in and out; webhooks; REST API; WhatsApp, SMS and email |
| 1 | Zoho Recruit; Naukri RMS (invite from the ATS, results written back) |
| 2 | Darwinbox (assessment marketplace); Keka; Google/Microsoft calendar for supervised re-attempts; DigiLocker / ID partner |
| 3 | Greenhouse, Lever, SmartRecruiters, Workday (UK/EU push); test-platform partners via the SDK |

## 10. Security, privacy and compliance

Trace will meet India's DPDP rules at closed beta in Nov 2026, not at the May 2027 deadline. Real candidate data arrives from the first beta drive. MeitY has also proposed shortening the timeline, and that change was unconfirmed as of May 2026. This section summarises requirements; counsel must review the notices, DPA and AI Act file before the first paid contract.

### 10.1 Security controls

| Area | Control |
| --- | --- |
| Tenant isolation | `org_id` on every row; claims carry org, role and team; evidence scoped to assignment; database tests per role per table run in CI |
| Candidate privacy between candidates | Separate candidate view; similarity flags say "matched another submission in this drive" and never show the other candidate's content or identity |
| Staff access | Break-glass only: ticketed, at most 4 hours, visible to the tenant |
| Media access | 5-minute signed links, watermarked with the viewer's identity, every view audited; Client Viewers never get camera or audio media |
| Upload safety | Uploads pass through a Worker with authorisation, size cap and file-type check |
| Local buffer | Encrypted with an in-memory session key; wiped on submit (shared lab machines) |
| Code sandbox | Bought service; no network; resource caps; never touches Trace's database |
| LLM grader | Delimited input, structured output, injection detector, pseudonymised prompts, no cross-candidate context |
| Secrets and keys | Service keys only in server workers; envelope encryption for sensitive fields |
| Assurance | CERT-In-empanelled VAPT before the first paid pilot; annual pentest; SOC 2 and ISO 27001 started together in Q1 2027; SOC 2 Type I by Q3 2027 |
| Incidents | Tenant notified within 24 h; Data Protection Board within 72 h; runbook rehearsed before beta |
| Recovery | Database RPO ≤2 min, RTO 4 h; evidence RPO 0 once acknowledged; daily copy of reports and decisions to a second provider |

### 10.2 Privacy defaults

- **No frames or audio stream off the device.** Stills and clips are uploaded only around events, background-blurred on the device.
- **Video answers are opt-in** and kept until decision + 30 days, 90 days at most.
- **Retention:**
  - media — 30 days after the decision
  - event logs — 12 months (India), 6+ months (EU)
  - decisions and audit — 12 months
  - any of these is extended only while an appeal is open
- **No biometric templates or voiceprints** by default. Face matching exists only inside the opt-in identity add-on, with explicit consent and a non-biometric alternative (a live human check).
- **The candidate can see every stored image**, download their data, and request deletion after the decision.
- **Training on customer data is off** unless the customer opts in under a separate agreement.

### 10.3 Compliance requirements by law

| Law | Trace's role | What Trace builds | Deadline |
| --- | --- | --- | --- |
| India DPDP Act + Rules 2025 | Processor for the employer (the fiduciary) | Itemised notice in English + Hindi (more languages in Phase 2); consent ledger with withdrawal; grievance officer; breach runbook; 1-year log retention; deletion receipts; DPA naming Trace as processor | Ready at beta (Nov 2026); legal deadline 13 May 2027 |
| DPDP s.9: children | — | Under-18s blocked at launch; parental-consent flow with only basic monitoring in Phase 2 | Launch |
| India RPwD Act + WCAG 2.2 AA | — | Accommodation profiles; extra time; accessible candidate app; external audit | Phase 2 |
| GDPR / UK GDPR + DUAA | Processor | DPA, DPIA pack, Art. 22 safeguards (no automatic rejection, right to contest), UK complaints flow | Before any UK/EU sale |
| EU AI Act (high-risk: recruitment and test monitoring) | Provider | No emotion inference (already in force); logs ≥6 months; human-oversight UI; instructions for use. Also: technical file (Annex IV), QMS, conformity assessment, CE marking, EU database registration, post-market monitoring, incident reporting, bias testing including the LLM grader, EU authorised representative | Technical file starts in Phase 0; no EU sale before Q4 2027; obligations from 2 Dec 2027 |
| US (NYC LL144, Illinois BIPA and AI Video Interview Act, Colorado, California ADMT) | Provider | Not targeted. Block Illinois without a written biometric release; bias-audit export available | Only if a US customer signs |

**Product consequences.**

- Name the output "Integrity Signals", never "cheating probability".
- Keystroke data is used only to judge how an answer was produced, never to identify a typist across sessions.
- Gaze and face data are recorded as durations and counts, never emotions.

## 11. Problem → fix register

This register lists every known way Trace could fail an honest candidate, miss a cheater, lose a buyer or break, with the fix this plan builds. It came from four review passes: candidate advocate, cheater red team, buyer, and architect plus compliance.

| # | Area | Problem | Fix in this plan |
| --- | --- | --- | --- |
| 1 | Fairness | Appeals arrive after a 48-hour campus decision | Notice + 72-hour response window before any integrity-based rejection; candidate state shows "awaiting response" |
| 2 | Fairness | Face detection fails on darker skin, backlight, glasses, head coverings or cheap webcams | Per-camera confidence check in the warm-up; absence needs ≥20 s; low confidence → camera becomes context only; a no-camera path through a live human check (female verifier on request) |
| 3 | Fairness | Joint-family homes: TV, prayer calls, relatives | Mic off outside voice questions in Standard; speech is context only in Strict |
| 4 | Fairness | Power cuts and 4G drops | Server-held timer; pause after 2 min; resume on any device; 30 min / 3 resumes credited; gaps labelled "Connectivity" |
| 5 | Fairness | Assistive tech looks like cheating | Self-declared, instant signal suppression; alternative controls instead; no condition named to the recruiter |
| 6 | Fairness | Indian input methods (transliteration, swipe, voice typing) look like pastes or bursts | Classified as "assisted input method"; warm-up in the same input method |
| 7 | Fairness | "Rough work then fair copy" looks like retyping | In-app scratchpad; rough paper allowed by default and declared; retyping pattern never flags alone |
| 8 | Fairness | Low-end laptops distort timing | Device tiers; monitoring scaled down; timing marked unreliable → Insufficient evidence |
| 9 | Fairness | AI-text detectors penalise non-native English | AI-likeness never shown; explain probe accepts Hindi, regional languages and voice; it grades consistency, not fluency |
| 10 | Fairness | Campus labs and carrier networks share IPs | Lab mode; IP/ASN never a flag in India; device duplicates count only with answer similarity |
| 11 | Fairness | Consent without an alternative is not free consent | No-camera path in every preset; plain notice in English + Hindi |
| 12 | Fairness | Under-18 candidates in campus and BPO drives | Blocked at launch; parental-consent flow with only basic monitoring in Phase 2 |
| 13 | Privacy | Bedroom images and family members in clips | Stills by default; on-device background blur; Client Viewer never sees media; deleted 30 days after the decision |
| 14 | Privacy | A shared report leaks another candidate's data | Separate candidate projection |
| 15 | Cheating | Invisible overlay + verbatim retyping | Retyping features vs own baseline; question copy; explain probe; Secure Mode helper (Phase 3) |
| 16 | Cheating | Overlay + paraphrasing + fake typos | Follow-up built from the candidate's own answer (T2); provenance capped at Review; carry-forward pack for the interviewer |
| 17 | Cheating | Phone camera at the screen + vision LLM on MCQ | Tight per-item time; parameterised variants; drive windows; wrong-variant detection; phone as second camera in Strict; recruiter told MCQ is a screen, not a verdict |
| 18 | Cheating | Proxy test-taker | Start photo + snapshot grid; carry-forward pack for a human same-person check; ID add-on |
| 19 | Cheating | Earpiece / off-camera helper | Room sweep in Strict; follow-ups; carry-forward; stated as a limit |
| 20 | Cheating | Remote desktop, hardware auto-typer | Phone side camera (hands vs text); follow-ups; Secure Mode helper lists remote-access tools; stated as a limit |
| 21 | Cheating | DOM / extension auto-typers | Untrusted-event hard evidence; debugger/automation markers (low weight) |
| 22 | Cheating | Leaked bank / WhatsApp relay during staggered drives | Server-side item delivery; pools ≥10×; 15-min start windows; variants; exposure caps; drift report; watermarks; canaries |
| 23 | Cheating | Collusion between candidates | Different items at the same moment; shared wrong answers + synchronised timing |
| 24 | Cheating | Covering the camera or dimming the light to get "Insufficient evidence" | Strict minimum coverage pauses the test; low coverage shown as its own finding |
| 25 | Cheating | Faking an accommodation or input-method claim | Accommodation triggers an alternative control; input-method claim checked against what was actually committed; accommodation rate per drive monitored |
| 26 | Cheating | Planting a false baseline in the warm-up | Cohort check + a second baseline taken from an unpredictable item during the test |
| 27 | Cheating | Modified client / fake event stream / replay | Server replay of the editor; nonces; clock cross-checks; duplicate-stream fingerprint; random server-requested stills |
| 28 | Cheating | Reading an AI answer aloud in voice items | Unpredictable follow-ups with 0–5 s prep; retakes swap variant; context only, never a flag |
| 29 | Cheating | Hidden-test harvesting in code | Pass/fail counts only; per-candidate hidden data; hard-coding check |
| 30 | Cheating | Prompt injection in an answer ("award 100") | Grader injection guard raises a Review signal |
| 31 | Buyer | Empty question bank | About 6,500 expert-reviewed items + role templates |
| 32 | Buyer | 2,000 candidates drown reviewers | Score-first triage; review only the shortlist; target ≤15 reviewer-min per 100 shortlisted |
| 33 | Buyer | Rejected candidates appeal flags that never mattered | Flags not used in a decision are marked "not used" and are not appealable |
| 34 | Buyer | Staffing firms fear clients poaching candidates | White-label client pack with masked contacts and expiring links |
| 35 | Buyer | Paying for no-shows | Bill on started attempts |
| 36 | Buyer | GST invoices, POs, security questionnaires | Razorpay + GST; PO billing; security pack before pilots |
| 37 | Buyer | Price war with Indian tools (Equip lists ₹95 per candidate) | Effective ₹35–79 per credit, more evidence per candidate; sell defensible decisions and review minutes saved |
| 38 | Technical | 20k candidates start at the same minute | Lobby OTP 30 min early; edge session objects; items cached at the edge |
| 39 | Technical | Database outage mid-drive | Tests continue on the session objects for 30+ minutes |
| 40 | Technical | LLM/STT throughput at drive scale | Split SLO; queued grading; capacity booked 48 h ahead; extra grading passes only near cutoffs |
| 41 | Technical | Code sandbox escape and operations | Bought execution service; strict quotas |
| 42 | Technical | College bandwidth (2,000 on a 100 Mbps link) | Assets preloaded days ahead; campus preset with no video; audio at 24 kbps; site bandwidth check |
| 43 | Legal | "India residency" overstated | Stated precisely; S3 Mumbai residency SKU; India-hosted AI inference |
| 44 | Legal | EU AI Act provider duties | Technical file from Phase 0; no EU sale before it is complete |
| 45 | Legal | DPDP timeline may be shortened | DPDP-ready at beta |
| 46 | Trust | A competitor copies "transparency" | Moat = detectors calibrated on overturn data + India-specific handling + published precision + the item bank |
| 47 | Trust | Deck and brief overclaim ("catches hidden apps", Huntress 23%, "Honesty 41") | Claim the "behavioural footprint"; remove the Huntress figure; show the band instead of a number |

## 12. Non-functional targets and quality gates

These targets are launch criteria. A phase does not ship until its gates pass on a load test or a measured study.

| Area | Target |
| --- | --- |
| Capacity | 20k concurrent sessions in one drive; 50k across the platform; 20k starts within 60 s |
| Ingest | 5k event batches/s sustained, 15k burst; acknowledgement p95 <300 ms within India |
| Capture | Event capture p99 <50 ms on a 4 GB laptop; test page load p95 <3 s on 4G |
| Autosave | Data loss ≤5 s online; offline buffer up to 10 min; answers accepted until deadline + 60 s if the sequence is unbroken |
| Timer | Server-held; auto-submit at the deadline |
| Code | Sample run p95 <5 s including queue; hidden-test submit p95 <15 s; 2,000 concurrent runs |
| Reports | Deterministic report (band, MCQ, tests) p95 <30 s after evidence is complete; speech-to-text p95 <5 min; LLM grades p95 15 min (≤2 h for booked drives of 5k+) |
| Evidence upload | On 512 kbps: audio <2 min, video <10 min after submit |
| Availability | 99.9% monthly; 99.95% inside booked drive windows; public status page |
| Recovery | Database RPO ≤2 min / RTO 4 h; evidence RPO 0 after acknowledgement |
| Security | Media links 5 min; candidate token = test duration + 1 h; tenant breach notice 24 h |
| Deletion | ≤30 days including backups |
| Appeals | Candidate response window 72 h; decision SLA 5 business days |
| Reviewer load | ≤15 active reviewer-minutes per 100 shortlisted candidates (median) |
| Accuracy (per detector, from the study) | Precision ≥90%; false-positive rate on honest sessions <5%; otherwise the detector ships as context only |
| Grading | LLM within ±10 of the human grade on ≥85% of the calibration set; speaking-level agreement with human raters ≥0.8 correlation |
| Fairness | Flag-rate and overturn-rate gaps across skin tone, lighting, head covering, gender, native language and device tier reported per release; any gap above 1.25× blocks the release |
| Accessibility | WCAG 2.2 AA, external audit; NVDA, TalkBack and keyboard-only test passes |
| Cost | Variable cost per assessment: MCQ ≈₹0.6, written ≈₹3, code ≈₹6.5, voice ≈₹10.5, video ≈₹11 |

## 13. Pricing, packaging and unit economics

Trace charges one credit per started attempt, with every integrity feature included. Indian buyers compare against [Equip at ₹95 per candidate](https://equip.co/pricing/), not against global suites at $16–20. So Trace competes on evidence per candidate and reviewer-minutes saved, at an effective ₹35–79 per credit. All prices below exclude GST and are hypotheses to confirm in the three paid pilots.

**Credit rule.**

- A standard attempt (MCQ, written or typing) costs 1 credit.
- A voice or video section adds 1 credit.
- A code section adds 1 credit.
- Unstarted invitations are free.
- Proctoring, clips, the evidence report and appeals are always included.

| Plan | Price | Includes |
| --- | --- | --- |
| Free | ₹0 | 50 credits/month, all question types, 1 seat, Trace branding; business email or GSTIN required |
| Pay as you go | ₹79 / credit | Self-serve, UPI or card |
| Credit packs | 1k = ₹55k (₹55) · 5k = ₹2.25L (₹45) · 20k = ₹7L (₹35) | Valid 12 months, no auto-renew |
| Staffing | ₹9,999 / month | 250 credits, 5 seats, client workspaces, white-label client pack, contact masking, ATS integration; overage ₹45 |
| Campus / drive | ₹39 per started candidate (≥2,000 in one drive); voice +₹20 | Drive mode, lab mode, synchronous windows |
| Enterprise | From ₹6L / year (about 15k credits) | SSO, DPA/DPIA pack, residency SKU, Secure Mode, Safe Exam Browser, Trust & Safety appeals desk, SLA, success manager |
| Add-ons | Identity verification at vendor cost + 20% | — |

**Unit economics.** Variable cost per assessment is assumed at ₹88 per US dollar.

| Type | Variable cost | Main drivers | Gross margin at ₹45/credit |
| --- | --- | --- | --- |
| MCQ | ≈₹0.6 | Messaging, edge | \~99% |
| Written (6 answers) | ≈₹3.2 | About 9 LLM calls | \~93% |
| Voice (5 × 2 min) | ≈₹10.5 (2 credits = ₹90) | Speech-to-text ₹7.5, LLM ₹2.3 | \~88% |
| Code (2 problems) | ≈₹6.5 (2 credits = ₹90) | Code execution ≈₹4 | \~93% |

- **Fixed platform cost:** about ₹55k a month (database, compute, edge, tooling). That is ₹11 per assessment at 5k a month, and ₹1.1 at 50k.
- **The real cost is human review time.** Track it as reviewer-minutes per 100 candidates. Score-first triage is what protects the margin.
- **Proof metric for buyers:** shortlist-to-selection rate. This is the share of Trace-shortlisted candidates who clear the client's next round, compared with the firm's own baseline. The guardrail is reviewer-minutes and overturn rate.

**Go-to-market wedge.**

- **Start with:** BPO / customer-support and fresher volume hiring run by mid-size staffing firms. Text and voice provenance are unique there, and the owner decides quickly.
- **Next:** campus drives in the Jul–Sep 2027 season.
- **After SOC 2:** IT services.
- **First 10 customers:**
  - Awign as design partner #1
  - five mid-size staffing firms in Bengaluru, Hyderabad and NCR
  - two BPO/CX companies
  - one tier-2 college placement cell
  - one reseller through an identity-verification or HR-tech channel
- **Offer:** a free shadow drive (up to 500 candidates) alongside their current tool. A paid conversion clause is signed in advance: if shortlist-to-selection improves by ≥15% or review time drops by ≥50%, they convert at a 12-month design-partner price of ₹35/credit.

## 14. Decision log

Each of these 26 decisions went through the same loop: list the options, question them, attack the choice, then lock it. Each one names what would reopen it, so no decision becomes dogma.

| # | Decision | Chosen | Rejected, and why | Reopen if |
| --- | --- | --- | --- | --- |
| 1 | Product shape | Own test platform; SDK in Phase 3 | SDK only: every pilot would depend on a partner. Both at once: about 2× the work | A large platform offers distribution in exchange for an SDK |
| 2 | Lead question type | Written + voice for BPO and support | Code-first: head-on against HackerRank and Codility, who already detect retyping on code | Pilot demand is mostly coding |
| 3 | Wedge customer | Mid-size staffing firms doing BPO and fresher hiring | Campus first: seasonal, price-driven, slow. IT services first: needs SOC 2 | 2+ campus deals close before Phase 2 |
| 4 | Integrity output | Deterministic band + evidence strength | Numeric honesty score: invites automatic cut-offs. ML probability: cannot be explained or appealed | Never for the score. ML may propose evidence only |
| 5 | Evidence trust | Three tiers; client-only signals capped at Review | Equal weighting: everything client-side can be forged | — |
| 6 | When to review integrity | Score-first; shortlisted candidates only | Review everyone: reviewers drown, and flags that never mattered get appealed | A client needs integrity on every candidate (compliance exams) |
| 7 | Candidate recourse | Notice + 72 h response before an integrity rejection; second reviewer decides | Appeal after decision: too late for 48-hour drives | Response rate <10% and no overturns over 6 months |
| 8 | Gaze | Context only | Flag: misfires on honest behaviour and misses on-screen overlays | The study shows precision ≥90% |
| 9 | Mic in non-voice tests | Off in Standard, context in Strict | On by default: Indian home noise | — |
| 10 | AI-likeness of text | Never shown | Show as context: biased, anchors reviewers | A detector proven fair across native languages |
| 11 | Voice integrity | Follow-ups, timing, speaker count; no lip-sync or reading-pattern flags | Behavioural voice analysis: bias and EU emotion-ban risk | — |
| 12 | Video answers | Opt-in, Phase 2 | Default: bandwidth, biometric exposure, little extra evidence | Clients demand video presence |
| 13 | Biometrics | No templates by default; face matching only in the opt-in identity add-on | Continuous face matching for everyone: GDPR Art. 9 / BIPA exposure | — |
| 14 | Under-18 | Blocked at launch; parental-consent flow in Phase 2 | Monitor with notice: DPDP needs verifiable parental consent | Counsel confirms an institutional-consent route |
| 15 | Identity at launch | Start photo + snapshot grid + human check at the next round | DigiLocker for everyone: cost and friction | Proxy fraud found in pilots ≥ 2% |
| 16 | In-test authority | Edge session object per session | Postgres on the hot path: a drive dies when the database blinks | — |
| 17 | Candidate auth | Invite + OTP → Trace-issued token | Supabase Auth for candidates: limits behind shared networks, per-user billing | — |
| 18 | Code execution | Bought execution service | Own sandbox: escape risk and on-call burden for a small team | Volume makes self-hosting ≥10× cheaper |
| 19 | LLM hosting | Claude via an India inference region | US-hosted APIs: data transfer and trust optics | Quality or price gap above 30% |
| 20 | Speech-to-text | Indian vendor behind a neutral interface | Global STT only: weaker on Hinglish | Measured error rate worse than the alternative |
| 21 | Report speed | Split SLO: deterministic <30 s, LLM/STT queued | A single <30 s: impossible at drive scale | — |
| 22 | Media | Stills + flag clips, blurred on the device | Continuous recording: privacy, bandwidth, review load | Enterprise high-stakes tier only |
| 23 | Pricing unit | Credit per started attempt | Per invite: buyers pay for no-shows. Per-type prices: hard to quote | Pilot feedback |
| 24 | Lockdown | Optional Secure Mode helper + Safe Exam Browser in Phase 3 | Mandatory install: drop-off, breaks zero-install | High-stakes certification deal |
| 25 | Fraud rings | Within-drive only; IP never alone | Cross-tenant matching: makes Trace a data fiduciary for its own purposes | — |
| 26 | Thresholds | Rule families public; exact numbers to recruiters, appellants and the instructions for use | Fully public: an evasion guide. Fully secret: undermines appeals | — |

**Related artifacts:** [Competitive Teardown & Build Specification](https://claude.ai/code/artifact/dccfb10b-f0a8-46a3-a239-39236a5b8fbc) (the research behind this plan) · [UI Direction Board](https://claude.ai/artifact/2TEXT7NoGUhchWwbFoN5uc) (screens).
