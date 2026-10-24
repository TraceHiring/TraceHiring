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
    // The rules step before start names no paste rule (each section shows its own, R5-66 c).
    const rules = COPY.rules.items.join(' ');
    expect(rules).not.toMatch(/Pasting and dropping text are blocked/);
    expect(rules).toMatch(/each section/i);
  });

  it('forward-only: the GET carries afterSeq; on 409 it flushes and retries, so the last edits are kept', async () => {
    const view = viewV2At(Date.now(), {
      sections: [writtenSection({ position: 1 })],
      served: [1],
    });
    const fake = fakeApi(view);
    const afterSeqs: (number | undefined)[] = [];
    fake.item.mockImplementation(async (_t, position, afterSeq) => {
      afterSeqs.push(afterSeq);
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
    expect(second?.[2]).toBeLessThanOrEqual(fake.state.hw);
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
  });
});
