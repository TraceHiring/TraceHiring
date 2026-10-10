# Plan conflicts and resolutions

These are contradictions found inside `docs/plan.md` (rev 39) and between the plan and the design files. Build the **Resolution** column. Items marked *Founder to confirm* have a safe default you can build now; flag them in `docs/build-notes.md` so the founder can override them.

| # | Conflict | Where | Resolution |
| --- | --- | --- | --- |
| 1 | Plan intro says "Section 16 lists the assumptions", but sections 14–16 were removed | §1 | Ignore the reference. The build order lives in `docs/build-order.md`; open questions go in `docs/build-notes.md` |
| 2 | Linear issues cite "§14 Roadmap", "§15", "§16" | Linear ABH-* | Old numbering. Decision log is now §14; roadmap is `docs/build-order.md` |
| 3 | T3 signals "capped at Review" vs Strong concern allowed for "T3 with viewable raw media, or untrusted input" | §6 tiers, §7.2 | T3 caps at Review **except** untrusted input and reviewer-viewable raw media (e.g. a clip of a second person). Encode both exceptions and test them |
| 4 | Explain probe is T2 ("can reach Strong concern") vs "can lower concern; never raises the band alone" | §6 tiers vs §5 D | The probe may lower concern. It may contribute to Strong concern only together with another T1/T2/T3 signal on the same answer, never alone. *Founder to confirm* |
| 5 | "No answer lost in a 20-min power cut" vs "offline buffer up to 10 min" | §5 C vs §12 | Compatible: after 2 min offline the timer pauses (§3.2 step 10), so typing beyond the buffer isn't expected. Buffer ≥10 min of edits; on resume, nothing acknowledged or buffered is lost. Test the 20-min outage end to end |
| 6 | "India identity verification (add-on)" listed in launch scope vs DigiLocker/ID partner in Phase 2 | §1 vs §5 J | Phase 0/1 builds the start photo + snapshot grid only (ABH-65). DigiLocker/ID partner is Phase 2 (ABH-67) — out of scope |
| 7 | Screens 03/04 and board HTML say clips kept 90 days | design vs §10.2 | Media deleted 30 days after the decision; video answers decision + 30 days, 90 days max; extended only while an appeal is open |
| 8 | Screens 02/04 show a 2-business-day appeal SLA | design vs §3.3, §12 | Decision SLA is 5 business days; the candidate response window is 72 h |
| 9 | Face absent "≥20 s continuous" may be too lenient | §6 | Build the threshold as versioned config. Default ≥20 s continuous; log every absence ≥3 s as timeline context. *Founder to confirm* the tiered rule (flag ≥20 s, or ≥10 s followed by a typing burst, or ≥60 s total per question) before M4 |
| 10 | Phone mode (screens 06a/06b) appears in the design but is Phase 2 | §5 C | Out of scope for this build; keep the candidate app responsive so phone mode is cheap later |
| 11 | Auto-refund on system-caused failure is in ABH-77, not in the plan | Linear vs §13 | Build it (it follows the "bill on started attempts" principle); log every refund |
| 12 | Plan says DPDP-ready at closed beta in Nov 2026; the old roadmap said beta Oct 2026–Jan 2027 | §10 | Beta starts only when the M8 gate passes, whatever the date |
| 16 | ABH-80 "Done when" (Linear) says RPO ≤ 15 min and RTO ≤ 2 h; plan §12 says database RPO ≤ 2 min, RTO 4 h | Linear ABH-80 vs §12 | Founder, 2026-10-11: **RPO ≤ 2 min** (the plan wins) and **RTO ≤ 2 h** (the stricter of the two). The M8 restore drill proves both. The rest of ABH-80's line stands: on-call alert reaches the phone in under 2 minutes; no candidate PII found in logs (scan) |

## Founder decisions to confirm before M1 (raised in the final plan review)
| # | Question | Default if the founder doesn't answer |
| --- | --- | --- |
| 13 | **Beta scope.** Build all Phase 0 formats for every role, or the wedge first? | Wedge first: role templates for BPO Voice and Customer Support only; written + MCQ + typing + voice. Item library for beta ≈ 600 reviewed items for those two roles; the 3,000-item library continues in parallel and ships before pilots. |
| 14 | **Customer gate.** Keep building if no design partner has signed? | M4 does not start until at least one design-partner LOI (ABH-91) is signed. Building continues on M1–M3 meanwhile. |
| 15 | **Infrastructure.** Three clouds (Cloudflare + Supabase + AWS ECS) is heavy ops for a solo founder. | Phase 0 runs the API and workers on Cloudflare Workers + Queues consumers (Bedrock and SES called over HTTPS with SigV4). AWS is used only for Bedrock, SES, KMS/Secrets Manager. Move a job to ECS Fargate only if it breaks a Workers limit; record that as a new ADR superseding §8.1's ECS choice. |
