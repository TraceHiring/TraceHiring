// AT-D18 (api half): the demo outbox never reaches production or a real address, and stores no address
// (spec D1-1, D1-2, L-11). The store runs on a fake of the DO SQLite surface that interprets only OUTBOX_SQL; a
// real-DO test needs the OUTBOX binding in the test pool's config (lead request).
import { describe, expect, it } from 'vitest';
import { OUTBOX_KEEP, OutboxStore } from './outbox-store.js';
import { fakeOutboxNamespace, fakeOutboxSql } from './outbox.test-helpers.js';
import { createDemoOutbox, demoOutboxEnabled } from './outbox-writer.js';

const ORG = '11111111-1111-4111-8111-111111111111';

const message = (to = 'cand01@example.test', key = 'k1') => ({
  kind: 'otp' as const,
  to,
  candidateLabel: 'Candidate 1',
  bodyText: 'Your Trace sign-in code is 123456.',
  idempotencyKey: key,
});

describe('demoOutboxEnabled', () => {
  it.each([
    [{ TRACE_ENV: 'dev', DEMO_OUTBOX: '1' }, true],
    [{ TRACE_ENV: 'staging', DEMO_OUTBOX: '1' }, true],
    [{ TRACE_ENV: 'production', DEMO_OUTBOX: '1' }, false],
    [{ TRACE_ENV: 'staging', DEMO_OUTBOX: '0' }, false],
    [{ DEMO_OUTBOX: '1' }, false],
    [{ TRACE_ENV: '', DEMO_OUTBOX: '1' }, false],
  ])('%j -> %s', (env, expected) => {
    expect(demoOutboxEnabled(env)).toBe(expected);
  });
});

describe('createDemoOutbox', () => {
  it('has no writer in production, with the switch off, or without the binding', () => {
    const ns = fakeOutboxNamespace();
    expect(createDemoOutbox({ TRACE_ENV: 'production', DEMO_OUTBOX: '1' }, ns)).toBeNull();
    expect(createDemoOutbox({ TRACE_ENV: 'staging' }, ns)).toBeNull();
    expect(createDemoOutbox({ TRACE_ENV: 'staging', DEMO_OUTBOX: '1' }, undefined)).toBeNull();
  });

  it('refuses a recipient outside @example.test and writes nothing', async () => {
    const ns = fakeOutboxNamespace();
    const outbox = createDemoOutbox({ TRACE_ENV: 'dev', DEMO_OUTBOX: '1' }, ns);
    for (const to of ['someone@gmail.com', 'cand01@example.test.evil.com', 'CAND@example.test']) {
      await expect(outbox?.write(ORG, message(to))).rejects.toThrow(/^outbox_recipient_refused$/);
    }
    expect(ns.stores.size).toBe(0);
  });

  it('writes one entry per idempotency key, per org, newest first, and stores no address', async () => {
    const ns = fakeOutboxNamespace();
    const outbox = createDemoOutbox({ TRACE_ENV: 'dev', DEMO_OUTBOX: '1' }, ns);
    await outbox?.write(ORG, message('cand01@example.test', 'k1'));
    await outbox?.write(ORG, message('cand01@example.test', 'k1'));
    await outbox?.write(ORG, { ...message('cand01@example.test', 'k2'), kind: 'invite' });
    const entries = (await outbox?.list(ORG)) ?? [];
    expect(entries.map((e) => e.kind)).toEqual(['invite', 'otp']);
    expect(JSON.stringify(entries)).not.toContain('@example.test');
    expect(await outbox?.list('22222222-2222-4222-8222-222222222222')).toEqual([]);
  });
});

describe('OutboxStore', () => {
  it('keeps at most OUTBOX_KEEP entries', () => {
    const sql = fakeOutboxSql();
    const store = new OutboxStore(sql);
    for (let i = 0; i < OUTBOX_KEEP + 5; i += 1) {
      store.append(
        { kind: 'otp', candidateLabel: 'Candidate 1', bodyText: 'x', idempotencyKey: `k${i}` },
        `id${i}`,
        '2026-10-17T08:00:00.000Z',
      );
    }
    expect(sql.rows.length).toBe(OUTBOX_KEEP);
    expect(store.list(1)[0]?.id).toBe(`id${OUTBOX_KEEP + 4}`);
  });
});
