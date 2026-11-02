// DC-D5 (a) and (b): the media Worker inside workerd with a real R2 binding and a real SQLite Durable Object.
// Synthetic data only. The HMAC key comes from vitest.config.ts (generated at run time) via env.MEDIA_LINK_HMAC_KEY.
import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHandler,
  signLink,
  TTL_SECONDS,
  type Env,
  type LinkRecord,
} from '../workers/media-link/src/handler.ts';

const ORIGIN = 'https://recruiter.synthetic.example';
const ORG = 'org-synthetic-1';
const KEY = `media/${ORG}/sess-1/start_photo.jpg`;
const MEDIA = '00000000-0000-4000-8000-000000000001';
const VIEWER = '00000000-0000-4000-8000-0000000000aa';
const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);

const rawEnv = env as unknown as Env & {
  MEDIA_BUCKET: { put(k: string, v: ArrayBuffer | Uint8Array, o?: unknown): Promise<unknown> };
};
const SECRET = rawEnv.MEDIA_LINK_HMAC_KEY;

const record = (over: Partial<Omit<LinkRecord, 'exp'>> = {}): Omit<LinkRecord, 'exp'> => ({
  mediaId: MEDIA,
  orgId: ORG,
  viewerUserId: VIEWER,
  aal: 'aal2',
  amr: ['totp'],
  r2Key: KEY,
  ...over,
});

interface Harness {
  calls: { r2Get: string[]; doGet: number; viewGrant: LinkRecord[] };
  now: { ms: number };
  get(url: string, headers?: Record<string, string>, method?: string): Promise<Response>;
  issue(over?: Partial<Omit<LinkRecord, 'exp'>>): Promise<string>;
  reset(): void;
}

/** A handler wired to the real bindings through counting wrappers (the spy on the R2 get and the DO get). */
function harness(
  opts: { bucket?: Env['MEDIA_BUCKET']; viewGrant?: (r: LinkRecord) => Promise<string> } = {},
): Harness {
  const calls: Harness['calls'] = { r2Get: [], doGet: 0, viewGrant: [] };
  const now = { ms: T0 };
  const real = rawEnv.MEDIA_BUCKET as unknown as Env['MEDIA_BUCKET'];
  const bucket = opts.bucket ?? real;
  const e: Env = {
    MEDIA_BUCKET: {
      get: (k: string) => {
        calls.r2Get.push(k);
        return bucket.get(k);
      },
    },
    MEDIA_LINK_DO: {
      idFromName: (n: string) => rawEnv.MEDIA_LINK_DO.idFromName(n),
      get: (id: unknown) => {
        calls.doGet++;
        return rawEnv.MEDIA_LINK_DO.get(id);
      },
    },
    MEDIA_LINK_HMAC_KEY: SECRET,
    ALLOWED_ORIGINS: ORIGIN,
    SPIKE_ROUTES: '1',
  };
  const handler = createHandler({
    now: () => now.ms,
    viewGrant: async (r) => {
      calls.viewGrant.push(r);
      return opts.viewGrant ? opts.viewGrant(r) : r.r2Key;
    },
  });
  const h: Harness = {
    calls,
    now,
    get: (url, headers = {}, method = 'GET') =>
      handler.fetch(new Request(url, { method, headers }), e),
    async issue(over = {}) {
      const res = await handler.fetch(
        new Request('https://media.synthetic.example/_spike/issue', {
          method: 'POST',
          body: JSON.stringify(record(over)),
        }),
        e,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string; expiresAt: number };
      expect(body.expiresAt).toBe(Math.floor(now.ms / 1000) + TTL_SECONDS);
      return body.url;
    },
    reset() {
      calls.r2Get.length = 0;
      calls.doGet = 0;
      calls.viewGrant.length = 0;
    },
  };
  return h;
}

const bytes = (n: number, seed = 7): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

async function seed(key = KEY, n = 4096): Promise<Uint8Array> {
  const b = bytes(n);
  await rawEnv.MEDIA_BUCKET.put(key, b, { httpMetadata: { contentType: 'image/jpeg' } });
  return b;
}

const jtiOf = (url: string): string => new URL(url).pathname.slice('/media/'.length);
const doStub = (jti: string) => rawEnv.MEDIA_LINK_DO.get(rawEnv.MEDIA_LINK_DO.idFromName(jti));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DC-D5 (a) Worker-proxied link streams from the R2 binding', () => {
  it('serves the bytes with no-store, image/jpeg and the full header set (real R2 binding)', async () => {
    const body = await seed();
    const h = harness();
    const url = await h.issue();
    const res = await h.get(url, { origin: ORIGIN });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('vary')).toBe('Origin');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(res.headers.get('content-length')).toBe(String(body.length));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(body);
    expect(h.calls.r2Get).toEqual([KEY]);
  });

  it('gives no ACAO to an origin that is not allowed, and none without an Origin header', async () => {
    await seed();
    const h = harness();
    const a = await h.get(await h.issue(), { origin: 'https://evil.synthetic.example' });
    expect(a.status).toBe(200);
    expect(a.headers.get('access-control-allow-origin')).toBeNull();
    expect(a.headers.get('vary')).toBe('Origin');
    await a.arrayBuffer();
    const b = await h.get(await h.issue());
    expect(b.headers.get('access-control-allow-origin')).toBeNull();
    await b.arrayBuffer();
  });

  it('streams the R2 body: the response exists after at most a few chunks, not after all of them', async () => {
    const CHUNK = 64 * 1024;
    const N = 64;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (pulls >= N) {
          c.close();
          return;
        }
        pulls++;
        c.enqueue(new Uint8Array(CHUNK).fill(pulls & 0xff));
      },
    });
    const fake: Env['MEDIA_BUCKET'] = {
      get: async (k) => (k === KEY ? { body, size: N * CHUNK } : null),
    };
    const h = harness({ bucket: fake });
    const res = await h.get(await h.issue());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(N * CHUNK));
    const pullsAtHeaders = pulls;
    expect(pullsAtHeaders).toBeLessThan(8); // a buffering Worker (arrayBuffer/text/tee) would have pulled all 64
    const total = (await res.arrayBuffer()).byteLength;
    expect(total).toBe(N * CHUNK);
    expect(pulls).toBeGreaterThanOrEqual(N);
    console.log(
      `DC-D5 stream: pulls at response headers=${pullsAtHeaders} of ${N}, bytes=${total}`,
    );
  });

  it('is a plain ReadableStream pass-through (the body is the R2 object body itself)', async () => {
    await seed();
    const h = harness();
    const res = await h.get(await h.issue());
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(res.bodyUsed).toBe(false);
    await res.arrayBuffer();
  });
});

describe('DC-D5 (b) atomic single-use burn in the SQLite MediaLinkDO', () => {
  it('25 concurrent fetches of one link: exactly one 200, the rest 404, a later fetch 404', async () => {
    await seed();
    const rounds: string[] = [];
    for (let round = 0; round < 5; round++) {
      const h = harness();
      const url = await h.issue();
      h.reset();
      const res = await Promise.all(Array.from({ length: 25 }, () => h.get(url)));
      const statuses = res.map((r) => r.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 404)).toHaveLength(24);
      await Promise.all(res.map((r) => r.arrayBuffer()));
      expect(h.calls.r2Get).toHaveLength(1); // 24 losers never reach R2
      expect(h.calls.viewGrant).toHaveLength(1); // nor the (stand-in) DB grant
      expect((await h.get(url)).status).toBe(404);
      expect((await h.get(url)).status).toBe(404);
      expect(h.calls.r2Get).toHaveLength(1);
      rounds.push(
        `${statuses.filter((s) => s === 200).length}x200/${statuses.filter((s) => s === 404).length}x404`,
      );
    }
    console.log(`DC-D5 burn (5 rounds, 25 concurrent each): ${rounds.join(', ')}`);
  });

  it('the DO method itself is atomic: 25 concurrent burn() calls return exactly one record', async () => {
    const jti = crypto.randomUUID();
    const stub = doStub(jti);
    const nowS = Math.floor(T0 / 1000);
    expect(await stub.create({ ...record(), exp: nowS + TTL_SECONDS }, nowS)).toBe(true);
    expect(await stub.create({ ...record(), exp: nowS + 1 }, nowS)).toBe(false); // create is once-only
    const out = await Promise.all(Array.from({ length: 25 }, () => stub.burn(nowS)));
    expect(out.filter((r) => r !== null)).toHaveLength(1);
    expect(out.find((r) => r !== null)).toEqual({ ...record(), exp: nowS + TTL_SECONDS });
    expect(await stub.burn(nowS)).toBeNull();
  });

  it('the record keeps exactly the verified viewer, aal and amr, and the grant sees them', async () => {
    await seed();
    const h = harness();
    const url = await h.issue({ aal: 'aal1', amr: ['otp'], viewerUserId: VIEWER });
    h.reset();
    const res = await h.get(url);
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    expect(h.calls.viewGrant).toEqual([
      { ...record({ aal: 'aal1', amr: ['otp'] }), exp: Math.floor(T0 / 1000) + TTL_SECONDS },
    ]);
  });

  it('a replay of a used link is the same 404 and never reaches R2 or the grant again', async () => {
    await seed();
    const h = harness();
    const url = await h.issue();
    h.reset();
    const first = await h.get(url);
    await first.arrayBuffer();
    expect(first.status).toBe(200);
    const replay = await h.get(url);
    expect(replay.status).toBe(404);
    expect(h.calls.r2Get).toHaveLength(1);
    expect(h.calls.viewGrant).toHaveLength(1);
  });

  it('a HEAD, a POST and a preflight OPTIONS never burn the link', async () => {
    const body = await seed();
    const h = harness();
    const url = await h.issue();
    h.reset();
    for (const method of ['HEAD', 'POST', 'OPTIONS', 'PUT', 'DELETE']) {
      const r = await h.get(url, { origin: ORIGIN }, method);
      expect(r.status).toBe(404);
    }
    expect(h.calls.doGet).toBe(0);
    expect(h.calls.r2Get).toHaveLength(0);
    const ok = await h.get(url);
    expect(ok.status).toBe(200);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(body);
  });

  it('alarm cleanup deletes the record; a late fetch is still 404 and the DO still works afterwards', async () => {
    await seed();
    const h = harness();
    const url = await h.issue();
    const stub = doStub(jtiOf(url));
    h.reset();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const res = await h.get(url);
    expect(res.status).toBe(404);
    expect(h.calls.r2Get).toHaveLength(0);
    // The instance outlived deleteAll(): ensureSchema() recreates the table and create() works again.
    const nowS = Math.floor(T0 / 1000);
    expect(await stub.create({ ...record(), exp: nowS + 5 }, nowS)).toBe(true);
    expect(await stub.burn(nowS)).not.toBeNull();
  });
});

describe('DC-D5 (b) HMAC-SHA-256 link: expiry and tampering never touch R2', () => {
  const rawKey = async (usage: KeyUsage) =>
    crypto.subtle.importKey(
      'raw',
      Uint8Array.from(atob(SECRET), (c) => c.charCodeAt(0)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      [usage],
    );
  const b64u = (b: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(b)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const parts = (url: string) => {
    const u = new URL(url);
    return {
      jti: u.pathname.slice('/media/'.length),
      exp: u.searchParams.get('exp') as string,
      sig: u.searchParams.get('sig') as string,
    };
  };
  const mk = (jti: string, exp: string | number, sig: string) =>
    `https://media.synthetic.example/media/${jti}?exp=${exp}&sig=${sig}`;

  it('verifies with crypto.subtle.verify (not ===) on every well-formed link', async () => {
    await seed();
    const h = harness();
    const url = await h.issue();
    const spy = vi.spyOn(crypto.subtle, 'verify');
    const res = await h.get(url);
    await res.arrayBuffer();
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe('HMAC');
  });

  it('an expired link is 404 and touches neither the DO nor R2; the inclusive boundary is exp', async () => {
    await seed();
    const h = harness();
    const url = await h.issue();
    h.reset();
    h.now.ms = T0 + (TTL_SECONDS + 1) * 1000;
    const late = await h.get(url, { origin: ORIGIN });
    expect(late.status).toBe(404);
    expect(h.calls.r2Get).toHaveLength(0);
    expect(h.calls.doGet).toBe(0);
    expect(h.calls.viewGrant).toHaveLength(0);

    const fresh = await harness();
    const u2 = await fresh.issue();
    fresh.now.ms = T0 + TTL_SECONDS * 1000; // now == exp: still valid
    const edge = await fresh.get(u2);
    expect(edge.status).toBe(200);
    await edge.arrayBuffer();
  });

  it('a validly signed link with exp more than 300 s ahead is refused before any I/O', async () => {
    const h = harness();
    const nowS = Math.floor(T0 / 1000);
    const jti = crypto.randomUUID();
    for (const exp of [nowS + TTL_SECONDS + 1, nowS + 3600, nowS - 1]) {
      const sig = await signLink(SECRET, jti, exp);
      expect((await h.get(mk(jti, exp, sig))).status).toBe(404);
    }
    expect(h.calls.doGet).toBe(0);
    expect(h.calls.r2Get).toHaveLength(0);
  });

  it('tampered, malformed and wrong-domain links are 404, touch neither the DO nor R2, and burn nothing', async () => {
    await seed();
    const h = harness();
    const url = await h.issue();
    const other = await h.issue();
    const { jti, exp, sig } = parts(url);
    const o = parts(other);
    h.now.ms = T0 + 10_000; // exp +/- 1 stay inside the 300 s window, so these reach the HMAC check
    const nowS = Math.floor(h.now.ms / 1000);
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    const v0 = b64u(
      await crypto.subtle.sign(
        'HMAC',
        await rawKey('sign'),
        new TextEncoder().encode(`v0|${jti}|${exp}`),
      ),
    );
    const noJti = b64u(
      await crypto.subtle.sign('HMAC', await rawKey('sign'), new TextEncoder().encode(`${exp}`)),
    );
    const bad: Array<[string, string]> = [
      ['first sig char changed', mk(jti, exp, flip(sig))],
      ['exp + 1 with the old sig', mk(jti, Number(exp) + 1, sig)],
      ['exp - 1 with the old sig', mk(jti, Number(exp) - 1, sig)],
      ['other jti with this sig', mk(o.jti, exp, sig)],
      ['sig of another link', mk(jti, exp, o.sig)],
      ['truncated sig', mk(jti, exp, sig.slice(0, 42))],
      ['padded sig', mk(jti, exp, `${sig}=`)],
      ['empty sig', mk(jti, exp, '')],
      ['sig with a non-base64url character', mk(jti, exp, `${sig.slice(0, 42)}*`)],
      [
        'non-canonical trailing bits',
        mk(jti, exp, `${sig.slice(0, 42)}${sig[42] === 'A' ? 'B' : 'A'}`),
      ],
      ['version v0 domain', mk(jti, exp, v0)],
      ['signature over exp only', mk(jti, exp, noJti)],
      ['uppercase jti', mk(jti.toUpperCase(), exp, sig)],
      ['not a v4 uuid', mk('00000000-0000-1000-8000-000000000001', exp, sig)],
      ['exp with leading zero', mk(jti, `0${exp}`, sig)],
      ['exp with plus sign', mk(jti, `%2B${exp}`, sig)],
      ['exp in exponent form', mk(jti, '1e3', sig)],
      ['extra query parameter', `${url}&x=1`],
      ['duplicate sig', `${url}&sig=${sig}`],
      ['duplicate exp', `${url}&exp=${exp}`],
      ['no query', `https://media.synthetic.example/media/${jti}`],
      ['no sig', `https://media.synthetic.example/media/${jti}?exp=${exp}`],
      ['no exp', `https://media.synthetic.example/media/${jti}?sig=${sig}`],
      ['nested path', `https://media.synthetic.example/media/${jti}/x?exp=${exp}&sig=${sig}`],
    ];
    // A real signature over an unknown jti reaches the DO, finds no record, and stops there.
    const unknown = crypto.randomUUID();
    bad.push([
      'validly signed, unknown jti (DO has no record)',
      mk(unknown, nowS + 10, await signLink(SECRET, unknown, nowS + 10)),
    ]);
    h.reset();
    const bodies = new Set<string>();
    let reachedDo = 0;
    for (const [name, u] of bad) {
      const before = h.calls.doGet;
      const r = await h.get(u, { origin: ORIGIN });
      expect(r.status, name).toBe(404);
      bodies.add(await r.text());
      if (h.calls.doGet > before) reachedDo++;
    }
    expect(reachedDo).toBe(1); // only the validly signed unknown jti got as far as the DO
    expect(h.calls.r2Get).toHaveLength(0);
    expect(h.calls.viewGrant).toHaveLength(0);
    expect(bodies.size).toBe(1); // every failure has the same body
    const ok = await h.get(url);
    expect(ok.status).toBe(200); // none of the above burned the real link
    await ok.arrayBuffer();
    console.log(`DC-D5 tamper: ${bad.length} variants -> 404, R2 gets=0, DO touched=${reachedDo}`);
  });

  it('the DO record is checked against exp too (a leaked key still cannot revive an expired record)', async () => {
    await seed();
    const h = harness();
    const nowS = Math.floor(T0 / 1000);
    const jti = crypto.randomUUID();
    await doStub(jti).create({ ...record(), exp: nowS - 1 }, nowS - 400);
    const exp = nowS + TTL_SECONDS;
    h.reset();
    const res = await h.get(mk(jti, exp, await signLink(SECRET, jti, exp)));
    expect(res.status).toBe(404);
    expect(h.calls.doGet).toBe(1);
    expect(h.calls.r2Get).toHaveLength(0);
  });

  it('every failure kind returns the identical 404 body and headers (no oracle)', async () => {
    await seed();
    const h = harness({
      viewGrant: async (r) => {
        if (r.mediaId === 'deny') throw new Error('TRACE_GUARD: media access denied');
        return r.r2Key;
      },
    });
    const fails: Response[] = [];
    // burnt
    const used = await h.issue();
    await (await h.get(used)).arrayBuffer();
    fails.push(await h.get(used, { origin: ORIGIN }));
    // R2 miss
    fails.push(
      await h.get(await h.issue({ r2Key: `media/${ORG}/missing/start_photo.jpg` }), {
        origin: ORIGIN,
      }),
    );
    // grant denied
    fails.push(await h.get(await h.issue({ mediaId: 'deny' }), { origin: ORIGIN }));
    // key outside the org prefix, and not a start photo
    fails.push(
      await h.get(await h.issue({ r2Key: 'media/other-org/s/start_photo.jpg' }), {
        origin: ORIGIN,
      }),
    );
    fails.push(
      await h.get(await h.issue({ r2Key: `media/${ORG}/s/other.jpg` }), { origin: ORIGIN }),
    );
    // HEAD and a garbage path
    fails.push(await h.get(used, { origin: ORIGIN }, 'HEAD'));
    fails.push(await h.get('https://media.synthetic.example/media/garbage', { origin: ORIGIN }));
    const shape = async (r: Response) =>
      JSON.stringify([
        r.status,
        await r.clone().text(),
        [...r.headers].sort(([a], [b]) => a.localeCompare(b)),
      ]);
    const shapes = new Set<string>();
    for (const r of fails) {
      expect(r.status).toBe(404);
      shapes.add(await shape(r));
    }
    expect(shapes.size).toBe(1);
    expect([...shapes][0]).toContain('not_found');
  });
});

describe('DC-D5 fail closed: no audit/grant, no bytes (R3-3, R3-9)', () => {
  it('a denied grant returns no bytes, never reads R2, and the burnt link stays burnt', async () => {
    await seed();
    const h = harness({
      viewGrant: async () => {
        throw new Error('TRACE_GUARD: media access denied');
      },
    });
    const url = await h.issue();
    h.reset();
    expect((await h.get(url)).status).toBe(404);
    expect(h.calls.r2Get).toHaveLength(0);
    expect((await h.get(url)).status).toBe(404);
    expect(h.calls.viewGrant).toHaveLength(1);
  });

  it('streams only a key under media/<org>/ that ends in /start_photo.jpg', async () => {
    await seed();
    await seed(`media/${ORG}/sess-2/other.jpg`);
    const h = harness({ viewGrant: async () => `media/${ORG}/sess-2/other.jpg` });
    h.reset();
    expect((await h.get(await h.issue())).status).toBe(404);
    expect(h.calls.r2Get).toHaveLength(0);
    const h2 = harness({ viewGrant: async () => `media/${ORG}/../x/start_photo.jpg` });
    expect((await h2.get(await h2.issue())).status).toBe(404);
    expect(h2.calls.r2Get).toHaveLength(0);
  });

  it('an R2 miss after the burn is a 404 and the link cannot be retried', async () => {
    const h = harness();
    const url = await h.issue({ r2Key: `media/${ORG}/gone/start_photo.jpg` });
    h.reset();
    expect((await h.get(url)).status).toBe(404);
    expect((await h.get(url)).status).toBe(404);
    expect(h.calls.r2Get).toEqual([`media/${ORG}/gone/start_photo.jpg`]);
  });
});
