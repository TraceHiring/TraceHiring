// AT-D10 (recruiter half, specs/d1-demo-slice.md §6.1): "View start photo" asks for a link, fetches the bytes once
// from the api origin, draws them with a tiled watermark of the response's `watermark` on a canvas and shows a
// `data:` URL. A second view asks for a new link. The /media/ URL is never logged and never leaves the controller.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/client';
import {
  StartPhotoController,
  renderWatermarked,
  watermarkText,
  type CanvasLike,
  type PhotoDeps,
} from './start-photo';
import {
  API_ORIGIN,
  ORG_ID,
  REPORT_ID,
  WATERMARK,
  fakeApiFetch,
  json,
} from './report.test-helpers';

const MEDIA_URL = `${API_ORIGIN}/media/00000000-0000-4000-8000-000000000001?exp=1790000000&sig=SECRETSIG`;
const LINK = {
  url: MEDIA_URL,
  expiresAt: '2026-10-19T10:10:00.000Z',
  watermark: WATERMARK,
};

function fakeDeps() {
  const texts: string[] = [];
  const draws: number[] = [];
  let closed = 0;
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    getContext: () => ({
      font: '',
      fillStyle: '',
      globalAlpha: 1,
      textBaseline: 'alphabetic',
      drawImage: () => {
        draws.push(1);
      },
      save: () => undefined,
      restore: () => undefined,
      translate: () => undefined,
      rotate: () => undefined,
      fillText: (text: string) => {
        texts.push(text);
      },
    }),
    toDataURL: () => 'data:image/jpeg;base64,AAAA',
  };
  const deps: PhotoDeps = {
    decode: () =>
      Promise.resolve({
        image: {},
        width: 320,
        height: 240,
        close: () => {
          closed += 1;
        },
      }),
    createCanvas: (width, height) => {
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
  };
  return { deps, texts, draws, closed: () => closed };
}

function controller(table: Parameters<typeof fakeApiFetch>[0], deps: PhotoDeps) {
  const fake = fakeApiFetch(table);
  const api = new ApiClient({
    origin: API_ORIGIN,
    orgId: ORG_ID,
    getAccessToken: () => Promise.resolve('tok'),
    fetch: fake.fetch,
  });
  return { photo: new StartPhotoController(api, REPORT_ID, deps), urls: fake.urls };
}

const jpeg = () =>
  new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('watermarkText', () => {
  it('names the viewer role, the org and the time', () => {
    const text = watermarkText(WATERMARK);
    expect(text).toContain('recruiter');
    expect(text).toContain('Synthetic Staffing');
    expect(text).toContain('19 Oct 2026');
  });
});

describe('renderWatermarked', () => {
  it('draws the image, tiles the watermark text and returns a data URL', async () => {
    const f = fakeDeps();
    const url = await renderWatermarked(new ArrayBuffer(3), WATERMARK, f.deps);
    expect(url.startsWith('data:image/')).toBe(true);
    expect(f.draws).toHaveLength(1);
    expect(f.texts.length).toBeGreaterThan(4);
    for (const t of f.texts) expect(t).toBe(watermarkText(WATERMARK));
    expect(f.closed()).toBe(1);
  });

  it('rejects when the canvas yields anything but an image data URL', async () => {
    const f = fakeDeps();
    const deps: PhotoDeps = {
      ...f.deps,
      createCanvas: (w, h) => {
        const canvas = f.deps.createCanvas(w, h);
        return { ...canvas, getContext: canvas.getContext, toDataURL: () => 'https://x.test/a' };
      },
    };
    await expect(renderWatermarked(new ArrayBuffer(3), WATERMARK, deps)).rejects.toThrow();
  });
});

describe('StartPhotoController', () => {
  it('asks for a link, fetches the bytes once and shows the watermarked data URL', async () => {
    const f = fakeDeps();
    const { photo, urls } = controller({ link: () => json(LINK, 200), media: jpeg }, f.deps);
    await photo.view();
    expect(photo.getSnapshot()).toEqual({ kind: 'shown', dataUrl: 'data:image/jpeg;base64,AAAA' });
    expect(urls.filter((u) => u.includes('/media/'))).toHaveLength(1);
    expect(urls.filter((u) => u.endsWith('/start-photo-link'))).toHaveLength(1);
    expect(f.texts.length).toBeGreaterThan(0);
    expect(f.texts[0]).toBe(watermarkText(WATERMARK));
  });

  it('a second view requests a new link (single use) and fetches again', async () => {
    const f = fakeDeps();
    const { photo, urls } = controller({ link: () => json(LINK, 200), media: jpeg }, f.deps);
    await photo.view();
    await photo.view();
    expect(urls.filter((u) => u.endsWith('/start-photo-link'))).toHaveLength(2);
    expect(urls.filter((u) => u.includes('/media/'))).toHaveLength(2);
  });

  it('ignores a click while a view is running (one link per click)', async () => {
    const f = fakeDeps();
    const { photo, urls } = controller({ link: () => json(LINK, 200), media: jpeg }, f.deps);
    await Promise.all([photo.view(), photo.view()]);
    expect(urls.filter((u) => u.endsWith('/start-photo-link'))).toHaveLength(1);
  });

  it('shows a fixed error and never the url when the bytes are gone (burnt link)', async () => {
    const f = fakeDeps();
    const { photo } = controller(
      { link: () => json(LINK, 200), media: () => json({ error: { code: 'not_found' } }, 404) },
      f.deps,
    );
    await photo.view();
    expect(photo.getSnapshot()).toEqual({ kind: 'error', reason: 'generic' });
    expect(JSON.stringify(photo.getSnapshot())).not.toContain('SECRETSIG');
  });

  it('aal2 is its own message; any other link failure is generic', async () => {
    const f = fakeDeps();
    const needs = controller(
      { link: () => json({ error: { code: 'aal2_required' } }, 403) },
      f.deps,
    );
    await needs.photo.view();
    expect(needs.photo.getSnapshot()).toEqual({ kind: 'error', reason: 'aal2' });
    const none = controller({ link: () => json({ error: { code: 'not_found' } }, 404) }, f.deps);
    await none.photo.view();
    expect(none.photo.getSnapshot()).toEqual({ kind: 'error', reason: 'generic' });
  });

  it('an unreadable link response does not fetch anything', async () => {
    const f = fakeDeps();
    const { photo, urls } = controller({ link: () => json({ url: 'nope' }, 200) }, f.deps);
    await photo.view();
    expect(photo.getSnapshot()).toEqual({ kind: 'error', reason: 'generic' });
    expect(urls.filter((u) => u.includes('/media/'))).toHaveLength(0);
  });

  it('writes nothing to the console and keeps the media URL out of any state', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const f = fakeDeps();
    const { photo } = controller({ link: () => json(LINK, 200), media: jpeg }, f.deps);
    await photo.view();
    const bad = controller(
      { link: () => json(LINK, 200), media: () => json({ error: { code: 'not_found' } }, 404) },
      f.deps,
    );
    await bad.photo.view();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(photo.getSnapshot())).not.toContain('/media/');
    expect(JSON.stringify(bad.photo.getSnapshot())).not.toContain('/media/');
  });
});
