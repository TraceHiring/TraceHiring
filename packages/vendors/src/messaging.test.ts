// Messaging interface and the demo-outbox mock (specs/d1-demo-slice.md §5.3, D1-1, D1-2, L-11; AT-D18).
// The mock must never run in production and never accept an address outside @example.test. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  DEMO_RECIPIENT_RE,
  InMemoryOutboxStore,
  MessagingInputError,
  MessagingMockInProductionError,
  OutboxMessaging,
  createMessaging,
} from './index.js';
import type { Messaging, OutboundMessage, OutboxEntry, OutboxStore } from './index.js';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-0000000000b2';

const message = (patch: Partial<OutboundMessage> = {}): OutboundMessage => ({
  orgId: ORG_A,
  kind: 'otp',
  to: 'candidate.1@example.test',
  subject: 'Your sign-in code',
  bodyText: 'Your code is in this synthetic message.',
  idempotencyKey: 'inv-1:otp:1',
  ...patch,
});

/** A store that records calls, to prove a refused message never reaches it. */
class SpyStore implements OutboxStore {
  readonly appended: OutboxEntry[] = [];
  readonly inner = new InMemoryOutboxStore();
  append(e: OutboxEntry) {
    this.appended.push(e);
    return this.inner.append(e);
  }
  list(orgId: string, limit: number) {
    return this.inner.list(orgId, limit);
  }
}

describe('production guard (fails closed)', () => {
  it("createMessaging('production') throws MessagingMockInProductionError", () => {
    expect(() => createMessaging('production', new InMemoryOutboxStore())).toThrow(
      MessagingMockInProductionError,
    );
  });

  it("the OutboxMessaging constructor throws for 'production' too", () => {
    expect(() => new OutboxMessaging('production', new InMemoryOutboxStore())).toThrow(
      MessagingMockInProductionError,
    );
  });

  it.each([
    undefined,
    null,
    '',
    'prod',
    'Production',
    'PRODUCTION',
    'live',
    'test',
    ' dev',
    42,
    {},
  ])('refuses any environment other than dev or staging (%s)', (env) => {
    expect(() => createMessaging(env as never, new InMemoryOutboxStore())).toThrow(
      MessagingMockInProductionError,
    );
    expect(() => new OutboxMessaging(env as never, new InMemoryOutboxStore())).toThrow(
      MessagingMockInProductionError,
    );
  });

  it.each(['dev', 'staging'] as const)('allows %s', (env) => {
    expect(createMessaging(env, new InMemoryOutboxStore())).toBeInstanceOf(OutboxMessaging);
  });

  it('refuses a missing store', () => {
    expect(() => createMessaging('dev', undefined as never)).toThrow(MessagingInputError);
  });
});

describe('recipient guard (@example.test only, D1-1)', () => {
  it.each([
    'candidate.1@example.test',
    'a@example.test',
    'x+tag_1-b.c@example.test',
    `${'a'.repeat(64)}@example.test`,
  ])('accepts %s', async (to) => {
    const m = createMessaging('dev', new InMemoryOutboxStore());
    await expect(m.send(message({ to }))).resolves.toEqual({
      id: expect.any(String),
      status: 'queued',
    });
  });

  it.each([
    'someone@gmail.com',
    'candidate@example.com',
    'candidate@example.test.evil.com',
    'candidate@sub.example.test',
    'Candidate@example.test',
    'candidate@EXAMPLE.TEST',
    ' candidate@example.test',
    'candidate@example.test ',
    'candidate@example.test\n',
    'a@b@example.test',
    '@example.test',
    `${'a'.repeat(65)}@example.test`,
    'candidate@example.test,victim@example.com',
    '',
  ])('refuses %j without reaching the store', async (to) => {
    const store = new SpyStore();
    const m = createMessaging('staging', store);
    await expect(m.send(message({ to }))).rejects.toThrow(MessagingInputError);
    expect(store.appended).toEqual([]);
  });

  it('the exported pattern is the spec pattern', () => {
    expect(DEMO_RECIPIENT_RE.source).toBe('^[a-z0-9._+-]{1,64}@example\\.test$');
    expect(DEMO_RECIPIENT_RE.flags).toBe('');
  });

  it('never echoes the address, subject or body in an error', async () => {
    const m = createMessaging('dev', new InMemoryOutboxStore());
    const marker = 'zzsyntheticmarker';
    for (const patch of [{ to: `${marker}@example.com` }, { subject: `${marker}\r\nBcc: x` }]) {
      try {
        await m.send(message({ ...patch, bodyText: `code ${marker}` }));
        throw new Error('send accepted an invalid message');
      } catch (error) {
        expect(error).toBeInstanceOf(MessagingInputError);
        expect((error as Error).message).not.toContain(marker);
      }
    }
  });
});

describe('message validation', () => {
  it.each<[string, unknown]>([
    ['a non-object', 'x'],
    ['an extra key', { ...message(), cc: 'other@example.test' }],
    ['a missing key', { ...message(), idempotencyKey: undefined }],
    ['an unknown kind', message({ kind: 'sms' as never })],
    ['an empty org id', message({ orgId: '' })],
    ['an empty subject', message({ subject: '' })],
    ['a subject with a line break', message({ subject: 'a\nb' })],
    ['a subject over 200 characters', message({ subject: 's'.repeat(201) })],
    ['an empty body', message({ bodyText: '' })],
    ['a body over 5000 characters', message({ bodyText: 'b'.repeat(5001) })],
    ['an empty idempotency key', message({ idempotencyKey: '' })],
    ['an idempotency key over 200 characters', message({ idempotencyKey: 'k'.repeat(201) })],
  ])('refuses %s', async (_label, raw) => {
    const store = new SpyStore();
    const m = createMessaging('dev', store);
    await expect(m.send(raw as OutboundMessage)).rejects.toThrow(MessagingInputError);
    expect(store.appended).toEqual([]);
  });
});

describe('outbox writes and idempotency', () => {
  it('writes the message to the store and lists it for its org only', async () => {
    const store = new InMemoryOutboxStore();
    const m: Messaging = createMessaging('dev', store);
    const sent = await m.send(message());
    const listed = await store.list(ORG_A, 10);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ ...message(), id: sent.id });
    expect(typeof listed[0]!.createdAt).toBe('string');
    expect(await store.list(ORG_B, 10)).toEqual([]);
  });

  it('the same idempotency key returns the same id and writes once', async () => {
    const store = new InMemoryOutboxStore();
    const m = createMessaging('staging', store);
    const first = await m.send(message());
    const second = await m.send(message({ bodyText: 'A different synthetic body.' }));
    expect(second.id).toBe(first.id);
    const listed = await store.list(ORG_A, 10);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.bodyText).toBe(message().bodyText);
  });

  it('concurrent sends with one key write once', async () => {
    const store = new InMemoryOutboxStore();
    const m = createMessaging('dev', store);
    const results = await Promise.all([1, 2, 3, 4].map(() => m.send(message())));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await store.list(ORG_A, 10)).toHaveLength(1);
  });

  it('the same key in another org is a different message', async () => {
    const store = new InMemoryOutboxStore();
    const m = createMessaging('dev', store);
    const a = await m.send(message());
    const b = await m.send(message({ orgId: ORG_B }));
    expect(b.id).not.toBe(a.id);
  });

  it('different keys give different ids; list is newest first and honours the limit', async () => {
    let t = 0;
    const store = new InMemoryOutboxStore({ now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)) });
    const m = createMessaging('dev', store);
    const ids = [];
    for (const key of ['k1', 'k2', 'k3'])
      ids.push((await m.send(message({ idempotencyKey: key }))).id);
    expect(new Set(ids).size).toBe(3);
    const listed = await store.list(ORG_A, 2);
    expect(listed.map((e) => e.idempotencyKey)).toEqual(['k3', 'k2']);
    expect(listed[0]!.createdAt).toBe('2026-01-01T00:00:02.000Z');
  });

  it('list returns copies (a caller cannot edit the outbox)', async () => {
    const store = new InMemoryOutboxStore();
    await createMessaging('dev', store).send(message());
    const [entry] = await store.list(ORG_A, 1);
    entry!.bodyText = 'edited';
    expect((await store.list(ORG_A, 1))[0]!.bodyText).toBe(message().bodyText);
  });

  it.each([0, -1, 1.5, 101, Number.NaN])('list refuses limit %s', async (limit) => {
    await expect(new InMemoryOutboxStore().list(ORG_A, limit)).rejects.toThrow(MessagingInputError);
  });
});
