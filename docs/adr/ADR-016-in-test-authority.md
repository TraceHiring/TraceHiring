# ADR-016: In-test authority

- **Status:** Accepted (2026-10-10)
- **Source:** docs/plan.md §14, decision 16

## Decision
Edge session object per session

## Rejected alternatives, and why
Postgres on the hot path: a drive dies when the database blinks

## Reopen only if
Not expected to reopen.

## Consequences for the code
Any change that contradicts this decision must be flagged in review as a blocking finding unless a superseding ADR exists.
