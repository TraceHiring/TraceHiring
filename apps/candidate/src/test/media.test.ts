// Item images as `data:` URLs (specs/m1-test-authoring.md R5-10, R5-66 e; AT-M1-32): the bytes come only through
// the API client's media route; this module checks the type and the hash, base64-encodes them and builds the URL.
// Nothing is stored and no object URL is made. Any failure is `null` (the screen then shows one neutral line).
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, CandidateApi, ItemImage } from '../api';
import { sha256HexOf } from '../dom.test-helpers';
import { PNG_BYTES, SESSION_TOKEN } from '../fixtures.test-helpers';
import { base64Of, itemImageUrl } from './media';

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

describe('itemImageUrl', () => {
  it('builds a data: URL of the checked bytes', async () => {
    const hash = await sha256HexOf(PNG_BYTES);
    const media = fakeMedia({ ok: true, value: { type: 'image/png', bytes: PNG_BYTES } });
    const url = await itemImageUrl({ media }, SESSION_TOKEN, hash);
    expect(url).toBe(`data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`);
    expect(media).toHaveBeenCalledWith(SESSION_TOKEN, hash);
  });

  it('is null when the bytes do not hash to the requested hash', async () => {
    const media = fakeMedia({ ok: true, value: { type: 'image/png', bytes: PNG_BYTES } });
    expect(await itemImageUrl({ media }, SESSION_TOKEN, 'c'.repeat(64))).toBeNull();
  });

  it('is null on any refusal (404, network, rate limit)', async () => {
    const hash = await sha256HexOf(PNG_BYTES);
    for (const failure of [
      { ok: false, code: 'invalid_link', status: 404 },
      { ok: false, code: 'network', status: 0 },
      { ok: false, code: 'rate_limited', status: 429 },
    ] as const) {
      expect(await itemImageUrl({ media: fakeMedia(failure) }, SESSION_TOKEN, hash)).toBeNull();
    }
  });

  it('is null for a type outside png, jpeg and webp, whatever the client says', async () => {
    const hash = await sha256HexOf(PNG_BYTES);
    const media = fakeMedia({
      ok: true,
      value: { type: 'image/svg+xml' as 'image/png', bytes: PNG_BYTES },
    });
    expect(await itemImageUrl({ media }, SESSION_TOKEN, hash)).toBeNull();
  });
});
