// DC-D6 (local, Windows half): Chromium with the fake-camera flags and clipboard permissions, a real paste
// (isTrusted=true), a synthetic dispatchEvent (isTrusted=false) and video recording. Synthetic data only.
// Timings and facts are written to .out/d6-evidence-<project>.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { FAKE_MEDIA_ARGS, SITE_ORIGIN, SPIKE_DIR } from '../support/env.ts';
import { writeEvidence } from '../support/media.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const timings: Record<string, number> = {};
const evidence: Record<string, unknown> = {};

async function time<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    timings[name] = Math.round(performance.now() - t0);
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('@d6 Playwright on Windows 11 (local half)', () => {
  test.afterAll(() => {
    const pw = JSON.parse(
      fs.readFileSync(
        path.join(SPIKE_DIR, 'node_modules', '@playwright', 'test', 'package.json'),
        'utf8',
      ),
    ) as { version: string };
    writeEvidence(`d6-evidence-${test.info().project.name}.json`, {
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      node: process.version,
      playwright: pw.version,
      timingsMs: timings,
      ...evidence,
    });
  });

  test('launch with the fake-media flags: timings and browser version', async ({}, testInfo) => {
    const channel = testInfo.project.use.channel;
    const browser = await time('launch', () => chromium.launch({ args: FAKE_MEDIA_ARGS, channel }));
    evidence['browserVersion'] = browser.version();
    const context = await time('newContext', () =>
      browser.newContext({ permissions: ['camera', 'clipboard-read', 'clipboard-write'] }),
    );
    const page = await time('newPage', () => context.newPage());
    await time('goto', () => page.goto(`${SITE_ORIGIN}/d6`));
    evidence['userAgent'] = await page.evaluate(() => navigator.userAgent);
    evidence['secureContext'] = await page.evaluate(() => window.isSecureContext);
    await time('close', () => browser.close());
    expect(String(evidence['browserVersion'])).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(evidence['secureContext']).toBe(true);
  });

  test('getUserMedia returns a fake video track (and a fake audio track)', async ({ page }) => {
    await page.goto(`${SITE_ORIGIN}/d6`);
    const r = (await time('getUserMedia', () =>
      page.evaluate(async () => {
        const perm = await navigator.permissions.query({ name: 'camera' as PermissionName });
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const v = stream.getVideoTracks()[0] as MediaStreamTrack;
        const a = stream.getAudioTracks()[0] as MediaStreamTrack;
        const video = document.getElementById('v') as HTMLVideoElement;
        video.srcObject = stream;
        await video.play();
        await new Promise<void>((resolve) => {
          const t = setInterval(() => {
            if (video.videoWidth > 0) {
              clearInterval(t);
              resolve();
            }
          }, 25);
        });
        const c = document.getElementById('c') as HTMLCanvasElement;
        const ctx = c.getContext('2d') as CanvasRenderingContext2D;
        ctx.drawImage(video, 0, 0, 320, 240);
        const px = ctx.getImageData(0, 0, 320, 240).data;
        const colours = new Set<number>();
        for (let i = 0; i < px.length; i += 4 * 97) {
          colours.add(
            ((px[i] as number) << 16) | ((px[i + 1] as number) << 8) | (px[i + 2] as number),
          );
        }
        const devices = (await navigator.mediaDevices.enumerateDevices()).map((d) => ({
          kind: d.kind,
          label: d.label,
        }));
        const out = {
          permission: perm.state,
          video: {
            kind: v.kind,
            label: v.label,
            readyState: v.readyState,
            width: v.getSettings().width,
            height: v.getSettings().height,
            frameRate: v.getSettings().frameRate,
          },
          audio: { kind: a.kind, label: a.label, readyState: a.readyState },
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          distinctColours: colours.size,
          devices,
        };
        stream.getTracks().forEach((t) => t.stop());
        return out;
      }),
    )) as any;
    evidence['getUserMedia'] = r;
    expect(r.permission).toBe('granted');
    expect(r.video).toMatchObject({ kind: 'video', readyState: 'live' });
    expect(r.video.label).toMatch(/fake/i);
    expect(r.videoWidth).toBeGreaterThan(0);
    expect(r.distinctColours).toBeGreaterThan(3); // real frames are flowing, not a blank track
    expect(r.audio).toMatchObject({ kind: 'audio', readyState: 'live' });
    expect(r.devices.some((d: any) => d.kind === 'videoinput')).toBe(true);
  });

  test('a real Ctrl+V paste fires a paste event with isTrusted=true', async ({ page }) => {
    await page.goto(`${SITE_ORIGIN}/d6`);
    const text = 'synthetic paste text';
    await page.locator('#t').click();
    await time('clipboardWrite', () =>
      page.evaluate((t) => navigator.clipboard.writeText(t), text),
    );
    expect(
      await time('clipboardRead', () => page.evaluate(() => navigator.clipboard.readText())),
    ).toBe(text);
    await time('paste', async () => {
      await page.keyboard.press('ControlOrMeta+V'); // Control on Windows and Linux
      await expect(page.locator('#t')).toHaveValue(text);
    });
    const events = (await page.evaluate(() => (window as any).__events)) as any[];
    const paste = events.find((e) => e.type === 'paste');
    const input = events.find((e) => e.type === 'input');
    const keydown = events.find((e) => e.type === 'keydown' && String(e.key).toLowerCase() === 'v');
    evidence['realPaste'] = { paste, input, keydown };
    expect(paste).toMatchObject({ isTrusted: true, pasted: text });
    expect(input).toMatchObject({ isTrusted: true, inputType: 'insertFromPaste' });
    expect(keydown).toMatchObject({ isTrusted: true });
  });

  test('dispatchEvent gives isTrusted=false, while Playwright keyboard input stays trusted', async ({
    page,
  }) => {
    await page.goto(`${SITE_ORIGIN}/d6`);
    await page.locator('#t').click();
    await page.evaluate(() => {
      const t = document.getElementById('t') as HTMLInputElement;
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      t.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
      const dt = new DataTransfer();
      dt.setData('text/plain', 'forged');
      t.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
    });
    await page.locator('#t').dispatchEvent('keydown', { key: 'c' }); // Playwright's own dispatchEvent
    await page.keyboard.press('b'); // a real key through CDP Input.dispatchKeyEvent
    const events = (await page.evaluate(() => (window as any).__events)) as any[];
    const synthetic = events.filter((e) => e.key === 'a' || e.key === 'c' || e.pasted === 'forged');
    expect(synthetic.length).toBe(4);
    expect(synthetic.every((e) => e.isTrusted === false)).toBe(true);
    const real = events.filter((e) => e.key === 'b');
    expect(real.length).toBeGreaterThanOrEqual(2); // keydown and keyup
    expect(real.every((e) => e.isTrusted === true)).toBe(true);
    expect(await page.locator('#t').inputValue()).toBe('b'); // the forged paste inserted nothing
    evidence['dispatchEvent'] = { synthetic, real };
  });

  test('video: "on" records a non-empty WebM', async ({ page }) => {
    await page.goto(`${SITE_ORIGIN}/d6`);
    await page.locator('#t').click();
    await page.keyboard.type('recording check', { delay: 40 });
    await page.waitForTimeout(1200);
    const video = page.video();
    expect(video).not.toBeNull();
    await time('videoFinalise', () => page.close());
    const file = await (video as NonNullable<typeof video>).path();
    const size = fs.statSync(file).size;
    const head = fs.readFileSync(file).subarray(0, 4).toString('hex');
    evidence['video'] = { sizeBytes: size, webmMagic: head };
    expect(size).toBeGreaterThan(2000);
    expect(head).toBe('1a45dfa3'); // EBML header of a WebM/Matroska file
  });
});
