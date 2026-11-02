// AT-D11 (a)-(c), edge part (rule 5; specs/d1-demo-slice.md §4.2 common rules, §4.8; L-22): a session token with any
// claim edited and the original signature is 401 on the session routes; with a valid token A, ids of session B in
// the URL, query or body are ignored, A's own session is served, the only object addressed is A's and B's object is
// never touched; token A can neither read nor submit B's session nor obtain B's receipt.
import { describe, expect, it } from 'vitest';
import { base64UrlDecode, base64UrlEncode, utf8 } from './encoding.js';
import { fakeSession } from './edge.test-helpers.js';
import {
  heartbeat,
  installPackage,
  postEvents,
  sessionHarness,
  startInput,
  type SessionRouteHarness,
} from './session.test-helpers.js';
import { CANDIDATE, INVITATION, OTHER_INVITATION, ORG, signToken } from './token.test-helpers.js';

const SESSION_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NONCE_B = 'session-nonce-bbbb-abcdef';

/** A second candidate's running session B, created directly in its own object (never through A's routes). */
const withSessionB = async (h: SessionRouteHarness) => {
  const b = fakeSession({
    clock: h.clock,
    evidence: h.evidence,
    packages: h.packages,
    queue: h.queue,
    sink: () => undefined,
  });
  const sha = await installPackage(h.packages);
  const started = await b.core.start(
    startInput(sha, { invitationId: OTHER_INVITATION, sessionId: SESSION_B, nonce: NONCE_B }),
  );
  if (!started.ok || started.kind !== 'live') throw new Error('B did not start');
  // The fakes number stream ids per object; one attach gives B a stream id that A's object never issued.
  const attached = await b.core.attach({ nonce: NONCE_B, orgId: ORG });
  if (!attached.ok) throw new Error('B did not attach');
  h.session.sessions.set(OTHER_INVITATION, b);
  const snapshot = () => JSON.stringify([...b.kv.map.entries()]);
  return { b, streamB: attached.view.streamId, snapshot };
};

/** Re-encodes the token's claims with `edit` applied and keeps the original header and signature. */
const editClaims = (token: string, edit: Record<string, unknown>): string => {
  const [h, p, s] = token.split('.') as [string, string, string];
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(p))) as Record<
    string,
    unknown
  >;
  return `${h}.${base64UrlEncode(utf8(JSON.stringify({ ...claims, ...edit })))}.${s}`;
};

describe('AT-D11 (a): an edited session token is refused', () => {
  it.each([
    ['org_id', { org_id: '55555555-5555-4555-8555-555555555555' }],
    ['invitation_id', { invitation_id: OTHER_INVITATION }],
    ['sub', { sub: '55555555-5555-4555-8555-555555555555' }],
    ['typ', { typ: 'lobby' }],
  ])('a token with %s edited is 401 and no object is addressed', async (_claim, edit) => {
    const h = await sessionHarness();
    const { token } = await h.startSession();
    const before = h.session.names.length;
    const res = await h.request('POST', '/v1/session/attach', { token: editClaims(token, edit) });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'token_invalid' });
    expect(h.session.names.length).toBe(before);
  });
});

describe("AT-D11 (b): B's ids in the URL, query or body are ignored", () => {
  it("serves A's own session; B's object is never addressed or changed", async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    const { snapshot } = await withSessionB(h);
    const bBefore = snapshot();

    const attached = await h.request(
      'POST',
      `/v1/session/attach?invitationId=${OTHER_INVITATION}`,
      {
        token,
        json: { invitationId: OTHER_INVITATION, sessionId: SESSION_B, orgId: ORG },
      },
    );
    expect(attached.status).toBe(200);
    const shown = ((await attached.json()) as { view: { sessionId: string } }).view;
    expect(shown.sessionId).toBe(view.sessionId);

    h.clock.ms += 1000;
    const ev = await h.request('POST', `/v1/session/events?sessionId=${SESSION_B}`, {
      token,
      json: {
        streamId: (shown as unknown as { streamId: string }).streamId,
        events: [heartbeat(1)],
        invitationId: OTHER_INVITATION,
        sessionId: SESSION_B,
      },
    });
    expect(ev.status).toBe(200);

    expect(new Set(h.session.names)).toEqual(new Set([INVITATION]));
    expect(snapshot()).toBe(bBefore);
  });

  it("B's stream id in A's body is refused by A's own object (400), and B is untouched", async () => {
    const h = await sessionHarness();
    const { token } = await h.startSession();
    const { streamB, snapshot } = await withSessionB(h);
    const bBefore = snapshot();

    const ev = await postEvents(h, token, streamB, [heartbeat(1)]);
    expect(ev.status).toBe(400);
    const submit = await h.request('POST', '/v1/session/submit', {
      token,
      json: { streamId: streamB, finalSeq: 0 },
    });
    expect(submit.status).toBe(400);

    expect(snapshot()).toBe(bBefore);
    expect(new Set(h.session.names)).toEqual(new Set([INVITATION]));
  });
});

describe("AT-D11 (c): token A never reaches B's session or receipt", () => {
  it("A's submit and start return only A's receipt, never B's", async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    const { b, streamB } = await withSessionB(h);
    const bDone = await b.core.submit(
      { nonce: NONCE_B, orgId: ORG },
      { streamId: streamB, finalSeq: 0 },
    );
    if (!bDone.ok) throw new Error('B did not submit');

    h.clock.ms += 2000;
    const res = await h.request('POST', '/v1/session/submit', {
      token,
      json: { streamId: view.streamId, finalSeq: 0, sessionId: SESSION_B },
    });
    const receiptA = (await res.json()) as { receiptRef: string };
    expect(res.status).toBe(200);
    expect(receiptA.receiptRef).not.toBe(bDone.receipt.receiptRef);

    h.clock.ms += 60_000;
    const lobby = await h.login();
    const again = await h.request('POST', '/v1/session/start', {
      token: lobby,
      json: {
        rulesAcknowledged: true,
        photo: { skippedReason: 'declined' },
        invitationId: OTHER_INVITATION,
      },
    });
    expect(await again.json()).toEqual({ state: 'submitted', receipt: receiptA });
    expect(new Set(h.session.names)).toEqual(new Set([INVITATION]));
  });

  it("a validly signed token for B's invitation without B's current nonce is refused by B's object", async () => {
    const h = await sessionHarness();
    await h.startSession();
    const { snapshot } = await withSessionB(h);
    const bBefore = snapshot();
    const iat = Math.floor(h.clock.ms / 1000);
    const forged = await signToken(h.key, {
      sub: CANDIDATE,
      candidate_id: CANDIDATE,
      invitation_id: OTHER_INVITATION,
      org_id: ORG,
      typ: 'session',
      nonce: 'session-nonce-zzzz-abcdef',
      iat,
      exp: iat + 3600,
    });
    const res = await h.request('POST', '/v1/session/attach', { token: forged });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'superseded' });
    expect(snapshot()).toBe(bBefore);
  });
});
