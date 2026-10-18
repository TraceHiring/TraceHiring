// PUT /v1/lobby/photo (specs/d1-demo-slice.md §4.5, rule 8): the one processed, blurred-on-device JPEG of the start
// photo step. Edge, in this order: lobby token, nonce and limit; raw `image/jpeg` only, at most 512 000 bytes, magic
// `FF D8 FF`, a clean header (jpeg.ts), 160-1280 px per side, `X-Photo-Sha256` equal to the body's SHA-256; then api
// `photoPermit` (needs the consent row; `locked` once the session started); then one of at most 3 uploads per session
// (counted in InviteOtpDO, the number also stored as `n`; `closed` once session start called `closePhotos`). The key is
// deterministic, so a retake overwrites. R2 write only, no Postgres write. The bytes are never logged.
import { PhotoRes } from '@trace/shared/contracts/candidate';
import type { Hono } from 'hono';
import { sha256HexBytes } from './encoding.js';
import {
  capBody,
  fail,
  handle,
  PHOTO_BODY_LIMIT,
  sendJson,
  type EdgeContext,
  type EdgeEnv,
} from './http.js';
import { hasJpegMagic, jpegDimensions } from './jpeg.js';
import { lobbyAuth, otpCall, otpFor, rpc, type RouteDeps } from './route-support.js';

export const PHOTO_MIN_SIDE = 160;
export const PHOTO_MAX_SIDE = 1280;

/** The deterministic R2 key of a session's start photo (§4.5). Both ids come from api, never from the request. */
export const startPhotoKey = (orgId: string, sessionId: string): string =>
  `media/${orgId}/${sessionId}/start_photo.jpg`;

const isJpegType = (c: EdgeContext): boolean =>
  /^image\/jpeg$/i.test((c.req.header('content-type') ?? '').trim());

export const mountPhotoRoute = (app: Hono<EdgeEnv>, deps: RouteDeps): void => {
  app.put(
    '/v1/lobby/photo',
    capBody(PHOTO_BODY_LIMIT),
    handle(async (c) => {
      const { lobbyToken, claims } = await lobbyAuth(c, deps, 'photo');
      if (!isJpegType(c)) return fail('bad_media');
      const declared = c.req.header('x-photo-sha256') ?? '';
      if (!/^[0-9a-f]{64}$/.test(declared)) return fail('bad_request');

      // The whole body is read and checked before api is asked (SEC-1): a slow upload learns `locked` only after its
      // last byte, and the object's slot (closed at session start) is the final gate.
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.length === 0) return fail('bad_request');
      if (bytes.length > PHOTO_BODY_LIMIT) return fail('too_large');
      if (!hasJpegMagic(bytes)) return fail('bad_media');
      const size = jpegDimensions(bytes);
      if (
        size === null ||
        size.width < PHOTO_MIN_SIDE ||
        size.width > PHOTO_MAX_SIDE ||
        size.height < PHOTO_MIN_SIDE ||
        size.height > PHOTO_MAX_SIDE
      ) {
        return fail('bad_media');
      }
      const sha256 = await sha256HexBytes(bytes);
      if (sha256 !== declared) return fail('bad_request');

      const permit = await rpc(c, deps, 'photoPermit', { lobbyToken });
      if (permit.locked) return fail('closed');
      const evidence = c.env.EVIDENCE;
      if (evidence === undefined) return fail('unavailable');
      const otp = otpFor(c, claims.invitation_id);
      const slot = await otpCall(() => otp.takePhotoSlot());
      // A used-up cap is permanent for the session, so the 429 carries no Retry-After (SR-4).
      if (!slot.ok) return fail(slot.error);
      try {
        await evidence.put(startPhotoKey(permit.orgId, permit.sessionId), bytes, {
          httpMetadata: { contentType: 'image/jpeg' },
          customMetadata: { sha256, blurred: '1', n: String(slot.n) },
        });
      } catch {
        return fail('unavailable');
      }
      return sendJson(c, PhotoRes, { sha256, bytes: bytes.length });
    }),
  );
};
