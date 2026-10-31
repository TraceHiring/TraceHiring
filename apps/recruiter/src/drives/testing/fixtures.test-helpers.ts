// Synthetic drive, slot and invitation data for the M2 drive screens' tests. Every text is labelled synthetic, every
// address is on example.test; no personal data (CLAUDE.md: synthetic data only).
import type {
  DriveDetail,
  DriveSummary,
  InvitationRow,
  InviteUploadView,
  SlotView,
} from '@trace/shared/contracts/m2';

export const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** 10:00 IST on 2 Nov 2026. */
export const TIME = '2026-11-02T04:30:00.000Z';
export const LATER = '2026-11-09T12:30:00.000Z';

/** A valid page cursor (url-safe text) for the n-th page. */
export const cursorFor = (n: number): string => `cursor_${String(n)}`;

export function summary(n: number, patch: Partial<DriveSummary> = {}): DriveSummary {
  return {
    id: uid(100 + n),
    name: `[synthetic] Drive ${String(n)}`,
    testId: uid(200 + n),
    mode: 'scheduled',
    status: 'draft',
    opensAt: TIME,
    deadlineAt: LATER,
    createdAt: TIME,
    ...patch,
  };
}

export function drive(n: number, patch: Partial<DriveDetail> = {}): DriveDetail {
  return {
    id: uid(100 + n),
    name: `[synthetic] Drive ${String(n)}`,
    testId: uid(200 + n),
    defaultTestVersionId: uid(300 + n),
    mode: 'scheduled',
    status: 'draft',
    opensAt: TIME,
    deadlineAt: LATER,
    reminderOffsetsMinutes: [1440, 60],
    selfRescheduleAllowed: true,
    labMode: false,
    expectedCandidates: null,
    minPoolRatio: null,
    createdAt: TIME,
    ...patch,
  };
}

export function slot(n: number, patch: Partial<SlotView> = {}): SlotView {
  return {
    id: uid(400 + n),
    startsAt: new Date(Date.parse('2026-11-03T04:30:00.000Z') + n * 3_600_000).toISOString(),
    capacity: 50,
    booked: 0,
    startWindowMinutes: 15,
    lobbyOpensMinutes: 30,
    status: 'open',
    ...patch,
  };
}

export function invitation(n: number, patch: Partial<InvitationRow> = {}): InvitationRow {
  return {
    invitationId: uid(500 + n),
    label: `Candidate ${String(n)}`,
    nameDisplay: `[synthetic] Person ${String(n)}`,
    emailHint: 'p•••@example.test',
    phoneHint: '••••1234',
    slotStartsAt: '2026-11-03T04:30:00.000Z',
    status: 'sent',
    delivery: { invite: 'delivered', reminder: 'planned', reschedule: null },
    ...patch,
  };
}

export function uploadView(patch: Partial<InviteUploadView> = {}): InviteUploadView {
  return {
    uploadId: uid(600),
    driveId: uid(101),
    status: 'open',
    rowsInFile: 3,
    rowsInvited: 0,
    rowsRefused: 0,
    rowsHeld: 0,
    reuploadWarning: false,
    createdAt: TIME,
    completedAt: null,
    ...patch,
  };
}

/** A synthetic invite file as text: the header, then one line per row. */
export const csvOf = (...lines: string[]): string => `${lines.join('\r\n')}\r\n`;
export const HEADER = 'full_name,email,phone,18_or_older,slot_starts_at,language';
/** The n-th synthetic row: a name of letters only (a name has no digits), an example.test address, adult. */
export const csvRow = (n: number, extra = ''): string =>
  `Person ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[n % 26] ?? 'A'},person${String(n)}@example.test,,yes,,${extra}`;
