// Item images for a package v2 session (specs/m1-test-authoring.md §6.5, E25; R2-17, R5-10, R5-56 a, AT-M1-23):
// `GET /v1/session/media/:hash` with the session Bearer token. The session comes from the token's verified claims only
// (never the URL). The invitation's SessionDO decides: the hash must be in the media list of an item it has served and
// would serve now, and it answers the package's own object path (`item-media/<org>/<hash>.<ext>`; a library copy keeps
// the library org's prefix, so the path is never rebuilt from the session's org). The edge then reads exactly that
// object from the item image bucket (read only: get), checks that the bytes hash to the requested hash, and answers
// them with the stored extension's content type and `cache-control: no-store`; the candidate app shows them as a
// `data:` URL, so the candidate CSP is unchanged. Every refusal for a valid token (malformed, unknown, unserved,
// closed section, finished session, missing or mismatched object) is the same 404 `invalid_link`, so nothing tells
// those cases apart. The object path, the org and the extension never reach the candidate. Nothing here logs.
import { NO_STORE } from '@trace/workers-http';
import type { Hono } from 'hono';
import { sha256HexBytes } from './encoding.js';
import { fail, handle, type EdgeContext, type EdgeEnv } from './http.js';
import { otpCall } from './route-support.js';
import type { SessionApi, SessionAuth } from './session-core.js';

/** Item images are at most 1 MiB (the import cap, contracts-m1 IMPORT_IMAGE_MAX_BYTES; R5-55 d). */
export const ITEM_IMAGE_MAX_BYTES = 1_048_576;

const HASH = /^[0-9a-f]{64}$/;

/** The one answer for every refused image (E25: indistinguishable from a missing one). */
const notFound = (): never => fail('invalid_link');

/** Verifies the session token and finds the invitation's SessionDO (routes-session.ts provides it). */
export type SessionAuthenticator = (
  c: EdgeContext,
) => Promise<{ session: SessionApi; auth: SessionAuth }>;

export const mountItemMediaRoute = (
  app: Hono<EdgeEnv>,
  authenticate: SessionAuthenticator,
): void => {
  app.get(
    '/v1/session/media/:hash',
    handle(async (c) => {
      const { session, auth } = await authenticate(c);
      const hash = c.req.param('hash') ?? '';
      if (!HASH.test(hash)) return notFound();
      const allowed = await otpCall(() => session.media(auth, hash));
      if (!allowed.ok) return fail(allowed.error, allowed.retryAfterSeconds);
      let object: R2ObjectBody | null | undefined;
      try {
        object = await c.env.ITEM_MEDIA?.get(allowed.objectPath);
      } catch {
        return fail('unavailable');
      }
      if (object === undefined) return fail('unavailable');
      if (object === null || object.size > ITEM_IMAGE_MAX_BYTES) return notFound();
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await object.arrayBuffer());
      } catch {
        return fail('unavailable');
      }
      if (bytes.byteLength > ITEM_IMAGE_MAX_BYTES || (await sha256HexBytes(bytes)) !== hash) {
        return notFound();
      }
      return new Response(bytes, {
        status: 200,
        headers: {
          'content-type': allowed.contentType,
          'content-length': String(bytes.byteLength),
          'x-content-type-options': 'nosniff',
          ...NO_STORE,
        },
      });
    }),
  );
};
