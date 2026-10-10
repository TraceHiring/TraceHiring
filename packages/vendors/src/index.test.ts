import { describe, expect, it } from 'vitest';
import { VENDOR_INTERFACES } from './index.js';

describe('@trace/vendors placeholder', () => {
  it('has no vendor interface yet in M0a', () => {
    expect(VENDOR_INTERFACES).toEqual([]);
  });
});
