// @vitest-environment happy-dom
// `/drives/:driveId` (specs/m2-scheduling-invites.md §4, §6.1, M2-11, M2-14, M2-17, R5-13, R5-52 d, R5-59, R5-64 f): the
// drive's details, its Publish / Close / Cancel actions by status, its slots (paged, created by list or generator),
// the open-window pool warning, its invitations in pages with one-row-at-a-time Move / Resend / Revoke, and on a
// cancelled drive the one drive-level "Revoke all invitations not yet started". A fake fetch stands in for the api.
import type {
  DriveDetail,
  DriveInvitationPage,
  SlotListResponse,
} from '@trace/shared/contracts/m2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  failure,
  fakeApi,
  info,
  type FakeAnswer,
  type FakeCall,
} from '../bank/testing/api.test-helpers';
import { mountScreen, type Mounted } from '../bank/testing/dom.test-helpers';
import { DriveRoute } from './DriveRoutes';
import { cursorFor, drive, invitation, slot } from './testing/fixtures.test-helpers';
import { DELIVERY_LABEL, INVITATION_STATUS_LABEL } from './texts';
import { formatIst } from './time';

let mounted: Mounted | null = null;
beforeEach(() => {
  // "Now" is fixed (only Date is faked), so the slots that count as future do not depend on the day the test runs.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

const D = (patch: Partial<DriveDetail> = {}) => drive(1, patch);
const DRIVE = D().id;

interface Setup {
  drive?: DriveDetail;
  slots?: SlotListResponse;
  slotsPage2?: SlotListResponse;
  invitations?: DriveInvitationPage;
  invitationsPage2?: DriveInvitationPage;
  /** Answers a call before the defaults do. */
  also?: (call: FakeCall) => FakeAnswer | undefined;
}
function driveApi(setup: Setup = {}) {
  const current = { drive: setup.drive ?? D() };
  return fakeApi((call) => {
    const forced = setup.also?.(call);
    if (forced !== undefined) return forced;
    const base = `/drives/${DRIVE}`;
    if (call.method === 'GET' && call.path === base) return { body: current.drive };
    if (call.method === 'GET' && call.path === `${base}/slots`) {
      return call.query['cursor'] === undefined
        ? { body: setup.slots ?? { slots: [slot(1), slot(2)], nextCursor: null } }
        : { body: setup.slotsPage2 ?? { slots: [], nextCursor: null } };
    }
    if (call.method === 'GET' && call.path === `${base}/invitations`) {
      return call.query['cursor'] === undefined
        ? {
            body: setup.invitations ?? {
              invitations: [invitation(1), invitation(2)],
              nextCursor: null,
            },
          }
        : { body: setup.invitationsPage2 ?? { invitations: [], nextCursor: null } };
    }
    const action = /^\/drives\/[^/]+\/(publish|close|cancel)$/.exec(call.path)?.[1];
    if (call.method === 'POST' && action !== undefined) {
      const status = { publish: 'scheduled', close: 'closed', cancel: 'cancelled' }[
        action
      ] as DriveDetail['status'];
      current.drive = { ...current.drive, status };
      return { body: current.drive };
    }
    return undefined;
  });
}

const mountDrive = (api: ReturnType<typeof driveApi>['api'] | null, roles = 'recruiter') =>
  mountScreen(<DriveRoute />, {
    api,
    info: info(roles),
    at: `/drives/${DRIVE}`,
    path: '/drives/:driveId',
  });

const posts = (calls: FakeCall[]) => calls.filter((c) => c.method === 'POST');
const lastPost = (calls: FakeCall[]) => posts(calls).at(-1);

/** The table row of a candidate (by its label). */
function rowOf(el: Mounted, label: string): HTMLTableRowElement {
  const row = [...el.container.querySelectorAll('tr')].find(
    (tr) => tr.querySelector('th')?.textContent.trim() === label,
  );
  if (row === undefined) throw new Error(`no row ${label}`);
  return row;
}
function rowButton(el: Mounted, label: string, action: string): HTMLButtonElement | null {
  const found = [...rowOf(el, label).querySelectorAll('button')].find((b) =>
    (b.getAttribute('aria-label') ?? b.textContent).startsWith(action),
  );
  return found ?? null;
}
async function press(el: Mounted, label: string, action: string) {
  const button = rowButton(el, label, action);
  if (button === null) throw new Error(`no ${action} for ${label}`);
  await el.click(button);
}

describe('the details', () => {
  it('shows name, mode, status, the window in IST, reminders, reschedule and lab mode', async () => {
    const { api } = driveApi({
      drive: D({ expectedCandidates: 2000, labMode: true, selfRescheduleAllowed: false }),
    });
    mounted = await mountDrive(api);
    const text = mounted.text();
    expect(text).toContain('[synthetic] Drive 1');
    expect(text).toContain('Scheduled slots');
    expect(text).toContain('Draft');
    expect(text).toContain(formatIst(D().opensAt));
    expect(text).toContain(formatIst(D().deadlineAt));
    expect(text).toContain('24 hours and 1 hour before the start');
    expect(text).toMatch(/Candidates may reschedule once: No/);
    expect(text).toMatch(/Lab mode: On/);
    expect(text).toMatch(/Expected candidates: 2,000/);
  });

  it('says "none" for no reminders and shows an open-window drive’s reminders against the deadline', async () => {
    const { api } = driveApi({ drive: D({ reminderOffsetsMinutes: [], mode: 'open_window' }) });
    mounted = await mountDrive(api);
    expect(mounted.text()).toContain('Reminders: none');
    const other = driveApi({
      drive: D({ reminderOffsetsMinutes: [4320, 45], mode: 'open_window' }),
    });
    mounted.unmount();
    mounted = await mountDrive(other.api);
    expect(mounted.text()).toContain('3 days and 45 minutes before the deadline');
  });

  it('fails as fixed text when the drive cannot be loaded', async () => {
    const { api } = fakeApi(() => failure(404, 'not_found'));
    mounted = await mountDrive(api);
    expect(mounted.text()).toContain('Not found, or you do not have access.');
  });

  it('shows the heading and waits when there is no api client yet', async () => {
    mounted = await mountDrive(null);
    expect(mounted.text()).toContain('Drive');
  });
});

describe('the pool warning (M2-17)', () => {
  const warning = 'the pool is smaller than 10 times the draw';
  it('shows on an open-window drive whose pool ratio is under 10, as a ratio and never a score', async () => {
    const { api } = driveApi({ drive: D({ mode: 'open_window', minPoolRatio: 6.5 }) });
    mounted = await mountDrive(api);
    expect(mounted.text().toLowerCase()).toContain(warning);
    expect(mounted.text()).toContain('6.5 times');
    expect(mounted.text()).not.toMatch(/score/i);
  });
  it('is absent at 10 times or more, with no ratio known, or on a scheduled drive', async () => {
    for (const patch of [
      { mode: 'open_window' as const, minPoolRatio: 10 },
      { mode: 'open_window' as const, minPoolRatio: 25.5 },
      { mode: 'open_window' as const, minPoolRatio: null },
      { mode: 'scheduled' as const, minPoolRatio: 6.5 },
    ]) {
      const { api } = driveApi({ drive: D(patch) });
      mounted = await mountDrive(api);
      expect(mounted.text().toLowerCase(), JSON.stringify(patch)).not.toContain(warning);
      mounted.unmount();
      mounted = null;
    }
  });
});

describe('the actions by status (§4)', () => {
  const buttonsFor = async (status: DriveDetail['status']) => {
    const { api } = driveApi({ drive: D({ status }) });
    const el = await mountDrive(api);
    const names = {
      publish: el.maybeButton('Publish drive') !== null,
      close: el.maybeButton('Close drive') !== null,
      cancel: el.maybeButton('Cancel drive') !== null,
      revokeAll: el.maybeButton('Revoke all invitations not yet started') !== null,
      upload: el.links().includes(`/drives/${DRIVE}/upload`),
    };
    el.unmount();
    return names;
  };

  it('a draft can be published or cancelled, and invited to', async () => {
    expect(await buttonsFor('draft')).toEqual({
      publish: true,
      close: false,
      cancel: true,
      revokeAll: false,
      upload: true,
    });
  });
  it('a published drive can be closed or cancelled, and invited to', async () => {
    expect(await buttonsFor('scheduled')).toEqual({
      publish: false,
      close: true,
      cancel: true,
      revokeAll: false,
      upload: true,
    });
  });
  it('a closed drive has no drive action', async () => {
    expect(await buttonsFor('closed')).toEqual({
      publish: false,
      close: false,
      cancel: false,
      revokeAll: false,
      upload: false,
    });
  });
  it('a cancelled drive has only "Revoke all invitations not yet started"', async () => {
    expect(await buttonsFor('cancelled')).toEqual({
      publish: false,
      close: false,
      cancel: false,
      revokeAll: true,
      upload: false,
    });
  });

  it('Publish sends one request and shows the new status', async () => {
    const { api, calls } = driveApi();
    mounted = await mountDrive(api);
    await mounted.click(mounted.button('Publish drive'));
    expect(posts(calls).map((c) => c.path)).toEqual([`/drives/${DRIVE}/publish`]);
    expect(mounted.text()).toContain('Published');
    expect(mounted.maybeButton('Publish drive')).toBeNull();
    expect(mounted.maybeButton('Close drive')).not.toBeNull();
  });

  it('Close and Cancel ask again first, and send nothing until the second click', async () => {
    const { api, calls } = driveApi({ drive: D({ status: 'scheduled' }) });
    mounted = await mountDrive(api);
    await mounted.click(mounted.button('Close drive'));
    expect(posts(calls)).toEqual([]);
    await mounted.click(mounted.button('Keep the drive open'));
    expect(posts(calls)).toEqual([]);
    await mounted.click(mounted.button('Close drive'));
    await mounted.click(mounted.button('Yes, close the drive'));
    expect(posts(calls).map((c) => c.path)).toEqual([`/drives/${DRIVE}/close`]);
    expect(mounted.text()).toContain('Closed');
  });

  it('Cancel says what it does and what it does not do', async () => {
    const { api, calls } = driveApi({ drive: D({ status: 'scheduled' }) });
    mounted = await mountDrive(api);
    await mounted.click(mounted.button('Cancel drive'));
    expect(mounted.text()).toContain('Planned messages are cancelled.');
    expect(mounted.text()).toContain('Invitations stay as they are until you revoke them.');
    await mounted.click(mounted.button('Yes, cancel the drive'));
    expect(posts(calls).map((c) => c.path)).toEqual([`/drives/${DRIVE}/cancel`]);
    expect(mounted.text()).toContain('Cancelled');
    expect(mounted.maybeButton('Revoke all invitations not yet started')).not.toBeNull();
  });

  it('shows a refused action as fixed words and keeps the status', async () => {
    const { api } = driveApi({
      also: (call) => (call.path.endsWith('/publish') ? failure(409, 'conflict') : undefined),
    });
    mounted = await mountDrive(api);
    await mounted.click(mounted.button('Publish drive'));
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toContain(
      'That change is no longer possible. Reload the page.',
    );
    expect(mounted.text()).toContain('Draft');
  });
});

describe('the slots', () => {
  it('lists each slot in IST with booked of capacity, in pages', async () => {
    const { api, calls } = driveApi({
      slots: {
        slots: [slot(1, { booked: 12, capacity: 50 }), slot(2, { status: 'closed' })],
        nextCursor: cursorFor(1),
      },
      slotsPage2: { slots: [slot(3, { booked: 50, capacity: 50 })], nextCursor: null },
    });
    mounted = await mountDrive(api);
    const text = mounted.text();
    expect(text).toContain(formatIst(slot(1).startsAt));
    expect(text).toContain('12 of 50');
    expect(text).toContain('Closed');
    await mounted.click(mounted.button('Next page of slots'));
    expect(calls.filter((c) => c.path.endsWith('/slots')).at(-1)?.query).toEqual({
      cursor: cursorFor(1),
    });
    expect(mounted.text()).toContain('50 of 50');
    expect(mounted.text()).toContain('Full');
    await mounted.click(mounted.button('Previous page of slots'));
    expect(mounted.text()).toContain('12 of 50');
  });

  it('shows the reminder plan of each slot in IST, with a time already past as skipped (§6.1, M2-13, E8)', async () => {
    // "Now" is 05:30 IST on 1 Nov 2026 (beforeEach).
    const tenAm = slot(1, { startsAt: '2026-11-03T04:30:00.000Z' });
    const today = slot(2, { startsAt: '2026-11-01T10:30:00.000Z' });
    const { api } = driveApi({
      drive: D({ reminderOffsetsMinutes: [1440, 60] }),
      slots: { slots: [tenAm, today], nextCursor: null },
    });
    mounted = await mountDrive(api);
    const first = rowOf(mounted, formatIst(tenAm.startsAt)).textContent.replace(/\s+/g, ' ');
    expect(first).toContain('24 hours before: 2 Nov 2026, 10:00 IST');
    expect(first).toContain('1 hour before: 3 Nov 2026, 09:00 IST');
    expect(first).not.toMatch(/skipped/i);
    const second = rowOf(mounted, formatIst(today.startsAt)).textContent.replace(/\s+/g, ' ');
    expect(second).toContain('24 hours before: skipped, that time has passed');
    expect(second).toContain('1 hour before: 1 Nov 2026, 15:00 IST');
    expect(mounted.text()).toContain('Reminders (IST)');
  });

  it('shows "None" as the reminder plan of a drive without reminders', async () => {
    const { api } = driveApi({
      drive: D({ reminderOffsetsMinutes: [] }),
      slots: { slots: [slot(1)], nextCursor: null },
    });
    mounted = await mountDrive(api);
    expect(rowOf(mounted, formatIst(slot(1).startsAt)).textContent).toContain('None');
  });

  it('is not shown for an open-window drive, which has no slots', async () => {
    const { api, calls } = driveApi({ drive: D({ mode: 'open_window' }) });
    mounted = await mountDrive(api);
    expect(mounted.text()).toContain(
      'Candidates start any time between the opening time and the deadline.',
    );
    expect(calls.some((c) => c.path.endsWith('/slots'))).toBe(false);
    expect(mounted.maybeButton('Create slots')).toBeNull();
  });

  it('creates slots from a generator as a SlotsCreateRequest, with the times in IST, and reloads', async () => {
    const { api, calls } = driveApi({
      also: (call) =>
        call.method === 'POST' && call.path.endsWith('/slots')
          ? { status: 201, body: { slots: [slot(7), slot(8), slot(9)] } }
          : undefined,
    });
    mounted = await mountDrive(api);
    await mounted.choose(mounted.field('Add slots by'), 'generator');
    await mounted.type(mounted.field('First slot (IST)'), '2026-11-03T10:00');
    await mounted.type(mounted.field('Number of slots'), '3');
    await mounted.type(mounted.field('Minutes between slots'), '60');
    await mounted.type(mounted.field('Seats per slot'), '40');
    await mounted.click(mounted.button('Create slots'));
    expect(lastPost(calls)?.body).toEqual({
      generator: {
        firstStartsAt: '2026-11-03T10:00:00+05:30',
        count: 3,
        intervalMinutes: 60,
        capacity: 40,
      },
    });
    expect(mounted.text()).toContain('3 slots created.');
    expect(
      calls.filter((c) => c.method === 'GET' && c.path.endsWith('/slots')).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('creates slots from a list of times, each with its own seats or the default', async () => {
    const { api, calls } = driveApi({
      also: (call) =>
        call.method === 'POST' && call.path.endsWith('/slots')
          ? { status: 201, body: { slots: [slot(7), slot(8)] } }
          : undefined,
    });
    mounted = await mountDrive(api);
    await mounted.choose(mounted.field('Add slots by'), 'list');
    await mounted.type(
      mounted.field('Slot times (one per line, IST)'),
      '2026-11-03 10:00\n2026-11-03 14:30, 25\n',
    );
    await mounted.type(mounted.field('Seats per slot'), '40');
    await mounted.click(mounted.button('Create slots'));
    expect(lastPost(calls)?.body).toEqual({
      slots: [
        { startsAt: '2026-11-03T10:00:00+05:30', capacity: 40 },
        { startsAt: '2026-11-03T14:30:00+05:30', capacity: 25 },
      ],
    });
    expect(mounted.text()).toContain('2 slots created.');
  });

  it('checks the slot form before sending', async () => {
    const { api, calls } = driveApi();
    mounted = await mountDrive(api);
    await mounted.choose(mounted.field('Add slots by'), 'generator');
    await mounted.click(mounted.button('Create slots'));
    expect(posts(calls)).toEqual([]);
    expect(mounted.text()).toContain('Enter the time of the first slot.');
    await mounted.type(mounted.field('First slot (IST)'), '2026-11-03T10:00');
    await mounted.type(mounted.field('Number of slots'), '501');
    await mounted.type(mounted.field('Minutes between slots'), '60');
    await mounted.type(mounted.field('Seats per slot'), '40');
    await mounted.click(mounted.button('Create slots'));
    expect(posts(calls)).toEqual([]);
    expect(mounted.text()).toContain('The number of slots must be a whole number from 1 to 500.');
    await mounted.choose(mounted.field('Add slots by'), 'list');
    await mounted.type(mounted.field('Slot times (one per line, IST)'), 'tomorrow morning');
    await mounted.click(mounted.button('Create slots'));
    expect(posts(calls)).toEqual([]);
    expect(mounted.text()).toContain('Line 1 is not a time.');
  });

  it('offers no slot creation on a closed or cancelled drive', async () => {
    for (const status of ['closed', 'cancelled'] as const) {
      const { api } = driveApi({ drive: D({ status }) });
      mounted = await mountDrive(api);
      expect(mounted.maybeButton('Create slots'), status).toBeNull();
      mounted.unmount();
      mounted = null;
    }
  });
});

describe('the invitations', () => {
  it('shows label, name, hints, slot in IST, status and delivery in plain words', async () => {
    const { api } = driveApi();
    mounted = await mountDrive(api);
    const row = rowOf(mounted, 'Candidate 1').textContent.replace(/\s+/g, ' ');
    expect(row).toContain('[synthetic] Person 1');
    expect(row).toContain('p•••@example.test');
    expect(row).toContain('••••1234');
    expect(row).toContain(formatIst('2026-11-03T04:30:00.000Z'));
    expect(row).toContain(INVITATION_STATUS_LABEL.sent);
    expect(row).toContain(`Invite: ${DELIVERY_LABEL.delivered}`);
    expect(row).toContain(`Reminder: ${DELIVERY_LABEL.planned}`);
    expect(row).not.toContain('Reschedule:');
  });

  it('has plain words for every status and every delivery status', async () => {
    const statuses = Object.keys(INVITATION_STATUS_LABEL);
    expect(statuses.sort()).toEqual(
      [
        'blocked_age',
        'created',
        'expired',
        'otp_verified',
        'revoked',
        'sent',
        'started',
        'submitted',
      ].sort(),
    );
    const deliveries = Object.keys(DELIVERY_LABEL);
    expect(deliveries.sort()).toEqual(
      [
        'bounced',
        'cancelled',
        'complained',
        'delivered',
        'failed',
        'planned',
        'queued',
        'sent',
      ].sort(),
    );
    for (const words of [
      ...Object.values(INVITATION_STATUS_LABEL),
      ...Object.values(DELIVERY_LABEL),
    ]) {
      expect(words).toMatch(/^[A-Z][A-Za-z ,:()-]{2,}$/);
    }
  });

  it('shows an invitation with no name or hints (a role that cannot read them) with dashes', async () => {
    const bare = invitation(3, {
      nameDisplay: undefined,
      emailHint: undefined,
      phoneHint: undefined,
      slotStartsAt: undefined,
    });
    const { api } = driveApi({ invitations: { invitations: [bare], nextCursor: null } });
    mounted = await mountDrive(api);
    expect(rowOf(mounted, 'Candidate 3').textContent).toContain('—');
  });

  it('pages with "Next page of invitations" and keeps the earlier page one click away', async () => {
    const { api, calls } = driveApi({
      invitations: { invitations: [invitation(1)], nextCursor: cursorFor(2) },
      invitationsPage2: { invitations: [invitation(2)], nextCursor: null },
    });
    mounted = await mountDrive(api);
    await mounted.click(mounted.button('Next page of invitations'));
    expect(calls.filter((c) => c.path.endsWith('/invitations')).at(-1)?.query).toEqual({
      cursor: cursorFor(2),
    });
    expect(mounted.text()).toContain('Candidate 2');
    expect(mounted.text()).not.toContain('Candidate 1');
    expect(mounted.maybeButton('Next page of invitations')).toBeNull();
    await mounted.click(mounted.button('Previous page of invitations'));
    expect(mounted.text()).toContain('Candidate 1');
  });

  it('says so when nobody is invited yet and links to the upload', async () => {
    const { api } = driveApi({ invitations: { invitations: [], nextCursor: null } });
    mounted = await mountDrive(api);
    expect(mounted.text()).toContain('No invitations yet.');
    expect(mounted.links()).toContain(`/drives/${DRIVE}/upload`);
  });
});

describe('per-invitation actions (one row at a time)', () => {
  const moving = [
    invitation(1, { status: 'created' }),
    invitation(2, { status: 'sent' }),
    invitation(3, { status: 'otp_verified' }),
    invitation(4, { status: 'started' }),
    invitation(5, { status: 'submitted' }),
    invitation(6, { status: 'revoked' }),
    invitation(7, { status: 'expired' }),
    invitation(8, { status: 'blocked_age' }),
  ];
  const withActions = (n: number) =>
    (['Move to slot', 'Resend invite', 'Revoke'] as const).filter(
      (action) => rowButton(mounted as Mounted, `Candidate ${String(n)}`, action) !== null,
    );

  it('offers Move to slot only while created or sent, Resend and Revoke until started', async () => {
    const { api } = driveApi({
      drive: D({ status: 'scheduled' }),
      invitations: { invitations: moving, nextCursor: null },
    });
    mounted = await mountDrive(api);
    expect(withActions(1)).toEqual(['Move to slot', 'Resend invite', 'Revoke']);
    expect(withActions(2)).toEqual(['Move to slot', 'Resend invite', 'Revoke']);
    expect(withActions(3)).toEqual(['Resend invite', 'Revoke']);
    for (const n of [4, 5, 6, 7, 8]) expect(withActions(n), `candidate ${String(n)}`).toEqual([]);
  });

  it('offers neither Move nor Resend on a closed or cancelled drive, only Revoke', async () => {
    for (const status of ['closed', 'cancelled'] as const) {
      const { api } = driveApi({
        drive: D({ status }),
        invitations: { invitations: moving, nextCursor: null },
      });
      mounted = await mountDrive(api);
      expect(withActions(1), status).toEqual(['Revoke']);
      mounted.unmount();
      mounted = null;
    }
  });

  it('offers no Move on an open-window drive (it has no slots)', async () => {
    const { api } = driveApi({
      drive: D({ mode: 'open_window', status: 'scheduled' }),
      invitations: { invitations: moving, nextCursor: null },
    });
    mounted = await mountDrive(api);
    expect(withActions(1)).toEqual(['Resend invite', 'Revoke']);
  });

  it('Move to slot lists only open future slots with space, sends the chosen one and shows the new row', async () => {
    const past = slot(1, { startsAt: '2026-01-01T04:30:00.000Z' });
    const full = slot(2, { booked: 50, capacity: 50 });
    const closed = slot(3, { status: 'closed' });
    const ok1 = slot(4);
    const ok2 = slot(5, { booked: 49 });
    const moved = invitation(1, { status: 'sent', slotStartsAt: ok2.startsAt });
    const { api, calls } = driveApi({
      drive: D({ status: 'scheduled' }),
      slots: { slots: [past, full, closed, ok1, ok2], nextCursor: null },
      invitations: { invitations: [invitation(1, { status: 'sent' })], nextCursor: null },
      also: (call) => (call.path.endsWith('/move') ? { body: moved } : undefined),
    });
    mounted = await mountDrive(api);
    await press(mounted, 'Candidate 1', 'Move to slot');
    const picker = mounted.field('Move to');
    const options = [...picker.querySelectorAll('option')].map((o) => o.getAttribute('value'));
    expect(options).toEqual(['', ok1.id, ok2.id]);
    expect(posts(calls)).toEqual([]);
    await mounted.choose(picker, ok2.id);
    await mounted.click(mounted.button('Move'));
    expect(lastPost(calls)?.path).toBe(
      `/drives/${DRIVE}/invitations/${invitation(1).invitationId}/move`,
    );
    expect(lastPost(calls)?.body).toEqual({ toSlotId: ok2.id });
    expect(rowOf(mounted, 'Candidate 1').textContent).toContain(formatIst(ok2.startsAt));
    expect(mounted.maybeButton('Move')).toBeNull();
  });

  it('Resend invite sends one request for that row and says it was queued', async () => {
    const { api, calls } = driveApi({
      drive: D({ status: 'scheduled' }),
      also: (call) =>
        call.path.endsWith('/resend')
          ? {
              body: invitation(2, {
                delivery: { invite: 'queued', reminder: 'planned', reschedule: null },
              }),
            }
          : undefined,
    });
    mounted = await mountDrive(api);
    await press(mounted, 'Candidate 2', 'Resend invite');
    expect(posts(calls)).toHaveLength(1);
    expect(lastPost(calls)?.path).toBe(
      `/drives/${DRIVE}/invitations/${invitation(2).invitationId}/resend`,
    );
    expect(mounted.text()).toContain('A new invite is queued.');
    expect(rowOf(mounted, 'Candidate 2').textContent).toContain(`Invite: ${DELIVERY_LABEL.queued}`);
  });

  it('Revoke asks again for that one row, then revokes only it', async () => {
    const { api, calls } = driveApi({
      drive: D({ status: 'scheduled' }),
      also: (call) =>
        call.path.endsWith('/revoke') ? { body: invitation(1, { status: 'revoked' }) } : undefined,
    });
    mounted = await mountDrive(api);
    await press(mounted, 'Candidate 1', 'Revoke');
    expect(posts(calls)).toEqual([]);
    expect(mounted.text()).toContain('Revoke the invitation of Candidate 1?');
    await mounted.click(mounted.button('Keep the invitation'));
    expect(posts(calls)).toEqual([]);
    await press(mounted, 'Candidate 1', 'Revoke');
    await mounted.click(mounted.button('Yes, revoke'));
    expect(posts(calls)).toHaveLength(1);
    expect(lastPost(calls)?.path).toBe(
      `/drives/${DRIVE}/invitations/${invitation(1).invitationId}/revoke`,
    );
    expect(rowOf(mounted, 'Candidate 1').textContent).toContain(INVITATION_STATUS_LABEL.revoked);
    expect(rowButton(mounted, 'Candidate 1', 'Revoke')).toBeNull();
    expect(rowOf(mounted, 'Candidate 2').textContent).toContain(INVITATION_STATUS_LABEL.sent);
  });

  it('shows a refused row action as fixed words and leaves the row as it was', async () => {
    const { api } = driveApi({
      drive: D({ status: 'scheduled' }),
      also: (call) => (call.path.endsWith('/revoke') ? failure(409, 'conflict') : undefined),
    });
    mounted = await mountDrive(api);
    await press(mounted, 'Candidate 1', 'Revoke');
    await mounted.click(mounted.button('Yes, revoke'));
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toContain(
      'no longer possible',
    );
    expect(rowOf(mounted, 'Candidate 1').textContent).toContain(INVITATION_STATUS_LABEL.sent);
  });
});

describe('a cancelled drive: one drive-level revoke (R5-59, R5-64 f)', () => {
  const cancelled = () =>
    driveApi({
      drive: D({ status: 'cancelled' }),
      also: (call) =>
        call.path.endsWith('/revoke-not-started')
          ? { body: { revoked: 2, skipped: 1 } }
          : undefined,
    });

  it('asks again, then revokes once and reports "N revoked, M skipped (a test may still start)"', async () => {
    const { api, calls } = cancelled();
    mounted = await mountDrive(api);
    await mounted.click(mounted.button('Revoke all invitations not yet started'));
    expect(posts(calls)).toEqual([]);
    await mounted.click(mounted.button('Yes, revoke them'));
    expect(posts(calls)).toHaveLength(1);
    expect(lastPost(calls)?.path).toBe(`/drives/${DRIVE}/revoke-not-started`);
    expect(mounted.text()).toContain('2 revoked, 1 skipped (a test may still start)');
  });

  it('reloads the invitations afterwards', async () => {
    const { api, calls } = cancelled();
    mounted = await mountDrive(api);
    const before = calls.filter((c) => c.path.endsWith('/invitations')).length;
    await mounted.click(mounted.button('Revoke all invitations not yet started'));
    await mounted.click(mounted.button('Yes, revoke them'));
    expect(calls.filter((c) => c.path.endsWith('/invitations')).length).toBe(before + 1);
  });

  it('has no row selection, no select-all and no other bulk control, on any status', async () => {
    for (const status of ['draft', 'scheduled', 'closed', 'cancelled'] as const) {
      const { api } = driveApi({ drive: D({ status }) });
      mounted = await mountDrive(api);
      expect(mounted.container.querySelector('input[type="checkbox"]'), status).toBeNull();
      expect(mounted.container.innerHTML, status).not.toMatch(
        /select all|role="checkbox"|aria-selected/i,
      );
      expect(mounted.text(), status).not.toMatch(/\bbulk\b/i);
      const revokeAll = [...mounted.container.querySelectorAll('button')].filter((b) =>
        /revoke all/i.test(b.textContent),
      );
      expect(revokeAll, status).toHaveLength(status === 'cancelled' ? 1 : 0);
      mounted.unmount();
      mounted = null;
    }
  });
});
