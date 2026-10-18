// AT-D29, photo half (specs/d1-demo-slice.md §4.5, rule 8): PUT /v1/lobby/photo accepts only a raw JPEG within the size
// cap and 160-1280 px per side whose SHA-256 matches X-Photo-Sha256 (else 415 / 413 / 400), needs api's photoPermit
// (consent first; locked after start), stores it under one deterministic key with {sha256, blurred:'1', n}, and
// allows 3 uploads per session. The `maxChars` batch rejection belongs to the session events route (stream C1b).
import { describe, expect, it } from 'vitest';
import { sha256HexBytes } from './encoding.js';
import { createHarness, testJpeg as jpeg, type Harness } from './edge.test-helpers.js';
import { hasJpegMagic, jpegDimensions } from './jpeg.js';
import { startPhotoKey } from './routes-photo.js';
import { INVITATION, ORG, SESSION } from './token.test-helpers.js';

const upload = async (
  h: Awaited<ReturnType<typeof createHarness>>,
  token: string,
  bytes: Uint8Array,
  opts: { sha?: string; type?: string } = {},
) =>
  h.request('PUT', '/v1/lobby/photo', {
    token,
    body: bytes,
    headers: {
      'content-type': opts.type ?? 'image/jpeg',
      'x-photo-sha256': opts.sha ?? (await sha256HexBytes(bytes)),
    },
  });

/** Offsets in testJpeg: after SOI, after the APP0 segment, after the SOF frame (before SOS). */
const AFTER_SOI = 2;
const AFTER_APP0 = 20;
const AFTER_SOF = 39;
const insert = (bytes: Uint8Array, at: number, extra: number[]): Uint8Array =>
  new Uint8Array([...bytes.slice(0, at), ...extra, ...bytes.slice(at)]);
/** A marker segment: FF, the marker, a big-endian length (payload + 2), the payload. */
const segment = (marker: number, payload: number[]): number[] => [
  0xff,
  marker,
  ((payload.length + 2) >> 8) & 0xff,
  (payload.length + 2) & 0xff,
  ...payload,
];
const ascii = (s: string): number[] => [...s].map((ch) => ch.charCodeAt(0));
/** An APP1 EXIF segment with a few synthetic TIFF header bytes. */
const exif = segment(0xe1, [...ascii('Exif'), 0, 0, 0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]);

describe('jpeg checks (rule 8: only the processed JPEG, SEC-5)', () => {
  it('the test JPEG lands at the offsets the tests insert at', () => {
    const j = jpeg(640, 480);
    expect([j[AFTER_SOI], j[AFTER_SOI + 1]]).toEqual([0xff, 0xe0]);
    expect([j[AFTER_APP0], j[AFTER_APP0 + 1]]).toEqual([0xff, 0xc0]);
    expect([j[AFTER_SOF], j[AFTER_SOF + 1]]).toEqual([0xff, 0xda]);
  });

  it.each([
    ['APP1 Exif after SOI', insert(jpeg(640, 480), AFTER_SOI, exif)],
    ['APP1 Exif after APP0', insert(jpeg(640, 480), AFTER_APP0, exif)],
    ['APP1 Exif after the frame', insert(jpeg(640, 480), AFTER_SOF, exif)],
    ['APP2 (ICC)', insert(jpeg(640, 480), AFTER_APP0, segment(0xe2, ascii('ICC_PROFILE')))],
    ['APP15', insert(jpeg(640, 480), AFTER_APP0, segment(0xef, [1, 2, 3]))],
    ['a COM segment', insert(jpeg(640, 480), AFTER_APP0, segment(0xfe, ascii('note')))],
    ['bytes after EOI', new Uint8Array([...jpeg(640, 480), 0x00, 0x01, 0x02])],
    ['a body not ending FF D9', jpeg(640, 480).slice(0, -1)],
  ])('%s is not a clean JPEG', (_label, bytes) => {
    expect(jpegDimensions(bytes)).toBeNull();
  });

  it('a second APP0 segment and DQT/DHT segments before the scan are allowed', () => {
    const dqt = segment(0xdb, [0, ...Array.from({ length: 64 }, () => 1)]);
    const app0 = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    expect(
      jpegDimensions(insert(insert(jpeg(640, 480), AFTER_APP0, dqt), AFTER_APP0, app0)),
    ).toEqual({ width: 640, height: 480 });
  });

  it('reads the frame size from SOF0 and progressive SOF2', () => {
    expect(jpegDimensions(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
    expect(jpegDimensions(jpeg(320, 240, 8, 0xc2))).toEqual({ width: 320, height: 240 });
  });

  it('refuses a body without magic or without a frame', () => {
    expect(hasJpegMagic(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(jpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(jpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x50]))).toBeNull();
    expect(jpegDimensions(jpeg(640, 480).slice(0, 30))).toBeNull();
  });
});

describe('PUT /v1/lobby/photo (AT-D29)', () => {
  it('stores the JPEG under the deterministic key with sha256, blurred and n', async () => {
    const h = await createHarness();
    const token = await h.login();
    const bytes = jpeg(640, 480);
    const res = await upload(h, token, bytes);

    expect(res.status).toBe(200);
    const sha256 = await sha256HexBytes(bytes);
    expect(await res.json()).toEqual({ sha256, bytes: bytes.length });
    const key = `media/${ORG}/${SESSION}/start_photo.jpg`;
    expect(startPhotoKey(ORG, SESSION)).toBe(key);
    expect([...h.evidence.objects.keys()]).toEqual([key]);
    const stored = h.evidence.objects.get(key);
    expect(stored?.httpMetadata).toEqual({ contentType: 'image/jpeg' });
    expect(stored?.customMetadata).toEqual({ sha256, blurred: '1', n: '1' });
    expect(stored?.body).toEqual(bytes);
  });

  it('a retake overwrites the same key; the fourth upload is 429 without Retry-After and nothing changes', async () => {
    const h = await createHarness();
    const token = await h.login();
    for (let n = 1; n <= 3; n += 1) {
      const res = await upload(h, token, jpeg(640, 480, 64 + n));
      expect(res.status).toBe(200);
      expect(h.evidence.objects.size).toBe(1);
      expect([...h.evidence.objects.values()][0]?.customMetadata?.n).toBe(String(n));
    }
    const fourth = await upload(h, token, jpeg(640, 480, 99));
    expect(fourth.status).toBe(429);
    // The cap is permanent for the session, so there is no wait to announce (lead, SR-4).
    expect(fourth.headers.get('retry-after')).toBeNull();
    expect(await fourth.json()).toEqual({ error: 'rate_limited' });
    expect([...h.evidence.objects.values()][0]?.customMetadata?.n).toBe('3');
  });

  it.each([
    ['a PNG body', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])],
    ['a JPEG without a frame', new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
    ['159 px wide', jpeg(159, 480)],
    ['159 px high', jpeg(640, 159)],
    ['1281 px wide', jpeg(1281, 720)],
    ['1281 px high', jpeg(720, 1281)],
    ['an APP1 "Exif\\0\\0" segment', insert(jpeg(640, 480), AFTER_APP0, exif)],
    ['a COM segment', insert(jpeg(640, 480), AFTER_APP0, segment(0xfe, ascii('note')))],
    ['trailing bytes after EOI', new Uint8Array([...jpeg(640, 480), 0x41, 0x42])],
  ])('%s is 415 bad_media', async (_label, bytes) => {
    const h = await createHarness();
    const token = await h.login();
    const res = await upload(h, token, bytes);
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'bad_media' });
    expect(h.evidence.objects.size).toBe(0);
  });

  it('accepts the size bounds 160 and 1280 px', async () => {
    const h = await createHarness();
    const token = await h.login();
    expect((await upload(h, token, jpeg(160, 160))).status).toBe(200);
    expect((await upload(h, token, jpeg(1280, 1280))).status).toBe(200);
  });

  it.each([['image/png'], ['application/octet-stream'], ['multipart/form-data']])(
    'content-type %s is 415',
    async (type) => {
      const h = await createHarness();
      const token = await h.login();
      expect((await upload(h, token, jpeg(640, 480), { type })).status).toBe(415);
    },
  );

  it('over 512 000 bytes is 413 too_large', async () => {
    const h = await createHarness();
    const token = await h.login();
    const res = await upload(h, token, jpeg(640, 480, 512_001));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too_large' });
    expect(h.evidence.objects.size).toBe(0);
  });

  it('a hash mismatch or a malformed hash header is 400', async () => {
    const h = await createHarness();
    const token = await h.login();
    const bytes = jpeg(640, 480);
    expect((await upload(h, token, bytes, { sha: 'b'.repeat(64) })).status).toBe(400);
    expect((await upload(h, token, bytes, { sha: 'XYZ' })).status).toBe(400);
    const upper = (await sha256HexBytes(bytes)).toUpperCase();
    expect((await upload(h, token, bytes, { sha: upper })).status).toBe(400);
    expect(h.evidence.objects.size).toBe(0);
  });

  it('a rejected upload does not use one of the three slots', async () => {
    const h = await createHarness();
    const token = await h.login();
    for (let i = 0; i < 3; i += 1) await upload(h, token, jpeg(100, 100));
    for (let n = 1; n <= 3; n += 1)
      expect((await upload(h, token, jpeg(640, 480))).status).toBe(200);
  });

  it('without consent (photoPermit step_required) it is 403 and nothing is stored', async () => {
    const h = await createHarness({
      photoPermit: async () => {
        throw new Error('step_required');
      },
    });
    const token = await h.login();
    const res = await upload(h, token, jpeg(640, 480));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'step_required' });
    expect(h.evidence.objects.size).toBe(0);
  });

  it('once the session started (locked) it is 410 closed', async () => {
    const h = await createHarness({
      photoPermit: async () => ({ orgId: ORG, sessionId: SESSION, locked: true }),
    });
    const token = await h.login();
    const res = await upload(h, token, jpeg(640, 480));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'closed' });
    expect(h.evidence.objects.size).toBe(0);
  });

  it('a permit for another org than the token is 503 unavailable: nothing stored, no slot (SR-9)', async () => {
    const h = await createHarness({
      photoPermit: async () => ({
        orgId: '77777777-7777-4777-8777-777777777777',
        sessionId: SESSION,
        locked: false,
      }),
    });
    const token = await h.login();
    const res = await upload(h, token, jpeg(640, 480));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
    expect(h.evidence.objects.size).toBe(0);
    expect(h.otp.kvs.get(INVITATION)?.get('photo:uploads')).toBeUndefined();
  });

  it('the key uses the ids from api, never ids from the request', async () => {
    const h = await createHarness();
    const token = await h.login();
    const other = '99999999-9999-4999-8999-999999999999';
    const bytes = jpeg(640, 480);
    const res = await h.request('PUT', `/v1/lobby/photo?sessionId=${other}&orgId=${other}`, {
      token,
      body: bytes,
      headers: {
        'content-type': 'image/jpeg',
        'x-photo-sha256': await sha256HexBytes(bytes),
        'x-session-id': other,
      },
    });
    expect(res.status).toBe(200);
    expect([...h.evidence.objects.keys()]).toEqual([startPhotoKey(ORG, SESSION)]);
  });

  it('no token is 401 and nothing is called or stored', async () => {
    const h = await createHarness();
    const bytes = jpeg(640, 480);
    const res = await h.request('PUT', '/v1/lobby/photo', {
      body: bytes,
      headers: { 'content-type': 'image/jpeg', 'x-photo-sha256': await sha256HexBytes(bytes) },
    });
    expect(res.status).toBe(401);
    expect(h.calls).toEqual([]);
    expect(h.evidence.objects.size).toBe(0);
  });

  it('a failed R2 put is 503 and gives its slot back (SEC-4)', async () => {
    const h = await createHarness();
    const token = await h.login();
    const put = h.evidence.bucket.put.bind(h.evidence.bucket);
    let failures = 2;
    h.evidence.bucket.put = async (...args: Parameters<typeof put>) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('r2 down');
      }
      return put(...args);
    };
    expect((await upload(h, token, jpeg(640, 480))).status).toBe(503);
    expect((await upload(h, token, jpeg(640, 480))).status).toBe(503);
    expect(h.evidence.objects.size).toBe(0);
    for (let n = 1; n <= 3; n += 1) {
      expect((await upload(h, token, jpeg(640, 480, 64 + n))).status).toBe(200);
      expect([...h.evidence.objects.values()][0]?.customMetadata?.n).toBe(String(n));
    }
    expect((await upload(h, token, jpeg(640, 480))).status).toBe(429);
  });

  it('a missing EVIDENCE binding is 503 and uses no slot', async () => {
    const h = await createHarness();
    const token = await h.login();
    (h.env as unknown as Record<string, unknown>).EVIDENCE = undefined;
    expect((await upload(h, token, jpeg(640, 480))).status).toBe(503);
    expect(h.otp.cores.values().next().value?.takePhotoSlot()).toEqual({ ok: true, n: 1 });
  });
});

describe('PUT /v1/lobby/photo after session start (SEC-1)', () => {
  /** No photo slot was ever written in the invitation's object. */
  const noSlotUsed = (h: Harness) =>
    expect(h.otp.kvs.get(INVITATION)?.get('photo:uploads')).toBeUndefined();

  it('every byte check runs before photoPermit: a bad body never reaches api', async () => {
    const h = await createHarness();
    const token = await h.login();
    const good = jpeg(640, 480);
    const cases: [Uint8Array, { sha?: string }][] = [
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), {}],
      [jpeg(100, 100), {}],
      [new Uint8Array([...good, 0x41]), {}],
      [good, { sha: 'c'.repeat(64) }],
    ];
    for (const [bytes, opts] of cases) {
      expect((await upload(h, token, bytes, opts)).status).toBeGreaterThanOrEqual(400);
    }
    expect(h.calls.some((c) => c.method === 'photoPermit')).toBe(false);
    expect(h.evidence.objects.size).toBe(0);
    noSlotUsed(h);
  });

  it('after closePhotos an upload is 410 closed: nothing stored, no slot used', async () => {
    const h = await createHarness();
    const token = await h.login();
    h.otp.cores.get(INVITATION)?.closePhotos();
    const res = await upload(h, token, jpeg(640, 480));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'closed' });
    expect(h.evidence.objects.size).toBe(0);
    noSlotUsed(h);
  });

  it('a slow upload that started before session start cannot land after it (closed mid-body)', async () => {
    const h = await createHarness();
    const token = await h.login();
    const bytes = jpeg(640, 480);
    let releaseRest!: () => void;
    const rest = new Promise<void>((resolve) => (releaseRest = resolve));
    let signalReading!: () => void;
    const reading = new Promise<void>((resolve) => (signalReading = resolve));
    let pulls = 0;
    // highWaterMark 0: a chunk is produced only when the route reads, so `reading` means the route got past auth.
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(bytes.slice(0, 16));
            signalReading();
            return;
          }
          await rest;
          controller.enqueue(bytes.slice(16));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const pending = h.request('PUT', '/v1/lobby/photo', {
      token,
      body,
      headers: {
        'content-type': 'image/jpeg',
        'content-length': String(bytes.length),
        'x-photo-sha256': await sha256HexBytes(bytes),
      },
    });
    await reading;
    // The route is past lobby auth (the photo limit counted this request) and is reading the body now.
    expect(h.otp.kvs.get(INVITATION)?.get('rate:photo')).toMatchObject({ n: 1 });
    // Session start (stream C1b) closes the photo step while the body is still arriving.
    h.otp.cores.get(INVITATION)?.closePhotos();
    releaseRest();
    const res = await pending;
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'closed' });
    expect(h.evidence.objects.size).toBe(0);
    noSlotUsed(h);
  });
});
