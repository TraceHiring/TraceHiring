// Helpers for the happy-dom behavioural tests (React 19 `act`, no testing-library): mount, wait, click, type, a
// fetch router that records every request, and fakes for the camera, canvas and media element. Synthetic data only.
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';
import { json } from './fixtures.test-helpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  container: HTMLElement;
  unmount(): Promise<void>;
}

export const mount = async (element: ReactElement): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

/** Lets pending promises and timers run inside act. */
export const settle = async (ms = 0): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

/** Polls until `probe` returns a truthy value (or throws the last error after `timeoutMs`). */
export const waitFor = async <T>(
  probe: () => T,
  what: string,
  timeoutMs = 5_000,
): Promise<NonNullable<T>> => {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value !== null && value !== undefined && value !== false) return value as NonNullable<T>;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await settle(10);
  }
};

export const h1Text = (root: ParentNode): string | null =>
  root.querySelector('h1')?.textContent ?? null;

export const buttonByText = (root: ParentNode, label: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label);

export const waitForButton = (root: ParentNode, label: string) =>
  waitFor(() => {
    const b = buttonByText(root, label);
    return b !== undefined && !b.disabled ? b : null;
  }, `button "${label}"`);

export const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    el.click();
  });
};

/** Sets a controlled input's value the way React notices (native setter, then an input event). */
export const typeInto = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

// ---- fetch -------------------------------------------------------------------------------------------------------

export interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  /** Monotonic order across fetch calls and other recorded events. */
  order: number;
}

export type Route = (req: Recorded) => Response | Promise<Response>;

let order = 0;
export const nextOrder = () => (order += 1);

/** Routes by `METHOD /path` (`/v1/session/items/:pos` for every item); an unknown route is a 404. */
export const mockFetch = (routes: Record<string, Route>) => {
  const calls: Recorded[] = [];
  const fn = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const path = url.pathname;
    const key = `${method} ${path.replace(/\/items\/\d+$/, '/items/:pos')}`;
    const raw = init.body;
    const body =
      raw instanceof Uint8Array
        ? raw
        : typeof raw === 'string'
          ? (JSON.parse(raw) as unknown)
          : raw;
    const rec: Recorded = {
      method,
      path,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body,
      order: nextOrder(),
    };
    calls.push(rec);
    const route = routes[key];
    if (route === undefined) return json(404, { error: 'invalid_link' });
    return route(rec);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls, paths: () => calls.map((c) => `${c.method} ${c.path}`) };
};

// ---- camera, canvas, media ---------------------------------------------------------------------------------------

export interface FakeTrack {
  kind: 'video';
  stop: ReturnType<typeof vi.fn>;
}

/** navigator.mediaDevices with a recording getUserMedia; `deny` makes it reject with that DOMException name. */
export const fakeCamera = (deny?: string) => {
  const tracks: FakeTrack[] = [];
  const calls: { constraints: MediaStreamConstraints; order: number }[] = [];
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    calls.push({ constraints, order: nextOrder() });
    if (deny !== undefined) throw Object.assign(new Error(deny), { name: deny });
    const track: FakeTrack = { kind: 'video', stop: vi.fn() };
    tracks.push(track);
    return {
      getTracks: () => [track],
      getAudioTracks: () => [],
      removeTrack: () => undefined,
    } as unknown as MediaStream;
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  return { getUserMedia, tracks, calls };
};

/** A JPEG shaped like Chromium's canvas output: SOI, APP0, APP2 (ICC), DQT, SOF0 320x240, SOS, data, EOI. */
export const CANVAS_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff,
  0xe2, 0x00, 0x06, 1, 2, 3, 4, 0xff, 0xdb, 0x00, 0x04, 0, 1, 0xff, 0xc0, 0x00, 0x0b, 8, 0x00, 0xf0,
  0x01, 0x40, 1, 1, 0x11, 0, 0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0x56, 0xff,
  0xd9,
]);

/** Canvas 2D context, toBlob, video size and play, and a frame loop that never runs on its own. */
export const fakeCanvasAndVideo = () => {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: vi.fn(),
    clearRect: vi.fn(),
  };
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ctx,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    value(callback: (blob: Blob | null) => void) {
      callback(new Blob([CANVAS_JPEG], { type: 'image/jpeg' }));
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: () => undefined,
  });
  // happy-dom checks for a real MediaStream; the fake stream is a plain object.
  const streams = new WeakMap<object, unknown>();
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get(this: object) {
      return streams.get(this) ?? null;
    },
    set(this: object, value: unknown) {
      streams.set(this, value);
    },
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    get: () => 320,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    get: () => 240,
  });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  return ctx;
};

export const sha256HexOf = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

/** A promise and its resolver, to hold a response back. */
export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
