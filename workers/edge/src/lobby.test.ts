// Lobby routes (specs/d1-demo-slice.md §4.1 steps 3-4, §4.2): Bearer lobby token, nonce and the 10/min limit in
// InviteOtpDO, api called with the raw token; under-18 is 403 not_eligible (rule 9); ids only from verified claims.
import { describe, expect, it } from 'vitest';
import { createHarness, NOTICE_ID, NOTICE_SHA } from './edge.test-helpers.js';
import { CANDIDATE, INVITATION, lobbyClaims, ORG, signToken } from './token.test-helpers.js';

describe('POST /v1/lobby/age', () => {
  it('passes the raw lobby token and the answer to api, answers {ok:true}', async () => {
    const h = await createHarness();
    const token = await h.login();
    const res = await h.request('POST', '/v1/lobby/age', { token, json: { adult: true } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true });
    expect(h.calls.at(-1)).toEqual({
      method: 'ageDeclare',
      input: { lobbyToken: token, adult: true },
    });
  });

  it('an under-18 answer is 403 not_eligible (rule 9)', async () => {
    const h = await createHarness();
    const token = await h.login();
    const res = await h.request('POST', '/v1/lobby/age', { token, json: { adult: false } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_eligible' });
  });

  it.each([
    ['no token', undefined, { adult: true }],
    ['a body with an unknown key', 'TOKEN', { adult: true, age: 17 }],
    ['a non-boolean answer', 'TOKEN', { adult: 'yes' }],
  ])('refuses %s', async (label, token, json) => {
    const h = await createHarness();
    const lobby = await h.login();
    const before = h.calls.length;
    const res = await h.request('POST', '/v1/lobby/age', {
      ...(token === undefined ? {} : { token: lobby }),
      json,
    });
    expect(res.status).toBe(label === 'no token' ? 401 : 400);
    expect(h.calls.length).toBe(before);
  });

  it('api step and state errors pass through as their constant codes', async () => {
    const h = await createHarness({
      ageDeclare: async () => {
        throw new Error('step_required');
      },
    });
    const token = await h.login();
    const res = await h.request('POST', '/v1/lobby/age', { token, json: { adult: true } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'step_required' });
  });

  it('10 per minute per invitation, then 429 rate_limited with Retry-After', async () => {
    const h = await createHarness();
    const token = await h.login();
    for (let i = 0; i < 10; i += 1) {
      const ok = await h.request('POST', '/v1/lobby/age', { token, json: { adult: true } });
      expect(ok.status).toBe(200);
    }
    const res = await h.request('POST', '/v1/lobby/age', { token, json: { adult: true } });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(await res.json()).toEqual({ error: 'rate_limited' });
  });

  it('a too-large body is 413 before parsing', async () => {
    const h = await createHarness();
    const token = await h.login();
    const res = await h.request('POST', '/v1/lobby/age', {
      token,
      body: JSON.stringify({ adult: true, pad: 'x'.repeat(5000) }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(413);
  });
});

describe('GET /v1/lobby/notice and POST /v1/lobby/consent', () => {
  it('returns the notice from api, checked against NoticeRes', async () => {
    const h = await createHarness();
    const token = await h.login();
    const res = await h.request('GET', '/v1/lobby/notice', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      noticeVersionId: NOTICE_ID,
      language: 'en',
      bodyText: 'Synthetic notice text.',
      renderedSha256: NOTICE_SHA,
    });
  });

  it('a notice answer with an extra key is 503, never passed on', async () => {
    const h = await createHarness({
      noticeGet: async () => ({
        noticeVersionId: NOTICE_ID,
        language: 'en',
        bodyText: 'x',
        renderedSha256: NOTICE_SHA,
        orgName: 'Synthetic Org',
      }),
    });
    const token = await h.login();
    const res = await h.request('GET', '/v1/lobby/notice', { token });
    expect(res.status).toBe(503);
  });

  it('records consent through api with the token and the hash the candidate saw', async () => {
    const h = await createHarness();
    const token = await h.login();
    const json = { noticeVersionId: NOTICE_ID, renderedSha256: NOTICE_SHA, accepted: true };
    const res = await h.request('POST', '/v1/lobby/consent', { token, json });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.calls.at(-1)).toEqual({
      method: 'consentRecord',
      input: { lobbyToken: token, ...json },
    });
  });

  it('consent needs accepted: true', async () => {
    const h = await createHarness();
    const token = await h.login();
    const res = await h.request('POST', '/v1/lobby/consent', {
      token,
      json: { noticeVersionId: NOTICE_ID, renderedSha256: NOTICE_SHA, accepted: false },
    });
    expect(res.status).toBe(400);
  });

  it('identity keys in the body are discarded; the object used is the claims invitation', async () => {
    const h = await createHarness();
    const token = await h.login();
    const other = '99999999-9999-4999-8999-999999999999';
    h.otp.names.length = 0;
    const res = await h.request('POST', '/v1/lobby/consent', {
      token,
      json: {
        noticeVersionId: NOTICE_ID,
        renderedSha256: NOTICE_SHA,
        accepted: true,
        invitationId: other,
        orgId: other,
        sessionId: other,
        candidateId: other,
      },
    });
    expect(res.status).toBe(200);
    expect(h.otp.names).toEqual([INVITATION]);
    expect(JSON.stringify(h.calls.at(-1))).not.toContain(other);
  });
});

describe('lobby token checks on every lobby route', () => {
  it('a token for another invitation reaches that invitation object and fails its nonce check', async () => {
    const h = await createHarness();
    await h.login();
    const other = '77777777-7777-4777-8777-777777777777';
    const nowSec = Math.floor(h.clock.ms / 1000);
    const forged = await signToken(
      h.key,
      lobbyClaims(nowSec, { invitation_id: other, org_id: ORG, sub: CANDIDATE }),
    );
    const res = await h.request('GET', '/v1/lobby/notice', { token: forged });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'token_invalid' });
    expect(h.calls.some((c) => c.method === 'noticeGet')).toBe(false);
  });
});
