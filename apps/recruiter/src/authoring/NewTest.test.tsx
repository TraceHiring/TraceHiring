// @vitest-environment happy-dom
// Step 1 of the `tests/new` wizard (specs/m1-test-authoring.md §6.1, §6.10; R5-15, R5-55 b): D1's start (a test name,
// "Create draft") is extended in place with the template choice next to it, so the D1 slice keeps one flow and there is
// no separate template route. D1's own create path is unchanged. Synthetic data only.
import { RoleTemplateListResponse } from '@trace/shared/contracts/m1';
import { afterEach, describe, expect, it } from 'vitest';
import { button, fakeApi, field, mountScreen, plain, type Mounted } from './dom.test-helpers';
import { NewTestRoute } from './TestEditorPage';

const templates = RoleTemplateListResponse.parse({
  templates: [
    {
      templateKey: 'customer_support',
      version: 1,
      name: 'Customer Support',
      presetKey: 'standard',
    },
  ],
  nextCursor: null,
});

let mounted: Mounted | undefined;
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
});

describe('tests/new step 1', () => {
  it('offers the template choice next to the D1 start', async () => {
    const { api, calls } = fakeApi({ 'GET /templates': () => ({ body: templates }) });
    mounted = await mountScreen(<NewTestRoute />, api, ['recruiter']);
    const c = mounted.container;
    const text = plain(c.innerHTML);
    // D1's start, as it was.
    expect(text).toContain('New test');
    expect(field<HTMLInputElement>(c, 'Test name').name).toBe('name');
    expect(button(c, 'Create draft').type).toBe('submit');
    expect(text).toContain('The test starts as a draft with an Answer Quality cutoff of 40.');
    // The template choice, in the same step.
    expect(text).toContain('Or start from a role template');
    expect(field<HTMLInputElement>(c, 'Customer Support (version 1, Standard)').type).toBe('radio');
    expect(button(c, 'Suggest a template')).toBeDefined();
    expect(button(c, 'Create draft from template')).toBeDefined();
    expect(calls.map((x) => `${x.method} ${x.path}`)).toEqual(['GET /templates']);
    expect(c.querySelectorAll('h2')).toHaveLength(1);
  });

  it('a reviewer gets the D1 start only, and no template request is made', async () => {
    const { api, calls } = fakeApi({ 'GET /templates': () => ({ body: templates }) });
    mounted = await mountScreen(<NewTestRoute />, api, ['reviewer']);
    expect(plain(mounted.container.innerHTML)).not.toContain('Or start from a role template');
    expect(calls).toEqual([]);
  });
});
