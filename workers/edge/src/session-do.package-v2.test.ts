// Package v2 in the SessionDO (specs/m1-test-authoring.md §5, §6.5; R5-9, E22, DC-M1-3): the object accepts a v2
// package of up to 5 MB and 5,000 eligible items, parsed with the shared TestPackageV2 schema, and stores it so that
// no single storage entry passes the SQLite-backed object's 2 MB key + value limit (the fake KV enforces it, as the
// real one does; session-do.package-v2.real.test.ts runs the same package on the real class). A v1 package keeps D1's
// 256 KB cap. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { KV_ENTRY_MAX_BYTES, kvEntryBytes } from './edge.test-helpers.js';
import { PACKAGE_MAX_BYTES } from './session-core.js';
import { PACKAGE_V2_MAX_BYTES } from './session-core-v2.js';
import {
  AUTH,
  coreHarness,
  makeLargePackageV2,
  makePackage,
  makePackageV2,
  startCoreV2,
  startInput,
} from './session.test-helpers.js';

const bytesOf = (pkg: unknown) => new TextEncoder().encode(JSON.stringify(pkg)).byteLength;

describe('package v2 storage (R5-9)', () => {
  it('starts on a ~5 MB package of 5,000 items; every stored entry stays under the 2 MB limit', async () => {
    const pkg = makeLargePackageV2();
    const size = bytesOf(pkg);
    expect(size).toBeGreaterThan(4 * 1024 * 1024);
    expect(size).toBeLessThanOrEqual(PACKAGE_V2_MAX_BYTES);
    const h = await coreHarness(pkg);
    const { view } = await startCoreV2(h);

    expect(view.items).toHaveLength(100);
    expect(h.kv.largestEntry).toBeLessThanOrEqual(KV_ENTRY_MAX_BYTES);
    for (const [key, value] of h.kv.map) {
      expect(kvEntryBytes(key, value)).toBeLessThanOrEqual(KV_ENTRY_MAX_BYTES);
    }
    // The item with 200 large variants alone is over the limit, so it cannot have been stored as one entry.
    expect(kvEntryBytes('x', pkg.items[0])).toBeGreaterThan(KV_ENTRY_MAX_BYTES);

    // Every position serves (one GET a second keeps under the 60 per minute item limit).
    for (let position = 1; position <= 100; position += 1) {
      h.clock.ms += 1_001;
      const out = await h.core.item(AUTH, position);
      expect(out.ok).toBe(true);
    }
  });

  it('refuses a package over 5 MB before parsing it, and keeps the v1 cap of 256 KB for v1', async () => {
    const big = makeLargePackageV2();
    const filler = '[synthetic] '.repeat(
      Math.ceil((PACKAGE_V2_MAX_BYTES - bytesOf(big)) / 12) + 10,
    );
    big.title = '[synthetic] big';
    const over = { ...big, padding: filler };
    const h = await coreHarness(over);
    expect(await h.core.start(startInput(h.sha256))).toMatchObject({
      ok: false,
      error: 'unavailable',
      pkg: 'too_large',
    });

    const v1 = makePackage();
    const v1Over = {
      ...v1,
      items: v1.items.map((i) => (i.kind === 'written' ? { ...i, prompt: 'x'.repeat(4000) } : i)),
      padding: 'y'.repeat(PACKAGE_MAX_BYTES),
    };
    const h1 = await coreHarness(v1Over);
    expect(await h1.core.start(startInput(h1.sha256))).toMatchObject({ pkg: 'too_large' });
    expect([...h1.kv.map.keys()]).toEqual([]);
  });

  it('refuses a v2 package that fails the shared schema, and one whose ids differ from the grant', async () => {
    const bad = { ...makePackageV2(), sections: [] };
    const h = await coreHarness(bad);
    expect(await h.core.start(startInput(h.sha256))).toMatchObject({ pkg: 'schema' });

    const other = makePackageV2({}, { durationSeconds: 600 });
    const h2 = await coreHarness(other);
    expect(await h2.core.start(startInput(h2.sha256))).toMatchObject({ pkg: 'mismatch' });
    expect([...h2.kv.map.keys()]).toEqual([]);
  });
});
