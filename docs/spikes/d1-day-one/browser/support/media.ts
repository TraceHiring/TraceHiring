// Node-side helpers for the browser specs: talk to the spike Worker's /_spike/* routes (spike-only, see the Worker).
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { OUT_DIR, WORKER_ORIGIN } from './env.ts';

export const ORG = 'org-synthetic-1';
export const START_PHOTO_KEY = `media/${ORG}/sess-1/start_photo.jpg`;

export async function issueLink(over: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch(`${WORKER_ORIGIN}/_spike/issue`, {
    method: 'POST',
    body: JSON.stringify({
      mediaId: '00000000-0000-4000-8000-000000000001',
      orgId: ORG,
      viewerUserId: '00000000-0000-4000-8000-0000000000aa',
      aal: 'aal2',
      amr: ['totp'],
      r2Key: START_PHOTO_KEY,
      ...over,
    }),
  });
  if (!res.ok) throw new Error(`issue failed: ${res.status}`);
  return ((await res.json()) as { url: string }).url;
}

export async function setConfig(cfg: { allowedOrigins?: string[] | null; corp?: string | null }) {
  const res = await fetch(`${WORKER_ORIGIN}/_spike/config`, {
    method: 'POST',
    body: JSON.stringify(cfg),
  });
  if (!res.ok) throw new Error(`config failed: ${res.status}`);
}

export interface SeenRequest {
  method: string;
  status: number;
  origin: string | null;
  hasReferer: boolean;
  hasAuthorization: boolean;
  hasCookie: boolean;
  secFetchSite: string | null;
  secFetchMode: string | null;
  secFetchDest: string | null;
}

export async function stats(reset = false): Promise<SeenRequest[]> {
  const res = await fetch(`${WORKER_ORIGIN}/_spike/stats${reset ? '?reset=1' : ''}`);
  return (await res.json()) as SeenRequest[];
}

/** Draws a synthetic 480x320 picture in the browser and encodes it as a real JPEG (no extra dependency). */
export async function seedSyntheticJpeg(page: Page): Promise<number> {
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 320;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, 0, 480, 320);
    g.addColorStop(0, '#2b6cb0');
    g.addColorStop(1, '#dd6b20');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 480, 320);
    ctx.fillStyle = '#808080';
    ctx.fillRect(40, 40, 120, 120);
    ctx.fillStyle = '#f7fafc';
    ctx.beginPath();
    ctx.arc(330, 150, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a202c';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('SYNTHETIC START PHOTO', 110, 280);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1] as string;
  });
  const bytes = Buffer.from(base64, 'base64');
  const res = await fetch(
    `${WORKER_ORIGIN}/_spike/seed?key=${encodeURIComponent(START_PHOTO_KEY)}`,
    {
      method: 'PUT',
      body: bytes,
    },
  );
  if (!res.ok) throw new Error(`seed failed: ${res.status}`);
  return bytes.length;
}

/** Evidence files live in the git-ignored .out directory; the README quotes them. */
export function writeEvidence(name: string, data: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2));
}
