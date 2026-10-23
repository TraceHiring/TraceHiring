// S6 + X2: a worker that never answers ends in worker_failed after a fixed time and is terminated; the worker entry
// answers worker_failed when posting its answer throws, instead of dying silently.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asFile, xlsxBytes, mcqRow } from './fixtures.test-helpers';
import { EXTRACT_TIMEOUT_MS, extractInWorker, type WorkerLike } from './worker-client';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('extractInWorker: a worker that never answers', () => {
  it('gives worker_failed after the timeout and terminates the worker', async () => {
    vi.useFakeTimers();
    let terminated = 0;
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage() {},
      terminate() {
        terminated += 1;
      },
    };
    const answer = extractInWorker(
      () => worker,
      asFile(xlsxBytes([mcqRow(1)]), 'items.xlsx'),
      'xlsx',
    );
    let settled = false;
    void answer.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(EXTRACT_TIMEOUT_MS - 1000);
    expect(settled).toBe(false);
    expect(terminated).toBe(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await answer).toEqual({ type: 'error', code: 'worker_failed' });
    expect(terminated).toBe(1);
  });

  it('is one minute, and a timely answer is not turned into a failure later', async () => {
    expect(EXTRACT_TIMEOUT_MS).toBe(60_000);
    vi.useFakeTimers();
    let terminated = 0;
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage() {
        queueMicrotask(() => {
          worker.onmessage?.({
            data: { type: 'result', kind: 'xlsx', xml: [], images: [], skippedImages: [] },
          });
        });
      },
      terminate() {
        terminated += 1;
      },
    };
    const answer = await extractInWorker(
      () => worker,
      asFile(xlsxBytes([mcqRow(1)]), 'items.xlsx'),
      'xlsx',
    );
    expect(answer.type).toBe('result');
    await vi.advanceTimersByTimeAsync(EXTRACT_TIMEOUT_MS * 2);
    expect(terminated).toBe(1); // finished once, not again by the timer
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the worker entry', () => {
  it('answers worker_failed when posting the answer throws, and handles the next message', async () => {
    const posted: unknown[] = [];
    let listener: ((event: { data: unknown }) => void) | null = null;
    let first = true;
    vi.stubGlobal('self', {
      addEventListener: (_type: string, fn: (event: { data: unknown }) => void) => {
        listener = fn;
      },
      postMessage: (message: unknown) => {
        if (first) {
          first = false;
          throw new Error('synthetic clone failure');
        }
        posted.push(message);
      },
    });
    await import('./import.worker');
    expect(listener).not.toBeNull();
    (listener as unknown as (event: { data: unknown }) => void)({ data: { nonsense: true } });
    await new Promise((r) => setTimeout(r, 20));
    expect(posted).toEqual([{ type: 'error', code: 'worker_failed' }]);
  });
});
