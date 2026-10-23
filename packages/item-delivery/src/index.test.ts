// The public surface of @trace/item-delivery (specs/m1-test-authoring.md §6.5): pinned so a change is deliberate.
import { describe, expect, it } from 'vitest';
import * as delivery from './index.js';

describe('@trace/item-delivery exports', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(delivery).sort()).toEqual([
      'DrawError',
      'ITEM_DELIVERY_PACKAGE',
      'difficultyBand',
      'drawSection',
      'drawSeed',
      'drawWeight',
    ]);
  });
});
