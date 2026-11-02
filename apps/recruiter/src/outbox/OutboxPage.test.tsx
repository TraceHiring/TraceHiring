// The demo outbox screen (specs/d1-demo-slice.md §6.1; non-production builds only): banner, newest first, 3 s poll.
import type { OutboxListResponse } from '@trace/shared/contracts/d1';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/client';
import { OutboxView, createOutboxPoller, sortOutbox } from './OutboxPage';

const ORG = '11111111-1111-4111-8111-111111111111';
const entry = (n: number, kind: 'invite' | 'otp', createdAt: string) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  createdAt,
  kind,
  candidateLabel: `Candidate ${n}`,
  bodyText: `Synthetic body ${n}`,
});
const DATA: OutboxListResponse = {
  entries: [
    entry(1, 'invite', '2026-10-19T10:00:00.000Z'),
    entry(2, 'otp', '2026-10-19T10:05:00.000Z'),
  ],
};
const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('OutboxView', () => {
  it('shows the banner and the newest message first', () => {
    const text = plain(renderToString(<OutboxView data={DATA} />));
    expect(text).toContain('Demo outbox: messages are not sent');
    expect(text.indexOf('Synthetic body 2')).toBeLessThan(text.indexOf('Synthetic body 1'));
    expect(text).toContain('Candidate 2');
    expect(sortOutbox(DATA.entries).map((e) => e.candidateLabel)).toEqual([
      'Candidate 2',
      'Candidate 1',
    ]);
  });
});

describe('outbox polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls every 3 s and never slows down', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(DATA), { headers: { 'content-type': 'application/json' } }),
      ),
    );
    const api = new ApiClient({
      origin: 'https://trace-api-staging.example-sub.workers.dev',
      orgId: ORG,
      getAccessToken: () => Promise.resolve('tok'),
      fetch: fetchImpl,
    });
    const poller = createOutboxPoller(api);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchImpl).toHaveBeenCalledTimes(41);
    poller.stop();
  });
});
