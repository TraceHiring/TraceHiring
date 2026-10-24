// CORS on /v1/orgs/* (specs/d1-demo-slice.md §6.2, §7.1 `ALLOWED_ORIGINS`; security review N1). The recruiter app
// calls the org routes from another origin with a Bearer `Authorization` header and no cookies. Pinned here:
//  - an Origin that exactly matches an ALLOWED_ORIGINS entry gets that origin in ACAO and `Vary: Origin`, on success
//    and on every error answer (the org errors and the shared 500), and never Access-Control-Allow-Credentials;
//  - any other Origin, or none, gets no CORS header and the request runs exactly as before (CORS is not auth);
//  - a preflight from an allowed origin is a 204 with the exact methods and headers, before auth, the DB or a DO; from
//    any other origin it is the app's generic 404;
//  - /media keeps its own headers (R3-6) and /health gets none;
//  - the deployed ALLOWED_ORIGINS of each env block is exactly the recruiter origin.
import { noopErrorReporter } from '@trace/shared/log';
import { createHttpApp } from '@trace/workers-http';
import { afterEach, describe, expect, it, vi } from 'vitest';
// The Worker's own config as text (Vite `?raw`, typed in raw-import.d.ts); it stays inside this workspace.
import wranglerSource from '../wrangler.jsonc?raw';
import { createApp } from './app.js';
import { createMediaRoutes } from './modules/media/routes.js';
import { orgFail, orgJson, type OrgDeps } from './modules/tests/org-context.js';
import {
  ORG_ALLOW_HEADERS,
  ORG_ALLOW_METHODS,
  ORG_CORS_PATH,
  ORG_PREFLIGHT_MAX_AGE,
  orgCors,
} from './org-cors.js';

const RECRUITER = 'https://recruiter.example.test';
const LOCAL = 'http://localhost:5174';
const OTHER = 'https://evil.example.test';
const ORG = 'a1000000-0000-4000-8000-000000000001';
const T = 'e1000000-0000-4000-8000-000000000001';
const X = 'f1000000-0000-4000-8000-000000000001';

const envWith = (allowed?: string): Env =>
  ({
    VERSION: 'dev',
    TRACE_ENV: 'dev',
    ...(allowed === undefined ? {} : { ALLOWED_ORIGINS: allowed }),
  }) as unknown as Env;

const ENV = envWith(`${RECRUITER},${LOCAL}`);

const CORS_HEADERS = [
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-allow-credentials',
  'access-control-max-age',
  'access-control-expose-headers',
];

const expectNoCors = (res: Response, label = ''): void => {
  for (const h of CORS_HEADERS) expect(res.headers.get(h), `${label} ${h}`).toBeNull();
  expect(res.headers.get('vary'), `${label} vary`).toBeNull();
};

const expectCors = (res: Response, origin: string, label = ''): void => {
  expect(res.headers.get('access-control-allow-origin'), label).toBe(origin);
  expect(res.headers.get('vary'), label).toBe('Origin');
  expect(res.headers.get('access-control-allow-credentials'), label).toBeNull();
};

/** The real api app with an injected org context; `context` decides what every org route answers. */
const realApp = (context: OrgDeps['context']) =>
  createApp({ reporter: noopErrorReporter, sink: () => undefined, org: { context } });

/** A small app with the middleware on the org path and routes that answer 200, 201 and throw. */
const miniApp = () => {
  const app = createHttpApp<{ Bindings: Env }>('api', {
    reporter: noopErrorReporter,
    sink: () => undefined,
  });
  app.use(ORG_CORS_PATH, orgCors);
  app.get(`/v1/orgs/:orgId/thing`, () => orgJson({ ok: true }));
  app.post(`/v1/orgs/:orgId/thing`, () => orgJson({ ok: true }, 201));
  app.get(`/v1/orgs/:orgId/boom`, () => {
    throw new Error('boom');
  });
  return app;
};

const call = (
  app: { request: (url: string, init: RequestInit, env: Env) => Response | Promise<Response> },
  path: string,
  init: RequestInit & { origin?: string } = {},
  env: Env = ENV,
) => {
  const { origin, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (origin !== undefined) headers.set('origin', origin);
  return app.request(`https://api.test${path}`, { ...rest, headers }, env);
};

const preflight = (origin?: string, path = `/v1/orgs/${ORG}/tests`) => ({
  method: 'OPTIONS',
  ...(origin === undefined ? {} : { origin }),
  headers: {
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'authorization, content-type',
  },
  path,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('org CORS: actual requests (security review N1)', () => {
  it('an allowed origin gets ACAO and Vary on GET 200 and POST 201, and no credentials header', async () => {
    const app = miniApp();
    const get = await call(app, `/v1/orgs/${ORG}/thing`, { origin: RECRUITER });
    expect(get.status).toBe(200);
    expectCors(get, RECRUITER, 'GET');
    expect(await get.json()).toStrictEqual({ ok: true });
    expect(get.headers.get('cache-control')).toBe('no-store');
    expect(get.headers.get('content-type')).toBe('application/json');

    const post = await call(app, `/v1/orgs/${ORG}/thing`, {
      method: 'POST',
      origin: LOCAL,
      headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
      body: '{}',
    });
    expect(post.status).toBe(201);
    expectCors(post, LOCAL, 'POST');
  });

  it('a disallowed or absent Origin gets no CORS header and the same answer', async () => {
    const app = miniApp();
    for (const origin of [OTHER, 'null', undefined]) {
      const res = await call(app, `/v1/orgs/${ORG}/thing`, origin === undefined ? {} : { origin });
      expect(res.status, String(origin)).toBe(200);
      expect(await res.json()).toStrictEqual({ ok: true });
      expectNoCors(res, String(origin));
    }
  });

  it('the shared 500 keeps ACAO and Vary for an allowed origin, and has none otherwise', async () => {
    const app = miniApp();
    const allowed = await call(app, `/v1/orgs/${ORG}/boom`, { origin: RECRUITER });
    expect(allowed.status).toBe(500);
    expect(await allowed.text()).toBe('{"error":"internal"}');
    expectCors(allowed, RECRUITER);
    const other = await call(app, `/v1/orgs/${ORG}/boom`, { origin: OTHER });
    expect(other.status).toBe(500);
    expectNoCors(other);
  });

  it.each([
    ['unauthorized', 401],
    ['aal2_required', 403],
    ['not_found', 404],
    ['conflict', 409],
    ['unavailable', 503],
  ] as const)('the real app keeps ACAO and Vary on the %s error (%i)', async (code, status) => {
    const app = realApp(async () => orgFail(code));
    for (const [method, path] of [
      ['GET', `/v1/orgs/${ORG}/tests`],
      ['POST', `/v1/orgs/${ORG}/tests/${T}/publish`],
      ['DELETE', `/v1/orgs/${ORG}/tests/${T}/assignments/${X}`],
      ['GET', `/v1/orgs/${ORG}/reports/${X}`],
    ] as const) {
      const res = await call(app, path, {
        method,
        origin: RECRUITER,
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(status);
      expect(await res.json()).toStrictEqual({ error: { code } });
      expectCors(res, RECRUITER, `${method} ${path}`);

      const plain = await call(app, path, {
        method,
        origin: OTHER,
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(plain.status).toBe(status);
      expectNoCors(plain, `${method} ${path}`);
    }
  });

  it('the real app keeps ACAO on the shared 500 when an org handler fails', async () => {
    const app = realApp(async () => {
      throw new Error('boom');
    });
    const res = await call(app, `/v1/orgs/${ORG}/tests`, { origin: LOCAL });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"internal"}');
    expectCors(res, LOCAL);
  });

  it('still runs the org check for a disallowed origin (CORS is not auth)', async () => {
    const context = vi.fn(async () => orgFail('unauthorized'));
    const res = await call(realApp(context), `/v1/orgs/${ORG}/tests`, { origin: OTHER });
    expect(res.status).toBe(401);
    expect(context).toHaveBeenCalledTimes(1);
  });
});

describe('org CORS: preflight', () => {
  it('an allowed origin gets 204 with the exact headers and never reaches auth, the DB or a DO', async () => {
    const context = vi.fn(async () => orgFail('unauthorized'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const app = realApp(context);
    for (const path of [
      `/v1/orgs/${ORG}/tests`,
      `/v1/orgs/${ORG}/tests/${T}`,
      `/v1/orgs/${ORG}/tests/${T}/assignments/${X}`,
      `/v1/orgs/${ORG}/reports/${X}/start-photo-link`,
    ]) {
      const { path: p, ...init } = preflight(RECRUITER, path);
      const res = await call(app, p, init);
      expect(res.status, path).toBe(204);
      expect(await res.text()).toBe('');
      expect(Object.fromEntries(res.headers)).toStrictEqual({
        'access-control-allow-origin': RECRUITER,
        'access-control-allow-methods': 'GET, POST, PUT, DELETE',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
        'cache-control': 'no-store',
        vary: 'Origin',
      });
    }
    expect(context).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a disallowed, null or absent origin gets the generic 404 with no CORS header', async () => {
    const context = vi.fn(async () => orgFail('unauthorized'));
    const app = realApp(context);
    const unknown = await call(app, `/nope`, {});
    const unknownBody = await unknown.text();
    for (const origin of [OTHER, 'null', `${RECRUITER}/`, `${RECRUITER}.evil.test`, undefined]) {
      const { path, ...init } = preflight(origin);
      const res = await call(app, path, init);
      expect(res.status, String(origin)).toBe(404);
      expect(await res.text()).toBe(unknownBody);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expectNoCors(res, String(origin));
    }
    expect(context).not.toHaveBeenCalled();
  });

  it('allows exactly the methods the org routes register', () => {
    const app = realApp(async () => orgFail('unauthorized'));
    const methods = new Set(
      app.routes
        .filter((r) => r.path.startsWith('/v1/orgs/') && r.handler !== orgCors)
        .map((r) => r.method),
    );
    expect([...methods].sort()).toEqual(ORG_ALLOW_METHODS.split(', ').sort());
    expect(ORG_ALLOW_HEADERS).toBe('authorization, content-type');
    expect(ORG_PREFLIGHT_MAX_AGE).toBe('600');
  });
});

describe('org CORS: ALLOWED_ORIGINS parsing', () => {
  const allowed = async (value: string | undefined, origin: string): Promise<boolean> => {
    const res = await call(miniApp(), `/v1/orgs/${ORG}/thing`, { origin }, envWith(value));
    return res.headers.get('access-control-allow-origin') === origin;
  };

  it('trims entries and skips empty ones', async () => {
    const value = ` ${RECRUITER} , ,${LOCAL},, `;
    expect(await allowed(value, RECRUITER)).toBe(true);
    expect(await allowed(value, LOCAL)).toBe(true);
    expect(await allowed(value, OTHER)).toBe(false);
  });

  it('matches exactly: no suffix, prefix, path, case, port or scheme variant', async () => {
    for (const origin of [
      `${RECRUITER}.evil.test`,
      `https://x.${RECRUITER.slice('https://'.length)}`,
      `${RECRUITER}/`,
      RECRUITER.toUpperCase(),
      `${RECRUITER}:443`,
      RECRUITER.replace('https:', 'http:'),
      'http://localhost:5175',
    ])
      expect(await allowed(`${RECRUITER},${LOCAL}`, origin), origin).toBe(false);
  });

  it('never allows null, a wildcard or a pattern, and an empty or missing var allows nothing', async () => {
    expect(await allowed('null', 'null')).toBe(false);
    expect(await allowed('*', RECRUITER)).toBe(false);
    expect(await allowed('https://*.example.test', RECRUITER)).toBe(false);
    expect(await allowed('', RECRUITER)).toBe(false);
    expect(await allowed(' , ', RECRUITER)).toBe(false);
    expect(await allowed(undefined, RECRUITER)).toBe(false);
  });
});

describe('org CORS: other paths are unchanged', () => {
  it('/health gets no CORS header and its preflight stays the generic 404', async () => {
    const app = realApp(async () => orgFail('unauthorized'));
    const res = await call(app, '/health', { origin: RECRUITER });
    expect(res.status).toBe(200);
    expectNoCors(res);
    const pre = await call(app, '/health', { method: 'OPTIONS', origin: RECRUITER });
    expect(pre.status).toBe(404);
    expectNoCors(pre);
  });

  it('/media keeps its own R3-6 headers and gets no org CORS header', async () => {
    const app = createHttpApp<{ Bindings: Env }>('api', { reporter: noopErrorReporter });
    app.use(ORG_CORS_PATH, orgCors);
    app.route(
      '/',
      createMediaRoutes({
        org: { context: async () => orgFail('unauthorized') },
        media: async () => null,
      }),
    );
    const res = await call(app, `/media/${X}?exp=1&sig=x`, { origin: RECRUITER });
    expect(res.status).toBe(404);
    expect(Object.fromEntries(res.headers)).toStrictEqual({
      'access-control-allow-origin': RECRUITER,
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      vary: 'Origin',
      'x-content-type-options': 'nosniff',
    });
    const pre = await call(app, `/media/${X}`, { method: 'OPTIONS', origin: RECRUITER });
    expect(pre.status).toBe(404);
    expect(pre.headers.get('access-control-allow-methods')).toBeNull();
    // The real app registers the middleware on the org path only.
    const real = realApp(async () => orgFail('unauthorized'));
    const mw = real.routes.filter((r) => r.handler === orgCors);
    expect(mw.map((r) => `${r.method} ${r.path}`)).toEqual(['ALL /v1/orgs/*']);
  });
});

// ---- The deployed ALLOWED_ORIGINS (services/api/wrangler.jsonc, a lead file; read only) ------------------------

/** JSONC to JSON: drops `//` and block comments outside strings and trailing commas. */
const parseJsonc = (text: string): unknown => {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (inString) {
      out += ch;
      if (ch === '\\') out += text[++i] ?? '';
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
};

interface WranglerShape {
  vars?: Record<string, string>;
  env?: Record<string, { vars?: Record<string, string> }>;
}

describe('org CORS: ALLOWED_ORIGINS in wrangler.jsonc', () => {
  const config = parseJsonc(wranglerSource) as WranglerShape;

  it('staging allows exactly the recruiter Pages origin and dev exactly the local recruiter', () => {
    expect(config.env?.staging?.vars?.ALLOWED_ORIGINS).toBe(
      'https://trace-recruiter-staging.pages.dev',
    );
    expect(config.env?.dev?.vars?.ALLOWED_ORIGINS).toBe('http://localhost:5174');
  });

  it('the top level allows nothing (no var), and no env block holds a wildcard or null', () => {
    expect(config.vars?.ALLOWED_ORIGINS).toBeUndefined();
    for (const [name, block] of Object.entries(config.env ?? {})) {
      expect(block.vars?.ALLOWED_ORIGINS ?? '', name).not.toMatch(/\*|null/);
    }
  });
});
