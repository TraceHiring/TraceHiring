import { describe, expect, it } from 'vitest';
import { DB_TYPES_GENERATED } from './index.js';

describe('@trace/db-types placeholder', () => {
  it('has no generated types before S1.7', () => {
    expect(DB_TYPES_GENERATED).toBe(false);
  });
});
