# ADR-006: When to review integrity

- **Status:** Accepted (2026-10-10)
- **Source:** docs/plan.md §14, decision 6

## Decision
Score-first; shortlisted candidates only

## Rejected alternatives, and why
Review everyone: reviewers drown, and flags that never mattered get appealed

## Reopen only if
A client needs integrity on every candidate (compliance exams)

## Consequences for the code
Any change that contradicts this decision must be flagged in review as a blocking finding unless a superseding ADR exists.
