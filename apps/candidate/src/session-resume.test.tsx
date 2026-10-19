// @vitest-environment happy-dom
// AT-D36 (specs/d1-demo-slice.md §4.7, RT-4): a reload with a stored session token calls `attach` exactly once (even
// under React StrictMode, whose double effect would otherwise open two streams that supersede each other), restores
// the answers from the server's view, shows a smaller timer read from the server clock, and continues on the new
// stream. A finished session shows its receipt; a superseded one says it is open in another window.
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { readBoot, type Boot } from './boot';
import { COPY, receiptLabel } from './copy';
import {
  buttonByText,
  click,
  h1Text,
  mockFetch,
  mount,
  settle,
  typeInto,
  waitFor,
  type Mounted,
} from './dom.test-helpers';
import {
  json,
  MCQ_ITEM,
  RECEIPT,
  SESSION_TOKEN,
  STREAM_ID,
  STREAM_ID_2,
  viewAt,
  WRITTEN_ITEM,
} from './fixtures.test-helpers';
import { loadSession, SESSION_KEY } from './session-store';

const ORIGIN = 'https://trace-edge-staging.example-sub.workers.dev';
const DURATION_MS = 30 * 60_000;

/** mm:ss or h:mm:ss in ms. */
const parseClock = (text: string): number => {
  const parts = text.split(':').map(Number);
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
};

/** Stores the session as the start step left it, two minutes into a 30-minute test. */
const storeSession = (nowMs: number) => {
  const view = viewAt(nowMs - 10 * 60_000, { startedAgoMs: 2 * 60_000, durationMs: DURATION_MS });
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ sessionToken: SESSION_TOKEN, streamId: STREAM_ID, view }),
  );
  return view;
};

const bootFromStorage = (): Boot => ({ ...readBoot(), origin: ORIGIN });

let app: Mounted | undefined;

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(async () => {
  await app?.unmount();
  app = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AT-D36 reload', () => {
  it('attaches once, restores answers and shows a smaller timer, then saves on the new stream', async () => {
    const now = Date.now();
    const stored = storeSession(now);
    // The server: 12 minutes into the test (10 since the stored snapshot), with the candidate's answers.
    const attached = viewAt(now, {
      startedAgoMs: 12 * 60_000,
      durationMs: DURATION_MS,
      streamId: STREAM_ID_2,
      answers: [
        { position: 1, choice: 'b' },
        { position: 2, text: 'restored draft 😀' },
      ],
    });
    const edge = mockFetch({
      'POST /v1/session/attach': () => json(200, { view: attached }),
      'GET /v1/session/items/:pos': (req) =>
        json(200, req.path.endsWith('/1') ? MCQ_ITEM : WRITTEN_ITEM),
      'POST /v1/session/events': (req) =>
        json(200, {
          ackSeq: (req.body as { events: { seq: number }[] }).events.at(-1)?.seq ?? 0,
          serverNow: new Date().toISOString(),
          deadlineAt: attached.deadlineAt,
          state: 'in_progress',
        }),
    });

    const boot = bootFromStorage();
    expect(boot.stored?.sessionToken).toBe(SESSION_TOKEN);
    app = await mount(
      <StrictMode>
        <App boot={boot} />
      </StrictMode>,
    );
    const { container } = app;
    await waitFor(() => h1Text(container) === attached.title, 'test screen');
    await settle(50);

    // attach exactly once, with the stored token.
    const attaches = edge.calls.filter((c) => c.path === '/v1/session/attach');
    expect(attaches).toHaveLength(1);
    expect(attaches[0]?.headers['authorization']).toBe(`Bearer ${SESSION_TOKEN}`);

    // The MCQ answer is restored.
    const radio = await waitFor(
      () => container.querySelector<HTMLInputElement>('input[type="radio"][value="b"]'),
      'mcq options',
    );
    expect(radio.checked).toBe(true);

    // A smaller timer: about 18 minutes left, less than the 28 the stored snapshot had.
    const timer = container.querySelector('[data-testid="timer"]')?.textContent ?? '';
    const left = parseClock(timer);
    const storedLeft = Date.parse(stored.deadlineAt) - Date.parse(stored.serverNow);
    expect(storedLeft).toBe(28 * 60_000);
    expect(left).toBeLessThan(storedLeft);
    expect(left).toBeLessThanOrEqual(18 * 60_000);
    expect(left).toBeGreaterThan(17 * 60_000);

    // The written answer is restored.
    await click(buttonByText(container, COPY.test.next) as HTMLButtonElement);
    const textarea = await waitFor(() => container.querySelector('textarea'), 'textarea');
    expect(textarea.value).toBe('restored draft 😀');

    // Each item was fetched once.
    expect(edge.calls.filter((c) => c.path === '/v1/session/items/1')).toHaveLength(1);
    expect(edge.calls.filter((c) => c.path === '/v1/session/items/2')).toHaveLength(1);

    // The stored session now names the new stream, and edits go to it from seq 1, continuing the restored text.
    expect(loadSession()?.streamId).toBe(STREAM_ID_2);
    await typeInto(textarea, 'restored draft 😀!');
    await waitFor(
      () => edge.calls.find((c) => c.path === '/v1/session/events'),
      'an events batch',
      6_000,
    );
    const batch = edge.calls.find((c) => c.path === '/v1/session/events')?.body as {
      streamId: string;
      events: Record<string, unknown>[];
    };
    expect(batch.streamId).toBe(STREAM_ID_2);
    const edit = batch.events.find((e) => e['kind'] === 'answer.text');
    expect(edit).toMatchObject({ item: 2, p: 'restored draft 😀'.length, d: 0, i: '!' });
    expect(batch.events[0]?.['seq']).toBe(1);
  }, 20_000);

  it('a reload after submit shows the receipt only', async () => {
    const now = Date.now();
    storeSession(now);
    mockFetch({
      'POST /v1/session/attach': () => json(200, { view: viewAt(now, { receipt: RECEIPT }) }),
    });
    app = await mount(<App boot={bootFromStorage()} />);
    const { container } = app;
    await waitFor(() => h1Text(container) === COPY.submitted.title, 'receipt');
    expect(container.textContent).toContain(receiptLabel(RECEIPT.receiptRef));
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('a superseded token says the test is open in another window', async () => {
    storeSession(Date.now());
    mockFetch({ 'POST /v1/session/attach': () => json(401, { error: 'superseded' }) });
    app = await mount(<App boot={bootFromStorage()} />);
    const { container } = app;
    await waitFor(() => h1Text(container) === COPY.error.title, 'error');
    expect(container.textContent).toContain(COPY.error.superseded);
  });

  it('an expired stored token is forgotten and the link is used instead', async () => {
    storeSession(Date.now());
    const edge = mockFetch({
      'POST /v1/session/attach': () => json(401, { error: 'token_expired' }),
      'POST /v1/invite/resolve': () => json(200, { state: 'started' }),
    });
    app = await mount(<App boot={{ ...bootFromStorage(), linkToken: 'A'.repeat(43) }} />);
    const { container } = app;
    await waitFor(() => h1Text(container) === COPY.otp.title, 'otp');
    expect(edge.paths()).toEqual(['POST /v1/session/attach', 'POST /v1/invite/resolve']);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
