// AT-D32, api half (specs/d1-demo-slice.md §9, L-23; CLAUDE.md "no PII in logs"): no event payload, label, link,
// token or code reaches a log line or an error report. Two kinds of check:
//  - static, on the real production sources: nothing calls `console` directly, and every log call names a literal
//    event from LOG_EVENTS, so a new log line is a reviewed change to this file;
//  - dynamic: synthetic PII, tokens, links and codes are planted in the failing paths (the thrown error's message,
//    the bearer token, the query string, the RPC input) and none of them appears in the captured lines or reports.
//    Every org route of the inventory is covered, plus the deeper failure paths of the routes that carry a link,
//    token or code: invitations (token, inviteUrl, contact), the demo outbox (OTP, body) and /media/:jti (jti, sig,
//    key) (spec review R3 reports, finding 5).
// Synthetic values are built at run time (no literal PII-shaped fixture sits in the repo).
import type { SerializedError } from '@trace/shared/log';
import { createLogger, type ErrorReporter } from '@trace/shared/log';
import { createHttpApp } from '@trace/workers-http';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { runCandidateMethod } from './modules/candidate/candidate-rpc.js';
import {
  callerFor,
  fakeDelivery,
  invitationsDb,
  NOW,
  ORG as INV_ORG,
  T1,
} from './modules/invitations/invitation.test-helpers.js';
import { createInvitationsRoutes } from './modules/invitations/routes.js';
import { createMediaRoutes, type MediaCall } from './modules/media/routes.js';
import { createOutboxRoutes } from './modules/outbox/routes.js';
import { OrgError, type OrgCaller, type OrgDeps } from './modules/tests/org-context.js';
import { fakeDb } from './modules/tests/rest.test-helpers.js';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>;
  }
}

/** Every event name a production log call may use (method `debug|info|warn|error`, first argument). */
const LOG_EVENTS = ['candidate_rpc.failed'];

const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true });
const production = Object.entries(sources).filter(
  ([path]) => !/\.test(-helpers)?\.ts$/.test(path) && !path.endsWith('.d.ts'),
);

const LOG_CALL = /\b(?:log|logger)\s*\.\s*(?:debug|info|warn|error)\s*\(\s*([^,)]*)/g;

// ---- synthetic values ---------------------------------------------------------------------------------------------
const letters = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => String.fromCharCode(97 + ((seed * 7 + i * 5) % 26))).join('');
const digits = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => String((seed * 3 + i * 7) % 10)).join('');
const SECRETS = {
  email: `${letters(7, 1)}.${letters(5, 2)}@${letters(6, 3)}.example`,
  mobile: `9${digits(9, 4)}`,
  label: `Candidate ${letters(6, 5)}`,
  jwt: ['eyJ' + letters(18, 6), 'eyJ' + letters(22, 7), letters(30, 8)].join('.'),
  inviteToken: letters(43, 9),
  inviteUrl: `https://candidate.example/i#${letters(43, 10)}`,
  otp: digits(6, 11),
  mediaSig: letters(43, 12),
  mediaKey: `evidence/${letters(20, 13)}.jpg`,
  contact: `${letters(9, 14)}@example.test`,
  outboxBody: `Your code is ${digits(6, 15)}`,
};
const planted = Object.values(SECRETS);

const capture = () => {
  const lines: string[] = [];
  const reports: SerializedError[] = [];
  const reporter: ErrorReporter = { capture: (err) => void reports.push(err) };
  return { lines, reports, reporter, sink: (line: string) => void lines.push(line) };
};

const expectClean = (texts: readonly string[]) => {
  const all = texts.join('\n');
  for (const value of planted) expect(all).not.toContain(value);
};

// DEMO_OUTBOX on, so the outbox route reaches the caller check instead of its pre-auth 404.
const ENV = { VERSION: 'dev', TRACE_ENV: 'dev', DEMO_OUTBOX: '1' } as unknown as Env;
const ORG = '11111111-1111-4111-8111-111111111111';
const TEST = '44444444-4444-4444-8444-444444444444';
const REPORT = 'aaaaaaaa-0000-4000-8000-000000000001';
const MEMBER = '0e000000-0000-4000-8000-000000000001';
const JTI = '0d000000-0000-4000-8000-000000000001';

const failingOrg = (err: Error): OrgDeps => ({
  context: () => Promise.reject(err),
});

const plantedBody = () =>
  JSON.stringify({
    name: SECRETS.label,
    contactEmail: SECRETS.contact,
    adultConfirmedByInviter: true,
    membershipId: MEMBER,
    note: planted.join(' '),
  });

const requestWithSecrets = (path: string, method = 'GET') =>
  new Request(`https://api.test${path}?t=${SECRETS.inviteToken}&sig=${SECRETS.mediaSig}`, {
    method,
    headers: {
      authorization: `Bearer ${SECRETS.jwt}`,
      'x-contact': SECRETS.email,
      'content-type': 'application/json',
    },
    ...(method === 'GET' ? {} : { body: plantedBody() }),
  });

/** Every org route of the AT-D13 inventory (route-inventory.test.ts), as `METHOD path`. */
const ORG_ROUTES: [string, string][] = [
  ['GET', `/v1/orgs/${ORG}/tests`],
  ['POST', `/v1/orgs/${ORG}/tests`],
  ['GET', `/v1/orgs/${ORG}/tests/${TEST}`],
  ['PUT', `/v1/orgs/${ORG}/tests/${TEST}`],
  ['POST', `/v1/orgs/${ORG}/tests/${TEST}/publish`],
  ['GET', `/v1/orgs/${ORG}/tests/${TEST}/assignments`],
  ['POST', `/v1/orgs/${ORG}/tests/${TEST}/assignments`],
  ['DELETE', `/v1/orgs/${ORG}/tests/${TEST}/assignments/${MEMBER}`],
  ['GET', `/v1/orgs/${ORG}/tests/${TEST}/invitations`],
  ['POST', `/v1/orgs/${ORG}/tests/${TEST}/invitations`],
  ['POST', `/v1/orgs/${ORG}/tests/${TEST}/invitations/${REPORT}/revoke`],
  ['GET', `/v1/orgs/${ORG}/tests/${TEST}/results`],
  ['GET', `/v1/orgs/${ORG}/reports/${REPORT}`],
  ['GET', `/v1/orgs/${ORG}/reports/${REPORT}/quality`],
  ['GET', `/v1/orgs/${ORG}/reports/${REPORT}/integrity`],
  ['GET', `/v1/orgs/${ORG}/review/reports`],
  ['POST', `/v1/orgs/${ORG}/reports/${REPORT}/start-photo-link`],
  ['GET', `/v1/orgs/${ORG}/demo-outbox`],
];

/** A bare api app (the shared error handler and logger) around one sub-router, for the deeper failure paths. */
const httpAppWith = (c: ReturnType<typeof capture>, router: Hono<{ Bindings: Env }>) => {
  const app = createHttpApp<{ Bindings: Env }>('api', { reporter: c.reporter, sink: c.sink });
  app.route('/', router);
  return app;
};

const boom = () => new Error(`failed for ${planted.join(' ')}`);

const USER = '0f000000-0000-4000-8000-000000000001';
const recruiterCaller: OrgCaller = { userId: USER, aal: 'aal1', amr: ['otp'], jwt: SECRETS.jwt };
const recruiterDeps = (): OrgDeps => {
  const db = fakeDb({
    memberships: [
      { id: MEMBER, org_id: ORG, user_id: USER, roles: ['recruiter'], status: 'active' },
    ],
  });
  return { context: async () => ({ caller: recruiterCaller, rest: db.rest }) };
};

/** Media deps whose every use throws an error that carries every planted value. */
const throwingMedia = (): MediaCall => ({
  deps: new Proxy({} as MediaCall['deps'], {
    get: () => {
      throw boom();
    },
  }),
  close: async () => undefined,
});

describe('api log hygiene, static (AT-D32)', () => {
  it('found the production sources', () => {
    expect(production.length).toBeGreaterThan(10);
    expect(production.map(([p]) => p)).toContain('./app.ts');
  });

  it('never calls console directly', () => {
    for (const [path, src] of production) expect(src, path).not.toMatch(/\bconsole\s*\./);
  });

  it('logs only allow-listed literal events', () => {
    const seen = new Set<string>();
    for (const [path, src] of production) {
      for (const m of src.matchAll(LOG_CALL)) {
        const arg = (m[1] ?? '').trim();
        expect(arg, path).toMatch(/^'[a-z_]+\.[a-z_]+'$/);
        seen.add(arg.slice(1, -1));
      }
    }
    for (const event of seen) expect(LOG_EVENTS).toContain(event);
  });

  it('the leak check catches each planted value (guard self-test)', () => {
    for (const value of planted) expect(() => expectClean([`x ${value} y`])).toThrow();
  });

  it('the log-call pattern sees a call (guard self-test)', () => {
    const src = "log.warn('candidate_rpc.failed', { method });";
    expect([...src.matchAll(LOG_CALL)].map((m) => m[1])).toEqual(["'candidate_rpc.failed'"]);
  });
});

describe('api log hygiene, org routes (AT-D32)', () => {
  it('covers every org route of the inventory', () => {
    expect(ORG_ROUTES).toHaveLength(18);
  });

  it('a bug inside an org route logs and reports none of the request or error contents', async () => {
    for (const [method, path] of ORG_ROUTES) {
      const c = capture();
      const app = createApp({
        reporter: c.reporter,
        sink: c.sink,
        org: failingOrg(boom()),
      });
      const res = await app.fetch(requestWithSecrets(path, method), ENV);
      const at = `${method} ${path}`;
      expect(res.status, at).toBe(500);
      const body = await res.text();
      expect(c.lines.length, at).toBe(1);
      expect(c.reports.length, at).toBe(1);
      expectClean([body, ...c.lines, ...c.reports.map((r) => JSON.stringify(r))]);
    }
  });

  it('an org refusal answers a constant code and logs nothing', async () => {
    for (const [method, path] of ORG_ROUTES) {
      const c = capture();
      const app = createApp({
        reporter: c.reporter,
        sink: c.sink,
        org: failingOrg(new OrgError('unauthorized')),
      });
      const res = await app.fetch(requestWithSecrets(path, method), ENV);
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(c.lines, path).toEqual([]);
      expect(c.reports, path).toEqual([]);
      expectClean([await res.text()]);
    }
  });
});

describe('api log hygiene, invitations (AT-D32)', () => {
  const setup = (c: ReturnType<typeof capture>) => {
    const db = invitationsDb('rec');
    const d = fakeDelivery(db);
    const app = httpAppWith(
      c,
      createInvitationsRoutes({
        org: { context: async () => ({ caller: callerFor('rec'), rest: db.rest }) },
        delivery: () => d.delivery,
        now: () => NOW,
        newToken: () => SECRETS.inviteToken,
      }),
    );
    const create = () =>
      app.fetch(
        new Request(`https://api.test/v1/orgs/${INV_ORG}/tests/${T1}/invitations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contactEmail: SECRETS.contact, adultConfirmedByInviter: true }),
        }),
        ENV,
      );
    return { d, create };
  };

  it('a failed outbox write answers 503 and logs nothing of the token, link or contact', async () => {
    const c = capture();
    const s = setup(c);
    s.d.delivery.outbox = {
      write: () => Promise.reject(boom()),
    };
    const res = await s.create();
    expect(res.status).toBe(503);
    expect(c.lines).toEqual([]);
    expect(c.reports).toEqual([]);
    expectClean([await res.text()]);
  });

  it('a failed `sent` step still answers 201 with the link, and logs nothing', async () => {
    const c = capture();
    const s = setup(c);
    s.d.delivery.markSent = () => Promise.reject(boom());
    const res = await s.create();
    expect(res.status).toBe(201);
    const body = await res.text();
    // The link is in this response only (by design); the contact never is.
    expect(body).toContain(SECRETS.inviteToken);
    expect(body).not.toContain(SECRETS.contact);
    expect(c.lines).toEqual([]);
    expect(c.reports).toEqual([]);
  });

  it('an unexpected failure after the token exists logs one clean line', async () => {
    const c = capture();
    const s = setup(c);
    s.d.delivery.close = () => Promise.reject(boom());
    const res = await s.create();
    expect(res.status).toBe(500);
    expect(c.lines).toHaveLength(1);
    expect(c.reports).toHaveLength(1);
    expectClean([await res.text(), ...c.lines, ...c.reports.map((r) => JSON.stringify(r))]);
  });
});

describe('api log hygiene, demo outbox (AT-D32)', () => {
  const list = (reader: () => unknown) => {
    const c = capture();
    const app = httpAppWith(
      c,
      createOutboxRoutes({
        org: recruiterDeps(),
        reader: reader as Parameters<typeof createOutboxRoutes>[0]['reader'],
      }),
    );
    return { c, res: app.fetch(requestWithSecrets(`/v1/orgs/${ORG}/demo-outbox`), ENV) };
  };

  it('a failing outbox read answers 503 and logs nothing of the OTP or body', async () => {
    const { c, res } = list(() => ({ list: () => Promise.reject(boom()) }));
    const r = await res;
    expect(r.status).toBe(503);
    expect(c.lines).toEqual([]);
    expect(c.reports).toEqual([]);
    expectClean([await r.text()]);
  });

  it('a malformed entry (an address, a stray field) is refused, not echoed or logged', async () => {
    const { c, res } = list(() => ({
      list: async () => [{ to: SECRETS.contact, bodyText: SECRETS.outboxBody, otp: SECRETS.otp }],
    }));
    const r = await res;
    expect(r.status).toBe(503);
    expect(c.lines).toEqual([]);
    expectClean([await r.text()]);
  });

  it('a failure building the reader logs one clean line', async () => {
    const { c, res } = list(() => {
      throw boom();
    });
    const r = await res;
    expect(r.status).toBe(500);
    expect(c.lines).toHaveLength(1);
    expectClean([await r.text(), ...c.lines, ...c.reports.map((x) => JSON.stringify(x))]);
  });
});

describe('api log hygiene, /media/:jti and the start-photo link (AT-D32)', () => {
  const mediaUrl = `/media/${JTI}?exp=${String(Math.floor(NOW / 1000) + 300)}&sig=${SECRETS.mediaSig}&key=${encodeURIComponent(SECRETS.mediaKey)}`;

  it('a fetch whose deps throw answers the constant 404 and logs nothing of the jti, sig or key', async () => {
    const c = capture();
    const app = httpAppWith(
      c,
      createMediaRoutes({ org: recruiterDeps(), media: async () => throwingMedia() }),
    );
    const res = await app.fetch(new Request(`https://api.test${mediaUrl}`), ENV);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":{"code":"not_found"}}');
    expect(c.lines).toEqual([]);
    expect(c.reports).toEqual([]);
  });

  it('a failure building the media deps logs one line without the jti, sig or key', async () => {
    const c = capture();
    const app = httpAppWith(
      c,
      createMediaRoutes({ org: recruiterDeps(), media: () => Promise.reject(boom()) }),
    );
    const res = await app.fetch(new Request(`https://api.test${mediaUrl}`), ENV);
    expect(res.status).toBe(500);
    expect(c.lines).toHaveLength(1);
    const all = [await res.text(), ...c.lines, ...c.reports.map((r) => JSON.stringify(r))];
    expectClean(all);
    expect(all.join('\n')).not.toContain(JTI);
  });

  it('a start-photo link whose deps throw answers 404 and logs nothing', async () => {
    const c = capture();
    const app = httpAppWith(
      c,
      createMediaRoutes({ org: recruiterDeps(), media: async () => throwingMedia() }),
    );
    const res = await app.fetch(
      requestWithSecrets(`/v1/orgs/${ORG}/reports/${REPORT}/start-photo-link`, 'POST'),
      ENV,
    );
    expect(res.status).toBe(404);
    expect(c.lines).toEqual([]);
    expect(c.reports).toEqual([]);
    expectClean([await res.text()]);
  });
});

describe('api log hygiene, CandidateRpc (AT-D32)', () => {
  it('a failing method logs only its name and a SQLSTATE, never the input or the error text', async () => {
    const c = capture();
    const log = createLogger({ service: 'api', version: 'dev', sink: c.sink });
    const err = Object.assign(new Error(`db said ${planted.join(' ')}`), { code: '23505' });
    await expect(
      runCandidateMethod(
        'inviteResolve',
        { token: SECRETS.inviteToken },
        () => {
          throw err;
        },
        log,
      ),
    ).rejects.toThrow('unavailable');
    expect(c.lines).toHaveLength(1);
    const line = JSON.parse(c.lines[0] ?? '{}') as Record<string, unknown>;
    expect(line).toMatchObject({ event: 'candidate_rpc.failed' });
    expectClean(c.lines);
    expect(c.lines[0]).toContain('23505');
  });

  it('a non-SQLSTATE code is dropped, not logged', async () => {
    const c = capture();
    const log = createLogger({ service: 'api', version: 'dev', sink: c.sink });
    const err = Object.assign(new Error('x'), { code: SECRETS.otp });
    await expect(
      runCandidateMethod(
        'inviteResolve',
        { token: SECRETS.inviteToken },
        () => {
          throw err;
        },
        log,
      ),
    ).rejects.toThrow('unavailable');
    expectClean(c.lines);
  });
});
