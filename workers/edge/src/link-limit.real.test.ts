/// <reference types="@cloudflare/vitest-pool-workers/types" />
// OPEN-13 on the real Workers Rate Limiting binding (miniflare's local `ratelimits`, the `edge-do` pool). The pool binds
// LINK_LIMITER at a small test limit (vitest.config.ts: 3 per 10 s; deployed: 300 per 10 s); these tests prove the
// binding answers `{ success: boolean }` for `limit({ key })`, refuses the call past the limit within a window, and
// that the real app turns that refusal into 429 with no api call. Miniflare's windows are aligned to the wall clock, so
// a run that straddles a window edge is retried once. Synthetic data only.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { bound } from './real.test-helpers.js';

/** The pool's test limit (vitest.config.ts). */
const TEST_LIMIT = 3;
const PERIOD_MS = 10_000;
const windowOf = (ms: number) => Math.floor(ms / PERIOD_MS);

/** Runs `fn` until it starts and ends in the same rate-limit window (at most three tries). */
const inOneWindow = async <T>(fn: () => Promise<T>): Promise<T> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = windowOf(Date.now());
    const result = await fn();
    if (windowOf(Date.now()) === before) return result;
  }
  throw new Error('every attempt straddled a window edge');
};

describe('LINK_LIMITER (real binding, miniflare)', () => {
  it('limit({ key }) answers { success: boolean }, and the call past the limit is refused', async () => {
    const limiter = bound('LINK_LIMITER');
    const outcomes = await inOneWindow(async () => {
      // A fresh key per attempt, so this test never shares a counter with another.
      const key = `test:${crypto.randomUUID()}`;
      const out: unknown[] = [];
      for (let i = 0; i <= TEST_LIMIT; i += 1) out.push(await limiter.limit({ key }));
      return out;
    });

    expect(outcomes).toEqual([
      ...Array<unknown>(TEST_LIMIT).fill({ success: true }),
      { success: false },
    ]);
  });

  it('the real app answers 429 rate_limited with Retry-After: 10 once the route key is spent', async () => {
    const result = await inOneWindow(async () => {
      let apiCalls = 0;
      const api = {
        inviteResolve: () => {
          apiCalls += 1;
          return Promise.resolve({
            invitationId: '11111111-1111-4111-8111-111111111111',
            orgId: '22222222-2222-4222-8222-222222222222',
            candidateId: '33333333-3333-4333-8333-333333333333',
            state: 'sent',
            title: 'Demo assessment',
            durationMinutes: 20,
          });
        },
      };
      const app = createApp();
      const testEnv = { ...env, API: api, CANDIDATE_APP_ORIGIN: 'https://candidate.example.test' };
      const statuses: number[] = [];
      let refusal: Response | undefined;
      // The route key is a constant, so earlier calls in this window may already count: call until the first refusal.
      for (let i = 0; i <= TEST_LIMIT && refusal === undefined; i += 1) {
        const res = await app.request(
          'https://edge.test/v1/invite/resolve',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: `${'L'.repeat(21)}${'k'.repeat(22)}` }),
          },
          testEnv as unknown as Env,
        );
        statuses.push(res.status);
        if (res.status === 429) refusal = res;
      }
      return { statuses, refusal, apiCalls };
    });

    expect(result.refusal).toBeDefined();
    expect(result.statuses.at(-1)).toBe(429);
    expect(result.statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
    expect(result.apiCalls).toBe(result.statuses.length - 1);
    expect(await result.refusal?.json()).toEqual({ error: 'rate_limited' });
    expect(result.refusal?.headers.get('retry-after')).toBe('10');
  });
});
