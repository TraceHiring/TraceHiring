// @vitest-environment happy-dom
// `/drives/new` (specs/m2-scheduling-invites.md §6.1, M2-8, M2-13, M2-17, M2-21, §5 CreateDriveRequest): name, test and
// its published version, mode, window in IST, 0-4 distinct reminder offsets (default 24 h and 1 h), the self-reschedule
// switch, "Lab mode" with no description, expected candidates. The form is checked against CreateDriveRequest before
// anything is sent. A fake fetch stands in for the api. Synthetic data only.
import type { TestDraftView } from '@trace/shared/contracts/m1';
import { CreateDriveRequest } from '@trace/shared/contracts/m2';
import { afterEach, describe, expect, it } from 'vitest';
import {
  failure,
  fakeApi,
  info,
  type FakeAnswer,
  type FakeCall,
} from '../bank/testing/api.test-helpers';
import { mountScreen, type Mounted } from '../bank/testing/dom.test-helpers';
import { NewDriveRoute } from './DriveRoutes';
import { drive, TIME, uid } from './testing/fixtures.test-helpers';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const PUBLISHED = uid(11);
const DRAFT_ONLY = uid(12);
const VERSION = uid(21);

const testsBody = {
  tests: [
    {
      id: PUBLISHED,
      name: '[synthetic] Published test',
      status: 'published',
      versionNo: 3,
      invitationCount: 0,
      createdAt: TIME,
    },
    {
      id: DRAFT_ONLY,
      name: '[synthetic] Draft test',
      status: 'draft',
      versionNo: 2,
      invitationCount: 0,
      createdAt: TIME,
    },
  ],
};
const detail = (testId: string, status: 'published' | 'draft'): TestDraftView => ({
  test: { id: testId, workspaceId: uid(3), name: '[synthetic] Test', createdAt: TIME },
  version: {
    id: status === 'published' ? VERSION : uid(22),
    versionNo: 3,
    status,
    durationMinutes: 45,
    qualityCutoff: 40,
    publishedAt: status === 'published' ? TIME : null,
    sections: [],
  },
});

function newDriveApi(post?: (call: FakeCall) => FakeAnswer | undefined) {
  return fakeApi((call) => {
    if (call.method === 'GET' && call.path === '/tests') return { body: testsBody };
    if (call.method === 'GET' && call.path === `/tests/${PUBLISHED}`) {
      return { body: detail(PUBLISHED, 'published') };
    }
    if (call.method === 'GET' && call.path === `/tests/${DRAFT_ONLY}`) {
      return { body: detail(DRAFT_ONLY, 'draft') };
    }
    if (call.method === 'POST' && call.path === '/drives') {
      return post?.(call) ?? { status: 201, body: drive(9) };
    }
    return undefined;
  });
}

const mountNew = (api: ReturnType<typeof newDriveApi>['api']) =>
  mountScreen(<NewDriveRoute />, {
    api,
    info: info('recruiter'),
    at: '/drives/new',
    path: '/drives/new',
    extra: [{ path: '/drives/:driveId', element: <p>Drive page reached</p> }],
  });

async function fillValid(el: Mounted, testId = PUBLISHED) {
  await el.type(el.field('Drive name'), '[synthetic] November drive');
  await el.choose(el.field('Test'), testId);
  await el.settle();
  await el.type(el.field('Opens (IST)'), '2026-11-02T10:00');
  await el.type(el.field('Deadline (IST)'), '2026-11-09T18:00');
}
const posts = (calls: FakeCall[]) => calls.filter((c) => c.method === 'POST');

describe('the form', () => {
  it('lists the tests, and its fields have the defaults: scheduled, 24 h and 1 h reminders, reschedule on, lab mode off', async () => {
    const { api } = newDriveApi();
    mounted = await mountNew(api);
    const text = mounted.text();
    expect(text).toContain('New drive');
    expect(text).toContain('[synthetic] Published test');
    expect(text).toContain('[synthetic] Draft test');
    expect((mounted.field('Mode') as HTMLSelectElement).value).toBe('scheduled');
    expect((mounted.field('Reminder 1') as HTMLInputElement).value).toBe('24');
    expect((mounted.field('Reminder 1 unit') as HTMLSelectElement).value).toBe('hours');
    expect((mounted.field('Reminder 2') as HTMLInputElement).value).toBe('1');
    expect((mounted.field('Allow candidates to reschedule once') as HTMLSelectElement).value).toBe(
      'yes',
    );
    expect((mounted.field('Lab mode') as HTMLSelectElement).value).toBe('off');
  });

  it('puts no description next to "Lab mode" (M2-21)', async () => {
    const { api } = newDriveApi();
    mounted = await mountNew(api);
    const wrapper = mounted.field('Lab mode').closest('label');
    expect(wrapper?.textContent.replace(/\s+/g, ' ').trim()).toMatch(/^Lab mode\s*(Off\s*On)?$/);
    expect(wrapper?.querySelector('p, small')).toBeNull();
  });

  it('finds the published version of a published test by itself', async () => {
    const { api, calls } = newDriveApi();
    mounted = await mountNew(api);
    await mounted.choose(mounted.field('Test'), PUBLISHED);
    await mounted.settle();
    expect(calls.some((c) => c.path === `/tests/${PUBLISHED}`)).toBe(true);
    expect(mounted.text()).toContain('Version 3 (published)');
    expect(() => mounted?.field('Published version id')).toThrow();
  });

  it('asks for the published version id when the test’s latest version is not published', async () => {
    const { api } = newDriveApi();
    mounted = await mountNew(api);
    await mounted.choose(mounted.field('Test'), DRAFT_ONLY);
    await mounted.settle();
    expect(mounted.field('Published version id')).toBeTruthy();
  });

  it('allows at most four reminders and lets one be removed', async () => {
    const { api } = newDriveApi();
    mounted = await mountNew(api);
    await mounted.click(mounted.button('Add reminder'));
    await mounted.click(mounted.button('Add reminder'));
    expect(mounted.maybeButton('Add reminder')).toBeNull();
    await mounted.click(mounted.button('Remove reminder 1'));
    expect(mounted.maybeButton('Add reminder')).not.toBeNull();
    expect((mounted.field('Reminder 1') as HTMLInputElement).value).toBe('1');
  });
});

describe('sending', () => {
  it('sends exactly a CreateDriveRequest with the times in IST, then opens the new drive', async () => {
    const { api, calls } = newDriveApi();
    mounted = await mountNew(api);
    await fillValid(mounted);
    await mounted.click(mounted.button('Create drive'));
    const sent = posts(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({
      name: '[synthetic] November drive',
      testId: PUBLISHED,
      defaultTestVersionId: VERSION,
      mode: 'scheduled',
      opensAt: '2026-11-02T10:00:00+05:30',
      deadlineAt: '2026-11-09T18:00:00+05:30',
      reminderOffsetsMinutes: [1440, 60],
      selfRescheduleAllowed: true,
      labMode: false,
    });
    expect(CreateDriveRequest.safeParse(sent[0]?.body).success).toBe(true);
    expect(mounted.text()).toContain('Drive page reached');
  });

  it('sends the other choices as chosen: open window, lab mode on, no reschedule, other reminders, expected candidates', async () => {
    const { api, calls } = newDriveApi();
    mounted = await mountNew(api);
    await fillValid(mounted);
    await mounted.choose(mounted.field('Mode'), 'open_window');
    await mounted.choose(mounted.field('Lab mode'), 'on');
    await mounted.choose(mounted.field('Allow candidates to reschedule once'), 'no');
    await mounted.type(mounted.field('Reminder 1'), '2');
    await mounted.choose(mounted.field('Reminder 1 unit'), 'days');
    await mounted.type(mounted.field('Reminder 2'), '30');
    await mounted.choose(mounted.field('Reminder 2 unit'), 'minutes');
    await mounted.type(mounted.field('Expected candidates (optional)'), '2000');
    await mounted.click(mounted.button('Create drive'));
    expect(posts(calls)[0]?.body).toMatchObject({
      mode: 'open_window',
      labMode: true,
      selfRescheduleAllowed: false,
      reminderOffsetsMinutes: [2880, 30],
      expectedCandidates: 2000,
    });
  });

  it('can have no reminders at all', async () => {
    const { api, calls } = newDriveApi();
    mounted = await mountNew(api);
    await fillValid(mounted);
    await mounted.click(mounted.button('Remove reminder 1'));
    await mounted.click(mounted.button('Remove reminder 1'));
    await mounted.click(mounted.button('Create drive'));
    expect(posts(calls)[0]?.body).toMatchObject({ reminderOffsetsMinutes: [] });
  });

  it('uses the typed version id for a test whose latest version is a draft', async () => {
    const { api, calls } = newDriveApi();
    mounted = await mountNew(api);
    await fillValid(mounted, DRAFT_ONLY);
    await mounted.click(mounted.button('Create drive'));
    expect(posts(calls)).toEqual([]);
    expect(mounted.text()).toContain('Enter the published version id.');
    await mounted.type(mounted.field('Published version id'), uid(77));
    await mounted.click(mounted.button('Create drive'));
    expect(posts(calls)[0]?.body).toMatchObject({
      defaultTestVersionId: uid(77),
      testId: DRAFT_ONLY,
    });
  });
});

describe('checks before anything is sent', () => {
  const refuses = async (patch: (el: Mounted) => Promise<void>, message: string): Promise<void> => {
    const { api, calls } = newDriveApi();
    mounted = await mountNew(api);
    await fillValid(mounted);
    await patch(mounted);
    await mounted.click(mounted.button('Create drive'));
    expect(posts(calls)).toEqual([]);
    expect(mounted.text()).toContain(message);
    mounted.unmount();
    mounted = null;
  };

  it('needs a name', async () => {
    await refuses((el) => el.type(el.field('Drive name'), '   '), 'Enter a name for the drive.');
  });
  it('needs a test', async () => {
    await refuses((el) => el.choose(el.field('Test'), ''), 'Choose a test.');
  });
  it('needs a deadline after the opening time', async () => {
    await refuses(
      (el) => el.type(el.field('Deadline (IST)'), '2026-11-02T09:00'),
      'The deadline must be after the opening time.',
    );
  });
  it('needs both times', async () => {
    await refuses((el) => el.type(el.field('Opens (IST)'), ''), 'Enter the opening time.');
  });
  it('needs reminders between 15 minutes and 7 days', async () => {
    await refuses(async (el) => {
      await el.type(el.field('Reminder 2'), '5');
      await el.choose(el.field('Reminder 2 unit'), 'minutes');
    }, 'Each reminder must be between 15 minutes and 7 days before the start.');
    await refuses(async (el) => {
      await el.type(el.field('Reminder 1'), '8');
      await el.choose(el.field('Reminder 1 unit'), 'days');
    }, 'Each reminder must be between 15 minutes and 7 days before the start.');
  });
  it('needs different reminders', async () => {
    await refuses(
      (el) => el.type(el.field('Reminder 2'), '24'),
      'Each reminder must be different.',
    );
  });
  it('needs expected candidates to be a whole number from 1 to 100,000', async () => {
    await refuses(
      (el) => el.type(el.field('Expected candidates (optional)'), '0'),
      'Expected candidates must be a whole number from 1 to 100,000.',
    );
  });
});

describe('what the api says', () => {
  it('shows an api refusal as fixed words', async () => {
    const { api } = newDriveApi(() => failure(400, 'bad_request'));
    mounted = await mountNew(api);
    await fillValid(mounted);
    await mounted.click(mounted.button('Create drive'));
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toContain(
      'Some values were not accepted. Check the form.',
    );
    expect(mounted.text()).not.toContain('Drive page reached');
  });

  it('does not show a code it has no words for', async () => {
    const { api } = newDriveApi(() => failure(500, 'internal_secret_detail'));
    mounted = await mountNew(api);
    await fillValid(mounted);
    await mounted.click(mounted.button('Create drive'));
    expect(mounted.text()).toContain('Something went wrong. Try again.');
    expect(mounted.text()).not.toContain('internal_secret_detail');
  });
});
