# Trace — Competitive Teardown & Build Specification

Oct 10, 2026 · @Abhay

## 1. Executive summary

We reviewed about 35 vendors. None of them shows candidates their own evidence or offers an appeal inside the product. That gap, combined with writing-process provenance calibrated to each candidate, is Trace's defensible position. One constraint shapes everything: a browser-only product cannot see invisible overlay apps directly. Trace should therefore sell "the behavioural footprint of assistance", backed by evidence, and add an optional native helper for final rounds.

**Key findings**

1. **The transparency gap is real and confirmed across vendors.**
   - Talview's candidate documentation says outright that candidates cannot see their flags. ExamSoft states "exam-takers do not have access" to results. CodeSignal shares only "Proctoring Rejected" with the employer and deletes the evidence within 15 days. HackerRank, Codility, Mettl and Honorlock show candidates nothing.
   - The nearest things to transparency are Turnitin Clarity, which shows students an abridged report if the instructor allows it, and Integrity Advocate, which emails a violation notice and lets candidates resubmit ID photos. Every appeal route sits outside the product.
2. **The market leaders already went native to catch overlays.**
   - HackerRank's Desktop App force-closes Cluely. Codility's desktop app detects windows that ask to be hidden from screen capture. Honorlock, Talview and Mettl all ship installable apps.
   - Overlays hide themselves through an operating-system flag (`SetWindowDisplayAffinity` on Windows, `NSWindowSharingNone` on macOS). A web page cannot read that flag.
3. **Typing provenance works, but only within limits.**
   - Lab studies detect verbatim transcription (the Cluely-retyping case) with 96–100% recall.
   - Paraphrasing while reading AI output drops detection to 76–89%.
   - Timing-only detectors can be forged: a 2026 study found ≥99.8% of forgeries evaded them. Models also generalise poorly to people they were not trained on (about 64% accuracy on unseen users).
   - The countermeasures are a calibration warm-up for each candidate, features based on where pauses fall, and an "explain your answer" probe that ties the typing to the content.
4. **Competitors are already building this feature.**
   - In CodeSignal's 2026 data, 23% of flags were "unusually linear typing". HackerRank shipped "conversation detection" in its editor, including regional languages typed in English. Codility flags "line-by-line retyping".
   - Codility's Typing Pattern Detection (March 2026) checks only code answers of 10 or more lines, skips essays and multiple-choice questions, and is hidden from candidates. Text-answer provenance for non-coding roles (BPO, support, campus aptitude) is still unclaimed, and that is where Trace should lead.
5. **High flag rates are the industry's hidden problem.**
   - HackerRank's own bias audit flagged about 20–24% of candidates. The California Bar flagged 36%. Fabric flags 38.5% of interviews above a 40% probability threshold.
   - Precision, and published overturn rates for each signal, are Trace's sales weapon.
6. **Regulation favours Trace's design.**
   - EU high-risk obligations apply from 2 Dec 2027 (Regulation (EU) 2026/1744). The EU ban on inferring emotion, which already covers keystrokes and webcams, applies to candidates today.
   - India's DPDP obligations phase in by 13 May 2027. MeitY has consulted on pulling this forward to Nov 2026.
   - The UK's Data (Use and Access) Act requires a right to contest plus human intervention. California's automated-decision rules exempt employers that offer a human appeal.
   - Trace's appeal flow therefore doubles as a compliance feature.
7. **There is room on price.**
   - Comparable per-assessment prices: Glider about $20, HackerRank about $16.50 per attempt, and Talview with a $25k-a-year floor. AutoProctor sits at the bottom at $0.10 per test.
   - At ₹60–100 (about $0.70–1.15), Trace sits between commodity proctoring and enterprise suites.
   - Infrastructure costs about ₹1–3 per assessment at 5,000 or more a month. The real cost driver is human review time.
8. **Direct threats are moving fast.**
   - Fabric (Bengaluru; IT services and staffing) and WeCP/Sherlock already sell into Trace's market.
   - Honorlock has published an interview-integrity admin guide.
   - HireID launched in Aug 2026 with almost Trace's exact promise: every flag links to its signal, and no candidate is rejected automatically.

**What to build first**

1. A shared evidence report with an appeal on every flag. This is the one feature no one else has.
2. Provenance engine v1:
   - paste and blocked-paste detection
   - a burst of typing right after the candidate returns to the tab
   - linearity and revision ratio
   - where pauses fall
   - `isTrusted` checks to spot synthetic keystrokes
   - awareness of Indian-language input methods (IMEs)
3. A calibration warm-up, plus an "explain your answer" probe.
4. A reviewer workflow:
   - an action-items queue
   - a single timeline
   - dispositions that require a written rationale
   - an append-only audit trail
5. A compliance base:
   - a notice and consent ledger
   - no emotion inference
   - no automatic rejection
   - short retention by default
   - accommodation profiles

**Do not build now:**

- in-house deepfake models (use an API when risk escalates)
- Aadhaar authentication status (use DigiLocker through a licensed vendor instead)
- continuous video recording
- a native lockdown browser (integrate Safe Exam Browser later)

## 2. Methodology and limits

Eight research agents ran in parallel on 10 Oct 2026, then their findings were merged into this document. We judged each capability on its own merits, so the winner can differ from one capability to the next.

| Agent | Cluster | Vendors |
| --- | --- | --- |
| A | Indian assessment suites | Mercer Mettl, HackerEarth, Talview, iMocha, InCruiter, Xobin, WeCP, Testlify |
| B | Global assessment platforms | HackerRank, CodeSignal, Codility, TestGorilla, Glider AI, HireVue, Karat |
| C | Proctoring and lockdown | Honorlock, Proctorio, Respondus, ExamSoft, Integrity Advocate, Meazure/ProctorU, Proctor360, Proctortrack, Safe Exam Browser |
| D | Fraud, deepfake, identity, and cheating tools | Fabric, Sherlock, Truely, HireID, Reality Defender, Pindrop, Resemble, BrightHire, Persona, CLEAR, HyperVerge, IDfy, Cluely, Interview Coder, Final Round AI, LockedIn AI, Parakeet |
| E | Writing provenance and research | Grammarly Authorship, GPTZero, Turnitin Clarity, Cursive, Draftback, Revision History, Brisk, TypingDNA, BioCatch, 8 papers (2024–2026) |
| F | Compliance and tech stack | EU AI Act, GDPR, DPDP, UK DUAA, NYC LL144, BIPA, Colorado, CCPA ADMT, WCAG 2.2; browser APIs, MediaPipe, Silero, R2, Supabase, LLM pricing |
| G, H | Hands-on UI teardown in Chrome | Help-centre screenshots, GIFs, Codility's public sample report, and product images |
| Orchestrator | Gap fill | AutoProctor, CoderPad playback, Chrome Web Store reviews |

**Evidence tags used in the clusters:**

- **Seen:** observed in the browser, or in vendor screenshots and docs of the vendor's own UI.
- **Documented:** stated in vendor docs or marketing. This includes performance claims.
- **Reported:** from reviews, press or research papers.
- **Inferred:** our own reasoning.

We used 2025–2026 sources for the current state of each product. Older items appear only as history.

**Scoring:** each capability was judged on five criteria:

- effectiveness
- quality of the evidence
- fairness to candidates
- recruiter time
- how feasible it is for Trace to build on React, Node, Supabase and R2

**Limits:**

- **No accounts or trials.** We created no accounts and started no trials (a hard rule), so dashboards behind a login were reconstructed from help centres.
- **Search ran out.** The 200-call web search budget shared by the agents was used up partway through.
- **The Chrome extension stopped responding** partway through. As a result, Mettl, Talview, iMocha and Glider are covered from docs, not from their live UI.
- **Some review sources were unavailable.** Reddit and Glassdoor were not indexed, so candidate sentiment comes from Trustpilot, Capterra and the Chrome Web Store.
- **Accuracy claims are unaudited.** Every vendor accuracy figure here is self-reported.

**Close the gaps by hand.** To fill these gaps, sign up yourself for free trials of HackerRank, TestGorilla and Codility. A guided walkthrough in your logged-in browser would then confirm the dashboard details.

## 3. Landscape map

Every integrity vendor reviewed outputs either a single label or a single score. None gives the candidate a view of the report. The vendors with serious defences against overlay apps all require an install. Prices and ratings are the latest public figures found (2025–2026). Ratings show review counts in brackets.

| Vendor | Cluster | Delivery | Integrity output | Candidate sees report | Price signal | Rating |
| --- | --- | --- | --- | --- | --- | --- |
| [Mercer Mettl](https://support.mettl.com/portal/en/kb/articles/candidate-credibility-index-in-proctoring-reports-18-4-2023) | India suite | Native secure browser (.exe) plus web webcam; no mobile | Credibility Index High/Med/Low with client-set weights (beta) | No; hidden even from shared reports | Quote only; G2 rates cost high | G2 4.4 (506) |
| [HackerEarth](https://help.hackerearth.com/advanced-proctoring-settings-smart-browser) | India suite | Web by default; optional Smart Browser (Win/Mac/Linux) | One blended Integrity index | No | $99–399/mo (\~$10–16 per credit) | G2 4.5 (608) |
| [Talview](https://docs.talview.com/center-and-proctor-administration/session-playback/summary-report/faqs/session-summary-report-faqs) | India suite | Native Talview Secure Browser plus web; Alvy agentic AI proctor | Needs Review/Low/High, AI summary, incident clips | No (docs say so explicitly) | From $25k/yr | G2 4.4 (122); Trustpilot 2.6 |
| [iMocha](https://imocha.io/cheating-prevention) | India suite | Web plus installable Safe Assessment Browser | "Cheating intensity" L/M/H; red/amber/green per parameter | No | \~$400/mo (third-party) | G2 4.4 (276) |
| [InCruiter](https://incruiter.com/proctoring-software) | India interviews | Own video stack | AI trust score; deepfake checks (rPPG, face–voice sync) | No | Quote | Capterra 4.8 (80) |
| [Xobin](https://xobin.com/pricing/) | India suite | Web plus lockdown module | Rule-based proctoring | No | $599–2,000 flat; staffing volume tiers | G2 4.7 (232) |
| [WeCP / Sherlock](https://www.sherlock.sh/) | India interviews | Meeting-link takeover (Zoom/Meet/Teams) | Real-time alerts; "92–97%" accuracy claims | No | $100/mo for 10; $1,500/mo for 300 | n/a |
| [Fabric](https://fabrichq.ai/blogs/how-ai-interviews-detect-cheating-a-technical-deep-dive) | AI interviews (Bengaluru) | Web AI interviewer, no install | Cheating probability by category; flags above 40% | No | Custom; older $250/mo for 50 | n/a |
| [AutoProctor](https://www.autoproctor.co/) | Light proctoring | Web; JS SDK; Google Forms add-on | Trust Score % ("Highly Likely Candidate Cheated") | Not stated | $0.10/test; from $15/mo | n/a |
| [HackerRank](https://hackerrank-knowledge-base.help.usepylon.com/articles/9607697321-review-integrity-issues-in-proctor-mode) | Global assessment | Web Secure/Proctor Mode plus Desktop App (kills Cluely) | High/Medium/No issues, plus a plain-English list of reasons | No | $165/mo for 10 attempts | G2 4.5 (569) |
| [CodeSignal](https://support.codesignal.com/hc/en-us/articles/16957476906135-Using-Suspicion-Score) | Global assessment | Web; proctoring reviewed by CodeSignal staff | Suspicion None–High per question | No; evidence deleted after 15 days | From $79/mo | G2 4.5 (1,408); Trustpilot 2.8 |
| [Codility](https://www.codility.com/1p/codility-proctoring-integrity/) | Global assessment | Web plus desktop app (preview) | Deterministic Integrity Risk None–High | No | $100–500/mo | G2 4.6 (906) |
| [TestGorilla](https://support.testgorilla.com/hc/en-us/articles/46569751180699) | Global SMB | Web; Veriff for ID | No/Some/Major issues, each with a recommended action | No | Core $142/mo | G2 4.5 (1,449); Trustpilot 3.6 (1,722) |
| [Glider AI](https://glider.ai/what-is-ai-proctoring-hiring-guide/) | Staffing/MSP | Web plus browser plugin | Cheating Probability Score; log of dismissed flags | No | \~$20/assessment ($60k minimum) | G2 4.7 (159) |
| [HireVue](https://www.hirevue.com/platform/cheating-and-fraud) | Enterprise video | Web | Fraud indicators plus audit trail | No | $35k–145k/yr (third-party) | G2 4.1 (255) |
| [CoderPad](https://coderpad.io/resources/docs/screen/review-results/playback/) | Live coding | Web | Markers for pastes and leaving the editor on playback | Not stated | Not researched | n/a |
| [Honorlock](https://teaching.resources.osu.edu/toolsets/carmencanvas/guides/getting-started-honorlock/viewing-honorlock-results) | Proctoring | Chrome extension plus optional app | Low/Med/High plus human "Confirmed" | No; feedback by email | $4.45/exam | G2 4.5 (92) |
| [Proctorio](https://eCampus.oregonstate.edu/faculty/exam-proctoring/Proctorio%20Gradebook%20Guidance.pdf) | Proctoring | Chrome extension | Suspicion %, reweightable after the exam | No | Per-exam or flat | G2 4.1 (37); Chrome Store 1.1 |
| [Respondus Monitor](https://web.respondus.com/monitor-review) | Proctoring | Native LockDown Browser | Review Priority L/M/H; flags vs milestones | No | \~$15/student/yr | G2 2.4 (9) |
| [ExamSoft](https://support.examsoft.com/hc/en-us/articles/11166685091341) | Proctoring | Native Examplify | Likelihood plus disposition workflow | No ("no access") | Quote | n/a |
| [Meazure / ProctorU](https://meazurelearning.com/exam-technology/proctoru-online-proctoring/review-plus) | Live proctoring | Native Guardian browser plus humans | Incidents only after human confirmation | No | $17.50–51.25/exam | Trustpilot 1.1 (163) |
| [Integrity Advocate](https://intercom.help/integrity-advocate-help-center/en/articles/12032333-potential-violation-of-rules-message) | Privacy-first proctoring | Web, no download | Valid/Invalid; a human reviews every flag | Violation email; ID resubmission; appeal handled outside the product | Quote | Capterra 4.9 (10) |
| [Proctor360](https://www.proctor360.com/) | Proctoring | Web plus 360° headset; phone as a second camera | Not documented | Not documented | Per session | Capterra 4.5 (2) |
| [Safe Exam Browser](https://safeexambrowser.org/developer/seb-config-key.html) | Lockdown | Native, open source | Lockdown only; Config Key verification | n/a | Free | n/a |
| [Reality Defender](https://www.realitydefender.com/product/realmeeting) | Deepfake | Meeting bot plus API | Authentic/Manipulated plus confidence | n/a | API: 50 free scans/mo | n/a |
| [Pindrop Pulse](https://www.pindrop.com/solution/meeting-security/) | Deepfake / voice | Meeting integration | Synthetic-media and voice-mismatch risk card | n/a | Quote | n/a |
| [HireID](https://www.newsfilecorp.com/release/309790) | Interview fraud | Intake plus meeting integration | 20+ signals; every flag linked to its signal; no automatic rejection | n/a | Quote | n/a (launched Aug 2026) |
| [Persona](https://withpersona.com/blog/introducing-candidate-verification-solution-by-persona) / [CLEAR](https://greenhouse.com/newsroom/greenhouse-and-clear-announce-partnership-to-enable-candidate-verification) | Identity (US) | ATS-integrated ID plus selfie | Verified / flagged | n/a | Quote | n/a |
| [HyperVerge](https://hyperverge.co/news/liveness-level2-compliant/) / [IDfy](https://www.capterra.com/p/241741/IDfy/) | Identity (India) | API: DigiLocker, liveness, face match | Match plus liveness result | n/a | Quote | IDfy Capterra 4.4 (28) |
| [Grammarly Authorship](https://www.grammarly.com/authorship) | Writing provenance | Editor extension | % typed / pasted / AI, plus replay | Writer owns and shares the report | Free and Pro | n/a |
| [GPTZero Writing Report](https://gptzero.me/writing-report) | Writing provenance | Google Docs extension | Typing-naturalness gauge plus replay | The owner shares the link | Not confirmed | n/a |
| [Turnitin Clarity](https://guides.turnitin.com/hc/en-us/articles/36916426919949) | Writing provenance | Composition space | Rule-based flags with published thresholds | Abridged report, if the instructor enables it | Quote add-on | n/a |
| [Cursive](https://moodle.org/plugins/tiny_cursive) | Writing provenance | Moodle plugin | Typing-biometric authorship | Student sees playback | $2/student/yr | n/a |

**The adversary.** Cluely costs up to $149.99/mo for its "Undetectability" tier. Interview Coder costs $299/mo, Final Round AI $25–150/mo, and LockedIn AI $55–120. Parakeet charges per credit. All of these hide through OS capture-exclusion flags, and several also listen to system audio. Cluely's CEO admitted in Mar 2026 that his earlier ARR claim was false, and the company has since rebranded as a note-taker. Stealth copilots that sell specifically for interviews are still growing.

## 4. Best-in-class matrix

The best version of each capability comes from a different vendor. No one vendor wins on more than three capabilities. Trace's plan is to combine these winners and add the one thing none of them have: a report the candidate can see and appeal. The table below picks a winner for each capability.

| Capability | Winner | What they do best | Runner-up | How Trace does it better |
| --- | --- | --- | --- | --- |
| Provenance visualisation | **Grammarly Authorship** | One colour bar showing % typed / copied / unknown; each sentence tinted by origin, with margin labels; replay timeline in the same colours | Turnitin Clarity | Every tint links to the raw event (time, size, preceding blur). Adds a "focus lost" state. Every "unknown" is given a named cause. |
| Evidence ↔ timeline linking | **Turnitin Clarity** | Numbered findings on the timeline; playback pauses automatically at each finding; clicking a card, the timeline or the document moves the other two | HackerRank Session Replay | Same three-way link, extended with camera and mic tracks and the candidate's explanation on each flag. |
| Code / keystroke replay | **CodeSignal** | Up to 32× speed, skips idle time, filterable paste markers with sizes, clickable activity list | CoderPad, HackerRank Codeplayer | Same controls, plus burst-after-blur markers and "Changed/Unchanged" status on each paste. |
| Multimodal session replay | **HackerRank** | Screen, webcam and a searchable event list in sync; flagged spans marked red on the scrubber | Honorlock dual-pane player | Each track coloured by signal family, not one red; clips captured only around flags, so no full recording. |
| Reviewer workflow | **Honorlock** | Action-items inbox; severity dictionary; outcomes Clean/Confirmed/Further review with a required summary; append-only history; 20× playback; downloadable evidence zip | ExamSoft disposition states | Adds appeals as an item type, shows the reviewer's rationale to the candidate, and reports overturn rate per signal. |
| Scoring model | **Codility** | Deterministic Integrity Risk with no ML; answers to AI follow-up questions count as evidence but not toward the score | TestGorilla tiers | Deterministic band plus evidence strength; the rule table is versioned and frozen when the test starts. |
| Quality vs integrity separation | **Codility** | Shows a 100% score next to "Integrity risk: High" as two separate cards | HackerRank three tiles | Two equal cards, each with one sentence of rationale; never blended, at question level or overall. |
| Flag explanation | **Honorlock** | Public flag dictionary: flag, severity, trigger, settings that affect it | Respondus false-positive causes; Turnitin thresholds | Each flag card links to its dictionary entry; candidates see the same dictionary before starting. |
| Typing-signal depth | **HackerRank** | Code-reset pattern; "conversation detection", including regional languages typed in English | Codility Typing Pattern Detection (code only, hidden from candidates); CodeSignal "description copy" + typing linearity | Adds where pauses fall, a per-candidate baseline, content-alignment (CLC) and IME-aware handling. |
| Overlay detection | **Codility desktop app** | Detects any window excluded from screen capture, whichever tool it is | HackerRank force-closes named apps | Optional "Secure Mode" helper for final rounds that shows the candidate exactly what it scans. |
| Candidate onboarding | **HackerRank** | Step-by-step gate: compatibility check → consent listing prohibited actions → permissions → fullscreen | Integrity Advocate rules-before-start | Adds a live preview of what is captured and a private accommodation declaration. |
| Fairness and recourse | **Integrity Advocate** | A human reviews every flag; email names the specific violation; fixable issues can be corrected without a retake | Respondus warns before it flags | Appeal inside the product on each flag, with a response deadline and a named reviewer. |
| Identity (India) | **HackerEarth** | DigiLocker e-KYC; face matched against 5 reference captures | Glider ID chain across rounds | Uses HyperVerge/IDfy, then checks face continuity throughout the session. |
| Deepfake | **InCruiter** | rPPG liveness, face–voice sync, clip saved without interrupting the session | Reality Defender API; Pindrop cross-round voice | Only when risk rises: occlusion and head-turn challenge, then a clip sent to a detection API. |
| Audio | **Glider AI** | Detects one or multiple human voices | Honorlock wake-word detection; Mettl speaker count | Voice-activity detection plus "speech while mouth closed"; no voiceprints stored. |
| Second device | **Mettl / Proctor360** | Phone as a second camera, paired by QR code | Honorlock Apple Handoff (native only) | Web-only QR + WebRTC pairing for high-stakes roles. |
| Lockdown | **Safe Exam Browser** | Free, open source, cryptographic Config Key check on every request | Respondus LockDown | Optional tier; Config Key verification result recorded in the report. |
| Data minimisation | **Integrity Advocate** | Shares still frames only; video deleted 24 h after review | CodeSignal 15-day deletion; Proctorio client-side encryption | On-device ML; flag clips only; retention timer visible in the report. |
| Recruiter dashboard | **HackerRank** | Integrity column and filters; page through candidates inside the modal; integrity status pushed to the ATS | CodeSignal KPI tiles + drawer | Sort by honesty independently of score; bulk "send report to candidate". |
| Leak protection | **CodeSignal LeakSweep** | Scans the web for leaked questions and handles DMCA takedowns | Glider per-candidate watermarking | Watermarking per candidate in P2. |
| Content binding | **Codility AI Follow-Up Questions** | Three questions written for each submission, 2 minutes each, with pasting blocked and keystrokes monitored; the transcript appears in the report | HackerEarth "Surprise Question" | A 60–90 s explain-or-modify probe, triggered when risk is high and itself checked for provenance. |
| Data as marketing | **Fabric / CodeSignal** | Publish "state of cheating" reports | HireVue whitepaper | Publish precision and overturn rates, not just cheating rates. |
| Recruiter reviews | **Glider AI** (G2 4.7) / **Codility** (4.6 from 906) | Ease of use, strong anti-cheating | HackerEarth 4.5 (608) | n/a |
| Candidate reviews | **None good** | Best large sample: TestGorilla, Trustpilot 3.6 | Everyone else ≤2.8 | Trace's whole design targets this gap. |

## 5. Review mining

Recruiters mostly rate these tools well, typically 4.4–4.7 on G2. Candidates rate them poorly, typically 1.1–2.8 on Trustpilot and the Chrome Web Store. Candidate complaints are about glitches, privacy, and false flags they have no way to dispute. Recruiter complaints are about flags they cannot explain. Both complaints point to the same fix: evidence both sides can see.

**Recruiter / admin side**

| Theme | Direction | Where it shows up | Implication for Trace |
| --- | --- | --- | --- |
| Easy setup and clean UI | Praise | HackerEarth (\~6 of 10 recent reviews); Codility (G2 ease of use 9.1); Glider | Set up an integrity test in under 5 minutes using presets. |
| Strong anti-cheating and AI detection | Praise | Glider; Codility (9 G2 mentions) | Buyers pay for detection depth. Lead the demo with the provenance replay. |
| Responsive support | Praise | Talview, iMocha, Xobin, InCruiter | Founder-led support during pilots is a selling point. |
| Flags not explained well enough to justify a decision | Complaint | HackerRank (Dec 2025); CodeSignal (G2 summary: "need for better monitoring and reporting transparency") | Evidence cards with rule, threshold, observed value and innocent explanations. |
| Cluttered UI and rigid dashboards | Complaint | HackerRank, HackerEarth (3/10), Talview | Low-density default view; detail only when expanded. |
| Opaque or high pricing, billing disputes | Complaint | HackerRank, Talview, Mettl, TestGorilla (auto-renewal) | Publish INR prices per assessment; no auto-renew traps. |
| Slow results or configuration changes | Complaint | iMocha (result latency), Talview (\~2 weeks per config change; integrity report up to 24 h) | Report in under 30 s; self-serve settings. |
| Video and audio missing on cheaper plans | Complaint | HackerEarth | Flag clips included in every plan. |

**Candidate side**

| Theme | Approx. share | Where it shows up | Implication for Trace |
| --- | --- | --- | --- |
| Technical failures, lost work, crashes | Largest theme | CodeSignal (Trustpilot 2.8, 64% one-star); ProctorU (about half of reviews); HireVue; Talview system checks; Proctorio crashes | Autosave each keystroke batch to IndexedDB. Treat infrastructure failures as non-flags. Pre-check with a CPU benchmark. |
| Privacy, "spyware" | High | Proctorio Chrome Web Store 1.1 (about 6 of 10 recent reviews); Talview consent ("it's not consent if you can't reject") | No install. ML runs on the device. Show the candidate a live view of exactly what is captured. |
| False flags with no recourse | High impact | TestGorilla (Sep 2026: flagged for tab switching without leaving the test, rejected the next day); California Bar history | Appeal on each flag; a human decides; no automatic rejection. |
| Install, firewall, antivirus friction | Medium | Mettl (asks candidates to disable antivirus); Talview (install 15–20 min early) | Browser-first default. |
| Accessibility | Medium | Talview (earpiece ban affects hearing-aid users; 360° room scan) | Accommodation profiles that switch off the affected detectors, without disclosing the condition to the recruiter. |
| Intrusive live proctors, anxiety | Medium | ProctorU (Trustpilot 1.1, 97% one-star); Honorlock (Ohio State) | Passive, asynchronous monitoring. Plain-language rules. No live interruptions. |

**What reviewers want, in one line:** recruiters want to defend their decision, and candidates want to be heard. One shared report with an appeal on each flag serves both.

**Confirm before launch:** Reddit (r/developersIndia, r/cscareerquestions), AmbitionBox and Glassdoor were not indexed in this run. Ten candidate interviews during the pilots would confirm the candidate-side themes.

## 6. UI teardown and Trace design spec

**Trace's UI should combine three products.** It should match Codility's visual discipline, make provenance as readable as Grammarly, and link evidence to the timeline the way Turnitin does. Then it adds Honorlock's reviewer workflow. All of this sits on one report that both the recruiter and the candidate see.

**UI rankings from the teardown**

| Dimension | 1st | 2nd | 3rd | Weakest seen |
| --- | --- | --- | --- | --- |
| Visual polish | Grammarly (5/5) | Codility (4.5) | HackerRank, Turnitin, GPTZero (4) | Mettl (2.5, dated); Proctorio (2, cluttered) |
| Recruiter dashboard | HackerRank | CodeSignal | TestGorilla | Glider (no evidence available) |
| Evidence / flag review | Honorlock | Turnitin Clarity | Codility sample report | GPTZero (gauges with nothing to anchor them) |
| Provenance visualisation | Grammarly | Turnitin Clarity | GPTZero | Proctorio (none) |
| Candidate test-taking UX | HackerRank (staged gate) | TestGorilla (light friction) | Integrity Advocate (rules upfront) | Mettl (OTP + ID + lockdown; auto-terminates when the mic is muted) |
| Candidate transparency | Grammarly (writer owns the report) | Turnitin (abridged report) | Integrity Advocate (violation emails) | ExamSoft, Talview (none) |

Sources: browser screenshots of help articles from HackerRank, CodeSignal, Codility, TestGorilla, Grammarly, GPTZero, Turnitin, Proctorio and Honorlock, plus [Codility's public sample report](https://app.codility.com/public-report-detail/).

### 6.1 Design principles

1. **Two equal cards, never blended.** Answer Quality and Integrity Signals carry the same visual weight, each with one sentence of rationale.
2. **Evidence before verdict.** Every summary clause links to a moment in the timeline. No emoji gauges and no bare percentages.
3. **Show what was checked.** Signal families with nothing found stay visible as green "Not found" rows, as in Codility.
4. **Colour only where it means something.** Neutral greys by default. One colour per signal family, used the same way on every view. Red only for confirmed or hard evidence.
5. **Observed language, not accusation.** Write "Pasted 234 characters at 12:34", not "cheating instance".
6. **The same report on both sides**, enforced in the data layer (Row Level Security, section 9).

### 6.2 Candidate flow

1. **Open the link.** No login: a magic link or OTP.
2. **Device check.** Camera, mic, browser, network, a 5-second CPU benchmark (it sets the ML frame rate), and IME/keyboard detection. Low light shows a warning; it never blocks.
3. **Transparency screen.** What is captured, what is not, who sees it, how long it is kept, and the candidate's rights. It ends with: "You will see the same report and can appeal any flag." A live preview shows exactly what the reviewer will see.
4. **Rules contract.** Per-test rules in plain language, for example paste allowed or blocked and notes allowed. Each version is stored with the session. The candidate can make an optional, private accommodation declaration.
5. **Permissions, one at a time.** Camera, then mic, then screen info. Each prompt explains why it is needed.
6. **Calibration warm-up.** Two ungraded 60-second tasks: free writing ("describe your last project") and a short copy-typing passage. These set the candidate's own baseline.
7. **Fullscreen start.** A status pill stays visible: "Camera · Mic · Typing · Focus are recorded."
8. **In-test nudges before flags.** A first fixable event, such as leaving fullscreen, shows an inline warning with an optional "what happened?" box. A nudge the candidate corrects is logged but not flagged.
9. **Submit.** The candidate gets a receipt with a session ID, a hash of the evidence log, and the date the report will be available.
10. **Report and appeal.** The report is visible once a reviewer has finished, or within 7 days. Each flag has an "Explain / Appeal" button with free text and an optional supervised re-attempt.

### 6.3 Recruiter dashboard

- **Home: Action Items inbox.** Covers sessions needing review, open appeals with a countdown to their deadline, and evidence still uploading. The counter counts down to zero (Honorlock).
- **Candidate table columns:** name, test, Quality score, Integrity band, evidence strength, top 2 signals with icons, appeal status, reviewer, decision.
- **Filters:** band, signal family, appeal status, reviewed or not, cohort percentile, accommodation applied (a flag only, never the reason).
- **Report as a drawer** with PREV/NEXT and J/K keys (CodeSignal, HackerRank).
- **Bulk actions:** send reports to candidates, export a CSV with links to the evidence, push to ATS/VMS by webhook.
- **Test setup:** presets (Strict / Standard / Open-book), an override per question (allow or block paste, notes), and a link to the flag dictionary. Settings lock once the first candidate starts; any change creates a new version.

### 6.4 Evidence report layout (top to bottom)

1. **Header:** candidate, test, the receipt hash, the ruleset version, and a retention timer.
2. **Two cards side by side.** *Answer Quality* (score, rubric breakdown, one-line rationale). *Integrity Signals* (Clear / Review / Strong concern band, evidence strength, and one plain sentence whose clauses each link to evidence).
3. **Signal table by family.** Typing, Paste, Focus, Camera, Mic, Environment, Identity. Each row shows status, count or duration, and a Review link (Codility pattern).
4. **Per-question cards.** Both scores, a stats line ("241 words · 34 min active · 1 paste · 0 blocked · 2 focus losses · product/process 0.82"), and the answer text tinted by origin.
5. **Unified timeline.** Separate tracks for setup, questions, typing cadence, pastes, focus, camera and mic. Numbered finding bubbles. Idle stretches compressed. Speeds of 1–20×.
6. **Replay pane.** Keystroke-level text replay alongside the flag clip. Playback pauses automatically at each finding.
7. **Flag cards.** Each shows the rule, its threshold family, the observed value, a percentile against the candidate's own baseline, "common innocent explanations", the candidate's explanation, and the appeal status.
8. **Audit trail.** Every view, decision and rationale, shown to both sides.

&#91;embedded content: Trace evidence report · layout wireframe, top to bottom\]

Clicking a numbered finding on the timeline opens its flag card and moves the replay to that exact moment. The Appeal button sits on every flag card.

High-fidelity mockups of the evidence report, the reviewer and appeal console, the candidate transparency screen, the integrity setup screen (with working Strict / Standard / Open-book presets) and a feature-champions board are on the [Trace UI Direction Board](https://claude.ai/artifact/2TEXT7NoGUhchWwbFoN5uc). The evidence report has a working Recruiter / Candidate toggle.

### 6.5 Reviewer and appeal console

- **Three panes:** the evidence (clip, replay, signal values) on the left, the candidate's appeal text and their in-test explanation in the middle, and the decision panel on the right.
- **Decisions:** Uphold / Overturn / Partially uphold / Needs second reviewer. A written rationale is required for any outcome against the candidate, and the candidate sees it.
- **Deadlines:** a 5-business-day SLA timer. An escalation goes to a second reviewer when the first reviewer also made the original call.
- **Reviewer quality:** track each reviewer's consistency (Mettl's "proctor the proctor") and overturn rate per signal.

### 6.6 Copy lexicon

| Avoid | Use |
| --- | --- |
| Cheating detected / cheating intensity | Integrity signals: review suggested |
| Suspicion 45% | 3 signals in 2 families, moderate evidence |
| Candidate looked nervous | Gaze off-screen 6 times, 41 s total |
| Unknown source | Text entered before monitoring started (excluded from scoring) |
| Catch the bluff | Explain your answer |

## 7. Feature specification

The build splits into three tiers: 14 P0 items for the Awign Hackathon demo, 16 P1 items for the 90-day pilots, and 10 P2 items for later. Every feature already in the brief survives, but 9 of them need a concrete change before they are production-grade.

### 7.1 Features already in the brief: how to make each one better

| Brief feature | Keep? | Upgrade | Source of the idea |
| --- | --- | --- | --- |
| Keystroke timing | Yes | Store each key's class (letter / digit / space / backspace / navigation / modifier) with timestamps quantised to 5 ms, never the key itself. Add where pauses fall, burst length, and the candidate's own warm-up baseline. | Crossley 2024; Condrey 2026 |
| Paste events and blocking | Yes | Default is **allow and log**; blocking is an employer setting. Ignore copy-paste within the page. Record the paste size, a hash, and a Changed/Unchanged status at submit. Show a blocked attempt as a red caret mark. | Turnitin Clarity; accessibility |
| Drag-and-drop and right-click blocking | Yes | Log drop events with their size, the same way as pastes. | — |
| Tab-blur then burst | Yes | Rule: ≥40 characters typed within 20 s of returning to the tab, at ≥1.5× the candidate's median speed, with no deletions. Draw it on the writing curve as a shaded gap followed by a steep line. | Agent E design |
| Revision patterns | Yes | Add the product/process ratio, deletion ratio, edits made far back in the text, and linearity, each compared with the candidate's own composing baseline. | Crossley; CodeSignal linearity |
| Camera (no face, multiple faces, looking away) | Yes | On-device MediaPipe: face detector at 3 fps, landmarker at 1 fps. Report only durations. **No emotion labels** (EU AI Act Art. 5). Low light is recorded as an evidence-quality problem, never as a flag. | MediaPipe; AI Act |
| Mic (second voice, speech) | Yes | Silero voice-activity detection plus "speech while mouth closed". No voiceprints. Suppress automatically when a screen reader's text-to-speech is active. | Glider; BIPA |
| Forced fullscreen, tab switch, blur | Yes | Treat these as nudges: warn first, flag only when repeated. Record the reason the candidate gives. Never auto-submit by default. | Respondus; Integrity Advocate |
| Auto-pause / warn / auto-submit | Change | Default to **warn and log**. Auto-submit is opt-in, and it must show the candidate a reason screen. | HackerRank exclusion rules (anti-pattern) |
| Quality score (LLM rubric) | Yes | Cheap model first; escalate to a stronger model only when confidence is low (\~10% of answers). Store the rubric version. Check it reaches ≥0.8 correlation with human graders on 200 answers. | Agent F pricing |
| Honesty score | Change | A **deterministic band** (Clear / Review / Strong concern) plus evidence strength, not a percentage. The rule table is versioned. ML only proposes evidence. | Codility; anti-pattern of a single suspicion % |
| Evidence report | Yes | Use the layout in section 6.4. A self-contained evidence package (HTML + clips + JSON) can be downloaded by both sides. | Honorlock evidence zip |
| Appeals and overturn tracking | Yes | Appeal on each flag, a 5-business-day SLA, a required rationale, a second-reviewer rule, and an overturn-rate dashboard for each signal that can be shown to buyers. | Unique |

### 7.2 New features by priority

| # | Feature | Priority | Acceptance criteria | Source |
| --- | --- | --- | --- | --- |
| 1 | Shared report with per-flag appeal | P0 | Candidate and recruiter render from the same table, enforced by RLS. An appeal is created in ≤2 clicks. | Unique |
| 2 | Transparency screen + rules contract + consent ledger | P0 | Stores the notice-version hash, timestamp, IP and an e-signature checkbox. Consent can be withdrawn. | IA; DPDP; BIPA |
| 3 | Calibration warm-up (compose + copy-type) | P0 | Two 60 s tasks. Provenance flags compare against the candidate's own baseline. | Research (82% vs 64% accuracy) |
| 4 | Writing curve + origin-tinted answer text | P0 | Cumulative-characters curve with focus bands and paste spikes. Every tint links to its event. | Grammarly; Turnitin |
| 5 | Keystroke text replay with finding bubbles | P0 | 1–20× speed, skips idle time, pauses automatically at each finding, J/K to move between findings. | CodeSignal; Turnitin |
| 6 | Event-integrity checks | P0 | `isTrusted=false`, input with no keydown, uppercase with no Shift, constant key-hold time. Each becomes hard evidence. | Agent E |
| 7 | IME / composition-aware capture | P0 | No burst flags inside composition events or `insertReplacementText`. Tested on Gboard Hinglish, an Indic keyboard and voice typing. | Agent F |
| 8 | Question-copy signal | P0 | Logs copy of the prompt text and the delay until the first typing burst. | CodeSignal "description copy" |
| 9 | Deterministic band + flag dictionary | P0 | Rule table published inside the product. Settings frozen at test start. | Codility; Honorlock |
| 10 | Reviewer queue + dispositions + audit trail | P0 | Action Items inbox. Outcomes require a rationale. History is append-only. | Honorlock; ExamSoft |
| 11 | Flag-triggered clip capture | P0 | 10 s MediaRecorder segments; 20–30 s kept per flag; upload to R2 via presigned PUT with retries from IndexedDB. | Agent F |
| 12 | Accommodation profiles | P0 | Time multiplier. Detectors switch off for screen-reader, dictation or switch-access users. The recruiter sees only "accommodation applied". | WCAG 2.2.1; RPwD |
| 13 | No-auto-reject guard | P0 | The system cannot set Reject from integrity signals. A human action and a logged reason are required. | GDPR Art. 22; DUAA |
| 14 | Age gate | P0 | Monitoring is disabled for under-18 candidates in India. | DPDP s.9(3) |
| 15 | "Explain your answer" probe | P1 | A 60–90 s spoken or typed follow-up when the band is Review or worse. Its provenance is scored too, but the answer is evidence, not part of the score. | HackerEarth; Codility |
| 16 | Pause-location and content-alignment (CLC) features | P1 | Pause shares before sentences, before words and within words, and the correlation between word surprisal and the pause before it, via a small LM. | Crossley; Condrey |
| 17 | Time-to-first-input ("lag loop") per question | P1 | Latency and its variance plotted against difficulty. | Fabric |
| 18 | Environment strip | P1 | `screen.isExtended`, virtual-camera labels, VM renderer string, DevTools heuristic (low weight). | Agents D, F |
| 19 | Cohort baseline | P1 | Percentiles shown only when there are 20 or more candidates on the same test. | Turnitin; Proctorio |
| 20 | Overturn-rate dashboard per signal | P1 | Weekly precision estimate per detector. A detector is auto-flagged for retuning when its overturn rate exceeds 30%. | Unique |
| 21 | Non-interrupting threshold alerts | P1 | Live monitor through Supabase Broadcast. Saves the clip without pausing the candidate. | InCruiter |
| 22 | Fix without retake | P1 | A bad ID or selfie photo can be resubmitted from a phone link after the session. | Integrity Advocate |
| 23 | Phone as second camera (QR + WebRTC) | P1 | Optional for high-stakes roles. Disconnecting is logged as an evidence-quality event. | Mettl; Proctor360 |
| 24 | ATS/VMS webhook + CSV with evidence links | P1 | Integrity band, quality score and report URL pushed when a decision is made. | HackerRank |
| 25 | Drive-level fraud-ring analytics | P1 | Same device fingerprint, IP or ASN, near-identical answers and duplicate ID metadata across a hiring drive. | Agent D (Huntress) |
| 26 | Tamper-evident hash-chained logs | P1 | Chain verified on export; any missing batch is itself logged as a signal. | AI Act Arts. 12, 19 |
| 27 | DPIA pack + DPA + sub-processor list | P1 | Needed before the first UK/EU sale. | GDPR Arts. 28, 35 |
| 28 | Bias monitoring | P1 | Voluntary self-reported demographics, stored separately. Flag rates and overturn rates by group. | ICO; NYC LL144 |
| 29 | Reviewer "Investigate" chat | P1 | An LLM over the event log. Every answer must cite replay timestamps. | GPTZero |
| 30 | India identity | P1 | DigiLocker fetch + passive liveness + 1:1 match via HyperVerge or IDfy, with explicit consent. Store only a masked ID and the match result. | HackerEarth; Agent D |
| 31 | In-session face continuity | P2 | Compare against the enrolment selfie every N seconds. Biometric, so explicit consent and an alternative path are required. | Talview; Glider |
| 32 | Escalation-only deepfake check | P2 | Occlusion and head-turn challenge, then a clip sent to Reality Defender or Resemble. | Agent D |
| 33 | Trace Secure Mode helper (Win/macOS) | P2 | Lists processes, finds windows excluded from screen capture, detects virtual drivers and remote-access tools. The candidate sees the scan list. | Codility; HackerRank |
| 34 | Safe Exam Browser integration | P2 | Config Key computed on the server and verified on every request. Result recorded in the report. | SEB docs |
| 35 | Auto-typer adversarial training set | P2 | 7–10 auto-typer tools × several presets used as negative examples in training. | GPTZero; research |
| 36 | Per-candidate question watermarking + leak scan | P2 | A unique variant per candidate; weekly web scan for leaked questions. | Glider; CodeSignal |
| 37 | Live-interview integrity (Meet/Zoom link) | P2 | Lag loop, second voice, deepfake escalation. | Fabric; Sherlock |
| 38 | Cross-round identity continuity | P2 | Face and voice continuity from test to interview to offer, with explicit consent. | Pindrop; Persona |
| 39 | AI-allowed assessment mode | P2 | AI chat built into the test. Prompts are logged and shown in the report. | CodeSignal Cosmo |
| 40 | Published integrity report | P2 | Quarterly precision, overturn rate and cheating base rates. | Fabric, CodeSignal (marketing engine) |

### 7.3 Deliberately skip

- **Emotion, stress or confidence inference from any modality.** It is illegal in the EU now and indefensible everywhere.
- **Continuous full-session video by default.** It costs \~150 MB of upload per hour, hurts privacy, and adds review burden. Offer it as a premium option only.
- **Mandatory 360° room scans.** These carry legal risk (Ogletree v. Cleveland State) and are hard on accessibility.
- **Live human proctors.** They draw the worst candidate sentiment in the market (ProctorU) and they do not scale.
- **A single blended suspicion percentage, or rescoring after the exam.** This is Proctorio's anti-pattern.
- **In-house deepfake models, and Aadhaar authentication (AUA) status.** Integrate vendors instead.
- **Exact numeric thresholds published to candidates.** Show the rule family and the observed value. Share exact thresholds on appeal and in recruiter documentation, so they do not become a guide to evading detection.

## 8. Detection architecture

Trace does not need to see an overlay to catch the candidate using one. It catches the reading-and-retyping behaviour that every overlay forces. Every signal is a deterministic rule over features computed from recorded events. The honesty band comes from counting independent evidence families, never from one opaque model.

### 8.1 Signal catalogue

The coverage column maps each signal to Fabric's three cheating methods: overlay apps (45% of cheating), voice-mode LLMs (34%), and old tricks such as tab switching or a second screen (18%).

| Signal | Method | Catches | Coverage | Confidence | False-positive guard |
| --- | --- | --- | --- | --- | --- |
| Paste / drop | `paste`, `beforeinput` inputType | Copied answers | Old tricks | High | Ignore copy-paste within the page; allow-list per question |
| Synthetic input | `isTrusted`; input with no keydown; key-hold time | DOM auto-typers | Overlays (indirect) | High (hard evidence) | None needed |
| Retyped text (transcription) | Pause location, product/process ratio, deletion ratio, linearity vs own baseline | Overlay reading, second-screen reading, phone reading | **Overlays + old tricks** | Medium–high on verbatim; medium on paraphrase | Evidence floor ≥300 keystrokes or ≥60 words; suppressed inside IME composition, dictation, accommodations |
| Blur → burst | Visibility/blur + typing speed after return | Look-up then type | Old tricks, overlays that steal focus | Medium–high | Ignore blur under 2 s and permission prompts |
| Question copy | `copy` on prompt text + delay to first burst | Prompt pasted into an LLM | Overlays, old tricks | High | — |
| Lag loop | Time to first input per question vs difficulty, low variance | LLM round trip | **Overlays, voice mode** | Medium | Needs ≥4 questions |
| Content alignment (CLC) | Correlation of pause length with word surprisal | Forged timing, paraphrase | Overlays | Medium | Long answers only |
| Gaze off-screen | MediaPipe iris + head pose; duration only | Reading off-screen | Old tricks; overlays weakly | Low–medium | Calibrated at setup; glasses and lighting tolerance |
| Face count / absence | Face detector, 3 fps | Helper, proxy leaving | Old tricks | High | Low-light state marked as evidence quality |
| Speech while mouth closed | Silero voice-activity detection + jawOpen | Coaching, voice-mode LLM read aloud | **Voice mode** | Medium | Suppressed while a screen reader is speaking |
| Second monitor | `screen.isExtended` | Second screen | Old tricks | High (Chromium only) | Ask the candidate to disconnect; not a flag if fixed |
| Virtual camera / VM | Device labels, WebGL renderer | Camera injection, VM | Deepfake, proxy | Medium | Low weight; labels can be renamed |
| Explain probe | Follow-up latency + provenance | All, including phone reading | **All three** | Medium–high | Not scored for quality |
| Capture-excluded windows (P2 helper) | `GetWindowDisplayAffinity`, macOS window list | Any overlay | **Overlays** | High | Native, opt-in only |

### 8.2 Provenance feature set and starting thresholds

These thresholds are hypotheses to calibrate on the 500-session pilot dataset. They are not final values.

| Feature | Composition looks like | Starting flag hypothesis |
| --- | --- | --- |
| Within-word share of ≥2 s pauses | Low; pauses fall at sentence and word boundaries | >25% **and** median pause before a sentence <1 s |
| Product/process ratio (final chars ÷ all typed chars) | \~0.7–0.9 | ≥0.97 on ≥100 words |
| Deletion ratio | Moderate | <3% on ≥150 words |
| P-burst length (characters between ≥2 s pauses) | Short and varied | >2× the candidate's composing baseline |
| CLC (correlation of pause with word surprisal) | 0.35–0.55 | <0.15 |
| Inter-key interval autocorrelation and digraph structure | Structured | Autocorrelation ≈0 with high variance, or digraph R²≈0 (synthetic timing) |
| Paste share | n/a | Pasted >50% of final words or >40% of added words (Turnitin rule) |

### 8.3 Honesty band rules

The band is deterministic and versioned. It is frozen at test start and shown in the report.

- **Clear:** no hard evidence and at most one soft feature.
- **Review:** two or more soft features from different families, or one medium-severity flag.
- **Strong concern:** hard evidence (synthetic input, a burst after blur matching an external paste, sustained second person, sustained speech with mouth closed), or soft features from three or more independent families.
- **Insufficient evidence:** below the evidence floor, or an accommodation profile is active. No band is assigned.
- **What reaches the hiring decision:** only flags a human has marked **Confirmed**. AI-raised flags stay "Review" until a human acts on them.

Evidence strength runs from 0 to 1. It is the share of signal families with usable data. Low light, a mic that never connected, and gaps in the event stream all reduce it.

### 8.4 Calibration and validation plan

1. **Labelled dataset of 500 or more sessions**, built with pilot partners and paid volunteers. Five conditions:
   - honest composition
   - verbatim transcription from an LLM
   - paraphrase while reading an LLM
   - a commercial auto-typer
   - IME / Hinglish / mobile typing
2. **Report per detector:** precision, recall and false-positive rate on honest sessions. Targets are from the brief: precision ≥90%, recall ≥80%, false-positive rate <5%.
3. **Adversarial set:** 7–10 auto-typer tools at several presets, plus timing-forgery scripts.
4. **Ongoing:** overturn rate per signal from appeals feeds threshold retuning every two weeks. Each retune ships as a new ruleset version.

## 9. System architecture

The architecture rests on four rules. Raw events live in R2 as compressed NDJSON. Postgres holds only flags, scores and decisions, about 50 rows per session. ML runs on the candidate's device. Clips leave the device only when a flag fires. This design hits a 30-second report time and keeps infrastructure near ₹1–3 per assessment at 5,000 or more per month.

&#91;embedded content: Trace reference architecture · React, Node, Supabase, Cloudflare R2\]

When the candidate submits, the scoring worker reads that session's events from R2 and computes the report. It writes one report row to Supabase, and Broadcast notifies both the recruiter and the candidate.

### 9.1 Components

| Layer | Choice | Why |
| --- | --- | --- |
| Capture core | Framework-free TypeScript module inside the React app; ring buffer, then IndexedDB every 2 s, then a batch POST every 5 s or 200 events | Under 50 ms capture latency; survives reloads and network loss |
| On-device ML | Web Worker: MediaPipe Face Detector (3 fps) + Face Landmarker (1 fps). AudioWorklet + ONNX Runtime Web running Silero VAD | \~10–25% of one core on a low-end laptop. Drops automatically to 0.5 fps when frames take over 150 ms |
| Clips | MediaRecorder, 10 s self-contained segments at 360p, \~300 kbps; keep 2 in memory; on a flag, upload the previous, current and next segments | \~0.9 MB per clip; no continuous upload |
| Ingest | Cloudflare Worker: verifies the Supabase JWT, the batch HMAC and the hash chain, then writes `events/{session}/{batch}.ndjson.gz` to R2 | Edge proximity in India; zero egress cost |
| Database and auth | Supabase Postgres in Mumbai (India tenants) and Frankfurt (EU tenants); Auth with magic link or OTP | Data residency; RLS gives both parties the same report |
| Realtime | Supabase **Broadcast** on private channels, not Postgres Changes | Postgres Changes runs on a single thread; Broadcast is recommended above \~3,000 subscribers |
| Scoring worker | Node.js, triggered on submit: pull NDJSON, compute deterministic features, apply the band rules, grade with the LLM in parallel, write the report, then send `report_ready` | Features in under 3 s; LLM 3–10 s; total under 30 s |
| Models and assets | `.task` and WASM files on R2 or Pages; Service Worker caches them first and preloads during the system check | No repeat downloads on slow networks |

### 9.2 Event schema (NDJSON, one line per event)

```
{s: seq, t: perf_ms(0.1ms), k: type, q: question_id, d: {...}}
key(down|up, class)            in(inputType, pos, len, text|hash)   comp(start|end, len)
paste(len, src=internal|external, hash, blocked)   copy(target=prompt|answer, len)
vis(hidden|visible)  blur|focus  fs(enter|exit, reason?)  scr(isExtended)
face(n, conf)  pose(yaw, pitch)  gaze(off|on)  vad(start|end, p)  mouth(open|closed)
dev(change)  net(online|offline)  nudge(type, ack, text?)  clip(id, flag_ref)
```

For code questions, capture exact edit ranges from Monaco `onDidChangeModelContent` or CodeMirror transactions. Store a full snapshot every 100 edits so replay can seek. Capture is limited to answer fields only.

### 9.3 Data model (core tables)

| Table | Key fields | Notes |
| --- | --- | --- |
| `orgs`, `memberships` | org\_id, user\_id, role (admin / recruiter / reviewer) | Reviewer can be the recruiter |
| `assessments` | id, org\_id, ruleset\_version, settings\_json, locked\_at | Settings lock when the first candidate starts |
| `candidates` | id, org\_id, auth\_uid, accommodation\_flag, age\_gate | The accommodation reason is stored separately and encrypted |
| `consents` | session\_id, notice\_hash, jurisdiction, signed\_at, ip, withdrawn\_at | The consent ledger |
| `sessions` | id, assessment\_id, candidate\_id, status, chain\_head, evidence\_strength | One active attempt per candidate |
| `answers` | session\_id, question\_id, final\_text, quality\_score, rubric\_version, stats\_json |  |
| `flags` | id, session\_id, family, rule\_id, severity, t\_start, t\_end, observed\_json, clip\_key, state (signal → flag → reviewed → confirmed / overturned) | Partition by month once it exceeds \~50M rows |
| `explanations` | flag\_id, source (in\_test / appeal), text, created\_at |  |
| `appeals` | id, flag\_id, status, sla\_due, reviewer\_id, decision, rationale | Rationale required for outcomes against the candidate |
| `reports` | session\_id, quality\_card, integrity\_card, published\_at | The same row serves both parties under RLS |
| `audit_log` | actor, action, object, at | Every view of evidence; append-only |
| `model_debug` | session\_id, internal features | **No candidate policy.** Internal data only |

### 9.4 Security and integrity

- **RLS on `reports`, `flags` and `appeals`:** a row is visible if `candidate_id = auth.uid()` or the viewer belongs to the org with role recruiter or reviewer.
- **Clip access:** an edge function checks RLS, then signs a 5-minute GET URL.
- **Tamper evidence:** each batch carries `prev_hash`, a SHA-256 of its payload, and an HMAC with the session key. The server checks the chain, and a daily Merkle root goes to an append-only log. A missing sequence number or batch is itself recorded as a signal.
- **What tamper evidence cannot do:** it proves the logs were not changed after they arrived. It cannot prove a modified client did not fabricate events. State this in the instructions for use.
- **Encryption:** TLS in transit, R2 and Postgres at rest, and short-lived presigned URLs. Service keys stay server-side.
- **Clocks:** an NTP-style offset is taken at start and every 5 minutes. A mismatch between `Date.now` and `performance.now` reveals sleep or clock jumps.
- **Cross-origin isolation (COOP/COEP): do not enable it.** A 100 µs timer is enough, and isolation would break ATS iframes and OAuth.

### 9.5 Retention defaults

| Data | Default | Extends when |
| --- | --- | --- |
| Flag clips and thumbnails | 90 days | An appeal is open |
| Raw event logs (R2) | 6 months for EU tenants, 12 months for India tenants | Legal hold |
| Flags, decisions, audit log | 12 months (India), ≥6 months (EU AI Act) | Contract |
| ID images (P1+) | Masked ID and match result only; image deleted within 24 h | Never |
| Derived features (for training) | Only with customer opt-in, under a separate contract | n/a |

### 9.6 Service levels

- Event capture latency: under 50 ms (p99).
- Report ready: under 30 s after submit (p95).
- Evidence upload complete: under 2 minutes after submit on a 512 kbps connection, with the status "evidence pending" shown until then.
- Uptime: 99.9% during scheduled hiring drives, with a capacity check booked 48 h ahead.

## 10. Compliance requirements

Trace is a high-risk AI system under the EU AI Act on two counts: recruitment (Annex III 4(a)) and test monitoring (Annex III 3(d)). Trace is the *provider*; the employer is the *deployer*. Two rules apply in the EU today, not in 2027:

- no emotion inference from keystrokes, face or voice
- no rejection decided solely by automated signals

This is a summary of legal requirements, not legal advice. Have counsel review it before the first EU or UK contract.

| Requirement | Source | What Trace builds | Applies from |
| --- | --- | --- | --- |
| No inference of emotion or affect from face, voice or keystrokes | AI Act Art. 5(1)(f); Commission guidelines (Feb 2025) extend "workplace" to candidates | Allow-list of signals; a CI lint that bans affect labels; blendshapes used for geometry only | **Now** (2 Feb 2025) |
| Face *detection* only; no templates or voiceprints by default | GDPR Art. 9; EDPB 3/2019; Illinois BIPA | ML on the device sends only derived numbers; face match is an opt-in module with explicit consent | Launch |
| No solely automated rejection | GDPR Art. 22; UK DUAA s.80 (5 Feb 2026); CCPA ADMT; Colorado SB 26-189 | No-auto-reject guard; a logged human action with a reason | Launch |
| Notice before use | GDPR 13–14; DPDP s.5 / Rule 3; AI Act 26(11); NYC LL144 (10 business days); Illinois HB 3773 | Notice templates per jurisdiction; a timestamped notice email | Launch |
| Consent / written release | DPDP s.6; BIPA (e-signature accepted since SB 2979); Illinois AI Video Interview Act | Consent ledger with notice hash and withdrawal | Launch |
| Explanation and contest | AI Act Art. 86; DUAA safeguards; Colorado 30-day explanation; CCPA human-appeal exception | Shared report + appeal on each flag + rationale | Launch |
| Accommodations | WCAG 2.2 SC 2.2.1; India RPwD Act s.20; UK Equality Act | Accommodation profiles; time multiplier | Launch |
| No behavioural monitoring of under-18s | DPDP s.9(3) | Age gate; monitoring off or blocked | Launch (India) |
| Data minimisation and retention | GDPR 5(1)(c)(e); ICO audit outcomes (Nov 2024); DPDP s.8(7) | Defaults in section 9.5; lifecycle deletion; deletion receipts | Launch |
| Security safeguards and 72 h breach report | DPDP Rule 6–7; GDPR 32–33 | Encryption, RLS, access audit, incident runbook; tenant notice within 24 h | Launch |
| Processor contract kit | GDPR Art. 28; DPDP s.8(2) | DPA, sub-processor list, no training without opt-in | Before first contract |
| DPIA support | GDPR Art. 35; AI Act 26(9) | Pre-filled DPIA + instructions for use with known limits and false-flag rates | Before UK/EU sale |
| Bias monitoring | ICO; NYC LL144; Illinois HB 3773; AI Act Art. 10 | Voluntary self-identification; flag and overturn rates by group; NYC impact-ratio export | Metrics at launch; audit before NYC |
| Automatic logging ≥6 months; human oversight UI | AI Act Arts. 12, 14, 19, 26(6) | Hash-chained logs; "disregard" and "stop monitoring" controls; automation-bias warning | Build now; mandatory from **2 Dec 2027** |
| Provider conformity | AI Act Arts. 9–17, 43, 49, 72–73 | Risk file, technical documentation, QMS (SME templates), EU database registration, post-market monitoring | **2 Dec 2027** (Reg. (EU) 2026/1744) |
| DPDP core obligations | DPDP Rules 2025 | Consent-manager compatibility; grievance officer; 1-year log retention | Consent managers **13 Nov 2026**; core obligations **13 May 2027** (proposed move to Nov 2026 unconfirmed) |
| Complaints procedure | UK DUAA | Complaint form; acknowledgement within 30 days | In force since 19 Jun 2026 |
| Automated-decision (ADMT) packet for the US | Colorado SB 26-189; CCPA ADMT | Adverse-outcome explanation generator; opt-out and appeal records; 3–5-year records | **1 Jan 2027** |
| Data residency | DPDP s.16; GDPR Ch. V | India: Supabase Mumbai + R2 APAC. EU: EU project + R2 EU jurisdiction | India launch; before EU |

**Product consequences that also make Trace stronger:**

- **Naming.** Call the honesty output "Integrity signals", not "cheating probability". It holds up better under Art. 22, Art. 86 and ICO scrutiny.
- **Allowed vs prohibited language.** "Gaze off-screen 41 s" is allowed; "nervous" is prohibited. Mouth-open detection is allowed as visible movement under Recital 18.
- **Keystroke data.** Use it only for *content provenance*, never to identify a person across sessions. Cross-session identification would make it biometric data under Art. 9 and BIPA.
- **Grandfathering.** Grandfathering before Dec 2027 is lost on "substantial modification". Assume continuous model iteration counts, so build the provider file from day one.

Sources: [Orrick on Reg. 2026/1744](https://www.orrick.com/en/Insights/2026/07/EU-AI-Act-Update-Digital-Omnibus-Finalizes-8-Compliance-Changes), [Art. 26](https://artificialintelligenceact.eu/article/26/), [Art. 86](https://artificialintelligenceact.eu/article/86/), [Lewis Silkin on Art. 5](https://www.lewissilkin.com/en/insights/2025/02/17/understanding-the-eu-ai-acts-prohibited-practices-key-workplace-and-advertising-102k011), [EDPB 3/2019](https://edpb.europa.eu/sites/edpb/files/files/file1/edpb_guidelines_201903_video_devices_en_0.pdf), [Hogan Lovells on DPDP](https://www.hlc.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force-), [UK DUAA guidance](https://www.gov.uk/guidance/data-use-and-access-act-2025-data-protection-and-privacy-changes), [ICO AI recruitment](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2024/11/ico-intervention-into-ai-recruitment-tools-leads-to-better-data-protection-for-job-seekers/), [Skadden on Colorado](https://www.skadden.com/insights/publications/2026/06/colorado-repeals-and-replaces-its-ai-act), [White & Case on CCPA ADMT](https://www.whitecase.com/insight-alert/cppa-finalizes-rules-admt-risk-assessments-and-cybersecurity-audits-requirements), [Respondus BIPA](https://web.respondus.com/bipa-settlement).

## 11. Pricing and go-to-market benchmarks

Trace's planned price of ₹60–100 (about $0.70–1.15) per assessment sits between two groups. Below it are light proctoring tools that offer no evidence or provenance, such as AutoProctor at $0.10. Above it are assessment suites charging $7–20 or more per assessment. That gap is the opening for staffing firms and volume hiring.

&#91;embedded content: Public pricing pages and third-party listings, Oct 2026 · converted at ₹88 per USD\]

Plan prices are divided by the number of assessments each plan includes. At that rate, most suites charge about 8–23× Trace's target per assessment.

**Packaging (recommended)**

| Tier | For | Price shape | Includes |
| --- | --- | --- | --- |
| Pilot | First 3 recruitment firms | Free or nominal, capped at 500 sessions | Everything in P0, plus a weekly accuracy readout |
| Volume | Staffing firms, campus drives | ₹60–100 per assessment, cheaper at higher volume | Shared report, appeals, clips, LLM grading |
| Firm plan | Recruitment agencies | Monthly fee covering N tests, plus a per-test overage charge | Volume tier plus ATS/VMS webhook and a dashboard of drive-level fraud rings |
| Enterprise | IT services, BPO, certification | Annual contract | Secure Mode helper, SEB lockdown, India ID verification (charged at vendor cost plus margin), DPIA pack, data residency |

**Unit economics check.** Infrastructure costs about ₹8.9 per assessment at 1,000 a month, ₹2.7 at 5,000 and ₹1.3 at 50,000. These figures come from agent F's cost model: R2, the Worker, the LLM and a fixed \~$90/month. The brief's target of under ₹10 holds from roughly 1,000 assessments a month. **The larger cost is human review time for flags and appeals.** Detector precision is therefore the main unit-economics lever, and it should be tracked as minutes of review per 100 candidates.

**Go-to-market moves supported by the research**

1. **Lead with the evidence, not detection claims.** Competitors already advertise 85–98% accuracy without any audit. Trace should publish precision and overturn rates from the pilots instead.
2. **The Infosys incident is the India hook.** In June 2026 Infosys postponed assessments for more than 20,000 candidates over impersonation. Pitch DigiLocker identity verification plus face continuity as the answer to proxy test-takers.
3. **Partner rather than compete on identity.** IDfy is the incumbent for background verification in India, and Trace would be a natural add-on to its channel.
4. **Use the staffing wedge.** Glider requires a $60k minimum and Talview a $25k floor. Xobin already sells volume tiers to staffing agencies. Transparent INR pricing per assessment undercuts all of them.
5. **Make the candidate report a growth loop.** Each candidate who receives a fair, explainable report becomes a reference for the employer brand. Measure candidate NPS from the first pilot.

## 12. Gaps and risks in the current Trace brief

The biggest risk is overclaiming. The brief says writing-process analysis "catches hidden overlay apps". Research and competitors show it catches *verbatim retyping* well and *paraphrasing* only moderately, and that timing can be forged. Two of the brief's statistics are also unsupported.

| # | Issue in the brief | Evidence | Fix |
| --- | --- | --- | --- |
| 1 | Claims typing analysis "catches hidden overlay apps" | Transcription recall 96–100% in lab studies; paraphrase 76–89%; forged timing evades ≥99.8% ([arXiv 2601.17280](https://www.arxiv.org/pdf/2601.17280)) | Reword to "detects the behavioural footprint of reading and retyping". Add the calibration warm-up, content alignment and the explain probe. Offer an optional native helper for direct overlay detection. |
| 2 | Cluely "reportedly crossed $3M ARR" | CEO admitted in Mar 2026 that earlier revenue claims were false. Actual figures for Jun 2025: \~$2.7M consumer + $2.5M enterprise ARR; the company has since rebranded as a note-taker ([TechCrunch](https://techcrunch.com/2026/03/05/cluely-ceo-roy-lee-admits-to-publicly-lying-about-revenue-numbers-last-year/)) | Cite the corrected figures, or drop Cluely and cite the paid stealth tools (Interview Coder at $299/mo, Final Round AI) |
| 3 | "Huntress flagged 23.2% of applicants" | Not found. Huntress's Aug 2026 DPRK investigation reports 5 cases ([Huntress](https://www.huntress.com/blog/huntress-dprk-remote-worker-investigation)) | Remove. Replace with GetReal (41% of enterprises say they hired a fraudulent candidate) |
| 4 | Fabric statistics presented as fact | Verified, but they are vendor flag rates at a >40% probability threshold, not confirmed cheating ([Fabric](https://www.fabrichq.ai/blogs/state-of-ai-interview-cheating-in-2026-insights-from-19-368-interviews)). Fabric is also a direct competitor | Label them "Fabric (vendor) data". Add CodeSignal's 2026 data (35% of proctored tests flagged) as corroboration |
| 5 | Fabric listed only under competitors, not called out | Fabric is Bengaluru-based, sells to IT services and staffing, needs no install, and publishes its research | Treat it as the primary direct competitor in the pitch |
| 6 | Indian input methods not addressed | Gboard Hinglish, Indic IMEs and Android keyboards commit whole words at once (keyCode 229) | Make composition-aware capture a P0 requirement, with a dedicated IME test set |
| 7 | Mobile candidates not addressed | Keystroke analysis is unreliable on touch keyboards; Mettl and Talview block mobile | Decide explicitly: typing-heavy tests desktop-only, or a "mobile mode" with provenance limited to paste and blur |
| 8 | Paste blocking framed as the main control | Blocking hurts accessibility; logging is more informative | Make allow-and-log the default |
| 9 | Roadmap "deepfake and face-swap checks" within 90 days | Face matching is biometric processing (GDPR Art. 9, BIPA); building detectors in-house is costly and quickly outdated | Move to P2; use an API only when risk escalates, with explicit consent |
| 10 | Under-18 candidates (campus drives, apprentices) | DPDP s.9(3) bars behavioural monitoring of children | Add an age gate |
| 11 | Candidate report timing undefined | Releasing it too early lets a candidate argue before review; releasing it too late breaks trust | Release after the reviewer finishes, or within 7 days, whichever is first |
| 12 | Showing candidates exact thresholds | Teaches people how to evade detection | Show the rule family and the observed value; share exact thresholds on appeal and in recruiter documentation |
| 13 | Success metrics without a dataset plan | Precision of 90% or more needs labelled sessions across 5 conditions | Section 8.4 dataset plan; publish results per detector |
| 14 | Cost under ₹10 assumed at any volume | Fixed infrastructure costs dominate below \~1,000 assessments a month; human review dominates above that | Track minutes of review per 100 candidates as the main cost KPI |
| 15 | Transparency treated as the moat | HireID (Aug 2026) already markets "every flag links to its signal" | The moat is data: detectors calibrated on overturn outcomes, India-specific handling (IME, DigiLocker), and published precision |

**Verified and safe to keep:**

- Fabric's 15%→35% rise and its 38.5% of 19,368 interviews (as vendor data)
- Gartner: 6% of candidates admit fraud, and 1 in 4 candidate profiles fake by 2028
- Infosys: assessments for 20,000+ candidates postponed (Jun 2026)
- DOJ North Korea case: more than 100 companies (Jun 2025)
- Palo Alto Networks Unit 42: a deepfake candidate built in about 70 minutes
- California Bar: about 36% of online takers flagged (older)

## 13. Build roadmap

The 90-day plan has three phases:

1. Ship the P0 demo at the Awign Hackathon in October 2026.
2. Spend November hardening it to pilot grade.
3. Run three recruitment-firm pilots plus the 500-session accuracy study through early January 2027.

Before its Nov 2026 date, the plan must meet DPDP readiness, in case the government's proposed acceleration is confirmed. The Awign Hackathon's exact dates are not in the brief, so the demo window below is approximate.

&#91;embedded content: Trace plan from the brief's 90-day roadmap · regulatory dates from section 10\]

The DPDP consent-manager date falls during pilot hardening. That makes the consent ledger and the notice templates P0 items, not later work.

**Phase gates**

| Gate | Criteria to pass |
| --- | --- |
| Hackathon demo | End-to-end: candidate flow → capture → report in under 30 s → candidate view → appeal → reviewer decision. Live demo of verbatim retyping vs composing, with the writing curve and replay. |
| Pilot-ready | All 14 P0 items done. IME test set passes. Consent ledger, retention jobs and age gate live. Load test of 500 concurrent candidates. DPA template ready. |
| Pilot exit (decision on pricing) | 3 firms, 500 or more labelled sessions. Per-detector precision and false-positive rate published. Review minutes per 100 candidates measured. At least 1 firm converts to paid at ₹60–100. |
| Scale (Q1–Q2 2027) | Secure Mode helper beta. India ID verification vendor integrated. ATS/VMS connectors. DPDP core obligations met before 13 May 2027. |
| EU-ready (by Dec 2027) | AI Act provider file, conformity assessment, EU data residency, bias audit. |

**Hackathon cut (if time is tight):** keep items 1, 2, 4, 5, 6, 9 and 11 from section 7.2. Fake the reviewer queue with a single-page console. Show the candidate report and the appeal as the closing moment of the demo. No competitor can show that screen.

## 13A. Hands-on verification: TestGorilla app and Codility help centre

On 10 Oct 2026 we went through the TestGorilla app (free-plan demo account) and Codility's help centre, both logged in. The visits confirmed the main finding: neither vendor shows candidates their integrity evidence or lets them appeal. They also turned up eight new build items, listed at the end of this section. The TestGorilla account has no candidates, so its results page and anti-cheating monitor could not be seen first-hand.

**TestGorilla: what we saw in the app**

| Area | What we saw | What it means for Trace |
| --- | --- | --- |
| Job setup | A 4-step wizard: Job details (AI suggestions from a pasted job description) → Assessment → Configuration → Finalize, with an eye icon to preview the assessment at any step | Copy the stepped setup; put a live preview of the candidate view at every step |
| Modular tools | 8 tool cards, each showing its credit cost: Qualifying questions, ID verification, Skills tests, Custom questions, AI interviews, Video questions, Resume scoring, Job simulations | Trace should **plug into** these flows (as an integrity layer or SDK), not rebuild them |
| Anti-cheating settings | Only two toggles: webcam snapshot every 15 s, and **single screen required**. Candidates are told to disconnect extra screens and are **blocked if one is reconnected**. The app says this works in Chromium browsers only | Add an optional "single screen" enforcement step using `screen.isExtended`, honest that it is Chromium-only. TestGorilla has no typing, paste or audio controls in setup |
| Accommodations | On by default. Candidates can request accommodations for non-fluent English or for conditions affecting concentration or memory. Turning them off shows a warning that it may break fair-employment law | Copy the warning when accommodations are switched off; offer English-proficiency accommodation for Indian campus drives |
| Extra time | Applies to every candidate. The app warns that percentile scores become inaccurate | When extra time is given, Trace must exclude that candidate from cohort baselines |
| Question exposure | Each test draws a random mix of questions from a bank of 1,500+ | Question pools and randomisation matter for campus drives (P1) |
| Plan limits | Free plan: 10 credits a month, 5 tests free for unlimited candidates. Team access, intro video and deadlines need an upgrade | A free tier with unlimited basic use drives sign-ups. Trace's pilot tier should do the same |

**Codility: what the help centre adds**

| Feature (article date) | Detail | What it means for Trace |
| --- | --- | --- |
| [Typing Pattern Detection](https://support.codility.com/hc/en-us/articles/44710150565649) (Mar 2026) | Passive and on by default. Runs **after submission**, and the candidate is **unaware**. Flags retyped AI code. Skipped for MCQs, essays, debugging, file-upload and VS Code tasks, and for solutions under 10 lines. Codility calls it "high likelihood, not certainty" | Confirms the market need. Trace's openings: essays and text answers, analysis visible to the candidate, and appeals |
| [Assessment Integrity Features](https://support.codility.com/hc/en-us/articles/47800858996497) (Jun 2026) | Three controls: Proctoring, AI Follow-Up Questions, Device Integrity. Webcam snapshots kept 30 days | Same three layers as Trace's plan; their snapshot retention sets a benchmark |
| [AI Follow-Up Questions](https://support.codility.com/hc/en-us/articles/39175728044689) | 3 questions per submission, 2 min each, pasting blocked and keystrokes monitored; transcript shown in the report; single-file tasks only | Supports Trace's explain probe. Trace should extend it to written answers and voice |
| [Device Integrity](https://support.codility.com/hc/en-us/articles/46437546447633) (Preview) | Codility App for macOS and Windows, no Linux. It **only checks for known cheating tools**: no screen recording, no keystrokes. Candidates must install it; a browser is not allowed | Trace's Secure Mode helper should copy this privacy scope and add tool-agnostic detection of windows hidden from screen capture |
| [Behavioural events](https://support.codility.com/hc/en-us/articles/15584109019671) | Five event types: paste (pasted code logged in the Timeline), tab switch, unusually fast completion, copying the task description, typing pattern. A free-text "Assessment and Hiring Policies" field shows on the candidate intro page. Settings lock once the first candidate is invited | Matches Trace's rules contract and settings freeze |
| [Integrity Risk](https://support.codility.com/hc/en-us/articles/38723208906513) (beta) | Levels None, Low, Moderate or High. Built from "proprietary formulas developed with I-O psychologists", no AI. Shows which sections contributed. Recruiters can filter by it | Confirms Trace's deterministic band. Trace adds a published rule table and candidate visibility |
| [Code Evolution Chart](https://support.codility.com/hc/en-us/articles/33031651689617) | Six annotated example patterns, e.g. "left Codility for a couple of minutes, then wrote the entire solution" | **Add a pattern gallery** to Trace's flag dictionary: annotated example writing curves for each rule |
| [Live signals in interviews](https://support.codility.com/hc/en-us/articles/40895529843217) | Interviewers get real-time alerts for tab switching, focus loss, copying the description and copying external code. **Signals are not visible to candidates** | One more confirmation of the transparency gap |
| [New PDF report](https://support.codility.com/hc/en-us/articles/48817330346897) (Aug 2026) | The PDF renders from the same data as the online report and includes integrity risk and proctoring. A shared link with a token valid 7 days | Trace's report export should come from the same data, with an expiring share link |
| [Identity Verification](https://support.codility.com/hc/en-us/articles/360060045273) | Front and back of ID plus a selfie. ID data is not visible to recruiters, and a recruiter can **re-trigger** verification after a failure. Not available on public test links | Match all four behaviours |
| [Screen Governance](https://support.codility.com/hc/en-us/articles/9958730821015) | Admins set defaults and **padlock** settings so non-admins cannot change them. An AI settings panel is logged in the audit log | Add org-level locked defaults to P1 |
| [Candidate feedback](https://support.codility.com/hc/en-us/articles/360043826373) (beta) | Candidates see a basic score breakdown after submitting, but no integrity data | The closest any vendor comes to Trace's shared report, and it leaves out integrity |
| [Task Randomizer](https://support.codility.com/hc/en-us/articles/360043320014) | Randomised task pools "for campus recruitment" | Add question pools to P1 |
| Integrations | Codility now integrates with Naukri RMS and Oracle Recruiting (Oct 2026), alongside Greenhouse, Lever, iCIMS and SmartRecruiters | **Naukri RMS** is the India ATS to integrate first |

**Build items added by this pass**

1. **P0 — Text-answer provenance as the headline.** Every competitor that detects retyping does it on code only. Trace's demo should show a written answer, such as a customer-support reply or an aptitude essay.
2. **P0 — Pattern gallery in the flag dictionary.** Six to eight annotated example writing curves (Codility pattern), shown to recruiters and to candidates.
3. **P1 — Optional single-screen enforcement:** block on reconnection, Chromium only, with the limit stated plainly (TestGorilla pattern).
4. **P1 — Org-level locked defaults** (Codility Screen Governance).
5. **P1 — Question pools and randomisation** for campus drives.
6. **P1 — Naukri RMS integration** first among the ATS connectors.
7. **P1 — Exclude extra-time candidates from baselines**, and warn when accommodations are switched off.
8. **P2 — Integrity SDK** for test platforms like TestGorilla: their own integrity settings stop at snapshots and screen count.

## 14. Sources

These are the main sources the agents opened between 10 Oct 2026 and the time of writing. Vendor pages describe each vendor's own product, and their accuracy figures are self-reported.

**Assessment and proctoring vendors**

- HackerRank: [Proctor Mode](https://hackerrank-knowledge-base.help.usepylon.com/articles/5663779659-proctor-mode) · [Review integrity issues](https://hackerrank-knowledge-base.help.usepylon.com/articles/9607697321-review-integrity-issues-in-proctor-mode) · [AI plagiarism detection](https://hackerrank-knowledge-base.help.usepylon.com/articles/7287334157-ai-plagiarism-detection) · [LL144 bias audit](https://hackerrank-knowledge-base.help.usepylon.com/articles/9355824728-summary-of-bias-audit-results-of-the-hackerrank%27s-plagiarism-detection-system-for-new-york-city%27s-local-law-144) · [Integrity at scale](https://hackerrank-knowledge-base.help.usepylon.com/articles/9728791902-interpreting-integrity-signals-at-scale-in-proctor-mode-tests) · [April 2026 release notes](https://hackerrank-knowledge-base.help.usepylon.com/articles/4368819843-april-2026-release-notes)
- CodeSignal: [Suspicion Score](https://support.codesignal.com/hc/en-us/articles/16957476906135-Using-Suspicion-Score) · [Proctoring data](https://support.codesignal.com/hc/en-us/articles/4409230511767) · [2026 fraud data](https://codesignal.com/newsroom/press-releases/codesignal-detection-systems-identify-and-stop-record-high-cheating-attempts-as-assessment-fraud-more-than-doubled-in-2025/)
- Codility: [Proctoring and integrity](https://www.codility.com/1p/codility-proctoring-integrity/) · [Cheating-apps detection](https://www.codility.com/1p/cheating-apps-detection/) · [Public sample report](https://app.codility.com/public-report-detail/)
- TestGorilla: [Behaviour tiers](https://support.testgorilla.com/hc/en-us/articles/46569751180699) · [Trustpilot](https://www.trustpilot.com/review/testgorilla.com)
- Glider AI: [Proctoring guide](https://glider.ai/what-is-ai-proctoring-hiring-guide/) · [AWS Marketplace pricing](https://aws.amazon.com/marketplace/pp/prodview-a4u7rckipxlko)
- HireVue: [Cheating and fraud](https://www.hirevue.com/platform/cheating-and-fraud) · [2025 whitepaper](https://www.hirevue.com/wp-content/uploads/2025/09/2025_9_Do-Cheaters-Prosper_Whitepaper.pdf)
- Mettl: [Credibility Index](https://support.mettl.com/portal/en/kb/articles/candidate-credibility-index-in-proctoring-reports-18-4-2023) · [AI Sense](https://support.mettl.com/portal/en/kb/articles/ai-generated-code-detection)
- HackerEarth: [Smart Browser](https://help.hackerearth.com/advanced-proctoring-settings-smart-browser) · [Photo ID / DigiLocker](https://help.hackerearth.com/photo-id-verification)
- Talview: [Session summary report](https://docs.talview.com/center-and-proctor-administration/session-playback/summary-report/faqs/session-summary-report-faqs) · [Candidate proctoring FAQ](https://docs.talview.com/candidates/assessments/how-to/why-we-use-proctoring-and-how-it-works) · [Alvy patent release](https://www.newswire.ca/news-releases/talview-secures-patent-for-alvy-the-first-agentic-ai-proctoring-built-to-outsmart-cluely-style-cheating-871422979.html)
- [iMocha cheating prevention](https://imocha.io/cheating-prevention) · [InCruiter proctoring](https://incruiter.com/proctoring-software) · [Xobin pricing](https://xobin.com/pricing/) · [AutoProctor](https://www.autoproctor.co/) · [CoderPad playback](https://coderpad.io/resources/docs/screen/review-results/playback/)
- Honorlock: [OSU results guide](https://teaching.resources.osu.edu/toolsets/carmencanvas/guides/getting-started-honorlock/viewing-honorlock-results) · [Cluely blocking](https://honorlock.com/blog/what-is-cluely-how-to-block-it/)
- Proctorio: [Gradebook guidance](https://eCampus.oregonstate.edu/faculty/exam-proctoring/Proctorio%20Gradebook%20Guidance.pdf) · [Chrome Web Store reviews](https://chromewebstore.google.com/detail/proctorio/fpmapakogndmenjcfoajifaaonnkpkei/reviews)
- Other proctoring: [Respondus Monitor](https://web.respondus.com/monitor-review) · [ExamSoft ExamID](https://support.examsoft.com/hc/en-us/articles/11166685091341) · [Integrity Advocate violation notice](https://intercom.help/integrity-advocate-help-center/en/articles/12032333-potential-violation-of-rules-message) · [ProctorU Trustpilot](https://www.trustpilot.com/review/proctoru.com) · [Safe Exam Browser Config Key](https://safeexambrowser.org/developer/seb-config-key.html)

**Fraud, identity and the adversary**

- Fabric: [19,368 interviews](https://www.fabrichq.ai/blogs/state-of-ai-interview-cheating-in-2026-insights-from-19-368-interviews) · [Technical deep dive](https://fabrichq.ai/blogs/how-ai-interviews-detect-cheating-a-technical-deep-dive)
- Interview-integrity products: [Sherlock](https://www.sherlock.sh/) · [HireID launch](https://www.newsfilecorp.com/release/309790) · [Reality Defender RealMeeting](https://www.realitydefender.com/product/realmeeting) · [Pindrop meeting security](https://www.pindrop.com/solution/meeting-security/)
- Identity: [Persona candidate verification](https://withpersona.com/blog/introducing-candidate-verification-solution-by-persona)
- Cluely: [TechCrunch on Cluely revenue](https://techcrunch.com/2026/03/05/cluely-ceo-roy-lee-admits-to-publicly-lying-about-revenue-numbers-last-year/)
- Industry reports: [Unit 42 synthetic identity](https://unit42.paloaltonetworks.com/north-korean-synthetic-identity-creation/) · [Gartner candidate survey](https://www.gartner.com/en/newsroom/press-releases/2025-07-31-gartner-survey-shows-just-26-percent-of-job-applicants-trust-ai-will-fairly-evaluate-them) · [Infosys postponement](https://www.peoplematters.in/news/recruiting-and-onboarding/infosys-postpones-hiring-exams-for-20000-candidates-following-impersonation-cases-50153)

**Writing provenance and research**

- Products: [Grammarly Authorship](https://www.grammarly.com/authorship) · [GPTZero Writing Report](https://gptzero.me/writing-report) · [Turnitin Clarity guide](https://guides.turnitin.com/hc/en-us/articles/36916426919949) · [Plagiarism Today on Grammarly](https://www.plagiarismtoday.com/2025/11/06/how-grammarly-launders-ai-generated-content/)
- Papers: [Crossley et al. 2024](https://files.eric.ed.gov/fulltext/ED675615.pdf) · [Mehta et al. 2025](https://arxiv.org/abs/2511.12468) · [Korean LLM-cheating 2025](https://arxiv.org/abs/2507.22956) · [Condrey 2026a](https://arxiv.org/abs/2603.00177) · [Condrey 2026b](https://arxiv.org/abs/2601.17280) · [Hao & Fauss (ETS)](https://arxiv.org/abs/2411.13699)

**Stack**

[MDN performance.now](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now) · [MDN inputType](https://developer.mozilla.org/en-US/docs/Web/API/InputEvent/inputType) · [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker) · [Silero VAD](https://github.com/snakers4/silero-vad) · [R2 pricing](https://developers.cloudflare.com/r2/pricing/) · [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits) · [Supabase pricing](https://supabase.com/pricing) · [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)

Compliance sources are listed at the end of section 10.
