# Design references

**Source of truth:** Figma file "Trace — Final UI v1" — https://www.figma.com/design/inLmYNH8vJD9lJfiqhJ1rR
The PNGs in `screens/` are snapshots taken while the screens were built. A few were taken before small layout fixes (e.g. 01 shows truncated button labels and short rubric bars; 02 shows an overflowing clip caption). Where a PNG and Figma disagree, Figma wins. Behaviour always comes from `docs/plan.md`, not from the pictures. Two values on the screens are wrong and must follow the plan: media retention (screens show 90 days; plan: 30 days after the decision) and the appeal decision SLA (screens show 2 business days; plan: 5 business days). See `docs/plan-conflicts.md`.

| Screen | File | Plan section | Phase |
| --- | --- | --- | --- |
| 01 Evidence report — recruiter view | screens/01-evidence-report-recruiter.png | §5 F, §7 | 0 |
| 01b Same report — candidate projection | screens/01b-evidence-report-candidate.png | §2, §3.2 step 12 | 0 |
| 02 Reviewer & response console | screens/02-reviewer-console.png | §3.3 | 0 |
| 03 Candidate transparency + consent | screens/03-candidate-transparency-consent.png | §3.2 steps 5–6 | 0 |
| 04 Assessment setup — integrity settings | screens/04-assessment-setup-integrity.png | §3.1 step 3, §6 | 0 |
| 05 Drive results — score-first triage | screens/05-drive-triage.png | §3.1 steps 7–8 | 0 |
| 06a Phone mode — MCQ | Figma only (frame "06a") | §5 C | 2 |
| 06b Phone mode — voice answer | screens/06b-phone-voice-answer.png | §5 C | 2 |

`tokens.json` holds the colour, spacing, radius and type tokens used in Figma. Implement them as CSS variables / Tailwind theme once, in the shared design system package.
`board-html/` holds the earlier interactive HTML board (custom runtime, not runnable standalone). Use it only to read intended interactions (e.g. the cutoff buttons on DriveTriage, the preset switch on Setup).

Screens not yet designed (build them from the plan and the existing components): test builder, item library, drive scheduling, invite upload, live drive monitor, candidate lobby/device check, warm-up, in-test laptop UI, receipt/status page, admin settings, billing, client pack, webhooks/API keys.
