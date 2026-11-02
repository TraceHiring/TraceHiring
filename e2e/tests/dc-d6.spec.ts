// DC-D6 (specs/d1-demo-slice.md §8): Chromium with the fake-camera flags and clipboard
// permissions gives a live fake camera track, a real keyboard paste with isTrusted=true, a
// synthetic dispatchEvent with isTrusted=false, and a recorded video. The Windows half ran in the
// day-one spike (docs/spikes/d1-day-one, 6030a30); this spec is the same check on any platform,
// and the e2e-local CI job runs it on Linux. It runs on the candidate app's origin (a secure
// context, the one the start photo uses) and replaces the page body with a small test surface.
// Synthetic text only; the facts go to test-results/dc-d6.json. Skipped unless E2E_LOCAL=1
// (scripts/e2e-local.mjs sets it), so `pnpm verify` needs no browser.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const CANDIDATE_URL = process.env['E2E_CANDIDATE_URL'] ?? 'http://localhost:5173';
const PASTE_TEXT = 'synthetic paste text';

test.skip(process.env['E2E_LOCAL'] !== '1', 'set E2E_LOCAL=1 (scripts/e2e-local.mjs) to run');
test.describe.configure({ mode: 'serial' });
test.use({ permissions: ['camera', 'clipboard-read', 'clipboard-write'] });

interface Recorded {
  type: string;
  isTrusted: boolean;
  key?: string;
  inputType?: string;
  pasted?: string;
}

const evidence: Record<string, unknown> = {};

/** Opens the candidate origin and swaps the body for an input, a video and a canvas that log events. */
async function surface(page: Page): Promise<void> {
  await page.goto(CANDIDATE_URL);
  await page.evaluate(() => {
    document.body.innerHTML =
      '<input id="t" autocomplete="off"><video id="v" muted playsinline></video><canvas id="c" width="320" height="240"></canvas>';
    const log: Recorded[] = [];
    (window as unknown as { __events: Recorded[] }).__events = log;
    const t = document.getElementById('t') as HTMLInputElement;
    for (const type of ['keydown', 'keyup']) {
      t.addEventListener(type, (e) => {
        log.push({ type, isTrusted: e.isTrusted, key: (e as KeyboardEvent).key });
      });
    }
    t.addEventListener('paste', (e) => {
      const pasted = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
      log.push({ type: 'paste', isTrusted: e.isTrusted, pasted });
    });
    t.addEventListener('input', (e) => {
      log.push({ type: 'input', isTrusted: e.isTrusted, inputType: (e as InputEvent).inputType });
    });
  });
}

const events = (page: Page): Promise<Recorded[]> =>
  page.evaluate(() => (window as unknown as { __events: Recorded[] }).__events);

test.afterAll(({ browser }, testInfo) => {
  const file = path.join(testInfo.project.outputDir, 'dc-d6.json');
  const facts = {
    check: 'DC-D6',
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    browser: browser.version(),
    ...evidence,
  };
  writeFileSync(file, `${JSON.stringify(facts, null, 2)}\n`);
});

test('the candidate origin is a secure context', async ({ page }) => {
  await surface(page);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  evidence['userAgent'] = await page.evaluate(() => navigator.userAgent);
});

test('getUserMedia returns a live fake video track with moving frames', async ({ page }) => {
  await surface(page);
  const r = await page.evaluate(async () => {
    const perm = await navigator.permissions.query({ name: 'camera' as PermissionName });
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const track = stream.getVideoTracks()[0] as MediaStreamTrack;
    const video = document.getElementById('v') as HTMLVideoElement;
    video.srcObject = stream;
    await video.play();
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (video.videoWidth > 0) {
          clearInterval(timer);
          resolve();
        }
      }, 25);
    });
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(video, 0, 0, 320, 240);
    const px = ctx.getImageData(0, 0, 320, 240).data;
    const colours = new Set<number>();
    for (let i = 0; i < px.length; i += 4 * 97) {
      colours.add(((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0));
    }
    const out = {
      permission: perm.state,
      kind: track.kind,
      label: track.label,
      readyState: track.readyState,
      width: track.getSettings().width ?? 0,
      height: track.getSettings().height ?? 0,
      videoWidth: video.videoWidth,
      distinctColours: colours.size,
    };
    stream.getTracks().forEach((t) => t.stop());
    return out;
  });
  evidence['getUserMedia'] = r;
  expect(r.permission).toBe('granted');
  expect(r).toMatchObject({ kind: 'video', readyState: 'live' });
  expect(r.label).toMatch(/fake/i);
  expect(r.videoWidth).toBeGreaterThan(0);
  expect(r.distinctColours).toBeGreaterThan(3); // real frames, not a blank track
});

test('a real keyboard paste fires paste and input with isTrusted=true', async ({ page }) => {
  await surface(page);
  await page.locator('#t').click();
  await page.evaluate((text) => navigator.clipboard.writeText(text), PASTE_TEXT);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PASTE_TEXT);
  await page.keyboard.press('ControlOrMeta+V');
  await expect(page.locator('#t')).toHaveValue(PASTE_TEXT);
  const log = await events(page);
  const paste = log.find((e) => e.type === 'paste');
  const input = log.find((e) => e.type === 'input');
  evidence['realPaste'] = { paste, input };
  expect(paste).toMatchObject({ isTrusted: true, pasted: PASTE_TEXT });
  expect(input).toMatchObject({ isTrusted: true, inputType: 'insertFromPaste' });
});

test('dispatchEvent gives isTrusted=false; Playwright keyboard input stays trusted', async ({
  page,
}) => {
  await surface(page);
  await page.locator('#t').click();
  await page.evaluate(() => {
    const t = document.getElementById('t') as HTMLInputElement;
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    t.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    const dt = new DataTransfer();
    dt.setData('text/plain', 'forged');
    t.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
  });
  await page.locator('#t').dispatchEvent('keydown', { key: 'c' });
  await page.keyboard.press('b');
  const log = await events(page);
  const synthetic = log.filter((e) => e.key === 'a' || e.key === 'c' || e.pasted === 'forged');
  const real = log.filter((e) => e.key === 'b');
  evidence['dispatchEvent'] = { synthetic, real };
  expect(synthetic).toHaveLength(4);
  expect(synthetic.every((e) => !e.isTrusted)).toBe(true);
  expect(real.length).toBeGreaterThanOrEqual(2);
  expect(real.every((e) => e.isTrusted)).toBe(true);
  expect(await page.locator('#t').inputValue()).toBe('b'); // the forged paste inserted nothing
});

test('video: "on" records a non-empty WebM', async ({ page }) => {
  await surface(page);
  await page.locator('#t').click();
  await page.keyboard.type('recording check', { delay: 40 });
  await page.waitForTimeout(1200);
  const video = page.video();
  expect(video).not.toBeNull();
  await page.close();
  const file = await (video as NonNullable<typeof video>).path();
  const size = statSync(file).size;
  const head = readFileSync(file).subarray(0, 4).toString('hex');
  evidence['video'] = { sizeBytes: size, webmMagic: head };
  expect(size).toBeGreaterThan(2000);
  expect(head).toBe('1a45dfa3'); // EBML header of a WebM file
});
