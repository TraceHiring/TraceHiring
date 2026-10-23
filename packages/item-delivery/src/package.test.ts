// The package stays pure (specs/m1-test-authoring.md §11.3 A1, R5-52 a): its only runtime dependency is @trace/shared.
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { ITEM_DELIVERY_PACKAGE } from './index.js';

describe('@trace/item-delivery package', () => {
  it('depends at runtime on @trace/shared only', () => {
    expect(pkg.name).toBe(ITEM_DELIVERY_PACKAGE);
    expect(Object.keys(pkg.dependencies)).toEqual(['@trace/shared']);
  });
});
