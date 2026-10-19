// The real candidate UI in Chromium against the local stack (specs/d1-demo-slice.md §4.1 step order, §4.5 start
// photo, §4.7 candidate app, §7.2 E2E steps 5, 6 and 10; rules 5, 8 and 9 of CLAUDE.md). The recruiter side is set up
// at the API level (support/recruiter.ts), then ONE candidate page walks the screens a person sees: link, code,
// age, notice and consent, camera and start photo, rules, the test (with a reload in the middle), submit, receipt.
//
// What it checks on the way (all from the browser's side):
//  - the link fragment is gone from `location.href` once the app has loaded;
//  - `getUserMedia` is called exactly once, with `audio: false`, only after the consent response has arrived, and
//    every video track it returned is stopped after "Use this photo";
//  - the start photo request is a JPEG without APP1-APP15/COM segments, `X-Photo-Sha256` is the hash of the body,
//    and the edge answers 200 (spec rev 4i);
//  - the notice on screen is the notice body the edge sent (and the consent request names that notice);
//  - a reload mid-test restores the answers and shows no more time than before;
//  - the end screen is the receipt only (no score or band words);
//  - network: every request goes to the candidate origin or the edge origin, the candidate origin only serves GETs,
//    the only binary upload is the start photo (rule 8).
//
// Skipped unless E2E_LOCAL=1 (scripts/e2e-local.mjs sets the stack up and the environment). Synthetic data only.
// Nothing is printed that could hold a link, token, code or body: assertions that touch those compare booleans.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page, type Request } from '@playwright/test';
import { amrOf, claimsOf, signInWithTotp } from '../support/auth.js';
import { sha256Hex } from '../support/candidate.js';
import { env, sleep } from '../support/http.js';
import { headerMarkers, isMetadataMarker } from '../support/jpeg.js';
import { outboxReader } from '../support/outbox.js';
import {
  createPublishedTest,
  inviteCandidate,
  MCQ_OPTIONS,
  WRITTEN_ANCHORS,
  type Invitation,
  type PublishedTest,
  type RecruiterCtx,
} from '../support/recruiter.js';

test.skip(process.env['E2E_LOCAL'] !== '1', 'set E2E_LOCAL=1 (scripts/e2e-local.mjs) to run');
test.describe.configure({ mode: 'serial' });

const API = process.env['E2E_API_URL'] ?? 'http://127.0.0.1:8788';
const EDGE = process.env['E2E_EDGE_URL'] ?? 'http://127.0.0.1:8787';
const CANDIDATE = process.env['E2E_CANDIDATE_URL'] ?? 'http://localhost:5173';
const RUN = randomBytes(4).toString('hex');
const STEP_MS = 30_000;

const CANDIDATE_ORIGIN = new URL(CANDIDATE).origin;
const EDGE_ORIGIN = new URL(EDGE).origin;

/** The answers the candidate gives: option ids a, b, c for the three MCQ items, then a written answer. */
const CHOICES = [0, 1, 2] as const;
const WRITTEN = `Put each job on a ${WRITTEN_ANCHORS[0]}, ${WRITTEN_ANCHORS[1]} on failure, and keep every step ${WRITTEN_ANCHORS[2]} with a stable key.`;
const ITEMS = CHOICES.length + 1;

/** What the serial tests hand each other (one worker, one file). */
const setup: {
  ctx?: RecruiterCtx;
  published?: PublishedTest;
  invitation?: Invitation;
} = {};

// ---- What the browser records -----------------------------------------------------------------------------------

interface MediaRecord {
  calls: { at: number; constraints: unknown }[];
  tracks: { kind: string; readyState: string }[];
}
interface Seen {
  method: string;
  origin: string;
  path: string;
  /** The whole URL, for a token check only (never printed). */
  url: string;
  contentType: string;
  body: Buffer | null;
}
interface PhotoPut {
  body: Buffer;
  sha256Header: string;
  contentType: string;
  status: number;
  answer: unknown;
}
interface AckedEvent {
  kind?: string;
  item?: number;
  option?: string | null;
  i?: string;
}

/**
 * Wraps `navigator.mediaDevices.getUserMedia` before any page script runs, on every document: it records when it is
 * called (wall clock, comparable with Node's) and with which constraints, and keeps the tracks it returned.
 */
const instrumentCamera = (page: Page) =>
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

const cameraRecord = (page: Page): Promise<MediaRecord> =>
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
const watchNetwork = (page: Page) => {
  const seen: Seen[] = [];
  const sockets: string[] = [];
  const acked: AckedEvent[] = [];
  const state: { consentResponseAt: number | null; consentStatus: number | null } = {
    consentResponseAt: null,
    consentStatus: null,
  };
  page.on('request', (req: Request) => {
    let url: URL;
    try {
      url = new URL(req.url());
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
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
  });
  return { seen, sockets, acked, state };
};

const waitUntil = async (what: string, timeoutMs: number, probe: () => boolean) => {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() >= deadline)
      throw new Error(`${what}: not within ${Math.round(timeoutMs / 1000)} s`);
    await sleep(200);
  }
};

const isPhotoPut = (r: Request) =>
  r.method() === 'PUT' && new URL(r.url()).pathname === '/v1/lobby/photo';

/** `mm:ss` or `h:mm:ss` (the timer's text) in seconds. */
const secondsOf = (text: string): number => {
  expect(text).toMatch(/^\d{1,2}(:\d{2}){1,2}$/);
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
};

// ---- The spec ---------------------------------------------------------------------------------------------------

test.describe('the candidate UI against the local stack (spec §4.1, §4.5, §4.7, §7.2 steps 5, 6, 10)', () => {
  test('a recruiter publishes a test and invites one 18+ candidate', async ({ request }) => {
    test.setTimeout(180_000);
    const orgId = env('E2E_ORG_ID');

    await test.step(
      'the recruiter signs in with password and TOTP (aal2)',
      async () => {
        const jwt = await signInWithTotp(request, {
          supabaseUrl: env('E2E_SUPABASE_URL'),
          publishableKey: env('E2E_SUPABASE_PUBLISHABLE_KEY'),
          email: env('E2E_UI_RECRUITER_EMAIL'),
          password: env('E2E_USER_PASSWORD'),
        });
        const claims = claimsOf(jwt);
        expect(claims.aal).toBe('aal2');
        expect(amrOf(claims)).toEqual(['password', 'totp']);
        setup.ctx = { api: API, orgId, jwt };
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'creates and publishes a test: 3 MCQ items and 1 written item',
      async () => {
        if (setup.ctx === undefined) throw new Error('no recruiter session');
        setup.published = await createPublishedTest(request, setup.ctx, `E2E candidate UI ${RUN}`);
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'invites one candidate (18+ yes)',
      async () => {
        if (setup.ctx === undefined || setup.published === undefined) throw new Error('no test');
        const invitation = await inviteCandidate(
          request,
          setup.ctx,
          setup.published.testId,
          `e2e-ui-a-${RUN}@example.test`,
        );
        expect(invitation.status).toBe('sent');
        expect(invitation.token).not.toBeNull();
        setup.invitation = invitation;
      },
      { timeout: STEP_MS },
    );
  });

  test('the candidate: link, code, age, consent, photo, rules, test, reload, submit, receipt', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const { ctx, published, invitation } = setup;
    if (ctx === undefined || published === undefined || invitation === undefined) {
      throw new Error('the recruiter setup did not run');
    }
    const token = invitation.token;
    if (token === null) throw new Error('the invitation has no link');
    const outbox = outboxReader(request, { api: API, orgId: ctx.orgId, jwt: ctx.jwt });

    await instrumentCamera(page);
    const net = watchNetwork(page);
    const heading = (name: string) => page.getByRole('heading', { level: 1, name, exact: true });
    const button = (name: string) => page.getByRole('button', { name, exact: true });

    await test.step(
      'opens the link: the test is named and the fragment is gone from the address',
      async () => {
        await page.goto(`${CANDIDATE}/i#${token}`);
        await expect(heading('Confirm it is you')).toBeVisible();
        await expect(page.getByText(published.name)).toBeVisible();
        const href = await page.evaluate(() => location.href);
        // Booleans only: a failure must not print the link.
        expect(href.includes('#')).toBe(false);
        expect(href.includes(token)).toBe(false);
        expect(await page.evaluate(() => location.hash)).toBe('');
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'asks for a code, reads it from the demo outbox, enters it',
      async () => {
        await button('Email me a code').click();
        await expect(page.getByText(/We sent a 6-digit code to your email/)).toBeVisible();
        const otp = await outbox.nextOtp(invitation.label, new Set());
        await page.getByLabel('6-digit code').fill(otp.code);
        await button('Continue').click();
        await expect(heading('Your age')).toBeVisible();
      },
      { timeout: STEP_MS },
    );

    let notice: { noticeVersionId: string; bodyText: string; renderedSha256: string } | undefined;
    await test.step(
      'age: "I am 18 or older"; the notice on screen is the one the edge sent',
      async () => {
        const noticeResponse = page.waitForResponse(
          (r) => new URL(r.url()).pathname === '/v1/lobby/notice' && r.request().method() === 'GET',
        );
        await button('I am 18 or older').click();
        await expect(heading('What we record and why')).toBeVisible();
        const res = await noticeResponse;
        expect(res.status()).toBe(200);
        notice = (await res.json()) as typeof notice;
        if (notice === undefined) throw new Error('no notice body');
        expect(sha256Hex(notice.bodyText)).toBe(notice.renderedSha256);
        // The text node as rendered, byte for byte.
        await expect(page.getByTestId('notice-text')).toBeVisible();
        expect(await page.getByTestId('notice-text').textContent()).toBe(notice.bodyText);
        expect((await cameraRecord(page)).calls).toHaveLength(0);
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'consent: the request names that notice; no camera call before its response',
      async () => {
        if (notice === undefined) throw new Error('no notice');
        const consentRequest = page.waitForRequest(
          (r) => new URL(r.url()).pathname === '/v1/lobby/consent' && r.method() === 'POST',
        );
        await page.getByLabel('I have read this notice and I agree').check();
        await button('Agree and continue').click();
        const sent = (await consentRequest).postDataJSON() as Record<string, unknown>;
        expect(sent).toEqual({
          noticeVersionId: notice.noticeVersionId,
          renderedSha256: notice.renderedSha256,
          accepted: true,
        });
        await expect(heading('Start photo')).toBeVisible();
        await waitUntil('the consent response', 5_000, () => net.state.consentStatus !== null);
        expect(net.state.consentStatus).toBe(200);
        expect(net.state.consentResponseAt).not.toBeNull();
        // The photo step is on screen and the camera has still not been asked for.
        expect((await cameraRecord(page)).calls).toHaveLength(0);
      },
      { timeout: STEP_MS },
    );

    let media: MediaRecord | undefined;
    let photo: PhotoPut | undefined;
    await test.step(
      'photo: turn on the camera, take the photo, use it; the camera goes off',
      async () => {
        await button('Turn on camera').click();
        await expect(button('Take photo')).toBeVisible();
        await button('Take photo').click();
        await expect(page.getByText('Photo taken. The camera is off.')).toBeVisible();
        const afterShot = await cameraRecord(page);
        expect(afterShot.tracks.length).toBeGreaterThan(0);
        expect(afterShot.tracks.every((t) => t.readyState === 'ended')).toBe(true);

        // The photo is encoded asynchronously after the shot; "Use this photo" is disabled until the JPEG is ready.
        const put = page.waitForRequest(isPhotoPut, { timeout: 20_000 });
        const response = page.waitForResponse((r) => isPhotoPut(r.request()), { timeout: 20_000 });
        void response.catch(() => undefined);
        await expect(button('Use this photo')).toBeEnabled();
        await button('Use this photo').click();
        const request_ = await put;
        const res = await response;
        const body = request_.postDataBuffer();
        if (body === null) throw new Error('the photo request has no body');
        const headers = await request_.allHeaders();
        photo = {
          body,
          sha256Header: headers['x-photo-sha256'] ?? '',
          contentType: headers['content-type'] ?? '',
          status: res.status(),
          answer: await res.json(),
        };
        await expect(heading('Test rules')).toBeVisible();

        media = await cameraRecord(page);
      },
      { timeout: 60_000 },
    );

    await test.step(
      'the start photo request: a JPEG with no metadata segment, its hash header, HTTP 200',
      async () => {
        if (photo === undefined) throw new Error('no photo request');
        const { body } = photo;
        expect(photo.contentType).toBe('image/jpeg');
        expect([...body.subarray(0, 2)]).toEqual([0xff, 0xd8]);
        expect([...body.subarray(-2)]).toEqual([0xff, 0xd9]);
        const markers = headerMarkers(body);
        // Rev 4i: APP1-APP15 and COM are dropped on the device before the hash and the upload.
        expect(markers.filter(isMetadataMarker)).toEqual([]);
        expect(markers).toContain(0xe0);
        expect(photo.sha256Header).toBe(sha256Hex(body));
        expect(photo.status).toBe(200);
        expect(photo.answer).toEqual({ sha256: sha256Hex(body), bytes: body.length });
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'the camera was asked for once, video only, after the consent response, and every track is stopped',
      () => {
        if (media === undefined) throw new Error('no camera record');
        expect(media.calls).toHaveLength(1);
        const call = media.calls[0];
        const constraints = call?.constraints as { audio?: unknown; video?: unknown } | null;
        expect(constraints?.audio).toBe(false);
        expect(constraints?.video).toBeTruthy();
        expect(net.state.consentResponseAt).not.toBeNull();
        expect((call?.at ?? 0) >= (net.state.consentResponseAt ?? Infinity)).toBe(true);
        expect(media.tracks.length).toBeGreaterThan(0);
        expect(media.tracks.every((t) => t.kind === 'video')).toBe(true);
        expect(media.tracks.every((t) => t.readyState === 'ended')).toBe(true);
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'rules: read, then Start test (a fullscreen refusal is tolerated); the timer runs',
      async () => {
        await page.getByLabel('I have read the rules').check();
        await button('Start test').click();
        await expect(page.getByTestId('timer')).toBeVisible();
        await expect(
          page.getByRole('heading', { level: 2, name: `Question 1 of ${ITEMS}` }),
        ).toBeVisible();
      },
      { timeout: STEP_MS },
    );

    const questionHeading = (n: number) =>
      page.getByRole('heading', { level: 2, name: `Question ${n} of ${ITEMS}`, exact: true });
    const option = (name: string) => page.getByRole('radio', { name, exact: true });

    await test.step(
      'answers the three choice items and types the written answer',
      async () => {
        for (const [k, choice] of CHOICES.entries()) {
          await expect(questionHeading(k + 1)).toBeVisible();
          const label = MCQ_OPTIONS[choice];
          if (label === undefined) throw new Error('no such option');
          await option(label).check();
          await expect(option(label)).toBeChecked();
          await button('Next question').click();
        }
        await expect(questionHeading(ITEMS)).toBeVisible();
        const box = page.getByLabel('Your answer');
        await box.fill(WRITTEN);
        await expect(box).toHaveValue(WRITTEN);
      },
      { timeout: STEP_MS },
    );

    let secondsBefore = 0;
    await test.step(
      'every answer is acknowledged by the edge, then the page is reloaded mid-test',
      async () => {
        // The app batches events every two seconds and does not flush on unload: wait for the acks.
        await waitUntil('the answers acknowledged', 20_000, () => {
          const choicesAcked = CHOICES.every((choice, k) =>
            net.acked.some(
              (e) =>
                e.kind === 'answer.choice' &&
                e.item === k + 1 &&
                e.option === ['a', 'b', 'c'][choice],
            ),
          );
          const textAcked = net.acked.some(
            (e) => e.kind === 'answer.text' && e.item === ITEMS && e.i === WRITTEN,
          );
          return choicesAcked && textAcked;
        });
        secondsBefore = secondsOf((await page.getByTestId('timer').textContent()) ?? '');
        await page.reload();
        await expect(page.getByTestId('timer')).toBeVisible();
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'after the reload the answers are back and the timer shows no more time than before',
      async () => {
        const secondsAfter = secondsOf((await page.getByTestId('timer').textContent()) ?? '');
        expect(secondsAfter).toBeLessThanOrEqual(secondsBefore);
        // The link is gone and no camera was asked for on the new document.
        expect(await page.evaluate(() => location.hash)).toBe('');
        expect((await cameraRecord(page)).calls).toHaveLength(0);
        for (const [k, choice] of CHOICES.entries()) {
          await expect(questionHeading(k + 1)).toBeVisible();
          const label = MCQ_OPTIONS[choice];
          if (label === undefined) throw new Error('no such option');
          await expect(option(label)).toBeChecked();
          await button('Next question').click();
        }
        await expect(questionHeading(ITEMS)).toBeVisible();
        await expect(page.getByLabel('Your answer')).toHaveValue(WRITTEN);
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'submits: "Submit test", "Yes, submit now"; the page shows the receipt and nothing else',
      async () => {
        await button('Submit test').click();
        await expect(
          page.getByRole('heading', { level: 2, name: 'Submit your test?' }),
        ).toBeVisible();
        await button('Yes, submit now').click();
        await expect(heading('Test submitted')).toBeVisible();
        const receipt = page.getByTestId('receipt-ref');
        await expect(receipt).toBeVisible();
        expect(await receipt.textContent()).toMatch(/^TR-[0-9A-Z]{8}$/);
        // Rules 1 and 5: no score, no band, no outcome words on the candidate's last screen.
        const text = await page.locator('body').innerText();
        expect(text).not.toMatch(
          /\b(scores?|bands?|clear|review|strong concern|integrity|quality|rank(ed|ing)?|rating|percent(age)?|pass(ed)?|fail(ed)?|shortlist(ed)?|rejected?|flags?|flagged)\b|%/i,
        );
        expect(net.seen.some((s) => s.method === 'POST' && s.path === '/v1/session/submit')).toBe(
          true,
        );
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'network (spec §7.2 step 10, rule 8): candidate and edge origins only, one binary upload, no link in a URL',
      () => {
        const allowed = new Set([CANDIDATE_ORIGIN, EDGE_ORIGIN]);
        expect([...new Set(net.seen.map((s) => s.origin))].filter((o) => !allowed.has(o))).toEqual(
          [],
        );
        expect(
          net.sockets.filter((u) => !allowed.has(new URL(u).origin.replace(/^ws/, 'http'))),
        ).toEqual([]);
        // The candidate origin is the static app: reads only.
        expect(
          net.seen
            .filter((s) => s.origin === CANDIDATE_ORIGIN && s.method !== 'GET')
            .map((s) => s.method),
        ).toEqual([]);
        // Everything the page sends with a body is JSON, except the one start photo.
        const withBody = net.seen.filter((s) => s.body !== null && s.body.length > 0);
        const notJson = withBody.filter((s) => !s.contentType.startsWith('application/json'));
        expect(notJson.map((s) => `${s.method} ${s.origin} ${s.path} ${s.contentType}`)).toEqual([
          `PUT ${EDGE_ORIGIN} /v1/lobby/photo image/jpeg`,
        ]);
        // The link token never travels in a URL.
        expect(net.seen.some((s) => s.url.includes(token))).toBe(false);
        // The camera: one call over the whole walk (the reload added none).
        expect(media?.calls).toHaveLength(1);
      },
      { timeout: STEP_MS },
    );
  });
});
