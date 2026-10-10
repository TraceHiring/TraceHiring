# ADR-021: Report speed

- **Status:** Accepted (2026-10-10)
- **Source:** docs/plan.md §14, decision 21

## Decision
Split SLO: deterministic <30 s, LLM/STT queued

## Rejected alternatives, and why
A single <30 s: impossible at drive scale

## Reopen only if
Not expected to reopen.

## Consequences for the code
Any change that contradicts this decision must be flagged in review as a blocking finding unless a superseding ADR exists.
