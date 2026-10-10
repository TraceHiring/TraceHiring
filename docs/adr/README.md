# Architecture & product decision records

Generated from plan §14. Each ADR is **Accepted**. Agents must not reopen one unless its "Reopen if" condition is met with evidence; propose a new ADR instead.

| ADR | Decision | Chosen |
| --- | --- | --- |
| [ADR-001](ADR-001-product-shape.md) | Product shape | Own test platform; SDK in Phase 3 |
| [ADR-002](ADR-002-lead-question-type.md) | Lead question type | Written + voice for BPO and support |
| [ADR-003](ADR-003-wedge-customer.md) | Wedge customer | Mid-size staffing firms doing BPO and fresher hiring |
| [ADR-004](ADR-004-integrity-output.md) | Integrity output | Deterministic band + evidence strength |
| [ADR-005](ADR-005-evidence-trust.md) | Evidence trust | Three tiers; client-only signals capped at Review |
| [ADR-006](ADR-006-when-to-review-integrity.md) | When to review integrity | Score-first; shortlisted candidates only |
| [ADR-007](ADR-007-candidate-recourse.md) | Candidate recourse | Notice + 72 h response before an integrity rejection; second reviewer decides |
| [ADR-008](ADR-008-gaze.md) | Gaze | Context only |
| [ADR-009](ADR-009-mic-in-non-voice-tests.md) | Mic in non-voice tests | Off in Standard, context in Strict |
| [ADR-010](ADR-010-ai-likeness-of-text.md) | AI-likeness of text | Never shown |
| [ADR-011](ADR-011-voice-integrity.md) | Voice integrity | Follow-ups, timing, speaker count; no lip-sync or reading-pattern flags |
| [ADR-012](ADR-012-video-answers.md) | Video answers | Opt-in, Phase 2 |
| [ADR-013](ADR-013-biometrics.md) | Biometrics | No templates by default; face matching only in the opt-in identity add-on |
| [ADR-014](ADR-014-under-18.md) | Under-18 | Blocked at launch; parental-consent flow in Phase 2 |
| [ADR-015](ADR-015-identity-at-launch.md) | Identity at launch | Start photo + snapshot grid + human check at the next round |
| [ADR-016](ADR-016-in-test-authority.md) | In-test authority | Edge session object per session |
| [ADR-017](ADR-017-candidate-auth.md) | Candidate auth | Invite + OTP → Trace-issued token |
| [ADR-018](ADR-018-code-execution.md) | Code execution | Bought execution service |
| [ADR-019](ADR-019-llm-hosting.md) | LLM hosting | Claude via an India inference region |
| [ADR-020](ADR-020-speech-to-text.md) | Speech-to-text | Indian vendor behind a neutral interface |
| [ADR-021](ADR-021-report-speed.md) | Report speed | Split SLO: deterministic <30 s, LLM/STT queued |
| [ADR-022](ADR-022-media.md) | Media | Stills + flag clips, blurred on the device |
| [ADR-023](ADR-023-pricing-unit.md) | Pricing unit | Credit per started attempt |
| [ADR-024](ADR-024-lockdown.md) | Lockdown | Optional Secure Mode helper + Safe Exam Browser in Phase 3 |
| [ADR-025](ADR-025-fraud-rings.md) | Fraud rings | Within-drive only; IP never alone |
| [ADR-026](ADR-026-thresholds.md) | Thresholds | Rule families public; exact numbers to recruiters, appellants and the instructions for use |
| [ADR-027](ADR-027-phase0-compute-on-workers.md) | Phase 0 compute | API and jobs on Cloudflare Workers + Queues; AWS only for Bedrock, SES, KMS/Secrets Manager (supersedes plan §8.1 ECS row) |
