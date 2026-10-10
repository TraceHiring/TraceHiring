import { describe, expect, it } from 'vitest';
import { UI_PACKAGE } from './index.js';

describe('@trace/ui placeholder', () => {
  it('names the package', () => {
    expect(UI_PACKAGE).toBe('@trace/ui');
  });
});
