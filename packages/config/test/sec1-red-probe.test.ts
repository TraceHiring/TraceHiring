import { describe, expect, it } from 'vitest';

// Deliberately red: proves the main ruleset blocks a PR whose required checks fail (M0a SEC-1).
// This branch is never merged; its PR is closed after the blocked state is recorded.
describe('sec1 red probe', () => {
  it('fails on purpose', () => {
    expect(1).toBe(2);
  });
});
