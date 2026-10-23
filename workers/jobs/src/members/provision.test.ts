// Member provisioning (specs/m1-test-authoring.md M1-20, R2-14, R5-56 c, R5-61 a, §4.5, §7 E26; AT-M1-26 with a fake
// admin API): the job checks HMAC(email, pepper) against the invite row before anything else, takes roles only from the
// row, finds an existing Auth user through the invite-bound lookup before creating one, is idempotent on re-delivery,
// and never logs or reports the address. The real schema is db-test/members.db.test.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { inviteEmailHmac } from './email-hmac.js';
import {
  EMAIL,
  INVITE,
  ORG,
  OTHER_ORG,
  PEPPER,
  capturedLog,
  fakeAuth,
  fakeDb,
  invite,
  message,
  seedAuthUser,
  world,
  type FakeWorld,
} from './fakes.test-helpers.js';
import { PEPPER_UNAVAILABLE, handleInviteMessage, type MembersDeps } from './provision.js';

let HMAC = '';
beforeEach(async () => {
  HMAC = await inviteEmailHmac(EMAIL, PEPPER);
});

const setup = (w: FakeWorld, patch: Partial<MembersDeps> = {}) => {
  const db = fakeDb(w);
  const auth = fakeAuth(w);
  const { log, lines } = capturedLog();
  const deps: MembersDeps = { db, authAdmin: auth, pepper: PEPPER, log, ...patch };
  return { deps, db, auth, lines };
};

describe('handleInviteMessage: provisioning (AT-M1-26)', () => {
  it('creates the Auth user and an invited membership with the roles of the invite row', async () => {
    const w = world([invite({ email_hmac: HMAC, roles: ['recruiter', 'reviewer'] })]);
    const { deps, db, auth } = setup(w);
    expect(await handleInviteMessage(message(), deps)).toBe('provisioned');
    expect(db.orgs.every((o) => o === ORG)).toBe(true);
    expect(auth.calls()).toBe(1);
    expect(w.memberships).toHaveLength(1);
    expect(w.memberships[0]).toMatchObject({
      roles: ['recruiter', 'reviewer'],
      status: 'invited',
      display_name: '[synthetic] Invitee',
      user_id: auth.users.get(EMAIL),
    });
    expect(w.invites.get(INVITE)).toMatchObject({
      status: 'provisioned',
      membership_id: w.memberships[0]!.id,
    });
  });

  it('matches the HMAC of the normalised address (trimmed, lower case)', async () => {
    const w = world([invite({ email_hmac: HMAC })]);
    expect(
      await handleInviteMessage(message({ email: ' P-Invitee@Example.TEST ' }), setup(w).deps),
    ).toBe('provisioned');
  });

  it('E26: finds an Auth user that already exists through the lookup and never creates one', async () => {
    const w = world([invite({ email_hmac: HMAC })]);
    const { deps, auth } = setup(w);
    const existing = seedAuthUser(w, ' P-Invitee@Example.TEST');
    expect(await handleInviteMessage(message(), deps)).toBe('provisioned');
    expect(w.memberships[0]!.user_id).toBe(existing);
    expect(auth.users.size).toBe(1);
    expect(auth.calls()).toBe(0);
  });

  it('E26: a user who already belongs to another org is provisioned into this one', async () => {
    const w = world([invite({ email_hmac: HMAC })]);
    const { deps, auth } = setup(w);
    const existing = seedAuthUser(w, EMAIL);
    w.memberships.push({
      id: '4a1c7e2d-8b36-4f5a-9d04-6b1f3c85a2ab',
      org_id: OTHER_ORG,
      user_id: existing,
      roles: ['admin'],
      workspace_id: null,
      display_name: '[synthetic] Elsewhere',
      status: 'active',
    });
    expect(await handleInviteMessage(message(), deps)).toBe('provisioned');
    expect(w.memberships.filter((m) => m.org_id === ORG)).toMatchObject([
      { user_id: existing, status: 'invited' },
    ]);
    expect(auth.calls()).toBe(0);
  });
});

describe('handleInviteMessage: the HMAC check comes first', () => {
  it('an address that does not match the invite fails the invite and never reaches the Auth API', async () => {
    const w = world([invite({ email_hmac: HMAC })]);
    const { deps, auth } = setup(w);
    expect(await handleInviteMessage(message({ email: 'p-other@example.test' }), deps)).toBe(
      'failed',
    );
    expect(auth.calls()).toBe(0);
    expect(w.memberships).toHaveLength(0);
    expect(w.invites.get(INVITE)!.status).toBe('failed');
  });

  it('another pepper never matches', async () => {
    const w = world([invite({ email_hmac: HMAC })]);
    const { deps, auth } = setup(w, { pepper: `${PEPPER}-other` });
    expect(await handleInviteMessage(message(), deps)).toBe('failed');
    expect(auth.calls()).toBe(0);
  });

  it('without a pepper of at least 32 bytes it fails closed: a constant error, nothing changed, no Auth call', async () => {
    const w = world([invite({ email_hmac: HMAC })]);
    for (const pepper of [undefined, '', 'x'.repeat(31), 'é'.repeat(15)]) {
      const { deps, auth } = setup(w, { pepper });
      await expect(handleInviteMessage(message(), deps)).rejects.toThrow(PEPPER_UNAVAILABLE);
      expect(auth.calls()).toBe(0);
    }
    expect(w.invites.get(INVITE)!.status).toBe('pending');
  });
});

describe('handleInviteMessage: exactly once', () => {
  it('a re-delivery of a provisioned invite is skipped without an Auth call', async () => {
    const w = world([invite({ email_hmac: HMAC })]);
    await handleInviteMessage(message(), setup(w).deps);
    const again = setup(w);
    expect(await handleInviteMessage(message(), again.deps)).toBe('skipped');
    expect(again.auth.calls()).toBe(0);
    expect(w.memberships).toHaveLength(1);
  });

  it('a delivery that died after creating the user provisions the same user on the next try', async () => {
    const w = world([invite({ email_hmac: HMAC })]);
    const { deps, db, auth } = setup(w);
    db.failOn('provision');
    await expect(handleInviteMessage(message(), deps)).rejects.toThrow();
    expect(w.invites.get(INVITE)!.status).toBe('pending');
    expect(auth.calls()).toBe(1);
    const created = auth.users.get(EMAIL);
    expect(await handleInviteMessage(message(), deps)).toBe('provisioned');
    expect(auth.calls()).toBe(1);
    expect(auth.users.size).toBe(1);
    expect(w.memberships).toHaveLength(1);
    expect(w.memberships[0]!.user_id).toBe(created);
  });

  it('an invite cancelled after the HMAC check is refused by the lookup before any Auth call', async () => {
    const w = world([invite({ email_hmac: HMAC })]);
    const { deps, db, auth } = setup(w);
    let runs = 0;
    const cancelling = {
      ...deps,
      db: {
        run: async <T>(o: string, fn: Parameters<typeof db.run<T>>[1]): Promise<T> => {
          runs += 1;
          if (runs === 2) w.invites.get(INVITE)!.status = 'cancelled';
          return db.run(o, fn);
        },
      },
    };
    expect(await handleInviteMessage(message(), cancelling)).not.toBe('provisioned');
    expect(auth.calls()).toBe(0);
    expect(w.invites.get(INVITE)!.status).toBe('cancelled');
    expect(w.memberships).toHaveLength(0);
  });

  it.each(['cancelled', 'failed'] as const)(
    'a %s invite is skipped and creates no user',
    async (status) => {
      const w = world([invite({ email_hmac: HMAC, status })]);
      const { deps, auth } = setup(w);
      expect(await handleInviteMessage(message(), deps)).toBe('skipped');
      expect(auth.calls()).toBe(0);
    },
  );

  it('an unknown invite, or one of another org (RLS hides it), is skipped', async () => {
    const w = world([invite({ email_hmac: HMAC, org_id: '4a1c7e2d-8b36-4f5a-9d04-6b1f3c85a2ff' })]);
    const { deps, auth } = setup(w);
    expect(await handleInviteMessage(message(), deps)).toBe('skipped');
    expect(auth.calls()).toBe(0);
  });
});

describe('handleInviteMessage: refusals settle the invite as failed', () => {
  it('R2-14: an inviter who is no longer an active admin fails the invite', async () => {
    const w = world([invite({ email_hmac: HMAC })]);
    w.activeAdmins.clear();
    expect(await handleInviteMessage(message(), setup(w).deps)).toBe('failed');
    expect(w.invites.get(INVITE)!.status).toBe('failed');
    expect(w.memberships).toHaveLength(0);
  });

  it('E26: a user who already holds a live membership of the org fails the invite', async () => {
    const w = world([invite({ email_hmac: HMAC })]);
    const { deps } = setup(w);
    const user = seedAuthUser(w, EMAIL);
    w.memberships.push({
      id: '4a1c7e2d-8b36-4f5a-9d04-6b1f3c85a2aa',
      org_id: ORG,
      user_id: user,
      roles: ['reviewer'],
      workspace_id: null,
      display_name: '[synthetic] Earlier',
      status: 'active',
    });
    expect(await handleInviteMessage(message(), deps)).toBe('failed');
    expect(w.invites.get(INVITE)!.status).toBe('failed');
  });

  it('an Auth API failure throws (the message is retried) and leaves the invite pending', async () => {
    const w = world([invite({ email_hmac: HMAC })]);
    const { deps, auth } = setup(w);
    auth.failNext();
    await expect(handleInviteMessage(message(), deps)).rejects.toThrow();
    expect(w.invites.get(INVITE)!.status).toBe('pending');
  });

  it('a database error that is not a guard refusal throws (retried), the invite stays pending', async () => {
    const w = world([invite({ email_hmac: HMAC })]);
    const { deps, db } = setup(w);
    db.failOn('loadInvite');
    await expect(handleInviteMessage(message(), deps)).rejects.toThrow();
    expect(w.invites.get(INVITE)!.status).toBe('pending');
  });
});

describe('handleInviteMessage: the address never reaches a log', () => {
  it('logs ids and outcomes only, on every path', async () => {
    const paths: [FakeWorld, Partial<MembersDeps>, string][] = [
      [world([invite({ email_hmac: HMAC })]), {}, EMAIL],
      [world([invite({ email_hmac: HMAC })]), {}, 'p-mismatch@example.test'],
      [world([invite({ email_hmac: HMAC, status: 'cancelled' })]), {}, EMAIL],
    ];
    for (const [w, patch, email] of paths) {
      const { deps, lines } = setup(w, patch);
      await handleInviteMessage(message({ email }), deps);
      const text = lines.join('\n');
      expect(text).not.toContain('example.test');
      expect(text).not.toContain('invitee');
      expect(text).not.toContain('Invitee');
      expect(text).not.toContain(HMAC);
    }
  });
});
