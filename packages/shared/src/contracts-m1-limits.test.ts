// Shared M1 limits (specs/m1-test-authoring.md R5-55 d): one constant for the client, the import worker and the api.
import { describe, expect, it } from 'vitest';
import { IMPORT_IMAGE_MAX_BYTES } from './contracts-m1.js';

describe('M1 shared limits', () => {
  it('caps an import image at 1 MiB (§6.9, R2-19, R5-48 "1 MB")', () => {
    expect(IMPORT_IMAGE_MAX_BYTES).toBe(1_048_576);
  });
});
