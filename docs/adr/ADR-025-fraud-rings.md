# ADR-025: Fraud rings

- **Status:** Accepted (2026-10-10)
- **Source:** docs/plan.md §14, decision 25

## Decision
Within-drive only; IP never alone

## Rejected alternatives, and why
Cross-tenant matching: makes Trace a data fiduciary for its own purposes

## Reopen only if
Not expected to reopen.

## Consequences for the code
Any change that contradicts this decision must be flagged in review as a blocking finding unless a superseding ADR exists.
