import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from './index.js';

describe('@trace/shared placeholder', () => {
  it('exports the product name', () => {
    expect(PRODUCT_NAME).toBe('Trace');
  });
});
