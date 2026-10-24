// @vitest-environment happy-dom
// The admin integrity locks screen (specs/m1-test-authoring.md §6.6, screen 04, AT-M1-16): list, create and delete
// locks; the always-locked settings are shown with their one value and cannot be locked or edited. Synthetic data.
import { IntegrityLockListResponse, type SettingKey } from '@trace/shared/contracts/m1';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  button,
  click,
  choose,
  fakeApi,
  mountScreen,
  plain,
  uuid,
  type Mounted,
} from '../authoring/dom.test-helpers';
import { IntegrityLocksRoute, IntegrityLocksView } from './IntegrityLocksRoute';
import { SETTING_INFO, lockableKeys } from './integrity-model';

const AT = '2026-10-23T10:00:00.000Z';
const lock = (n: number, settingKey: SettingKey, lockedValue: string) => ({
  id: uuid(n),
  settingKey,
  lockedValue,
  lockedBy: uuid(7),
  lockedAt: AT,
});
const listOf = (...locks: ReturnType<typeof lock>[]) => IntegrityLockListResponse.parse({ locks });
const noop = () => undefined;

const html = (locks = listOf(lock(1, 'typing_provenance', 'on'))) =>
  renderToString(
    <IntegrityLocksView
      status="ready"
      locks={locks.locks}
      drafts={{}}
      busy={false}
      error={null}
      onDraft={noop}
      onLock={noop}
      onUnlock={noop}
    />,
  );

describe('IntegrityLocksView (static)', () => {
  it('keeps the heading in every state', () => {
    for (const status of ['loading', 'ready', 'error'] as const) {
      const out = renderToString(
        <IntegrityLocksView
          status={status}
          locks={[]}
          drafts={{}}
          busy={false}
          error={null}
          onDraft={noop}
          onLock={noop}
          onUnlock={noop}
        />,
      );
      expect(plain(out)).toContain('Integrity settings');
    }
  });

  it('shows a locked setting with its value, and every other lockable one with a lock control', () => {
    const text = plain(html());
    expect(text).toContain('Typing provenance');
    expect(text).toContain('Locked to On');
    for (const key of lockableKeys().filter((k) => k !== 'typing_provenance')) {
      expect(html()).toContain(`aria-label="Lock value for ${plainLabel(key)}"`);
    }
  });

  it('lists the always-locked settings with their one value, without any control', () => {
    const out = html();
    const text = plain(out);
    for (const t of [
      'Integrity review scope',
      'Candidates above your cutoff only',
      'Accommodations',
      'ID verification',
      'Always locked',
    ]) {
      expect(text, t).toContain(t);
    }
    expect(out).not.toContain('aria-label="Lock value for Accommodations"');
    expect(out).not.toContain('aria-label="Lock value for Integrity review scope"');
    expect(out).not.toContain('aria-label="Lock value for ID verification"');
  });

  it('does not show who locked it as an id, and uses no checkbox or inline style', () => {
    const out = html();
    expect(out).not.toContain(uuid(7));
    expect(out).not.toMatch(/type="checkbox"|role="checkbox"|aria-selected| style=/);
  });
});

const plainLabel = (key: SettingKey): string => SETTING_INFO[key].label;

let mounted: Mounted | undefined;
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
});
const byLabel = (root: ParentNode, label: string): HTMLSelectElement => {
  const el = root.querySelector(`[aria-label="${label}"]`);
  if (el === null) throw new Error(`no control ${label}`);
  return el as HTMLSelectElement;
};

describe('IntegrityLocksRoute', () => {
  it('locks a setting to one of its own values', async () => {
    const seen: unknown[] = [];
    const { api } = fakeApi({
      'GET /settings/integrity-locks': () => ({ body: listOf() }),
      'POST /settings/integrity-locks': (call) => {
        seen.push(call.body);
        return { status: 201, body: lock(2, 'paste_written', 'blocked') };
      },
    });
    mounted = await mountScreen(<IntegrityLocksRoute />, api, ['admin']);
    const c = mounted.container;
    const select = byLabel(c, 'Lock value for Paste on written answers');
    expect([...select.options].map((o) => o.value)).toEqual(['blocked', 'allowed_logged']);
    await choose(select, 'blocked');
    await click(button(c, 'Lock Paste on written answers'));
    expect(seen).toEqual([{ settingKey: 'paste_written', lockedValue: 'blocked' }]);
    expect(plain(c.innerHTML)).toContain('Locked to Blocked, attempts logged');
    expect(c.querySelector('[aria-label="Lock value for Paste on written answers"]')).toBeNull();
  });

  it('removes a lock with the key in the path (204, no body)', async () => {
    const { api, calls } = fakeApi({
      'GET /settings/integrity-locks': () => ({ body: listOf(lock(1, 'single_screen', 'off')) }),
      'DELETE /settings/integrity-locks/single_screen': () => ({ status: 204 }),
    });
    mounted = await mountScreen(<IntegrityLocksRoute />, api, ['admin']);
    const c = mounted.container;
    await click(button(c, 'Remove lock on Single screen'));
    expect(calls.at(-1)).toMatchObject({
      method: 'DELETE',
      path: '/settings/integrity-locks/single_screen',
    });
    expect(c.querySelector('[aria-label="Lock value for Single screen"]')).not.toBeNull();
  });

  it('shows the two-step sign-in text when the api asks for it, never the server text', async () => {
    const { api } = fakeApi({
      'GET /settings/integrity-locks': () => ({
        status: 403,
        body: { error: { code: 'aal2_required' } },
      }),
    });
    mounted = await mountScreen(<IntegrityLocksRoute />, api, ['admin']);
    expect(plain(mounted.container.innerHTML)).toContain(
      'Two-step sign-in is needed for this screen.',
    );
    expect(plain(mounted.container.innerHTML)).toContain('Integrity settings');
  });

  it('keeps the lock list when a lock is refused', async () => {
    const { api } = fakeApi({
      'GET /settings/integrity-locks': () => ({ body: listOf(lock(1, 'single_screen', 'off')) }),
      'POST /settings/integrity-locks': () => ({
        status: 409,
        body: { error: { code: 'conflict' } },
      }),
    });
    mounted = await mountScreen(<IntegrityLocksRoute />, api, ['admin']);
    const c = mounted.container;
    await click(button(c, 'Lock Typing provenance'));
    expect(plain(c.innerHTML)).toContain('That change is no longer possible. Reload the page.');
    expect(plain(c.innerHTML)).toContain('Locked to Off');
  });
});
