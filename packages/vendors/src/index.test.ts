import { describe, expect, it } from 'vitest';
import { VENDOR_INTERFACES } from './index.js';

describe('@trace/vendors interface list', () => {
  it('lists the D1 interfaces (LlmGrader and Messaging, spec §5.3)', () => {
    expect(VENDOR_INTERFACES).toEqual(['LlmGrader', 'Messaging']);
  });
});
