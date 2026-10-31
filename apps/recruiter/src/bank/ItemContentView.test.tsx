// @vitest-environment happy-dom
// The read-only item view (specs/m1-test-authoring.md §6.2, §6.4): an AI draft in review shows the badge and a fixed
// line that it passed the stored checks (every stored draft did, §6.4); no other item shows that line; no stray
// replacement character appears in the text.
import { afterEach, describe, expect, it } from 'vitest';
import { ItemContentView } from './ItemContentView';
import { info } from './testing/api.test-helpers';
import { mountScreen, type Mounted } from './testing/dom.test-helpers';
import { PARAM_SPEC, mcqDetail } from './testing/fixtures.test-helpers';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const CHECKS = 'This draft passed the duplicate, readability and placeholder checks.';
const show = (detail: Parameters<typeof ItemContentView>[0]['detail']) =>
  mountScreen(<ItemContentView detail={detail} />, { api: null, info: info('reviewer') });

describe('the draft checks line (§6.2)', () => {
  it('is shown for an AI draft in review, next to the badge', async () => {
    mounted = await show(mcqDetail(1, { status: 'in_review', origin: 'ai_draft' }));
    expect(mounted.text()).toContain('AI draft — needs approval');
    expect(mounted.text()).toContain(CHECKS);
  });

  it('is not shown for a hand-written or imported item in review', async () => {
    for (const origin of ['human', 'import'] as const) {
      mounted = await show(mcqDetail(1, { status: 'in_review', origin }));
      expect(mounted.text()).not.toContain('passed the duplicate');
      mounted.unmount();
    }
    mounted = null;
  });

  it('is not shown once the AI draft is no longer in review', async () => {
    mounted = await show(mcqDetail(1, { status: 'approved', origin: 'ai_draft' }));
    expect(mounted.text()).not.toContain('passed the duplicate');
  });
});

describe('the text', () => {
  it('has no replacement character, including the parameterised marker', async () => {
    mounted = await show(
      mcqDetail(5, { status: 'in_review', isParameterised: true }, { paramSpec: PARAM_SPEC }),
    );
    expect(mounted.text()).toContain('Parameterised');
    expect(mounted.text()).not.toContain(String.fromCharCode(0xfffd));
  });
});
