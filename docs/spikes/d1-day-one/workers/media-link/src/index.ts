// DC-D5 spike: a Worker-proxied, short-lived, single-use media link (specs/d1-demo-slice.md section 6.2 "Media link",
// R3-1..R3-9). No Postgres here: the MediaLinkDO record stands in for the grant, `deps.viewGrant` stands in for
// private.media_view_grant. Everything the spike must prove is real: the R2 binding stream, the HMAC with
// crypto.subtle.verify, the atomic burn in a SQLite-backed Durable Object, CORS and the response headers.
//
// The /_spike/* routes exist only when env.SPIKE_ROUTES === '1' (tests and wrangler dev). They are NOT part of the
// design: in D1 the issue endpoint sits behind the api's JWT verification and the DB grant, and seeding is a deploy step.
import { DurableObject } from 'cloudflare:workers';

export const TTL_SECONDS = 300;
const CLEANUP_GRACE_SECONDS = 60;
const SIG_VERSION = 'v1';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes of base64url, no padding
const EXP_RE = /^[1-9][0-9]{0,11}$/; // canonical integer seconds

export interface LinkRecord {
  mediaId: string;
  orgId: string;
  viewerUserId: string;
  aal: 'aal1' | 'aal2';
  amr: string[];
  r2Key: string;
  exp: number;
}

interface R2ObjectBodyLike {
  body: ReadableStream<Uint8Array>;
  size: number;
}

export interface Env {
  MEDIA_BUCKET: { get(key: string): Promise<R2ObjectBodyLike | null> };
  MEDIA_LINK_DO: {
    idFromName(name: string): unknown;
    get(id: unknown): {
      create(rec: LinkRecord, nowS: number): Promise<boolean>;
      burn(nowS: number): Promise<LinkRecord | null>;
    };
  };
  MEDIA_LINK_HMAC_KEY: string;
  ALLOWED_ORIGINS: string;
  SPIKE_ROUTES?: string;
}

export interface Deps {
  now(): number;
  /** Stand-in for private.media_view_grant: returns the R2 key to stream. Runs after the burn (R3-4). */
  viewGrant(rec: LinkRecord): Promise<string>;
}

// ---------------------------------------------------------------------------------------------------------------
// base64url and HMAC-SHA-256 over the versioned, domain-separated string `v1|jti|exp` (R3-4)
// ---------------------------------------------------------------------------------------------------------------
const toB64u = (bytes: ArrayBuffer | Uint8Array): string => {
  let s = '';
  for (const b of bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) {
    s += String.fromCharCode(b);
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = (s: string): Uint8Array =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0));

let keyCache: { secret: string; key: CryptoKey } | undefined;
async function hmacKey(secret: string): Promise<CryptoKey> {
  if (keyCache?.secret === secret) return keyCache.key;
  const raw = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
  if (raw.length < 32) throw new Error('MEDIA_LINK_HMAC_KEY must hold at least 32 bytes');
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
  keyCache = { secret, key };
  return key;
}
const sigInput = (jti: string, exp: number): Uint8Array =>
  new TextEncoder().encode(`${SIG_VERSION}|${jti}|${exp}`);

export async function signLink(secret: string, jti: string, exp: number): Promise<string> {
  const key = await hmacKey(secret);
  return toB64u(await crypto.subtle.sign('HMAC', key, sigInput(jti, exp)));
}

/** Constant-time by construction: crypto.subtle.verify, never a string comparison of two signatures. */
async function verifyLink(secret: string, jti: string, exp: number, sig: string): Promise<boolean> {
  if (!SIG_RE.test(sig)) return false;
  const bytes = fromB64u(sig);
  if (toB64u(bytes) !== sig) return false; // reject non-canonical trailing bits
  const key = await hmacKey(secret);
  return crypto.subtle.verify('HMAC', key, bytes, sigInput(jti, exp));
}

// ---------------------------------------------------------------------------------------------------------------
// MediaLinkDO: one instance per jti, SQLite-backed. The burn is ONE statement (UPDATE ... RETURNING) and the method
// has no await between the read and the write, so it is atomic under any number of concurrent fetches.
// ---------------------------------------------------------------------------------------------------------------
export class MediaLinkDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env as never);
    this.ensureSchema();
  }

  // Called by every method: deleteAll() in alarm() removes the tables, and the instance may outlive that.
  private ensureSchema() {
    this.ctx.storage.sql.exec(
      `create table if not exists link (
         id integer primary key check (id = 1),
         media_id text not null, org_id text not null, viewer_user_id text not null,
         aal text not null check (aal in ('aal1', 'aal2')), amr text not null,
         r2_key text not null, exp integer not null,
         state text not null check (state in ('open', 'burnt')),
         created_at integer not null, burnt_at integer
       )`,
    );
  }

  async create(rec: LinkRecord, nowS: number): Promise<boolean> {
    this.ensureSchema();
    const cur = this.ctx.storage.sql.exec(
      `insert into link (id, media_id, org_id, viewer_user_id, aal, amr, r2_key, exp, state, created_at)
       values (1, ?, ?, ?, ?, ?, ?, ?, 'open', ?) on conflict (id) do nothing`,
      rec.mediaId,
      rec.orgId,
      rec.viewerUserId,
      rec.aal,
      JSON.stringify(rec.amr),
      rec.r2Key,
      rec.exp,
      nowS,
    );
    cur.toArray();
    const inserted = cur.rowsWritten === 1;
    if (inserted) await this.ctx.storage.setAlarm((rec.exp + CLEANUP_GRACE_SECONDS) * 1000);
    return inserted;
  }

  async burn(nowS: number): Promise<LinkRecord | null> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql
      .exec(
        `update link set state = 'burnt', burnt_at = ?
         where id = 1 and state = 'open' and exp >= ?
         returning media_id, org_id, viewer_user_id, aal, amr, r2_key, exp`,
        nowS,
        nowS,
      )
      .toArray();
    const r = rows[0];
    if (!r) return null;
    return {
      mediaId: r['media_id'] as string,
      orgId: r['org_id'] as string,
      viewerUserId: r['viewer_user_id'] as string,
      aal: r['aal'] as 'aal1' | 'aal2',
      amr: JSON.parse(r['amr'] as string) as string[],
      r2Key: r['r2_key'] as string,
      exp: r['exp'] as number,
    };
  }

  // Housekeeping only: a replay after this is still 404 (the Worker refuses an expired exp before the DO, and an
  // empty DO has no open row).
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------------------------------------------
const keyAllowed = (key: string, orgId: string): boolean =>
  key.startsWith(`media/${orgId}/`) && key.endsWith('/start_photo.jpg') && !key.includes('..');

interface SpikeCfg {
  allowedOrigins: string[] | null;
  corp: string | null;
}

export function createHandler(depsIn: Partial<Deps> = {}) {
  const deps: Deps = {
    now: () => Date.now(),
    viewGrant: async (rec) => rec.r2Key,
    ...depsIn,
  };
  const cfg: SpikeCfg = { allowedOrigins: null, corp: 'same-origin' };
  // Spike-only evidence about what the browser sent. Never holds a jti, sig or key (R3-6).
  const seen: Array<Record<string, string | number | boolean | null>> = [];

  const baseHeaders = (req: Request, env: Env): Headers => {
    const h = new Headers({
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      vary: 'Origin',
    });
    if (cfg.corp) h.set('cross-origin-resource-policy', cfg.corp);
    const origin = req.headers.get('origin');
    const allowed = cfg.allowedOrigins ?? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    // Exact origin, never "*", never a credentials header (R3-6).
    if (origin && allowed.includes(origin)) h.set('access-control-allow-origin', origin);
    return h;
  };

  // R3-5: every failure is this one response.
  const notFound = (req: Request, env: Env): Response => {
    const h = baseHeaders(req, env);
    h.set('content-type', 'application/json');
    return new Response(JSON.stringify({ error: { code: 'not_found' } }), {
      status: 404,
      headers: h,
    });
  };

  async function media(req: Request, env: Env, url: URL): Promise<Response> {
    const spike = env.SPIKE_ROUTES === '1';
    const note = (status: number) => {
      if (!spike) return;
      seen.push({
        method: req.method,
        status,
        origin: req.headers.get('origin'),
        hasReferer: req.headers.has('referer'),
        hasAuthorization: req.headers.has('authorization'),
        hasCookie: req.headers.has('cookie'),
        secFetchSite: req.headers.get('sec-fetch-site'),
        secFetchMode: req.headers.get('sec-fetch-mode'),
        secFetchDest: req.headers.get('sec-fetch-dest'),
      });
    };
    const fail = () => {
      note(404);
      return notFound(req, env);
    };

    // A HEAD or a preflight must never burn a link, so only GET gets past this line.
    if (req.method !== 'GET') return fail();

    const jti = url.pathname.slice('/media/'.length);
    if (!UUID_V4.test(jti)) return fail();
    const keys = [...url.searchParams.keys()].sort().join(',');
    if (keys !== 'exp,sig') return fail(); // exactly one exp and one sig, nothing else
    const expRaw = url.searchParams.get('exp') ?? '';
    const sig = url.searchParams.get('sig') ?? '';
    if (!EXP_RE.test(expRaw)) return fail();
    const exp = Number(expRaw);

    // R3-4: refuse exp < now and exp > now + 300 before any I/O.
    const nowS = Math.floor(deps.now() / 1000);
    if (exp < nowS || exp > nowS + TTL_SECONDS) return fail();
    if (!(await verifyLink(env.MEDIA_LINK_HMAC_KEY, jti, exp, sig))) return fail();

    // Burn atomically BEFORE the grant and before R2; the DO also checks its own record's exp.
    const stub = env.MEDIA_LINK_DO.get(env.MEDIA_LINK_DO.idFromName(jti));
    const rec = await stub.burn(nowS);
    if (!rec) return fail();
    if (!keyAllowed(rec.r2Key, rec.orgId)) return fail();

    let key: string;
    try {
      key = await deps.viewGrant(rec);
    } catch {
      return fail();
    }
    if (!keyAllowed(key, rec.orgId)) return fail(); // R3-3: stream only a key under media/<org>/ ending start_photo.jpg

    const obj = await env.MEDIA_BUCKET.get(key);
    if (!obj) return fail();

    const h = baseHeaders(req, env);
    h.set('content-type', 'image/jpeg');
    h.set('content-length', String(obj.size));
    note(200);
    // The R2 body is a ReadableStream: hand it to Response as is, never arrayBuffer()/text()/tee().
    return new Response(obj.body, { status: 200, headers: h });
  }

  async function spikeRoute(req: Request, env: Env, url: URL): Promise<Response> {
    const json = (x: unknown, status = 200) =>
      new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
    switch (url.pathname) {
      case '/_spike/issue': {
        const body = (await req.json()) as Omit<LinkRecord, 'exp'>;
        const jti = crypto.randomUUID();
        const nowS = Math.floor(deps.now() / 1000);
        const exp = nowS + TTL_SECONDS;
        const stub = env.MEDIA_LINK_DO.get(env.MEDIA_LINK_DO.idFromName(jti));
        await stub.create({ ...body, exp }, nowS);
        const sig = await signLink(env.MEDIA_LINK_HMAC_KEY, jti, exp);
        return json({ url: `${url.origin}/media/${jti}?exp=${exp}&sig=${sig}`, expiresAt: exp });
      }
      case '/_spike/seed': {
        const key = url.searchParams.get('key') ?? '';
        const bucket = env.MEDIA_BUCKET as unknown as {
          put(k: string, v: ArrayBuffer, o: unknown): Promise<unknown>;
        };
        await bucket.put(key, await req.arrayBuffer(), {
          httpMetadata: { contentType: 'image/jpeg' },
        });
        return json({ seeded: key });
      }
      case '/_spike/config': {
        const body = (await req.json()) as Partial<SpikeCfg>;
        if ('allowedOrigins' in body) cfg.allowedOrigins = body.allowedOrigins ?? null;
        if ('corp' in body) cfg.corp = body.corp ?? null;
        return json(cfg);
      }
      case '/_spike/stats': {
        const out = [...seen];
        if (url.searchParams.get('reset') === '1') seen.length = 0;
        return json(out);
      }
      default:
        return json({ error: { code: 'not_found' } }, 404);
    }
  }

  return {
    async fetch(req: Request, env: Env): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === '/health')
        return new Response('ok', { headers: { 'cache-control': 'no-store' } });
      if (url.pathname.startsWith('/media/')) return media(req, env, url);
      if (url.pathname.startsWith('/_spike/') && env.SPIKE_ROUTES === '1')
        return spikeRoute(req, env, url);
      return notFound(req, env);
    },
  };
}

const handler = createHandler();
export default {
  fetch: (req: Request, env: Env) => handler.fetch(req, env),
};
