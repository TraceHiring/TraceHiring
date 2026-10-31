// AT-M2-34, portal part, and AT-M2-21 edge side (specs/m2-scheduling-invites.md M2-11, R5-19, R5-24, §6.6, E10, E11,
// E25; ADR-030 amendment 1): GET /v1/portal/slots and POST /v1/portal/reschedule take a Bearer `portal` token (minted
// after an OTP with purpose `manage`, 1,800 s) and are the only routes that accept it; a lobby or session token is
// refused on them. Each counts against a per-invitation InviteOtpDO bucket (`portal_slots`, `portal_reschedule`); the
// ADR-032 link limiter is not involved. Availability is a boolean only: the edge answers exactly the contract's fields
// and an api answer with a count is refused (rule 5). api refusals reach the client with the contract's status.
import { PortalRescheduleRes, PortalSlotsRes } from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import {
  createHarness,
  LINK,
  NOW_MS,
  ORIGIN,
  PORTAL_TTL,
  SLOT_A,
  SLOT_B,
  type ApiImpl,
  type Harness,
} from './edge.test-helpers.js';
import { PORTAL_LIMITS } from './otp-core.js';
import { sessionHarness } from './session.test-helpers.js';
import { INVITATION, lobbyClaims, ORG, OTHER_INVITATION, signToken } from './token.test-helpers.js';

const slots = (h: Harness, token: string, headers: Record<string, string> = {}) =>
  h.request('GET', '/v1/portal/slots', { token, headers });

const reschedule = (h: Harness, token: string, json: unknown = { toSlotId: SLOT_A }) =>
  h.request('POST', '/v1/portal/reschedule', { token, json });

const portalHarness = async (overrides: ApiImpl = {}) => {
  const h = await createHarness(overrides);
  const portal = await h.loginPortal();
  return { h, portal };
};

describe('GET /v1/portal/slots (R5-24, E25)', () => {
  it('passes the raw portal token to api and answers the slots with availability booleans only', async () => {
    const { h, portal } = await portalHarness();
    const res = await slots(h, portal);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = PortalSlotsRes.parse(await res.json());
    expect(body.slots.map((s) => [s.slotId, s.available])).toEqual([
      [SLOT_A, true],
      [SLOT_B, false],
    ]);
    for (const slot of body.slots)
      expect(Object.keys(slot).sort()).toEqual(['available', 'slotId', 'startsAt']);
    const call = h.calls.find((c) => c.method === 'portalSlots');
    expect(call?.input).toEqual({ portalToken: portal });
  });

  it('an api answer with a seat count or another field is refused (503), never passed on (rule 5)', async () => {
    for (const extra of [{ booked: 3 }, { capacity: 10 }, { remaining: 1 }]) {
      const { h, portal } = await portalHarness({
        portalSlots: async () => ({
          slots: [
            { slotId: SLOT_A, startsAt: new Date().toISOString(), available: true, ...extra },
          ],
        }),
      });
      const res = await slots(h, portal);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'unavailable' });
    }
  });

  it('answers CORS for the candidate app only', async () => {
    const { h, portal } = await portalHarness();
    const res = await slots(h, portal, { origin: ORIGIN });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const other = await slots(h, portal, { origin: 'https://elsewhere.example.test' });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('POST /v1/portal/reschedule (R5-24, M2-11, E10, E11)', () => {
  it('passes the portal token and the target slot to api and answers the new start only', async () => {
    const { h, portal } = await portalHarness();
    const res = await reschedule(h, portal);
    expect(res.status).toBe(200);
    const body = PortalRescheduleRes.parse(await res.json());
    expect(Object.keys(body).sort()).toEqual(['ok', 'slotStartsAt']);
    const call = h.calls.find((c) => c.method === 'portalReschedule');
    // The object's peek rides along (R5-66 c, decision a): no session in it here.
    expect(call?.input).toEqual({ portalToken: portal, toSlotId: SLOT_A, sessionLive: false });
  });

  it('identity keys in the body are discarded; any other extra key or a bad slot id is 400 before api', async () => {
    const { h, portal } = await portalHarness();
    const ok = await reschedule(h, portal, {
      toSlotId: SLOT_A,
      invitationId: OTHER_INVITATION,
      orgId: OTHER_INVITATION,
    });
    expect(ok.status).toBe(200);
    expect(h.calls.find((c) => c.method === 'portalReschedule')?.input).toEqual({
      portalToken: portal,
      toSlotId: SLOT_A,
      sessionLive: false,
    });
    const before = h.calls.length;
    for (const json of [{ toSlotId: SLOT_A, reason: 'x' }, { toSlotId: 'slot-1' }, {}]) {
      expect((await reschedule(h, portal, json)).status).toBe(400);
    }
    expect(h.calls.length).toBe(before);
  });

  it.each([
    ['reschedule_used', 409],
    ['too_late_to_reschedule', 409],
    ['slot_full', 409],
    ['token_invalid', 401],
    ['link_revoked', 410],
  ] as const)('an api refusal %s reaches the client as %i with its code', async (code, status) => {
    const { h, portal } = await portalHarness({
      portalReschedule: async () => {
        throw new Error(code);
      },
    });
    const res = await reschedule(h, portal);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
  });

  it('a body over the lobby cap is 413 before parsing', async () => {
    const { h, portal } = await portalHarness();
    const res = await h.request('POST', '/v1/portal/reschedule', {
      token: portal,
      body: JSON.stringify({ toSlotId: SLOT_A, pad: 'x'.repeat(5000) }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(413);
  });
});

describe('the portal token is accepted on exactly the two portal routes (R5-19, R5-24, ADR-030 amendment 1)', () => {
  it('a lobby token and a session token are refused on both portal routes (401 token_invalid)', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    h.clock.ms += 30_000; // the resend wait before the next login
    const session = await h.startSession();
    for (const token of [lobby, session.token]) {
      for (const res of [await slots(h, token), await reschedule(h, token)]) {
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'token_invalid' });
      }
    }
    expect(h.calls.filter((c) => c.method.startsWith('portal'))).toEqual([]);
  });

  it('a portal token is refused on every lobby and session route (401 token_invalid), nothing reaches api', async () => {
    const h = await sessionHarness();
    const portal = await h.loginPortal();
    const before = h.calls.length;
    const routes: [string, string, Record<string, unknown>][] = [
      ['POST', '/v1/lobby/age', { json: { adult: true } }],
      ['GET', '/v1/lobby/notice', {}],
      [
        'POST',
        '/v1/lobby/consent',
        { json: { noticeVersionId: ORG, renderedSha256: 'a'.repeat(64), accepted: true } },
      ],
      [
        'PUT',
        '/v1/lobby/photo',
        { body: new Uint8Array([0xff, 0xd8]), headers: { 'content-type': 'image/jpeg' } },
      ],
      [
        'POST',
        '/v1/session/start',
        { json: { rulesAcknowledged: true, photo: { skippedReason: 'declined' } } },
      ],
      ['POST', '/v1/session/attach', {}],
      ['GET', '/v1/session/items/1', {}],
      [
        'POST',
        '/v1/session/events',
        { json: { streamId: ORG, events: [{ seq: 1, t: 0, kind: 'heartbeat' }] } },
      ],
      ['POST', '/v1/session/submit', { json: { streamId: ORG, finalSeq: 0 } }],
      ['GET', `/v1/session/media/${'a'.repeat(64)}`, {}],
    ];
    for (const [method, path, init] of routes) {
      const res = await h.request(method, path, { token: portal, ...init });
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
      expect(await res.json()).toEqual({ error: 'token_invalid' });
    }
    expect(h.calls.length).toBe(before);
    expect(h.session.names).toEqual([]);
  });

  it('a portal token past 1,800 s is token_expired; one signed over the cap is token_invalid', async () => {
    const { h, portal } = await portalHarness();
    h.clock.ms += PORTAL_TTL * 1000;
    const res = await slots(h, portal);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'token_expired' });

    const now = Math.floor(h.clock.ms / 1000);
    const long = await signToken(h.key, lobbyClaims(now, { typ: 'portal', exp: now + 1801 }));
    expect((await slots(h, long)).status).toBe(401);
  });

  it("a portal token for another invitation reaches that invitation's object and fails its nonce check", async () => {
    const { h } = await portalHarness();
    const now = Math.floor(h.clock.ms / 1000);
    const foreign = await signToken(
      h.key,
      lobbyClaims(now, { typ: 'portal', invitation_id: OTHER_INVITATION, exp: now + 600 }),
    );
    const res = await slots(h, foreign);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'token_invalid' });
    expect(h.otp.names.at(-1)).toBe(OTHER_INVITATION);
    expect(h.calls.filter((c) => c.method === 'portalSlots')).toEqual([]);
  });
});

describe('per-invitation portal buckets (R5-24) and no link limiter', () => {
  it('portal_slots allows its per-minute budget, then 429 rate_limited with Retry-After; a minute later it works', async () => {
    const { h, portal } = await portalHarness();
    for (let i = 0; i < PORTAL_LIMITS.portal_slots; i += 1) {
      expect((await slots(h, portal)).status).toBe(200);
    }
    const res = await slots(h, portal);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    // The reschedule bucket is its own, and the lobby buckets are untouched.
    expect((await reschedule(h, portal)).status).toBe(200);
    h.clock.ms += 60_000;
    expect((await slots(h, portal)).status).toBe(200);
  });

  it('portal_reschedule allows its per-minute budget, then 429', async () => {
    const { h, portal } = await portalHarness();
    for (let i = 0; i < PORTAL_LIMITS.portal_reschedule; i += 1) {
      expect((await reschedule(h, portal)).status).toBe(200);
    }
    const res = await reschedule(h, portal);
    expect(res.status).toBe(429);
    expect(h.calls.filter((c) => c.method === 'portalReschedule')).toHaveLength(
      PORTAL_LIMITS.portal_reschedule,
    );
  });

  it('the portal buckets live in the invitation object and do not touch the lobby budget', async () => {
    const h = await createHarness();
    const lobby = await h.login();
    h.clock.ms += 30_000;
    const portal = await h.loginPortal();
    for (let i = 0; i < PORTAL_LIMITS.portal_slots; i += 1) await slots(h, portal);
    expect((await h.request('GET', '/v1/lobby/notice', { token: lobby })).status).toBe(200);
    const kv = h.otp.kvs.get(INVITATION);
    expect(kv?.get('rate:portal_slots')).toMatchObject({ n: PORTAL_LIMITS.portal_slots });
  });

  it('the portal routes never call the ADR-032 link limiter', async () => {
    const { h, portal } = await portalHarness();
    const before = h.limiter.calls.length;
    await slots(h, portal);
    await reschedule(h, portal);
    expect(h.limiter.calls.length).toBe(before);
  });

  it('no Bearer or a malformed one is 401 before any object or api call', async () => {
    const h = await createHarness();
    for (const headers of [{}, { authorization: 'Basic abc' }, { authorization: 'Bearer x.y' }]) {
      const res = await h.request('GET', '/v1/portal/slots', { headers });
      expect(res.status).toBe(401);
    }
    expect(h.otp.names).toEqual([]);
    expect(h.calls).toEqual([]);
  });
});

describe('a rotated link (AT-M2-20 edge part, R2-4): only the latest link works', () => {
  it('after a reschedule rotates the link, the old link is 404 invalid_link on every link route', async () => {
    const link = { current: LINK() };
    const rotated = `${'R'.repeat(21)}${'n'.repeat(22)}`;
    const h = await createHarness({
      // api looks the link up by its hash; after the send rotated it, the old hash matches no invitation.
      inviteResolve: async (input) => {
        if (input.token !== link.current) throw new Error('invalid_link');
        return { invitationId: INVITATION, orgId: ORG, candidateId: INVITATION, state: 'sent' };
      },
      portalReschedule: async () => {
        link.current = rotated;
        return { ok: true, slotStartsAt: new Date(NOW_MS + 86_400_000).toISOString() };
      },
    });
    const portal = await h.loginPortal();
    expect((await reschedule(h, portal)).status).toBe(200);

    for (const [path, json] of [
      ['/v1/invite/resolve', { token: LINK() }],
      ['/v1/otp/request', { token: LINK() }],
      ['/v1/otp/verify', { token: LINK(), code: '123456' }],
    ] as const) {
      const res = await h.request('POST', path, { json });
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      expect(await res.json()).toEqual({ error: 'invalid_link' });
    }
    const fresh = await h.request('POST', '/v1/invite/resolve', { json: { token: rotated } });
    expect(fresh.status).toBe(200);
  });
});
