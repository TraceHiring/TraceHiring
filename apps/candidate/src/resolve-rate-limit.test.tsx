// @vitest-environment happy-dom
// OPEN-13 follow-up (security review SEC-W1-2): the edge caps `invite/resolve` with a coarse limit and answers 429
// `rate_limited` with `Retry-After`. The app shows the wait copy and keeps "Try again" disabled until that wait has
// passed (a missing or invalid header waits 10 s), then enables it; it never retries on its own. Other refusals keep
// their copy with an enabled "Try again" (unchanged): a 503 the network error, a 401 the generic one. Synthetic data.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Boot } from './boot';
import { COPY } from './copy';
import { buttonByText, click, mockFetch, mount, type Mounted } from './dom.test-helpers';
import { json, LINK_TOKEN } from './fixtures.test-helpers';

const ORIGIN = 'https://trace-edge-staging.example-sub.workers.dev';
const BOOT: Boot = { linkToken: LINK_TOKEN, badLink: false, stored: null, origin: ORIGIN };

let app: Mounted | undefined;

/** Advances the fake clock inside act, letting the fetch promises settle. */
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const retryButton = (root: ParentNode): HTMLButtonElement => {
  const b = buttonByText(root, COPY.error.retry);
  if (b === undefined) throw new Error('no retry button');
  return b;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(async () => {
  await app?.unmount();
  app = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('invite/resolve answers 429 rate_limited', () => {
  it('shows the wait copy; Try again stays disabled until Retry-After has passed, with no auto-retry', async () => {
    const fetch = mockFetch({
      'POST /v1/invite/resolve': () => json(429, { error: 'rate_limited' }, { 'retry-after': '7' }),
    });
    app = await mount(<App boot={BOOT} />);
    await advance(0);

    const { container } = app;
    expect(container.textContent).toContain(COPY.rules.wait(7));
    expect(container.textContent).not.toContain(COPY.error.generic);
    expect(retryButton(container).disabled).toBe(true);

    await advance(6_999);
    expect(retryButton(container).disabled).toBe(true);
    await advance(1);
    expect(retryButton(container).disabled).toBe(false);

    // Nothing was sent again on its own, even well after the wait.
    await advance(60_000);
    expect(fetch.paths()).toEqual(['POST /v1/invite/resolve']);

    await click(retryButton(container));
    await advance(0);
    expect(fetch.paths()).toEqual(['POST /v1/invite/resolve', 'POST /v1/invite/resolve']);
    // Refused again: a fresh wait, disabled again.
    expect(retryButton(container).disabled).toBe(true);
  });

  it.each([
    ['missing', {}],
    ['not a number of seconds', { 'retry-after': 'soon' }],
    ['zero', { 'retry-after': '0' }],
  ] as const)('a %s Retry-After waits 10 s', async (_label, headers) => {
    mockFetch({
      'POST /v1/invite/resolve': () => json(429, { error: 'rate_limited' }, { ...headers }),
    });
    app = await mount(<App boot={BOOT} />);
    await advance(0);

    const { container } = app;
    expect(container.textContent).toContain(COPY.rules.wait(10));
    expect(retryButton(container).disabled).toBe(true);
    await advance(9_999);
    expect(retryButton(container).disabled).toBe(true);
    await advance(1);
    expect(retryButton(container).disabled).toBe(false);
  });

  it.each([
    ['503 unavailable (network copy, as before)', 503, 'unavailable', COPY.error.network],
    ['401 token_invalid (generic copy, as before)', 401, 'token_invalid', COPY.error.generic],
  ] as const)(
    'a %s keeps its copy, and Try again is enabled at once',
    async (_l, status, code, copy) => {
      mockFetch({ 'POST /v1/invite/resolve': () => json(status, { error: code }) });
      app = await mount(<App boot={BOOT} />);
      await advance(0);

      const { container } = app;
      expect(container.textContent).toContain(copy);
      expect(container.textContent).not.toContain('Please wait');
      expect(retryButton(container).disabled).toBe(false);
    },
  );
});
