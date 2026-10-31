// The CandidateRpc client (specs/d1-demo-slice.md §4.2; security review bindings F6, F7): zod in and out, a missing
// binding fails closed, and every failure becomes one constant code.
import { describe, expect, it } from 'vitest';
import { candidateRpc, codeOf, RpcFailure, type CandidateRpcStub } from './rpc.js';

const INVITATION = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const CANDIDATE = '33333333-3333-4333-8333-333333333333';
const linkToken = (): string => 'A'.repeat(43);

const envWith = (api: Partial<CandidateRpcStub> | undefined): Env =>
  ({ VERSION: 'dev', API: api }) as unknown as Env;

const rejection = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(RpcFailure);
    return (err as RpcFailure).code;
  }
  throw new Error('expected a rejection');
};

describe('candidateRpc', () => {
  it('passes the validated input and returns the validated answer', async () => {
    const seen: unknown[] = [];
    const rpc = candidateRpc(
      envWith({
        inviteResolve: async (input) => {
          seen.push(input);
          return { invitationId: INVITATION, orgId: ORG, candidateId: CANDIDATE, state: 'sent' };
        },
      }),
    );

    const out = await rpc.call('inviteResolve', { token: linkToken() });

    expect(seen).toEqual([{ token: linkToken() }]);
    expect(out).toEqual({
      invitationId: INVITATION,
      orgId: ORG,
      candidateId: CANDIDATE,
      state: 'sent',
    });
  });

  it('refuses an input that does not fit the contract without calling api', async () => {
    let called = false;
    const rpc = candidateRpc(
      envWith({
        inviteResolve: async () => {
          called = true;
          return {};
        },
      }),
    );

    expect(await rejection(rpc.call('inviteResolve', { token: 'short' }))).toBe('bad_request');
    expect(called).toBe(false);
  });

  it('an answer with an extra key (a contact address) is unavailable, never passed on', async () => {
    const rpc = candidateRpc(
      envWith({
        inviteResolve: async () => ({
          invitationId: INVITATION,
          orgId: ORG,
          candidateId: CANDIDATE,
          state: 'sent',
          contact: ['pat', 'example.test'].join('@'),
        }),
      }),
    );

    expect(await rejection(rpc.call('inviteResolve', { token: linkToken() }))).toBe('unavailable');
  });

  it('a missing binding fails closed with unavailable', async () => {
    expect(
      await rejection(
        candidateRpc(envWith(undefined)).call('inviteResolve', { token: linkToken() }),
      ),
    ).toBe('unavailable');
  });

  it('a missing method fails closed with unavailable', async () => {
    expect(
      await rejection(candidateRpc(envWith({})).call('inviteResolve', { token: linkToken() })),
    ).toBe('unavailable');
  });

  it.each([
    ['invalid_link', 'invalid_link'],
    ['token_expired', 'token_expired'],
    ['not_eligible', 'not_eligible'],
    ['an unknown message', 'unavailable'],
    ['a message with data in it', 'unavailable'],
  ])('maps an api error %s to %s', async (label, expected) => {
    const message =
      label === 'an unknown message'
        ? 'Network connection lost.'
        : label === 'a message with data in it'
          ? `invalid_link for ${['pat', 'example.test'].join('@')}`
          : label;
    const rpc = candidateRpc(
      envWith({
        inviteResolve: async () => {
          throw new Error(message);
        },
      }),
    );

    expect(await rejection(rpc.call('inviteResolve', { token: linkToken() }))).toBe(expected);
  });

  // M2 (decision f): the portal methods are typed from PortalRpcSchemas and checked the same way.
  it('a portal method absent from the binding (api not yet deployed) fails closed with unavailable', async () => {
    const env = envWith({}) as Env;
    expect(
      await rejection(candidateRpc(env).call('portalSlots', { portalToken: 'aaa.bbb.ccc' })),
    ).toBe('unavailable');
  });

  it('portal answers are checked strictly: a slot with a seat count is unavailable', async () => {
    const env = {
      VERSION: 'dev',
      API: {
        portalSlots: async () => ({
          slots: [
            {
              slotId: INVITATION,
              startsAt: '2026-10-31T10:00:00.000Z',
              available: true,
              booked: 2,
            },
          ],
        }),
      },
    } as unknown as Env;
    expect(
      await rejection(candidateRpc(env).call('portalSlots', { portalToken: 'aaa.bbb.ccc' })),
    ).toBe('unavailable');
  });

  it('a portal input that does not fit (a bad slot id) is bad_request without calling api', async () => {
    let called = false;
    const env = {
      VERSION: 'dev',
      API: {
        portalReschedule: async () => {
          called = true;
          return {};
        },
      },
    } as unknown as Env;
    expect(
      await rejection(
        candidateRpc(env).call('portalReschedule', { portalToken: 'aaa.bbb.ccc', toSlotId: 'x' }),
      ),
    ).toBe('bad_request');
    expect(called).toBe(false);
  });

  it('codeOf maps a non-Error throw to unavailable', () => {
    expect(codeOf('invalid_link')).toBe('unavailable');
    expect(codeOf(null)).toBe('unavailable');
    expect(codeOf({ message: 'invalid_link' })).toBe('unavailable');
    expect(codeOf(new RpcFailure('otp_wrong'))).toBe('otp_wrong');
  });
});
