/// <reference types="@cloudflare/vitest-pool-workers/types" />
// Package v2 on the real SessionDO class (R5-9, DC-M1-3): a ~5 MB package of 5,000 items read from the local
// PACKAGES bucket is stored in the object's SQLite-backed KV (whose entries are limited to 2 MB of key + value), drawn
// at start and served. The logic is covered on fakes in session-do.draw.test.ts and session-do.package-v2.test.ts; this
// proves the real storage accepts the layout. Synthetic data only.
import { ServedItemV2, SessionViewV2 } from '@trace/shared/contracts/candidate';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { sha256HexBytes } from './encoding.js';
import { sessionStub } from './real.test-helpers.js';
import { DRAW_PREFIX } from './session-core-v2.js';
import { AUTH, makeLargePackageV2, PACKAGE_KEY, startInput } from './session.test-helpers.js';

describe('SessionDO with a large package v2 (real class, SQLite-backed storage)', () => {
  it('stores, draws and serves a ~5 MB package of 5,000 items', async () => {
    const packages = env.PACKAGES;
    if (packages === undefined) throw new Error('the edge-do pool has no PACKAGES binding');
    const bytes = new TextEncoder().encode(JSON.stringify(makeLargePackageV2()));
    expect(bytes.byteLength).toBeGreaterThan(4 * 1024 * 1024);
    const key = PACKAGE_KEY.replace('.json', `-${crypto.randomUUID()}.json`);
    await packages.put(key, bytes);

    const stub = sessionStub();
    const started = await stub.start(
      startInput(await sha256HexBytes(bytes), { sessionId: crypto.randomUUID(), packageKey: key }),
    );
    if (!started.ok || started.kind !== 'live') throw new Error('start refused');
    expect(SessionViewV2.parse(started.view).items).toHaveLength(100);

    const out = await stub.item(AUTH, 1);
    if (!out.ok || !('v2' in out)) throw new Error('item refused');
    expect(ServedItemV2.parse(out.v2).position).toBe(1);

    const draws = await runInDurableObject(stub, (_instance, state) =>
      [...state.storage.kv.list({ prefix: DRAW_PREFIX })].map(([k]) => k),
    );
    expect(draws).toHaveLength(1);
  });
});
