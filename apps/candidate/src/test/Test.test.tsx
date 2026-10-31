// @vitest-environment happy-dom
// The test screen's endings (specs/d1-demo-slice.md §4.7, RT-1, RT-3, RT-5; review findings SR-2, SR-3, SR-5, SR-8):
// manual submit, the timer at zero (flush, then submit with finalSeq = the acknowledged seq), a deadline already past
// at mount, a 410 on events (attach reads the receipt), a 410 on an item while the session still runs (submit, not
// attach, which would supersede the stream), 401 superseded, a manual submit while offline, and the 5 s auto retry.
import type {
  EventBatchReq,
  Receipt,
  SessionView,
  SubmitReq,
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
  waitFor,
  waitForButton,
  type Mounted,
} from '../dom.test-helpers';
import {
  MCQ_ITEM,
  RECEIPT,
  SESSION_TOKEN,
  STREAM_ID,
  viewAt,
  WRITTEN_ITEM,
} from '../fixtures.test-helpers';
import { Test, type TestEnd } from './Test';

type Fn<K extends keyof CandidateApi> = ReturnType<typeof vi.fn<CandidateApi[K]>>;

interface FakeApi {
  api: CandidateApi;
  item: Fn<'item'>;
  events: Fn<'events'>;
  submit: Fn<'submit'>;
  attach: Fn<'attach'>;
  /** Wall times of the submit calls. */
  submitTimes: number[];
}

const fail = (code: string, status: number): ApiResult<never> =>
  ({ ok: false, code, status }) as ApiResult<never>;

const fakeApi = (view: SessionView): FakeApi => {
  const submitTimes: number[] = [];
  const item = vi.fn<CandidateApi['item']>(async (_t, position) => ({
    ok: true,
    value: position === 1 ? MCQ_ITEM : WRITTEN_ITEM,
  }));
  const events = vi.fn<CandidateApi['events']>(async (_t, batch: EventBatchReq) => ({
    ok: true,
    value: {
      ackSeq: batch.events.at(-1)?.seq ?? 0,
      serverNow: new Date().toISOString(),
      deadlineAt: view.deadlineAt,
      state: 'in_progress',
    },
  }));
  const submit = vi.fn<CandidateApi['submit']>(async () => {
    submitTimes.push(Date.now());
    return { ok: true, value: RECEIPT };
  });
  const attach = vi.fn<CandidateApi['attach']>(async () => ({
    ok: true,
    value: { view: viewAt(Date.now(), { receipt: RECEIPT }) },
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
    media: unused,
  };
  return { api, item, events, submit, attach, submitTimes };
};

let app: Mounted | undefined;
let receipts: Receipt[];
let ends: TestEnd[];

const render = async (view: SessionView, fake: FakeApi) => {
  app = await mount(
    <Test
      api={fake.api}
      sessionToken={SESSION_TOKEN}
      view={view}
      offsetMs={0}
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

describe('Test screen endings', { timeout: 20_000 }, () => {
  it('manual submit: flushes, submits, shows the receipt', async () => {
    const view = viewAt(Date.now());
    const fake = fakeApi(view);
    const container = await render(view, fake);
    await click(await radio(container, 'b'));
    await click(buttonByText(container, COPY.test.submit) as HTMLButtonElement);
    await click(await waitForButton(container, COPY.test.confirm));
    await waitFor(() => receipts.length === 1, 'receipt');
    expect(receipts).toEqual([RECEIPT]);
    const sent = fake.events.mock.calls.flatMap(([, b]) => b.events);
    expect(sent).toContainEqual(expect.objectContaining({ kind: 'answer.choice', option: 'b' }));
    const request: SubmitReq | undefined = fake.submit.mock.calls[0]?.[1];
    expect(request).toEqual({ streamId: STREAM_ID, finalSeq: sent.at(-1)?.seq });
  });

  it('at zero: flushes, then submits with finalSeq = the acknowledged seq, and shows the receipt', async () => {
    const now = Date.now();
    const view = viewAt(now, { startedAgoMs: 30 * 60_000 - 1_500 });
    const fake = fakeApi(view);
    const container = await render(view, fake);
    await click(await radio(container, 'a'));
    await waitFor(() => receipts.length === 1, 'receipt', 6_000);
    const sent = fake.events.mock.calls.flatMap(([, b]) => b.events);
    const choice = sent.findIndex((e) => e.kind === 'answer.choice');
    expect(choice).toBeGreaterThanOrEqual(0);
    expect(fake.submit).toHaveBeenCalledTimes(1);
    expect(fake.submit.mock.calls[0]?.[1]).toEqual({
      streamId: STREAM_ID,
      finalSeq: sent.at(-1)?.seq,
    });
    // The submit came after the last batch was acknowledged.
    const lastEvents = fake.events.mock.invocationCallOrder.at(-1) ?? 0;
    expect(fake.submit.mock.invocationCallOrder[0]).toBeGreaterThan(lastEvents);
  });

  it('SR-2: a deadline already past at mount submits and shows the receipt', async () => {
    const view = viewAt(Date.now(), { startedAgoMs: 30 * 60_000 + 10_000 });
    const fake = fakeApi(view);
    await render(view, fake);
    await waitFor(() => receipts.length === 1, 'receipt');
    expect(fake.submit).toHaveBeenCalledTimes(1);
    expect(fake.attach).not.toHaveBeenCalled();
  });

  it('SR-3: an item 410 while the session still runs submits (never attach, which would supersede)', async () => {
    const view = viewAt(Date.now());
    const fake = fakeApi(view);
    fake.item.mockImplementation(async () => fail('closed', 410));
    await render(view, fake);
    await waitFor(() => receipts.length === 1, 'receipt');
    expect(fake.submit).toHaveBeenCalledTimes(1);
    expect(fake.attach).not.toHaveBeenCalled();
  });

  it('events 410: attach reads the receipt', async () => {
    const view = viewAt(Date.now());
    const fake = fakeApi(view);
    fake.events.mockImplementation(async () => fail('closed', 410));
    const container = await render(view, fake);
    await click(await radio(container, 'a'));
    await waitFor(() => receipts.length === 1, 'receipt', 6_000);
    expect(fake.attach).toHaveBeenCalledTimes(1);
    expect(fake.attach.mock.invocationCallOrder[0]).toBeGreaterThan(
      fake.events.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('401 superseded on events ends the screen as "superseded" (open in another window)', async () => {
    const view = viewAt(Date.now());
    const fake = fakeApi(view);
    fake.events.mockImplementation(async () => fail('superseded', 401));
    const container = await render(view, fake);
    await click(await radio(container, 'a'));
    await waitFor(() => ends.length === 1, 'end', 6_000);
    expect(ends).toEqual(['superseded']);
    expect(fake.submit).not.toHaveBeenCalled();
  });

  it('a manual submit while offline shows the error and unlocks the answers', async () => {
    const view = viewAt(Date.now());
    const fake = fakeApi(view);
    fake.submit.mockImplementation(async () => fail('network', 0));
    const container = await render(view, fake);
    await radio(container, 'a');
    await click(buttonByText(container, COPY.test.submit) as HTMLButtonElement);
    await click(await waitForButton(container, COPY.test.confirm));
    await waitFor(() => container.querySelector('[role="alert"]'), 'error');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      COPY.test.submitOffline,
    );
    expect((await radio(container, 'a')).closest('fieldset')?.disabled).toBe(false);
    expect(buttonByText(container, COPY.test.submit)?.disabled).toBe(false);
    expect(receipts).toEqual([]);
  });

  it('the auto-submit retries every 5 s until it goes through', async () => {
    const view = viewAt(Date.now(), { startedAgoMs: 30 * 60_000 + 5_000 });
    const fake = fakeApi(view);
    fake.submit
      .mockImplementationOnce(async () => {
        fake.submitTimes.push(Date.now());
        return fail('network', 0);
      })
      .mockImplementationOnce(async () => {
        fake.submitTimes.push(Date.now());
        return { ok: true, value: RECEIPT };
      });
    await render(view, fake);
    await waitFor(() => receipts.length === 1, 'receipt', 9_000);
    expect(fake.submitTimes).toHaveLength(2);
    expect((fake.submitTimes[1] ?? 0) - (fake.submitTimes[0] ?? 0)).toBeGreaterThanOrEqual(4_900);
  });

  it('SR-8: a manual submit that fails offline after time is up keeps the answers locked and retries', async () => {
    const now = Date.now();
    const view = viewAt(now, { startedAgoMs: 30 * 60_000 - 1_000 });
    const fake = fakeApi(view);
    const held = deferred<ApiResult<Receipt>>();
    fake.submit
      .mockImplementationOnce(() => {
        fake.submitTimes.push(Date.now());
        return held.promise;
      })
      .mockImplementationOnce(async () => {
        fake.submitTimes.push(Date.now());
        return { ok: true, value: RECEIPT };
      });
    const container = await render(view, fake);
    await radio(container, 'a');
    await click(buttonByText(container, COPY.test.submit) as HTMLButtonElement);
    await click(await waitForButton(container, COPY.test.confirm));
    await waitFor(() => fake.submit.mock.calls.length === 1, 'first submit');
    // Time runs out while the manual submit is in flight; then it fails offline.
    await settle(1_500);
    held.resolve(fail('network', 0) as ApiResult<Receipt>);
    await settle(50);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect((await radio(container, 'a')).closest('fieldset')?.disabled).toBe(true);
    expect(container.textContent).toContain(COPY.test.timeUp);
    await waitFor(() => receipts.length === 1, 'receipt', 9_000);
    expect(fake.submit).toHaveBeenCalledTimes(2);
  });
});
