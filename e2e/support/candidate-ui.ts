// The candidate UI as the E2E specs drive and watch it (extracted from tests/candidate-ui.spec.ts for the D1 slice,
// specs/d1-demo-slice.md §7.2). Two parts:
//  - instrumentation: a getUserMedia wrapper installed before any page script, and a network watcher that keeps what
//    the page sent and the edge acknowledged (requests, sockets, event batches, the consent response time, and the
//    session start and submit answers);
//  - `CandidateUi`: the screens a person walks through (link, code, age, notice and consent, photo, rules, test,
//    submit), with the selectors of apps/candidate.
// Tokens, links, codes and bodies stay in variables; nothing here prints one.
import { expect, type Page, type Request } from '@playwright/test';
import { sha256Hex } from './candidate.js';
import { sleep } from './http.js';
import type { OutboxReader } from './outbox.js';

export interface MediaRecord {
  calls: { at: number; constraints: unknown }[];
  tracks: { kind: string; readyState: string }[];
}
export interface Seen {
  method: string;
  origin: string;
  path: string;
  /** The whole URL, for a token check only (never printed). */
  url: string;
  contentType: string;
  body: Buffer | null;
}
export interface PhotoPut {
  body: Buffer;
  sha256Header: string;
  contentType: string;
  status: number;
  answer: unknown;
}
export interface AckedEvent {
  kind?: string;
  item?: number;
  option?: string | null;
  i?: string;
  /** The signal name of a `signal` event (§4.6). */
  sig?: string;
  len?: number;
}
/** What `POST /v1/session/start` answered (the token stays in memory, never printed). */
export interface StartAnswer {
  sessionToken: string;
  view: { sessionId: string; streamId: string; startedAt: string; deadlineAt: string };
}
export interface ReceiptAnswer {
  receiptRef: string;
  submittedAt: string;
}

/**
 * Wraps `navigator.mediaDevices.getUserMedia` before any page script runs, on every document: it records when it is
 * called (wall clock, comparable with Node's) and with which constraints, and keeps the tracks it returned.
 */
export const instrumentCamera = (page: Page) =>
  page.addInitScript(() => {
    const store = globalThis as unknown as {
      __e2eCamera?: { calls: { at: number; constraints: unknown }[]; tracks: MediaStreamTrack[] };
    };
    const record = {
      calls: [] as { at: number; constraints: unknown }[],
      tracks: [] as MediaStreamTrack[],
    };
    store.__e2eCamera = record;
    const devices = navigator.mediaDevices;
    if (typeof devices === 'undefined') return;
    const original = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      record.calls.push({
        at: Date.now(),
        constraints: JSON.parse(JSON.stringify(constraints ?? null)) as unknown,
      });
      const stream = await original(constraints);
      record.tracks.push(...stream.getTracks());
      return stream;
    };
  });

export const cameraRecord = (page: Page): Promise<MediaRecord> =>
  page.evaluate(() => {
    const store = globalThis as unknown as {
      __e2eCamera?: { calls: { at: number; constraints: unknown }[]; tracks: MediaStreamTrack[] };
    };
    const rec = store.__e2eCamera;
    return {
      calls: rec?.calls ?? [],
      tracks: (rec?.tracks ?? []).map((t) => ({ kind: t.kind, readyState: t.readyState })),
    };
  });

/** Everything the page sends and receives that the assertions need, collected from page events. */
export const watchNetwork = (page: Page) => {
  const seen: Seen[] = [];
  const sockets: string[] = [];
  const acked: AckedEvent[] = [];
  const state: {
    consentResponseAt: number | null;
    consentStatus: number | null;
    consentRequests: number;
    start: StartAnswer | null;
    receipt: ReceiptAnswer | null;
    submittedAt: number | null;
  } = {
    consentResponseAt: null,
    consentStatus: null,
    consentRequests: 0,
    start: null,
    receipt: null,
    submittedAt: null,
  };
  page.on('request', (req: Request) => {
    let url: URL;
    try {
      url = new URL(req.url());
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (req.method() === 'POST' && url.pathname === '/v1/lobby/consent') state.consentRequests += 1;
    seen.push({
      method: req.method(),
      origin: url.origin,
      path: url.pathname,
      url: req.url(),
      contentType: req.headers()['content-type'] ?? '',
      body: req.postDataBuffer(),
    });
  });
  page.on('websocket', (ws) => sockets.push(ws.url()));
  page.on('response', (res) => {
    const req = res.request();
    let path = '';
    try {
      path = new URL(res.url()).pathname;
    } catch {
      return;
    }
    if (req.method() !== 'POST') return;
    if (path === '/v1/lobby/consent') {
      state.consentResponseAt = Date.now();
      state.consentStatus = res.status();
    }
    if (path === '/v1/session/events' && res.status() === 200) {
      try {
        const sent = req.postDataJSON() as { events?: AckedEvent[] } | null;
        acked.push(...(sent?.events ?? []));
      } catch {
        // a body that is not JSON is not an event batch
      }
    }
    if (path === '/v1/session/start' && res.status() === 200) {
      void res
        .json()
        .then((body: unknown) => {
          const b = body as Partial<StartAnswer>;
          if (typeof b.sessionToken === 'string' && b.view !== undefined) {
            state.start = { sessionToken: b.sessionToken, view: b.view };
          }
        })
        .catch(() => undefined);
    }
    if (path === '/v1/session/submit' && res.status() === 200) {
      state.submittedAt = Date.now();
      void res
        .json()
        .then((body: unknown) => {
          state.receipt = body as ReceiptAnswer;
        })
        .catch(() => undefined);
    }
  });
  return { seen, sockets, acked, state };
};
export type NetworkWatch = ReturnType<typeof watchNetwork>;

export const waitUntil = async (what: string, timeoutMs: number, probe: () => boolean) => {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() >= deadline)
      throw new Error(`${what}: not within ${Math.round(timeoutMs / 1000)} s`);
    await sleep(200);
  }
};

export const isPhotoPut = (r: Request) =>
  r.method() === 'PUT' && new URL(r.url()).pathname === '/v1/lobby/photo';

/** `mm:ss` or `h:mm:ss` (the timer's text) in seconds. */
export const secondsOf = (text: string): number => {
  expect(text).toMatch(/^\d{1,2}(:\d{2}){1,2}$/);
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
};

/** The notice as the edge sent it (GET /v1/lobby/notice). */
export interface Notice {
  noticeVersionId: string;
  bodyText: string;
  renderedSha256: string;
}

/** Words that must never appear on a candidate's last screen (rules 1 and 5). */
export const OUTCOME_WORDS =
  /\b(scores?|bands?|clear|review|strong concern|integrity|quality|rank(ed|ing)?|rating|percent(age)?|pass(ed)?|fail(ed)?|shortlist(ed)?|rejected?|flags?|flagged)\b|%/i;

/** The screens of apps/candidate, driven the way a person does (labels from apps/candidate/src/copy.ts). */
export class CandidateUi {
  readonly page: Page;
  readonly net: NetworkWatch;
  private readonly origin: string;

  private constructor(page: Page, origin: string, net: NetworkWatch) {
    this.page = page;
    this.origin = origin;
    this.net = net;
  }

  /** Instruments the camera and the network of a fresh page; call before the first navigation. */
  static async on(page: Page, candidateOrigin: string): Promise<CandidateUi> {
    await instrumentCamera(page);
    return new CandidateUi(page, candidateOrigin, watchNetwork(page));
  }

  heading = (name: string) => this.page.getByRole('heading', { level: 1, name, exact: true });
  button = (name: string) => this.page.getByRole('button', { name, exact: true });
  question = (n: number, of: number) =>
    this.page.getByRole('heading', { level: 2, name: `Question ${n} of ${of}`, exact: true });
  option = (name: string) => this.page.getByRole('radio', { name, exact: true });

  /** Opens `/i#token`; the test is named and the fragment is gone from the address. */
  async openLink(token: string, testName: string): Promise<void> {
    await this.page.goto(`${this.origin}/i#${token}`);
    await expect(this.heading('Confirm it is you')).toBeVisible();
    await expect(this.page.getByText(testName)).toBeVisible();
    const href = await this.page.evaluate(() => location.href);
    // Booleans only: a failure must not print the link.
    expect(href.includes('#')).toBe(false);
    expect(href.includes(token)).toBe(false);
  }

  /** Asks for a code, reads it from the demo outbox, enters it; the age step follows. */
  async enterCode(outbox: OutboxReader, label: string): Promise<void> {
    await this.button('Email me a code').click();
    await expect(this.page.getByText(/We sent a 6-digit code to your email/)).toBeVisible();
    const otp = await outbox.nextOtp(label, new Set());
    await this.page.getByLabel('6-digit code').fill(otp.code);
    await this.button('Continue').click();
    await expect(this.heading('Your age')).toBeVisible();
  }

  /** "I am 18 or older": returns the notice the edge sent, after checking the screen shows exactly that text. */
  async declareAdult(): Promise<Notice> {
    const noticeResponse = this.page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/v1/lobby/notice' && r.request().method() === 'GET',
    );
    await this.button('I am 18 or older').click();
    await expect(this.heading('What we record and why')).toBeVisible();
    const res = await noticeResponse;
    expect(res.status()).toBe(200);
    const notice = (await res.json()) as Notice;
    expect(sha256Hex(notice.bodyText)).toBe(notice.renderedSha256);
    await expect(this.page.getByTestId('notice-text')).toBeVisible();
    expect(await this.page.getByTestId('notice-text').textContent()).toBe(notice.bodyText);
    expect((await cameraRecord(this.page)).calls).toHaveLength(0);
    return notice;
  }

  /** "I am under 18": the neutral blocked screen. */
  async declareMinor(): Promise<void> {
    await this.button('I am under 18').click();
    await expect(this.heading('You cannot take this test')).toBeVisible();
  }

  /** Agrees to the notice; the consent request names it; no camera call before its response. */
  async consent(notice: Notice): Promise<void> {
    const consentRequest = this.page.waitForRequest(
      (r) => new URL(r.url()).pathname === '/v1/lobby/consent' && r.method() === 'POST',
    );
    await this.page.getByLabel('I have read this notice and I agree').check();
    await this.button('Agree and continue').click();
    const sent = (await consentRequest).postDataJSON() as Record<string, unknown>;
    expect(sent).toEqual({
      noticeVersionId: notice.noticeVersionId,
      renderedSha256: notice.renderedSha256,
      accepted: true,
    });
    await expect(this.heading('Start photo')).toBeVisible();
    await waitUntil('the consent response', 10_000, () => this.net.state.consentStatus !== null);
    expect(this.net.state.consentStatus).toBe(200);
    expect((await cameraRecord(this.page)).calls).toHaveLength(0);
  }

  /** Camera on, photo, "Use this photo": the upload is accepted and every camera track is stopped. */
  async takePhoto(): Promise<PhotoPut> {
    await this.button('Turn on camera').click();
    await expect(this.button('Take photo')).toBeVisible();
    await this.button('Take photo').click();
    // Encoding runs on the CPU; a 2-vCPU CI runner took over 5 s, so allow 30 s.
    await expect(this.page.getByText('Photo taken. The camera is off.')).toBeVisible({
      timeout: 30_000,
    });
    const put = this.page.waitForRequest(isPhotoPut, { timeout: 30_000 });
    const response = this.page.waitForResponse((r) => isPhotoPut(r.request()), {
      timeout: 30_000,
    });
    void response.catch(() => undefined);
    await expect(this.button('Use this photo')).toBeEnabled({ timeout: 30_000 });
    await this.button('Use this photo').click();
    const request = await put;
    const res = await response;
    const body = request.postDataBuffer();
    if (body === null) throw new Error('the photo request has no body');
    const headers = await request.allHeaders();
    await expect(this.heading('Test rules')).toBeVisible();
    const media = await cameraRecord(this.page);
    expect(media.tracks.length).toBeGreaterThan(0);
    expect(media.tracks.every((t) => t.readyState === 'ended')).toBe(true);
    return {
      body,
      sha256Header: headers['x-photo-sha256'] ?? '',
      contentType: headers['content-type'] ?? '',
      status: res.status(),
      answer: await res.json(),
    };
  }

  /** Reads the rules and starts; the timer runs and question 1 is shown. Waits for the start answer. */
  async startTest(items: number): Promise<StartAnswer> {
    await this.page.getByLabel('I have read the rules').check();
    await this.button('Start test').click();
    await expect(this.page.getByTestId('timer')).toBeVisible();
    await expect(this.question(1, items)).toBeVisible();
    await waitUntil('the session start answer', 10_000, () => this.net.state.start !== null);
    const start = this.net.state.start;
    if (start === null) throw new Error('no session start answer');
    return start;
  }

  /** Picks one option per choice item (in order), then types the written answer on the last item. */
  async answer(choices: readonly string[], written: string, items: number): Promise<void> {
    for (const [k, label] of choices.entries()) {
      await expect(this.question(k + 1, items)).toBeVisible();
      await this.option(label).check();
      await expect(this.option(label)).toBeChecked();
      await this.button('Next question').click();
    }
    await expect(this.question(items, items)).toBeVisible();
    const box = this.page.getByLabel('Your answer');
    await box.fill(written);
    await expect(box).toHaveValue(written);
  }

  /** Waits until the edge acknowledged every choice (option ids) and the written text. */
  async waitAnswersAcked(optionIds: readonly string[], written: string, items: number) {
    await waitUntil('the answers acknowledged', 30_000, () => {
      const choicesAcked = optionIds.every((id, k) =>
        this.net.acked.some(
          (e) => e.kind === 'answer.choice' && e.item === k + 1 && e.option === id,
        ),
      );
      const textAcked = this.net.acked.some(
        (e) => e.kind === 'answer.text' && e.item === items && e.i === written,
      );
      return choicesAcked && textAcked;
    });
  }

  /** Waits until the edge acknowledged a signal of this kind. */
  async waitSignalAcked(sig: string): Promise<AckedEvent> {
    await waitUntil(`a ${sig} signal acknowledged`, 30_000, () =>
      this.net.acked.some((e) => e.kind === 'signal' && e.sig === sig),
    );
    const found = this.net.acked.find((e) => e.kind === 'signal' && e.sig === sig);
    if (found === undefined) throw new Error(`no ${sig} signal`);
    return found;
  }

  async timerSeconds(): Promise<number> {
    return secondsOf((await this.page.getByTestId('timer').textContent()) ?? '');
  }

  /** After a reload: the answers are back (walking the items) and the written text is restored. */
  async expectAnswersRestored(choices: readonly string[], written: string, items: number) {
    for (const [k, label] of choices.entries()) {
      await expect(this.question(k + 1, items)).toBeVisible();
      await expect(this.option(label)).toBeChecked();
      await this.button('Next question').click();
    }
    await expect(this.question(items, items)).toBeVisible();
    await expect(this.page.getByLabel('Your answer')).toHaveValue(written);
  }

  /** "Submit test", "Yes, submit now": the receipt, and no outcome words on the screen (rules 1 and 5). */
  async submit(): Promise<string> {
    await this.button('Submit test').click();
    await expect(
      this.page.getByRole('heading', { level: 2, name: 'Submit your test?' }),
    ).toBeVisible();
    await this.button('Yes, submit now').click();
    await expect(this.heading('Test submitted')).toBeVisible();
    const receipt = this.page.getByTestId('receipt-ref');
    await expect(receipt).toBeVisible();
    const ref = (await receipt.textContent()) ?? '';
    expect(ref).toMatch(/^TR-[0-9A-Z]{8}$/);
    expect(await visibleText(this.page)).not.toMatch(OUTCOME_WORDS);
    return ref;
  }
}

/** The page's visible text without the E2E caption banner (support/caption.ts). */
export const visibleText = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const banner = document.getElementById('e2e-caption');
    const before = banner?.style.display ?? '';
    if (banner) banner.style.display = 'none';
    const text = document.body.innerText;
    if (banner) banner.style.display = before;
    return text;
  });
