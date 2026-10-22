/// <reference types="@cloudflare/vitest-pool-workers/types" />
// C1a SR-6 (api half): the real DemoOutboxDO class over its own SQLite storage (`ctx.storage.sql`) in the `api-do` pool
// of vitest.config.ts. OutboxStore's logic is covered on a fake in outbox.test.ts; this proves the wrapper wires it:
// an idempotent append and list, and the zod refusal of an entry that carries anything but a synthetic label. The
// pool's exact binding set is pinned here too (security review F1). Synthetic data only.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const outbox = (org: string = crypto.randomUUID()) => {
  const ns = env.OUTBOX;
  if (ns === undefined) throw new Error('the api-do pool has no OUTBOX binding');
  return ns.get(ns.idFromName(org));
};

describe('api-do test pool (never deployed)', () => {
  it('is bound to exactly the top-level vars and the two Durable Objects', () => {
    const bindings = Object.keys(env).filter((name) => !name.startsWith('__VITEST_POOL_WORKERS_'));

    expect(bindings.sort()).toEqual(['MEDIA_LINKS', 'OUTBOX', 'SENTRY_DSN_WORKERS', 'VERSION']);
  });
});

describe('DemoOutboxDO (real class, SQLite-backed storage)', () => {
  it('appends once per idempotency key and lists the entry', async () => {
    const stub = outbox();
    const entry = {
      kind: 'invite' as const,
      candidateLabel: 'Candidate 1',
      bodyText: 'Synthetic invite body.',
      idempotencyKey: `invite:${crypto.randomUUID()}`,
    };

    const first = await stub.append(entry);
    expect(first.created).toBe(true);
    expect(await stub.append(entry)).toEqual({ id: first.id, created: false });

    const listed = await stub.list();
    expect(listed).toEqual([
      expect.objectContaining({
        id: first.id,
        kind: 'invite',
        candidateLabel: 'Candidate 1',
        bodyText: 'Synthetic invite body.',
      }),
    ]);
  });

  it('refuses an entry whose label is not a synthetic "Candidate N", and stores nothing', async () => {
    // Called on the instance inside the object: the pool's RPC wrapper also reports a method that throws as an
    // unhandled rejection inside the object, which vitest counts as a run error although the caller gets the rejection.
    const listed = await runInDurableObject(outbox(), (instance) => {
      expect(() =>
        instance.append({
          kind: 'otp',
          candidateLabel: 'Someone Else',
          bodyText: 'Synthetic code body.',
          idempotencyKey: `otp:${crypto.randomUUID()}`,
        }),
      ).toThrow('bad_request');
      return instance.list();
    });
    expect(listed).toEqual([]);
  });
});
