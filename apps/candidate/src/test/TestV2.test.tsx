// @vitest-environment happy-dom
// AT-M1-32, candidate app v2 (specs/m1-test-authoring.md R5-9, R5-10, R5-20, R5-24, R5-45, R5-59 d/e, R5-66): the
// section deadline from the server's `deadlineAt`, a closed section read-only, forward-only without "Previous",
// options in served order, images as `data:` URLs through the edge route only, `refusedSeqs` acknowledged and
// reverted, an item 410 `section_closed` moving on without a retry, the paste rule text and behaviour per section,
// `afterSeq` with the 409 `out_of_order` flush-and-retry, the section transition (flush, attach, the new stream),
// attach failures, the finish confirm, and v1 sessions as D1. A fake edge with the SessionDO's rules; synthetic data.
import type {
  ClientEvent,
  EventBatchReq,
  Receipt,
  ServedItemV2,
  SessionView,
  SessionViewV2,
} from '@trace/shared/contracts/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, CandidateApi } from '../api';
import { COPY } from '../copy';
import {
  buttonByText,
  click,
  deferred,
  mount,
  settle,
  sha256HexOf,
  typeInto,
  waitFor,
  waitForButton,
  type Mounted,
} from '../dom.test-helpers';
import {
  mcqItemV2,
  mcqSection,
  PNG_BYTES,
  RECEIPT,
  SECTION_ID,
  SECTION_ID_2,
  SESSION_TOKEN,
  STREAM_ID,
  STREAM_ID_2,
  viewAt,
  viewV2At,
  writtenItemV2,
  writtenSection,
  MCQ_ITEM,
  WRITTEN_ITEM,
} from '../fixtures.test-helpers';
import { Test, type TestEnd } from './Test';
import { attachWaitMs } from './useSectionTransition';

type Fn<K extends keyof CandidateApi> = ReturnType<typeof vi.fn<CandidateApi[K]>>;

const fail = (code: string, status: number, extra: object = {}): ApiResult<never> =>
  ({ ok: false, code, status, ...extra }) as ApiResult<never>;

interface Fake {
  api: CandidateApi;
  item: Fn<'item'>;
  events: Fn<'events'>;
  attach: Fn<'attach'>;
  submit: Fn<'submit'>;
  media: Fn<'media'>;
  /** The fake DO: the active stream's high-water mark and the views attach answers next. */
  state: { hw: number; view: SessionView | SessionViewV2; next: SessionViewV2[] };
  /** Every event sent, with its stream. */
  sent: () => (ClientEvent & { streamId: string })[];
}

const servedOf = (view: SessionViewV2, position: number): ServedItemV2 | null => {
  const meta = view.items.find((i) => i.position === position);
  const section = view.sections.find((s) => s.id === meta?.sectionId);
  if (meta === undefined || section === undefined) return null;
  return section.format === 'mcq'
    ? mcqItemV2(position, section.id)
    : writtenItemV2(position, section.id);
};

const fakeApi = (view: SessionView | SessionViewV2): Fake => {
  const state: Fake['state'] = { hw: 0, view, next: [] };
  const item = vi.fn<CandidateApi['item']>(async (_t, position) => {
    const v = state.view;
    if (!('v' in v)) return { ok: true, value: position === 1 ? MCQ_ITEM : WRITTEN_ITEM };
    const served = servedOf(v, position);
    return served === null ? fail('bad_request', 400) : { ok: true, value: served };
  });
  const events = vi.fn<CandidateApi['events']>(async (_t, batch: EventBatchReq) => {
    state.hw = Math.max(state.hw, batch.events.at(-1)?.seq ?? 0);
    return {
      ok: true,
      value: {
        ackSeq: state.hw,
        serverNow: new Date().toISOString(),
        deadlineAt: state.view.deadlineAt,
        state: 'in_progress',
      },
    };
  });
  const attach = vi.fn<CandidateApi['attach']>(async () => {
    const next = state.next.shift();
    if (next === undefined) return fail('network', 0);
    state.view = next;
    state.hw = 0;
    return { ok: true, value: { view: next } };
  });
  const submit = vi.fn<CandidateApi['submit']>(async () => ({ ok: true, value: RECEIPT }));
  const media = vi.fn<CandidateApi['media']>(async () => ({
    ok: true,
    value: { type: 'image/png', bytes: PNG_BYTES },
  }));
  const unused = async () => fail('unexpected', 0);
  const api: CandidateApi = {
    resolve: unused,
    otpRequest: unused,
    otpVerify: unused,
    age: unused,
    notice: unused,
    consent: unused,
    photo: unused,
    start: unused,
    attach,
    item,
    events,
    submit,
    media,
  };
  const sent = () =>
    events.mock.calls.flatMap(([, b]) => b.events.map((e) => ({ ...e, streamId: b.streamId })));
  return { api, item, events, attach, submit, media, state, sent };
};

let app: Mounted | undefined;
let receipts: Receipt[];
let ends: TestEnd[];

const render = async (view: SessionView | SessionViewV2, fake: Fake, offsetMs = 0) => {
  app = await mount(
    <Test
      api={fake.api}
      sessionToken={SESSION_TOKEN}
      view={view}
      offsetMs={offsetMs}
      onReceipt={(r) => receipts.push(r)}
      onEnd={(why) => ends.push(why)}
    />,
  );
  return app.container;
};

beforeEach(() => {
  receipts = [];
  ends = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(async () => {
  await app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
});

const radio = (container: HTMLElement, id: string) =>
  waitFor(
    () => container.querySelector<HTMLInputElement>(`input[type="radio"][value="${id}"]`),
    `option ${id}`,
  );
const textarea = (container: HTMLElement) =>
  waitFor(() => container.querySelector<HTMLTextAreaElement>('textarea'), 'textarea');
const heading = (container: HTMLElement) =>
  [...container.querySelectorAll('h2')].map((h) => h.textContent);
/** The nav button for question k (1-based, in display order). */
const navButton = (container: HTMLElement, k: number, of: number) =>
  [...container.querySelectorAll('nav button')].find((b) =>
    b.textContent?.startsWith(COPY.test.question(k, of)),
  ) as HTMLButtonElement | undefined;
const itemCalls = (fake: Fake, position: number) =>
  fake.item.mock.calls.filter(([, p]) => p === position);

/** A v2 view after the first section closed: a new stream, the second section open. */
const afterFirstCloses = (
  sections = [mcqSection({ state: 'closed' }), writtenSection()],
  answers: SessionViewV2['answers'] = [],
) => viewV2At(Date.now(), { streamId: STREAM_ID_2, sections, served: [1], answers });

describe('AT-M1-32 candidate app v2', { timeout: 20_000 }, () => {
  it('shows the section deadline from the server deadlineAt through the clock offset', async () => {
    const now = Date.now();
    const view = viewV2At(now, {
      sections: [
        mcqSection({ deadlineAt: new Date(now + 5 * 60_000).toISOString() }),
        writtenSection({ state: 'not_entered' }),
      ],
    });
    const fake = fakeApi(view);
    // The server clock is one minute ahead of this device: four minutes are left, not five.
    const container = await render(view, fake, 60_000);
    const timer = await waitFor(
      () => container.querySelector('[data-testid="section-timer"]'),
      'section timer',
    );
    expect(['04:00', '03:59']).toContain(timer.textContent);
    expect(container.textContent).toContain(COPY.test.sectionTimeLeft);
    expect(['29:00', '28:59']).toContain(
      container.querySelector('[data-testid="timer"]')?.textContent,
    );
  });

  it('never requests an item of a not_entered section, and its questions cannot be opened', async () => {
    const now = Date.now();
    const view = viewV2At(now, {
      sections: [
        mcqSection({ deadlineAt: new Date(now + 5 * 60_000).toISOString() }),
        writtenSection({ state: 'not_entered' }),
      ],
    });
    const fake = fakeApi(view);
    const container = await render(view, fake);
    await radio(container, 'a');
    expect(navButton(container, 3, 4)?.disabled).toBe(true);
    await click(await waitForButton(container, COPY.test.next));
    await radio(container, 'a');
    // At the end of the open section, "Next" cannot enter the next one: the server opens it.
    expect(buttonByText(container, COPY.test.next)?.disabled).toBe(true);
    await settle(50);
    expect(fake.item.mock.calls.map(([, p]) => p)).toEqual([1, 2]);
  });

  it('a closed section is read-only and its items are not requested', async () => {
    const view = viewV2At(Date.now(), {
      sections: [mcqSection({ state: 'closed' }), writtenSection()],
    });
    const fake = fakeApi(view);
    const container = await render(view, fake);
    // The app starts in the first open section.
    await textarea(container);
    expect(heading(container)).toContain(COPY.test.question(3, 4));
    const first = navButton(container, 1, 4);
    expect(first).toBeDefined();
    await click(first as HTMLButtonElement);
    await waitFor(() => container.textContent?.includes(COPY.test.sectionClosed), 'closed line');
    expect(container.querySelector('input[type="radio"]:not(:disabled)')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(itemCalls(fake, 1)).toHaveLength(0);
  });

  it('forward-only hides "Previous"; a free section keeps it', async () => {
    const view = viewV2At(Date.now());
    const fake = fakeApi(view);
    const container = await render(view, fake);
    await radio(container, 'a');
    expect(buttonByText(container, COPY.test.previous)).toBeDefined();
    await click(navButton(container, 3, 4) as HTMLButtonElement);
    await textarea(container);
    expect(buttonByText(container, COPY.test.previous)).toBeUndefined();
    expect(container.textContent).toContain(COPY.test.forwardOnly);
    // A forward-only question already passed cannot be opened again.
    await click(await waitForButton(container, COPY.test.next));
    await waitFor(() => itemCalls(fake, 4).length === 1, 'item 4');
    expect(navButton(container, 3, 4)?.disabled).toBe(true);
  });

  it('renders the options in served order, never reordered', async () => {
    const view = viewV2At(Date.now());
    const fake = fakeApi(view);
    const container = await render(view, fake);
    await radio(container, 'c');
    const labels = [...container.querySelectorAll('fieldset label')].map((l) => l.textContent);
    expect(labels).toEqual(['Option gamma', 'Option alpha', 'Option beta']);
  });

  it('loads item images through the edge route as data: URLs; a refused one shows one neutral line', async () => {
    const hash = await sha256HexOf(PNG_BYTES);
    const missing = 'd'.repeat(64);
    const view = viewV2At(Date.now());
    const fake = fakeApi(view);
    fake.item.mockImplementation(async (_t, position) => ({
      ok: true,
      value: {
        ...mcqItemV2(position),
        media: [
          { hash, alt: 'A synthetic bar chart' },
          { hash: missing, alt: 'A synthetic table' },
        ],
      },
    }));
    fake.media.mockImplementation(async (_t, h) =>
      h === hash
        ? { ok: true, value: { type: 'image/png', bytes: PNG_BYTES } }
        : fail('invalid_link', 404),
    );
    const container = await render(view, fake);
    const img = await waitFor(() => container.querySelector('img'), 'image');
    expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(img.getAttribute('alt')).toBe('A synthetic bar chart');
    await waitFor(
      () => container.textContent?.includes(COPY.test.imageUnavailable('A synthetic table')),
      'unavailable line',
    );
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(fake.media.mock.calls.map(([, h]) => h).sort()).toEqual([hash, missing].sort());
    // No other origin: every img source is a data: URL.
    for (const el of container.querySelectorAll('img'))
      expect(el.getAttribute('src')?.startsWith('data:')).toBe(true);
  });

  describe('R5-68 c: image failures', () => {
    const withImage = async (fake: Fake) => {
      const hash = await sha256HexOf(PNG_BYTES);
      fake.item.mockImplementation(async (_t, position) => ({
        ok: true,
        value: { ...mcqItemV2(position), media: [{ hash, alt: 'A synthetic chart' }] },
      }));
      return hash;
    };
    const png = { ok: true, value: { type: 'image/png', bytes: PNG_BYTES } } as const;

    it('a network failure is retried, then the image shows', async () => {
      const view = viewV2At(Date.now());
      const fake = fakeApi(view);
      await withImage(fake);
      fake.media.mockResolvedValueOnce(fail('network', 0)).mockResolvedValue(png);
      const container = await render(view, fake);
      const img = await waitFor(() => container.querySelector('img'), 'image', 6_000);
      expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
      expect(fake.media).toHaveBeenCalledTimes(2);
      expect(container.textContent).not.toContain(COPY.test.imageUnavailable('A synthetic chart'));
    });

    it('a 404 is final: the line with the alt text, no "Try again", no retry', async () => {
      const view = viewV2At(Date.now());
      const fake = fakeApi(view);
      await withImage(fake);
      fake.media.mockResolvedValue(fail('invalid_link', 404));
      const container = await render(view, fake);
      await waitFor(
        () => container.textContent?.includes(COPY.test.imageUnavailable('A synthetic chart')),
        'line',
      );
      await settle(1_200);
      expect(fake.media).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-testid="image-retry"]')).toBeNull();
    });

    it('after 4 tries the line shows with "Try again", which loads it again', async () => {
      const view = viewV2At(Date.now());
      const fake = fakeApi(view);
      await withImage(fake);
      // A 429 whose Retry-After is 0: its Retry-After wins over the backoff, so the tries run at once.
      fake.media.mockResolvedValue(fail('rate_limited', 429, { retryAfterSeconds: 0 }));
      const container = await render(view, fake);
      const again = await waitFor(
        () => container.querySelector<HTMLButtonElement>('[data-testid="image-retry"]'),
        'try again',
      );
      expect(again.textContent).toBe(COPY.test.retry);
      expect(container.textContent).toContain(COPY.test.imageUnavailable('A synthetic chart'));
      expect(fake.media).toHaveBeenCalledTimes(4);
      fake.media.mockResolvedValue(png);
      await click(again);
      await waitFor(() => container.querySelector('img'), 'image');
      expect(fake.media).toHaveBeenCalledTimes(5);
      expect(container.querySelector('[data-testid="image-retry"]')).toBeNull();
    });
  });

  it('a refused answer (refusedSeqs) is reverted on screen and never resent', async () => {
    const view = viewV2At(Date.now());
    const fake = fakeApi(view);
    fake.events.mockImplementation(async (_t, batch) => {
      fake.state.hw = batch.events.at(-1)?.seq ?? 0;
      const refused = batch.events.filter((e) => e.kind === 'answer.choice').map((e) => e.seq);
      return {
        ok: true,
        value: {
          ackSeq: fake.state.hw,
          serverNow: new Date().toISOString(),
          deadlineAt: view.deadlineAt,
          state: 'in_progress',
          ...(refused.length === 0 ? {} : { refusedSeqs: refused }),
        },
      };
    });
    const container = await render(view, fake);
    await click(await radio(container, 'a'));
    expect((await radio(container, 'a')).checked).toBe(true);
    await waitFor(
      () =>
        container.querySelector<HTMLInputElement>('input[type="radio"][value="a"]')?.checked ===
        false,
      'revert',
      6_000,
    );
    await settle(2_500);
    expect(fake.sent().filter((e) => e.kind === 'answer.choice')).toHaveLength(1);
  });

  it('an item GET 410 section_closed moves on without a retry (flush, attach, the new stream)', async () => {
    const view = viewV2At(Date.now());
    const fake = fakeApi(view);
    fake.item.mockImplementationOnce(async () => fail('section_closed', 410));
    fake.state.next.push(afterFirstCloses());
    const container = await render(view, fake);
    await textarea(container);
    expect(heading(container)).toContain(COPY.test.question(3, 4));
    expect(itemCalls(fake, 1)).toHaveLength(1);
    expect(fake.attach).toHaveBeenCalledTimes(1);
    await typeInto(await textarea(container), 'draft');
    await waitFor(() => fake.sent().some((e) => e.kind === 'answer.text'), 'text event', 6_000);
    expect(fake.sent().find((e) => e.kind === 'answer.text')?.streamId).toBe(STREAM_ID_2);
    expect(ends).toEqual([]);
  });

  it('shows the paste rule of each written section (R5-24) and applies it', async () => {
    for (const rule of ['blocked', 'allowed_logged'] as const) {
      const view = viewV2At(Date.now(), {
        sections: [writtenSection({ pasteRule: rule, position: 1 })],
      });
      const fake = fakeApi(view);
      const container = await render(view, fake);
      const box = await textarea(container);
      const line = rule === 'blocked' ? COPY.test.pasteBlocked : COPY.test.pasteAllowed;
      const other = rule === 'blocked' ? COPY.test.pasteAllowed : COPY.test.pasteBlocked;
      expect(container.textContent).toContain(line);
      expect(container.textContent).not.toContain(other);
      expect(container.textContent).toContain(COPY.test.dropBlocked);
      // The v1 (D1) test-wide line never shows on a v2 screen (R5-68 a).
      expect(container.textContent).not.toContain(COPY.test.pasteOffInTest);
      const e = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: () => 'synthetic' } });
      box.dispatchEvent(e);
      expect(e.defaultPrevented, rule).toBe(rule === 'blocked');
      const d = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(d, 'dataTransfer', {
        value: { types: ['text/plain'], files: { length: 0 }, getData: () => 'synthetic' },
      });
      box.dispatchEvent(d);
      expect(d.defaultPrevented, `${rule} drop`).toBe(true);
      await app?.unmount();
      app = undefined;
    }
    // The rules step before start names no paste rule and makes no per-section promise (R5-66 c, R5-68 a).
    const rules = COPY.rules.items.join(' ');
    expect(rules).not.toMatch(/Pasting and dropping text are blocked/);
    expect(rules).not.toMatch(/each section/i);
    expect(COPY.rules.items[0]).toBe(
      'Answer on your own. Where you type an answer, the screen shows whether pasting text is allowed. Dropping text is turned off. Paste and drop attempts are recorded.',
    );
  });

  it('R5-68 a: an MCQ-only test shows no paste or drop line', async () => {
    const view = viewV2At(Date.now(), { sections: [mcqSection()] });
    const fake = fakeApi(view);
    const container = await render(view, fake);
    await radio(container, 'a');
    for (const line of [
      COPY.test.pasteBlocked,
      COPY.test.pasteAllowed,
      COPY.test.pasteOffInTest,
      COPY.test.dropBlocked,
    ])
      expect(container.textContent).not.toContain(line);
  });

  it('R5-68 i: a closed written section shows its cached answer read-only (the textarea is disabled)', async () => {
    const view = viewV2At(Date.now(), {
      sections: [writtenSection({ position: 1 }), mcqSection({ position: 2 })],
    });
    const fake = fakeApi(view);
    fake.item.mockImplementation(async (_t, position) => ({
      ok: true,
      value: position <= 2 ? writtenItemV2(position, SECTION_ID_2) : mcqItemV2(position),
    }));
    fake.state.next.push(
      viewV2At(Date.now(), {
        streamId: STREAM_ID_2,
        sections: [writtenSection({ position: 1, state: 'closed' }), mcqSection({ position: 2 })],
        served: [1],
        answers: [{ position: 1, text: 'kept' }],
      }),
    );
    const container = await render(view, fake);
    await typeInto(await textarea(container), 'kept');
    await click(await waitForButton(container, COPY.test.finishSection));
    await click(await waitForButton(container, COPY.test.finishConfirm));
    await waitFor(() => fake.attach.mock.calls.length === 1, 'attach', 6_000);
    await radio(container, 'a');
    await click(navButton(container, 1, 4) as HTMLButtonElement);
    const box = await textarea(container);
    expect(box.value).toBe('kept');
    expect(box.disabled).toBe(true);
    expect(container.textContent).toContain(COPY.test.sectionClosed);
    expect(itemCalls(fake, 1)).toHaveLength(1);
  });

  it('R5-68 d: once the GET for N+1 is sent, item N is read-only (it cannot be reopened)', async () => {
    const view = viewV2At(Date.now(), {
      sections: [writtenSection({ position: 1 })],
      served: [1],
    });
    const fake = fakeApi(view);
    const held = deferred<ApiResult<ServedItemV2>>();
    fake.item.mockImplementation(async (_t, position) =>
      position === 2 ? held.promise : { ok: true, value: writtenItemV2(position) },
    );
    const container = await render(view, fake);
    await typeInto(await textarea(container), 'answer one');
    await click(await waitForButton(container, COPY.test.next));
    await waitFor(() => itemCalls(fake, 2).length === 1, 'GET 2');
    // While item 2 is on its way, question 1 counts as passed.
    expect(navButton(container, 1, 2)?.disabled).toBe(true);
    expect(buttonByText(container, COPY.test.previous)).toBeUndefined();
    held.resolve({ ok: true, value: writtenItemV2(2) });
    await waitFor(() => heading(container).includes(COPY.test.question(2, 2)), 'item 2');
    expect(navButton(container, 1, 2)?.disabled).toBe(true);
  });

  it('R5-68 d: a failed GET for N+1 leaves item N passed', async () => {
    const view = viewV2At(Date.now(), {
      sections: [writtenSection({ position: 1 })],
      served: [1],
    });
    const fake = fakeApi(view);
    fake.item.mockImplementation(async (_t, position) =>
      position === 2 ? fail('network', 0) : { ok: true, value: writtenItemV2(position) },
    );
    const container = await render(view, fake);
    await textarea(container);
    await click(await waitForButton(container, COPY.test.next));
    await waitForButton(container, COPY.test.retry);
    expect(navButton(container, 1, 2)?.disabled).toBe(true);
  });

  it('R5-68 d: a pending or failed GET for N+1 never lets the screen move past N+1', async () => {
    const view = viewV2At(Date.now(), {
      sections: [writtenSection({ position: 1 })],
      slots: [3],
      served: [1],
    });
    const fake = fakeApi(view);
    const held = deferred<ApiResult<ServedItemV2>>();
    let failNext = true;
    fake.item.mockImplementation(async (_t, position) => {
      if (position === 2 && failNext) {
        failNext = false;
        return held.promise;
      }
      return { ok: true, value: writtenItemV2(position) };
    });
    const container = await render(view, fake);
    await textarea(container);
    // A double click on "Next" sends one GET.
    const next = await waitForButton(container, COPY.test.next);
    await click(next);
    await click(next);
    await waitFor(() => itemCalls(fake, 2).length === 1, 'GET 2');
    const stuck = () => {
      expect(buttonByText(container, COPY.test.next)?.disabled).toBe(true);
      expect(navButton(container, 3, 3)?.disabled).toBe(true);
      expect(navButton(container, 1, 3)?.disabled).toBe(true);
    };
    stuck();
    // The GET fails: question 2 keeps its "Try again", question 1 stays passed, question 3 stays shut.
    held.resolve(fail('network', 0));
    const retry = await waitForButton(container, COPY.test.retry);
    stuck();
    expect(itemCalls(fake, 3)).toHaveLength(0);
    await click(retry);
    await textarea(container);
    expect(heading(container)).toContain(COPY.test.question(2, 3));
    expect(itemCalls(fake, 2)).toHaveLength(2);
    expect((await waitForButton(container, COPY.test.next)).disabled).toBe(false);
    expect(navButton(container, 1, 3)?.disabled).toBe(true);
    expect(itemCalls(fake, 3)).toHaveLength(0);
  });

  it('forward-only: the GET carries afterSeq; on 409 it flushes and retries, so the last edits are kept', async () => {
    const view = viewV2At(Date.now(), {
      sections: [writtenSection({ position: 1 })],
      served: [1],
    });
    const fake = fakeApi(view);
    const afterSeqs: (number | undefined)[] = [];
    /** The edge's acknowledged seq when each GET arrived. */
    const ackedAt: number[] = [];
    fake.item.mockImplementation(async (_t, position, afterSeq) => {
      afterSeqs.push(afterSeq);
      ackedAt.push(fake.state.hw);
      if (position === 2 && (afterSeq ?? 0) > fake.state.hw)
        return fail('out_of_order', 409, { ackSeq: fake.state.hw });
      return { ok: true, value: writtenItemV2(position) };
    });
    const container = await render(view, fake);
    await typeInto(await textarea(container), 'last words');
    await click(await waitForButton(container, COPY.test.next));
    await waitFor(() => heading(container).includes(COPY.test.question(2, 2)), 'item 2');
    await waitFor(() => itemCalls(fake, 2).length === 2, 'retry');
    expect(afterSeqs[0]).toBe(0);
    const [first, second] = itemCalls(fake, 2);
    // The edit and the untrusted-input signal the synthetic typing raised: seq 2 was the highest enqueued.
    expect(first?.[2]).toBe(2);
    // R5-68 f: the retry after the flush sends the acknowledged seq (>= the first afterSeq), not new heartbeats.
    expect(second?.[2]).toBe(ackedAt.at(-1));
    expect(second?.[2]).toBeGreaterThanOrEqual(2);
    // The edit went out between the refused GET and the retry.
    const textOrder = fake.events.mock.invocationCallOrder[0] ?? Infinity;
    const getOrders = fake.item.mock.invocationCallOrder.slice(-2);
    expect(textOrder).toBeGreaterThan(getOrders[0] ?? 0);
    expect(textOrder).toBeLessThan(getOrders[1] ?? 0);
    expect(fake.sent().filter((e) => e.kind === 'answer.text')).toEqual([
      expect.objectContaining({ item: 1, i: 'last words' }),
    ]);
  });

  it('a section deadline: flushes, attaches, and continues on the new stream', async () => {
    const now = Date.now();
    const view = viewV2At(now, {
      sections: [
        mcqSection({ deadlineAt: new Date(now + 1_500).toISOString() }),
        writtenSection({ state: 'not_entered' }),
      ],
    });
    const fake = fakeApi(view);
    fake.state.next.push(
      afterFirstCloses([
        mcqSection({ state: 'closed' }),
        writtenSection({ deadlineAt: new Date(now + 10 * 60_000).toISOString() }),
      ]),
    );
    const container = await render(view, fake);
    await click(await radio(container, 'b'));
    await waitFor(() => fake.attach.mock.calls.length === 1, 'attach', 6_000);
    // The choice was acknowledged on the old stream before the attach.
    const choice = fake.sent().find((e) => e.kind === 'answer.choice');
    expect(choice?.streamId).toBe(STREAM_ID);
    expect(fake.events.mock.invocationCallOrder[0]).toBeLessThan(
      fake.attach.mock.invocationCallOrder[0] ?? 0,
    );
    const box = await textarea(container);
    expect(heading(container)).toContain(COPY.test.question(3, 4));
    expect(itemCalls(fake, 3)[0]?.[2]).toBe(0);
    // Nothing of section two was requested before it opened.
    expect(fake.item.mock.invocationCallOrder[itemCalls(fake, 1).length]).toBeGreaterThan(
      fake.attach.mock.invocationCallOrder[0] ?? 0,
    );
    await typeInto(box, 'next');
    await waitFor(() => fake.sent().some((e) => e.kind === 'answer.text'), 'text', 6_000);
    expect(fake.sent().find((e) => e.kind === 'answer.text')?.streamId).toBe(STREAM_ID_2);
    expect(ends).toEqual([]);
  });

  it('attach failures: a network failure is retried; superseded ends the screen', async () => {
    const view = viewV2At(Date.now());
    const fake = fakeApi(view);
    fake.item.mockImplementationOnce(async () => fail('section_closed', 410));
    // The first attach fails (the fake has no next view yet), the retry succeeds.
    const container = await render(view, fake);
    await waitFor(() => fake.attach.mock.calls.length === 1, 'first attach');
    fake.state.next.push(afterFirstCloses());
    await textarea(container);
    expect(fake.attach.mock.calls.length).toBe(2);
    await app?.unmount();
    app = undefined;

    const again = fakeApi(viewV2At(Date.now()));
    again.item.mockImplementationOnce(async () => fail('section_closed', 410));
    again.attach.mockImplementation(async () => fail('superseded', 401));
    await render(again.state.view, again);
    await waitFor(() => ends.length === 1, 'end');
    expect(ends).toEqual(['superseded']);
  });

  it('R5-68 g: an attach answered with any other code stops retrying and shows the D1 screen for it', async () => {
    for (const [failure, end] of [
      [fail('not_eligible', 403), 'invalid'],
      [fail('bad_request', 400), 'invalid'],
      [fail('closed', 410), 'invalid'],
      [fail('unexpected', 500), 'network'],
    ] as const) {
      ends = [];
      const fake = fakeApi(viewV2At(Date.now()));
      fake.item.mockImplementationOnce(async () => fail('section_closed', 410));
      fake.attach.mockImplementation(async () => failure);
      await render(fake.state.view, fake);
      await waitFor(() => ends.length === 1, 'the end');
      await settle(1_500);
      expect(ends).toEqual([end]);
      expect(fake.attach).toHaveBeenCalledTimes(1);
      await app?.unmount();
      app = undefined;
    }
  });

  it('R5-68 g: an attach 429 waits for its Retry-After, a 503 backs off, then the screen continues', async () => {
    const fake = fakeApi(viewV2At(Date.now()));
    fake.item.mockImplementationOnce(async () => fail('section_closed', 410));
    fake.attach
      .mockImplementationOnce(async () => fail('rate_limited', 429, { retryAfterSeconds: 0 }))
      .mockImplementationOnce(async () => fail('unavailable', 503));
    fake.state.next.push(afterFirstCloses());
    const container = await render(fake.state.view, fake);
    await textarea(container);
    expect(fake.attach).toHaveBeenCalledTimes(3);
    expect(ends).toEqual([]);
  });

  it('an attach Retry-After is capped at 60 s, like the D1 boot path; else the backoff runs', () => {
    expect(attachWaitMs(fail('rate_limited', 429, { retryAfterSeconds: 3_600 }), 0)).toBe(60_000);
    expect(attachWaitMs(fail('rate_limited', 429, { retryAfterSeconds: 5 }), 0)).toBe(5_000);
    expect(attachWaitMs(fail('network', 0), 0)).toBe(1_000);
    expect(attachWaitMs(fail('unavailable', 503), 3)).toBe(8_000);
    expect(attachWaitMs(fail('network', 0), 9)).toBe(10_000);
  });

  it('finish: the confirm says finishing is final; confirming sends section.finish and attaches', async () => {
    const view = viewV2At(Date.now());
    const fake = fakeApi(view);
    // The edge kept the choice: the new view carries it.
    fake.state.next.push(afterFirstCloses(undefined, [{ position: 1, choice: 'a' }]));
    const container = await render(view, fake);
    await click(await radio(container, 'a'));
    await click(await waitForButton(container, COPY.test.finishSection));
    expect(container.textContent).toContain(COPY.test.finishBody);
    expect(COPY.test.finishBody).toMatch(/final/i);
    await click(await waitForButton(container, COPY.test.finishConfirm));
    await waitFor(() => fake.attach.mock.calls.length === 1, 'attach', 6_000);
    const finish = fake.sent().find((e) => e.kind === 'section.finish');
    expect(finish).toMatchObject({ sectionId: SECTION_ID, streamId: STREAM_ID });
    await textarea(container);
    // The finished section is read-only: its cached question shows, locked.
    await click(navButton(container, 1, 4) as HTMLButtonElement);
    const a = await radio(container, 'a');
    expect(a.checked).toBe(true);
    expect(a.closest('fieldset')?.disabled).toBe(true);
    expect(container.textContent).toContain(COPY.test.sectionClosed);
    expect(itemCalls(fake, 1)).toHaveLength(1);
  });

  it('R5-68 b (SR-4): a signal raised during the last flush round arrives on the new stream with its own t', async () => {
    const view = viewV2At(Date.now());
    const fake = fakeApi(view);
    fake.state.next.push(afterFirstCloses(undefined, [{ position: 1, choice: 'a' }]));
    let finishing = false;
    let raised = 0;
    const ok = fake.events.getMockImplementation();
    // While each flush round's batch is in flight on the old stream, the candidate pastes once more.
    fake.events.mockImplementation(async (token, batch) => {
      if (finishing && batch.streamId === STREAM_ID && raised < 3) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        raised += 1;
        const e = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'clipboardData', { value: { getData: () => 'x'.repeat(raised) } });
        document.body.dispatchEvent(e);
      }
      return ok === undefined ? fail('network', 0) : ok(token, batch);
    });
    const container = await render(view, fake);
    await click(await radio(container, 'a'));
    await click(await waitForButton(container, COPY.test.finishSection));
    finishing = true;
    await click(await waitForButton(container, COPY.test.finishConfirm));
    await textarea(container);
    await waitFor(() => raised === 3, 'three pastes');
    // Every paste is sent exactly once (none dropped with the old stream).
    const pastes = () => fake.sent().filter((e) => e.kind === 'signal' && e.sig === 'paste');
    await waitFor(() => pastes().length >= 3, 'every paste sent', 6_000);
    expect(pastes().map((e) => (e.kind === 'signal' && e.sig === 'paste' ? e.len : 0))).toEqual([
      1, 2, 3,
    ]);
    // The last one went out on the new stream, with the t of the moment it was raised: not before the old stream's
    // last event, and not reset to the new stream's start.
    const last = pastes()[2];
    expect(last?.streamId).toBe(STREAM_ID_2);
    const oldT = Math.max(
      ...fake
        .sent()
        .filter((e) => e.streamId === STREAM_ID)
        .map((e) => e.t),
    );
    expect(last?.t).toBeGreaterThanOrEqual(oldT);
    expect(fake.attach).toHaveBeenCalledTimes(1);
  });

  it('cancelling the finish confirm keeps the section open', async () => {
    const view = viewV2At(Date.now());
    const fake = fakeApi(view);
    const container = await render(view, fake);
    await radio(container, 'a');
    await click(await waitForButton(container, COPY.test.finishSection));
    await click(await waitForButton(container, COPY.test.finishCancel));
    await settle(2_200);
    expect(fake.sent().some((e) => e.kind === 'section.finish')).toBe(false);
    expect(fake.attach).not.toHaveBeenCalled();
  });

  it('v1 sessions render as D1: no section line, "Previous" everywhere, no afterSeq, no finish', async () => {
    const view = viewAt(Date.now());
    const fake = fakeApi(view);
    const container = await render(view, fake);
    await radio(container, 'a');
    await click(await waitForButton(container, COPY.test.next));
    await textarea(container);
    expect(buttonByText(container, COPY.test.previous)).toBeDefined();
    expect(buttonByText(container, COPY.test.finishSection)).toBeUndefined();
    expect(container.querySelector('[data-testid="section-timer"]')).toBeNull();
    expect(container.textContent).not.toContain(COPY.test.pasteBlocked);
    expect(container.textContent).not.toContain(COPY.test.forwardOnly);
    for (const call of fake.item.mock.calls) expect(call[2]).toBeUndefined();
    expect(fake.media).not.toHaveBeenCalled();
    // R5-68 a, i: one test-wide paste line from `pasteBlocked`, and a paste is prevented on the screen.
    expect(view.pasteBlocked).toBe(true);
    expect(container.textContent).toContain(COPY.test.pasteOffInTest);
    expect(COPY.test.pasteOffInTest).toBe(
      'Pasting text is turned off in this test. Paste attempts are recorded.',
    );
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => 'synthetic' } });
    (await textarea(container)).dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});
