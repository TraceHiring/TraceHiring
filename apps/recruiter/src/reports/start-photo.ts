// The start photo flow (specs/d1-demo-slice.md §6.1 "Start photo", rule 8): ask for a single-use link, fetch the
// bytes once from the api origin, draw them on a canvas with a tiled watermark of the viewer's role, org and time,
// and show the result as a `data:` URL. The media URL lives only inside `view()`: it is never stored in state,
// logged, put in an error or handed to the DOM, so no breadcrumb can carry it.
import { MediaLinkResponse } from '@trace/shared/contracts/d1';
import { useSyncExternalStore } from 'react';
import type { ApiClient } from '../api/client';
import { formatTime } from '../common/format';

type Watermark = MediaLinkResponse['watermark'];

/** The part of a 2D canvas context the renderer uses. */
export interface Context2D {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  textBaseline: string;
  drawImage(image: never, dx: number, dy: number, dw: number, dh: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  fillText(text: string, x: number, y: number): void;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(id: '2d'): Context2D | null;
  toDataURL(type: string, quality?: number): string;
}

/** What the browser supplies; tests pass fakes (there is no canvas in the unit-test runtime). */
export interface PhotoDeps {
  decode(bytes: ArrayBuffer): Promise<{
    image: unknown;
    width: number;
    height: number;
    close(): void;
  }>;
  createCanvas(width: number, height: number): CanvasLike;
}

const MAX_SIDE = 960;

export const browserPhotoDeps: PhotoDeps = {
  decode: async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => {
        bitmap.close();
      },
    };
  },
  createCanvas: (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
};

/** "recruiter · Synthetic Staffing · 19 Oct 2026, 15:35 IST" (R-13: role, org, time). */
export function watermarkText(watermark: Watermark): string {
  return `${watermark.viewerRole} · ${watermark.org} · ${formatTime(watermark.issuedAt)}`;
}

/** Draws the photo and a tiled, rotated watermark; returns the canvas as an image data URL. */
export async function renderWatermarked(
  bytes: ArrayBuffer,
  watermark: Watermark,
  deps: PhotoDeps,
): Promise<string> {
  const decoded = await deps.decode(bytes);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(decoded.width, decoded.height, 1));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = deps.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('canvas');
    ctx.drawImage(decoded.image as never, 0, 0, width, height);
    const text = watermarkText(watermark);
    ctx.save();
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.55;
    ctx.textBaseline = 'middle';
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-Math.PI / 8);
    const stepX = Math.max(160, text.length * 8);
    const stepY = 56;
    const reach = Math.ceil(Math.hypot(width, height) / 2);
    for (let y = -reach; y <= reach; y += stepY) {
      for (let x = -reach; x <= reach; x += stepX) ctx.fillText(text, x, y);
    }
    ctx.restore();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    if (!dataUrl.startsWith('data:image/')) throw new Error('canvas');
    return dataUrl;
  } finally {
    decoded.close();
  }
}

export type PhotoState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'shown'; dataUrl: string }
  | { kind: 'error'; reason: 'aal2' | 'generic' };

export class StartPhotoController {
  private readonly api: ApiClient;
  private readonly reportId: string;
  private readonly deps: PhotoDeps;
  private readonly listeners = new Set<() => void>();
  private state: PhotoState = { kind: 'idle' };

  constructor(api: ApiClient, reportId: string, deps: PhotoDeps = browserPhotoDeps) {
    this.api = api;
    this.reportId = reportId;
    this.deps = deps;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): PhotoState => this.state;

  private set(state: PhotoState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  /** One click: a new link, one fetch of the bytes, one canvas. Ignored while a view is running. */
  async view(): Promise<void> {
    if (this.state.kind === 'working') return;
    this.set({ kind: 'working' });
    const link = await this.api.call({
      method: 'POST',
      path: `/reports/${this.reportId}/start-photo-link`,
      schema: MediaLinkResponse,
    });
    if (!link.ok) {
      this.set({ kind: 'error', reason: link.code === 'aal2_required' ? 'aal2' : 'generic' });
      return;
    }
    const bytes = await this.api.fetchImageBytes(link.data.url);
    if (!bytes.ok) {
      this.set({ kind: 'error', reason: 'generic' });
      return;
    }
    try {
      const dataUrl = await renderWatermarked(bytes.data, link.data.watermark, this.deps);
      this.set({ kind: 'shown', dataUrl });
    } catch {
      this.set({ kind: 'error', reason: 'generic' });
    }
  }
}

export function usePhoto(controller: StartPhotoController): PhotoState {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
