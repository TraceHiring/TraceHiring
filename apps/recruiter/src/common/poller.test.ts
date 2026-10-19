// AT-D17 (polling states, fake timers): each card polls only its own endpoint every 3 s while pending, then
// every 15 s after 90 s with "slow" set; there is no failed state; a final answer stops the polling.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '../api/client';
import { CardPoller, FAST_MS, SLOW_AFTER_MS, SLOW_MS } from './poller';

type Card = { state: 'pending' } | { state: 'ready' };
const isFinal = (card: Card) => card.state !== 'pending';
const ok = (data: Card): ApiResult<Card> => ({ ok: true, data });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('CardPoller', () => {
  it('has the spec cadence constants (3 s, 90 s, 15 s)', () => {
    expect([FAST_MS, SLOW_AFTER_MS, SLOW_MS]).toEqual([3000, 90_000, 15_000]);
  });

  it('fetches at once, then every 3 s while pending, and stops at a final answer', async () => {
    const answers: Card[] = [{ state: 'pending' }, { state: 'pending' }, { state: 'ready' }];
    const fetchCard = vi.fn(() => Promise.resolve(ok(answers.shift() ?? { state: 'ready' })));
    const poller = new CardPoller<Card>({ fetchCard, isFinal });
    expect(poller.getSnapshot().state).toEqual({ kind: 'loading' });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchCard).toHaveBeenCalledTimes(1);
    expect(poller.getSnapshot().state).toEqual({ kind: 'value', value: { state: 'pending' } });
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchCard).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchCard).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchCard).toHaveBeenCalledTimes(3);
    expect(poller.getSnapshot().state).toEqual({ kind: 'value', value: { state: 'ready' } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCard).toHaveBeenCalledTimes(3);
  });

  it('after 90 s polls every 15 s and reports slow', async () => {
    const fetchCard = vi.fn(() => Promise.resolve(ok({ state: 'pending' })));
    const poller = new CardPoller<Card>({ fetchCard, isFinal });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(poller.getSnapshot().slow).toBe(false);
    await vi.advanceTimersByTimeAsync(90_000);
    const callsAt90 = fetchCard.mock.calls.length;
    expect(callsAt90).toBe(31); // t = 0, 3, ..., 90 s
    expect(poller.getSnapshot().slow).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchCard).toHaveBeenCalledTimes(callsAt90 + 1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetchCard).toHaveBeenCalledTimes(callsAt90 + 1);
    poller.stop();
  });

  it('a failed or unreadable response is "unavailable" and the poll goes on (no failed state)', async () => {
    const results: ApiResult<Card>[] = [
      { ok: false, code: 'invalid_response' },
      { ok: false, code: 'network' },
      ok({ state: 'ready' }),
    ];
    const fetchCard = vi.fn(() => Promise.resolve(results.shift() ?? ok({ state: 'ready' })));
    const poller = new CardPoller<Card>({ fetchCard, isFinal });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(poller.getSnapshot().state).toEqual({ kind: 'unavailable' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(poller.getSnapshot().state).toEqual({ kind: 'unavailable' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(poller.getSnapshot().state).toEqual({ kind: 'value', value: { state: 'ready' } });
  });

  it('a previous value stays on screen while a later poll fails', async () => {
    const results: ApiResult<Card>[] = [ok({ state: 'pending' }), { ok: false, code: 'network' }];
    const fetchCard = vi.fn(() => Promise.resolve(results.shift() ?? ok({ state: 'pending' })));
    const poller = new CardPoller<Card>({ fetchCard, isFinal });
    poller.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(poller.getSnapshot().state).toEqual({ kind: 'value', value: { state: 'pending' } });
    poller.stop();
  });

  it('stop cancels the timer and drops an answer that arrives later', async () => {
    let release: (r: ApiResult<Card>) => void = () => undefined;
    const fetchCard = vi.fn(
      () =>
        new Promise<ApiResult<Card>>((resolve) => {
          release = resolve;
        }),
    );
    const poller = new CardPoller<Card>({ fetchCard, isFinal });
    const listener = vi.fn();
    poller.subscribe(listener);
    poller.start();
    poller.stop();
    release(ok({ state: 'ready' }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCard).toHaveBeenCalledTimes(1);
    expect(poller.getSnapshot().state).toEqual({ kind: 'loading' });
  });

  it('two pollers are independent: one failing does not change the other', async () => {
    const a = new CardPoller<Card>({
      fetchCard: () => Promise.resolve(ok({ state: 'ready' })),
      isFinal,
    });
    const b = new CardPoller<Card>({
      fetchCard: () => Promise.resolve({ ok: false, code: 'unavailable' }),
      isFinal,
    });
    a.start();
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.getSnapshot().state).toEqual({ kind: 'value', value: { state: 'ready' } });
    expect(b.getSnapshot().state).toEqual({ kind: 'unavailable' });
    b.stop();
  });
});
