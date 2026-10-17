// Media routes (spec §6.2 table rows `start-photo-link` and `GET /media/:jti`; R3-5, R3-6). The lead mounts them with
// `app.route('/', createMediaRoutes({ org, media: mediaFromEnv }))`. The fetch route answers every method but GET with the generic 404 before any DO
// call (it never burns a link), and every answer carries no-store, no-referrer, nosniff, CORP same-origin,
// Vary: Origin and, for an allowed origin only, that exact ACAO with no credentials header.
import { MediaLinkResponse } from '@trace/shared/contracts/d1';
import { Hono } from 'hono';
import { openApiDb } from '../candidate/api-db.js';
import { handleOrg, orgFail, orgJson, pathId, type OrgDeps } from '../tests/org-context.js';
import type { LinkRecord } from './link-store.js';
import {
  fetchStartPhoto,
  importHmacKey,
  issueStartPhotoLink,
  type LinkClient,
  type MediaDeps,
} from './media-link.js';

export interface MediaCall {
  deps: MediaDeps;
  close(): Promise<void>;
}

export interface MediaRouteDeps {
  org: OrgDeps;
  /** Builds the media deps from the env, or null when a binding or secret is missing. */
  media(env: Env): Promise<MediaCall | null>;
}

/** The DO RPC surface MediaLinkDO implements; the generated Env still types the Wave 0 stub (lead request). */
interface LinkStub {
  issue(jti: string, record: LinkRecord): Promise<void> | void;
  burn(jti: string, nowSec: number): Promise<LinkRecord | null> | LinkRecord | null;
  allowIssue(nowSec: number): Promise<boolean> | boolean;
}
interface LinkNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): LinkStub;
}

export const linkClient = (ns: LinkNamespace): LinkClient => ({
  issue: async (jti, record) => {
    await ns.get(ns.idFromName(jti)).issue(jti, record);
  },
  burn: async (jti, nowSec) => await ns.get(ns.idFromName(jti)).burn(jti, nowSec),
  allowIssue: async (viewer, nowSec) =>
    await ns.get(ns.idFromName(`viewer:${viewer}`)).allowIssue(nowSec),
});

/** Production deps: API_DB_URL, MEDIA_LINK_HMAC_KEY, MEDIA_LINKS and EVIDENCE must all be bound. */
export const mediaFromEnv = async (env: Env): Promise<MediaCall | null> => {
  const secret = env.MEDIA_LINK_HMAC_KEY;
  const ns = env.MEDIA_LINKS as unknown as LinkNamespace | undefined;
  const bucket = env.EVIDENCE;
  if (secret === undefined || ns === undefined || bucket === undefined) return null;
  let hmacKey: CryptoKey;
  try {
    hmacKey = await importHmacKey(secret);
  } catch {
    return null;
  }
  const handle = openApiDb(env.API_DB_URL);
  if (handle === null) return null;
  return {
    deps: {
      db: handle.db,
      links: linkClient(ns),
      evidence: {
        get: async (key) => {
          const object = await bucket.get(key);
          return object === null ? null : { body: object.body, size: object.size };
        },
      },
      hmacKey,
      now: () => Date.now(),
      newId: () => crypto.randomUUID(),
    },
    close: () => handle.close(),
  };
};

export const allowedOrigins = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => /^https?:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/.test(o));

/** The headers of every /media answer, 200 or 404 (R3-6). */
export const mediaHeaders = (request: Request, env: Env): Headers => {
  const headers = new Headers({
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    vary: 'Origin',
  });
  const origin = request.headers.get('origin');
  if (origin !== null && allowedOrigins(env.ALLOWED_ORIGINS).includes(origin)) {
    headers.set('access-control-allow-origin', origin);
  }
  return headers;
};

const mediaNotFound = (request: Request, env: Env): Response => {
  const headers = mediaHeaders(request, env);
  headers.set('content-type', 'application/json');
  return new Response('{"error":{"code":"not_found"}}', { status: 404, headers });
};

export const START_PHOTO_LINK_PATH = '/v1/orgs/:orgId/reports/:reportId/start-photo-link';
export const MEDIA_PATH = '/media/:jti';

export const createMediaRoutes = (deps: MediaRouteDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();
  app.post(START_PHOTO_LINK_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const reportId = pathId(c.req.param('reportId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      const call = await deps.media(c.env);
      if (call === null) return orgFail('unavailable');
      try {
        const link = await issueStartPhotoLink(call.deps, {
          caller: ctx.caller,
          rest: ctx.rest,
          orgId,
          reportId,
          origin: new URL(c.req.url).origin,
        });
        return orgJson(MediaLinkResponse.parse(link));
      } catch (err) {
        if (err instanceof Error && err.message === 'rate_limited') return orgFail('rate_limited');
        return orgFail('not_found');
      } finally {
        await call.close();
      }
    }),
  );

  app.all(MEDIA_PATH, async (c) => {
    if (c.req.method !== 'GET') return mediaNotFound(c.req.raw, c.env);
    const call = await deps.media(c.env);
    if (call === null) return mediaNotFound(c.req.raw, c.env);
    try {
      const photo = await fetchStartPhoto(call.deps, {
        jti: c.req.param('jti'),
        exp: c.req.query('exp'),
        sig: c.req.query('sig'),
      });
      if (photo === null) return mediaNotFound(c.req.raw, c.env);
      const headers = mediaHeaders(c.req.raw, c.env);
      headers.set('content-type', 'image/jpeg');
      headers.set('content-length', String(photo.size));
      return new Response(photo.body, { status: 200, headers });
    } catch {
      return mediaNotFound(c.req.raw, c.env);
    } finally {
      await call.close();
    }
  });
  return app;
};
