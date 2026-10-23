// The candidate module and package v2 (spec m1 M1-12, §6.11): the api serves the same candidate RPCs for v1 and v2
// versions; sessionGrant names the package key and its hash, and the SessionDO reads either version. The one place the
// api reads a package is the invite page's display title, which both versions carry. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { packageTitleOf } from './candidate-rpc.js';

const V = 'f1000000-0000-4000-8000-000000000001';

const bucket = (objects: Record<string, unknown>) => ({
  get: async (key: string) => (key in objects ? { json: async () => objects[key] } : null),
});

describe('packageTitleOf', () => {
  it('reads the title of a v1 and of a v2 package', async () => {
    expect(
      await packageTitleOf(bucket({ [`packages/${V}.json`]: { v: 1, title: 'Synthetic v1' } }))(V),
    ).toBe('Synthetic v1');
    expect(
      await packageTitleOf(
        bucket({
          [`packages/${V}.json`]: { v: 2, title: 'Synthetic v2', captureSignals: [], items: [] },
        }),
      )(V),
    ).toBe('Synthetic v2');
  });

  it('a missing object or a package without a usable title is null (display data only)', async () => {
    expect(await packageTitleOf(bucket({}))(V)).toBeNull();
    expect(await packageTitleOf(bucket({ [`packages/${V}.json`]: { v: 2 } }))(V)).toBeNull();
    expect(
      await packageTitleOf(bucket({ [`packages/${V}.json`]: { title: 'x'.repeat(201) } }))(V),
    ).toBeNull();
  });
});
