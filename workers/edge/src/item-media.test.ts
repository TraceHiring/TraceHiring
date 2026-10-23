// AT-M1-23 (specs/m1-test-authoring.md §6.5, E25; R2-17, R5-10, R5-56 a): `GET /v1/session/media/:hash` returns an
// item image only when the hash is in the media list of an item currently served to the session named by the token
// claims. The edge reads exactly the package's object path (a library copy keeps the library org's prefix), answers
// `cache-control: no-store` and the content type of the stored extension, and every refusal for a valid token is the
// same 404 (an unknown, unserved, closed-section or missing image cannot be told apart). The bucket is only read.
// Synthetic bytes only.
import { describe, expect, it } from 'vitest';
import { sha256HexBytes } from './encoding.js';
import {
  finish,
  FORWARD,
  INLINE,
  LIBRARY_ORG,
  makePackage,
  makePackageV2,
  mediaHash,
  mediaPath,
  POOL,
  POSITIONS,
  postEvents,
  sessionHarness,
  type SessionRouteHarness,
} from './session.test-helpers.js';
import { ORG } from './token.test-helpers.js';

const pkg = makePackageV2();
const poolItems = pkg.items.filter((i) => i.sectionId === POOL);

/** Synthetic image bytes whose sha256 is the content hash the package names. */
const imageBytes = (n: number) => new TextEncoder().encode(`[synthetic] image bytes ${n}`);

/** The package with real content hashes: image n's bytes hash to the hash its item names (object path to match). */
const withImages = async (base: typeof pkg = pkg) => {
  const real = structuredClone(base);
  const objects = new Map<string, Uint8Array>();
  let n = 0;
  for (const item of real.items) {
    for (const m of item.media ?? []) {
      n += 1;
      const bytes = imageBytes(n);
      const hash = await sha256HexBytes(bytes);
      const org = m.objectPath.split('/')[1] ?? ORG;
      m.hash = hash;
      m.objectPath = mediaPath(org, hash, m.ext);
      objects.set(m.objectPath, bytes);
    }
  }
  return { real, objects };
};

const mediaHarness = async (base: typeof pkg = pkg) => {
  const { real, objects } = await withImages(base);
  const h = await sessionHarness({ pkg: real });
  for (const [path, bytes] of objects) await h.itemMedia.bucket.put(path, bytes);
  const { token, view } = await h.startSession();
  return { h, token, view, pkg: real };
};

const get = (h: SessionRouteHarness, token: string | undefined, hash: string) =>
  h.request('GET', `/v1/session/media/${hash}`, token === undefined ? {} : { token });

const servedPoolItem = async (h: SessionRouteHarness, token: string, real: typeof pkg) => {
  const res = await h.request('GET', '/v1/session/items/1', { token });
  const item = (await res.json()) as { media?: { hash: string }[] };
  const hash = item.media?.[0]?.hash ?? '';
  const source = real.items.find((i) => i.media?.some((m) => m.hash === hash));
  return { hash, source };
};

const NOT_FOUND = { error: 'invalid_link' };

describe('GET /v1/session/media/:hash (AT-M1-23)', () => {
  it('returns a served item image read from exactly its package object path, never cached', async () => {
    const { h, token, pkg: real } = await mediaHarness();
    const { hash, source } = await servedPoolItem(h, token, real);
    const media = source?.media?.[0];
    if (media === undefined) throw new Error('no media');
    expect(media.objectPath.startsWith(`item-media/${LIBRARY_ORG}/`)).toBe(true);

    h.itemMedia.calls.length = 0;
    const res = await get(h, token, hash);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await sha256HexBytes(new Uint8Array(await res.arrayBuffer()))).toBe(hash);
    expect(h.itemMedia.calls).toEqual(['get']);
  });

  it('answers the jpg content type from the stored extension (an inline item under the session org)', async () => {
    const { h, token, pkg: real } = await mediaHarness();
    const res = await h.request('GET', '/v1/session/items/6', { token });
    const hash = ((await res.json()) as { media: { hash: string }[] }).media[0]?.hash ?? '';
    const media = real.items.find((i) => i.sectionId === INLINE)?.media?.[0];
    expect(media?.objectPath.startsWith(`item-media/${ORG}/`)).toBe(true);
    const image = await get(h, token, hash);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/jpeg');
  });

  it('refuses an unserved, undrawn, unknown or malformed hash with the same 404, without reading the bucket', async () => {
    const { h, token, pkg: real } = await mediaHarness();
    await servedPoolItem(h, token, real);
    // Every image of the package that is not on a served item: undrawn pool items and unserved positions.
    const servedHashes = new Set<string>();
    for (const position of [1, 2]) {
      const res = await h.request('GET', `/v1/session/items/${position}`, { token });
      for (const m of ((await res.json()) as { media?: { hash: string }[] }).media ?? []) {
        servedHashes.add(m.hash);
      }
    }
    const others = real.items
      .flatMap((i) => i.media ?? [])
      .map((m) => m.hash)
      .filter((hash) => !servedHashes.has(hash));
    expect(others.length).toBeGreaterThan(0);
    h.itemMedia.calls.length = 0;
    for (const hash of [...others, mediaHash(999), 'zz', 'A'.repeat(64)]) {
      const res = await get(h, token, hash);
      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    expect(h.itemMedia.calls).toEqual([]);
  });

  it('refuses the image of a closed section, and every image after submit', async () => {
    const { h, token, view, pkg: real } = await mediaHarness();
    const res = await h.request('GET', '/v1/session/items/6', { token });
    const inlineHash = ((await res.json()) as { media: { hash: string }[] }).media[0]?.hash ?? '';
    const { hash } = await servedPoolItem(h, token, real);
    expect((await get(h, token, inlineHash)).status).toBe(200);

    await postEvents(h, token, view.streamId, [finish(1, INLINE)]);
    const closed = await get(h, token, inlineHash);
    expect(closed.status).toBe(404);
    expect(await closed.json()).toEqual(NOT_FOUND);

    await h.request('POST', '/v1/session/submit', {
      token,
      json: { streamId: view.streamId, finalSeq: 1 },
    });
    expect((await get(h, token, hash)).status).toBe(404);
  });

  it('forward-only: the image of a position the candidate has moved past is refused (R5-59, SEC review #3)', async () => {
    // The forward-only written section with one image per item (n = 201..203).
    const base = makePackageV2();
    for (const [k, item] of base.items.filter((i) => i.sectionId === FORWARD).entries()) {
      const hash = mediaHash(201 + k);
      item.media = [
        {
          hash,
          ext: 'png',
          alt: `[synthetic] writing figure ${k}`,
          objectPath: mediaPath(ORG, hash, 'png'),
        },
      ];
    }
    const { h, token } = await mediaHarness(base);
    const [first, second] = POSITIONS[FORWARD];
    const hashAt = async (position: number) => {
      const res = await h.request('GET', `/v1/session/items/${position}?afterSeq=0`, { token });
      expect(res.status).toBe(200);
      return ((await res.json()) as { media: { hash: string }[] }).media[0]?.hash ?? '';
    };
    const firstHash = await hashAt(first);
    expect((await get(h, token, firstHash)).status).toBe(200);
    const secondHash = await hashAt(second);

    const behind = await get(h, token, firstHash);
    expect(behind.status).toBe(404);
    expect(await behind.json()).toEqual(NOT_FOUND);
    expect((await get(h, token, secondHash)).status).toBe(200);
  });

  it('refuses when the stored object is missing or its bytes do not match the hash', async () => {
    const { h, token, pkg: real } = await mediaHarness();
    const { hash, source } = await servedPoolItem(h, token, real);
    const path = source?.media?.[0]?.objectPath ?? '';
    await h.itemMedia.bucket.put(path, new TextEncoder().encode('[synthetic] other bytes'));
    const mismatch = await get(h, token, hash);
    expect(mismatch.status).toBe(404);
    expect(await mismatch.json()).toEqual(NOT_FOUND);
    h.itemMedia.objects.delete(path);
    expect((await get(h, token, hash)).status).toBe(404);
  });

  it('needs the session Bearer token; the session comes from its claims only', async () => {
    const { h, token, pkg: real } = await mediaHarness();
    const { hash } = await servedPoolItem(h, token, real);
    expect((await get(h, undefined, hash)).status).toBe(401);
    expect((await get(h, 'aaaa.bbbb.cccc', hash)).status).toBe(401);
    const res = await h.request('GET', `/v1/session/media/${hash}?sessionId=${ORG}&orgId=${ORG}`, {
      token,
    });
    expect(res.status).toBe(200);
    expect(h.session.names.every((name) => name === h.session.names[0])).toBe(true);
  });

  it('a package v1 session has no item images', async () => {
    const h = await sessionHarness({ pkg: makePackage() });
    const { token } = await h.startSession();
    expect((await get(h, token, mediaHash(1))).status).toBe(404);
    expect(poolItems.length).toBe(6);
  });
});
