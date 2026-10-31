// @vitest-environment happy-dom
// The bank screens registered for the M1 guard file (AT-M1-24, src/m1-screen-registry.test-helpers.ts): the item
// action row and the pool manager are in the registry, so the word lists reach them.
import { afterEach, describe, expect, it } from 'vitest';
import { info } from './testing/api.test-helpers';
import { mountScreen, type Mounted } from './testing/dom.test-helpers';
import { m1Screens } from './m1-screens.test-helpers';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const render = (name: string) => {
  const node = m1Screens()[name];
  if (node === undefined) throw new Error(`"${name}" is not registered`);
  return mountScreen(node, { api: null, info: info('recruiter') });
};

describe('the bank registry covers the screens that were missing', () => {
  it('registers the item action row', async () => {
    mounted = await render('item actions');
    expect(mounted.button('Edit as new version')).toBeTruthy();
    expect(mounted.button('Retire')).toBeTruthy();
  });

  it('registers the pool manager with both lists', async () => {
    mounted = await render('pool manager');
    const text = mounted.text();
    expect(text).toContain('Items in this pool');
    expect(text).toContain('Approved items that could be added');
    expect(mounted.button(/^Remove from pool:/)).toBeTruthy();
    expect(mounted.button(/^Add to pool:/)).toBeTruthy();
  });
});
