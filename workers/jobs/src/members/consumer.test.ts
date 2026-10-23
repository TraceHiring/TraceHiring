// The trace-admin queue consumer (specs/m1-test-authoring.md R5-13, R5-56 c, M1-20): a malformed message (roles in the
// message included) is acked and never logged; a settled invite is acked; an error retries; the last try settles the
// invite as failed; a report carries a constant error, never the address.
import type { SerializedError } from '@trace/shared/log';
import { beforeEach, describe, expect, it } from 'vitest';
import { FINAL_ATTEMPT, createMembersConsumer } from './consumer.js';
import { inviteEmailHmac } from './email-hmac.js';
import {
  EMAIL,
  INVITE,
  PEPPER,
  capturedLog,
  fakeAuth,
  fakeDb,
  invite,
  message,
  world,
} from './fakes.test-helpers.js';

interface Settled {
  acks: number;
  retries: number;
}

const fakeMessage = (body: unknown, attempts = 1): Message<unknown> & Settled => {
  const m = {
    id: 'm-1',
    timestamp: new Date(0),
    body,
    attempts,
    acks: 0,
    retries: 0,
    ack() {
      m.acks += 1;
    },
    retry() {
      m.retries += 1;
    },
  };
  return m;
};

const batchOf = (messages: readonly Message<unknown>[]): MessageBatch<unknown> => ({
  queue: 'trace-admin-dev',
  messages,
  metadata: { metrics: { backlogCount: 0, backlogBytes: 0, oldestMessageTimestamp: new Date(0) } },
  ackAll() {},
  retryAll() {},
});

const ENV = { VERSION: 'dev', TRACE_ENV: 'dev' } as unknown as Env;
const CTX = {} as ExecutionContext;

let HMAC = '';
beforeEach(async () => {
  HMAC = await inviteEmailHmac(EMAIL, PEPPER);
});

const setup = (w = world([invite({ email_hmac: HMAC })])) => {
  const db = fakeDb(w);
  const auth = fakeAuth();
  const { log, lines } = capturedLog();
  const reports: SerializedError[] = [];
  const consumer = createMembersConsumer(() => ({
    db,
    authAdmin: auth,
    pepper: PEPPER,
    log,
    reporter: { capture: (e) => reports.push(e) },
    release: 'dev',
  }));
  return { w, db, auth, lines, reports, consumer };
};

describe('createMembersConsumer', () => {
  it('acks a message that names roles (roles come from the invite row only) without provisioning', async () => {
    const { w, auth, lines, consumer } = setup();
    const m = fakeMessage({ ...message(), roles: ['org_owner'] });
    await consumer(batchOf([m]), ENV, CTX);
    expect(m.acks).toBe(1);
    expect(auth.calls()).toBe(0);
    expect(w.invites.get(INVITE)!.status).toBe('pending');
    expect(lines.join('\n')).toContain('members.message_invalid');
    expect(lines.join('\n')).not.toContain('example.test');
  });

  it('acks a provisioned invite and its re-delivery', async () => {
    const { w, consumer } = setup();
    const a = fakeMessage(message());
    const b = fakeMessage(message());
    await consumer(batchOf([a]), ENV, CTX);
    await consumer(batchOf([b]), ENV, CTX);
    expect([a.acks, b.acks]).toEqual([1, 1]);
    expect(w.memberships).toHaveLength(1);
  });

  it('retries on an Auth API error and reports a constant error without the address', async () => {
    const { w, auth, reports, lines, consumer } = setup();
    auth.failNext();
    const m = fakeMessage(message());
    await consumer(batchOf([m]), ENV, CTX);
    expect(m.retries).toBe(1);
    expect(w.invites.get(INVITE)!.status).toBe('pending');
    expect(reports).toHaveLength(1);
    expect(reports[0]!.code).toBe('member_invite_job_error');
    expect(JSON.stringify(reports)).not.toContain('example.test');
    expect(lines.join('\n')).not.toContain('example.test');
  });

  it('on the last try settles the invite as failed and acks', async () => {
    const { w, db, consumer } = setup();
    db.failOn('provision', true);
    const m = fakeMessage(message(), FINAL_ATTEMPT);
    await consumer(batchOf([m]), ENV, CTX);
    expect(m.acks).toBe(1);
    expect(w.invites.get(INVITE)!.status).toBe('failed');
  });

  it('retries on the last try when the invite cannot be settled either', async () => {
    const { db, consumer } = setup();
    db.failOn('loadInvite', true);
    db.failOn('markFailed', true);
    const m = fakeMessage(message(), FINAL_ATTEMPT);
    await consumer(batchOf([m]), ENV, CTX);
    expect(m.retries).toBe(1);
  });

  it('builds its dependencies from the invocation env', async () => {
    const seen: Env[] = [];
    const w = world([invite({ email_hmac: HMAC })]);
    const { log } = capturedLog();
    const consumer = createMembersConsumer((env) => {
      seen.push(env);
      return { db: fakeDb(w), authAdmin: fakeAuth(), pepper: PEPPER, log };
    });
    await consumer(batchOf([fakeMessage(message())]), ENV, CTX);
    expect(seen).toEqual([ENV]);
    expect(w.invites.get(INVITE)!.status).toBe('provisioned');
  });
});
