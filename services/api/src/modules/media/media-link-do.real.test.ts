/// <reference types="@cloudflare/vitest-pool-workers/types" />
// C1a SR-6 (api half): the real MediaLinkDO class over its own SQLite storage (`ctx.storage.sql`) in the `api-do` pool
// of vitest.config.ts. LinkStore and the guards are covered on a fake in media-link-do.test.ts; this proves the wrapper
// wires them: an issued link burns exactly once (the second burn is refused), and a malformed jti is refused before
// anything is stored. Synthetic ids only, made at run time.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const linkStub = (name: string) => {
  const ns = env.MEDIA_LINKS;
  if (ns === undefined) throw new Error('the api-do pool has no MEDIA_LINKS binding');
  return ns.get(ns.idFromName(name));
};

const NOW_SEC = 1_790_000_000;

const record = () => ({
  mediaId: crypto.randomUUID(),
  orgId: crypto.randomUUID(),
  viewerUserId: crypto.randomUUID(),
  aal: 'aal2' as const,
  amr: ['otp'],
  exp: NOW_SEC + 300,
});

describe('MediaLinkDO (real class, SQLite-backed storage)', () => {
  it('burns an issued link once and returns its record; a second burn is refused', async () => {
    const jti = crypto.randomUUID();
    const stub = linkStub(jti);
    const issued = record();

    await stub.issue(jti, issued);
    expect(await stub.burn(jti, NOW_SEC + 10)).toEqual(issued);
    expect(await stub.burn(jti, NOW_SEC + 11)).toBeNull();
  });

  it('refuses a malformed jti at issue, and the link never burns', async () => {
    const name = crypto.randomUUID();
    const stub = linkStub(name);

    // Called on the instance inside the object (see outbox-do.real.test.ts: the pool's RPC wrapper reports a throwing
    // method as an unhandled rejection inside the object).
    await runInDurableObject(stub, (instance) => {
      expect(() => instance.issue('not-a-uuid', record())).toThrow('bad_request');
    });
    expect(await stub.burn('not-a-uuid', NOW_SEC)).toBeNull();
    expect(await stub.burn(name, NOW_SEC)).toBeNull();
  });
});
