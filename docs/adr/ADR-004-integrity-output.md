# ADR-004: Integrity output

- **Status:** Accepted (2026-10-10)
- **Source:** docs/plan.md §14, decision 4

## Decision
Deterministic band + evidence strength

## Rejected alternatives, and why
Numeric honesty score: invites automatic cut-offs. ML probability: cannot be explained or appealed

## Reopen only if
Never for the score. ML may propose evidence only

## Consequences for the code
Any change that contradicts this decision must be flagged in review as a blocking finding unless a superseding ADR exists.
