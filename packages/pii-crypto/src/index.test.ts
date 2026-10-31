// Skeleton check (lead, Wave 1): the package loads and names the ciphertext version the migrations' CHECKs expect.
import { describe, expect, it } from 'vitest';
import { CIPHERTEXT_VERSION } from './index.js';

describe('@trace/pii-crypto skeleton', () => {
  it('names ciphertext format v1', () => {
    expect(CIPHERTEXT_VERSION).toBe('v1');
  });
});
