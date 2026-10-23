// @vitest-environment happy-dom
// The library screens registered for the M1 guard file (AT-M1-24): the copy-done line is in the registry.
import { afterEach, describe, expect, it } from 'vitest';
import { info } from '../bank/testing/api.test-helpers';
import { mountScreen, type Mounted } from '../bank/testing/dom.test-helpers';
import { m1Screens } from './m1-screens.test-helpers';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('the library registry', () => {
  it('registers the copy-done line, singular and plural', async () => {
    const screens = m1Screens();
    const one = screens['library copy done one'];
    const many = screens['library copy done'];
    if (one === undefined || many === undefined) throw new Error('copy-done line not registered');
    mounted = await mountScreen(many, { api: null, info: info('recruiter') });
    expect(mounted.text()).toContain('Copied 2 items to your bank.');
    expect(mounted.links()).toContain('/bank');
    mounted.unmount();
    mounted = await mountScreen(one, { api: null, info: info('recruiter') });
    expect(mounted.text()).toContain('Copied 1 item to your bank.');
  });
});
