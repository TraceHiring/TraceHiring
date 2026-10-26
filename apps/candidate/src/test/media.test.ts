// Item images as `data:` URLs (specs/m1-test-authoring.md R5-10, R5-66 e, R5-68 c; AT-M1-32): the bytes come only
// through the API client's media route; this module checks the type and the hash, base64-encodes them and builds the
// URL. Nothing is stored and no object URL is made. A 404 or bad media is final (one neutral line); a network failure,
// 429 (Retry-After wins) or 503 is retried with backoff, at most 4 tries, then the line shows with "Try again".
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, CandidateApi, ItemImage } from '../api';
import { sha256HexOf } from '../dom.test-helpers';
import { PNG_BYTES, SESSION_TOKEN } from '../fixtures.test-helpers';
import { base64Of, loadItemImage } from './media';

const fakeMedia = (result: ApiResult<ItemImage>) =>
  vi.fn<CandidateApi['media']>(async () => result);

describe('base64Of', () => {
  it('matches the platform encoder for every length remainder', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 255, 256, 70_000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256);
      expect(base64Of(bytes), String(n)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});

describe('loadItemImage (R5-68 c)', () => {
  const sleeps = () => {
    const waits: number[] = [];
    return { waits, sleep: async (ms: number) => void waits.push(ms) };
  };
  const sequence = (...results: ApiResult<ItemImage>[]) => {
    const media = vi.fn<CandidateApi['media']>();
    for (const r of results) media.mockResolvedValueOnce(r);
    return media;
  };
  const png = (): ApiResult<ItemImage> => ({
    ok: true,
    value: { type: 'image/png', bytes: PNG_BYTES },
  });

  it('builds a data: URL of the checked bytes', async () => {
    const hash = await sha256HexOf(PNG_BYTES);
    const media = fakeMedia(png());
    const { sleep } = sleeps();
    expect(await loadItemImage({ media }, SESSION_TOKEN, hash, { sleep })).toEqual({
      kind: 'ok',
      url: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`,
    });
    expect(media).toHaveBeenCalledWith(SESSION_TOKEN, hash);
  });

  it('is final for a 404 and for bad media (type, size, hash): one request, no retry', async () => {
    const hash = await sha256HexOf(PNG_BYTES);
    const cases: ApiResult<ItemImage>[] = [
      { ok: false, code: 'invalid_link', status: 404 },
      { ok: false, code: 'bad_media', status: 415 },
      { ok: false, code: 'bad_media', status: 200 }, // the client's own type or size check
      { ok: true, value: { type: 'image/svg+xml' as 'image/png', bytes: PNG_BYTES } },
    ];
    for (const result of cases) {
      const media = fakeMedia(result);
      const { sleep, waits } = sleeps();
      expect(await loadItemImage({ media }, SESSION_TOKEN, hash, { sleep })).toEqual({
        kind: 'final',
      });
      expect(media).toHaveBeenCalledTimes(1);
      expect(waits).toEqual([]);
    }
    // Bytes that do not hash to the requested hash.
    const media = fakeMedia(png());
    expect(await loadItemImage({ media }, SESSION_TOKEN, 'c'.repeat(64), sleeps())).toEqual({
      kind: 'final',
    });
    expect(media).toHaveBeenCalledTimes(1);
  });

  it('retries a network failure, a 429 (Retry-After wins) and a 503 with backoff, then succeeds', async () => {
    const hash = await sha256HexOf(PNG_BYTES);
    const media = sequence(
      { ok: false, code: 'network', status: 0 },
      { ok: false, code: 'rate_limited', status: 429, retryAfterSeconds: 3 },
      { ok: false, code: 'unavailable', status: 503 },
      png(),
    );
    const { sleep, waits } = sleeps();
    expect(await loadItemImage({ media }, SESSION_TOKEN, hash, { sleep })).toMatchObject({
      kind: 'ok',
    });
    expect(media).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([1_000, 3_000, 4_000]);
  });

  it('gives up after 4 tries: the line shows with "Try again"', async () => {
    const hash = await sha256HexOf(PNG_BYTES);
    const media = fakeMedia({ ok: false, code: 'network', status: 0 });
    const { sleep, waits } = sleeps();
    expect(await loadItemImage({ media }, SESSION_TOKEN, hash, { sleep })).toEqual({
      kind: 'failed',
    });
    expect(media).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([1_000, 2_000, 4_000]);
  });

  it('any other answer is not final but is not retried on its own ("Try again")', async () => {
    const hash = await sha256HexOf(PNG_BYTES);
    const media = fakeMedia({ ok: false, code: 'superseded', status: 401 });
    const { sleep, waits } = sleeps();
    expect(await loadItemImage({ media }, SESSION_TOKEN, hash, { sleep })).toEqual({
      kind: 'failed',
    });
    expect(media).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('stops when the screen is gone', async () => {
    const hash = await sha256HexOf(PNG_BYTES);
    const media = fakeMedia({ ok: false, code: 'network', status: 0 });
    const { sleep } = sleeps();
    let alive = true;
    const res = loadItemImage({ media }, SESSION_TOKEN, hash, {
      sleep: async (ms) => {
        alive = false;
        await sleep(ms);
      },
      alive: () => alive,
    });
    expect(await res).toEqual({ kind: 'failed' });
    expect(media).toHaveBeenCalledTimes(1);
  });
});
